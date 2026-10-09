"""Publishing preserves production and isolates static PR artifacts."""
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts import pages_preview as pages
from quickdash.io import parse_yaml


def archive(label="dashboard", extra=None, files=None):
    tar = io.BytesIO()
    with tarfile.open(fileobj=tar, mode="w") as out:
        root = tarfile.TarInfo(".")
        root.type = tarfile.DIRTYPE
        out.addfile(root)
        for name in pages.SITE_FILES:
            data = (files or {}).get(name, (label + ":" + name).encode())
            member = tarfile.TarInfo("./" + name)
            member.size = len(data)
            out.addfile(member, io.BytesIO(data))
        if extra:
            out.addfile(extra)
    zipped = io.BytesIO()
    with zipfile.ZipFile(zipped, "w") as out:
        out.writestr("artifact.tar", tar.getvalue())
    return zipped.getvalue()


def build(run_id, sha="abc", label="dashboard"):
    return dict(run_id=run_id, run_attempt=1, sha=sha, artifact_id=run_id,
                run_url="https://github.com/org/repo/actions/runs/" + str(run_id),
                bundle=archive(label))


def pull(number, sha="abc", title="Example", repo_id=1):
    return dict(number=number, title=title, html_url=f"https://github.com/org/repo/pull/{number}",
                head=dict(sha=sha, ref="feature", repo=dict(id=repo_id)))


class Source:
    def __init__(self):
        self.main = build(10, label="production")
        self.open = [pull(11), pull(12, repo_id=2)]
        self.previews = {11: build(11, label="first"), 12: build(12, label="fork")}

    def pulls(self):
        return self.open

    def latest_build(self, pr=None):
        return self.main if pr is None else self.previews.get(pr["number"])

    def download(self, candidate):
        return candidate["bundle"]


class PagesPreview(unittest.TestCase):
    def test_repository_endpoint_has_no_trailing_slash(self):
        with patch.object(pages.subprocess, "check_output", return_value=b'{"id":1}') as command:
            self.assertEqual(pages.GitHub("org/repo", "main").get("")["id"], 1)
            self.assertEqual(command.call_args.args[0], ["gh", "api", "repos/org/repo"])

    def test_only_expected_regular_files_can_be_published(self):
        self.assertEqual(set(pages.read_bundle(archive())), set(pages.SITE_FILES))
        for name in ("../index.html", "/index.html", "pr-preview/pr-1/index.html", ".git/config", "./index.html"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                pages.read_bundle(archive(extra=tarfile.TarInfo(name)))
        link = tarfile.TarInfo("link")
        link.type = tarfile.SYMTYPE
        link.linkname = "index.html"
        with self.assertRaises(ValueError):
            pages.read_bundle(archive(extra=link))
        with patch.object(pages, "MAX_BYTES", 10), self.assertRaises(ValueError):
            pages.read_bundle(archive())
        with self.assertRaises(ValueError):
            pages.read_bundle(b"not a zip")
        zipped = io.BytesIO()
        with zipfile.ZipFile(zipped, "w") as out:
            out.writestr("unexpected", b"data")
        with self.assertRaises(ValueError):
            pages.read_bundle(zipped.getvalue())

    def test_reconcile_updates_main_and_previews_preserves_failed_builds_and_prunes_closed(self):
        source = Source()
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            first = pages.reconcile(site, source)
            self.assertEqual((site / "index.html").read_text(), "production:index.html")
            self.assertEqual((site / "pr-preview/pr-12/index.html").read_text(), "fork:index.html")
            self.assertEqual(set(first["previews"]), {"11", "12"})

            # A main deploy preserves previews whose latest build is pending/failed/expired.
            source.main = build(20, label="new production")
            source.previews = {}
            source.open[0]["head"]["sha"] = "pending"
            pages.reconcile(site, source)
            self.assertEqual((site / "index.html").read_text(), "new production:index.html")
            self.assertEqual((site / "pr-preview/pr-11/index.html").read_text(), "first:index.html")
            self.assertIn("Previous successful build", (site / "pr-preview/index.html").read_text())

            # Every event reconciles all open PRs, regardless of which run triggered it.
            source.main = None
            source.open = [pull(11, "next", title="<script>alert(1)</script>")]
            source.previews = {11: build(30, "next", "updated")}
            final = pages.reconcile(site, source)
            self.assertEqual((site / "index.html").read_text(), "new production:index.html")
            self.assertEqual((site / "pr-preview/pr-11/index.html").read_text(), "updated:index.html")
            self.assertFalse((site / "pr-preview/pr-12").exists())
            self.assertEqual(final["previews"]["11"]["sha"], "next")
            self.assertNotIn("<script>", (site / "pr-preview/index.html").read_text())
            self.assertNotIn("bundle", json.dumps(final))

    def test_old_main_runs_cannot_roll_back_production(self):
        source = Source()
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            pages.reconcile(site, source)
            source.main = build(9, label="old")
            pages.reconcile(site, source)
            self.assertEqual((site / "index.html").read_text(), "production:index.html")

    def test_bad_preview_cannot_replace_main_or_block_other_previews(self):
        source = Source()
        source.previews[11]["bundle"] = archive(extra=tarfile.TarInfo("../index.html"))
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            state = pages.reconcile(site, source)
            self.assertNotIn("11", state["previews"])
            self.assertIn("12", state["previews"])
            self.assertEqual((site / "index.html").read_text(), "production:index.html")
            self.assertIn("Awaiting successful build", (site / "pr-preview/index.html").read_text())

    def test_first_publish_requires_a_successful_main_artifact(self):
        source = Source()
        source.main = None
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(ValueError, "main"):
            pages.reconcile(Path(tmp), source)

    def test_fork_build_selection_uses_repository_and_sha_not_mutable_pr_metadata(self):
        api = pages.GitHub("org/repo", "main")
        pr = pull(12, "expected", repo_id=2)
        runs = [dict(id=i, run_attempt=1, head_sha=sha, head_branch="feature",
                     head_repository=dict(id=repo), event="pull_request", conclusion="success",
                     html_url=f"https://github.com/org/repo/actions/runs/{i}", pull_requests=[])
                for i, sha, repo in [(100, "old", 2), (101, "expected", 1), (99, "expected", 2)]]
        def get(path):
            if "/runs?" in path:
                return {"workflow_runs": runs}
            self.assertIn("runs/99/artifacts", path)
            return {"artifacts": [dict(id=9, name="github-pages", expired=False, size_in_bytes=100)]}
        with patch.object(api, "get", side_effect=get):
            self.assertEqual(api.latest_build(pr)["run_id"], 99)

    def test_report_only_links_current_deployed_heads_and_updates_existing_check(self):
        source = Source()
        with tempfile.TemporaryDirectory() as tmp:
            state = pages.reconcile(Path(tmp), source)
        api = pages.GitHub("org/repo", "main")
        source.open[1]["head"]["sha"] = "new head"
        with patch.object(api, "pulls", return_value=source.open), patch.object(api, "get", return_value={"check_runs": []}), patch.object(api, "write") as write:
            pages.report_checks(state, api, "https://org.github.io/repo")
            self.assertEqual(write.call_count, 1)
            method, path, payload = write.call_args.args
            self.assertEqual(method, "POST")
            self.assertEqual(payload["head_sha"], "abc")
            self.assertEqual(payload["details_url"], "https://org.github.io/repo/pr-preview/pr-11/")
            self.assertEqual(payload["conclusion"], "success")
        existing = {"check_runs": [{"id": 123, "external_id": "quickdash-preview-11"}]}
        with patch.object(api, "pulls", return_value=source.open), patch.object(api, "get", return_value=existing), patch.object(api, "write") as write:
            pages.report_checks(state, api, "https://org.github.io/repo/")
            self.assertEqual(write.call_args.args[:2], ("PATCH", "check-runs/123"))

    def test_worktree_state_round_trip_keeps_source_branch_intact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            origin, checkout, site = root / "origin.git", root / "source", root / "site"
            def git(*args, cwd=None):
                return subprocess.check_output(["git", *args], cwd=cwd, stderr=subprocess.DEVNULL)
            git("init", "--bare", str(origin))
            git("clone", str(origin), str(checkout))
            (checkout / "source.txt").write_text("source must remain")
            git("add", ".", cwd=checkout)
            git("-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-m", "Initial", cwd=checkout)
            git("push", "origin", "HEAD", cwd=checkout)
            source_head = git("rev-parse", "HEAD", cwd=checkout)
            previous = Path.cwd()
            try:
                os.chdir(checkout)
                pages.prepare_worktree(site)
                self.assertFalse((site / "source.txt").exists())
                pages.reconcile(site, Source())
                pages.save_worktree(site)
                self.assertEqual(git("rev-parse", "HEAD", cwd=checkout), source_head)
                self.assertEqual((checkout / "source.txt").read_text(), "source must remain")
                git("worktree", "remove", str(site), cwd=checkout)
                pages.prepare_worktree(site)
                self.assertEqual((site / "index.html").read_text(), "production:index.html")
                pages.save_worktree(site)  # An unchanged snapshot needs no new commit.
            finally:
                os.chdir(previous)

    def test_workflow_keeps_pr_builds_unprivileged_and_publisher_on_default_branch(self):
        root = Path(__file__).resolve().parents[1]
        build = parse_yaml((root / ".github/workflows/pages.yml").read_text())
        publish = parse_yaml((root / ".github/workflows/publish-pages.yml").read_text())
        self.assertEqual(build["permissions"], {"contents": "read"})
        self.assertNotIn("deploy", build["jobs"])
        self.assertEqual(publish["on"]["pull_request_target"]["types"], ["closed"])
        self.assertEqual(publish["on"]["workflow_run"]["workflows"], [build["name"]])
        steps = publish["jobs"]["publish"]["steps"]
        self.assertEqual(steps[0]["with"]["ref"], "${{ github.event.repository.default_branch }}")
        self.assertEqual(publish["concurrency"]["group"], "quickdash-pages-publish")
        self.assertLess(next(i for i,s in enumerate(steps) if s.get("id") == "deployment"),
                        next(i for i,s in enumerate(steps) if s.get("name") == "Link deployed previews from PR checks"))


if __name__ == "__main__":
    unittest.main()

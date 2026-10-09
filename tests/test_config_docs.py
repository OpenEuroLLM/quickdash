"""Keep schema field tables and executable examples aligned with the validators."""

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import yaml

from app.build import default_comparison
from quickdash import config
from tests.config_docs import examples, schemas


class ConfigurationDocs(unittest.TestCase):
    def test_schema_fields_follow_live_validators(self):
        docs = schemas()
        # Fictional inputs exercise every nested mapping. Field inventories come
        # from object_keys calls in the validators, not a second schema in tests.
        match = dict(regex="example_(en|fr)")
        language = dict(tasks=["example_en"], scope="single", language="eng_Latn")
        component = dict(name="only", match=match, relative_weight=1)
        rule = dict(name="Example", category="C", match=match, metric="acc",
                    metric_filter="none", score=dict(scale=1),
                    normalize=dict(min=0, max=1),
                    aggregation=dict(components=[component]))
        catalogue = dict(version=1, name="Example catalogue", evals=[rule], languages=[language])
        variant = dict(task="example_en")
        entry = dict(name="Example", variants=[variant])
        suite = dict(version=1, name="Example set", mode="fixed", evals=[entry])
        profile = dict(version=1, name="Example weights", weights=dict(C=1))
        defaults = dict(note="Language rationale")
        definition = dict(rule, languages=[language], language_defaults=defaults)
        metadata = dict(version=1, name="Example manifest")
        manifest = dict(metadata, evals_dir="evals")
        targets = dict(catalogue=catalogue, eval=rule, match=match, score=rule["score"],
                       normalize=rule["normalize"], aggregation=rule["aggregation"],
                       component=component, language=language, set=suite,
                       profile=profile, manifest=manifest)
        targets.update({"set-eval": entry, "variant": variant, "language-defaults": defaults})
        observed = {}
        original = config.object_keys

        def record(value, allowed, required=()):
            original(value, allowed, required)
            for name, target in targets.items():
                if value == target:
                    signature = (set(allowed), set(required))
                    if name in observed:
                        self.assertEqual(observed[name], signature, name)
                    observed[name] = signature

        with patch.object(config, "object_keys", side_effect=record):
            config.validate_catalogue(catalogue)
            config.validate_suite(suite)
            config.validate_profile(profile)
            config.assemble_catalogue(metadata, [definition])
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory)
                (path / "evals").mkdir()
                (path / "evals/example.yaml").write_text(yaml.safe_dump(definition))
                (path / "catalogue.yaml").write_text(yaml.safe_dump(manifest))
                config.load_catalogue(path / "catalogue.yaml")

        self.assertEqual(set(observed), set(targets), "Every documented mapping must exercise its validator")
        # Per-eval assembly moves these two file-level fields outside the rule.
        observed["eval"][0].update(definition.keys() - rule.keys())
        observed["eval"][1].add("languages")
        self.assertEqual(set(docs), set(observed) | {"startup"})
        for name, (allowed, required) in observed.items():
            with self.subTest(schema=name):
                self.assertEqual(set(docs[name]), allowed, "Document every allowed field, and no obsolete fields")
                for field in required:
                    self.assertIn("required", docs[name][field].lower(), field)
                for field, status in docs[name].items():
                    if status.lower() == "required":
                        self.assertIn(field, required, field)

    def test_examples_load_from_disk_with_the_documented_layout(self):
        docs = examples()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "evals").mkdir()
            (path / "catalogue.yaml").write_text(yaml.safe_dump(docs["manifest"]))
            (path / "evals/example.yaml").write_text(yaml.safe_dump(docs["eval"]))
            (path / "weights.yaml").write_text(yaml.safe_dump(docs["profile"]))
            (path / "set.yaml").write_text(yaml.safe_dump(docs["set-pinned"]))
            loaded = config.load_config(catalogue=path / "catalogue.yaml",
                                        weights=path / "weights.yaml", eval_set=path / "set.yaml")
            self.assertEqual(loaded["catalogue"]["evals"][0]["name"], docs["eval"]["name"])
            (path / "default.yaml").write_text(yaml.safe_dump(docs["startup"]))
            labels = set(docs["startup"].values())
            self.assertEqual(default_comparison(path, labels), docs["startup"])
            self.assertEqual(set(schemas()["startup"]), set(docs["startup"]))
            for field in docs["startup"]:
                invalid = {k: v for k, v in docs["startup"].items() if k != field}
                (path / "default.yaml").write_text(yaml.safe_dump(invalid))
                with self.assertRaises(ValueError):
                    default_comparison(path, labels)

    def test_markers_allow_prose_and_table_formatting_changes(self):
        self.assertEqual(schemas("Intro\n<!-- config-schema: demo -->\n\n"
                                 "| Field | Required? | Details |\n|:---|:---|---|\n"
                                 "| `name` | Required | Wording can change. |\n"),
                         {"demo": {"name": "Required"}})
        self.assertEqual(examples("New heading\n<!-- config-example: demo -->\n\n"
                                  "```yaml\nname: Example # A comment\n```\n"),
                         {"demo": {"name": "Example"}})

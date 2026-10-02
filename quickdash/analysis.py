"""Native evaluation allocation, coverage and serializable analysis reports."""

import json
import re
import warnings
from .config import (
    classify,
    in_suite,
    match_task,
    normalize_score,
    resolve_inputs,
    scope_rows,
    task_language,
)
from .io import load_csv

IDENTITY = ("task", "metric", "filter", "n_shot", "harness", "backend")


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def key(row):
    return tuple(row[k] for k in IDENTITY)


def matching_key(row, config, matching="strict"):
    identity = list(key(row))
    if matching == "relaxed":
        e = next((e for e in config["evals"] if e["name"] == row["eval"]), {})
        if "shots" in e:
            identity[3] = str(int(e["shots"]))
    return tuple(identity)


def matching_audit(audit, catalogue, matching="strict"):
    if matching not in {"strict", "relaxed"}:
        raise ValueError("Matching must be strict or relaxed")
    if matching == "strict":
        return audit
    result = [dict(r) for r in audit]
    evals = {e["name"]: e for e in catalogue["evals"]}
    groups = {}
    for r in result:
        e = evals.get(r["eval"], {})
        if (
            "shots" not in e
            or r["metric"] != e["metric"]
            or r["filter"] != e["metric_filter"]
            or "select" in e
            and match_task(e["select"], r["task"]) is None
        ):
            continue
        identity = (r["checkpoint"], *[r[k] for k in IDENTITY if k != "n_shot"])
        groups.setdefault(identity, []).append(r)
    for rr in groups.values():
        e = evals[rr[0]["eval"]]
        distance = min(abs(int(r["n_shot"]) - e["shots"]) for r in rr)
        nearest = sorted(
            {
                int(r["n_shot"])
                for r in rr
                if abs(int(r["n_shot"]) - e["shots"]) == distance
            }
        )
        for r in rr:
            r.update(selected=False, raw_score_100=None, score_100=None)
            r.pop("matching_ambiguous_shots", None)
            if len(nearest) != 1:
                r.update(
                    decision="Equally close shot settings; excluded",
                    matching_ambiguous_shots=nearest,
                )
            elif int(r["n_shot"]) != nearest[0]:
                r["decision"] = "Alternate shot setting; a closer setting is available"
            else:
                raw, adjusted = normalize_score(r["value"], e)
                r.update(
                    selected=True,
                    raw_score_100=raw,
                    score_100=adjusted,
                    decision="Selected for the weighted score"
                    if nearest[0] == e["shots"]
                    else f"Using {nearest[0]} shots despite expected {int(e['shots'])}; relaxed matching",
                )
    seen = set()
    for r in result:
        if r["selected"]:
            identity = (r["checkpoint"], *key(r))
            if identity in seen:
                raise ValueError("Duplicate selected measurement: " + r["task"])
            seen.add(identity)
    return result


def measurement_id(row):
    return encoded([row["checkpoint"], *key(row)])


class Report(dict):
    """JSON-serializable mapping with attribute access to top-level fields."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name) from error


class QuickdashWarning(UserWarning):
    """A recoverable diagnostic; the original structured record is available."""

    def __init__(self, diagnostic):
        self.diagnostic = diagnostic
        super().__init__(
            f"{diagnostic['code']} / {diagnostic['model']} / {diagnostic['name']}: {diagnostic['detail']}"
        )


class DiagnosticError(ValueError):
    """Strict mode rejected the result. All diagnostics remain inspectable."""

    def __init__(self, diagnostics):
        self.diagnostics = diagnostics
        super().__init__(f"Analysis produced {len(diagnostics)} warning(s)")


def finish(report, policy):
    if policy not in ("warn", "collect", "error"):
        raise ValueError("diagnostics must be warn, collect, or error")
    if policy == "error" and report["diagnostics"]:
        raise DiagnosticError(report["diagnostics"])
    if policy == "warn":
        for diagnostic in report["diagnostics"]:
            warnings.warn(QuickdashWarning(diagnostic), stacklevel=3)
    return Report(report)


def read_results(paths):
    """Read CSV paths, preserving source strings and rejecting duplicate models across files."""
    if isinstance(paths, (str, bytes)) or hasattr(paths, "read_text"):
        paths = [paths]
    rows, owners = [], {}
    for path in paths:
        rr = load_csv(path)
        if any("checkpoint" not in r for r in rr):
            raise ValueError("Missing CSV column: checkpoint")
        for model in {r["checkpoint"] for r in rr}:
            if model in owners:
                raise ValueError("Duplicate model name across CSV files: " + model)
            owners[model] = path
        rows.extend(rr)
    return rows


def component_coverage(rows, config):
    metadata = {t: g for g in config["languages"] for t in g["tasks"]}
    accepted, groups = set(), []
    for e in config["evals"]:
        rr = [r for r in rows if r["eval"] == e["name"]]
        if "aggregation" not in e:
            accepted.update(map(measurement_id, rr))
            continue
        buckets = {}
        for r in rr:
            m = metadata.get(r["task"], {})
            language = (
                (m["source_language"] + " → " + m["target_language"])
                if m.get("scope") == "translation"
                else m.get("language")
            )
            identity = (
                r["checkpoint"],
                language or "Unknown",
                m.get("scope"),
                *[r[k] for k in IDENTITY if k != "task"],
            )
            buckets.setdefault(identity, {"language": language, "rows": []})[
                "rows"
            ].append(r)
        for group in buckets.values():
            parts = {c["name"]: [] for c in e["aggregation"]["components"]}
            valid = bool(group["language"])
            for r in group["rows"]:
                matches = [
                    c
                    for c in e["aggregation"]["components"]
                    if match_task(c["match"], r["task"]) is not None
                ]
                if len(matches) != 1:
                    valid = False
                else:
                    parts[matches[0]["name"]].append(r)
            if not valid or any(len(rr) != 1 for rr in parts.values()):
                continue
            total = sum(c["relative_weight"] for c in e["aggregation"]["components"])
            groups.append(
                {
                    "eval": e["name"],
                    "rows": group["rows"],
                    "parts": [
                        (parts[c["name"]][0], c["relative_weight"] / total)
                        for c in e["aggregation"]["components"]
                    ],
                }
            )
            accepted.update(map(measurement_id, group["rows"]))
    return dict(
        rows=[r for r in rows if measurement_id(r) in accepted],
        excluded=[r for r in rows if measurement_id(r) not in accepted],
        groups=groups,
    )


def distribution(rows, config):
    if not rows:
        return {}, None
    e = next(e for e in config["evals"] if e["name"] == rows[0]["eval"])
    if "aggregation" in e:
        coverage = component_coverage(rows, {**config, "evals": [e]})
        coefficients = {
            measurement_id(r): share / len(coverage["groups"])
            for g in coverage["groups"]
            for r, share in g["parts"]
        }
        rows = coverage["rows"]
    else:
        coefficients = {measurement_id(r): 1 / len(rows) for r in rows}
    return coefficients, sum(
        r["score_100"] * coefficients[measurement_id(r)] for r in rows
    ) if rows else None


def side(row, metadata):
    m = metadata.get(row["task"], {})
    language = (
        m.get("target_language")
        if m.get("scope") == "translation"
        else m.get("language")
    )
    return "english" if language in (None, "", "mul", "eng_Latn") else "other"


def totals(rows, config):
    """Allocate every effective score coefficient before computing contributions."""
    rows = component_coverage(rows, config)["rows"]
    weights = config["weights"]
    mode = config.get("aggregate", "standard")
    metadata = {t: g for g in config["languages"] for t in g["tasks"]}
    coefficients = {measurement_id(r): 0 for r in rows}
    evals = []
    for e in config["evals"]:
        rr = [r for r in rows if r["eval"] == e["name"]]
        _, score = distribution(rr, config)
        evals.append(
            dict(
                name=e["name"],
                category=e["category"],
                metric=e["metric"],
                score=score,
                weight=0,
                contribution=None if rr else 0,
                aggregateScore=None,
                excluded=not rr,
                englishShare=0,
                effectiveEnglishShare=None,
                englishScore=None,
                otherScore=None,
                issue="",
                count=len(rr),
            )
        )
    available = sum(
        w
        for name, w in weights.items()
        if any(e["category"] == name and e["count"] for e in evals)
    )
    categories = []
    for name, w in weights.items():
        ee = [e for e in evals if e["category"] == name and e["count"]]
        share = (
            config.get("english_weights", {}).get(name, 0) if mode != "standard" else 0
        )
        cat = dict(
            name=name,
            weight=w / available if ee and available else 0,
            excluded=not ee,
            excludedEvals=[
                e["name"] for e in evals if e["category"] == name and not e["count"]
            ],
            score=None,
            englishShare=share,
            effectiveEnglishShare=None,
            englishScore=None,
            otherScore=None,
            issue="",
        )
        categories.append(cat)
        if not ee:
            continue

        def allocate(rr, factor):
            cc, _ = distribution(rr, config)
            for rid, coefficient in cc.items():
                coefficients[rid] = factor * coefficient

        if not share:
            cat["score"] = sum(e["score"] for e in ee) / len(ee)
            for e in ee:
                allocate(
                    [r for r in rows if r["eval"] == e["name"]], cat["weight"] / len(ee)
                )
        elif mode == "english_eval":
            for e in ee:
                rr = [r for r in rows if r["eval"] == e["name"]]
                groups = [
                    [r for r in rr if side(r, metadata) == s]
                    for s in ("english", "other")
                ]
                e["englishShare"] = share
                e["englishScore"], e["otherScore"] = [
                    distribution(g, config)[1] for g in groups
                ]
                effective = (
                    0
                    if e["englishScore"] is None
                    else 1
                    if e["otherScore"] is None
                    else share
                )
                e["effectiveEnglishShare"] = effective
                e["aggregateScore"] = effective * (e["englishScore"] or 0) + (
                    1 - effective
                ) * (e["otherScore"] or 0)
                for group, part in zip(groups, (effective, 1 - effective)):
                    allocate(group, cat["weight"] / len(ee) * part)
            cat["score"] = sum(e["aggregateScore"] for e in ee) / len(ee)
        else:
            groups = [
                [
                    [
                        r
                        for r in rows
                        if r["eval"] == e["name"] and side(r, metadata) == s
                    ]
                    for e in ee
                ]
                for s in ("english", "other")
            ]
            groups = [[rr for rr in g if rr] for g in groups]
            cat["englishScore"], cat["otherScore"] = [
                sum(distribution(rr, config)[1] for rr in g) / len(g) if g else None
                for g in groups
            ]
            effective = (
                0
                if cat["englishScore"] is None
                else 1
                if cat["otherScore"] is None
                else share
            )
            cat["effectiveEnglishShare"] = effective
            cat["score"] = effective * (cat["englishScore"] or 0) + (1 - effective) * (
                cat["otherScore"] or 0
            )
            for group, part in zip(groups, (effective, 1 - effective)):
                for rr in group:
                    allocate(rr, cat["weight"] * part / len(group))
        for e in ee:
            rr = [r for r in rows if r["eval"] == e["name"]]
            e["weight"] = sum(coefficients[measurement_id(r)] for r in rr)
            e["contribution"] = sum(
                r["score_100"] * coefficients[measurement_id(r)] for r in rr
            )
            e["aggregateScore"] = (
                e["contribution"] / e["weight"] if e["weight"] else None
            )
    score = (
        sum(c["score"] * c["weight"] for c in categories if not c["excluded"])
        if available
        else None
    )
    return dict(
        score=score, evals=evals, categories=categories, rowWeights=coefficients
    )


def comparison_coverage(a, b, config, matching="strict"):
    left = component_coverage(a, config)["rows"]
    right = component_coverage(b, config)["rows"]

    def match(r):
        return matching_key(r, config, matching)

    shared = set(map(match, left)) & set(map(match, right))
    aa = component_coverage([r for r in left if match(r) in shared], config)["rows"]
    bb = component_coverage([r for r in right if match(r) in shared], config)["rows"]
    return aa, bb


def sample_count(row):
    value = str(row.get("n_samples", ""))
    return (
        int(value)
        if re.fullmatch("[1-9][0-9]*", value) and int(value) <= 2**53 - 1
        else None
    )


def protocol_inconsistent(rows):
    tasks = {}
    for r in rows:
        if r["selected"]:
            tasks.setdefault(r["task"], set()).add(
                tuple(r[k] for k in IDENTITY if k != "task")
            )
    return len({frozenset(s) for s in tasks.values()}) > 1


TITLES = dict(
    config_caveat="Config caveat",
    no_config="No config",
    not_used="Not used",
    unknown_language="Unknown language",
    invalid_sample_count="Invalid sample count",
    inconsistent_scoring_settings="Inconsistent scoring settings",
    strict_shot_setting="Few-shot mismatch excluded",
    relaxed_shot_setting="Few-shot mismatch allowed",
    ambiguous_shot_setting="Ambiguous few-shot setting",
    missing_scoring_field="Missing scoring field",
    missing_scoring_setting="Missing scoring setting",
    no_selected_score="No selected score",
    missing_suite_data="Missing suite data",
    incomplete_components="Incomplete components",
    comparison_coverage="Comparison coverage",
    sample_count_mismatch="Sample-count mismatch",
    no_category_weight="No category weight",
)


def diagnostic(code, model, eval_name, rows, detail, effect="included", tasks=None):
    names = sorted(set(tasks if tasks is not None else [r["task"] for r in rows]))
    return dict(
        code=code,
        type=TITLES[code],
        model=model,
        eval=eval_name,
        name=eval_name or (names[0] if names else model),
        tasks=names,
        measurement_ids=sorted(map(measurement_id, rows)),
        effect=effect,
        detail=detail,
        variants=[dict(settings=detail, tasks=names)] if names else [],
    )


def report_diagnostics(
    audits, config, included, comparison=False, matching_mode="strict", resolved=None
):
    resolved = resolved or resolve_inputs(
        config["catalogue"], config["suite"], config["profile"]
    )
    catalogue, suite, scheme, profile = (
        resolved[k] for k in ("catalogue", "suite", "scheme", "profile")
    )
    out = []
    used = {r["eval"] for rr in included.values() for r in rr}
    for e in catalogue["evals"]:
        if e.get("warning") and e["name"] in used:
            out.append(
                diagnostic(
                    "config_caveat", "Selected comparison", e["name"], [], e["warning"]
                )
            )
    for model, rows in audits.items():
        scope = scope_rows(rows, suite)
        explained_shots = set()
        accepted = {measurement_id(r) for r in included.get(model, [])}
        for task in sorted({r["task"] for r in rows if not r["eval"]}):
            out.append(
                diagnostic(
                    "no_config",
                    model,
                    None,
                    [r for r in rows if r["task"] == task],
                    "No eval configuration; excluded from scoring.",
                    "excluded",
                )
            )
        for e in catalogue["evals"]:
            all_rows = [r for r in rows if r["eval"] == e["name"]]
            outside = [
                r
                for r in all_rows
                if ("select" not in e or match_task(e["select"], r["task"]) is not None)
                and not in_suite(r, suite)
            ]
            matching = [r for r in all_rows if in_suite(r, suite)]
            selected = [r for r in matching if r["selected"]]

            def add(code, rr, detail, effect="included"):
                out.append(diagnostic(code, model, e["name"], rr, detail, effect))

            if matching_mode == "relaxed" and "shots" in e:
                for actual in sorted(
                    {
                        int(r["n_shot"])
                        for r in selected
                        if measurement_id(r) in accepted
                        and int(r["n_shot"]) != e["shots"]
                    }
                ):
                    rr = [
                        r
                        for r in selected
                        if measurement_id(r) in accepted and int(r["n_shot"]) == actual
                    ]
                    item = diagnostic(
                        "relaxed_shot_setting",
                        model,
                        e["name"],
                        rr,
                        f"Using {actual} shots despite expected {e['shots']}; allowed by relaxed matching.",
                    )
                    item.update(expected_shots=e["shots"], actual_shots=actual)
                    out.append(item)
                ambiguous = [r for r in matching if r.get("matching_ambiguous_shots")]
                if ambiguous:
                    item = diagnostic(
                        "ambiguous_shot_setting",
                        model,
                        e["name"],
                        ambiguous,
                        f"Multiple equally close shot settings for expected {e['shots']}; excluded.",
                        "excluded",
                    )
                    item.update(
                        expected_shots=e["shots"],
                        actual_shots=sorted({int(r["n_shot"]) for r in ambiguous}),
                    )
                    out.append(item)
            if outside:
                add(
                    "not_used",
                    outside,
                    "Eval data is not selected by " + suite["name"] + ". Excluded.",
                    "excluded",
                )
            if not matching:
                continue
            unknown = [
                r
                for r in selected
                if task_language(r["task"], catalogue)["status"] == "unknown"
            ]
            if unknown:
                add(
                    "unknown_language",
                    unknown,
                    "Explicit language assignment missing; component groups excluded."
                    if "aggregation" in e
                    else "Unknown language; English fallback applies for weighting only.",
                    "excluded" if "aggregation" in e else "included",
                )
            bad = [
                r
                for r in selected
                if r.get("n_samples") not in (None, "") and sample_count(r) is None
            ]
            if bad:
                add(
                    "invalid_sample_count",
                    bad,
                    "Invalid sample count; scores are not weighted by sample count.",
                )
            if protocol_inconsistent(matching):
                add(
                    "inconsistent_scoring_settings",
                    selected,
                    "Selected variants use inconsistent scoring settings; complete protocols remain included.",
                )
            eligible_tasks = {
                r["task"]
                for r in matching
                if "select" not in e or match_task(e["select"], r["task"]) is not None
            }
            shot_groups = {}
            shot_tasks = set()
            for task in sorted(eligible_tasks):
                rr = [r for r in matching if r["task"] == task]
                if any(r["selected"] for r in rr):
                    continue
                shot_rows = [
                    r
                    for r in rr
                    if r["metric"] == e["metric"]
                    and r["filter"] == e["metric_filter"]
                    and int(r["n_shot"]) != e.get("shots")
                ]
                if matching_mode == "strict" and "shots" in e and shot_rows:
                    shot_tasks.add(task)
                    explained_shots.add((e["name"], task))
                    for r in shot_rows:
                        shot_groups.setdefault(int(r["n_shot"]), []).append(r)
                    continue
                add(
                    "missing_scoring_setting"
                    if any(r["metric"] == e["metric"] for r in rr)
                    else "missing_scoring_field",
                    rr,
                    "Excluded: expected "
                    + e["metric"]
                    + " / "
                    + (e["metric_filter"] or "(empty)")
                    + (f" / {e['shots']} shots" if "shots" in e else "")
                    + ".",
                    "excluded",
                )
            for actual, rr in sorted(shot_groups.items()):
                count = len({r["task"] for r in rr})
                noun = "task uses" if count == 1 else "tasks use"
                item = diagnostic(
                    "strict_shot_setting",
                    model,
                    e["name"],
                    rr,
                    f"{count} {noun} {actual} shots; expected {e['shots']}. Excluded under strict matching; remaining weights are redistributed.",
                    "excluded",
                )
                item.update(expected_shots=e["shots"], actual_shots=actual)
                out.append(item)
            if not selected and not (shot_tasks and eligible_tasks <= shot_tasks):
                add(
                    "no_selected_score",
                    matching,
                    "No score matches the configured metric, filter, shots and selection. Excluded.",
                    "excluded",
                )
        unexplained_missing = [
            r
            for r in scope["missing"]
            if (r["eval"], r.get("task")) not in explained_shots
        ]
        for name in dict.fromkeys(r["eval"] for r in unexplained_missing):
            out.append(
                diagnostic(
                    "missing_suite_data",
                    model,
                    name,
                    [],
                    "Required results missing; remaining weights are redistributed.",
                    "excluded",
                    [
                        r["task"]
                        for r in unexplained_missing
                        if r["eval"] == name and "task" in r
                    ],
                )
            )
        component = component_coverage(scope["rows"], scheme)
        for name in dict.fromkeys(r["eval"] for r in component["excluded"]):
            out.append(
                diagnostic(
                    "incomplete_components",
                    model,
                    name,
                    [r for r in component["excluded"] if r["eval"] == name],
                    "Incomplete component group; entire language/protocol group excluded.",
                    "excluded",
                )
            )
        unmatched = [r for r in component["rows"] if measurement_id(r) not in accepted]
        if comparison:
            for name in dict.fromkeys(r["eval"] for r in unmatched):
                out.append(
                    diagnostic(
                        "comparison_coverage",
                        model,
                        name,
                        [r for r in unmatched if r["eval"] == name],
                        "Unmatched results excluded from both scores; weights use shared data only.",
                        "excluded",
                    )
                )
    for category in dict.fromkeys(
        r["category"] for rr in included.values() for r in rr
    ):
        if category not in profile["weights"]:
            affected = [
                r for rr in included.values() for r in rr if r["category"] == category
            ]
            item = diagnostic(
                "no_category_weight",
                "Selected comparison",
                None,
                affected,
                category + " has no category weight and contributes zero.",
                "zero_weight",
            )
            item.update(name=category, category=category)
            out.append(item)
    if comparison:
        entries = list(included.values())
        a = entries[0] if entries else []
        b = entries[1] if len(entries) > 1 else a

        def match(r):
            return matching_key(r, scheme, matching_mode)

        bm = {match(r): r for r in b}
        for e in catalogue["evals"]:
            rr = [
                r
                for r in a
                if r["eval"] == e["name"]
                and match(r) in bm
                and sample_count(r) is not None
                and sample_count(bm[match(r)]) is not None
                and sample_count(r) != sample_count(bm[match(r)])
            ]
            if rr:
                out.append(
                    diagnostic(
                        "sample_count_mismatch",
                        "Selected comparison",
                        e["name"],
                        rr + [bm[match(r)] for r in rr],
                        "Matched results have different sample counts. Scores remain included.",
                    )
                )
    return out


def allocation_tree(rows, config, allocation, model):
    metadata = {t: g for g in config["languages"] for t in g["tasks"]}

    def grouped(rr, fn):
        groups = {}
        for r in rr:
            groups.setdefault(fn(r), []).append(r)
        return sorted(groups.items())

    def language(r):
        m = metadata.get(r["task"], {})
        return (
            m["source_language"] + " → " + m["target_language"]
            if m.get("scope") == "translation"
            else m.get("language", "Unknown")
        )

    def node(kind, label, rr, children=None, relative=None, measurement=None):
        weight = sum(allocation["rowWeights"].get(measurement_id(r), 0) for r in rr)
        contribution = sum(
            r["score_100"] * allocation["rowWeights"].get(measurement_id(r), 0)
            for r in rr
        )
        return dict(
            kind=kind,
            label=label,
            score=contribution / weight
            if weight
            else rr[0]["score_100"]
            if measurement
            else None,
            weight=0,
            effective_weight=weight,
            contribution=contribution,
            relative_weight=relative,
            measurement_id=measurement,
            children=children or [],
        )

    def leaves(rr, e):
        result = []
        for r in sorted(rr, key=measurement_id):
            c = next(
                (
                    c
                    for c in e.get("aggregation", {}).get("components", [])
                    if match_task(c["match"], r["task"]) is not None
                ),
                None,
            )
            result.append(
                node(
                    "component" if c else "measurement",
                    c["name"] if c else r["task"],
                    [r],
                    relative=c["relative_weight"] if c else None,
                    measurement=measurement_id(r),
                )
            )
        return result

    def langs(rr, e):
        return [
            node(
                "language",
                label,
                ll,
                [
                    node("protocol", p, pp, leaves(pp, e))
                    for p, pp in grouped(
                        ll, lambda r: encoded([r[k] for k in IDENTITY if k != "task"])
                    )
                ]
                if "aggregation" in e
                else leaves(ll, e),
            )
            for label, ll in grouped(rr, language)
        ]

    def balance(rr, children):
        return [
            node("language_group", s, ss, children(ss))
            for s, ss in grouped(rr, lambda r: side(r, metadata))
        ]

    def eval_nodes(rr, split):
        result = []
        for e in config["evals"]:
            ee = [r for r in rr if r["eval"] == e["name"]]
            if ee:
                result.append(
                    node(
                        "eval",
                        e["name"],
                        ee,
                        balance(ee, lambda ss: langs(ss, e)) if split else langs(ee, e),
                    )
                )
        return result

    cats = []
    for category in sorted(config["weights"]):
        rr = [r for r in rows if r["category"] == category]
        if not rr:
            continue
        split = (
            config["aggregate"] != "standard"
            and config.get("english_weights", {}).get(category, 0) != 0
        )
        cats.append(
            node(
                "category",
                category,
                rr,
                balance(rr, lambda ss: eval_nodes(ss, False))
                if split and config["aggregate"] == "english_category"
                else eval_nodes(rr, split),
            )
        )
    root = node("model", model, rows, cats)
    root["score"] = allocation["score"]
    root["weight"] = 0 if allocation["score"] is None else 1

    def assign(n, path):
        n["id"] = encoded(path)
        for child in n["children"]:
            child["weight"] = (
                child["effective_weight"] / n["effective_weight"]
                if n["effective_weight"]
                else 0
            )
            assign(
                child,
                path + [[child["kind"], child["measurement_id"] or child["label"]]],
            )

    assign(root, [["model", model]])
    return root


def model_report(model, audit, rows, config, suite):
    allocation = totals(rows, config)
    ids = {measurement_id(r) for r in rows}
    measurements = []
    for r in audit:
        rid = measurement_id(r)
        included = rid in ids
        weight = allocation["rowWeights"].get(rid, 0)
        measurements.append(
            {
                **r,
                "id": rid,
                "language": task_language(r["task"], config),
                "included": included,
                "exclusion": None
                if included
                else "interpretation"
                if not r["selected"]
                else "eval_set"
                if not in_suite(r, suite)
                else "coverage",
                "effective_weight": weight,
                "contribution": r["score_100"] * weight if included else 0,
            }
        )
    return dict(
        model=model,
        score=allocation["score"],
        tree=allocation_tree(rows, config, allocation, model),
        measurements=measurements,
    )


def prepare(rows, config, matching="strict"):
    resolved = resolve_inputs(config["catalogue"], config["suite"], config["profile"])
    catalogue = resolved["catalogue"]
    audit = matching_audit(classify(rows, catalogue), catalogue, matching)
    return resolved, {
        m: [r for r in audit if r["checkpoint"] == m]
        for m in sorted({r["checkpoint"] for r in audit})
    }


def analyze(results, config, *, diagnostics="warn", matching="strict"):
    """Score each model on its own available data; emit recoverable warnings by default."""
    resolved, audits = prepare(results, config, matching)
    scheme, suite = resolved["scheme"], resolved["suite"]
    included = {
        m: component_coverage(scope_rows(rr, suite)["rows"], scheme)["rows"]
        for m, rr in audits.items()
    }
    coverage = []
    for model, rr in audits.items():
        scope = scope_rows(rr, suite)
        coverage.append(
            dict(
                model=model,
                missing=scope["missing"],
                complete=not scope["missing"]
                and len(scope["rows"]) == len(included[model]),
            )
        )
    diagnostics_list = report_diagnostics(
        audits, config, included, matching_mode=matching, resolved=resolved
    )
    return finish(
        dict(
            matching=matching,
            inconsistent=any(
                d["code"] == "relaxed_shot_setting" for d in diagnostics_list
            ),
            models=[
                model_report(m, rr, included[m], scheme, suite)
                for m, rr in audits.items()
            ],
            diagnostics=diagnostics_list,
            coverage=coverage,
        ),
        diagnostics,
    )


def compare(results, config, *, a, b, diagnostics="warn", matching="strict"):
    """Score both models on the same valid measurements, with symmetric exclusions."""
    resolved, all_audits = prepare(results, config, matching)
    scheme, suite = resolved["scheme"], resolved["suite"]
    if a not in all_audits or b not in all_audits:
        raise ValueError("Unknown comparison model")
    audits = {a: all_audits[a], b: all_audits[b]}
    sa = scope_rows(audits[a], suite)
    sb = scope_rows(audits[b], suite)
    aa, bb = comparison_coverage(sa["rows"], sb["rows"], scheme, matching)
    effective = scope_rows(aa, suite)
    left = model_report(a, audits[a], aa, scheme, suite)
    right = model_report(b, audits[b], bb, scheme, suite)
    required = (
        sum(len(e["variants"]) if "variants" in e else 1 for e in suite["evals"])
        if suite["mode"] == "fixed"
        else None
    )
    coverage = dict(
        complete=not effective["missing"]
        if required is not None
        else len(aa) == len(sa["rows"]) and len(bb) == len(sb["rows"]),
        required=required,
        sharedRequired=required - len(effective["missing"])
        if required is not None
        else None,
        presentA=required - len(sa["missing"]) if required is not None else None,
        presentB=required - len(sb["missing"]) if required is not None else None,
        extrasA=len(sa["extras"]),
        extrasB=len(sb["extras"]),
    )

    def match(r):
        return matching_key(r, scheme, matching)

    bm = {match(r): r for r in bb}
    aw = {r["id"]: r["effective_weight"] for r in left["measurements"]}
    deltas = [
        dict(
            task=r["task"],
            measurement_a=measurement_id(r),
            measurement_b=measurement_id(bm[match(r)]),
            raw_delta=r["raw_score_100"] - bm[match(r)]["raw_score_100"],
            score_delta=r["score_100"] - bm[match(r)]["score_100"],
            effective_weight=aw[measurement_id(r)],
            contribution_delta=(r["score_100"] - bm[match(r)]["score_100"])
            * aw[measurement_id(r)],
        )
        for r in aa
    ]
    diagnostics_list = report_diagnostics(
        audits, config, {a: aa, b: bb}, True, matching, resolved
    )
    return finish(
        dict(
            matching=matching,
            inconsistent=any(
                d["code"] == "relaxed_shot_setting" for d in diagnostics_list
            ),
            a=left,
            b=right,
            delta=left["score"] - right["score"]
            if left["score"] is not None and right["score"] is not None
            else None,
            diagnostics=diagnostics_list,
            coverage=coverage,
            deltas=deltas,
        ),
        diagnostics,
    )

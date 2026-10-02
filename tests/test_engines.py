"""Identical behavioral cases exercise native Python and the actual browser engine."""

import csv
import io
import json
import math
import random
import subprocess
import unittest
import warnings
from copy import deepcopy
from pathlib import Path
from quickdash import analyze, compare, load_config, QuickdashWarning, DiagnosticError
from quickdash.io import parse_csv, parse_yaml
from quickdash.config import assemble_catalogue

ROOT = Path(__file__).resolve().parent.parent


def fixture():
    catalogue = dict(
        version=1,
        name="Fixture",
        evals=[
            dict(
                name="E",
                category="C",
                match={"regex": "e_.+"},
                metric="acc",
                filter="none",
                score={"scale": 1},
                normalize={"min": 0.25, "max": 1},
            )
        ],
        languages=[
            dict(tasks=["e_en"], scope="single", language="eng_Latn"),
            dict(tasks=["e_fr"], scope="single", language="fra_Latn"),
        ],
    )
    return dict(
        catalogue=catalogue,
        profile=dict(version=1, name="Weights", weights={"C": 1}),
        suite=dict(version=1, name="Available", mode="available"),
    )


def row(task="e_en", value=".625", **kwargs):
    return {
        **dict(
            checkpoint="A",
            task=task,
            metric="acc",
            filter="none",
            n_shot="0",
            harness="fixture",
            backend="cpu",
            value=value,
        ),
        **kwargs,
    }


def paired(rows):
    return rows + [{**r, "checkpoint": "B", "value": ".4"} for r in rows]


def native(c):
    try:
        cfg = (
            load_config(
                catalogue=parse_yaml(c["yaml"]["catalogue"]),
                weights=parse_yaml(c["yaml"]["profile"]),
                eval_set=parse_yaml(c["yaml"]["suite"]),
            )
            if "yaml" in c
            else c["config"]
        )
        if "eval_definitions" in c:
            cfg = deepcopy(cfg)
            cfg["catalogue"] = assemble_catalogue(
                cfg["catalogue"], c["eval_definitions"]
            )
        rows = parse_csv(c["csv"]) if "csv" in c else c["rows"]
        value = (
            compare(
                rows, cfg, a=c.get("a", "A"), b=c.get("b", "B"), diagnostics="collect"
            )
            if c.get("operation") == "compare"
            else analyze(rows, cfg, diagnostics="collect")
        )
        return {"value": value}
    except ValueError as error:
        return {"error": True, "message": str(error)}


def semantics(value):
    # Human-facing wording is deliberately not a cross-language API contract.
    if isinstance(value, dict):
        return {
            k: semantics(v) for k, v in value.items() if k not in ("detail", "variants")
        }
    if isinstance(value, list):
        return [semantics(v) for v in value]
    return value


class Engines(unittest.TestCase):
    def close(self, a, b, path="result"):
        if isinstance(a, dict):
            self.assertEqual(a.keys(), b.keys(), path)
            for k in a:
                self.close(a[k], b[k], path + "." + k)
        elif isinstance(a, list):
            self.assertEqual(len(a), len(b), path)
            for i, (x, y) in enumerate(zip(a, b)):
                self.close(x, y, f"{path}[{i}]")
        elif isinstance(a, (int, float)) and not isinstance(a, bool):
            self.assertIsInstance(b, (int, float), path)
            self.assertTrue(
                math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-9), f"{path}: {a} != {b}"
            )
        else:
            self.assertEqual(a, b, path)

    def both(self, cases):
        js = json.loads(
            subprocess.check_output(
                ["node", "tests/engine_adapter.cjs"],
                input=json.dumps(cases),
                text=True,
                cwd=ROOT,
            )
        )
        self.assertEqual(len(js), len(cases), "Every case must produce a JS result")
        results = []
        for i, (case, other) in enumerate(zip(cases, js)):
            py = native(case)
            with self.subTest(case=i):
                self.assertEqual("error" in py, "error" in other, (py, other, case))
                if "error" not in py:
                    self.close(semantics(py["value"]), semantics(other["value"]))
            results.append((py, other))
        return results

    def test_per_eval_catalogue_assembly(self):
        original = fixture()
        metadata = {"version": 1, "name": "Fixture", "notes": ["Shared catalogue"]}
        definition = {
            **original["catalogue"]["evals"][0],
            "languages": original["catalogue"]["languages"],
        }
        c = {**original, "catalogue": metadata}
        good = dict(
            config=c,
            eval_definitions=[definition],
            rows=paired([row(), row("e_fr")]),
            operation="compare",
        )
        reference_case = {k: v for k, v in good.items() if k != "eval_definitions"}
        reference_case["config"] = {
            **original,
            "catalogue": {**original["catalogue"], "notes": metadata["notes"]},
        }
        reference = native(reference_case)
        for result in self.both([good])[0]:
            self.assertNotIn("error", result)
            self.close(semantics(result), semantics(reference))
            self.assertEqual(result["value"]["a"]["score"], 50)
        invalid = []
        for definitions in ([], None, [None], [definition, definition]):
            invalid.append({**good, "eval_definitions": definitions})
        for mutate in (
            lambda e: e.pop("languages"),
            lambda e: e.update(languages={}),
            lambda e: e.update(unexpected=True),
            lambda e: e["languages"][0].update(tasks=["foreign_task"]),
            lambda e: e["languages"][0].update(language="de"),
            lambda e: e["languages"].append(deepcopy(e["languages"][0])),
        ):
            e = deepcopy(definition)
            mutate(e)
            invalid.append({**good, "eval_definitions": [e]})
        # Overlap across files is rejected for explicitly assigned tasks.
        overlap = deepcopy(definition)
        overlap.update(name="Other", languages=[])
        invalid.append({**good, "eval_definitions": [definition, overlap]})
        for outputs in self.both(invalid):
            for result in outputs:
                self.assertIn("error", result)
        # Adding entries changes the result according to their data, not file count.
        for size in (1, 3, 7):
            definitions = []
            rows = []
            for i in range(size):
                e = deepcopy(definition)
                e.update(
                    name=f"Eval {i}",
                    match={"name": f"task{i}"},
                    languages=[
                        dict(tasks=[f"task{i}"], scope="single", language="eng_Latn")
                    ],
                )
                definitions.append(e)
                rows.append(row(f"task{i}", ".625"))
            for result in self.both(
                [dict(config=c, eval_definitions=definitions, rows=rows)]
            )[0]:
                self.assertNotIn("error", result)
                self.assertEqual(result["value"]["models"][0]["score"], 50)

    def test_published_sample_across_all_shipped_configs(self):
        # Discover files so adding a profile or set automatically extends parity coverage.
        rows = parse_csv((ROOT / "examples/sample-evals.csv").read_text())
        a = rows[0]["checkpoint"]
        b = "Parity comparison"
        copy = [{**r, "checkpoint": b} for r in rows]
        profiles = sorted(
            p
            for p in (ROOT / "configs/weights").iterdir()
            if p.suffix in {".yaml", ".yml"}
        )
        suites = sorted(
            p
            for p in (ROOT / "configs/sets").iterdir()
            if p.suffix in {".yaml", ".yml"}
        )
        self.assertTrue(profiles)
        self.assertTrue(suites)
        for weights in profiles:
            for suite in suites:
                config = load_config(
                    catalogue=ROOT / "configs/catalogue.yaml",
                    weights=weights,
                    eval_set=suite,
                )
                for mode in ("standard", "english_eval", "english_category"):
                    config["profile"]["aggregate"] = mode
                    with self.subTest(
                        weights=weights.name, suite=suite.name, mode=mode
                    ):
                        cases = [
                            dict(config=config, rows=rows),
                            dict(
                                config=config,
                                rows=rows + copy,
                                operation="compare",
                                a=a,
                                b=b,
                            ),
                            dict(
                                config=config,
                                rows=rows + [r for i, r in enumerate(copy) if i % 7],
                                operation="compare",
                                a=a,
                                b=b,
                            ),
                        ]
                        for outputs in self.both(cases):
                            for result in outputs:
                                self.assertNotIn("error", result)
                                report = result["value"]
                                models = report.get(
                                    "models", [report.get("a"), report.get("b")]
                                )
                                for model in models:
                                    self.assertIsNotNone(model["score"])
                                    self.check_tree(model["tree"])
                        # Matching data has identical aggregate scores and contributions.
                        self.assertEqual(native(cases[1])["value"]["delta"], 0)

    def test_hand_calculated_modes_and_tree(self):
        c = fixture()
        c["catalogue"]["evals"].append(
            dict(
                name="F",
                category="C",
                match={"name": "f_en"},
                metric="acc",
                filter="none",
                score={"scale": 1},
            )
        )
        c["catalogue"]["languages"][0]["tasks"].append("f_en")
        c["profile"]["english_weights"] = {"C": 0.5}
        rr = [row(value="1"), row("e_fr", ".25"), row("f_en", ".6")]
        cases = []
        for mode in ("standard", "english_eval", "english_category"):
            cc = deepcopy(c)
            cc["profile"]["aggregate"] = mode
            cases.append(dict(config=cc, rows=rr))
        for outputs, expected in zip(self.both(cases), (55, 55, 40)):
            for result in outputs:
                self.assertAlmostEqual(result["value"]["models"][0]["score"], expected)
                self.check_tree(result["value"]["models"][0]["tree"])
        # Unequal language counts distinguish per-eval balancing from ordinary averaging.
        c["catalogue"]["languages"].append(
            dict(tasks=["e_de"], scope="single", language="deu_Latn")
        )
        rr.append(row("e_de", ".25"))
        cases = []
        for mode in ("standard", "english_eval", "english_category"):
            cc = deepcopy(c)
            cc["profile"]["aggregate"] = mode
            cases.append(dict(config=cc, rows=rr))
        for outputs, expected in zip(self.both(cases), (140 / 3, 55, 40)):
            for result in outputs:
                self.assertAlmostEqual(result["value"]["models"][0]["score"], expected)

    def check_tree(self, node):
        if node["children"]:
            self.assertAlmostEqual(
                sum(c["contribution"] for c in node["children"]), node["contribution"]
            )
            if node["effective_weight"]:
                self.assertAlmostEqual(sum(c["weight"] for c in node["children"]), 1)
                self.assertAlmostEqual(
                    sum(c["weight"] * (c["score"] or 0) for c in node["children"]),
                    node["score"],
                )
            for child in node["children"]:
                self.check_tree(child)

    def test_warning_and_exclusion_contract(self):
        cases = []
        expected = []

        def add(config, rows, codes, operation="compare"):
            cases.append(dict(config=config, rows=rows, operation=operation))
            expected.append(set(codes))

        c = fixture()
        c["catalogue"]["evals"][0]["warning"] = "Caveat"
        add(c, paired([row()]), ["config_caveat"])
        c = fixture()
        c["suite"]["exclude"] = ["E"]
        add(c, paired([row()]), ["not_used"])
        c = fixture()
        c["suite"] = dict(
            version=1,
            name="Required",
            mode="fixed",
            evals=[dict(name="E", variants=[dict(task="e_en"), dict(task="e_fr")])],
        )
        add(c, paired([row()]), ["missing_suite_data"])
        c = fixture()
        rr = paired([row()])
        rr[0]["metric"] = "acc_norm"
        add(
            c, rr, ["missing_scoring_field", "no_selected_score", "comparison_coverage"]
        )
        c = fixture()
        rr = paired([row()])
        rr[0]["filter"] = "other"
        add(
            c,
            rr,
            ["missing_scoring_setting", "no_selected_score", "comparison_coverage"],
        )
        add(fixture(), paired([row()]) + [row("e_fr")], ["comparison_coverage"])
        add(fixture(), paired([row(), row("unknown")]), ["no_config"])
        add(fixture(), paired([row("e_unknown")]), ["unknown_language"])
        add(fixture(), paired([row(n_samples="many")]), ["invalid_sample_count"])
        rr = paired([row(n_samples="100")])
        rr[1]["n_samples"] = "90"
        add(fixture(), rr, ["sample_count_mismatch"])
        add(
            fixture(),
            paired([row(), row("e_fr", n_shot="5")]),
            ["inconsistent_scoring_settings"],
        )
        for outputs, codes in zip(self.both(cases), expected):
            for result in outputs:
                self.assertNotIn("error", result)
                report = result["value"]
                self.assertEqual({d["code"] for d in report["diagnostics"]}, codes)
                self.assertEqual(
                    {r["task"] for r in report["a"]["measurements"] if r["included"]},
                    {r["task"] for r in report["b"]["measurements"] if r["included"]},
                )

    def test_dynamic_components(self):
        cases = []
        expected = []
        for n in (1, 2, 3, 4, 7):
            c = fixture()
            e = c["catalogue"]["evals"][0]
            e.pop("normalize")
            e["aggregation"] = {
                "components": [
                    dict(
                        name=str(i), match={"regex": f"e_.+_{i}"}, relative_weight=i + 1
                    )
                    for i in range(n)
                ]
            }
            c["catalogue"]["languages"] = [
                dict(
                    tasks=[f"e_en_{i}" for i in range(n)],
                    scope="single",
                    language="eng_Latn",
                )
            ]
            rows = [row(f"e_en_{i}", str((i + 1) / (n + 1))) for i in range(n)]
            cases.append(dict(config=c, rows=paired(rows)))
            expected.append(
                100
                * sum((i + 1) ** 2 / (n + 1) for i in range(n))
                / sum(range(1, n + 1))
            )
        for outputs, score in zip(self.both(cases), expected):
            for result in outputs:
                self.assertAlmostEqual(result["value"]["models"][0]["score"], score)
                self.check_tree(result["value"]["models"][0]["tree"])
        c = cases[-1]["config"]
        rr = cases[-1]["rows"][:-1]
        for result in self.both([dict(config=c, rows=rr, operation="compare")])[0]:
            self.assertIsNone(result["value"]["a"]["score"])
            self.assertIn(
                "incomplete_components",
                {d["code"] for d in result["value"]["diagnostics"]},
            )
        c = deepcopy(c)
        c["suite"] = dict(
            version=1,
            name="Incomplete",
            mode="fixed",
            evals=[dict(name="E", variants=[dict(task="e_en_0")])],
        )
        for result in self.both([dict(config=c, rows=rr)])[0]:
            self.assertIn("error", result)

    def test_input_and_config_edge_cases(self):
        cases = []
        mutations = [
            lambda c: c["catalogue"].update(name="  "),
            lambda c: c["catalogue"]["evals"][0].update(category=" "),
            lambda c: c["profile"].update(weights={"C": 0}),
            lambda c: c["catalogue"]["evals"][0].update(match={"regex": "(?=e)e.*"}),
            lambda c: c["catalogue"]["evals"][0].update(shots=True),
        ]
        for mutate in mutations:
            c = fixture()
            mutate(c)
            cases.append(dict(config=c, rows=[row()]))
        for field in (
            "checkpoint",
            "task",
            "metric",
            "filter",
            "n_shot",
            "harness",
            "backend",
            "value",
        ):
            r = row()
            del r[field]
            cases.append(dict(config=fixture(), rows=[r]))
        for value in ("NaN", "Infinity", "", "0x1", None, True, -0.1, 1.1):
            cases.append(dict(config=fixture(), rows=[row(value=value)]))
        for name in (
            "SYNTHETIC demo — perturbed",
            "SYNTHETIC demo — higher scores",
            "SYNTHETIC demo — future option",
        ):
            cases.append(dict(config=fixture(), rows=[row(checkpoint=name)]))
        cases.append(dict(config=fixture(), rows=[row(), row()]))
        for outputs in self.both(cases):
            for result in outputs:
                self.assertIn("error", result)
        c = fixture()
        c["catalogue"]["evals"][0]["match"] = {"regex": r"e_\d+"}
        for result in self.both([dict(config=c, rows=[row("e_١")])])[0]:
            self.assertFalse(
                result["value"]["models"][0]["measurements"][0]["selected"]
            )

    def test_yaml_csv_and_diagnostics_delivery(self):
        c = fixture()
        stream = io.StringIO()
        w = csv.DictWriter(stream, fieldnames=row())
        w.writeheader()
        w.writerow(row())
        case = dict(
            yaml={k: json.dumps(v) for k, v in c.items()},
            csv="\ufeff" + stream.getvalue(),
        )
        for result in self.both([case])[0]:
            self.assertEqual(result["value"]["models"][0]["score"], 50)
        with warnings.catch_warnings(record=True) as seen:
            warnings.simplefilter("always")
            r = analyze([row("unknown")], c)
        self.assertEqual(len(seen), 1)
        self.assertIsInstance(seen[0].message, QuickdashWarning)
        self.assertEqual(seen[0].message.diagnostic, r.diagnostics[0])
        with self.assertRaises(DiagnosticError):
            analyze([row("unknown")], c, diagnostics="error")
        with warnings.catch_warnings(record=True) as seen:
            analyze([row("unknown")], c, diagnostics="collect")
        self.assertFalse(seen)

    def test_randomized_sizes_and_order(self):
        rng = random.Random(91403)
        cases = []
        for _ in range(60):
            c = fixture()
            c["catalogue"]["evals"] = []
            c["catalogue"]["languages"] = []
            c["profile"]["weights"] = {}
            rows = []
            nc = rng.randint(1, 5)
            for cat in range(nc):
                category = f"C{cat}"
                c["profile"]["weights"][category] = 1 / nc
                for ev in range(rng.randint(1, 6)):
                    name = f"e{cat}_{ev}"
                    c["catalogue"]["evals"].append(
                        dict(
                            name=name,
                            category=category,
                            match={"regex": name + "_.+"},
                            metric="acc",
                            filter="none",
                            score={"scale": 1},
                        )
                    )
                    for lang in ("eng_Latn", "fra_Latn", "deu_Latn")[
                        : rng.randint(1, 3)
                    ]:
                        task = name + "_" + lang
                        c["catalogue"]["languages"].append(
                            dict(tasks=[task], scope="single", language=lang)
                        )
                        rows.append(row(task, str(rng.random())))
            c["profile"]["aggregate"] = rng.choice(
                ["standard", "english_eval", "english_category"]
            )
            c["profile"]["english_weights"] = {
                k: rng.choice([0, 0.3, 0.5, 1]) for k in c["profile"]["weights"]
            }
            rng.shuffle(rows)
            rng.shuffle(c["catalogue"]["evals"])
            cases.append(dict(config=c, rows=paired(rows), operation="compare"))
        for outputs in self.both(cases):
            for result in outputs:
                report = result["value"]
                self.check_tree(report["a"]["tree"])
                self.assertAlmostEqual(
                    sum(r["contribution_delta"] for r in report["deltas"]),
                    report["delta"],
                )

    def test_translation_pooling_and_unknown_language_balance(self):
        c = fixture()
        c["catalogue"]["evals"][0].pop("normalize")
        c["profile"].update(aggregate="english_eval", english_weights={"C": 0.5})
        c["catalogue"]["languages"] = [
            dict(
                tasks=["e_to_en"],
                scope="translation",
                source_language="fra_Latn",
                target_language="eng_Latn",
            ),
            dict(
                tasks=["e_from_en"],
                scope="translation",
                source_language="eng_Latn",
                target_language="fra_Latn",
            ),
            dict(tasks=["e_pool"], scope="pooled", language="mul"),
        ]
        rr = [
            row("e_to_en", "1"),
            row("e_from_en", "0"),
            row("e_pool", ".5"),
            row("e_unknown", "0"),
        ]
        for result in self.both([dict(config=c, rows=rr)])[0]:
            report = result["value"]
            self.assertAlmostEqual(report["models"][0]["score"], 25)
            self.assertEqual(
                {d["code"] for d in report["diagnostics"]}, {"unknown_language"}
            )
            tree = report["models"][0]["tree"]
            self.check_tree(tree)
            self.assertEqual(
                tree["children"][0]["children"][0]["children"][0]["kind"],
                "language_group",
            )
            self.assertEqual(len(report["models"][0]["measurements"]), 4)

    def test_empty_zero_weight_missing_category_and_self_comparison(self):
        cases = [dict(config=fixture(), rows=[])]
        c = fixture()
        c["profile"]["weights"] = {"Other": 1}
        cases.append(dict(config=c, rows=paired([row()]), operation="compare"))
        c = fixture()
        c["profile"]["weights"] = {"C": 0.3, "Other": 0.7}
        cases.append(dict(config=c, rows=[row()]))
        cases.append(
            dict(config=fixture(), rows=[row()], operation="compare", a="A", b="A")
        )
        results = self.both(cases)
        for result in results[0]:
            self.assertEqual(result["value"]["models"], [])
        for result in results[1]:
            self.assertIsNone(result["value"]["delta"])
            self.assertIn(
                "no_category_weight",
                {d["code"] for d in result["value"]["diagnostics"]},
            )
        for result in results[2]:
            self.assertEqual(result["value"]["models"][0]["score"], 50)
        for result in results[3]:
            self.assertEqual(result["value"]["delta"], 0)

    def test_shots_protocols_and_named_requirements(self):
        c = fixture()
        c["suite"] = dict(
            version=1,
            name="Named",
            mode="fixed",
            evals=[
                dict(
                    name="E",
                    variants=[dict(task="e_en", n_shot=0), dict(task="e_fr", n_shot=5)],
                )
            ],
        )
        rr = paired([row(), row("e_fr", n_shot="5")])
        rr[-1]["backend"] = "different"
        for result in self.both([dict(config=c, rows=rr, operation="compare")])[0]:
            report = result["value"]
            self.assertFalse(report["coverage"]["complete"])
            self.assertEqual(report["coverage"]["sharedRequired"], 1)
            self.assertEqual(report["a"]["score"], 50)
            self.assertEqual(
                {r["task"] for r in report["a"]["measurements"] if r["included"]},
                {"e_en"},
            )
        c["catalogue"]["evals"][0]["shots"] = 0
        for result in self.both([dict(config=c, rows=rr)])[0]:
            self.assertIn("error", result)

    def test_component_protocol_compatibility_and_scaling(self):
        c = fixture()
        e = c["catalogue"]["evals"][0]
        e["aggregation"] = {
            "components": [
                dict(name="low", match={"regex": "e_.+_low"}, relative_weight=1),
                dict(name="top", match={"regex": "e_.+_top"}, relative_weight=8),
            ]
        }
        c["catalogue"]["languages"] = [
            dict(tasks=["e_en_low", "e_en_top"], scope="single", language="eng_Latn")
        ]
        rr = paired([row("e_en_low", "1"), row("e_en_top", ".25")])
        cases = [dict(config=c, rows=rr, operation="compare")]
        for field in ("n_shot", "harness", "backend"):
            mutated = deepcopy(rr)
            mutated[1][field] = "5" if field == "n_shot" else "different"
            cases.append(dict(config=c, rows=mutated, operation="compare"))
        scaled = deepcopy(c)
        for component in scaled["catalogue"]["evals"][0]["aggregation"]["components"]:
            component["relative_weight"] *= 11
        cases.append(dict(config=scaled, rows=rr, operation="compare"))
        results = self.both(cases)
        for result in results[0] + results[-1]:
            self.assertAlmostEqual(result["value"]["a"]["score"], 100 / 9)
        for outputs in results[1:-1]:
            for result in outputs:
                self.assertIsNone(result["value"]["delta"])
                self.assertIn(
                    "incomplete_components",
                    {d["code"] for d in result["value"]["diagnostics"]},
                )

    def test_csv_and_yaml_failures_in_both_engines(self):
        cases = []
        for source in (
            "",
            "a,b\n",
            "a,a\n1,2",
            "a,b\n1",
            "a,b\n1,2,3",
            'a,b\n"unclosed',
            'a,b\na"b,1',
            'a,b\n"a"b,1',
            "a,b\n,",
        ):
            cases.append(dict(config=fixture(), csv=source))
        base = {k: json.dumps(v) for k, v in fixture().items()}
        for source in (
            "version: 1\nversion: 1",
            "!!python/object:evil {}",
            "[unclosed",
            "---\n{}\n---\n{}",
            "version: 1\nname: &x [*x]\nevals: []\nlanguages: []",
        ):
            cases.append(dict(yaml={**base, "catalogue": source}, rows=[row()]))
        for outputs in self.both(cases):
            for result in outputs:
                self.assertIn("error", result)
        # These YAML words must remain strings; aliases and folded notes are supported.
        source = """version: 1
name: yes
evals:
  - name: on
    category: C
    match: {name: e_en}
    metric: acc
    filter: none
    score: {scale: 1}
languages: []
notes:
  - &note >-
    Folded text
    across lines.
  - *note
"""
        for result in self.both(
            [dict(yaml={**base, "catalogue": source}, rows=[row()])]
        )[0]:
            self.assertEqual(result["value"]["models"][0]["score"], 62.5)

    def test_portable_regex_character_semantics(self):
        cases = []
        expected = []
        for pattern, task, selected in [
            (r"e_\d+", "e_123", True),
            (r"e_\d+", "e_١", False),
            (r"e_\w+", "e_é", False),
            (r"e_\s+", "e_\u00a0", True),
            ("e_.+", "e_\r", False),
            ("e_.", "e_😀", True),
            ("e_[a-z]+", "e_en\n", False),
        ]:
            c = fixture()
            c["catalogue"]["evals"][0]["match"] = {"regex": pattern}
            cases.append(dict(config=c, rows=[row(task)]))
            expected.append(selected)
        for outputs, selected in zip(self.both(cases), expected):
            for result in outputs:
                self.assertEqual(
                    result["value"]["models"][0]["measurements"][0]["selected"],
                    selected,
                )
        for field, value in [("n_shot", "0\n"), ("n_shot", 2**53), ("n_shot", 1.0)]:
            case = dict(config=fixture(), rows=[row(**{field: value})])
            for result in self.both([case])[0]:
                self.assertEqual("error" in result, value != 1.0)

    def test_python_runtime_never_calls_node_and_cli_streams(self):
        import os
        import sys
        import tempfile
        from unittest.mock import patch

        with patch(
            "subprocess.run", side_effect=AssertionError("No subprocess allowed")
        ):
            c = load_config(
                catalogue=fixture()["catalogue"], weights=fixture()["profile"]
            )
            self.assertEqual(
                analyze([row()], c, diagnostics="collect").models[0]["score"], 50
            )
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            for key, value in fixture().items():
                (folder / (key + ".yaml")).write_text(json.dumps(value))
            stream = io.StringIO()
            writer = csv.DictWriter(stream, fieldnames=row())
            writer.writeheader()
            writer.writerow(row("unknown"))
            (folder / "scores.csv").write_text(stream.getvalue())
            command = [
                sys.executable,
                "-m",
                "quickdash",
                str(folder / "scores.csv"),
                "--catalogue",
                str(folder / "catalogue.yaml"),
                "--weights",
                str(folder / "profile.yaml"),
                "--format",
                "json",
            ]
            env = {**os.environ, "PATH": tmp}
            result = subprocess.run(
                command, capture_output=True, text=True, env=env, cwd=ROOT
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("warning [no_config]", result.stderr)
            self.assertIsNone(json.loads(result.stdout)["models"][0]["score"])
            strict = subprocess.run(
                command + ["--strict"],
                capture_output=True,
                text=True,
                env=env,
                cwd=ROOT,
            )
            self.assertEqual(strict.returncode, 1)
            self.assertEqual(strict.stdout, "")
            self.assertIn("no_config", strict.stderr)

    def test_diagnostic_context_and_suppression(self):
        c = fixture()
        c["catalogue"]["evals"][0]["warning"] = "Review this eval"
        rr = paired([row()])
        rr[0]["metric"] = "alternate"
        for output in self.both([dict(config=c, rows=rr, operation="compare")])[0]:
            report = output["value"]
            self.assertNotIn(
                "config_caveat", {d["code"] for d in report["diagnostics"]}
            )
            d = next(
                d for d in report["diagnostics"] if d["code"] == "missing_scoring_field"
            )
            self.assertEqual(
                (d["model"], d["eval"], d["tasks"], d["effect"]),
                ("A", "E", ["e_en"], "excluded"),
            )
            self.assertEqual(
                d["measurement_ids"], [report["a"]["measurements"][0]["id"]]
            )
            self.assertIsNone(report["delta"])
        c["suite"] = dict(
            version=1,
            name="Other set",
            mode="fixed",
            evals=[dict(name="E", variants=[dict(task="e_fr")])],
        )
        for output in self.both([dict(config=c, rows=rr, operation="compare")])[0]:
            self.assertEqual(
                {d["code"] for d in output["value"]["diagnostics"]},
                {"not_used", "missing_suite_data"},
            )
        # An unused catalogue rule neither requires data nor advertises its caveat.
        c = fixture()
        c["catalogue"]["evals"].append(
            dict(
                name="Unused",
                category="Other",
                match={"name": "unused"},
                metric="acc",
                filter="none",
                score={"scale": 1},
                warning="Unused caveat",
            )
        )
        for output in self.both(
            [dict(config=c, rows=paired([row()]), operation="compare")]
        )[0]:
            self.assertFalse(output["value"]["diagnostics"])

    def test_swaps_and_permutations_preserve_allocation(self):
        c = fixture()
        rr = paired([row(), row("e_fr", ".4")])
        cases = [
            dict(config=c, rows=rr, operation="compare"),
            dict(config=c, rows=list(reversed(rr)), operation="compare"),
            dict(config=c, rows=rr, operation="compare", a="B", b="A"),
        ]
        results = self.both(cases)
        for engine in (0, 1):
            reports = [r[engine]["value"] for r in results]
            self.assertAlmostEqual(reports[0]["delta"], reports[1]["delta"])
            self.assertAlmostEqual(reports[0]["delta"], -reports[2]["delta"])
            self.close(reports[0]["a"]["tree"], reports[1]["a"]["tree"])
            self.assertEqual(
                {
                    r["id"]: r["effective_weight"]
                    for r in reports[0]["a"]["measurements"]
                },
                {
                    r["id"]: r["effective_weight"]
                    for r in reports[1]["a"]["measurements"]
                },
            )

    def test_yaml_scalar_contract(self):
        base = {k: json.dumps(v) for k, v in fixture().items()}
        cases = []
        for token in (
            "0",
            "0.0",
            "0_0",
            "0_",
            "+.0",
            "0x0",
            "0b0",
            "0o0",
            ".nan",
            ".inf",
            "!!float 0",
            "!!bool yes",
        ):
            catalogue = """version: 1
name: Scalar test
evals:
  - name: E
    category: C
    match: {name: e_en}
    metric: acc
    filter: none
    score: {scale: 1}
    normalize: {min: TOKEN, max: 1}
languages: []
""".replace("TOKEN", token)
            cases.append(dict(yaml={**base, "catalogue": catalogue}, rows=[row()]))
        self.both(cases)

    def test_regex_rejection_and_literal_escapes(self):
        cases = []
        for pattern in (
            r"e_[\s]",
            r"e_\_",
            r"e_\-",
            r"e_[]",
            r"e_[^]",
            r"e_}",
            r"e_{x}",
            r"e_(",
            r"(e)_\1",
            r"(?i)e_en",
            r"e_.++",
        ):
            c = fixture()
            c["catalogue"]["evals"][0]["match"] = {"regex": pattern}
            cases.append(dict(config=c, rows=[row()]))
        for outputs in self.both(cases):
            for result in outputs:
                self.assertIn("error", result)
        for pattern, task in [
            (r"e_\++", "e_++"),
            (r"e_[a-z]{2,3}", "e_en"),
            (r"e_\(\?", "e_(?"),
            (r"e_[\d]+", "e_12"),
        ]:
            c = fixture()
            c["catalogue"]["evals"][0]["match"] = {"regex": pattern}
            for result in self.both([dict(config=c, rows=[row(task)])])[0]:
                self.assertTrue(
                    result["value"]["models"][0]["measurements"][0]["selected"]
                )

    def test_csv_file_preserves_quoted_line_endings(self):
        import tempfile
        from quickdash import read_results

        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=row())
        writer.writeheader()
        writer.writerow(row(harness="first\r\nsecond"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "scores.csv"
            path.write_bytes(stream.getvalue().encode())
            rows = read_results(path)
            self.assertEqual(rows[0]["harness"], "first\r\nsecond")
            self.both([dict(config=fixture(), csv=stream.getvalue())])

    def test_category_names_do_not_inherit_object_properties(self):
        cases = []
        for category in ("constructor", "toString", "__proto__", "hasOwnProperty"):
            c = fixture()
            c["catalogue"]["evals"][0]["category"] = category
            c["profile"].update(
                weights={category: 1}, english_weights={}, aggregate="english_eval"
            )
            cases.append(dict(config=c, rows=paired([row()]), operation="compare"))
        for outputs in self.both(cases):
            for result in outputs:
                self.assertEqual(result["value"]["a"]["score"], 50)

    def test_non_ascii_names_and_numeric_category_order(self):
        c = fixture()
        c["catalogue"]["evals"][0]["category"] = "2"
        c["profile"]["weights"] = {"2": 0.5, "1": 0.5}
        c["catalogue"]["evals"].append(
            dict(
                name="Other",
                category="1",
                match={"name": "other"},
                metric="acc",
                filter="none",
                score={"scale": 1},
            )
        )
        rr = [
            row(checkpoint="😀"),
            row(checkpoint="\ue000"),
            row("other", checkpoint="😀"),
        ]
        self.both([dict(config=c, rows=rr)])

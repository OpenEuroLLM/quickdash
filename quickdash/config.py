"""Declarative eval matching, explicit language assignments and score normalization."""

import math
import re
from pathlib import Path
from copy import deepcopy
from .io import parse_yaml


def load_catalogue(path):
    return validate_catalogue(parse_yaml(Path(path).read_text(encoding="utf-8")))


LANGUAGE_CODE = re.compile(r"(?:[a-z]{3}_[A-Z][a-z]{3}|mul)")
DECIMAL = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def object_keys(value, allowed, required=()):
    if (
        not isinstance(value, dict)
        or any(not isinstance(k, str) for k in value)
        or set(value) - set(allowed)
        or set(required) - set(value)
    ):
        raise ValueError(
            f"Invalid config fields; allowed {sorted(allowed)}, required {sorted(required)}"
        )


def number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def validate_match(rule):
    object_keys(rule, {"name", "regex"})
    if (
        len(rule) != 1
        or not isinstance(next(iter(rule.values())), str)
        or not next(iter(rule.values()))
    ):
        raise ValueError("A match needs exactly one nonempty name or regex")
    if "regex" in rule:
        # Numeric captures use the shared Python/JavaScript regex subset.
        if "(?P" in rule["regex"] or "(?<" in rule["regex"]:
            raise ValueError("Use numeric capture groups in portable regexes")
        try:
            re.compile(portable_regex(rule["regex"]), re.ASCII)
        except re.error as error:
            raise ValueError("Invalid portable regex: " + str(error)) from error


def match_task(rule, task):
    if "name" in rule:
        return [task] if task == rule["name"] else None
    match = re.fullmatch(portable_regex(rule["regex"]), task, re.ASCII)
    return [match.group(0), *match.groups()] if match else None


def validate_config(config):
    object_keys(
        config,
        {
            "version",
            "name",
            "weights",
            "evals",
            "languages",
            "notes",
            "aggregate",
            "english_weights",
        },
        {"version", "name", "weights", "evals", "languages"},
    )
    if config["version"] != 1 or isinstance(config["version"], bool):
        raise ValueError("Unsupported config version")
    if not isinstance(config["name"], str) or not config["name"]:
        raise ValueError("Config name is required")
    validate_weights(config)
    validate_rules(config)
    if any(e["category"] not in config["weights"] for e in config["evals"]):
        raise ValueError("Eval category has no weight")
    return config


def validate_catalogue(config):
    object_keys(
        config,
        {"version", "name", "evals", "languages", "notes"},
        {"version", "name", "evals", "languages"},
    )
    return validate_rules(config)


def validate_rules(config):
    if config["version"] != 1 or isinstance(config["version"], bool):
        raise ValueError("Unsupported config version")
    if not isinstance(config["name"], str) or not config["name"].strip():
        raise ValueError("Config name is required")
    if not isinstance(config.get("notes", []), list) or any(
        not isinstance(n, str) for n in config.get("notes", [])
    ):
        raise ValueError("Notes must be strings")
    if not isinstance(config["evals"], list) or not config["evals"]:
        raise ValueError("At least one eval is required")
    names = set()
    categories = set()
    for e in config["evals"]:
        object_keys(
            e,
            {
                "name",
                "category",
                "match",
                "metric",
                "filter",
                "shots",
                "select",
                "score",
                "normalize",
                "warning",
                "aggregation",
            },
            {"name", "category", "match", "metric", "filter", "score"},
        )
        if not isinstance(e["name"], str) or not e["name"] or e["name"] in names:
            raise ValueError("Eval names must be unique and nonempty")
        names.add(e["name"])
        if not isinstance(e["category"], str) or not e["category"].strip():
            raise ValueError("Eval category must be text")
        categories.add(e["category"])
        if (
            not isinstance(e["metric"], str)
            or not e["metric"]
            or not isinstance(e["filter"], str)
        ):
            raise ValueError("Metric and filter must be strings")
        validate_match(e["match"])
        if "select" in e:
            validate_match(e["select"])
        if "shots" in e and (
            not isinstance(e["shots"], (int, float))
            or not float(e["shots"]).is_integer()
            or e["shots"] > 2**53 - 1
            or isinstance(e["shots"], bool)
            or e["shots"] < 0
        ):
            raise ValueError("shots must be a nonnegative integer")
        object_keys(e["score"], {"scale"}, {"scale"})
        if not number(e["score"]["scale"]) or e["score"]["scale"] <= 0:
            raise ValueError("Score scale must be positive")
        if "warning" in e and (
            not isinstance(e["warning"], str) or not e["warning"].strip()
        ):
            raise ValueError("Eval warning must be nonempty text")
        if "aggregation" in e:
            a = e["aggregation"]
            object_keys(a, {"components", "note", "sources"}, {"components"})
            if not isinstance(a["components"], list) or not a["components"]:
                raise ValueError("Aggregation needs components")
            names_seen = set()
            total = 0
            for c in a["components"]:
                object_keys(
                    c,
                    {"name", "match", "relative_weight"},
                    {"name", "match", "relative_weight"},
                )
                if (
                    not isinstance(c["name"], str)
                    or not c["name"].strip()
                    or c["name"] in names_seen
                ):
                    raise ValueError("Component names must be unique and nonempty")
                names_seen.add(c["name"])
                validate_match(c["match"])
                if not number(c["relative_weight"]) or c["relative_weight"] <= 0:
                    raise ValueError(
                        "Component weights must be positive finite numbers"
                    )
                total += c["relative_weight"]
            if not math.isfinite(total):
                raise ValueError("Component weight sum must be finite")
            if "note" in a and not isinstance(a["note"], str):
                raise ValueError("Aggregation note must be text")
            if "sources" in a and (
                not isinstance(a["sources"], list)
                or any(
                    not isinstance(u, str) or not re.match(r"^https?://", u)
                    for u in a["sources"]
                )
            ):
                raise ValueError("Aggregation sources must be HTTP(S) URLs")
        if "normalize" in e:
            n = e["normalize"]
            object_keys(
                n, {"min", "max", "clip", "basis", "note", "sources"}, {"min", "max"}
            )
            if (
                not number(n["min"])
                or not number(n["max"])
                or not 0 <= n["min"] < n["max"] <= 1
            ):
                raise ValueError("Normalization needs 0 <= min < max <= 1")
            if "clip" in n and not isinstance(n["clip"], bool):
                raise ValueError("Normalization clip must be boolean")
            if "basis" in n and n["basis"] not in [
                "uniform_choice",
                "uniform_integer",
                "not_applicable",
                "unresolved",
            ]:
                raise ValueError("Invalid normalization basis")
            if "note" in n and not isinstance(n["note"], str):
                raise ValueError("Normalization note must be text")
            if "sources" in n and (
                not isinstance(n["sources"], list)
                or any(
                    not isinstance(u, str) or not re.match(r"^https?://", u)
                    for u in n["sources"]
                )
            ):
                raise ValueError("Normalization sources must be HTTP(S) URLs")
    seen = set()
    if not isinstance(config["languages"], list):
        raise ValueError("languages must be a list")
    for group in config["languages"]:
        object_keys(
            group,
            {
                "tasks",
                "scope",
                "language",
                "source_language",
                "target_language",
                "evidence",
                "note",
            },
            {"tasks", "scope"},
        )
        tasks = group["tasks"]
        if (
            not isinstance(tasks, list)
            or not tasks
            or any(not isinstance(t, str) or not t for t in tasks)
        ):
            raise ValueError("Language groups need exact task names")
        for task in tasks:
            if task in seen:
                raise ValueError("Duplicate language assignment: " + task)
            seen.add(task)
        scope = group["scope"]
        if scope not in ["single", "pooled", "translation"]:
            raise ValueError("Invalid language scope")
        fields = (
            ["source_language", "target_language"]
            if scope == "translation"
            else ["language"]
        )
        forbidden = (
            ["language"]
            if scope == "translation"
            else ["source_language", "target_language"]
        )
        if any(k in group for k in forbidden):
            raise ValueError(
                "Use language for single/pooled; source and target for translation"
            )
        for field in fields:
            value = group.get(field)
            if (
                not isinstance(value, str)
                or not LANGUAGE_CODE.fullmatch(value)
                or (value == "mul" and scope != "pooled")
            ):
                raise ValueError("Use canonical language codes, such as eng_Latn")
        for field in ["note", "evidence"]:
            if field in group and not isinstance(group[field], str):
                raise ValueError(field + " must be a string")
        if group.get("evidence") and not re.match(r"^https?://", group["evidence"]):
            raise ValueError("Evidence links must use HTTP or HTTPS")
    validate_aggregation_config(config)
    return config


def normalize_score(value, e):
    if not number(value) and (
        not isinstance(value, str) or not DECIMAL.fullmatch(value.strip())
    ):
        raise ValueError("Invalid score: expected a finite decimal number")
    raw = float(value) / e["score"]["scale"]
    if not math.isfinite(raw) or not 0 <= raw <= 1:
        raise ValueError("Score outside the configured source scale")
    n = e.get("normalize", {"min": 0, "max": 1})
    adjusted = (raw - n["min"]) / (n["max"] - n["min"])
    if n.get("clip", True):
        adjusted = max(0, min(1, adjusted))
    if not math.isfinite(adjusted * 100):
        raise ValueError("Invalid score: normalization overflow")
    return raw * 100, adjusted * 100


def eval_for_task(task, config):
    matches = [(e, match_task(e["match"], task)) for e in config["evals"]]
    matches = [(e, m) for e, m in matches if m is not None]
    if len(matches) > 1:
        raise ValueError("Ambiguous eval config for task: " + task)
    return matches[0] if matches else (None, None)


def task_language(task, config):
    result = dict(
        task=task,
        language="",
        source_language="",
        target_language="",
        scope="unknown",
        status="unknown",
        evidence="",
        provenance="No explicit language assignment for this task.",
    )
    for group in config["languages"]:
        if task in group["tasks"]:
            result.update(
                {
                    k: group.get(k, "")
                    for k in [
                        "language",
                        "source_language",
                        "target_language",
                        "scope",
                        "evidence",
                    ]
                }
            )
            result.update(
                status="resolved",
                provenance=group.get(
                    "note", "Explicit language assignment in eval config."
                ),
            )
            break
    return result


def classify(rows, config):
    (validate_config if "weights" in config else validate_catalogue)(config)
    audit = []
    seen = set()
    for index, source in enumerate(rows):
        r = dict(source)
        for field in [
            "checkpoint",
            "task",
            "metric",
            "filter",
            "n_shot",
            "harness",
            "backend",
            "value",
        ]:
            if field not in r:
                raise ValueError("Missing CSV column: " + field)
        for field in ["checkpoint", "task", "metric", "harness", "backend"]:
            if not isinstance(r[field], str) or not r[field].strip():
                raise ValueError(f"CSV row {index + 2}: {field} must be nonempty text")
        if r["checkpoint"] == "SYNTHETIC demo — perturbed":
            raise ValueError("Checkpoint name is reserved for the synthetic demo")
        if not isinstance(r["filter"], str):
            raise ValueError(
                f"CSV row {index + 2}: filter must be text (blank is allowed)"
            )
        shots = (
            str(int(r["n_shot"]))
            if isinstance(r["n_shot"], float) and r["n_shot"].is_integer()
            else str(r["n_shot"])
        )
        if not re.fullmatch(r"(?:0|[1-9][0-9]*)", shots) or int(shots) > 2**53 - 1:
            raise ValueError(
                f"CSV row {index + 2}: n_shot must be a nonnegative integer"
            )
        r["n_shot"] = shots
        e, _ = eval_for_task(r["task"], config)
        if e is None:
            r.update(
                category="",
                eval="",
                selected=False,
                raw_score_100=None,
                score_100=None,
                decision="No eval config; excluded from scoring",
            )
            audit.append(r)
            continue
        decision = "Selected for the weighted score"
        if "select" in e and match_task(e["select"], r["task"]) is None:
            decision = (
                "Excluded summary level or alternate protocol; see eval selection rule"
            )
        elif r["metric"] != e["metric"]:
            decision = "Alternate metric; using " + e["metric"]
        elif r["filter"] != e["filter"]:
            decision = "Alternate extraction filter; using " + (
                e["filter"] or "(empty)"
            )
        elif "shots" in e and str(r["n_shot"]) != str(int(e["shots"])):
            decision = (
                "Alternate shot setting; using " + str(int(e["shots"])) + " shots"
            )
        selected = decision == "Selected for the weighted score"
        raw = adjusted = None
        if selected:
            if (
                "aggregation" in e
                and sum(
                    match_task(c["match"], r["task"]) is not None
                    for c in e["aggregation"]["components"]
                )
                != 1
            ):
                raise ValueError(
                    "Incompatible aggregation config for "
                    + e["name"]
                    + ": "
                    + r["task"]
                    + " must match exactly one component"
                )
            try:
                raw, adjusted = normalize_score(r["value"], e)
            except (ValueError, OverflowError) as error:
                raise ValueError(
                    f"CSV row {index + 2} · {r['checkpoint']} · {r['task']} · {r['metric']}: Invalid score: {error}"
                ) from error
            key = tuple(
                r[k]
                for k in [
                    "checkpoint",
                    "task",
                    "metric",
                    "filter",
                    "n_shot",
                    "harness",
                    "backend",
                ]
            )
            if key in seen:
                raise ValueError("Duplicate selected measurement: " + str(key))
            seen.add(key)
        r.update(
            category=e["category"],
            eval=e["name"],
            selected=selected,
            raw_score_100=raw,
            score_100=adjusted,
            decision=decision,
        )
        audit.append(r)
    return audit


def portable_regex(pattern):
    """Validate the shared regex syntax and use ECMAScript character semantics."""
    whitespace = (
        r"\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
    )
    out, inside, quantifier, i = "", False, False, 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\":
            if i + 1 == len(pattern):
                raise ValueError("Incomplete portable regex escape")
            nxt = pattern[i + 1]
            if nxt not in "dDwWsSnrt.^$*+?{}[]()|/\\-" or nxt == "-" and not inside:
                raise ValueError("Unsupported portable regex escape")
            if nxt in "sS":
                if inside:
                    raise ValueError(
                        "Use an explicit whitespace class inside character classes"
                    )
                out += "[" + ("^" if nxt == "S" else "") + whitespace + "]"
            else:
                out += c + nxt
            quantifier = False
            i += 2
            continue
        if c == "[":
            if inside or pattern[i : i + 2] == "[]" or pattern[i : i + 3] == "[^]":
                raise ValueError("Invalid portable regex character class")
            inside = True
        elif c == "]":
            if not inside:
                raise ValueError("Unmatched portable regex bracket")
            inside = False
        elif not inside:
            if (
                c == "("
                and pattern[i + 1 : i + 2] == "?"
                and pattern[i + 2 : i + 3] != ":"
            ):
                raise ValueError("Use portable regexes: no flags or lookarounds")
            if c == "{":
                match = re.match(r"\{[0-9]+(?:,[0-9]*)?\}", pattern[i:])
                if not match:
                    raise ValueError("Invalid portable regex quantifier")
                out += match[0]
                i += len(match[0])
                quantifier = True
                continue
            if c == "}" or c == "+" and quantifier:
                raise ValueError("Invalid portable regex quantifier")
        out += r"[^\r\n\u2028\u2029]" if c == "." and not inside else c
        quantifier = not inside and c in "*+?"
        i += 1
    return out


def validate_aggregation_selection(e, variants, config, unique=True):
    if "aggregation" not in e:
        return
    metadata = {task: g for g in config["languages"] for task in g["tasks"]}
    groups = {}

    def fail(detail):
        raise ValueError(
            "Incompatible aggregation config for " + e["name"] + ": " + detail
        )

    for v in variants:
        g = metadata.get(v["task"])
        if not g:
            fail(v["task"] + " needs an explicit language assignment")
        language = (
            (g["source_language"] + " → " + g["target_language"])
            if g["scope"] == "translation"
            else g["language"]
        )
        shot = v.get("n_shot", e.get("shots", "*"))
        key = (g["scope"], language, shot)
        parts = groups.setdefault(
            key, {c["name"]: [] for c in e["aggregation"]["components"]}
        )
        matches = [
            c
            for c in e["aggregation"]["components"]
            if match_task(c["match"], v["task"]) is not None
        ]
        if len(matches) != 1:
            fail(v["task"] + " must match exactly one component")
        parts[matches[0]["name"]].append(v["task"])
    for (_, language, shot), parts in groups.items():
        for name, tasks in parts.items():
            if not tasks:
                fail(f"{language} / shots {shot} is missing required component {name}")
            if unique and len(tasks) > 1:
                fail(f"{language} has multiple tasks for component {name}")


def validate_aggregation_config(config):
    known = [task for g in config["languages"] for task in g["tasks"]]
    for e in config["evals"]:
        if "aggregation" not in e:
            continue

        def eligible(task):
            return match_task(e["match"], task) is not None and (
                "select" not in e or match_task(e["select"], task) is not None
            )

        tasks = list(dict.fromkeys(t for t in known if eligible(t)))
        for c in e["aggregation"]["components"]:
            if "name" in c["match"]:
                task = c["match"]["name"]
                if not eligible(task):
                    raise ValueError(
                        "Incompatible aggregation config for "
                        + e["name"]
                        + ": component task is excluded"
                    )
                if task not in tasks:
                    tasks.append(task)
        for task in tasks:
            if (
                sum(
                    match_task(rule["match"], task) is not None
                    for rule in config["evals"]
                )
                != 1
            ):
                raise ValueError(
                    "Incompatible aggregation config for "
                    + e["name"]
                    + ": ambiguous eval rules"
                )
        validate_aggregation_selection(e, [{"task": t} for t in tasks], config, False)
    return config


def validate_suite(s):
    object_keys(
        s,
        {"version", "name", "mode", "evals", "exclude", "notes"},
        {"version", "name", "mode"},
    )
    if (
        s["version"] != 1
        or isinstance(s["version"], bool)
        or not isinstance(s["name"], str)
        or not s["name"].strip()
    ):
        raise ValueError("Suite requires version 1 and a name")
    if s["mode"] not in ("available", "fixed"):
        raise ValueError("Invalid suite mode")
    if "notes" in s and (
        not isinstance(s["notes"], list)
        or any(not isinstance(n, str) for n in s["notes"])
    ):
        raise ValueError("Notes must be strings")
    if "exclude" in s and (
        s["mode"] != "available"
        or not isinstance(s["exclude"], list)
        or any(not isinstance(n, str) or not n.strip() for n in s["exclude"])
        or len(set(s["exclude"])) != len(s["exclude"])
    ):
        raise ValueError("Invalid exclusions")
    if s["mode"] == "available":
        if "evals" in s:
            raise ValueError("Available mode does not declare required evals")
        return s
    if not isinstance(s.get("evals"), list) or not s["evals"]:
        raise ValueError("Fixed suite needs required evals")
    names = set()
    for e in s["evals"]:
        object_keys(e, {"name", "variants"}, {"name"})
        if (
            not isinstance(e["name"], str)
            or not e["name"].strip()
            or e["name"] in names
        ):
            raise ValueError("Suite eval names must be unique")
        names.add(e["name"])
        if "variants" not in e:
            continue
        if not isinstance(e["variants"], list) or not e["variants"]:
            raise ValueError("Required variants must be nonempty")
        seen = {}
        for v in e["variants"]:
            object_keys(v, {"task", "n_shot"}, {"task"})
            if not isinstance(v["task"], str) or not v["task"].strip():
                raise ValueError("Required variant needs a task name")
            shot = v.get("n_shot", "*")
            if "n_shot" in v and (
                not number(shot) or int(shot) != shot or not 0 <= shot <= 2**53 - 1
            ):
                raise ValueError("Invalid n_shot")
            shots = seen.setdefault(v["task"], set())
            if shot in shots or "*" in shots or shot == "*" and shots:
                raise ValueError("Duplicate or overlapping required variant")
            shots.add(shot)
    return s


def validate_weights(config):
    weights = config["weights"]
    if (
        not isinstance(weights, dict)
        or not weights
        or any(not k or not number(v) or v < 0 for k, v in weights.items())
        or abs(sum(weights.values()) - 1) > 1e-8
    ):
        raise ValueError("Category weights must be nonnegative and sum to 1")
    if config.get("aggregate", "standard") not in [
        "standard",
        "english_eval",
        "english_category",
    ]:
        raise ValueError(
            "Aggregate must be standard, english_eval, or english_category"
        )
    if "english_weights" in config:
        object_keys(config["english_weights"], set(weights))
        if any(
            not number(v) or v < 0 or v > 1 for v in config["english_weights"].values()
        ):
            raise ValueError("English weights must be between 0 and 1")


def validate_profile(p):
    object_keys(
        p,
        {"version", "name", "weights", "english_weights", "aggregate", "notes"},
        {"version", "name", "weights"},
    )
    if (
        p["version"] != 1
        or isinstance(p["version"], bool)
        or not isinstance(p["name"], str)
        or not p["name"].strip()
    ):
        raise ValueError("Weight profile requires version 1 and a name")
    if "notes" in p and (
        not isinstance(p["notes"], list)
        or any(not isinstance(n, str) for n in p["notes"])
    ):
        raise ValueError("Notes must be strings")
    validate_weights(p)
    return p


def resolve_config(catalogue, suite, profile):
    validate_catalogue(catalogue)
    validate_suite(suite)
    validate_profile(profile)
    evals = catalogue["evals"]
    if suite["mode"] == "fixed":
        evals = []
        for required in suite["evals"]:
            e = next(
                (e for e in catalogue["evals"] if e["name"] == required["name"]), None
            )
            if e is None:
                raise ValueError(
                    "Suite eval has no catalogue rule: " + required["name"]
                )
            for v in required.get("variants", []):
                matches = [
                    r
                    for r in catalogue["evals"]
                    if match_task(r["match"], v["task"]) is not None
                ]
                if (
                    len(matches) != 1
                    or matches[0]["name"] != e["name"]
                    or ("select" in e and match_task(e["select"], v["task"]) is None)
                    or ("shots" in e and "n_shot" in v and e["shots"] != v["n_shot"])
                ):
                    raise ValueError(
                        "Required variant is not selected by its catalogue rule: "
                        + v["task"]
                    )
            if "variants" in required:
                validate_aggregation_selection(e, required["variants"], catalogue)
            evals.append(e)
    weights = dict(profile["weights"])
    for e in evals:
        weights.setdefault(e["category"], 0)
    return validate_config(
        dict(
            version=1,
            name=catalogue["name"],
            evals=evals,
            languages=catalogue["languages"],
            weights=weights,
            english_weights=profile.get("english_weights", {}),
            aggregate=profile.get("aggregate", "standard"),
            notes=catalogue.get("notes", []) + profile.get("notes", []),
        )
    )


def in_suite(row, suite):
    if suite["mode"] == "available":
        return row["eval"] not in suite.get("exclude", [])
    e = next((e for e in suite["evals"] if e["name"] == row["eval"]), None)
    return e is not None and (
        "variants" not in e
        or any(
            v["task"] == row["task"]
            and ("n_shot" not in v or str(int(v["n_shot"])) == row["n_shot"])
            for v in e["variants"]
        )
    )


def scope_rows(rows, suite):
    selected = [r for r in rows if r["selected"]]
    included = [r for r in selected if in_suite(r, suite)]
    missing = []
    if suite["mode"] == "fixed":
        for e in suite["evals"]:
            if "variants" in e:
                for v in e["variants"]:
                    if not any(
                        r["eval"] == e["name"]
                        and r["task"] == v["task"]
                        and ("n_shot" not in v or str(int(v["n_shot"])) == r["n_shot"])
                        for r in included
                    ):
                        missing.append({"eval": e["name"], **v})
            elif not any(r["eval"] == e["name"] for r in included):
                missing.append({"eval": e["name"]})
    return dict(
        rows=included,
        extras=[r for r in selected if not in_suite(r, suite)],
        missing=missing,
    )


def load_config(*, catalogue, weights, eval_set=None):
    """Load paths or configuration mappings. No eval set means any available."""

    def load(value):
        return (
            deepcopy(value)
            if isinstance(value, dict)
            else parse_yaml(Path(value).read_text(encoding="utf-8"))
        )

    bundle = dict(
        catalogue=load(catalogue),
        profile=load(weights),
        suite=load(eval_set)
        if eval_set is not None
        else dict(version=1, name="Any available", mode="available"),
    )
    resolve_config(bundle["catalogue"], bundle["suite"], bundle["profile"])
    return bundle


def load_profile(path):
    return validate_profile(parse_yaml(Path(path).read_text(encoding="utf-8")))


def load_suite(path):
    return validate_suite(parse_yaml(Path(path).read_text(encoding="utf-8")))

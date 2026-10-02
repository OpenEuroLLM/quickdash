"""Strict CSV and YAML 1.2 Core inputs, independent of a JavaScript runtime."""

import json
import math
import re
from pathlib import Path
import yaml


class CoreLoader(yaml.SafeLoader):
    # YAML 1.2 Core does not turn yes/no into booleans or dates into objects.
    yaml_implicit_resolvers = {}
    yaml_constructors = {
        k: v
        for k, v in yaml.SafeLoader.yaml_constructors.items()
        if k is None
        or k.rsplit(":", 1)[-1] in {"str", "seq", "map", "null", "bool", "int", "float"}
    }


TAG_PATTERNS = {}


def scalar(loader, node):
    value = loader.construct_scalar(node)
    if not TAG_PATTERNS[node.tag].fullmatch(value):
        raise ValueError("Invalid YAML scalar: " + value)
    if node.tag.endswith(":null"):
        return None
    if node.tag.endswith(":bool"):
        return value.lower() == "true"
    cleaned = value.replace("_", "")
    sign = -1 if cleaned.startswith("-") else 1
    unsigned = cleaned.lstrip("+-")
    if node.tag.endswith(":int"):
        return sign * int(
            unsigned, 0 if unsigned.startswith(("0x", "0o", "0b")) else 10
        )
    if unsigned.lower() in (".inf", ".nan"):
        return sign * (math.inf if unsigned.lower() == ".inf" else math.nan)
    return float(cleaned)


for kind, pattern, chars in [
    ("null", r"^(?:~|null|Null|NULL|)$", ["~", "n", "N", ""]),
    ("bool", r"^(?:true|True|TRUE|false|False|FALSE)$", list("tTfF")),
    (
        "int",
        r"^(?!.*_$)[+-]?(?:0b[01_]*[01]|0o[0-7_]*[0-7]|0x[0-9a-fA-F_]*[0-9a-fA-F]|[0-9][0-9_]*)$",
        list("-+0123456789"),
    ),
    (
        "float",
        r"^(?!.*_$)(?:[-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$",
        list("-+0123456789."),
    ),
]:
    tag = "tag:yaml.org,2002:" + kind
    TAG_PATTERNS[tag] = re.compile(pattern)
    CoreLoader.add_implicit_resolver(tag, TAG_PATTERNS[tag], chars)
    CoreLoader.add_constructor(tag, scalar)


def mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        if not isinstance(key_node, yaml.ScalarNode):
            raise ValueError("YAML mapping keys must be strings")
        parsed = loader.construct_object(key_node)
        key = (
            "null"
            if parsed is None
            else str(parsed).lower()
            if isinstance(parsed, bool)
            else str(int(parsed))
            if isinstance(parsed, (int, float))
            and math.isfinite(parsed)
            and int(parsed) == parsed
            else str(parsed)
        )
        if key in result:
            raise ValueError("Duplicate YAML key: " + key)
        result[key] = loader.construct_object(value_node)
    return result


CoreLoader.add_constructor("tag:yaml.org,2002:map", mapping)


def parse_yaml(source):
    try:
        result = yaml.load(source, Loader=CoreLoader)
        # Configs must be finite trees; reject recursive aliases before validation.
        json.dumps(result, check_circular=True)
        return result
    except (yaml.YAMLError, TypeError, RecursionError) as error:
        raise ValueError("Invalid YAML: " + str(error)) from error


def parse_csv(source):
    """Parse the browser's strict CSV dialect; preserve source strings verbatim."""
    source = source[1:] if source.startswith("\ufeff") else source
    records, row, value = [], [], ""
    state, touched, i = "start", False, 0

    def record():
        nonlocal row, value, state, touched
        if touched or row or value:
            records.append(row + [value])
        row, value, state, touched = [], "", "start", False

    while i < len(source):
        c = source[i]
        if state == "quoted":
            if c == '"':
                if i + 1 < len(source) and source[i + 1] == '"':
                    value += '"'
                    i += 1
                else:
                    state = "closed"
            else:
                value += c
        elif c == ",":
            row.append(value)
            value, state, touched = "", "start", True
        elif c in "\r\n":
            record()
            if c == "\r" and i + 1 < len(source) and source[i + 1] == "\n":
                i += 1
        elif c == '"' and state == "start":
            state, touched = "quoted", True
        elif c == '"' or state == "closed":
            raise ValueError("Malformed CSV quote")
        else:
            state, value, touched = "plain", value + c, True
        i += 1
    if state == "quoted":
        raise ValueError("Unclosed quoted field in CSV")
    record()
    if not records:
        raise ValueError("Empty CSV")
    header, *records = records
    if any(not h.strip() for h in header) or len(set(header)) != len(header):
        raise ValueError("CSV headers must be nonempty and unique")
    if not records:
        raise ValueError("No measurements in CSV")
    for index, row in enumerate(records, 2):
        if len(row) != len(header):
            raise ValueError(f"CSV row {index} width mismatch")
        if all(not v.strip() for v in row):
            raise ValueError(f"Empty CSV row {index}")
    return [dict(zip(header, row)) for row in records]


def load_csv(path):
    with Path(path).open(encoding="utf-8", newline="") as stream:
        return parse_csv(stream.read())

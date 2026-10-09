"""Read stable schema/example labels without depending on prose or heading order."""

from pathlib import Path
import re

from quickdash.io import parse_yaml
from quickdash.config import load_catalogue

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "docs/configuration.md"


def examples(source=None):
    source = REFERENCE.read_text() if source is None else source
    entries = re.findall(
        r"<!--\s*config-example:\s*([\w-]+)\s*-->\s*```yaml\s*\n(.*?)\n```",
        source, re.S,
    )
    if len(entries) != len(re.findall(r"(?m)^```yaml\s*$", source)):
        raise AssertionError("Every YAML example needs a config-example label")
    result = {name: parse_yaml(body) for name, body in entries}
    if len(result) != len(entries):
        raise AssertionError("Duplicate config-example label")
    return result


def schemas(source=None):
    source = REFERENCE.read_text() if source is None else source
    result = {}
    for name, table in re.findall(
        r"<!--\s*config-schema:\s*([\w-]+)\s*-->\s*((?:\|[^\n]*\n)+)", source
    ):
        if name in result:
            raise AssertionError("Duplicate config-schema label: " + name)
        fields = {}
        for row in table.splitlines():
            match = re.match(r"\|\s*`(\w+)`\s*\|\s*([^|]+)\|", row)
            if match:
                key, requirement = match.groups()
                if key in fields:
                    raise AssertionError("Duplicate documented field: " + name + "." + key)
                fields[key] = requirement.strip()
        if not fields:
            raise AssertionError("Missing field table for " + name)
        result[name] = fields
    return result


def engine_cases():
    """Exercise every scoring example in its documented catalogue context."""
    docs = examples()
    production = load_catalogue(ROOT / "configs/catalogue.yaml")
    available = dict(version=1, name="Documentation checks", mode="available")
    base = dict(catalogue=docs["catalogue"], profile=docs["profile"], suite=available)
    metadata = {k: v for k, v in docs["manifest"].items() if k != "evals_dir"}
    cases = {}
    for name, example in docs.items():
        config = dict(base)
        case = dict(config=config, rows=[])
        if name.startswith("set-"):
            config.update(catalogue=docs["catalogue"] if name == "set-pinned" else production,
                          suite=example)
        elif name in {"catalogue", "profile"}:
            config[name] = example
        elif name in {"manifest", "eval", "language-defaults", "translation", "components"}:
            definition = dict(docs["eval"])
            if name == "language-defaults":
                definition.update(example)
            elif name == "translation":
                definition.update(match=dict(name=example["tasks"][0]), languages=[example])
            elif name == "components":
                definition = parse_yaml((ROOT / "configs/evals/polymath.yaml").read_text())
                definition.update(example)
            config["catalogue"] = metadata
            case["eval_definitions"] = [definition]
        elif name == "startup":
            continue  # Builder-only format; covered in test_config_docs.
        else:
            raise AssertionError("Add a validation context for config-example: " + name)
        cases[name] = case
    return cases

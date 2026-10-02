"""Render calculated trees or JSON; warnings always go to stderr."""

import argparse
import json
import sys
from . import analyze, compare, load_config, read_results


def render_tree(node, prefix="", last=True, root=True):
    score = "unavailable" if node["score"] is None else f"{node['score']:.3f}"
    branch = "" if root else "└── " if last else "├── "
    yield f"{prefix}{branch}{node['label']} = {score} (weight {node['weight']:.2%}; contribution {node['contribution']:.3f})"
    children = node["children"]
    for i, child in enumerate(children):
        yield from render_tree(
            child,
            prefix + ("" if root else "    " if last else "│   "),
            i == len(children) - 1,
            False,
        )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Calculate Quickdash scores and explain their weighted contributions. Scores use a 0–100 scale."
    )
    parser.add_argument(
        "csv",
        nargs="+",
        help="Result CSV files (model labels must be unique across files)",
    )
    parser.add_argument(
        "--catalogue", required=True, help="Catalogue YAML or manifest pointing to per-eval files"
    )
    parser.add_argument("--weights", required=True, help="Weighting profile YAML")
    parser.add_argument(
        "--eval-set", help="Optional named eval set; otherwise compare any available"
    )
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("A", "B"),
        help="Model names to compare on shared coverage",
    )
    parser.add_argument("--format", choices=["tree", "json"], default="tree")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Emit diagnostics and exit unsuccessfully without a result if any warning occurs",
    )
    args = parser.parse_args(argv)
    try:
        config = load_config(
            catalogue=args.catalogue, weights=args.weights, eval_set=args.eval_set
        )
        rows = read_results(args.csv)
        report = (
            compare(
                rows,
                config,
                a=args.compare[0],
                b=args.compare[1],
                diagnostics="collect",
            )
            if args.compare
            else analyze(rows, config, diagnostics="collect")
        )
        for d in report.diagnostics:
            print(
                f"warning [{d['code']}] {d['model']} / {d['name']}: {d['detail']}"
                + (f" Tasks: {', '.join(d['tasks'])}" if d["tasks"] else ""),
                file=sys.stderr,
            )
        if args.strict and report.diagnostics:
            return 1
        if args.format == "json":
            print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
        else:
            for model in [report["a"], report["b"]] if args.compare else report.models:
                print("\n".join(render_tree(model["tree"])))
            if args.compare:
                print(
                    "A − B: "
                    + ("unavailable" if report.delta is None else f"{report.delta:.3f}")
                )
        return 0
    except (ValueError, OSError) as error:
        print("error: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

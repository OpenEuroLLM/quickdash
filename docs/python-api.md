# Calculate and explain evaluation scores in Python

Use the Python library when you want to analyze CSV exports in a notebook, render a score tree, or automate a comparison. It uses the same inputs and scoring rules as the dashboard. No browser, Node.js, pandas, or network access is needed at runtime.

## Install and calculate a score

From a checkout of Quickdash, create an environment and install the package:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

The package requires Python 3.8+ and PyYAML 6. The installable distribution is called `oellm-quickdash`; import it as `quickdash`. Node.js is needed only for development tests that exercise the JavaScript implementation.

Start with the fictional example included in the repository:

```python
from quickdash import analyze, compare, load_config, read_results

config = load_config(
    catalogue="configs/examples/catalogue.yaml",
    weights="configs/examples/weights.yaml",
    eval_set="configs/sets/any-available.yaml",
)
results = read_results("examples/scores.csv")
report = analyze(results, config)

for model in report.models:
    print(model["model"], model["score"])
    tree = model["tree"]  # Calculated nodes; rendering requires no scoring logic.

comparison = compare(results, config, a="Example A", b="Example B")
print(comparison.delta)  # -2.5 score points
```

`load_config()` accepts paths or configuration dictionaries, validates their combination, and returns a bundle containing `catalogue`, `profile`, and `suite`. It copies supplied dictionaries. Change configurations by loading a new bundle. The analysis functions do not mutate results or configuration inputs.

Omitting `eval_set` means all recognized evals are eligible. To apply the project's explicit exclusions, pass its `configs/sets/any-available.yaml` file, as above. No eval names, language lists, category counts, or component counts are hardcoded into the library.

`read_results()` accepts a path or a list of paths. It preserves CSV fields as strings and rejects model names repeated across files. Put all measurements for a model in one CSV, or deliberately combine row dictionaries before analysis. The analysis functions also accept lists of row dictionaries directly, with the same required fields and validation as CSV imports.

## Independent scores and fair comparisons

`analyze(results, config)` scores each model independently on its available, selected measurements. Its top-level fields are `models`, `diagnostics`, and `coverage`.

`compare(results, config, a=..., b=...)` first restricts both models to matching valid measurements. It excludes incomplete component groups, including groups made incomplete by intersecting coverage, before redistributing weights. Its fields are `a`, `b`, `delta`, `deltas`, `diagnostics`, and `coverage`. `a` and `b` have the same model-result shape used by `analyze()`.

Do not subtract independent scores to reproduce an A/B comparison: the models may have different coverage. A missing comparison model raises `ValueError`; comparing a model with itself is permitted.

Both operations support original averaging, English balance per eval, and English balance per category, selected by the weighting profile. The [scoring reference](configuration.md#choosing-an-aggregate) describes their differences. Scores and contributions use score points on a **0–100 scale**; weights are fractions. Explicit `clip: false` configurations can produce normalized scores outside 0–100.

## Render the calculated tree

Each model result has `model`, `score`, `tree`, and `measurements`. Traverse `tree.children` recursively using dictionary access. Each node contains:

| Field | Meaning |
| --- | --- |
| `id`, `kind`, `label` | Stable identity within the model's tree, node kind, and display label. |
| `score` | Calculated score, or `null` when unavailable. |
| `weight` | Effective weight relative to the parent. |
| `effective_weight` | Share of the final model score. |
| `contribution` | Contribution in final score points. |
| `relative_weight` | Configured component weight, otherwise `null`. |
| `measurement_id` | Source measurement identity for a leaf, otherwise `null`. |
| `children` | Child nodes in calculation order. |

The tree follows the actual aggregation: English groups appear within evals or within categories according to the chosen mode. Component evals include language and protocol groups before component leaves. Translation groups use source/target pairs once; they are not duplicated into both language directions as in the dashboard's descriptive language view.

Child contributions sum to the parent's contribution. For nodes with positive effective weight, child weights sum to one and reproduce the parent score. Zero-weight branches contribute zero; their internal aggregate score can be unavailable even though individual leaf measurements retain scores. An unavailable overall score is `null`, never a manufactured zero.

`measurements` retains every input row, including alternate metrics and excluded data. Added fields include `id`, `language`, `included`, `exclusion`, `effective_weight`, and `contribution`, alongside interpretation fields such as `raw_score_100`, `score_100`, and `decision`. `exclusion` is `interpretation`, `eval_set`, `coverage`, or `null`; diagnostics explain coverage failures. Measurement IDs encode the model, task, metric, filter, shots, harness, and backend. Treat IDs as opaque strings.

`comparison.deltas` contains raw and normalized differences, effective weights, and contribution differences linked to both source measurement IDs. These contribution differences sum to the overall delta. Inspection filters should filter the returned rows without recalculating their weights.

Reports are dictionaries with attribute access for top-level fields. Nested records are ordinary dictionaries and lists. Use `json.dumps(report, allow_nan=False)` to serialize one; no custom encoder is needed. Renderers can format or reorder nodes without reconstructing the calculation.

## Load the repository’s per-eval files

Use the same manifest as the dashboard build:

```python
config = load_config(
    catalogue="configs/catalogue.yaml",
    weights="configs/weights/oellm.yaml",
    eval_set="configs/sets/any-available.yaml",
)
```

The loader reads each eval file from the manifest’s `evals_dir`, resolves relative
paths beside that manifest, and validates the combined catalogue. Each eval file
contains its own language assignments. The returned `config["catalogue"]` is a
complete in-memory catalogue, so later analysis does not access those files.
Existing single-file catalogues remain supported. When passing a dictionary
instead of a filename, supply the complete catalogue; a filesystem manifest needs
a filename to resolve its directory. See [editing an eval](configuration.md#edit-one-eval).

## Surface warnings

By default, `analyze()` and `compare()` emit a `QuickdashWarning` through Python's standard `warnings` mechanism for each grouped diagnostic. Warnings normally appear on stderr. Each warning object has a `.diagnostic` attribute containing its structured record. The same diagnostics are retained in `report.diagnostics`, separately from the tree.

Applications that display diagnostics themselves can explicitly collect them:

```python
report = analyze(results, config, diagnostics="collect")
for diagnostic in report.diagnostics:
    print(diagnostic["code"], diagnostic["model"], diagnostic["tasks"])
```

For strict automation, use `diagnostics="error"`. If any diagnostic occurs, it raises `DiagnosticError`, whose `.diagnostics` contains all warnings; it returns no report. Invalid configurations, ambiguous selected matches, duplicate selected measurements, and invalid selected scores raise `ValueError` regardless of diagnostic policy. File access failures raise the usual `OSError` subclasses.

The diagnostic contract is `code`, `model`, `eval`, `tasks`, `measurement_ids`, and `effect`. `effect` describes the warning's policy (`excluded`, `included`, or `zero_weight`); the measurement's `included` field is authoritative when several conditions apply. Config-wide caveats have no individual measurement IDs. `type`, `name`, `detail`, and `variants` support dashboard presentation and are not wording contracts.

| Codes | Condition and action |
| --- | --- |
| `config_caveat` | An included eval has a configured warning. |
| `no_config`, `not_used` | Unknown eval or data outside the selected set; excluded. |
| `missing_scoring_field`, `missing_scoring_setting`, `no_selected_score` | Required metric/protocol unavailable; no alternate substitution. |
| `missing_suite_data` | A named set has missing requirements; available shared results are reweighted. |
| `incomplete_components` | A language/protocol group is incomplete or incompatible; the whole group is excluded. |
| `comparison_coverage` | Measurements cannot participate in shared coverage; excluded from both scores. |
| `unknown_language` | Ordinary evals use the English weighting fallback; component groups require explicit language assignments. |
| `inconsistent_scoring_settings` | Selected variants use different protocols; ordinary results or complete component groups remain eligible. |
| `invalid_sample_count`, `sample_count_mismatch` | Sample-count metadata needs review; it does not determine weights. |
| `no_category_weight` | An included category has no profile weight and contributes zero. |

Unused catalogue entries do not warn merely because no data exists for them. Declare an expected eval set when absence should warn. Alternate metrics remain auditable without creating warnings when the selected metric is present.

## Command line

Print calculated trees for the fictional models:

```sh
quickdash examples/scores.csv \
  --catalogue configs/examples/catalogue.yaml \
  --weights configs/examples/weights.yaml \
  --eval-set configs/sets/any-available.yaml
```

Add `--compare 'Example A' 'Example B'` for shared-coverage scores, or `--format json` for the complete machine-readable report. `python -m quickdash` provides the same command. Warnings go to stderr; stdout contains only the selected result format.

Exit status is 0 for a successful calculation, including recoverable warnings. `--strict` prints warnings and exits 1 without writing a result. Invalid input exits 2. A score can be unavailable when no valid weighted data remains; inspect diagnostics and coverage or use strict mode when warnings must block a workflow.

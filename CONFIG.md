# Eval config reference

Edit `eval-config.yaml`, then load it in **Eval configuration → Load config**, or rebuild with `python3 build.py DATA.csv --config CONFIG.yaml`. Browser imports apply to every loaded real model and regenerate the synthetic comparison. If validation fails, the active config and scores remain unchanged. **Export config YAML** includes current category weights, English shares, and the selected aggregate; use that exported file when building to persist the choices.

## Complete small example

This config selects `acc_norm` for two explicit language variants of a four-choice eval. Additional categories and evals follow the same structure.

```yaml
version: 1
name: Example scoring
weights:
  Reasoning: 1.0

evals:
  - name: Example eval
    category: Reasoning
    match: {regex: 'example_(en|fr)'}
    metric: acc_norm
    filter: none
    shots: 0
    score: {scale: 1}
    normalize:
      min: 0.25  # Four choices: uniform guessing gets 1/4 correct.
      max: 1
      clip: true
      basis: uniform_choice
      note: Four-choice chance correction is enabled for this example.

languages:
  - tasks: [example_en]
    scope: single
    language: eng_Latn
  - tasks: [example_fr]
    scope: single
    language: fra_Latn

```

For an input row with `value=0.625`, the raw score is 62.5 and the normalized score is 50. Raw comparisons show the former; the composite uses the latter. A row using `acc` is retained in the configuration audit but excluded because this config selects `acc_norm`. The UI shows the original source value for every metric, including excluded metrics; the scaled and normalized columns apply to selected scores. Eval summaries label the selected metric and shot counts actually used, then list other available metrics and settings. Expanded selection rules explain blank extraction-filter fields and unrestricted shot counts separately from the data currently selected. A shot is one example in the prompt; 0-shot means no examples. Tasks eligible under `select` that lack the configured metric/filter/shot combination are highlighted and listed in Warnings for each affected model, even when other tasks in the eval have selected scores.

## Eval fields

| Field | Meaning |
|---|---|
| `name` | Unique display name of the eval, grouping its variants. |
| `category` | A key in `weights`. Every weighted category must have at least one eval. |
| `match` | Exactly one of `{name: exact task name}` or `{regex: 'full-match pattern'}`. Unmatched tasks are excluded and listed in Warnings; overlapping matches are an error. |
| `metric` | Exact CSV scoring field, such as `acc`, `acc_norm`, or `python_pass@1`. |
| `filter` | Exact CSV filter string, including `""` if empty. |
| `shots` | Optional nonnegative integer selecting the CSV `n_shot`. Omit to include all shot settings. |
| `select` | Optional name/regex rule restricting which matched tasks contribute. Useful for selecting summaries while retaining child-task audits. |
| `score.scale` | Raw metric's upper scale: 1 for fractional accuracy; 100 for percentage or chrF scores. Selected values must be finite and within 0..scale. |
| `warning` | Optional nonempty text describing an unresolved scoring assumption. Appears once for all models in Warnings and in this eval’s configuration details; it does not change scores. |
| `normalize` | Optional object with `min`, `max`, and optional `clip`, `basis`, `note`, and `sources`. Thresholds are fractions after division by `score.scale`. |

Use the common Python/JavaScript regex subset: literal text, character classes, alternatives, groups, and ordinary quantifiers. Patterns match the entire task name. Named groups and lookbehind are rejected. Language extraction does not use these patterns.

The supplied OELLM config gives Code, Math, Reasoning, Knowledge, Commonsense, and Reading a weight of 0.15 each; Translation, Language, and Instruction following each receive 0.1/3. Category weights must be nonnegative and sum to 1. Names, metrics, and task strings are case-sensitive. Unknown config fields are rejected to catch typos. `version` must be 1; `name` labels the active config. Optional top-level `notes` is a list of strings.

## Normalization and contributions

For metric value `v`, scale `s`, and normalization bounds `lo`, `hi`:

```text
raw_fraction = v / s
raw_score = 100 × raw_fraction
normalized_score = 100 × clamp((raw_fraction − lo) / (hi − lo), 0, 1)
```

`0 ≤ lo < hi ≤ 1` is required. Omitting normalization gives `lo=0`, `hi=1`. `clip` defaults to true; setting it false allows normalized scores below 0 or above 100. All metrics are treated as higher-is-better.

Under the original aggregate, one variant's weighted contribution is its normalized score multiplied by the effective category weight, divided by the number of available evals in that category and by the number of shared selected variants for that eval. Filtering does not change those denominators. Weighted A−B contributions sum to the composite difference over shared coverage. The English-balance modes redistribute contributions as described in [Choosing an aggregate](#choosing-an-aggregate).

## Initial chance baselines

The supplied config applies the following baselines. Per-eval `normalize.sources` links to the benchmark definitions or evaluator code; `normalize.note` explains the choice. The UI shows a single score formula using `random_score`, defines that eval’s random score below it, and puts rationale/source links in an expandable section. `random_score` corresponds to `normalize.min`; zero means no chance correction is applied, not measured zero performance from a random model. The formula substitutes the source scale directly and omits division by 1.

| Baseline | Evals |
|---|---|
| 1/2 | COPA, PIQA, WSC273, WinoGrande, XCOPA, BoolQ, MultiBlimp |
| 1/3 | Social IQa |
| 1/4 | GPQA Diamond, INCLUDE, MMLU, Global MMLU, OpenBookQA, HellaSwag, Belebele |
| 1/5 | LSAT AR, CommonsenseQA, X-CSQA |
| 1/7 | SIB-200: seven topic labels |
| 1/11 | Language ID: 11 candidate names per question, despite 1,000 languages in the corpus |
| 0 | AIME24 and AIME25: no chance correction |
| ≈1/4 | ARC Challenge: initial approximation, including translated variants |
| ≈0.2501613 | ARC Easy: average 1/choice_count across the published 2,376-question test split |

These baselines model uniform *valid* guesses, not a random language model or a majority-class predictor. AIME24 and AIME25 use a zero floor without a uniform-integer guessing correction. ARC Easy assumes the full published test split, whose size matches this export. Sources describe task definitions, but the CSV does not pin the exact run's dataset revision.

ARC Challenge uses an approximate 25% baseline. In its published test split, 1,165 of 1,172 questions have four options, four have three, and three have five, giving an exact mean of about 25.0156%. The approximation is also applied to translated variants, whose individual choice counts have not all been audited. JEEBench remains unresolved and uncorrected because it mixes single-choice, multiple-answer, integer, and numeric questions. AMC23 is open-ended in the selected evaluator: the original contest's answer options are removed. Code generation, translation chrF, overlap F1, and other open-ended exact-match tasks do not receive an invented chance baseline.

`normalize.basis` may be `uniform_choice`, `uniform_integer`, `not_applicable`, or `unresolved`. It documents the rationale; `min`, `max`, and `clip` control the actual calculation. Optional `sources` is a list of HTTP(S) URLs, and `note` is free text. Set `min: 0` and `max: 1` to disable correction. An optional eval-level `warning` string appears in the Warnings tab once for all models and in the eval configuration details. Remove it when the concern is resolved; it does not change selection or arithmetic. The supplied config uses it for translation calibration and the SIB-200 metric exception. Exported YAML preserves config values and notes; YAML comments are not retained.

`acc_norm` in lm-eval refers to choosing answers using length-normalized likelihoods; it does **not** remove chance accuracy. Chance correction here is applied to each selected variant's aggregate score before averaging evals. Clipping after aggregation is not equivalent to clipping individual items, and a mixture of corrected and uncorrected metrics is still a provisional composite.

## Explicit language assignments

Each group lists exact CSV task names. Several names may share one assignment:

```yaml
tasks: [example_english, example_en, example_eng_Latn]
scope: single
language: eng_Latn
evidence: https://example.org/benchmark-definition
note: The benchmark definition identifies all three subsets as English.

```

The URL above is illustrative; the supplied config contains actual benchmark source links. `evidence` and `note` are optional. Evidence links must use HTTP or HTTPS. Duplicate task assignments are rejected. Unlisted task names remain Unknown, even if they look like language codes.

Use `scope: pooled` for scores combining languages that cannot be separated, for example `language: mul`. The supplied MultiBLiMP `multiblimp_hbs` assignment instead uses `scope: single` and `language: srp_Latn` as an explicit grouping approximation: Serbian has more speakers than Croatian. Its eval-level `warning` and language-assignment `note` record that the score pools both languages; no data separation or Serbian-only measurement is implied. Identifiers otherwise follow `xxx_Ssss` form, such as `fra_Latn` or `srp_Cyrl`. Normalized identifiers are written directly; short aliases and spelled-out names are not interpreted at runtime. The [catalogue snapshot](languages.txt) records the source inventory used to prepare the explicit assignments; the dashboard does not load it at runtime.

Translation requires both endpoints and no single `language` field:

```yaml
tasks: ['flores200:eng_Latn-spa_Latn']
scope: translation
source_language: eng_Latn
target_language: spa_Latn

```

This result appears in:

- Category first: `Translation → FLORES200 → eng_Latn → From eng_Latn → eng_Latn → spa_Latn`.
- Language first: `eng_Latn → Translation → FLORES200 → From eng_Latn → eng_Latn → spa_Latn`.
- Corresponding `spa_Latn → To spa_Latn` branches.

The Languages page supports ascending/descending sorting by language label, variant count, Raw A, Raw B, and A − B. Sorting reorders siblings at every level, including translation directions and pairs, while retaining each node’s descendants and aggregates. Expanded sections and scroll position are preserved when sorting; filters and model changes retain the selected sort.

The final `eng_Latn → spa_Latn` is a single pair label. Each pair expands into its exact task/protocol rows. Repeated endpoint branches never duplicate a measurement in a parent aggregate or in the weighted score. The `Language role` filter selects ordinary evals, translation into, or translation from the chosen language.

## Scoring choices and consistency warnings

The supplied config prefers `acc_norm` over `acc` when both exist for the selected protocol. The metric remains explicit in `metric`; missing fields never silently fall back to another metric. SIB-200 is an explicit exception using `acc`: 34 of its 36 exported `acc_norm` values are exactly 0.25, so an eval-level `warning` requests investigation before changing that choice. Length-normalized option scoring and chance normalization are separate operations.

For each real model, the dashboard compares the sets of selected settings per task within each eval: `n_shot`, `metric`, `filter`, `harness`, and `backend`. Different sets generate one warning naming the settings, with expandable lists of affected tasks and their explicit language assignments (source → target for translation). Identical sets across tasks are consistent even if each task has multiple settings. Excluded alternate metrics, summary children, and protocols do not trigger this check. The current data has mismatches for MGSM (0/5 shots), ARC Challenge (0/10), and PIQA (0/10). These warnings do not exclude scores; use the YAML selection rules to choose comparable protocols after reviewing coverage. Fields absent from the CSV, such as prompt templates or dataset revisions, cannot be compared.

Both translation evals use chrF, which is bounded by 0 and 100 in [SacreBLEU](https://github.com/mjpost/sacrebleu/blob/master/sacrebleu/metrics/chrf.py). `score.scale: 100` and `normalize: {min: 0, max: 1}` preserve native chrF points. The open question is calibration against accuracy metrics and between language pairs, including a meaningful chance floor; a shared numerical range does not settle those questions. Each translation config carries an editable `warning` while this remains unresolved. The composite continues to include translation at the configured weight.

MMLU and Global MMLU have separate eval configs and aggregates. MMLU selects only `mmlu`; Global MMLU selects `global_mmlu_full_[a-z]+` language summaries. Subject-level rows stay available for inspection but are excluded from both composites. Both evals retain the four-choice 25% floor and each gets one equal share of Knowledge.

## Choosing an aggregate

The prominent **Score calculation** panel offers three modes:

| Config value | UI choice | Calculation |
|---|---|---|
| `standard` | Original weighted score | Average variants within each eval, then evals equally within the category. |
| `english_eval` | English balance per eval | Combine English and other-language means within each eval, then average the eval scores equally. |
| `english_category` | English balance per category | On each language side, average variants within evals and then represented evals equally; combine the two category means. |

All modes apply the configured category weights last. The selector affects both model score cards, category/eval contributions, effective weights, and weighted delta bars. Raw comparison columns and descriptive language/category breakdowns retain their meanings.

Optional top-level YAML fields persist the choice and shares:

```yaml
aggregate: english_eval
english_weights:
  Code: 0.5
  Math: 0.5
  Reasoning: 0.5
  Knowledge: 0.5
  Commonsense: 0.5
  Reading: 0.5
  Translation: 0.5
  Language: 0.5
  Instruction following: 0.5
```

The weight editor has one category per row. **English share applies only when either English-balance mode is selected at the top.** Switching modes preserves the stored shares; they are inactive under Original. Keys must be configured categories and values must be numbers from 0 to 1. Omitted categories default to 0. Zero disables the split for that category and retains its original calculation. Positive shares apply inside every eval in that category under `english_eval`, or to the category mean under `english_category`. Shares do not sum to 1 across categories; outer category weights still do.

A share of 0.5 gives English half and other languages half collectively wherever both language groups exist. When an eval (per-eval mode) or category (per-category mode) contains only one language side, that side automatically retains the full weight regardless of its configured positive share. Code and Instruction following can therefore use 0.5 without requiring the user to know their language coverage. No scores means exclusion, not an invented score.

Language groups use explicit assignments: `eng_Latn` is English; other `single` assignments are non-English. Translation uses **target language**: into English counts as English, out of English to another language counts as non-English. Known non-English assignments, including pooled codes and the Croatian/Serbian score assigned to `srp_Latn`, count as other languages. Unknown assignments and mixed-language pools (`mul`, including Language ID) count as English **for weighting only**. This is a scoring convention, not an inferred language assignment: language views and labels retain Unknown or the pooled identifier. The configuration tab explains the convention and each variant’s scoring details show its weighting group. All supplied categories, including Language, default to share 0.5. Non-English languages share their portion collectively; neither mode adds an equal-per-language averaging layer.

### Why the two English-balance modes differ

Suppose one eval has English score 80 and non-English variants scoring 20 and 40, while a second eval is English-only and scores 100. At an English share of 0.5:

- **Per eval:** the first eval scores `0.5 × 80 + 0.5 × 30 = 55`; the English-only eval keeps 100. Their equally weighted category score is `(55 + 100) / 2 = 77.5`.
- **Per category:** the English mean is `(80 + 100) / 2 = 90`, and the other-language mean is 30. The category score is `0.5 × 90 + 0.5 × 30 = 60`.

Per-eval balancing preserves equal eval weights, but does not guarantee English is exactly half of a category containing English-only evals. Per-category balancing guarantees the configured category language split where both groups exist, but changes effective eval weights: the multilingual eval gets 75% in the example, and the English-only eval 25%. In this data, MGSM supplies all non-English Math scores and PolyMath supplies all non-English Reasoning scores, so category-level balancing gives those subsets substantial weight.

**Inside a category** shows effective eval weights. The expandable **English / other-language components** table displays eval components for `english_eval` and category components for `english_category`. Weighted delta coefficients use shared comparison coverage and remain fixed when inspection filters are applied, so filtered contributions still add up to the corresponding part of the full difference.

`analysis.json` includes all three modes under `aggregates`; its `models` and score CSVs use the config's selected mode. The build reports available data per model, while the interactive comparison uses the models' shared measurements.

## Missing comparison data

Model comparisons use the intersection of selected measurements, matching task, metric, extraction filter, shot count, harness, and backend. A measurement present only in A or only in B is excluded from **both** score calculations and listed in a comparison-coverage warning. If no measurements remain for an eval, that eval is excluded from both scores and the remaining evals share its category weight equally. An empty category is excluded and remaining category weights are rescaled proportionally to sum to 1. No shared scores leaves the composite unavailable. Config coverage warnings remain visible for every loaded model.


The weights table shows effective weights after exclusions; the editor preserves the configured weights. Configured-but-missing evals and unconfigured tasks remain visible in Warnings. The build's model summaries are per-model summaries of available data; the interactive dashboard applies the common comparison coverage when two models are selected.

## Data validation and failure behavior

Builds and browser imports use the same CSV parser. Required columns are `checkpoint`, `task`, `metric`, `filter`, `n_shot`, `harness`, `backend`, and `value`. Identity fields must contain nonempty text; `filter` may be blank. `n_shot` must be a nonnegative integer written as digits (`0`, `5`, etc.). CSV supports UTF-8, an optional BOM, LF/CRLF line endings, and quoted commas, doubled quotes, and embedded newlines. Empty lines are ignored; empty records, duplicate or blank headers, and malformed records are rejected.

| Issue | Behavior |
| --- | --- |
| Empty CSV, missing columns, invalid identity fields, malformed quotes, inconsistent row widths | Reject the file with an error. |
| Invalid YAML/schema, ambiguous eval matches, duplicate selected measurements within a model | Reject the config or file; never silently pick a rule or duplicate. |
| Selected score is blank, nonnumeric, nonfinite, or outside `0..score.scale` | Reject with CSV row, model, task, and metric in the error. Decimal and scientific notation are accepted; booleans and hexadecimal values are not scores. |
| New model uses an already loaded checkpoint name or the reserved synthetic-demo name | Reject the import. Give the model a distinct checkpoint label. |
| Task has no eval config, or lacks the configured metric/filter/shots | Warn and exclude from scoring. Alternate metrics remain inspectable and never silently substitute for the configured metric. |
| Eval is absent, or measurements match only one of the compared models | Warn; use only shared measurements and redistribute weights as described above. |
| Selected task has no explicit language assignment | Warn and retain the score. Language views show Unknown; English-balance modes use the English fallback. Known mixed-language pools use the documented fallback without claiming a resolved single language. |
| Selected variants use inconsistent scoring settings | Warn and retain scores so the reviewer can inspect the protocols. |
| Matched A/B measurements report different positive `n_samples` | Warn and retain scores; sample count does not determine score weights. Review whether dataset coverage is comparable. |
| Supplied `n_samples` is not a positive integer | Warn and retain scores; omit it from sample-count comparisons. Absent/blank sample counts are allowed. |
| Eval has a YAML `warning` | Show the caveat once for all models and alongside that eval's configuration. |
| No shared data with positive category weight | Show an unavailable composite (`—`), never an invented zero. |

Invalid model/config imports leave the active models, settings, and scores unchanged, including multi-model files where a later model is invalid. Build input validation completes before existing output files are replaced. Warnings are calculated from the current config and loaded results; fixing or removing the underlying issue removes its warning. Fields not used for scoring, such as source paths and standard errors, remain audit information; their presence is not a guarantee that dataset revisions or prompts match. Invalid values in excluded alternate metrics remain visible but are not normalized using the selected metric's scale.

## Synthetic comparison

The automatically generated synthetic model perturbs the first model’s selected raw scores using seed `20260930` and Gaussian noise with a standard deviation of 2 raw score points. Raw values are clipped to 0–100 before applying the eval’s normalization. Regenerating with the same ordered source rows is deterministic. These scores are for interface exploration, not evidence about another training method.

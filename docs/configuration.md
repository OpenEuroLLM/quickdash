# Configuration reference

Quickdash separates four inputs: model results, a weighting profile, an optional named eval set, and the global eval catalogue. You can compare new result files with existing interpretation rules without writing a new list of required evals.

| Input | Purpose | Default |
| --- | --- | --- |
| CSV results | Raw measurements for models A and B | Shared files in `results/`, or browser imports |
| Weighting profile | Category weights, English shares, default calculation | `configs/weights/oellm.yaml` |
| Eval set | Optional expected evals and variants | `configs/sets/flagship-1.yaml` on dashboard startup |
| Global catalogue | Match tasks to evals, categories, metrics, normalization and languages | `configs/catalogue.yaml` → `configs/evals/` |

Use the field tables below when authoring YAML. The dashboard and Python API use the same schemas. These files select and interpret existing results; they do not launch evaluations or change how a model was evaluated.

- [Eval sets](#eval-sets): required evals, few-shot and metric overrides, exclusions, pinned tasks.
- [Weighting profiles](#weighting-profiles): category weights, English shares, calculation mode.
- [Catalogue manifest](#catalogue-manifest): load a directory of per-eval definitions.
- [Per-eval definitions](#per-eval-definitions): task matching, metric selection, normalization, components.
- [Language assignments and defaults](#shared-language-metadata): ordinary, pooled, and translation results.
- [Portable catalogue](#portable-catalogue): a complete single-file catalogue for browser import or Python.
- [Startup selection](#startup-selection): initial A/B models and default profile/set filenames.

For the shipped choices, see [current defaults](#choose-weights-and-expected-coverage). For loading files, see [build defaults and browser imports](#build-defaults-and-browser-imports) and the [Python API](python-api.md#load-the-repositorys-per-eval-files).

## YAML conventions

- Use YAML 1.2 Core. Unknown fields and duplicate mapping keys are rejected. Names, category labels, metrics, filters, and task strings are case-sensitive.
- **Required** means the field must be present. **Optional** means omit the field to get the behavior described in its table; `null` does not mean “use the default.” Empty strings and empty lists are accepted only where stated.
- Write numeric values as numbers, not quoted strings. Numbers must be finite. Shot counts are integers from `0` through `9007199254740991` (`2^53 - 1`); `0` means zero-shot, not unrestricted.
- Write booleans as `true` or `false`. Quote strings such as `"none"`, `""`, and regexes when that makes their meaning clearer. `metric_filter: "none"` matches literal `none`; `metric_filter: ""` matches a blank CSV filter. Neither is a wildcard.
- Top-level `notes`, where allowed, is a list of strings and defaults to no notes. It records context without generating warnings. Eval-level `warning` is a separate field for an active scoring caveat.
- Document intentional exclusions with inline YAML comments explaining why. Parsers and browser exports do not preserve comments; authored YAML in version control retains those explanations.

## Eval sets

Files: [`configs/sets/*.yaml`](../configs/sets/). Python argument: `load_config(..., eval_set=...)`. Builder flag: `--eval-set`.

A set controls membership and expected coverage. `fixed` declares required evals; `available` uses recognized selected data without requiring absent evals. In a comparison, both modes score shared measurements only. Omitting `eval_set` in Python creates an unrestricted available-mode set; it does not select `flagship-1` or load the repository's `any-available.yaml` exclusions.

### Set fields

<!-- config-schema: set -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `version` | Required | Integer `1` | Schema version. |
| `name` | Required | Nonempty string | Display name; must be unique among sets offered by one build. |
| `mode` | Required | `fixed` or `available` | There is no default in a set file. |
| `evals` | Required for `fixed`; forbidden for `available` | Nonempty list of [eval entries](#set-eval-entries) | Declares required evals. Even `evals: []` is invalid in available mode. |
| `exclude` | Optional | List of unique, exact catalogue eval names; `[]` allowed | No explicit eval exclusions. Supported in both modes; every name must exist in the catalogue. |
| `exclude_languages` | Optional | List of unique canonical language codes; `[]` allowed | No set-wide language exclusions. Removes matching tasks across the set. |
| `notes` | Optional | List of strings; `[]` allowed | No notes. |

### Set eval entries

Each item under `evals` has these fields. **Add overrides to the existing entry** rather than adding the same eval twice.

<!-- config-schema: set-eval -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `name` | Required | Exact catalogue eval name | Must exist, be unique in this set, and not also appear in `exclude`. It is not a CSV task name unless the catalogue uses the same name. |
| `shots` | Optional | Nonnegative integer | Inherit catalogue `shots`. If neither specifies it, no shot count is selected by configuration. |
| `metric` | Optional | Nonempty string | Inherit catalogue `metric`. Overrides the exact CSV `metric` to select. |
| `metric_filter` | Optional | String, including `""` | Inherit catalogue `metric_filter`. Overrides the exact CSV `filter` to select. |
| `exclude_languages` | Optional | List of unique canonical language codes; `[]` allowed | No additional exclusions for this eval. Combines with set-wide exclusions. |
| `variants` | Optional | Nonempty list of [task requirements](#pinned-task-requirements) | Require all eligible known tasks for this eval after language exclusions. |

For example, a complete custom set using entries from the shipped catalogue:

<!-- config-example: set-overrides -->

```yaml
version: 1
name: Custom reasoning checks
mode: fixed
evals:
  - name: arc_challenge
    shots: 10
  - name: sib200
    metric: acc
    metric_filter: "none"
  - name: gpqa_diamond_cot
    shots: 0
    metric: "pass@1"
    metric_filter: "all"
exclude:
  - GPQADiamond # Use gpqa_diamond_cot with the corrected CoT protocol.
```

You can put any combination of `shots`, `metric`, and `metric_filter` on an eval. The override applies to the **whole eval group**, including translated tasks and components. Scale, normalization, task matching, and component rules stay in the catalogue; they cannot be overridden by a set. Choose a metric compatible with that scale and normalization.

There is no top-level `shots` or per-language setting override. A set cannot unset a catalogue shot expectation with `null`; to make it unrestricted, omit `shots` from the catalogue rule as well. Strict/relaxed matching is a runtime option, not a YAML field; see [matching behavior](#strict-and-relaxed-matching).

### Pinned task requirements

Use `variants` only when you want an explicit task inventory instead of the catalogue's eligible known tasks. Each item has:

<!-- config-schema: variant -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `task` | Required | Exact nonempty CSV task name | Must be known to this eval in the catalogue and eligible under `match` and `select`. |
| `n_shot` | Optional | Nonnegative integer | No additional shot constraint beyond the effective eval setting. If supplied, pins this task's membership to that shot count. |

For the [portable example catalogue](#portable-catalogue):

<!-- config-example: set-pinned -->

```yaml
version: 1
name: English example only
mode: fixed
evals:
  - name: Example reasoning
    shots: 0
    variants:
      - task: example_en
        n_shot: 0
```

`shots` changes the eval's expected setting; `variants[].n_shot` is a hard membership requirement. A pin must agree with effective `shots` when set, and relaxed matching does not loosen it. Duplicate task/shot entries and overlapping unrestricted/pinned entries are invalid. Tasks forming a component group must be selected completely with compatible shot settings.

Known tasks come from explicit catalogue language assignments and literal `match.name`, restricted by `match` and `select`. A regex alone does not enumerate tasks. A fixed eval with no eligible known tasks is invalid. Catalogue additions can expand an unpinned set's requirements; absent required results warn and make its coverage incomplete.

### Intentional exclusions

A complete available-mode set can exclude data without declaring required evals:

<!-- config-example: set-available -->

```yaml
version: 1
name: Available validated evals
mode: available
exclude:
  - global_piqa_prompted # Scoring and normalization await validation.
```

Language exclusions may be global or local. This complete set uses the shipped catalogue:

<!-- config-example: set-languages -->

```yaml
version: 1
name: Flagship language scope
mode: fixed
exclude_languages:
  - kat_Geor # Georgian was omitted from tokenizer training; not targeted or evaluated for this model generation.
evals:
  - name: commonsense_qa
  - name: xcsqa
    exclude_languages:
      - eng_Latn # Avoid overlap with CommonsenseQA.
```

Language codes use the catalogue's explicit assignments, not substrings in task names. A global exclusion must occur in the catalogue's eligible task assignments; a local exclusion must occur in that eval's eligible assignments. Unknown or duplicate codes are errors. Translation is excluded when **either endpoint** matches. Pooled results use their declared language label and cannot be split. Entire component language groups may be excluded; partial component selections are invalid.

A fixed set already excludes unlisted evals, but explicit `exclude` entries distinguish intentional exclusions from unexpected extra results. Explicit eval/language exclusions produce one `intentional_exclusion` informational diagnostic when affected data is present, even if it has only the wrong metric. They do not increase the warning count, emit Python warnings, or fail `diagnostics="error"` / CLI `--strict`. With no affected data, no information record is needed. Unlisted evals and unselected variants without an explicit exclusion can still warn.

An excluded eval stays outside the set if results arrive later. Remove it from `exclude` and add it to `evals` to require it again. Exclusions do not waive missing metrics, tasks, or components of an included eval. Missing included requirements still warn.

## Weighting profiles

Files: [`configs/weights/*.yaml`](../configs/weights/). Python argument: `load_config(..., weights=...)`. Builder flag: `--weights`.

<!-- config-schema: profile -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `version` | Required | Integer `1` | Schema version. |
| `name` | Required | Nonempty string | Display name; must be unique among profiles offered by one build. |
| `weights` | Required | Nonempty mapping of category labels to nonnegative numbers | Category weights must sum to `1` (absolute tolerance `1e-8`). Labels match catalogue `category` exactly. |
| `aggregate` | Optional | `standard`, `english_eval`, or `english_category` | `standard`; see the modes below. |
| `english_weights` | Optional | Mapping of categories in `weights` to numbers in `[0, 1]`; `{}` allowed | Each omitted category defaults to `0`, which **disables English balancing** for that category. Shares do not sum to 1 across categories. |
| `notes` | Optional | List of strings; `[]` allowed | No notes. |

<!-- config-example: profile -->

```yaml
version: 1
name: Reasoning and math
weights:
  Reasoning: 0.6
  Math: 0.4
aggregate: english_eval
english_weights:
  Reasoning: 0.5
  Math: 0.5
```

| `aggregate` value | Calculation within each category |
| --- | --- |
| `standard` | Average selected variants within each eval, then evals equally. Ignores `english_weights`. |
| `english_eval` | Combine English and other-language means within each eval, then average evals equally. |
| `english_category` | Average represented evals separately on each language side, then combine the two category means. |

Component groups are combined first. Category weights apply last. With a positive English share, a group containing only one language side keeps its full weight. A share of `1` gives English all weight where both sides exist; `0` uses the ordinary unsplit calculation, rather than selecting only non-English results. See the [worked aggregate example](#choosing-an-aggregate).

The shipped profiles explicitly use English shares of `0.5`; that is a configuration choice, **not the parser default**. A catalogue category omitted from `weights` receives zero weight and warns when shared measurements use it. A category with no usable data has its weight redistributed proportionally among categories with data. Category labels are configurable, not a fixed list of allowed names. Profiles do not list evals or change their protocols.

## Catalogue manifest

File: [`configs/catalogue.yaml`](../configs/catalogue.yaml). Python argument: `load_config(..., catalogue=PATH)`. Builder flag: `--catalogue`.

A manifest loads per-eval YAML files from disk:

<!-- config-example: manifest -->

```yaml
version: 1
name: Example catalogue
evals_dir: evals
notes:
  - Each eval file owns its language assignments.
```

<!-- config-schema: manifest -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `version` | Required | Integer `1` | Format version shared by the per-eval files. |
| `name` | Required | Nonempty string | Catalogue display name. |
| `evals_dir` | Required | Nonempty directory path string | Relative paths resolve against the manifest's directory. Absolute paths are also accepted. |
| `notes` | Optional | List of strings; `[]` allowed | No notes. |

Every `.yaml` or `.yml` file directly in `evals_dir` is loaded in filename order; subdirectories and other extensions are ignored. The directory must exist and contain at least one eval definition. Adding a file needs no registration list. The manifest cannot also contain `evals` or `languages`.

Manifests require filesystem access: pass a **filename**, not a manifest mapping, to Python. Browser import accepts the [portable catalogue](#portable-catalogue), not a manifest or an individual eval file. The builder's generated `catalogue.yaml` is portable.

## Per-eval definitions

Files: [`configs/evals/*.yaml`](../configs/evals/). Each file contains one eval and its language assignments; the manifest loads them together. Per-eval files do **not** take `version` or `notes` fields.

This complete fictional definition can be saved as `evals/example.yaml` beside the example manifest:

<!-- config-example: eval -->

```yaml
name: Example reasoning
category: Reasoning
match: {regex: 'example_(en|fr)'}
metric: acc_norm
metric_filter: "none"
shots: 0
score: {scale: 1}
normalize:
  min: 0.25
  max: 1
  basis: uniform_choice
  note: Four-choice chance correction for this fictional example.
languages:
  - language: eng_Latn
    tasks: [example_en]
  - language: fra_Latn
    tasks: [example_fr]
```

### Eval fields

<!-- config-schema: eval -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `name` | Required | Nonempty string, unique across catalogue evals | Display/group name and the name referenced by sets. |
| `category` | Required | Nonempty string | Category label used by weighting profiles. |
| `match` | Required | [Match rule](#task-matching-rules) | Identifies the CSV tasks belonging to this eval. Overlapping eval matches are errors. |
| `metric` | Required | Nonempty string | Exact CSV `metric`, such as `acc_norm`, `exact_match`, or `pass@1`. No automatic metric fallback. |
| `metric_filter` | Required | String, including `""` | Exact CSV `filter`. Blank and literal `"none"` are different. |
| `score` | Required | Mapping with required `scale` | Source score interpretation; see below. |
| `shots` | Optional | Nonnegative integer | No shot restriction; multiple settings may be selected. Comparisons still enforce compatible protocols. |
| `select` | Optional | [Match rule](#task-matching-rules) | All matched tasks are eligible. When supplied, only tasks also matching `select` contribute; others remain auditable. |
| `normalize` | Optional | [Normalization mapping](#normalization-fields) | Identity normalization: `min: 0`, `max: 1`, clipping enabled. |
| `warning` | Optional | Nonempty string | No config caveat. Supplied text generates a caveat when the eval participates in the comparison and is always visible in its configuration details. Does not change scores. |
| `aggregation` | Optional | [Component mapping](#component-fields) | Ordinary variant averaging; no required component groups. |
| `languages` | Required in a per-eval file | List of [language assignments](#shared-language-metadata); `[]` allowed | Explicit task-language metadata owned by this eval. Empty means none is known. In a portable catalogue this list moves to the catalogue root. |
| `language_defaults` | Optional; per-eval files only | Mapping with optional `evidence` and `note` strings | No shared language metadata. Expanded during catalogue assembly. |

`score` accepts only the following field:

<!-- config-schema: score -->

| Field | Required? | Type / allowed values | Meaning |
| --- | --- | --- | --- |
| `scale` | Required | Positive finite number | Divide the CSV value by this upper scale: `1` for fractions, `100` for percentages or native chrF points. Selected values must be within `0..scale`. |

An eval's `metric`, `metric_filter`, and `shots` are defaults that a set can override. `score`, `normalize`, `match`, `select`, languages, and component rules belong to the catalogue. All metrics are treated as higher-is-better.

### Task matching rules

`match`, `select`, and component `match` use the same mapping. Supply **exactly one** field:

<!-- config-schema: match -->

| Field | Required? | Type / allowed values | Meaning |
| --- | --- | --- | --- |
| `name` | One of `name` or `regex` | Nonempty string | Exact, case-sensitive CSV task name. |
| `regex` | One of `name` or `regex` | Nonempty portable regex string | Must match the entire task name. |

For example, `match: {name: example_en}` is exact; `match: {regex: 'example_(en|fr)'}` recognizes both names. A `select` rule further restricts `match`; it cannot bring unmatched tasks into the eval.

Use the shared Python/JavaScript regex subset: literal text, character classes, alternatives, capturing/noncapturing groups, and ordinary quantifiers. Flags, lookarounds, named groups, backreferences, and possessive quantifiers are rejected. `\d` and `\w` use ASCII classes; `\s` uses ECMAScript whitespace and cannot appear inside a character class. Dot excludes line terminators and matches one Unicode code point. Regex captures do not assign languages.

### Normalization fields

If `normalize` is present, it accepts:

<!-- config-schema: normalize -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `min` | Required | Number | Lower bound after division by `score.scale`. Must satisfy `0 <= min < max <= 1`. |
| `max` | Required | Number | Upper bound after division by `score.scale`; same constraint. |
| `clip` | Optional | Boolean | `true`: clamp the normalized score to `0..100`. `false` permits normalized scores outside that range; source values must still be within `0..scale`. |
| `basis` | Optional | `uniform_choice`, `uniform_integer`, `not_applicable`, or `unresolved` | No rationale label. Metadata only; it does not compute or change the bounds. |
| `note` | Optional | String; `""` allowed | No explanation. |
| `sources` | Optional | List of HTTP(S) URL strings; `[]` allowed | No source links. |

```text
raw_fraction = value / score.scale
raw_score = 100 × raw_fraction
normalized_score = 100 × (raw_fraction − min) / (max − min)
# With clip: true, clamp normalized_score to [0, 100].
```

With `scale: 1`, `min: 0.25`, `max: 1`, a source value of `0.625` gives raw score `62.5` and normalized score `50`. Use `min: 0`, `max: 1` to disable chance correction. `acc_norm` is an evaluator metric name; it does not itself apply this chance correction. See [baseline choices](#initial-chance-baselines) for the shipped catalogue's rationale.

### Component fields

Use `aggregation` when multiple task results form one eval score. The mapping accepts:

<!-- config-schema: aggregation -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `components` | Required | Nonempty list of component entries | Every component is required in each represented language/protocol group. |
| `note` | Optional | String; `""` allowed | No explanation. |
| `sources` | Optional | List of HTTP(S) URL strings; `[]` allowed | No source links. |

Each item in `components` accepts:

<!-- config-schema: component -->

| Field | Required? | Type / allowed values | Meaning |
| --- | --- | --- | --- |
| `name` | Required | Nonempty string, unique within this eval | Component label. |
| `match` | Required | [Match rule](#task-matching-rules) | Identifies this component's tasks within the parent eval. |
| `relative_weight` | Required | Positive finite number | Relative share; weights are divided by their sum, which must also be finite. |

Components inherit the parent metric, filter, shots, scale, and normalization. They cannot override them. Each selected task must match exactly one component and have explicit language metadata. A valid set must select complete groups; missing result data excludes the whole affected group with a warning. See [the PolyMath example and completeness rules](#weighted-components-within-an-eval).

## Shared language metadata

In per-eval files, `languages` is a required list, and each item accepts:

<!-- config-schema: language -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `tasks` | Required | Nonempty list of exact nonempty task names | Every task must match the eval owning this file. A task may have only one language assignment in the catalogue. |
| `scope` | Optional in per-eval files; required in portable catalogues | `single`, `pooled`, or `translation` | Inferred during assembly from the fields below. |
| `language` | Required for `single` or `pooled`; forbidden for `translation` | Canonical code such as `eng_Latn`; `mul` allowed only for `pooled` | Language/group label. |
| `source_language` | Required for `translation`; forbidden otherwise | Canonical code, excluding `mul` | Translation source. |
| `target_language` | Required for `translation`; forbidden otherwise | Canonical code, excluding `mul` | Translation target. |
| `evidence` | Optional | HTTP(S) URL string or `""` | Inherit `language_defaults.evidence` in a per-eval file, otherwise no evidence link. |
| `note` | Optional | String; `""` allowed | Inherit `language_defaults.note` in a per-eval file, otherwise no authored note. |

Canonical codes have the form `xxx_Ssss` (three lowercase letters, underscore, capitalized four-letter script), such as `fra_Latn` and `srp_Cyrl`, plus the pooled label `mul`. Short aliases and spelled-out names are not resolved. An unlisted task stays Unknown even if its name looks like a language code.

Scope inference applies **only to per-eval files**:

| Declared fields | Inferred scope |
| --- | --- |
| `language: eng_Latn` (or another canonical code) | `single` |
| `language: mul` | `pooled` |
| `source_language` or `target_language` | `translation`; both endpoints are still required |

Use explicit `scope: pooled` when an inseparable pooled score is grouped under one specific code rather than `mul`. Explicit scope must agree with the supplied fields.

The optional `language_defaults` mapping accepts only these fields:

<!-- config-schema: language-defaults -->

| Field | Required? | Type / allowed values | Behavior when omitted |
| --- | --- | --- | --- |
| `evidence` | Optional | HTTP(S) URL string or `""` | No inherited evidence link. |
| `note` | Optional | String; `""` allowed | No inherited note. |

Each language entry inherits omitted metadata and can override either field independently. `""` clears an inherited value; `null` is invalid. Invalid defaults are rejected even if every entry overrides them. This excerpt belongs in a per-eval definition whose `match` covers the listed tasks:

<!-- config-example: language-defaults -->

```yaml
language_defaults:
  evidence: https://example.org/benchmark-definition
  note: Language labels come from the benchmark definition.
languages:
  - language: eng_Latn
    tasks: [example_en]
  - language: fra_Latn
    tasks: [example_fr]
    note: A more specific explanation for this task.
```

The URL is illustrative. Translation uses two endpoints, for example this language-entry excerpt:

<!-- config-example: translation -->

```yaml
tasks: ['flores200:eng_Latn-spa_Latn']
scope: translation
source_language: eng_Latn
target_language: spa_Latn
```

Assembly writes explicit scopes and resolved metadata into the portable catalogue. The [language views](#explicit-language-assignments) keep source/target pairs distinct without double-counting scores.

## Portable catalogue

A complete single-file catalogue can be loaded by the browser, builder, or Python. It contains the same eval rules as the per-eval layout, with all language assignments collected at the root.

<!-- config-schema: catalogue -->

| Field | Required? | Type / allowed values | Behavior when omitted / meaning |
| --- | --- | --- | --- |
| `version` | Required | Integer `1` | Schema version. |
| `name` | Required | Nonempty string | Catalogue display name. |
| `evals` | Required | Nonempty list of [eval rules](#eval-fields) | Each entry uses the eval fields above, **without** `languages` or `language_defaults`. |
| `languages` | Required | List of [language assignments](#shared-language-metadata); `[]` allowed | Each assignment requires explicit `scope`. No scope/default expansion occurs in this format. |
| `notes` | Optional | List of strings; `[]` allowed | No notes. |

<!-- config-example: catalogue -->

```yaml
version: 1
name: Portable example catalogue
evals:
  - name: Example reasoning
    category: Reasoning
    match: {regex: 'example_(en|fr)'}
    metric: acc_norm
    metric_filter: "none"
    shots: 0
    score: {scale: 1}
    normalize: {min: 0.25, max: 1}
languages:
  - tasks: [example_en]
    scope: single
    language: eng_Latn
  - tasks: [example_fr]
    scope: single
    language: fra_Latn
```

There is no `evals_dir`, `weights`, `aggregate`, or eval-set membership in this format. Generated `catalogue.yaml` and browser catalogue exports use this layout. The resolved internal `scheme` in `analysis.json` combines inputs for arithmetic; it is not another YAML input format.

## Startup selection

### Initial models: `results/default.yaml`

This optional file is read when building with `--results-dir`. It accepts **exactly** these two fields, with no `version` or `name`:

<!-- config-schema: startup -->

| Field | Required? | Type / allowed values | Meaning |
| --- | --- | --- | --- |
| `a` | Required when the file exists | Exact checkpoint label from the embedded CSV data | Initial model A. |
| `b` | Required when the file exists | Exact checkpoint label from the embedded CSV data | Initial model B. May equal `a`. |

<!-- config-example: startup -->

```yaml
a: v1annealC_120k_l0fix
b: v2anneal_120k
```

Use checkpoint labels, not filenames. Missing labels or unknown fields fail the build. Without the file, the dashboard uses the first two checkpoint labels alphabetically, or a synthetic comparison if there is only one model. Direct single-CSV builds do not read it. This affects only the initial selection, not scoring or which other models are available. See [result-file setup](../results/README.md).

### Initial profile and set: `default.txt`

[`configs/weights/default.txt`](../configs/weights/default.txt) and [`configs/sets/default.txt`](../configs/sets/default.txt) are **plain text, not YAML**. Each contains one existing `.yaml` or `.yml` filename in its own directory, such as `oellm.yaml` or `flagship-1.yaml`. Paths and multiple lines are invalid. These files are required when the builder chooses a directory's default; an explicit `--weights` or `--eval-set` bypasses that default selection. Python's `load_config` does not read these files.

## Choose weights and expected coverage

Two profiles are supplied. **Original** is selected on startup; **Code & math emphasis** shifts weight toward those two categories.

| Category | Original | Code & math emphasis |
| --- | ---: | ---: |
| Code | 0.15 | 0.20 |
| Math | 0.15 | 0.20 |
| Reasoning | 0.15 | 0.10 |
| Knowledge | 0.15 | 0.125 |
| Commonsense | 0.15 | 0.125 |
| Reading | 0.15 | 0.15 |
| Translation | 0.1/3 | 0.1/3 |
| Language | 0.1/3 | 0.1/3 |
| Instruction following | 0.1/3 | 0.1/3 |

Both profiles default to the standard calculation and store an English share of 0.5 per category, which applies only when an English-balance calculation is selected.

**flagship-1** is the startup eval set. The **Weighting profile** and **Eval set** selectors operate independently. Switching a profile resets category weights, English shares, and the calculation to that profile's values, leaving the eval set unchanged. Switching eval sets preserves your current weights and calculation. Export edits before switching profiles if you want to keep them.

**Any available** uses recognized selected measurements shared by A and B. Measurements present on only one side generate comparison warnings and are excluded from both scores. Catalogue entries absent from both models do not generate warnings. The supplied freeform set explicitly excludes prompted Global PIQA pending validation; present data for it appears in the **Intentional exclusions** informational summary.

**flagship-1** requires the catalogue's known tasks for each listed eval. Georgian is excluded throughout the set because it was omitted from tokenizer training, and this was discovered too late to correct for this model generation. Georgian is therefore neither targeted nor evaluated for this generation. English is excluded specifically for X-CSQA to avoid overlap with CommonsenseQA. Original and translated tasks stay under their existing eval group (for example `arc_challenge`). A missing required result generates a warning even if other languages for that eval are present. The score is labelled **INCOMPLETE** and uses the shared subset with redistributed weights. Excluded tasks are not requirements; present explicitly excluded data appears in one informational summary and remains inspectable.

The set uses the corrected CoT reasoning and code-continuation protocols from the `flag-evals-471` exports. Each has its own catalogue entry, so the original and corrected runs retain distinct task identities:

| Original eval | Selected corrected eval |
| --- | --- |
| AIME24, AIME25, AMC23 | `aime24_cot`, `aime25_cot`, `amc23_cot` |
| GPQADiamond, JEEBench, MATH500 | `gpqa_diamond_cot`, `jeebench_cot`, `math500_cot` |
| HumanEval, LiveCodeBench, mbpp | `humaneval_cont`, `livecodebench_cont`, `mbpp_cont` |
| polymath | `polymath_cot` (all four difficulty levels in each of six languages) |

These entries select `pass@1` with filter `all`, at 0 shots except `mbpp_cont` at 3 shots. Alternate metrics such as `pass@4` and `think_closed` remain raw inspection fields. Category assignments, normalization floors, and PolyMath difficulty weights are retained. The inherited JEEBench floor of 0.1055 is a shared scoring convention, not a newly measured baseline for CoT prompting.

`flagship-1` excludes the original entries, avoiding duplicate contributions from the same benchmark. Missing corrected results leave coverage incomplete, even when an original run is present; relaxed matching does not substitute a different task or metric. Original entries remain available for custom sets and inspection. **Any available** can include both original and corrected entries as separate evals, so its score answers a different comparison question.

## Strict and relaxed matching

Strict shot-mismatch warnings group tasks by eval, model, and expected/actual shot-count pair, with a count and expandable task list. They replace duplicate missing-setting/coverage warnings for those same tasks; missing requirements still count toward incomplete coverage.

The dashboard starts with **Strict matching**. Expected settings are resolved in this order: catalogue defaults, then optional whole-eval set overrides. Strict matching requires the configured metric, metric filter, and (when specified) shot count. Shared comparisons also require the same harness and backend.

**Relaxed — allow few-shot differences** may select a different shot count for each concrete task. It prefers the expected count; otherwise it uses the uniquely closest available count, independently for each model and task with the same metric/filter/harness/backend. Equally close alternatives are ambiguous and excluded with a warning. Scores never influence that choice. Without a configured shot expectation, shot counts still have to match across models.

Relaxed matching never substitutes a different metric or metric filter, or pairs different harnesses/backends. Component groups must still contain every component at one consistent actual shot count. If per-task selection leaves a mixed-shot or incomplete component group, the group is excluded; the engine does not search for a different combination to rescue it.

When a differing shot count actually contributes, the page prominently reports **INCONSISTENT EVALUATION SETTINGS**. Warnings give the eval, model, tasks, expected count, and actual count. Real measurement identities retain their actual settings. Enabling relaxed mode alone does not label a comparison inconsistent if no mismatched measurements contribute. The shipped working expectations are 25 shots for ARC Challenge, 10 for PIQA, and 5 for MGSM; their 0-shot translated/global variants need relaxed matching unless the set overrides the expectation.

## Build defaults and browser imports

The builder embeds YAML profiles directly in `configs/weights/` and sets directly in `configs/sets/`. Each directory's `default.txt` contains one YAML filename selected on startup. Missing or invalid defaults stop the build before replacing output. Names must be unique within each selector.

- `--catalogue PATH` chooses a complete catalogue YAML or a manifest pointing to per-eval files. Relative `evals_dir` paths resolve against the manifest’s directory, independent of the working directory.
- `--weights PATH` chooses a profile; used alone, it embeds only that profile. `--weights-dir DIR` offers the profiles in another directory and uses its `default.txt` unless an explicit profile is supplied.
- `--eval-set PATH` and `--sets-dir DIR` work the same way for eval sets.
- `--results-dir DIR` embeds CSVs directly in that directory. A checkpoint label may occur in only one file; one file can contain multiple models. An optional `default.yaml` in that directory selects the initial comparison using `a` and `b` checkpoint labels. Both must exist in the embedded data; invalid defaults stop the build before replacing output. Other models remain selectable. See [choosing the startup models](../results/README.md).
- `--sample-csv FILE`, used with `--results-dir`, supplies a fallback only if that directory has no CSVs. Invalid shared files stop the build; they never trigger the fallback. Pages uses `examples/sample-evals.csv` for this option.

Every offered set is validated against the catalogue and every profile before writing output. Raw results are interpreted using the catalogue with the active set’s overrides; changing sets can change both membership and scoring-field selection. An empty results directory starts without models unless `--sample-csv` supplies a fallback. Omitting both input options starts without models.

Under **Eval configuration**, load or export the catalogue, weights, and eval set separately. Uploaded choices are temporary; reload restores published defaults. Catalogue and eval-set imports reinterpret all loaded real models and regenerate synthetic comparisons. Invalid imports preserve the previous models and settings. When replacing a catalogue, first load a compatible set. A neutral set with `mode: available` and no exclusions works with any catalogue; the project's supplied Any available set references prompted Global PIQA and requires that catalogue entry. `configs/examples/eval-set.yaml` is a neutral set for the fictional example. **Clear models** retains settings.

`analysis.json` records the catalogue, selected profile and set, available `profiles` and `suites`, and source filenames/hashes. It also contains the resolved internal `scheme` used for arithmetic; that combined object is not a YAML input format. Generated `catalogue.yaml` contains the assembled, portable catalogue, with no `evals_dir` reference. `weights.yaml` and `eval-set.yaml` record the other configuration inputs. Browser export also saves the complete catalogue in one file; browser import accepts complete catalogues, not filesystem manifests.

## Share a view

The browser address updates as you use the dashboard. Copy that address to reopen
or share the current view. A short link such as `#view=languages` opens a tab with
the page's defaults. Generated links also record A/B checkpoint labels, the eval
set and weighting profile filenames, strict/relaxed matching, calculation mode,
edited category weights and English shares, filters, search, sorting, the category
being explored, and expanded eval/language details. Switching tabs adds a browser
history entry; edits within a tab update its entry. Back and Forward restore them.

Links use the CSVs and configs embedded in the page being opened; they do not pin
a historical dataset or config version. They contain settings and labels, not CSV
contents or uploaded YAML. A view using temporary uploads is marked as requiring
those files; its link cannot reproduce the comparison by itself. Share the files
separately. A local `file:` address also needs the same HTML file at that path;
use the hosted page for links to other people, or share a standalone HTML build.

Malformed links and unavailable model/config references show a notice without
changing the current comparison. On first load, the page's defaults remain visible
with that notice. The invalid anchor is retained so it can be inspected; choosing
a new view or changing a control resumes address updates. Display settings in a
link do not alter the scoring rules or suppress data warnings.

## Weighted components within an eval

Use `aggregation` when several task results form one eval score and the exporter does not supply the intended summary. It belongs in the global catalogue. Category weights and English shares remain in the weighting profile; expected task coverage remains in the eval set.

For PolyMath, add this block to its eval entry (an excerpt, not a complete catalogue):

<!-- config-example: components -->

```yaml
aggregation:
  components:
    - name: low
      match: {regex: 'polymath_.+_low'}
      relative_weight: 1
    - name: medium
      match: {regex: 'polymath_.+_medium'}
      relative_weight: 2
    - name: high
      match: {regex: 'polymath_.+_high'}
      relative_weight: 4
    - name: top
      match: {regex: 'polymath_.+_top'}
      relative_weight: 8
  note: Difficulty-weighted accuracy; each level is required.
  sources:
    - https://qwen-polymath.github.io/#benchmark-score
```

Each component requires a unique nonempty `name`, a full-task `match` (exact `name` or `regex`, as for eval matching), and a positive finite numeric `relative_weight`. The weight sum must be finite. The list must be nonempty. Optional `note` is text and `sources` is a list of HTTP(S) URLs. Unknown fields are rejected. Multiplying all component weights by the same positive constant leaves the result unchanged.

Both supplied PolyMath rules use the authors' [Difficulty-Weighted Accuracy](https://qwen-polymath.github.io/#benchmark-score) formula: `(low + 2×medium + 4×high + 8×top)/15`. The original `polymath` entry selects `exact_match` with filter `none`; the [oellm-eval template](https://github.com/OpenEuroLLM/oellm-eval/blob/8a4b2412a8e8f7f0d95e3845e2164c792add6a79/oellm/resources/custom_lm_eval_tasks/polymath/_default_template_yaml) emits a mean accuracy for each difficulty split. The default set selects `polymath_cot`, whose task and component matches end in `_cot`, with metric `pass@1` and filter `all`. Both take unweighted per-level inputs and require all four levels within a language. Original-protocol rows cannot fill missing CoT levels.

Calculation order:

1. Select the configured metric/filter/shot results and normalize each score.
2. Within each model, eval, explicit language assignment, and protocol, require exactly one result for every component. Protocol means metric, filter, shot count, harness, and backend. Translation uses the full source/target pair; known pooled languages use their explicit pooled assignment. Unknown languages cannot form component groups.
3. Calculate `sum(relative_weight × normalized score) / sum(relative_weights)` for each complete group.
4. Average complete groups equally within the eval, or within its English/other side when balancing is enabled. Apply the selected eval/category aggregation and category weights afterward. Evals without component rules retain their ordinary variant means.

For example, fictional component scores of 60, 30, 15, and 0 produce `(60 + 60 + 60 + 0)/15 = 12`. Their contributions to that language/protocol score are 4, 4, 4, and 0 points. Each component's contribution to the full composite also includes its group's share within the eval, any English balance, the eval's share of its category, and the category weight. These full contributions drive the weighted delta bars and sum to the score difference.

**Incompatible aggregation configurations are errors.** Components inherit the parent eval's metric, filter, score scale, normalization, and any fixed shot setting; they cannot override these fields. Catalogue validation checks declared task/language assignments against the component rules and eval selection. Each represented language must have every component available in the configuration, and each task must match exactly one component. An exact component task must be eligible under its parent eval. Entire languages can be omitted; alternate task aliases are permitted in the catalogue.

A named set that lists component tasks must select exactly one task for each component at every chosen language/shot setting. For example, selecting low/medium/high at 0-shot and top at 5-shot is a configuration error, as is omitting top entirely. Omitting shots for every component is allowed; mixing unrestricted and fixed shots is rejected unless the parent eval pins the same shot count. Multiple complete shot settings are allowed. A whole-eval requirement expands to all eligible known tasks, after language exclusions. Any available has no required task inventory. Missing task-language assignments or duplicate component selections in a named set are errors.

These checks run before applying a browser config or replacing build output. Rejected imports preserve active models, settings, and scores. Regex compatibility is checked against declared task names, plus newly observed selected tasks during CSV classification; the validator does not attempt to prove arbitrary regex relationships. An observed selected task matching zero or multiple component rules is also an error.

**Missing result data still warns and excludes groups, never renormalizing over the remaining levels.** A valid selection with missing metrics/components, multiple exported task results for a component, unknown languages in newly encountered results, or incomplete scoring protocols produces warnings. Check completeness per model and again after taking the exact A/B measurement intersection; a missing component on either side excludes the entire corresponding group from both calculations. Distinct protocols cannot supply each other's missing components. Named-set completion counts reflect these exclusions. Freeform mode does not require entirely absent languages, but it does require every component for each represented group. Raw data remains in Eval configuration, including excluded results and the reason they are unused.

In **Categories** and **Languages**, a collapsed component eval/group shows the calculated normalized score. Its leaves show individual raw scores, relative weights, effective weight percentages, and contributions to the language/protocol group. Ordinary evals still show raw averages; mixed category summaries average the displayed eval scores and are descriptive, not the full composite. These breakdowns do not apply the chosen English balance; use Weighted score for that calculation. Inspection filters that hide required components leave the affected calculated summary unavailable (`—`), rather than inventing a partial benchmark score. Leaf contributions retain the full group's weights.

**Delta comparisons** keeps raw differences as raw differences, including simple raw averages on grouped rows. Its weighted contribution differences include component weights. **Eval configuration** exposes the component matching rules, weights, formula, and sources; catalogue YAML import/export preserves them. Group contributions are explicitly separate from contributions to the overall composite.

The builder and browser share the aggregation implementation. Build summaries apply completeness per model; the browser additionally enforces shared A/B coverage. `analysis.json` model summaries record component warnings alongside scores. Row audits retain metric eligibility even when component coverage excludes a result from the final calculation.

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
| 0.1055 | JEEBench: shared 10.55% baseline; the paper reports approximately 10.5% |
| ≈1/4 | ARC Challenge: initial approximation, including translated variants |
| 1/4 | ARC Easy: conventional approximation despite a few questions with different option counts |

The choice-based baselines model uniform *valid* guesses; JEEBench uses the paper's mixed-format guessing policy described below. These are not measured random-language-model or majority-class baselines. AIME24 and AIME25 use a zero floor without a uniform-integer guessing correction. ARC Easy uses 0.25 for consistency; the full published split has mean random accuracy approximately 0.2501613. Sources describe task definitions, but the CSV does not pin the exact run's dataset revision.

ARC Challenge uses an approximate 25% baseline. In its published test split, 1,165 of 1,172 questions have four options, four have three, and three have five, giving an exact mean of about 25.0156%. The approximation is also applied to translated variants, whose individual choice counts have not all been audited. JEEBench uses a 10.55% overall random baseline to match the shared scoring policy; [Table 2 of its paper](https://aclanthology.org/2023.emnlp-main.468.pdf#page=5) reports approximately 10.5%. This combines single-choice guessing and random option subsets with partial credit, assigning zero expected score to integer and numeric answers. It assumes the full 515-question benchmark with those scoring rules.

AMC23 is open-ended in the selected evaluator: the original contest's answer options are removed. Code generation, translation chrF, overlap F1, and other open-ended exact-match tasks do not receive an invented chance baseline.

`normalize.basis` may be `uniform_choice`, `uniform_integer`, `not_applicable`, or `unresolved`. It documents the rationale; `min`, `max`, and `clip` control the actual calculation. Optional `sources` is a list of HTTP(S) URLs, and `note` is free text. Set `min: 0` and `max: 1` to disable correction. An optional eval-level `warning` string appears in the Warnings tab once for all models and in the eval configuration details. Remove it when the concern is resolved; it does not change selection or arithmetic. The supplied config uses it for unvalidated prompted Global PIQA scoring and the Croatian/Serbian language-grouping approximation. Exported YAML preserves config values and notes; YAML comments are not retained.

`acc_norm` in lm-eval refers to choosing answers using length-normalized likelihoods; it does **not** remove chance accuracy. Chance correction here is applied to each selected variant's aggregate score before averaging evals. Clipping after aggregation is not equivalent to clipping individual items, and a mixture of corrected and uncorrected metrics is still a provisional composite.

## Explicit language assignments

[Language assignments](#shared-language-metadata) determine the language views; task names are not parsed to guess a language. The supplied MultiBLiMP `multiblimp_hbs` assignment uses `scope: single` and `language: srp_Latn` as a grouping approximation for pooled Croatian/Serbian results. Its warning and note explain the approximation; it is not a Serbian-only measurement.

A translation task assigned `source_language: eng_Latn` and `target_language: spa_Latn` appears in:

- Category first: `Translation → FLORES200 → eng_Latn → From eng_Latn → eng_Latn → spa_Latn`.
- Language first: `eng_Latn → Translation → FLORES200 → From eng_Latn → eng_Latn → spa_Latn`.
- Corresponding `spa_Latn → To spa_Latn` branches.

The Languages page supports ascending/descending sorting by language label, variant count, Raw A, Raw B, and A − B. Sorting reorders siblings at every level, including translation directions and pairs, while retaining each node’s descendants and aggregates. Expanded sections and scroll position are preserved when sorting; filters and model changes retain the selected sort.

The final `eng_Latn → spa_Latn` is a single pair label. Each pair expands into its exact task/protocol rows. Repeated endpoint branches never duplicate a measurement in a parent aggregate or in the weighted score. The `Language role` filter selects ordinary evals, translation into, or translation from the chosen language.

## Scoring choices and consistency warnings

The supplied config prefers `acc_norm` over `acc` when both exist for the selected protocol. The metric remains explicit in `metric`; missing fields never silently fall back to another metric. SIB-200 explicitly uses `acc`. A YAML comment explains that `acc_norm` is not reliable/useful in this export: 34 of its 36 values are exactly 0.25. This selection does not generate a config warning. Length-normalized option scoring and chance normalization are separate operations.

For each selected real model, the dashboard compares the sets of selected settings per task within each eval: `n_shot`, `metric`, `filter`, `harness`, and `backend`. Different sets generate one warning naming the settings, with expandable lists of affected tasks and their explicit language assignments (source → target for translation). Identical sets across tasks are consistent even if each task has multiple settings. Excluded alternate metrics, summary children, and protocols do not trigger this check. The current data has mismatches for MGSM (0/5 shots), ARC Challenge (0/10), and PIQA (0/10). These warnings do not exclude scores; use the YAML selection rules to choose comparable protocols after reviewing coverage. Fields absent from the CSV, such as prompt templates or dataset revisions, cannot be compared.

Translation metric preference is **chrF++ > chrF > BLEU**. The catalogue records an explicit selection based on the available, identified fields: FLORES200 uses `chrf++` with filter `rescored`; OpenSubtitles uses `chrf` with filter `none`. FLORES200's export has separate `chrf` and `chrf++` rows, but does not record a rescoring signature. Do not infer the variant from a generic “chrF” label alone.

The referenced [OpenSubtitles task](https://github.com/OpenEuroLLM/oellm-eval/blob/8a4b2412a8e8f7f0d95e3845e2164c792add6a79/oellm/resources/custom_lm_eval_tasks/opensubtitles_multi40/_opensubtitles_multi40_common.yaml) selects the harness's `chrf` aggregation. The [harness implementation](https://github.com/EleutherAI/lm-evaluation-harness/blob/d6de81643928d653435c431bae19945d41d32520/lm_eval/api/metrics.py) uses SacreBLEU defaults: character order 6, word order 0, beta 2. That is plain chrF; chrF++ adds word n-grams through word order 2. Update the catalogue if a better identified metric becomes available. A model missing the configured metric warns and is excluded; the browser does not silently compare different metrics or substitute BLEU.

Both translation evals retain native 0–100 points (`score.scale: 100`, `normalize: {min: 0, max: 1}`), without chance correction. This accepted policy is documented in their notes rather than flagged as an unresolved caveat. A shared numerical range does not imply equal difficulty across metrics or language pairs.

Completion-based PIQA retains `acc_norm` and a 0.5 baseline. **Global PIQA (prompted)** has a separate interpretation rule for `exact_match` / `strict_match`, a provisional zero floor, and a warning that normalization and metric selection have not been validated. It is excluded by the supplied Any available set and omitted from flagship-1. Its data appears in the **Intentional exclusions** informational summary while explicitly excluded. Including it in a custom set surfaces its scoring caveat; configuration inspection always shows the attached warning.

With these defaults, MultiBlimp's Croatian/Serbian pooling is the only configured caveat for included evals. Runtime warnings for coverage, inconsistent settings, missing fields, and unused data still apply.

MMLU and Global MMLU have separate eval configs and aggregates. MMLU selects only `mmlu`; Global MMLU selects `global_mmlu_full_[a-z]+` language summaries. Subject-level rows stay available for inspection but are excluded from both composites. Both evals retain the four-choice 25% floor and each gets one equal share of Knowledge.

## Choosing an aggregate

The prominent **Score calculation** panel offers three modes:

| Config value | UI choice | Calculation |
|---|---|---|
| `standard` | Original weighted score | Average variants within each eval, then evals equally within the category. |
| `english_eval` | English balance per eval | Combine English and other-language means within each eval, then average the eval scores equally. |
| `english_category` | English balance per category | On each language side, average variants within evals and then represented evals equally; combine the two category means. |

For evals with component rules, combine complete components first and use complete language/protocol groups in place of variants in the table above. All modes apply the configured category weights last. The selector affects both model score cards, category/eval contributions, effective weights, and weighted delta bars. Raw comparison columns and descriptive language/category breakdowns retain their meanings.

English shares are configured in the [weighting profile](#weighting-profiles). They apply only in an English-balance mode; zero disables the split for that category.

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

Model comparisons use the intersection of selected measurements, matching task, metric, extraction filter, shot count, harness, and backend. A measurement present only in A or only in B is excluded from **both** score calculations and listed in a comparison-coverage warning. If no measurements remain for an eval, that eval is excluded from both scores and the remaining evals share its category weight equally. An empty category is excluded and remaining category weights are rescaled proportionally to sum to 1. No shared scores leaves the composite unavailable. Data warnings apply to the selected models; the configuration audit retains all loaded real exports.


The weights table shows effective weights after exclusions; the editor preserves the configured weights. Missing named-set requirements and unconfigured tasks remain visible in Warnings. Unused global catalogue rules are allowed. The build's model summaries are per-model summaries of available data; the interactive dashboard applies the common comparison coverage when two models are selected.

## Data validation and failure behavior

Builds and browser imports use the same CSV parser. Required columns are `checkpoint`, `task`, `metric`, `filter`, `n_shot`, `harness`, `backend`, and `value`. Identity fields must contain nonempty text; `filter` may be blank. `n_shot` must be a nonnegative integer written as digits (`0`, `5`, etc.). CSV supports UTF-8, an optional BOM, LF/CRLF line endings, and quoted commas, doubled quotes, and embedded newlines. Empty lines are ignored; empty records, duplicate or blank headers, and malformed records are rejected.

| Issue | Behavior |
| --- | --- |
| Empty CSV, missing columns, invalid identity fields, malformed quotes, inconsistent row widths | Reject the file with an error. |
| Invalid YAML/schema, ambiguous eval matches, duplicate selected measurements within a model | Reject the config or file; never silently pick a rule or duplicate. |
| Selected score is blank, nonnumeric, nonfinite, or outside `0..score.scale` | Reject with CSV row, model, task, and metric in the error. Decimal and scientific notation are accepted; booleans and hexadecimal values are not scores. |
| New model uses an already loaded checkpoint name or a name starting with the reserved `SYNTHETIC demo — ` prefix | Reject the import. Give the model a distinct checkpoint label. |
| Task has no eval config, or lacks the configured metric/filter/shots | Warn and exclude from scoring. Alternate metrics remain inspectable and never silently substitute for the configured metric. |
| Measurements match only one of the compared models | Warn; use only shared measurements and redistribute weights. |
| Named set requirement is missing from either or both models | Warn and mark the set incomplete; compare the shared subset. |
| Eval/task data is covered by an explicit eval or language exclusion | Combine it into one **Intentional exclusions** informational entry across models and evals; exclude it from scoring and retain it in the audit. |
| Eval/task data is outside the selected set without an explicit exclusion | Show **Not used**, even if only an alternate metric exists; keep it in the audit. |
| Catalogue rule has no results in either model | No warning unless required by the selected named set. |
| Shared category has no profile weight | Warn; zero contribution until a weight is assigned. |
| Selected task has no explicit language assignment | For component evals, warn and exclude the group. Otherwise warn and retain the score. Language views show Unknown; English-balance modes use the English fallback. Known mixed-language pools use the documented fallback without claiming a resolved single language. |
| Selected variants use inconsistent scoring settings | Warn; component evals require completeness independently within each protocol. Ordinary evals retain scores for review. |
| Aggregation rules or named-set component selections are incompatible | Reject the config; preserve the active dashboard or previous build output. Components share parent scoring settings and must be selected completely at compatible shot settings. |
| Valid component selection has missing data or multiple exported results for a component | Warn and exclude the whole language/protocol group from both scores. Keep raw data inspectable; never average only the remaining components. |
| Matched A/B measurements report different positive `n_samples` | Warn and retain scores; sample count does not determine score weights. Review whether dataset coverage is comparable. |
| Supplied `n_samples` is not a positive integer | Warn and retain scores; omit it from sample-count comparisons. Absent/blank sample counts are allowed. |
| Eval has a YAML `warning` | Show the caveat in Warnings when the eval has shared comparison data. Always show it in its configuration details. Explicitly excluded evals appear under **Information**; other unselected evals get **Not used**. Neither produces an active scoring caveat. |
| No shared data with positive category weight | Show an unavailable composite (`—`), never an invented zero. |

Invalid model/config imports leave the active models, settings, and scores unchanged, including multi-model files where a later model is invalid. Build input validation completes before existing output files are replaced. Warnings are calculated from the current config and loaded results; fixing or removing the underlying issue removes its warning. Fields not used for scoring, such as source paths and standard errors, remain audit information; their presence is not a guarantee that dataset revisions or prompts match. Invalid values in excluded alternate metrics remain visible but are not normalized using the selected metric's scale.

## Synthetic comparison

The automatically generated synthetic model perturbs the first model’s selected raw scores using seed `20260930` and Gaussian noise with a standard deviation of 2 raw score points. Raw values are clipped to 0–100 before applying the eval’s normalization. Regenerating with the same ordered source rows is deterministic. These scores are for interface exploration, not evidence about another training method.

# Develop and publish Quickdash

Run commands from the repository root. Install the Python package with `python -m pip install -e .` in a virtual environment (Python 3.8+). Building and using the Python library need no Node runtime. Cross-language tests require Node.js 18+; browser tests require Node.js 22+ and Chrome. Activate the environment before running browser tests so their builder subprocess uses the installed dependencies. The scoring config format is documented in the [configuration reference](configuration.md).

## Source layout

| Directory | Contents |
| --- | --- |
| `quickdash/` | Native Python interpretation, analysis, diagnostics, and CLI. |
| `app/` | Python builder, DOM-independent JavaScript engine (`analysis.js`), browser renderer (`app.js`), HTML, and bundled YAML parser. |
| `tests/` | Public contract tests, browser checks, and optional private-export regressions. |
| `configs/` | Catalogue manifest, self-contained `evals/` files, weighting profiles, optional named sets, and fictional examples. |
| `results/` | Public CSV exports contributed to the shared dashboard. |
| `examples/` | Public sample export for Pages and parity tests, plus small fictional quickstart data. |
| `docs/` | Configuration and contributor documentation. |
| `data/`, `output/` | Ignored local inputs and generated files. |

## Build and inspect a change

```sh
python3 -m app.build --results-dir results --sample-csv examples/sample-evals.csv --output output/shared
python3 -m app.build examples/scores.csv --catalogue configs/examples/catalogue.yaml \
  --weights configs/examples/weights.yaml --eval-set configs/examples/eval-set.yaml --output output/demo
```

Open each generated `index.html` in a browser. The shared build embeds the global catalogue, profiles from `configs/weights/`, and sets from `configs/sets/`. Each selector uses its directory's `default.txt`. See the [build flags](configuration.md#build-defaults-and-browser-imports) to supply other inputs.

Check the views affected by your change, including their warnings and failed-input behavior. Generated output is self-contained; do not commit it. Private exports belong in `data/`, never in the public `results/` directory.

## Run tests

These tests use small fixtures and run from a fresh checkout without private evaluation data:

```sh
python -m unittest tests.test_data tests.test_engines
node --test tests/test_data.cjs tests/test_yaml.cjs tests/test_suites.cjs tests/test_warning_policy.cjs tests/test_components.cjs tests/test_view_links.cjs
```

The shared suite in `tests/test_engines.py` sends the same input cases to native Python and the real browser engine through `tests/engine_adapter.cjs`. Both must satisfy independently specified expectations, then their complete semantic reports are compared. Diagnostic codes, contexts and actions are checked; presentation text is not. Numerical comparison uses absolute tolerance `1e-9` and relative tolerance `1e-12`. Fixtures vary configuration sizes, contents and ordering. The sample matrix discovers all shipped sets and profiles and exercises every aggregation in both strict and relaxed matching. Shared cases cover override inheritance, language exclusions (including both translation endpoints), invalid references, missing requirements, component completeness, and warning conditions. Browser checks additionally verify effective settings, unchanged catalogue exports, set switching, and failed-import rollback. Python tests also exercise warning emission and CLI stdout/stderr without Node on PATH.

They cover input validation, normalization, warning/exclusion behavior, failed-build preservation, Python/JavaScript parity, hierarchy sorting, and deterministic randomized scoring comparisons against an independent calculation.

The public browser suite also checks empty startup, shared models, independent profile/set selection, missing requirements, temporary uploads, rollback, and that file imports make no network requests. It requires Node.js 22+ and Chrome. Start an isolated browser session, then run the suite in another terminal:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-first-run --no-default-browser-check \
  --remote-debugging-port=9227 \
  --user-data-dir=/tmp/oellm-dashboard-browser about:blank
# In another terminal:
node tests/test_public_browser.mjs
```

Adjust the Chrome executable path for your platform. Stop that isolated Chrome process when finished. GitHub Actions runs these public tests automatically.

<details>
<summary>Additional regression tests using the private full export</summary>

The full-export regression tests require the original private CSV at `data/v2zloss_86k.flag-evals-436.tasks.csv` and its freshly built output:

```sh
python3 -m app.build data/v2zloss_86k.flag-evals-436.tasks.csv
python3 -m unittest tests.test_analysis tests.test_data
node --test tests/test_app.cjs tests/test_english.cjs tests/test_data.cjs tests/test_yaml.cjs tests/test_suites.cjs tests/test_warning_policy.cjs tests/test_components.cjs tests/test_view_links.cjs
```

With the isolated Chrome session above running, use `node tests/test_browser.mjs` for the full-export browser checks: filtering, sortable hierarchies, scroll preservation, warnings, model swapping, header alignment, and mobile layouts. Screenshots go into the ignored `output/` directory.

To measure parser/config coverage with Node.js 22+:

```sh
node --test --experimental-test-coverage --test-coverage-include=app/eval_config.js \
  tests/test_data.cjs tests/test_app.cjs tests/test_english.cjs tests/test_yaml.cjs
```

</details>

## Compare a dashboard refactor against a baseline

Preserve the revision being reviewed in a temporary checkout or directory. Build an example or private dashboard with the candidate revision, then compare the calculation paths:

```sh
QUICKDASH_BASELINE=/path/to/baseline-checkout \
  node tests/compare_baseline.cjs output/example/analysis.json
```

This optional check compares included rows, weights, contributions, scores and descriptive trees across profiles, sets, all aggregation modes, and missing coverage. Run the browser suites against both builds as well; arithmetic agreement alone does not establish UI behavior. Record the comparison and any intentional fixes in the PR. Keep private inputs and generated evidence outside tracked files.

## Publish through GitHub Pages

The [workflow](../.github/workflows/pages.yml) runs public tests on pull requests and pushes to `main`. The Python loader and Node filesystem helper both assemble the per-eval files declared by `configs/catalogue.yaml`. Shared tests check assembly, language ownership, file loading, and portable export/import as well as scoring.

After tests pass, it builds the shared dashboard and a separate fictional demo. When `results/` has no CSVs, the shared page embeds `examples/sample-evals.csv`; real shared CSVs take precedence. The sample also runs through both engines in CI for all shipped weighting profiles, eval sets, and aggregation modes, with complete and mismatched coverage. See [contributor requirements](../AGENTS.md). Only `output/site/` is uploaded as the Pages artifact: `index.html`, `demo.html`, and license files. The repository root and private local output are not published as the site.

In repository **Settings → Pages**, select **GitHub Actions** as the source. Publishing uses the generated artifact rather than a checked-in root or `docs/` folder. A successful push to `main` deploys automatically; a failed build leaves the last successful site available. Review build or deployment failures in the repository’s **Actions** tab.

Before pushing, run the affected tests and check the README, config reference, and contribution instructions for changed commands or behavior. Contributions to [results](../results/README.md) and [configs](../configs/README.md) are validated by the same workflow.

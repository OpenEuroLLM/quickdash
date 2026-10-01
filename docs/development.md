# Develop and publish Quickdash

Run commands from the repository root. Python 3.8+ and Node.js 18+ build the dashboard without installing packages; browser tests require Node.js 22+ and Chrome. The scoring config format is documented in the [configuration reference](configuration.md).

## Source layout

| Directory | Contents |
| --- | --- |
| `app/` | Python builder, browser application, HTML template, and bundled YAML parser. |
| `tests/` | Public contract tests, browser checks, and optional private-export regressions. |
| `configs/` | Global catalogue, weighting profiles, optional named sets, and fictional examples. |
| `results/` | Public CSV exports contributed to the shared dashboard. |
| `examples/` | Fictional input data for the demo and tests. |
| `docs/` | Configuration and contributor documentation. |
| `data/`, `output/` | Ignored local inputs and generated files. |

## Build and inspect a change

```sh
python3 -m app.build --results-dir results --output output/shared
python3 -m app.build examples/scores.csv --catalogue configs/examples/catalogue.yaml \
  --weights configs/examples/weights.yaml --eval-set configs/sets/any-available.yaml --output output/demo
```

Open each generated `index.html` in a browser. The shared build embeds the global catalogue, profiles from `configs/weights/`, and sets from `configs/sets/`. Each selector uses its directory's `default.txt`. See the [build flags](configuration.md#build-defaults-and-browser-imports) to supply other inputs.

Check the views affected by your change, including their warnings and failed-input behavior. Generated output is self-contained; do not commit it. Private exports belong in `data/`, never in the public `results/` directory.

## Run tests

These tests use small fixtures and run from a fresh checkout without private evaluation data:

```sh
python3 -m unittest tests.test_data
node --test tests/test_data.cjs tests/test_yaml.cjs tests/test_suites.cjs
```

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
node --test tests/test_app.cjs tests/test_english.cjs tests/test_data.cjs tests/test_yaml.cjs tests/test_suites.cjs
```

With the isolated Chrome session above running, use `node tests/test_browser.mjs` for the full-export browser checks: filtering, sortable hierarchies, scroll preservation, warnings, model swapping, header alignment, and mobile layouts. Screenshots go into the ignored `output/` directory.

To measure parser/config coverage with Node.js 22+:

```sh
node --test --experimental-test-coverage --test-coverage-include=app/eval_config.js \
  tests/test_data.cjs tests/test_app.cjs tests/test_english.cjs tests/test_yaml.cjs
```

</details>

## Publish through GitHub Pages

The [workflow](../.github/workflows/pages.yml) runs public tests on pull requests and pushes to `main`. After tests pass, it builds the shared dashboard and a separate fictional demo. Only `output/site/` is uploaded as the Pages artifact: `index.html`, `demo.html`, and license files. The repository root and private local output are not published as the site.

In repository **Settings → Pages**, select **GitHub Actions** as the source. Publishing uses the generated artifact rather than a checked-in root or `docs/` folder. A successful push to `main` deploys automatically; a failed build leaves the last successful site available. Review build or deployment failures in the repository’s **Actions** tab.

Before pushing, run the affected tests and check the README, config reference, and contribution instructions for changed commands or behavior. Contributions to [results](../results/README.md) and [configs](../configs/README.md) are validated by the same workflow.

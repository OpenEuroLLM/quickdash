# Quickdash

A standalone, offline dashboard for comparing model evaluation scores. Explore category and language breakdowns, inspect scoring configuration, and compare raw differences or contributions to a weighted score.

**[Open the dashboard](https://openeurollm.github.io/quickdash/)** or **[try the fictional example](https://openeurollm.github.io/quickdash/demo.html)**. No installation is needed to use either page.

## Compare models

1. Choose an **Eval configuration** at the top. The supplied OELLM config defines evals, selected metrics, normalization, category weights, and explicit language assignments.
2. Select shared models as A and B, or use **Add model CSV** to open your own exports. With one real model, a clearly labelled synthetic comparison is supplied for exploring the interface.
3. Review **Warnings**, then explore the score and breakdown tabs. To use a temporary YAML config, open **Eval configuration → Load config**.

Files opened in the dashboard stay in your browser; they are not uploaded. Changes last until reload, which restores the published models and settings. **Clear models** removes the loaded models from your session while keeping config choices. **Export config YAML** saves edited scoring settings, but does not save model data or modify the repository.

## Share results and scoring configs

- Add public CSV exports to [results/](results/README.md) to offer their models in the shared dashboard.
- Add YAML scoring configs to [configs/](configs/README.md) to offer them in the configuration selector. Each config needs a unique `name`. [configs/default.txt](configs/default.txt) names the one selected on startup, currently `oellm.yaml`.

Use a pull request or GitHub’s **Add file → Upload files**. Changes on `main` trigger tests and a GitHub Pages rebuild; pull requests are checked without publishing. Invalid inputs stop the update and leave the last successful site online. The repository and dashboard are public, so use browser imports for private comparisons.

The [Pages workflow](.github/workflows/pages.yml) publishes only the generated dashboard, fictional demo, and licenses. Repository maintainers configure **Settings → Pages → Source → GitHub Actions**. Check the repository’s **Actions** tab if an update fails to appear.

## Build a standalone file

Building requires Python 3.8+ and Node.js 18+. The YAML parser is [bundled with its license](app/vendor/README.md); no package installation is needed.

```sh
git clone https://github.com/OpenEuroLLM/quickdash.git
cd quickdash
python3 -m app.build examples/scores.csv --config configs/example.yaml --output output/example
open output/example/index.html  # macOS; elsewhere, open it in your browser
```

The example compares two fictional models with a multilingual reasoning eval and an English math eval. The generated HTML contains its data, configs, styles, and code. Share that one file for offline use; recipients need only a browser. It makes no network requests. Source-reference links open external websites only when clicked.

To build the shared dashboard, including all shared results and config choices:

```sh
python3 -m app.build --results-dir results --output output/shared
```

An empty `results/` directory produces a page ready for local CSV imports. To start without embedded models regardless of the directory’s contents, omit `--results-dir`.

For private exports, put your CSV in the ignored `data/` directory:

```sh
mkdir -p data
# Copy your export to data/evals.csv, then:
python3 -m app.build data/evals.csv --config configs/oellm.yaml --output output/private
```

The builder replaces the files it generates in the chosen output directory, including audits and score summaries. Use separate output directories to keep builds. `data/` and `output/` are ignored by Git. CSV columns and configuration rules are described in the [configuration reference](docs/configuration.md).

## Review scores

- **Weighted score:** switch between original averaging, English balance per eval, and English balance per category. Inspect contributions and adjust category weights and English shares. The [worked example](docs/configuration.md#choosing-an-aggregate) explains how the two balance modes differ.
- **Categories:** expand `category → eval → language → variants`.
- **Languages:** expand `language → category → eval → variants`. Click any column heading to sort within each level; click again to reverse. Expanded sections and scroll position are preserved. Translation expands into source/target directions and language pairs in both breakdowns.
- **Delta comparisons:** sortable bars for raw A − B or weighted contribution differences. Start with one row per eval, then expand languages or show all variants.
- **Eval configuration:** inspect every task's category, languages, selected field, raw alternate fields, normalization, and source notes. Load or export YAML here.
- **Warnings:** review missing coverage, scoring inconsistencies, language fallbacks, sample-count issues, and caveats stored in the config.

Filters affect inspection views, while composite scores and contribution weights use the models' full shared coverage. Unmatched measurements are excluded from both compared scores with warnings. Malformed input and invalid selected scores are rejected; failed imports preserve the active dashboard. See the [data-handling policy](docs/configuration.md#data-validation-and-failure-behavior).

Language/category breakdowns show descriptive raw averages. Weighted scores use configured normalization, whose baselines and limitations are visible per eval. Shared numerical scales do not establish comparable difficulty across benchmarks. Unknown/mixed-language scores use the documented English fallback for balancing; this does not change their language labels.

## Development

Application code lives in `app/`, tests in `tests/`, and contributor documentation in `docs/`. Common checks:

```sh
python3 -m unittest tests.test_data
node --test tests/test_data.cjs tests/test_yaml.cjs
```

See [development and publishing](docs/development.md) for the source layout, browser tests, and GitHub Pages workflow.

## License

[Apache-2.0](LICENSE). The bundled js-yaml parser has its own [MIT license](app/vendor/js-yaml.LICENSE).

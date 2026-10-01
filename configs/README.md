# Share evaluation configurations

The dashboard’s **Eval configuration** selector offers the YAML files directly in this directory, including the [OELLM config](oellm.yaml). Each file’s `name` appears in the selector, so give it a distinct, descriptive name. [example.yaml](example.yaml) is for the fictional scores in [examples/scores.csv](../examples/scores.csv).

[default.txt](default.txt) contains the filename selected when the page opens:

```text
oellm.yaml
```

To change the default, replace that line with another YAML filename from this directory and commit it. The build rejects missing files, paths outside this directory, and multiple filenames. The display label still comes from the selected YAML’s `name` field.

To add a scoring scheme:

1. Copy an existing config and edit its eval matches, categories, metrics, normalization, and language assignments. The [config reference](../docs/configuration.md) explains each field and provides a small complete example.
2. Save it here as a `.yaml` or `.yml` file, then submit a PR or use GitHub’s **Add file → Upload files**.
3. Check the generated dashboard and its warnings before using the scores to choose a training method.

```sh
python3 -m app.build --results-dir results --output output/shared
```

The build checks every config against the shared CSVs before publishing. Invalid schemas, duplicate config names, overlapping eval matches, or invalid selected score scales stop the update. A config can intentionally cover only part of the results: unmatched tasks and missing metrics are excluded with warnings when that config is selected.

Switching configs recalculates all loaded models. If a temporary uploaded model is incompatible with a config, the browser reports the error and keeps the previous config and scores. **Clear models** starts a fresh browser comparison while retaining the config choices; reload restores the published results.

For a temporary config, use **Eval configuration → Load config** in the dashboard instead of committing a file. It appears as an uploaded choice for that browser session. **Export config YAML** saves your edits, including adjusted weights and the chosen aggregation mode; it does not modify this repository.

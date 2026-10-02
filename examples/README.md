# Example results

`sample-evals.csv` contains the evaluation scores from the `v2zloss_86k` export
used to develop Quickdash. The checkpoint is labelled **SAMPLE — v2zloss_86k**.
Scores, task names, scoring settings, sample counts, and reported standard errors
are preserved. Original filesystem paths, result timestamps, and file-count
metadata are omitted. This is sample data for exploring the dashboard, not a
claim about a current model or a comparison of training methods.

The main Pages dashboard embeds this file only while `results/` has no CSVs.
Adding a shared result replaces the fallback on the next successful deployment.
To reproduce the Pages build:

```sh
python -m app.build --results-dir results --sample-csv examples/sample-evals.csv --output output/shared
```

The browser offers three **SYNTHETIC demo** choices derived from the first loaded
model. Each uses deterministic Gaussian noise with a standard deviation of
2 raw percentage points (seed `20260930`). The higher/lower choices also shift
scores by +3/−3 points. Values are clipped to 0–100 and converted to each eval's
configured source scale before normalization. These are visual examples, not
additional model runs. They preserve the source's selected measurement coverage;
reported errors and result timestamps are cleared.

`scores.csv` is a separate, small fictional dataset for the Python quickstart
and the minimal `demo.html` page. It uses `configs/examples/` rather than the
full eval catalogue.

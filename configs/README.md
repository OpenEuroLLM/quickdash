# Share eval rules, weights and named sets

Choose the file to edit based on what you want to change:

- **Interpret a new eval:** add its task matching, category, scoring metric, normalization, and explicit language assignments to [catalogue.yaml](catalogue.yaml). Adding a rule does not require every model to run it.
- **Combine component results:** add an `aggregation` rule to the eval in the catalogue. Each component stores a `relative_weight`; PolyMath uses 1, 2, 4, and 8, divided by their sum when scoring. All components must be present within a language/protocol group; see [component aggregation](../docs/configuration.md#weighted-components-within-an-eval).
- **Try different weighting:** add a YAML profile to [weights/](weights/). It can be used with any eval set. Category weights, English shares, and the default calculation live here.
- **Require a standard comparison set:** add a YAML file to [sets/](sets/). [flagship-1.yaml](sets/flagship-1.yaml) pins expected tasks and shot counts; [any-available.yaml](sets/any-available.yaml) needs no required-eval list and compares shared data, with an explicit exclusion for unvalidated prompted Global PIQA.

Each profile or set needs a distinct `name` within its directory. To change a selector's startup choice, edit that directory's `default.txt` to name one YAML file. The catalogue is selected at build time with `--catalogue`, or temporarily loaded in the browser.

The [configuration reference](../docs/configuration.md) describes all three formats with small examples. [examples/](examples/) contains the fictional catalogue and weights used by [examples/scores.csv](../examples/scores.csv).

Submit changes as a PR, then check the generated dashboard:

```sh
python3 -m app.build --results-dir results --output output/shared
```

The build validates every offered combination before replacing output. In the dashboard, inspect **Warnings** for the comparison you intend to use. Named-set scores with missing requirements are explicitly incomplete; extras are excluded but remain inspectable.

For temporary changes, use the separate load/export controls under **Eval configuration**. Files stay in the browser. Weight exports save edited weights and the active calculation; catalogue and eval-set exports are independent. None of these controls modify the repository.

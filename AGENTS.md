# Working on Quickdash

Quickdash has two implementations of the scoring contract: the native Python
library in `quickdash/` and the browser engine in `app/analysis.js` with its
configuration parsers. Neither implementation is the reference for the other.

## Keep Python and JavaScript in sync

- Every change to scoring, configuration interpretation, input validation,
  coverage/exclusion policy, or diagnostic conditions must include a shared
  regression case in `tests/test_engines.py` that runs through both engines.
  A bug fix should fail before the fix and pass in both implementations afterward.
- Compare scores, trees, effective weights, contributions, included/excluded
  measurement identities, and diagnostic codes and context. Human-facing warning
  wording does not need to match. Invalid inputs must be rejected by both engines.
- Include independently calculated expectations or invariants: agreement alone
  does not prove correctness if both implementations share the same mistake.
- Do not assume fixed eval, category, language, component, profile, or set counts.
  Exercise changing contents and sizes. The full sample test discovers shipped
  profiles and sets automatically and covers every supported aggregation mode.
- Keep these checks in CI. Do not skip parity tests when changing only one engine,
  and do not weaken comparisons merely to accommodate a disagreement.
- For dashboard behavior changes, also extend the public browser tests. Node
  exercises the actual browser calculation module; browser tests check that the
  UI supplies and renders those calculations correctly.

Run the shared contract and scoring checks before publishing:

```sh
python -m unittest tests.test_data tests.test_engines
node --test tests/test_data.cjs tests/test_yaml.cjs tests/test_suites.cjs tests/test_warning_policy.cjs tests/test_components.cjs tests/test_view_links.cjs
```

See [development and publishing](docs/development.md) for browser checks and
standalone builds. Keep README setup and common commands accurate, and update the
relevant guide when public interfaces or scoring policies change.

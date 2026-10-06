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

Run the full public checks before publishing, using the same command as CI:

```sh
python3 -m tests.check
```

This requires the installed Python package, Node.js 22+, and Chrome. It runs the
shared Python/JavaScript contract tests and public browser tests, starting and
stopping an isolated Chrome process automatically. Missing prerequisites fail
rather than silently skipping browser coverage. Use `CHROME_BIN` for a custom
Chrome executable. Smaller test commands are useful while developing but do not
replace this pre-PR check.

See [development and publishing](docs/development.md) for browser checks and
standalone builds. Keep README setup and common commands accurate, and update the
relevant guide when public interfaces or scoring policies change.

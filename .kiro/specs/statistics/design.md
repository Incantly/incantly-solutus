# Statistics and charts: design

Descriptive statistics, frequency and classes, charts as values, regression and fits, hypothesis tests and intervals.

## Where the design lives

`docs/features/statistics/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Cross-area decisions:
`docs/features/README.md`.

## Code

- `packages/kernel/src/commands/statistics/`: the area.
  - `types.ts`: the area's undefined reasons, record schemas and option sets.
  - `core.ts`: argument helpers, the sort cache, compensated sums, moments, quantile methods, ranks.
  - `dist.ts`: normal, Student t, chi-squared and F distribution and quantile functions (regularised incomplete gamma
    and beta), for p-values and critical values.
  - `describe-commands.ts`: one list, two lists, frequency, classes and tables.
  - `chart-commands.ts`: the charts.
  - `fit.ts`, `fit-commands.ts`: least squares (QR on a Chebyshev basis), Levenberg–Marquardt, the fit commands.
  - `test-commands.ts`: tests and intervals.
  - `index.ts`: `registerStatistics(registry)`.

## How it fits

- Commands are ordinary command specs in the groups `stats`, `charts`, `fits` and `tests`. Options are optional named
  parameters (`Quantile(xs, 0.9, method = "nearest")`); a check-time hook refuses a literal outside its set with
  `bad_option`.
- Results with several values are records (`Record<Fit>`, `Record<Describe>`, `Record<Test>`, `Record<Histogram>`).
- The `f` field of a fit is a language `FunctionValue` of one number.
- The sort cache is a `WeakMap` from a list value to its sorted copy, so `Median`, `Q1`, `Q3` and `Describe` on the same
  list sort once.
- Warnings are notices (`S101` to `S107`).

## Decisions

- See "Decided against the design" in `requirements.md`.

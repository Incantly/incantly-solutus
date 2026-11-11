---
inclusion: always
---

# Structure

## Layout

```text
packages/
  kernel/     language, types, commands, rules, graph, clock, solver, errors (no DOM)
  plot/       function and curve sampling (no DOM)
  symbolic/   CAS, loaded on demand (no DOM)
  view/       our own 2D and 3D renderer, shared GPU context, figure scheduler
  audio/      sound with Tone.js, loaded on demand
  ui/         algebra view, toolbars, input bar, sheet, maths keyboard (Web Components)
  modes/      app mode records and exam profiles, as data (no DOM)
  sdk/        createApp, embed API, iframe protocol, file format, export
  tiptap/     the Tiptap extension: figure and formula nodes
  teacher/    the AI's draw and figure tools, catalogue, streaming apply
  server/     Node service: Muse Spark calls, keys, rate limits, headless checks
apps/
  studio/     the full web app, built on the SDK
docs/
  design/     core design, performance, libraries
  features/   one folder per feature area (design, errors, agent, ui)
  process/    the build pipeline
  research/   the engine study
handoff/      per-area pipeline notes: builder notes, test reports, findings, reviews
.kiro/
  steering/   these files, the hackathon rules and the Kiro usage log
  specs/      one spec per feature: requirements, design, tasks
  hooks/      agent hooks
```

## Who owns what

| Package or folder | Owns |
|---|---|
| `packages/kernel/src/language/` | Lexer, parser, checker, compiler, previews, autocomplete |
| `packages/kernel/src/graph/`, `clock/`, `history/`, `errors/` | Object store, dependency graph, updates, undo and redo, batches, clock and solver, save and load, the error registry |
| `packages/kernel/src/contracts/` | Shared contracts. Other areas only append to their registries. |
| `packages/kernel/src/commands/<area>/` | One folder per command area: `geometry`, `numbers`, `functions`, and later areas. Each plugs into the kernel through `CommandRegistry` and `registerTypeStyle`. |
| `packages/plot` | Sampling curves, implicit curves and regions into drawable data |
| `packages/symbolic` | Exact maths: simplify, factor, solve, calculus, steps |
| `packages/view` | Drawing, picking, drag, the figure scheduler and GPU budgets |
| `packages/audio` | Playing sound values from the kernel |
| `packages/ui` | Reusable UI components |
| `packages/modes` | Graphing, Geometry, 3D, CAS, Scientific and exam setups |
| `packages/sdk` | The public embed API and file format |
| `packages/tiptap` | Figures and formulas inside documents |
| `packages/teacher` | The model's tools and streaming |
| `packages/server` | Every model call and secret |
| `apps/studio` | Screens that wire the packages together |

## Branches

- Each area builds on `feat/<area>`, cut from `integration`.
- A finished area merges into `integration`; `integration` merges into `main` with the product owner's go-ahead.
- Never push to `main`.

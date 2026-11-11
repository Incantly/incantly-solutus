# Incantly

A voice-driven live blackboard for maths and science. A teacher speaks, and the figure is drawn and changed in real time: points, lines, curves, sliders, motion, particles and sound, all driven by a small formula language and the engine behind it.

Built with Kiro.

## Requirements

- Node.js 22.12 or later, with npm.
- macOS, Linux or Windows.

## Install

```sh
git clone https://github.com/Incantly/incantly-solutus.git
cd incantly-solutus
npm install
```

## Run

```sh
npm run studio     # the web app at http://127.0.0.1:5173
```

Open the address in a browser. Type a line such as `A = (1, 2)` or `c = Circle(A, 3)` into the input bar; the line list shows each object, its value and any error with a one-click fix. Undo, redo, rename, delete, sliders, save and load work from the studio. Drawing on a canvas arrives with the renderer area.

## Check

```sh
npm run check      # lint, typecheck and all tests
npm run lint       # ESLint only
npm run typecheck  # TypeScript only
npm test           # Vitest only
npm run bench      # benchmarks
```

## Layout

```text
packages/
  kernel/     language, types, commands, rules, graph, clock, solver, errors (no DOM)
  plot/       function and curve sampling (no DOM)
  symbolic/   CAS, loaded on demand
  view/       our own 2D and 3D renderer, shared GPU context, figure scheduler
  audio/      sound with Tone.js
  ui/         algebra view, toolbars, input bar, sheet, maths keyboard
  modes/      app mode records and exam profiles
  sdk/        createApp, embed API, file format, export
  tiptap/     the Tiptap extension
  teacher/    draw and figure tools, catalogue, streaming
  server/     model calls (Muse Spark), keys, headless checks
apps/
  studio/     the full web app
docs/
  design/     core design, performance, libraries
  features/   one folder per feature area
  process/    the build pipeline
  research/   the engine study
.kiro/
  steering/   product, tech, structure, hackathon rules, Kiro usage log
  specs/      one spec per feature area
  hooks/      agent hooks
```

Agents and contributors: read `AGENTS.md` first.

## Pre-existing work

This repository was started fresh on 2026-11-10 (commit `b091601`, "start fresh; previous implementation kept on legacy/v1"). Everything written before that point is pre-existing work and lives only on the `legacy/v1` branch (420 commits, 2026-10-20 to 2026-11-10):

| Path on `legacy/v1` | What it was |
|---|---|
| `packages/core` | The first SDK: an expression evaluator, 2D graphs, kits for particles, physics, mechanisms, sound and an SVG 3D engine |
| `packages/generation` | Prompt-to-figure generation (plan call plus scene call) |
| `packages/tiptap` | The first Tiptap extension and its figure scheduler |
| `apps/playground` | The first playground app, with films and live voice |

None of that code is on `main`. The current code was written after the fresh start, from the design docs in `docs/`. Two ideas were carried over as designs, not code: the figure scheduler rules (at most 3 live figures, pause off screen, a picture after 8 s) and the sound limits. Both are described in `docs/design/performance.md` and `docs/features/sound/design.md`.

## Third-party libraries

Only the libraries listed in `docs/design/libraries.md`, each under its own licence.

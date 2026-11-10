# Incantly

A formula engine for live, explorable maths and science figures, built for an AI teacher that draws while it talks. The previous implementation is kept on the `legacy/v1` branch.

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
```

## Commands

```sh
npm install
npm run check      # lint, typecheck, tests
npm run bench      # benchmarks
npm run studio     # the web app at http://127.0.0.1:5173
```

Agents: read `AGENTS.md` first.

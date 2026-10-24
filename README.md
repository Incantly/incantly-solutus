# Incantly Solutus

Incantly Solutus is the visualization SDK for turning concepts in a learner's notes into safe, interactive teaching figures.

The project is restarting from a deliberately small core. Begin with the [documentation index](docs/README.md) and the [vertical-slice implementation plan](docs/implementation/vertical-slice.md).

## Working on it

Node 22.12 or later. `npm install`, then:

| Command | What it does |
| --- | --- |
| `npm run check` | Lint, typecheck, unit tests and the engine size budget |
| `npm run test:e2e` | Browser tests in Chromium (`test:e2e:all` adds WebKit) |
| `npm run test:perf` | The performance suite for notes of 1 to 300 figures |
| `npm run dev --workspace @incantly/playground` | The playground, with the generation service on the reference model; `?page=generate` makes figures |
| `npm run serve` | The generation service; see `packages/generation/src/cli/serve.ts` for its settings |
| `npm run evals -- --model anthropic` | The generation evals against the model (needs `ANTHROPIC_API_KEY`); see [Generation pipeline](docs/architecture/generation-pipeline.md#evals) |
| `npm run release` | Builds the packages for GitHub Packages into `.release/`; see [Installing the SDK in other projects](docs/installing.md) |

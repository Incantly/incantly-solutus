# Teacher: design

The feature design is `docs/features/teacher/design.md`; this file says where each part lives.

## Package `packages/teacher/src/`

| Path | Holds |
|---|---|
| `tools/types.ts` | `ToolDef`, `Toolset`, `Target`, the tool result types |
| `tools/draw.ts`, `tools/figure.ts` | `draw` and `figure` over a target |
| `tools/film.ts` | `pause`, `resume`, `seek_beat`, `show_me` |
| `tools/board.ts` | `board_read` and `board`, wrapping the board core's runner |
| `tools/targets.ts` | `figureTarget(app)`, `boardTarget(board)` |
| `prompt/catalogue.ts` | The catalogue from the command table, filtered by mode, cached per mode, groups on demand |
| `prompt/grammar.ts` | The grammar summary |
| `prompt/jobs.ts` | The instructions per job, from `agent.md` |
| `prompt/build.ts` | `buildPrompt(job, target, request)`, token count |
| `loop/model.ts` | `ModelClient`, `ChatRequest`, `ChatEvent` (shared with the server) |
| `loop/turn.ts` | `runTurn(options)`: the loop over `TURN_MACHINE`, limits, retry budget, batch fingerprints |
| `loop/fake.ts` | `fakeModel(recording)` for tests and benches |
| `stream/split.ts` | The line splitter |
| `stream/apply.ts` | `streamFigure`: plan, script and repair calls |
| `errors.ts` | T001 to T006 through the kernel's error table |
| `index.ts` | Public exports |

## Rules

- Imports: `@incantly/kernel`, `@incantly/modes`, the SDK's headless app, `@incantly/board/core`. No web layer and no new library.
- Every state is one field over a `*_MACHINE` table; `TURN_MACHINE` goes in `docs/state-machines.md` (section "teacher") first. Every lint rule is an error in `packages/teacher`.
- Recorded model replies live in `packages/teacher/test/fixtures/`. No test calls the network.
- Tests are written by the tester from the docs, in `packages/teacher/test/spec/`.

## Changes to other areas

- `docs/features/errors/errors.md`: rows T003 to T006.
- Core design 10 and 11: OpenRouter is the default provider and Muse Spark the second; the teacher may import the SDK's headless app, `modes` and `board/core`.

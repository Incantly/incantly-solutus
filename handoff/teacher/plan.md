# Teacher and server: build plan

For the builder (Sonnet 5.5). Read `AGENTS.md`, `docs/features/teacher/*`, `docs/features/server/*`, `.kiro/specs/teacher/*`, `.kiro/specs/server/*`, `docs/features/errors/design.md` 3 and 6, `docs/features/board/agent.md`, `docs/design/performance.md`. The two packages are built together, round by round, on one branch per round cut from `integration`: `feat/teacher-r1` … `feat/teacher-r5`. Builders write no tests; a tester writes them in `packages/teacher/test/spec/` and `packages/server/test/spec/`. Opus does one review after the tester. No new library. No test or bench calls the network.

Existing code to build on, not to change in shape:

| What | Where |
|---|---|
| Line results, batches, summary | `packages/sdk/src/app.ts`: `createHeadlessApp`, `App.run`, `runBatch`, `figureSummary`, `undefinedObjects`, `LineResult` |
| SVG export | `exportFigure` from `@incantly/sdk` |
| Command forms in one line | `formText(name, form)` in `packages/kernel/src/language/table.ts`; the command specs through `sdkRegistry` |
| Mode policy and card | `getMode`, `compilePolicy`, `filterCatalogue`, `catalogueOf`, `modeCard` in `@incantly/modes` |
| Board tools and actions | `BOARD_TOOL`, `BOARD_READ_TOOL`, `BoardAgent`, `applyAction`, `readBoard` in `@incantly/board/core`; action types in `core/agent-types.ts` |
| Client contracts | Tiptap `AiRequest`, `AiEvent` (`packages/tiptap/src/types.ts`) for `/v1/figure/draw`; board `BoardAgentRequest`, `BoardAgentEvent` (`packages/board/src/core/agent-service.ts`) for `/v1/board/ask` |
| State machines | `StateMachine(table, start, onRefused)` from `@incantly/kernel` |
| Error objects | the kernel's error table (`packages/kernel/src/errors/`): add T003 to T006 there |

## Round 1: tools, prompt, loop; server basics

Teacher:

1. `docs/state-machines.md`, new section "teacher": `TURN_MACHINE` exactly as design 6. Section "server": `SERVER_JOB_MACHINE` as server design 7. Write these first and commit.
2. Errors T003 to T006 in the kernel's error table with message keys and templates from `errors.md`.
3. `tools/types.ts`: `ToolDef { name, description, schema, run(target, input): Result }`, `Toolset` (built from a list; `toolset(['draw', 'figure'])`, plus host tools), `Target` interface (design 9).
4. `tools/draw.ts`: check `{ lines: string[] }` (1 to 5, each a string, at most the SDK's line length), run each line with `target.run(line)` on its own, map to `{ ok: true, name, type, summary }` or the kernel's error unchanged, add `undefined`. A busy flag on the target is not a boolean field: the target holds a `TOOL_MACHINE` (`idle`, `running`) or the loop's machine; `tool_busy` when running.
5. `tools/figure.ts`; `tools/targets.ts` `figureTarget(app)`.
6. `prompt/catalogue.ts`: for a mode, every command spec's forms through `formText`, filtered by `filterCatalogue(compilePolicy(mode), catalogueOf(specs))`, grouped by group, cached per mode id. Groups on demand past 2,000 tokens (4 characters a token): the always-loaded groups, a one-line index of the rest, and `withGroups(names)`.
7. `prompt/grammar.ts` (about 300 tokens, from `docs/features/language/`), `prompt/jobs.ts` (the four jobs of `agent.md`), `prompt/build.ts` `buildPrompt(job, target, request) -> { system, messages, tokens }`. The user's material goes in a block that starts `<material>` and ends `</material>` with any such tags inside it escaped.
8. `loop/model.ts`: `ModelClient`, `ChatRequest { system, messages, tools, vision? }`, `ChatEvent` (server design 4). `loop/fake.ts`: `fakeModel(recording)` replaying replies in order; a recording is JSON in `test/fixtures/`.
9. `loop/turn.ts`: `runTurn({ job, client, toolset, target, request, signal, now })` as an async iterable of `{ say } | { lines } | { actions } | { control } | { done, notices } | { error }`. Limits, retry budget by fingerprint, batch fingerprints (three same kinds, nothing passing: run `figure` and pass its result), abort.

Server:

10. Package setup: `packages/server/vite.config.ts` (SSR build for Node into ignored `dist/`), root scripts `server` and `smoke:models` (server tasks design), ESLint: Node globals for `packages/server` only.
11. `env.ts` `readSettings(env)`: every setting of design 3 with defaults; `config_invalid` for a non-`:free` id, bad port, unknown provider.
12. `http/`: `createServer({ settings, client?, log })` on `node:http`; route table; body limits; JSON parse; picture magic numbers; CORS from `ALLOWED_ORIGINS` (requests with no `Origin` header pass: they are not from a browser); NDJSON writer flushed per event, abort on `close`.
13. `limits/rate.ts`: per-client sliding minute counter, one model request at a time per client (a newer one aborts the older), daily counter reset at UTC midnight from the injected clock.
14. `log.ts`: one JSON line per event to a passed stream; drops `authorization` and fields whose name holds `key` or `token`; never request bodies.
15. `/v1/health`, `/v1/check` (a headless app with the request's `mode`; per-line results as `draw`), `not_found`, `internal` with a fingerprint.

## Round 2: OpenRouter and prompt to figure

1. `providers/sse.ts`: read `data:` lines, `[DONE]`, comment lines; join `tool_calls[i].function.arguments` pieces by index; emit a tool call when its arguments parse as JSON or the choice ends.
2. `providers/openrouter.ts`: `POST https://openrouter.ai/api/v1/chat/completions`, `stream: true`, OpenAI-style `tools`, a picture as an `image_url` data URL; headers `HTTP-Referer` and `X-Title: Incantly`.
3. `providers/fallback.ts`: order, 429/5xx/network/15 s first byte pass on; 60 s skip after 429; `model_busy` with `retryAfterMs`; never switch after output started.
4. Teacher `stream/split.ts` and `stream/apply.ts` `streamFigure` (design 7).
5. `jobs/figure.ts`: Tiptap's `AiRequest` in, `lines`/`done`/`error` out; every line checked on a headless copy (server design 5).
6. Studio: Vite proxy `/v1` to `127.0.0.1:8787`; probe `/v1/health` at start; Tiptap demo and AI panel use `httpTransport('')` (same origin) when the server answers.
7. Recorded OpenRouter streams (one text reply, one with two tool calls split in pieces, a 429) in `packages/server/test/fixtures/`, captured once by hand with the key and checked in with no key in them.

## Round 3: the board on the real AI

1. Teacher `tools/board.ts` over `boardTarget(board)`: on the server the target holds the request's items for `board_read`, and checks `board` actions with the board's action checks; ids and placing stay with the client.
2. `jobs/board.ts`: circle and talk requests; a picture uses the vision list; `figure` actions' lines are checked on a headless app per card.
3. Studio: the board uses `httpAgentTransport('')` when the server answers, the "no AI" demo agent otherwise.

## Round 4: voice

1. Teacher film tools (`pause`, `resume`, `seek_beat`, `show_me`) and the live job; `say` events per sentence.
2. `jobs/teach.ts` (`/v1/teach`, request of server design 6) and `jobs/speech.ts` (`/v1/speech`: OpenRouter `POST /api/v1/audio/speech`, Fish as MP3 then HeyGen as PCM with `OPENROUTER_SPEECH_VOICE`, streamed through; 500 characters; one tenth of a request in the rate limit).
3. Studio voice lesson: a Talk button in the board and graphing views; browser speech recognition (text box where missing); a sentence queue that fetches `/v1/speech` ahead and plays in order (audio element for MP3, Web Audio for PCM at the `x-sample-rate` header); browser speech synthesis when the voice fails; barge-in stops playback, drops the queue and aborts the turn. Its states are one machine (`VOICE_MACHINE`: `idle`, `listening`, `thinking`, `speaking`), written in `docs/state-machines.md` first.
4. The three acceptance lessons (pendulum, area under a curve, fire) as recordings replayed with `fakeModel`.

## Round 5: finish

1. `/v1/export/svg`.
2. Benches: `packages/teacher/bench/` (design 10) and `packages/server/bench/` (design 9), with the fake model; results in `handoff/teacher/bench.md`.
3. `smoke:models`: one figure request, one board request, one speech request per configured model, with times; the error test set (20 broken lines with the request that made them) and the fix rate. Run once with the key; results in `handoff/teacher/bench.md`. About 60 calls.
4. Muse Spark client if its API docs are in `docs/`; else the stub stays and `handoff/teacher/findings.md` says so.
5. Screenshots in Chrome: Tiptap prompt to figure, circle to ask, the talking agent, a voice lesson, into `handoff/teacher/screens/`. README: how to run the server.
6. Tick tasks in both specs; usage-log rows.

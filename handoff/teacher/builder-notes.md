# Teacher and server: builder notes, round 1

Branch `feat/teacher-r1`. Round 1 of `handoff/teacher/plan.md` (items 1 to 15). No tests were written (testers do that); the builder ran scratch scripts only. `npm run lint`, `npm run typecheck` and `npx vitest run` pass (11,311 tests, 11 skipped, the same skips as before).

## What was built

| Item | Where |
|---|---|
| 1. State machines `TE1` turn, `TE2` tool guard, `SV1` request job | `docs/state-machines.md`, sections "teacher" and "server" (committed before the code) |
| 2. Errors T003 to T006 | `packages/kernel/src/contracts/errors.ts`, `language/errors.ts` (codes and templates), `errors/table.ts` (registry). `docs/features/errors/errors.md` already listed them |
| 3. Tool types, toolset, target | `packages/teacher/src/tools/types.ts`, `toolset.ts`, `guard.ts` (`TOOL_MACHINE`), `schema.ts` |
| 4. `draw` | `tools/draw.ts` |
| 5. `figure`, `figureTarget` | `tools/figure.ts`, `tools/targets.ts` |
| 6. Catalogue | `prompt/catalogue.ts` |
| 7. Grammar, jobs, `buildPrompt` | `prompt/grammar.ts`, `prompt/jobs.ts`, `prompt/build.ts`, `prompt/tokens.ts` |
| 8. Model client types, `fakeModel` | `loop/model.ts`, `loop/fake.ts` |
| 9. `runTurn` | `loop/turn.ts` (`TURN_MACHINE`), `loop/book.ts` (retry book, failure streak) |
| 10. Server package setup | `packages/server/vite.config.ts`, root scripts `server` and `smoke:models` (`tools/smoke-models.mjs`, a stub that exits 1), `eslint.config.js` |
| 11. Settings | `packages/server/src/env.ts` |
| 12. HTTP | `http/server.ts` (route table), `http/body.ts`, `http/cors.ts`, `http/ndjson.ts`, `jobs/job.ts` (`SERVER_JOB_MACHINE`), `jobs/context.ts` |
| 13. Limits | `limits/rate.ts` |
| 14. Log | `log.ts` |
| 15. Routes | `jobs/health.ts` (`GET /v1/health`), `jobs/check.ts` (`POST /v1/check`), `not_found` and `internal` in `http/server.ts` and `jobs/job.ts`; errors in `errors.ts` |
| Entry | `packages/server/src/main.ts`, `index.ts`; `packages/teacher/src/index.ts`, `errors.ts` |

`eslint.config.js` changes: `state-refusal-reported` now also covers `packages/teacher` and `packages/server`; the teacher gets the DOM-free globals (no `window`, timers, `fetch`, `Date`, `Math.random`) and may not import a package with a screen; the server gets "no page globals". All are errors.

Checked by hand (scratch scripts, no network): prompts of the four jobs are 2,900 to 3,900 tokens in the graphing, geometry, cas, classic and figure modes (under the 4,000 limit); a `draw` call, a turn with retry spent, the failure streak, the turn limit and a cut stream behave as designed; the built server (`vite build`, then `node dist/main.js` with `PORT=8799`, no `.env`) answered `/v1/health`, `/v1/check`, bad JSON (400), unknown route (404), a blocked origin (403) and a preflight (204). The oversized-body path (413) and the picture checks were not run by hand.

## Choices where the docs were silent

1. **`draw` runs the call's lines in one `target.run(lines)`** (the SDK runs each line on its own, in order, and keeps the batch line numbers) instead of one `run` per line, so `line` in each result is the line's place in the call. A line with a newline, an empty line or one over the kernel's line length is `tool_input` (T001); the schema alone does not say that.
2. **`draw` result shape:** `{ lines: [...], applied, undefined: [...], undefinedOmitted? }`. A good line is `{ ok, line, name?, type?, summary? }`; a bad line is the kernel or SDK error object unchanged. The model sees kernel errors in their compact form (`compactError`, errors design 3.5); the structured result keeps the full object.
3. **`figure` takes optional `names` and `type` filters** (language agent 3 asks for them; teacher design 4 says `{}`). It lists at most 100 objects and says how many it left out.
4. **Retry budget.** Keyed by the left side of a definition (`P`, `f(x)`, `A,B`), else the line text. A line is spent after three failures (the first plus two retries), or when the same text fails twice with the same fingerprint, or at once for the same text when the error's recovery is `skip` or `report`. A spent line is not run again: its place in the result is a `retry_spent` (T005) error and the final event carries a `retry_spent` notice. The next model call gets one extra `user` line: `Not drawn: P, t. ... Say only what was drawn.`
5. **Failure streak.** Three line results in a row with one error kind, none passing, make the loop answer the next `draw` call with the `figure` result (`{ draw: 'not run', why, figure }`) and not run it.
6. **Catalogue groups.** The catalogue is on demand past 2,000 tokens. Which groups load: the mode's first groups (`functions`, `controls` for graphing-like modes; `geometry`, `controls` for geometry, figure and classic) up to 1,800 tokens, then the groups the request's words need (a word table in `prompt/catalogue.ts`) and the groups of object types in the figure, then, on later model calls, the groups the turn's lines used (most recent first). Groups are picked in that order while the system text stays under 3,900 tokens, index lines included. Each group not loaded has one index line with a note and up to four command names. A command from an unloaded group is not refused (the kernel accepts it); the next call loads its group. I did not find a place where `unknown_command` carries forms, so "a line that names an unloaded command gets `unknown_command` with the right forms" is met by loading the group, not by an error.
7. **Prompt result:** `buildPrompt` returns `Result<{ system, messages, groups, tokens: { system, messages, total } }>`. `tokens.system` is what the 4,000 limit holds. The figure's own data (`THE FIGURE NOW`, at most 1,200 tokens) and the person's text go in the first user message; the person's text is in `<material>` with any `<material` or `</material` inside it escaped as `&lt;`.
8. **`ChatEvent` has a fourth member, `{ error }`**, for a failed call. An error of kind `stream_cut` ends the turn with a `stream_cut` notice (T006) and keeps what ran; any other kind ends it with that error event. Round 2's provider should send `stream_cut` when the SSE ends without `[DONE]`.
9. **`TURN_MACHINE` has two rows not in design 6:** `cut` (to `done`) and `modelError` from `running_tool` (the reply may still stream while a tool runs). Written in `docs/state-machines.md` TE1. A stop ends with a final `{ done: true, notices? }` event; a limit ends with an `error` event of kind `turn_limit` (T003).
10. **`say` events are the model's text pieces as they arrive**, not sentences. Round 4 ("say events per sentence") should add the sentence splitter.
11. **`runTurn` runs a tool call as soon as it arrives in the stream**, so `lines` events can come before the reply ends. The model's text still goes out first.
12. **`toolset(names, extra)` returns `Result<Toolset>`** (an unknown name is `tool_unknown`, a host tool that repeats a built-in name is `bad_argument`). Host tools named in `extra` but not in `names` are added too.
13. **`ToolGuard`** (`TOOL_MACHINE`) is held by the target, not by the loop, so two loops on one target also never overlap. It reports a refused move to the target's `onFault`.
14. **Server `/v1/check`:** request `{ lines: string[] (1 to 200), mode?: string (default graphing), script?: string }`; answer `{ ok: true, mode, lines, applied, undefined }`, the same line shape as `draw`. The 100-line target of server design 9 fits in the 200 cap. Not named in the docs, so a tester should treat the cap and the field names as mine.
15. **`/v1/health` answer:** `{ ok, provider, keySet, ready, models: { text, vision, speech }, limits }`. `ready` is true only when a `ModelClient` was passed to `createServer`; round 1 builds none, so it is false even with a key.
16. **A request is refused or answered through `Job`** (`SERVER_JOB_MACHINE`). Each handler validates its own body while the job is `received`, then calls `job.checked()`. Preflight (`OPTIONS`) answers 204 with the CORS headers; a request with no `Origin` header passes.
17. **Settings:** `ALLOWED_ORIGINS` entries must be plain origins; `TRUST_PROXY` is `0` or `1`; `PORT` may be 0 (a random port, for tests). Keys sit behind functions in `settings.secrets`, so `JSON.stringify(settings)` holds no key. `listen` returns `config_invalid` (not a throw) when the port is taken.
18. **Rate limiter:** `acquire(client, { weight, exclusive, controller })` and `takeModelCall()` exist and are exported, but no route uses them yet (no round 1 route calls a model). `daily_budget`'s `retryAfterMs` runs to the next UTC midnight.
19. **Log:** besides `authorization` and names holding `key` or `token`, the scrubber also drops fields named `body`, `text`, `script`, `messages`, `prompt`, `history`, `material` and `lines`, and cuts texts at 200 characters.
20. **`npm run server`** builds with Vite (`packages/server/dist`, ignored) and starts `node --env-file-if-exists=packages/server/.env`. I did not run it with the real `.env` (it holds a key; I never read it).

## Left undone, for later rounds or for the testers

- `/v1/figure/draw`, `/v1/board/ask`, `/v1/teach`, `/v1/speech`, `/v1/export/svg` and every provider (`providers/`) are rounds 2 to 5.
- No tests, no benches, no recordings in `test/fixtures/` (testers).
- `smoke:models` is a stub that fails on purpose.
- The picture checks (`checkPicture`) exist but no route reads a picture yet; the 2 MB picture body limit (`BODY_LIMIT_PICTURE`) is defined and unused.
- The 413 path and the preflight were only tried by hand for preflight; the daily and minute limits were never run.
- `tasks.md` of both specs is not ticked (as asked).
- A watch point for the tester: the built bundle is about 3.6 MB because `@incantly/sdk`'s index pulls in its screen code; the server uses only the headless app. Splitting that is a later change.

---

# Round 2: OpenRouter and prompt to figure

Branch `feat/teacher-r2`, cut from `integration` after round 1 merged. Items 1 to 7 of `handoff/teacher/plan.md` Round 2. No tests were written (testers do that); the builder ran scratch tests (deleted) over the fixtures, the fallback, `streamFigure` and the route with a fake model and a fake `fetch`. No network was reached and `packages/server/.env` was never read. `npm run lint`, `npm run typecheck` and `npx vitest run` pass.

## What was built

| Item | Where |
|---|---|
| State machines first: `TE3` figure stream, `SV2` model call through the fallback | `docs/state-machines.md` (two commits before the code) |
| 1. SSE reader and chunk joiner | `packages/server/src/providers/sse.ts`: `readSse`, `ChunkJoiner`, `chatEvents` |
| 2. OpenRouter client | `providers/openrouter.ts`: `openRouterOpener` (one model), `openRouterClient` (with the fallback), `requestBody` |
| 3. Fallback | `providers/fallback.ts`: `FallbackClient`, `CALL_MACHINE`; the job signal and the daily count in `jobs/model.ts` (`jobSignal`, `meteredClient`) |
| 4. Splitter and streaming apply | `packages/teacher/src/stream/split.ts` (`LineSplitter`, `cleanLine`, `splitLines`), `stream/apply.ts` (`streamFigure`, `FIGURE_STREAM_MACHINE`), `stream/race.ts` |
| 5. `POST /v1/figure/draw` | `packages/server/src/jobs/figure.ts`, route in `http/server.ts` |
| Wiring | `providers/client.ts` `clientFor(settings)`; `main.ts` builds the OpenRouter client when the key is set |
| 6. Studio | `apps/studio/vite.config.ts` (proxy `/v1` to `127.0.0.1:8787`, dev and preview), `apps/studio/src/server.ts` (`probeServer`), `apps/studio/src/notes.ts` (Tiptap demo) |
| 7. Fixtures | `packages/server/test/fixtures/`: `openrouter-text.sse`, `openrouter-tool-calls.sse`, `openrouter-429.json`, `openrouter-cut.sse`, `README.md` |

Other changes: `ChatImage` and an optional `images` list on the user `ChatMessage` (`packages/teacher/src/loop/model.ts`, exported), so a picture can reach `image_url`; error helpers in `packages/server/src/errors.ts` (`modelTimeout`, `modelBadOutput`, `toStreamError`, `fromStreamError`); exports in both `index.ts` files. I removed `/v1/figure/draw` from the "not there yet" list in `packages/server/test/spec/http.test.ts` (the route now exists; that test would fail). The `it.todo` for the no-key answer is untouched.

**The fixtures were written by hand** from OpenRouter's documented chat completions stream format. They are not live captures. A live capture is left for round 5's smoke run.

## Choices where the docs were silent

1. **SSE end.** A stream that ends with `[DONE]` or after a choice with a `finish_reason` is whole (`done`, with the model and usage). Any other end is a `stream_cut` error event. The reason: a reply that finished but lost `[DONE]` should not cut a turn that has tool results to send back. A tool call is given when its joined arguments parse as a JSON object, or at the `finish_reason`, with empty arguments as `{}`.
2. **Error text.** An HTTP status, a network failure or an error chunk becomes a fixed message (`model_busy` for 429 with `retryAfterMs` from `retry-after`, else 60 s; `model_unavailable` for anything else). The provider's own text is never passed on.
3. **First byte** is the first `ChatEvent` of a model (text, a tool call, `done` or an error). A role-only first chunk and `: OPENROUTER PROCESSING` comments do not count, so a model that only sends keep-alives for 15 s passes the call on.
4. **Pass on** happens for 429, 5xx, every other non-2xx status, a network error, no first byte in 15 s, and an error event before any output. Only a 429 (`model_busy`) starts the 60 s skip. When all passes were busy: `model_busy` with the shortest wait; all timeouts: `model_timeout`; any mix: `model_unavailable`. After the first event a model's error is forwarded as the last event, and a stream that ends with no `done` is a `stream_cut`.
5. **Daily budget** is counted once per `ModelClient.chat` call of a job (`meteredClient`), not once per HTTP attempt of the fallback, so it also holds with a fake client. A fallback that tries three models counts one. `daily_budget` is an error event from the client, so it answers HTTP 429 before the first event.
6. **Job signal** is `AbortSignal.any([client close, newer request of the same client, AbortSignal.timeout(60000)])`. The newer-request part comes from the limiter's `exclusive` slot (round 1 built it, round 2 is its first user). A superseded request ends with `done`, as a stop does.
7. **`streamFigure`:**
   - The plan call is skipped when `plan: 'never'`, when `choice` is given, or (`auto`) when the figure being edited has 1 or 2 objects. "An edit of fewer than 3 lines" has no line count at the target, so I used the object count.
   - The script and repair calls send no tools (`tools: []`; `tools` is left out of the request).
   - The splitter drops blank lines, lines that start with a code fence, comment-only lines (`#`) and a leading `1.`, `1)`, `-`, `*` or bullet. A last line with no newline counts when the reply was whole; a cut reply's last partial line is dropped.
   - Each line is applied alone through `target.run([line])`. A good line goes out at once as `{ lines: [line] }`. The tool guard is not used (the stream owns its target).
   - A failed line is kept with its error. After the script reply ends, one repair call gets the lines that passed and the failures (kernel errors in compact form). A replacement counts when a line with the same left side (`lineKey`) passes. Failures that stay are left out and reported as one `retry_spent` (T005) notice each in the final `done`.
   - A cut script call ends with `stream_cut` (T006) and no repair. A cut or failed repair call leaves the failures out and ends with `done`.
   - No line passed at all gives an `error` event of kind `model_bad_output` (errors.md), also when the model wrote nothing.
   - The script limit is `scriptChars` (default 64 KB, the server passes 64 KB less the request's script); past it the stream ends with `turn_limit`.
8. **`/v1/figure/draw`:** `request` 1 to 4,000 characters; `mode` a known mode; `script` up to 64 KB; `figure` an object, `null` or missing (it is not used: the summary comes from the headless copy); `before` and `after` are cut to their last and first 500 characters and go to the model as two `<material>` blocks. A missing key is a 503 before streaming. The slot (one model request at a time, `RATE_PER_MINUTE`) is taken after the checks pass. Errors before the first event are HTTP errors (`model_busy` is 503 with `retry-after`); `turn_limit` becomes `model_timeout`. The `done` event has no `notices` (Tiptap's `AiEvent` has none).
9. **Studio:** the notes demo opens its editor after `/v1/health` answers, and uses `httpTransport('')` only when the answer says `ready: true` (a key is set). A server with no key leaves the demo as before (`ai_unavailable`). The probe waits at most 1.5 s. Tiptap's `httpTransport` shows only the status for an HTTP error (`http_503`), not the server's message; the rate-limit and busy messages therefore do not reach the writer. Changing that is a Tiptap change and was not part of this round.
10. **Muse Spark:** `clientFor` gives no client for `MODEL_PROVIDER=muse` (round 5 item 4).

## Left undone

- No tests, benches or live capture (testers; round 5).
- No screenshot of Tiptap prompt to figure (optional in the brief): it needs a running server with a fake model, and there is no launcher for one yet. Round 5's screenshots cover it.
- `/v1/board/ask`, `/v1/teach`, `/v1/speech`, `/v1/export/svg`, the board and voice in the studio: rounds 3 to 5.
- The studio's board still uses the demo agent. The main studio page has no AI panel to switch; only the Tiptap demo page does.
- `tasks.md` of both specs is not ticked (as asked).

---

# Round 3: the board on the real AI

Branch `feat/teacher-r3`, cut from `integration` after round 2 merged. Items 1 to 3 of `handoff/teacher/plan.md` Round 3. No tests were written (testers do that); the builder ran a scratch spec over a fake model and the running route (deleted). No network was reached and `packages/server/.env` was never read. `npm run lint`, `npm run typecheck` and `npx vitest run` pass (12,323 tests, 11 skipped, 6 todo).

## What was built

| Item | Where |
|---|---|
| State note first (no new machine this round, and where each part gets its states) | `docs/state-machines.md`, "Round 3" under "teacher" (own commit, before the code) |
| 1. `board_read` and `board` tools | `packages/teacher/src/tools/board.ts` (definitions from the board core's `BOARD_READ_TOOL` and `BOARD_TOOL`), added to the built-in tools in `tools/toolset.ts` |
| 1. `boardTarget` | `tools/board-target.ts`: the request's items, page, `more`, circle, `allowEdit`, mode; `Target.board` (`BoardPort`, `BoardCheck` in `tools/types.ts`) |
| 2. Jobs `circle` and `talk` in the teacher | `loop/board.ts` `boardTurn`; `prompt/choices.ts` (what each circle choice asks, and its mode); `prompt/jobs.ts` (board rules and the example); `prompt/build.ts` (the board in the first message, `instruction` outside the material, `images`) |
| 2. `POST /v1/board/ask` | `packages/server/src/jobs/board.ts` `boardAsk`, `readBoardRequest`; route in `http/server.ts` |
| 3. Studio | `apps/studio/src/board-agent.ts`, `studio-page.ts` |

Board core changes (small, needed by the server's check): `AgentItem.madeBy?: 'model'`, set by `describeShape` from `meta.madeBy` (`core/agent-types.ts`, `core/agent-read.ts`); `EDITS_MINE` exported (`core/agent-service.ts`, `core/index.ts`) so the server decides a circle's `allowEdit` the way the board does. One existing spec changed: `packages/server/test/spec/http.test.ts` no longer lists `/v1/board/ask` among the 404 routes (the same thing round 2 did for `/v1/figure/draw`); its `it.todo` for the no-key answer is untouched.

Docs touched: `docs/features/board/agent.md` (1 and 3), `docs/features/teacher/agent.md` (1), `docs/features/teacher/design.md` (9), `docs/features/server/design.md` (6).

Checked by hand with a fake model on a real server (`createServer`, port 0): a circle `graph` request streamed `{actions}` then `{done}` with a figure card whose bad line was dropped (the model got the kernel error for it), an arrow with `$last`, and a delete of an item the agent made; a delete of the user's shape and a move of an unknown id were refused with `agent_refused` and not streamed. A request with a PNG `picture` reached the model with `vision: true` and an `image_url`-ready image on the first message; a bad picture was `picture_invalid` (400), an empty talk `bad_request`, and a model that made no action ended with an `error` event. System prompts of `circle` and `talk` are 3,189 to 3,351 tokens (graphing and geometry), `board_read` of two items about 56. I did not run a screenshot (see "Left undone").

## Choices where the docs were silent

1. **Tools of the board jobs are `board_read` and `board` only.** Agent.md 1 lists `draw` and `figure` too, but a board target has no figure of its own, and a scratch figure would let the model test lines that a `figure` action then checks on a fresh app, where names from the scratch would be missing. The `figure` action's result lists every line (the kernel's error objects, compacted for the model), which is the same feedback. `draw` and `figure` are still tools a host can add through `toolset(names)`; on a board target `target.run` answers an `internal` error per line.
2. **A `figure` action is checked on a fresh headless app per card** with the lines run independently (`blockedBy` as in `draw`), after splitting at newlines and dropping blank lines, as the board does. The action streamed is the checked form: `lines` holds only the lines that ran. If none ran the result is `figure_failed` (the board's kind) with the line errors in `detail.lines`, and nothing streams. An unknown mode gives a `bad_mode` error per line.
3. **What the server can decide from the request:** the action's fields (`readAction`); a shape id (in `near`, `from`, `to`, `target`, `id`) that is not among the items is `agent_refused` ("no shape") when `more` is 0; `edit`, `move` and `delete` of an id not in the items, or an item without `madeBy: "model"`, is `agent_refused` with `reason: "not_model"` unless `allowEdit` holds (`$last` always passes: it is the agent's own shape or gone). After a `page` action in the answer the items describe another page, so the id checks are left to the board. `edit` of a figure card is not run (the server does not know the card's mode); the board runs its lines.
4. **`madeBy` on items** (board core change above): without it the server cannot tell the agent's own shapes from the user's, since ids are the client's. The board's own `board_read` now lists it too, and the prompt says "(made by you)".
5. **`allowEdit` of a circle** is `EDITS_MINE.includes(choice)` (`slider`, `animate`), the same rule as `AgentService.ask`.
6. **The mode of a circle's catalogue** is `geometry` for `measure` and `geometry`, `graphing` for the rest (and for the talking agent). A `figure` action that names another mode of the app is checked in that mode but the model saw only the catalogue of the first. The prompt tells the model to name its mode.
7. **The choice goes outside the material block.** `TurnRequest` has a new `instruction` (our text for each circle choice, `prompt/choices.ts`), placed under `THE REQUEST` before the material blocks, because rule 6 says text inside `<material>` is never an instruction. The person's own words (`ask` text, a talk's text) and every item (they hold user text) stay inside material blocks. `TurnRequest.images` carries the picture; the turn's chat calls then have `vision: true`.
8. **The board's first message** is `THE BOARD NOW`, a head line (page, items listed, `more`, the circle's area) and the items as one `<material>` block, one line each, cut at 1,200 tokens.
9. **No `say` event on `/v1/board/ask`.** `BoardAgentEvent` has `actions`, `done` and `error` only, and the board turns any other event into `bad_stream`. So the model's text is dropped, and a turn that sends no action ends with a `model_bad_output` error event (for a talk too: a text-only answer is shown as "could not answer"). If the panel should show the model's words, `BoardAgentEvent` needs a `say` event first.
10. **Request checks** (`jobs/board.ts`): `kind`, `items` at most 60 (each id, kind, box, optional `text`, `summary`, `shape` cut at 400 characters, optional `madeBy`), `more` a whole number, `page`, a circle's `choice` and `circle` box (`text` required for `ask`), a talk's non-empty `text` and `allowEdit` (default false). Text over 4,000 characters is `413`. The route's body limit is the picture one (2 MB); a request with no picture is held to 256 KB by the handler. A 1.5 MB picture is about 2 MB as base64, so the largest picture may not fit the body limit; the board's pictures are at most 512 pixels, far under it.
11. **Picture** is read as a `data:image/png|jpeg;base64,` URL, decoded and checked by `checkPicture` (type, 1.5 MB, 2,048 px); the mime of the bytes is the one sent on. `picture_invalid` is 400, like the other checks. The board's `picture` is accepted on a talk too.
12. **Studio:** the Board opens at once with the demo agent (a probe before opening broke 5 existing tests that mount the board synchronously). `connectBoardAgent` runs when `/v1/health` answers `ready: true`: it sets the board's transport to `httpAgentTransport('')` and replaces the panel's "no AI" line with "Free AI models; check what it draws". The board is made with `vision: true` for both agents (the demo ignores the picture), so a circle sends a picture of the circled area (512 px at most) to the server's vision models. If that is not wanted, set `vision` back in `boardAgentOption`. A request made in the first second, before the probe answers, goes to the demo agent.
13. **Superseded and the daily budget** follow round 2 (`superseded` as the last event, the model call counted in `meteredClient`).

## Left undone, for the tester or later rounds

- No tests, benches or recordings (testers). The scratch spec showed the cases listed above; `packages/server/test/spec/` has no board spec yet. The `it.todo` for the no-key answer of `/v1/board/ask` is still a todo.
- No screenshot of circle to ask: it needs the studio and the server running with a fake model, and there is no launcher for a server with a fake client yet. Round 5's screenshots cover it.
- A target over a live `BoardAgent` (in-browser teacher) is not built: `BoardAgent.run` is asynchronous and the tools are synchronous. Round 4's live job decides how.
- `edit` of a figure card is not checked on the server (choice 3); the item list does not carry the card's mode or script.
- The model's words are not shown (choice 9).
- `tasks.md` of both specs is not ticked (as asked in the earlier rounds).
- Two edits in this round were made with `sed` and a short Python snippet (an anchored three-line replacement in `prompt/jobs.ts`, and five small replacements in `jobs/board.ts`) instead of the edit tool; both files were re-read and pass lint.

---

# Round 4: voice lessons

Branch `feat/teacher-r4`, cut from `integration` after round 3 merged. Items 1 to 4 of `handoff/teacher/plan.md` Round 4. No tests were written (testers do that); the builder ran scratch specs (deleted) over the live job, the film tools, the splitter, the two routes with a fake model and a fake `fetch`, and the studio's `VoiceLesson` with a fake network, fake clips and a fake recogniser. No network was reached and `packages/server/.env` was never read. `npm run lint`, `npm run typecheck` and `npx vitest run` pass (12,570 tests, 11 skipped, 6 todo). `npm run server` builds, and the built server answered `/v1/health` (with `voice`), and `model_unavailable` on `/v1/teach` and `/v1/speech` with no key.

## What was built

| Item | Where |
|---|---|
| State machines first: `TE4` voice lesson, `SV3` speech call and audio answer, a note for the teacher's round 4 parts | `docs/state-machines.md` (own commit, before the code) |
| 1. Film tools `pause`, `resume`, `seek_beat`, `show_me` | `packages/teacher/src/tools/film.ts`, added to the built-in tools in `tools/toolset.ts` |
| 1. Sentence splitter | `packages/teacher/src/stream/sentences.ts` (`SentenceSplitter`, `splitSentences`, `speakable`) |
| 1. The live job | `packages/teacher/src/loop/live.ts` (`liveTurn`, `liveTarget`, `liveTools`); the live instructions in `prompt/jobs.ts`; `prompt/build.ts` tells a board lesson its focus figure; `boardTarget`'s clock keeps the film time asked for |
| 2. `POST /v1/teach` | `packages/server/src/jobs/teach.ts` (`teach`, `readTeachRequest`), route in `http/server.ts`; `readItems` of `jobs/board.ts` is exported |
| 2. `POST /v1/speech` | `packages/server/src/jobs/speech.ts` (`speech`), `providers/speech.ts` (`OpenRouterSpeech`, `openRouterSpeech`, `SpeechClient`), `http/audio.ts`, `Job.audio`, `Job.chunk`, `Job.cut` in `jobs/job.ts`; `speechFor` in `providers/client.ts`; `speech` in `ServerOptions`, `Context`, `main.ts`; `voice` in `/v1/health`; `BODY_LIMIT_SPEECH` |
| 3. Studio voice lesson | `apps/studio/src/voice.ts` (`VoiceLesson`, `VOICE_MACHINE`, `SentenceQueue`), `voice-audio.ts` (clips from `/v1/speech`, the browser's voice, browser recognition), `voice-targets.ts` (`figureLesson`, `boardLesson`), `voice-ui.ts` (Talk button and panel), `teach-client.ts` (`streamTeach`), mounted in `studio-page.ts` (`Mounted.voice`), styles in `page.css` |
| 4. Acceptance lessons | `packages/teacher/test/fixtures/lesson-pendulum.json`, `lesson-area.json`, `lesson-fire.json` |

Docs touched: `docs/features/teacher/design.md` (4, 8, 9, 11), `agent.md` (1, 3, 6), `docs/features/server/design.md` (3, 6, 7), `errors.md`. `findings.md` has TR-34 to TR-39. `tasks.md` of both specs is not ticked.

One existing spec changed: `packages/server/test/spec/http.test.ts` no longer lists `/v1/teach` and `/v1/speech` among the 404 routes (the same change rounds 2 and 3 made for their routes).

## Choices where the docs were silent

1. **`show_me` with `to` and `seconds` moves at once.** The design says it writes a `SetValue` line; one line cannot glide. `seconds` is checked (above 0, at most 30) and reported in the result. A glide needs a protocol field (TR-34).
2. **Film tools send events to the client as well as moving the target's clock.** `pause` and `resume` send `control` events, `seek_beat` sends `{ op: "seek", t }` with the time the target stands at (clamped by the kernel on the server's copy), `show_me` sends its `SetValue` line as a `lines` event once it passed. The headless copy on the server has a ticker that never ticks, so `resume` changes only its play flag.
3. **`show_me` on a board** (target kind `board`) sends its line unchecked: the server has no figure of the card to check it on. The client applies it to the card made last, or the one in focus, which checks it again. `boardTarget`'s clock is a record of the time asked for.
4. **A board lesson's target** is the figure of the card in focus (the request's `script`, loaded into a headless app) with the board's port added (`liveTarget`). Its tools: `board_read`, `board`, the film tools, and `draw` and `figure` when that figure has objects. Teacher design 2 says a live lesson on a board "also keeps `draw` and `figure`"; with no figure of its own the board had nothing for them to act on (round 3, choice 1), so the focus card's script is what they act on. The first message adds "THE FIGURE IN FOCUS" after the board (TR-35).
5. **Request of `/v1/teach`:** `text` required (4,000 characters, `413`), `mode` default `graphing`, `script` at most 64 KB (`400`, as `/v1/figure/draw`), `t` 0 to 86,400, `board` `{ items, more?, page }` or `null`, `history` at most 10 turns (`400` over) and 8,000 characters (`413` over). Not named in the docs beyond design 6; a tester should treat these limits and statuses as mine.
6. **The sentence splitter** cuts at `.`, `!`, `?`, `…` and a line break when a space follows (so `2.5` waits for the next piece and `e.g.`, `i.e.`, `Dr.`, `Fig.` do not cut), cuts a run of 400 characters at a comma, semicolon, colon or space, drops `` ` ``, `*`, `#` and `$`, and drops text with no letter or digit. Anything that is not `say` (a tool's lines, actions, controls, `done`, an error) flushes what is pending first.
7. **`/v1/speech` is not an exclusive request.** It takes weight 0.1 in the minute but no model slot, because the studio fetches several sentences ahead at once and one sentence must not abort the one before. It takes no model call of the day. Body limit 16 KB. `instructions` (at most 200 characters) go only to models that are not HeyGen's.
8. **Which model is PCM** is decided by id: one that starts with `heygen/` is asked for `pcm` and the voice `OPENROUTER_SPEECH_VOICE`; any other is asked for `mp3`. A provider answer with a JSON or text content type is a failure that passes to the next voice. The sample rate is the provider's `x-sample-rate`, else `rate=` in its content type, else 24,000; the answer also sets `access-control-expose-headers: x-sample-rate`.
9. **The speech call's machine** is `CALL_MACHINE` of the fallback (SV2's table) in its own class (`providers/speech.ts`), with `exhausted` and `Pass` exported from `providers/fallback.ts` for it. An error before the first byte is an HTTP error (`model_busy` 503 with `retry-after`, `model_timeout` 504, `model_unavailable` 503); after it the response is ended where it is (`Job.cut`).
10. **The studio's lesson.** `VOICE_MACHINE` is TE4 exactly. The panel shows `speaking` only while a clip or the browser's voice is playing, and `thinking` while waiting for the model or the next clip. A clip is played whole (TR-36). A turn's `error` event shows its message in the transcript and ends the turn through the queue's end marker, so sentences already queued are still spoken. The history sent is the last 10 turns and 8,000 characters (`voice.ts`).
11. **The Talk button** shows in every mode whose views include `graphics` or `board`. It opens a panel; a first press starts listening where the browser can (`SpeechRecognition` or `webkitSpeechRecognition`); the text box is always in the panel (it is the input where recognition is missing, and a way to barge in by typing). The button calls `unlockAudio` so the browser lets the clips play.
12. **A board lesson's board actions** go through `view.agent.runner.run` (each call is its own undo step, not one gesture for the whole turn as `AgentService.ask` does). `$last` is reset when a turn begins (`runner.forget`).
13. **Recordings are hand-written**, not live captures, and carry extra fields (`lesson`, `note`, `mode`, `request`, `expect`) next to `replies`; `fakeModel` reads only `replies`. Each was replayed through `liveTurn` against a headless app of its mode: every line passes, and the figure ends with the objects in `expect`. A tester should replay them through `POST /v1/teach` as well.

## Left undone, for the tester or later rounds

- No tests, benches or live capture (testers; round 5). No test calls the network.
- No screenshot of the Talk panel (the optional one): the studio needs a running server with a fake model, and there is no launcher for one yet. Round 5's screenshots cover it.
- A timed `show_me` glide (TR-34), per-card scripts on a board lesson (TR-35), playing a clip while it streams (TR-36), a live check of the voices' formats (TR-37).
- The 413 path for `/v1/speech` text and the `retry-after` of an all-busy answer were tried by hand; the rate-limit weight of 0.1 was not run against the limiter's clock.
- `tasks.md` of both specs is not ticked (as asked in the earlier rounds).

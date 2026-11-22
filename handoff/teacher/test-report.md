# Teacher and server: test report, round 1

Branch `feat/teacher-r1` (draft PR #144). Tester run of 2026-11-22. Specs are in `packages/teacher/test/spec/` and `packages/server/test/spec/`; a bench in `packages/teacher/bench/`. Written from `docs/features/teacher/*`, `docs/features/server/*`, both `requirements.md`, `handoff/teacher/plan.md` round 1, `docs/state-machines.md` (TE1, TE2, SV1) and `docs/features/errors/design.md` 3 and 6. The builder's notes were read for its choices only. No test calls the network; servers run on port 0 of 127.0.0.1; `packages/server/.env` was never read.

## Counts

| Run | Files | Tests | Pass | Fail | Todo | Skipped |
|---|---|---|---|---|---|---|
| `--project teacher` | 6 | 306 | 303 | 3 | 0 | 0 |
| `--project server` | 8 | 271 | 258 | 4 | 9 | 0 |
| `npx vitest run packages/teacher packages/server` | 14 | 577 | 561 | 7 | 9 | 0 |
| `npx vitest run` (all) | 292 | 11,899 | 11,872 | 7 | 9 | 11 |

The 11 skipped tests are the ones that were skipped before this branch. All 7 failures are new tests of this report; every other test in the repo passes. `npm run lint` and `npm run typecheck` pass (no rule disabled). Bench (`npx vitest run --config packages/teacher/bench/vitest.config.ts`): prompt build 0.018 to 0.022 ms (target 2 ms), `draw` of 5 lines 0.005 ms over the kernel (target 0.2 ms), loop 0.21 ms per model call (target 1 ms).

## Failing tests (the code or the docs are wrong; the tests stay)

| # | Test | Rests on | What happens |
|---|---|---|---|
| 1 | `tools.test.ts` "the snippets of agent.md 3 draw as written" | `docs/features/teacher/agent.md` 3, second snippet: `t = Tangent(P, c)` | `t` is reserved (K003 `reserved_name`), so the doc's own example fails. **Doc error**, not code: `prompt/grammar.ts` says itself that `t` cannot name an object. Fix the doc and the example, use e.g. `tn`. |
| 2 | `prompt.test.ts` "every example line in the instructions draws without an error" | `agent.md` 3 (the text of `prompt/jobs.ts` copies it) | The live instructions teach `"P = PointOn(c)", "t = Tangent(P, c)"`: the same line fails, so the model is shown a line the kernel refuses. Code copies the doc error of #1. |
| 3 | `tools.test.ts` "a line that reads an object a failed line did not make is blocked by it" | `docs/features/errors/design.md` 6 rule 2, 3 (`blockedBy`, `recovery: 'fix_earlier'`) | `['m = zzz + 1', 'n = m + 1']` gives `unknown_name` and `create_first` on line 2, no `blockedBy`. Not in the teacher: `draw` passes the SDK's object on unchanged (R2.3). The gap is in the SDK or kernel batch. |
| 4 | `body.test.ts` "one byte over 1.5 MB is payload_too_large" | `docs/features/server/errors.md` rows `payload_too_large` ("Over the body, picture or text limits") and `picture_invalid` ("too large in pixels") | `checkPicture` answers `picture_invalid` for a picture over 1.5 MB. The docs give `payload_too_large` (413) for size in bytes and `picture_invalid` only for pixels. |
| 5 | `body.test.ts` "a very large body (10 MB) is refused and the server keeps serving" | `server/errors.md` `payload_too_large` 413; `design.md` 7 "A request that fails before streaming ... 413" | A body of 10 MB (chunked or with a content-length) gets a connection reset, and the client never sees the 413 (about 3 MB and up). Bodies just over the limit (256 KB + 10 B, +50 KB, 1 MB) do get 413. Fails in about 5 of 6 runs; it depends on how much the server has read when it closes. |
| 6 | `settings.test.ts` ".env.example lists every setting of design 3" | `server/requirements.md` R1.1, `design.md` 3 table | `.env.example` has no `HOST`, `PORT`, `ALLOWED_ORIGINS`, `RATE_PER_MINUTE` or `DAILY_MODEL_CALLS`. |
| 7 | `settings.test.ts` ".env.example says to send no student data to free models" | `server/design.md` 7 "Data" ("the README and `.env.example` say") | `.env.example` carries no such warning. |

## Contradictions between documents, and builder choices against the docs

| Where | What | What the tests follow |
|---|---|---|
| `teacher/design.md` 6 table vs `state-machines.md` TE1 | TE1 adds three rows: `calling` and `running_tool` on `cut` to `done`, and `running_tool` on `modelError` to `failed`. Design 6 says "every other move is refused". | `machines.test.ts` checks every design 6 row, then that the table is exactly design 6 plus the TE1 rows. No test fails. Pick one document. |
| `server/design.md` 7 table vs SV1 | SV1 adds `received` on `fail` to `failed`. Design 7 has no such row. | `jobs.test.ts`, same way. |
| `teacher/requirements.md` R4.4 vs `design.md` 6 | R4.4: "run `figure` before the next model call". Design 6: "passes its result in place of the fourth call". Builder (choice 5) follows design 6. | Design 6: the next `draw` call is answered with the `figure` result and is not run. |
| `errors/design.md` 6 rule 3 vs `errors/errors.md` T005 | Rule 3: stop when "the second retry's error" equals the first. T005: "or with the same fingerprint twice". Builder stops after two equal fingerprints. | T005: the same text with the same fingerprint is run at most twice. A line (named by its left side) with different failures is run at most three times. |
| `teacher/design.md` 5 vs R3.3 | Design 5: a line naming an unloaded command "gets `unknown_command` with the right forms". R3.3: its group loads on the next call. The kernel accepts the line, so there is no such error (builder choice 6). | R3.3 only. |
| `teacher/design.md` 4 vs builder choice 3 | `figure` takes `{}` in the doc; the builder adds optional `names` and `type`. | `{}` works; no test on the extras. |
| `server/errors.md` | `model_timeout` has HTTP "stream" only; `STATUS` gives it 504. `config_invalid` is "none"; `STATUS` has 500. | Not tested. Harmless, but the table should say. |

## Doc gaps (tests had to pick a name; change the test when the doc names it)

| Gap | Used by |
|---|---|
| The shape of the `draw` result is not given beyond "per line ... plus `undefined`". Tests read `lines` (list) and `undefined` (names and reasons). | `tools.test.ts`, `turn.test.ts` |
| The shape of the `figure` result: tests read `objects` (each with `name`, `type`, `summary`, `visible`) and `undefined`. | `tools.test.ts` |
| `/v1/check` request and answer are not given. Tests send `{ lines, mode?, script? }` and read `lines` of the answer, equal to the `draw` lines. | `http.test.ts` |
| `/v1/health` answer is not given. Tests look for the provider and every model id in the JSON, and that a key changes only booleans. | `http.test.ts` |
| The `retry-after` header is named in the doc for 429 only. | `stream.test.ts` |
| What a wrong method on a known path gets (404 or 405). | `http.test.ts` accepts both. |
| `TRUST_PROXY` is in `design.md` 7 but not in the settings table of 3 or in `.env.example`. | `settings.test.ts`, `stream.test.ts` |
| Whether a request with no `Origin` header passes. The docs say "browser requests", so it does; builder choice 16 agrees. | `http.test.ts` |
| "A line" for the retry budget is not defined. Tests treat the left side of a definition as the line's identity (builder choice 4). | `turn.test.ts` |
| The word table that loads groups for a request's words is not in the docs, so no test checks it. | none |

## What could not be tested in round 1 (9 `it.todo`)

The docs describe it; the routes come in rounds 2 to 5. The tests are written as todos with the round named.

- `model_unavailable` (503) on `/v1/figure/draw`, `/v1/board/ask`, `/v1/teach`, `/v1/speech` with no key, and `/v1/export/svg` working with no key.
- Text over 4,000 characters, a picture request body of 2 MB, a non-PNG/JPEG picture in a body, and a script over the SDK limit. The picture checker itself (`checkPicture`) is fully tested.
- The 60 s limit of a whole server turn, the providers, the fallback and the model call abort: no provider exists.

Since no model route exists, rate limit (429 and `retry-after`), daily budget, one request at a time per client, NDJSON flush, abort on close and the errors before and after the first event are tested over real HTTP through **test routes** that the spec adds to the exported `ROUTES` table for the life of one file (`addRoutes` in `packages/server/test/spec/helpers.ts`). These routes use the real server, job, limiter, origin and body checks, but the real model routes will need the same tests again when they exist. `RateLimiter` and the job machine are also tested on their own.

## Other results worth knowing

- 10 hostile `<material>` cases (closing tag, upper case, spaces, attributes, many tags), each in the person's text and in extra material: all keep one open and one close tag per block.
- All 9 modes: no command the gate refuses is in the catalogue, its groups or the prompt's catalogue lines. All 4 jobs in all 9 modes are under 4,000 tokens.
- The three limits (8 model calls, 24 tool calls, 60 s on the injected clock), their boundaries (8, 24 and 59 s pass), abort at four points, three same-kind failures, and every row of `TURN_MACHINE`, `TOOL_MACHINE` and `SERVER_JOB_MACHINE` (each state times each move: a move with no row is refused and reported) pass.
- Log: 15 secret-like field names, nesting, bodies and a full server run with a key, bearer, cookie and `?token=` in the requests: none appears in the log.
- Hardened inputs (names such as `__proto__`, NUL, lone surrogates, 100,000-character lines, 200,000-character requests) give results, never a throw.

## Harness notes

- The tester read these implementation files to build the harness only (how to wire a `Target`, a test route, the job and the limiter), not to set expected values: `packages/server/src/http/server.ts`, `jobs/job.ts`, `jobs/context.ts`, `limits/rate.ts`, `log.ts`, `http/body.ts`, and the type files and exports of the teacher.
- The firecrawl MCP server did not start in this session; nothing here needed it.

---

# Round 2

Branch `feat/teacher-r2` (draft PR #145). Tester run of 2026-11-22. New specs: `packages/teacher/test/spec/split.test.ts`, `figure-stream.test.ts`, `machines-r2.test.ts`; `packages/server/test/spec/sse.test.ts`, `openrouter.test.ts`, `fallback.test.ts`, `figure-draw.test.ts` (helpers in `r2-helpers.ts`); benches `packages/teacher/bench/stream.bench.ts` and `packages/server/bench/server.bench.ts` (own `vitest.config.ts`). Three round 1 `it.todo` became real tests (`http.test.ts` no key on `/v1/figure/draw`; `body.test.ts` text over 4,000 characters and script over the limit). Written from teacher design 7, server design 4 to 7 and `errors.md`, server requirements R1.4, R2.1, R2.5, R3, R4.1, R5, R7.2, teacher R5, `plan.md` round 2 (TR-6 included), `docs/state-machines.md` TE3 and SV2, and Tiptap's `AiRequest`, `AiEvent` and `httpTransport`. The builder's "Round 2" notes were read for its choices only. No test reaches the network (the model is `FakeFetch`, a `fetch` the test passes; the server and Tiptap's `httpTransport` talk over 127.0.0.1 on port 0) and `packages/server/.env` was never read. The fixtures are the hand-written ones in `packages/server/test/fixtures/`.

## Counts

| Run | Files | Tests | Pass | Fail | Todo | Skipped |
|---|---|---|---|---|---|---|
| New teacher specs (3 files) | 3 | 169 | 169 | 0 | 0 | 0 |
| New server specs (4 files) | 4 | 222 | 218 | 4 | 0 | 0 |
| `--project teacher` | 10 | 481 | 481 | 0 | 0 | 0 |
| `--project server` | 13 | 501 | 490 | 5 | 6 | 0 |
| `npx vitest run` (all) | 301 | 12,319 | 12,297 | 5 | 6 | 11 |

The 11 skipped tests were skipped before this branch. All 5 failures are new tests of this round (one sits in `body.test.ts`, one in `sse.test.ts`, three in `figure-draw.test.ts`); every other test in the repo passes, four runs in a row (no flaky test seen). `npm run lint` and `npm run typecheck` pass (no rule disabled). Six `it.todo` remain, for routes that do not exist yet: `/v1/board/ask`, `/v1/teach`, `/v1/speech`, `/v1/export/svg` with no key (`http.test.ts`), and a picture body of 2 MB and a non-image picture (`body.test.ts`, round 3).

Benches (`npx vitest run --config packages/teacher/bench/vitest.config.ts`, `... packages/server/bench/vitest.config.ts`), fake model, warm:

| Measure | Target | Result |
|---|---|---|
| Splitter and apply, per streamed line (teacher design 10) | under 1 ms | 0.027 to 0.036 ms (a line a piece, or 3-character pieces; graphing and geometry) |
| Model's line to the line leaving the server (server design 9) | under 5 ms | 0.20 ms median, 0.17 ms best (over a real socket on loopback) |
| Request to the model call: connection, checks, headless copy (design 9, "overhead per request") | under 5 ms | 2.4 ms median |
| `/v1/check` of 100 lines (design 9) | under 50 ms | 4.8 ms median |

I broke the code on purpose in six places (the 60 s skip made 30 s; the 429 branch of the fallback removed; a failed line let through; code fences not dropped; a missing `[DONE]` no longer a cut; the job signal without the deadline) and each change made 3 to 12 tests fail. The files were restored afterwards.

## Failing tests (the code or the docs are wrong; the tests stay)

| # | Test | Rests on | What happens |
|---|---|---|---|
| 1 | `body.test.ts` "typed text over 4,000 characters on /v1/figure/draw is 413 payload_too_large" | `server/design.md` 7 ("Spoken or typed text: 4,000 characters"); `errors.md` row `payload_too_large` 413 ("Over the body, picture or text limits") | The route answers `400 bad_request` (`jobs/figure.ts` `REQUEST_CHARS`). Same text limit, the other kind. |
| 2 | `sse.test.ts` "after a finish_reason and usage but with no [DONE] marker" | `plan.md` round 2 item 1 and builder notes round 1 item 8 ("send `stream_cut` when the SSE ends without `[DONE]`"); `state-machines.md` SV2 `streaming` on `fail` ("the stream ended without `done`") | A stream that ended after a `finish_reason` and a usage chunk, with no `[DONE]`, is a whole reply (`done`). Builder choice 1 of round 2. Decide: keep the choice and change the docs, or follow the docs. |
| 3 | `figure-draw.test.ts` "no line passed at all: model_bad_output ... sent as an error event of the stream" | `errors.md` row `model_bad_output`, HTTP column "stream"; message "The AI could not draw this." | Nothing was streamed before the error, so the job answers an HTTP `502` with the error as the JSON body (`STATUS` table). A stream answer (`200`, one `{ "error": ... }` line) is what `errors.md` lists. |
| 4 | `figure-draw.test.ts` "Tiptap's transport turns that error into its own event, with the server's kind" | `errors.md` (same row); Tiptap's `httpTransport` | Same cause as 3: the writer gets `http_502`, and the words "The AI could not draw this." never reach Tiptap, because its transport shows only the status of an HTTP error. |
| 5 | `figure-draw.test.ts` "when the model sends nothing for the whole turn: model_timeout as a stream event, not a bare status" | `errors.md` row `model_timeout`, HTTP column "stream"; design 7 "Whole turn 60 s" | The deadline passes with nothing written, so the answer is an HTTP `504` JSON body. Same pattern as 3. When some line went out first, the error is a stream event, and that case passes. |

Tests 3 to 5 share one root: `errors.md` gives `model_bad_output` and `model_timeout` only as stream events, while `docs/state-machines.md` SV1 and design 6 say an error before the first event is an HTTP error. The two documents disagree; the tests follow `errors.md` because it names the kind. `model_busy` and `model_unavailable` are "503 or stream" in `errors.md`, and their tests accept both.

## Contradictions between documents, and builder choices against the docs

| Where | What | What the tests follow |
|---|---|---|
| `errors.md` vs SV1 and design 6 | See the note under the failing tests: `stream`-only kinds against "an error before the first event is an HTTP error". | `errors.md` (tests 3 to 5). |
| design 7 limits table vs `jobs/figure.ts` | Text over 4,000 characters: 413 in `errors.md`, 400 in the code (test 1). A script over the script limit has no status in the docs; the code gives 400. | 413 for text; 400 or 413 for a script. |
| plan item 1, SV2 vs builder choice 1 | A `finish_reason` with no `[DONE]` is whole in the code (test 2). | The docs. |
| design 4 "no first byte within 15 s" vs builder choice 3 | The code counts the first chat event (text, call, done, error) as the first byte, so a model that sends only keep-alive comments or a role-only chunk is passed on at 15 s. SV2 says "the first event of a model is its first byte", so SV2 and the code agree and design 4 is loose. | Chat events (SV2); no test on keep-alives. |
| design 7 step 1 ("an edit of fewer than 3 lines") vs builder choice 7 | The code counts the figure's objects, not lines. One line can make several objects (`A, B = ...`), and comments or blank lines are lines but no object. | Scripts where lines and objects are the same. |
| design 7 last bullet ("capped at the target's script limit") vs `FigureLimits.scriptChars` | The cap is an option the caller passes (the route passes 64 KB less the request's script), not a property of the target. | The option. |
| design 6 `{ "error": { "kind", "message", "hint"?, "detail"? } }` vs `errors.md` (SDK shape with `ok: false`) | The stream's error event carries `ok: false` besides. Tiptap's `parseEvent` ignores it. | Either (the test allows `ok: false`). |
| design 4 ("or a reply with tool calls when the model is known not to support them") | Not built: there is no list of such models. | Not tested. |
| `figure/draw` `done` event vs R5.4, T005, T006 | The teacher's notices (`stream_cut`, `retry_spent`) are dropped by the route: the writer sees a plain `{ "done": true }` after a cut answer or a line left out, and cannot tell. Tiptap's `AiEvent` has no place for them. | After a cut, the stream ends with `done` or `error` and no later line. |
| design 7 "a newer one aborts the older" | What the older client is told is not written. The code ends it with `done` (a clean end, as a stop does), so Tiptap commits the lines it had. | The older request ends, its model call is aborted and it gets no `lines`. |

## Doc gaps (tests had to pick a name or a shape; change the test when the doc names it)

| Gap | Used by |
|---|---|
| `retry-after` on a 503 `model_busy`: design 7 names it for 429 only. The code sets it on both. | none (not asserted for 503) |
| `retryAfterMs` of an all-busy answer: only "with `retryAfterMs`". Tests need a number from 1 ms to 60 s that falls as the skip runs down. | `fallback.test.ts` |
| A mix of busy and failed models at the end of a call: the docs name only all-busy (`model_busy`) and all-timeout (`model_timeout`). Tests say only that a mix is not `model_busy`. | `fallback.test.ts` |
| Whether HTTP 4xx other than 429 (401, 404) passes on to the next model. The docs list 429, 5xx, network, 15 s. The code passes on any non-2xx. | none |
| What a leading `#` line or a bullet (`-`, `*`) in a model reply is. The docs say blanks, fences and numbers. The code also drops comment lines and bullets. | `split.test.ts` tests the comment line only |
| The plan call's content is not specified beyond "words, no lines"; tests check it gets the request, the mode, the catalogue and the script, and never leaves the server. | `figure-stream.test.ts` |
| The status for a script over the limit and for a 4,000-character text on the other routes. | `body.test.ts`, `figure-draw.test.ts` |
| An answer that was cut with no line at all: TE3 sends `cut` to `done`, and `unusable` is for a reply that "ended". A cut reply with no line passed is not named. | not tested |
| Daily budget: "model calls" is counted once per call of the model client (plan, script and repair each count; a fallback across three models counts one). | `figure-draw.test.ts` |
| Tiptap's `httpTransport` reports an HTTP error as `http_<status>` only, so `rate_limited`, `daily_budget` and `model_unavailable` (all HTTP) never show their messages to the writer. A client change, not a server one. | `figure-draw.test.ts` (asserts `http_503`) |
| The harness read these implementation files to wire its fakes (the shape of `ModelOpener`, `ChatEvent`, `Context`, `jobSignal`, `streamFigure` options, `Job` and `FallbackClient`), not to set expected values: `packages/server/src/providers/*`, `jobs/figure.ts`, `jobs/model.ts`, `jobs/job.ts`, `packages/teacher/src/stream/*`, `loop/model.ts`, `loop/fake.ts`. Two expectations are builder choices that the docs do not contradict: a `#` line is dropped; a repair request carries the kernel's error message. | |

## What the new tests cover

- **Line splitter (25):** newline cut, same lines at every cut position and in one-character pieces, CRLF, blank lines, code fences (with and without a language), `1.` and `2)` numbers, numbers inside a line left alone, the last line of a whole reply and the dropped half line of a cut one.
- **`streamFigure` (57):** each line applied at its newline (checked while the model is held), only passing lines emitted, one repair call (given the passing lines and the failure with the kernel's message), a replacement that fails again, `retry_spent` notices, `model_bad_output`, plan skip rules (new figure plans; 1 or 2 lines skip; 3 do not; `graph`, `solve`, `steps` skip), the plan never leaves, `stream_cut` notice, model errors, a client that throws, `AbortSignal` with a `TimeoutError` reason (turn_limit), another reason (a stop with a final `done`), a model that never speaks, the injected clock at 59 s and 61 s, and the script limit.
- **`FIGURE_STREAM_MACHINE` (87):** every row of TE3, no other row, every move with no row refused and reported.
- **SSE reader and joiner (33):** data lines, no-space `data:`, comments, multi-line data, `[DONE]`, CRLF, multi-byte characters cut anywhere, the fixtures cut in pieces of 1 byte and at each of 600 positions, text and tool call fixtures, argument pieces joined by index (also mixed), a call given only when its arguments are complete (held byte by byte), an error chunk with no provider text, end without `[DONE]`.
- **OpenRouter request (27):** URL, POST, `stream: true`, model id, message order, tools as `function` objects, data URL pictures, key only in `authorization`, `X-Title`, no key, the key quoted by a failed network or a 401 body (never in an event), abort reaching `fetch`.
- **Fallback and SV2 (86):** order, 429, 500, 502, 503, 504, network, an error chunk before output, 15 s on fake timers (14.999 s does not pass on; a first byte at 14 s keeps the model; slow between pieces is fine), 60 s skip (59.999 s skipped, 60 s asked; 500 and network start no skip; a skip is per model and per list), all busy, all failed, all silent, never switching after output, vision list, abort before, during and after output, every row of SV2.
- **`/v1/figure/draw` (76), with Tiptap's `httpTransport` against the real server:** the events as Tiptap reads them, NDJSON headers, one or two or three model calls, the key only in the header, fallback through the route, every line checked before it streams (a failed line never reaches the client, replacements stream, everything received loads on a fresh figure), error events, no key (503, "The AI is not set up.", `/v1/check` still works), request validation (400, 413, 403, GET), rate limit with `retry-after` and a new minute, per-client counting behind `TRUST_PROXY`, newer request aborts the older, daily budget (and the next UTC day), flush while the model still writes, abort when the client closes, 60 s deadline (`AbortSignal.timeout(60000)` spied; fired by hand; the server's own clock at 59 s and 61 s), no key or body or provider text in the log or in an answer, and twenty clients at once.

## Not tested

- `/v1/board/ask`, `/v1/teach`, `/v1/speech`, `/v1/export/svg` and the picture routes (rounds 3 to 5).
- A real 60 s wait: the deadline is tested by spying `AbortSignal.timeout` and firing it, and by the injected clock.
- `smoke:models` and the live model capture (round 5).
- The firecrawl MCP server did not start in this session; nothing here needed it.

---

# Round 3

Branch `feat/teacher-r3` (draft PR #146). Tester run of 2026-11-22. New specs: `packages/teacher/test/spec/board-tools.test.ts`, `board-jobs.test.ts` (helpers in `board-helpers.ts`); `packages/server/test/spec/board-ask.test.ts` (helpers in `board-helpers.ts`); `apps/studio/test/board-agent.test.ts`; benches `packages/teacher/bench/board.bench.ts` and `packages/server/bench/board.bench.ts`. Written from `docs/features/board/agent.md` (all) and board design 11, teacher design 4, 5, 9 and `agent.md` 1 and 5, server design 5, 6, 7 and `errors.md` with the round 2 rulings (`review-r2.md`: checks answer with an HTTP status, every later error is a stream event, `superseded`, notices on `done`), teacher R2.1, R6, server R2.2, R3.3, R4.2, R7.2. The builder's "Round 3" notes were read for its choices only. No test reaches the network: the model is `FakeFetch` (a `fetch` the test passes), the server and the board's `httpAgentTransport` talk over 127.0.0.1 on port 0; `packages/server/.env` was never read. No implementation file was changed and no lint rule was disabled. The firecrawl MCP server did not start in this session; nothing here needed it.

## Counts

| Run | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| `board-tools.test.ts` (teacher) | 1 | 109 | 104 | 5 |
| `board-jobs.test.ts` (teacher) | 1 | 46 | 46 | 0 |
| `board-ask.test.ts` (server) | 1 | 64 | 62 | 2 |
| `board-agent.test.ts` (studio) | 1 | 15 | 15 | 0 |
| New in total | 4 | 234 | 227 | 7 |
| `--project teacher` | 12 | 636 | 631 | 5 |
| `--project server` | 15 | 577 (6 todo) | 569 | 2 |
| `--project studio` | 24 | 556 | 556 | 0 |
| `npx vitest run` (whole repo) | 308 | 12,574 (11 skipped, 6 todo) | 12,550 | 7 |

`npm run lint` and `npm run typecheck` pass. The 7 failing tests are all new; every other test in the repo passes.

## Benches

Run with `npx vitest run --config packages/teacher/bench/vitest.config.ts` and `--config packages/server/bench/vitest.config.ts`. The docs give no budget for `board_read` or the checks of a `board` call, so those use loose limits (1 ms, 2 ms); the other rows use design 9 and 10. All pass.

| Measure | Result | Limit |
|---|---|---|
| `board_read`, 60 items | 0.002 ms | 1 ms |
| `board_read`, an area of 600 items (cut at 60) | 0.020 ms | 1 ms |
| `board`, 20 write actions checked | 0.067 ms | 2 ms |
| `board`, 20 actions, half refused | 0.062 ms | 2 ms |
| `board`, one figure card of 5 lines (headless app) | 2.27 ms | 5 ms |
| `buildPrompt` circle / talk with 60 items | 0.028 / 0.026 ms | 2 ms (design 10) |
| `boardTurn` overhead per model call | 0.027 ms | 1 ms (design 10) |
| Server: request to the model call (60 items and a picture) | 0.79 ms median | 5 ms (design 9) |
| Server: tool call complete to actions leaving the server | 2.99 ms median | 5 ms (design 9) |
| Server: whole circle turn, two fake model calls | 3.67 ms median | 25 ms (own limit) |

## Failing tests (the code or the docs are wrong; the tests stay)

| # | Test | Rests on | What happens |
|---|---|---|---|
| 1 | `board-tools` "board_read says what the board lists, madeBy included" | board agent.md 1 (the item list holds `madeBy`, and the server's check reads it) | The tool's description comes from the board core's `BOARD_READ_TOOL` and lists `{ id, kind, box, text?, summary?, shape? }`: no `madeBy`. The first message does mark such items "(made by you)", so the model can still tell. |
| 2 to 5 | `board-tools` "shape of a kind that is not one / stroke with a point that has one number / figure with a line that is not text / mark with a way that is not one: only that action fails; the actions around it still run" | board agent.md 2: "An action that fails changes nothing and does not stop the actions after it" | `tools/board.ts` checks the whole call against the tool's JSON schema first (`checkSchema`). One action that breaks the schema (an enum, a nested type) makes the whole call `tool_input` T001, so the other actions are not run. Fields the schema does not name (a text of 4,001 characters, a size of 3, 1 point) are refused per action as the doc says. One root cause. |
| 6 | `board-ask` "a model that wrote no action that passed ends with model_bad_output 'The AI could not draw this.'" | server errors.md row `model_bad_output`, message | The message is "The model sent no board action that passed its checks." (`loop/board.ts`). The kind and the stream shape are right. |
| 7 | `board-ask` "a picture of exactly 1.5 MB is accepted" | server design 7 (picture at most 1.5 MB; body 2 MB with a picture) | The base64 text of a 1.5 MB picture is 2,097,152 characters, which is the whole body limit, so with the JSON around it the body is over 2 MB and the answer is `413`. The largest picture that gets through is a few hundred bytes under 1.5 MB. The builder's notes say so (choice 10). Raise the route limit by a little or lower the picture limit. |

## Contradictions between documents, and builder choices against the docs

| Where | What | What the tests follow |
|---|---|---|
| teacher errors.md T001 ("21 actions to `board`") vs board agent.md 2 (`agent_refused` for "more than 20 actions in the call") | The teacher's tool answers `tool_input` T001; the board's own runner answers `agent_refused`. | errors.md and teacher design 4 (T001). |
| board agent.md 1 (live teacher keeps `draw` and `figure` and gains the board tools) and teacher design 2 ("`board_read`, `board`, `draw` and `figure` for the board") vs teacher agent.md 1 and design 9 (`circle` and `talk`: `board_read` and `board` only) | The code follows agent.md 1 of the teacher and design 9. | Two tools for `circle` and `talk`. |
| board agent.md 1 (`board` gives per action `{ ok: true, id }`) vs server design 5 ("ids are the client's job") | The server's result is `{ ok: true }` with no id, so the model learns an id only through `$last`. | The tests require `ok: true`, not an id. |
| teacher agent.md 6 (circle and talk prompts "about 2,500 tokens, plus the items") vs the builder | The system text is 3,238 (talk, graphing) to 3,498 tokens (circle, geometry), over the target by about a third, under the hard limit of 4,000. | The hard limit (4,000); the "about 2,500" is not asserted. |
| server design 3 (health lists the provider, the models and `keySet`) vs the studio | The studio and the tests read `ready` (a model endpoint can answer), which the doc does not name. | `ready`. |
| board agent.md 3 (`picture` only when `agent.vision` is on, off by default) vs builder choice 12 | The studio's board is made with `vision: true` for both agents. Not asserted. | Neither. |
| board agent.md 3 (`edit` of a figure card runs its lines) vs builder choice 3 | The server does not check `edit` of a figure card (it does not know the card's mode). The board does. | Not tested. |
| board agent.md 3 ("a shape id that is not among the items, when `more` is 0") vs the code after a `page` action | After a `page` action the id checks are left to the board (the items describe another page). The doc is silent. | Not tested. |
| teacher R6.2 (film tools on a board act on the card made last) | `pause`, `resume`, `seek_beat` and `show_me` are not built yet (round 4). | Not tested. |

## Doc gaps (tests had to pick a name or a shape; change the test when the doc names it)

| Gap | Used by |
|---|---|
| The status of a request with more than 60 `items`, a bad `kind`, an item with no id, a `madeBy` other than `"model"`, no `page`, a bad `more`: the docs say only "at most 60". Tests expect `400 bad_request` and that the message names the field. | `board-ask.test.ts` |
| A talk with no `allowEdit`: agent.md 3 says the field is always there. Tests accept a 400 or a stream with no change to the user's shapes (the code defaults to false). | `board-ask.test.ts` |
| `board_read` with a `page` the request does not hold, and a `board` call on a target with no board: only that the answer is an error, not a throw. | `board-tools.test.ts` |
| What `more` means for an area: tests take it as the items past 60 inside the area (plus the request's own `more` when there is no area). | `board-tools.test.ts` |
| Daily budget: each model call of a turn counts, so a circle turn with one tool call uses 2. | `board-ask.test.ts` |
| A cut answer with no action at all: tests expect an error event, not a bare `done`. | `board-ask.test.ts` |
| An answer a Stop ended with no action sent: tests expect no `model_bad_output` (the code ends with `done`). | `board-jobs.test.ts` |
| A request made in the first moments, before `/v1/health` answers, goes to the demo agent (builder choice 12; server design 8 says "the studio uses the server when it answers"). | `board-agent.test.ts` |
| The harness read these implementation files to wire its fakes, not to set expected values: `packages/server/src/http/body.ts` (limits), `providers/openrouter.ts` (wire shape of tool calls and images), `jobs/health.ts`, `apps/studio/src/server.ts` and `board-agent.ts` (names and signatures), `packages/teacher/src/tools/board-target.ts` (the shape of `BoardRequestData`, `BoardPort`), `loop/board.ts` (`BoardTurnOptions`). | |

## What the new tests cover

- **`board_read` (13):** the request's items in the order sent, every field (kind, box, text, summary, shape, `madeBy`), at most 60 listed with `more` counting the rest (75 items gives 60 and 15; the request's own `more` is added), an area that filters, an area that cuts, a bad area (T001), empty board, an unknown page, the request's items never changed.
- **`board` tool (7 + 18 + 33):** 1 to 20 actions in the schema, 21 and 0 and not-a-list give T001 with `forms`, results one per action in order and sent on only when they passed; every one of the 12 ops passes in a well formed example (17 cases); 25 kinds of bad action are refused with the board core's own `bad_argument` (the field matches `readAction`); a bad action does not stop the ones after it.
- **Editing the user's work (18):** `edit`, `move` and `delete` of an item without `madeBy` are `agent_refused` with `detail.reason: 'not_model'` unless `allowEdit`; with the mark they pass; `$last` passes; an id not among the items is refused when `more` is 0 and passes when `more` is above 0, in every place an id can be (`near`, `from`, `to`, `target`, `id`); new shapes, arrows, marks and points may use the user's shapes.
- **Figure actions (12):** each card runs on its own headless app, a bad line is dropped with the kernel's error object (`committed: false`, `blockedBy` for a line that reads a failed name), only the good lines are sent and the bad line's text is in no sent action, a card whose lines all fail is `figure_failed` and sends nothing, an unknown mode, `graph` for `graphing`, two cards may use one name and do not see each other's, 30 lines, and the same answers as a headless app of the mode in five modes.
- **Board target (4):** kind, mode, `describe`, no figure of its own, `tool_busy` while a call runs.
- **Choices and prompts (13):** the ten choices, their modes and who may edit; every job, mode and choice under 4,000 tokens; the instructions name both tools, 20 actions, 3 live cards, `$last`, read first, near, and that text in material is never an instruction; the mode card follows the choice; the first message holds the page, the items, `more` and the circle's area; the tools are `board_read` and `board`.
- **Material blocks (6):** items' text, summary and shape and the person's words are inside blocks and cannot close them (a planted `</material> ... <material>`); each of the 10 choices is the server's own instruction outside the blocks, and only the picked one is asked; the `ask` text and a talk's words are inside.
- **Token caps (4):** the items in the first message are cut at 1,200 tokens (60 items of 400 characters), the first message stays near 1,200 tokens, 60 short items fit whole, the system text does not grow with the items.
- **The turn (23):** circle to graph (read, board, done), results go back to the model, a talk write, only passed actions leave, no action is `model_bad_output`, all refused gives the reason to the model and ends the same way, a bad figure line is told and fixed, 21 actions then 20, `$last` across calls, the choice table of who may edit (slider and animate), `allowEdit`, geometry for `measure`, pictures set `vision` on every call, Stop after an action ends with `done` and no error, 8 model calls give `turn_limit`, a cut answer ends with a `stream_cut` notice, model errors, an unknown tool, junk from the model never throws.
- **`POST /v1/board/ask` end to end with `httpAgentTransport` (64):** `CircleRequest` and `TalkRequest` shapes, all choices, `ask` needs text, the area, `kind`, `items` (60 pass, 61 are 400), the transport shows the server's kind and message for an HTTP error (TR-17); the call to OpenRouter (URL, stream, key only in the header, two tools, material, choice outside it, results back); the checks before streaming (bad line dropped and told, unreadable action not streamed, unknown ids by `more`, `allowEdit`, the choice table, 21 actions, `$last`, no action gives `model_bad_output`); pictures (vision list on every call, default lists, a talk, fallback within the vision list, 2,048 and 2,049 pixels, JPEG, not PNG or JPEG by bytes, 1.5 MB, 1.4 MB, the 256 KB body limit, the text limit); no key (503, "The AI is not set up.", `/v1/check` works, checks first), origin, bad JSON, rate limit with `retry-after` and a new minute, the daily budget, all models busy (200 and a `model_busy` event with `retryAfterMs`), a failed model, 60 s on the server's clock with the actions already sent, a cut answer (done with a `stream_cut` notice, or an error when nothing was sent); a newer request ends the older one with `superseded` and no `done`, Stop and a closed connection abort the model call, the actions are flushed while the model works on its next call; keys, the picture, the items' and spoken text and the model's text stay out of the log; `/v1/health` `ready`.
- **Studio (15):** `probeServer` (the URL, ready or not, errors, the 1.5 s limit), the option and label, a ready server gives the HTTP agent (the next request is `POST /v1/board/ask`, the same origin, and its answer lands on the board) and the label, no model or no server leaves the demo agent and its label, a server error shows as the board's agent error, and the same through the mounted studio in notes mode (the board opens at once with the demo agent; a ready server takes over; no key, no server and a probe still pending leave the demo).

## Not tested

- The film tools on a board, the live job and `/v1/teach`, `/v1/speech`, `/v1/export/svg`, the voice in the studio (rounds 4 and 5).
- `edit` of a figure card on the server, and the id checks after a `page` action (not on the server's side; see above).
- Hand animation and the panel's hand icon (the demo agent's caption needs the board's frame loop, which a test does not run; the demo tests stop after its first answer).
- A real vision model reading a picture, and a real OpenRouter reply (round 5's live test).
- `retry_spent` notices on the board route: a board turn has no line retries, so only `stream_cut` can appear on `done`.

# Round 4

Branch `feat/teacher-r4` (draft PR #147). Tester run of 2026-11-22. New specs, all written from the docs and the public exports (`handoff/teacher/builder-notes.md` "Round 4" was read for the choices, not for expected values):

- teacher: `packages/teacher/test/spec/film-tools.test.ts`, `sentences.test.ts`, `live.test.ts`, `lessons.test.ts`; bench `packages/teacher/bench/sentences.bench.ts`.
- server: `packages/server/test/spec/speech.test.ts`, `teach.test.ts`, `teach-lessons.test.ts` (helpers in `r4-helpers.ts`: a server with the chat network and a separate voice network, both fake `fetch`).
- studio: `apps/studio/test/voice-lesson.test.ts`, `voice-audio.test.ts`.

## Counts

| Run | Files | Tests | Pass | Fail |
|---|---|---|---|---|
| `film-tools.test.ts` (teacher) | 1 | 34 | 34 | 0 |
| `sentences.test.ts` (teacher) | 1 | 34 | 33 | 1 |
| `live.test.ts` (teacher) | 1 | 27 | 27 | 0 |
| `lessons.test.ts` (teacher) | 1 | 36 | 36 | 0 |
| `speech.test.ts` (server) | 1 | 55 | 55 | 0 |
| `teach.test.ts` (server) | 1 | 61 | 61 | 0 |
| `teach-lessons.test.ts` (server) | 1 | 15 | 15 | 0 |
| `voice-lesson.test.ts` (studio) | 1 | 75 | 75 | 0 |
| `voice-audio.test.ts` (studio) | 1 | 34 | 34 | 0 |
| New in total | 9 | 371 | 370 | 1 |
| `--project teacher` | 16 | 767 | 766 | 1 |
| `--project server` | 18 | 709 (6 todo) | 703 | 0 |
| `--project studio` | 26 | 665 | 665 | 0 |
| `npx vitest run` (whole repo) | 318 | 12,958 (11 skipped, 6 todo) | 12,940 | 1 |

`npm run lint` and `npm run typecheck` pass. The one failing test is new; every other test in the repo passes. No test reaches a network (the studio test that mounts the whole page replaces `fetch`), no `.env` was read, and no rule was disabled.

## Benches

Run with `npx vitest run --config packages/teacher/bench/vitest.config.ts sentences`. Design 10 has one splitter row (under 1 ms per streamed line); the sentence splitter uses it as its limit.

| Measure | Result | Limit |
|---|---|---|
| Sentence splitter, pieces of 3 / 12 / 60 characters, per piece | 0.0007 / 0.0010 / 0.0021 ms | 1 ms |
| Sentence splitter, 20,000 characters with no end, 3-character pieces, per piece (no quadratic rescan) | 0.0028 ms | 1 ms |
| `liveTurn`, one model call of 30 sentences, fake model, whole turn | 0.63 ms | 5 ms (own limit) |

No server bench for `/v1/speech` or `/v1/teach` was written (server design 9 has no row for them).

## Failing tests (the code or the docs are wrong; the tests stay)

| # | Test | Rests on | What happens |
|---|---|---|---|
| 1 | `sentences` "a run that is long when its full stop arrives in the same piece is still cut: no sentence is over what the voice takes (500)" | teacher design 8: a run of more than 400 characters is cut at a comma or a space; the voice takes 500. Server design 6 and 7: one sentence is at most 500 characters | `SentenceSplitter.cutAt` looks for a full stop first and the 400 check only comes after the scan finds none. A piece of 754 characters that holds its full stop (`'word ' × 150 + 'end. Next one.'`) comes out as one sentence of 754 characters, so the studio's `/v1/speech` request for it is `413` and the browser's voice speaks it. The same happens for any push whose end mark is past character 400 (streams with small pieces cross 400 first and are cut; a provider that sends big chunks, or a recording, is not). The fix is to test the length before accepting an end mark past `SENTENCE_MAX`. |

## Contradictions between documents, and builder choices against the docs

| Where | What | What the tests follow |
|---|---|---|
| teacher design 8 ("line breaks that are followed by a space") vs `stream/sentences.ts` | The code cuts at every line break at once, with no space needed; builder choice 6 words it as "a line break when a space follows". A model that writes a list one item a line has no space after the break. | A line break ends a sentence (the code, and the sense of the sentence). The doc should drop "that are followed by a space" for line breaks. |
| teacher design 8 vs the builder (the splitter) | The code also cuts a long run at `;` and `:`; the doc names a comma or a space. | Only the 400-character bound and that nothing is lost; the mark is not asserted. |
| teacher errors.md T003 (`turn_limit`, "This answer stopped after {what}.") and server design 6 (the turn limit "is the stream's last event") vs server errors.md | `errors.md` of the server has no `turn_limit` kind; it names `model_timeout` for a turn that passes 60 s. The server answers 8 model calls with `model_timeout` "The AI took too long." | The test accepts `turn_limit` or `model_timeout` and requires an `error` event with no `done` and exactly 8 model calls. One of the docs should name the wire kind. |
| teacher design 4 / agent.md 3 (`show_me { name, to, seconds }`: "move a slider while explaining it") vs TR-34 | Both agree the move is at once today, which is not what the prompt tells the model ("to move it there over seconds"). | The doc as written: `SetValue(name, to)` at once, `seconds` checked (above 0, at most 30). A glide is TR-34. |
| teacher design 4 / R6.2 ("film tools on a board act on the card made last, or the one in focus") vs builder choice 3 and TR-35 | On the server the tools act on the headless copy of the card in focus only (a card made this turn is not in it); the client does the "made last" part. `seek_beat`'s `t` on the wire is the focus copy's clamped time. | The doc for what is observable on the wire: the controls go out, `show_me`'s line is sent on, the focus clock moves. Not tested: a card made this turn taking the film tools on the server (TR-35). |
| teacher agent.md 6 ("about 3,100" and "about 3,300" tokens for `live`) | The tests assert only the hard limit (under 4,000, design 5) in six modes and on a board. The "about" figures are not asserted. | The 4,000 limit. |
| teacher design 9 (`liveTarget` first message) vs the builder's "THE FIGURE IN FOCUS" | The heading is not in a doc. | Only that the board comes first, the focus figure after it, and the word "focus" is there. |

## Doc gaps (tests had to pick a name or a shape; change the test when the doc names it)

| Gap | Used by |
|---|---|
| The status for a `/v1/teach` field that is wrong: tests expect `400 bad_request` naming the field for a missing or non-text `text`, an unknown `mode`, a `script` over 64 KB, a `history` that is not a list or has 11 turns or an item with a wrong role or no text, and a `board` with 61 items, no `id`, or not an object. Server design 6 gives `413` for text (4,000) and history characters (8,000) and `400` for more than 10 turns; the others are the pattern of `/v1/board/ask`. | `teach.test.ts` |
| `t`: builder choice 5 says 0 to 86,400 and `400` outside it; the docs only call it the film time. `null` is taken as missing (200). | `teach.test.ts` ("builder's choices") |
| The body limit of `/v1/teach` (256 KB) and `/v1/speech` (16 KB): design 7 lists them; the tests use the numbers. | `teach.test.ts`, `speech.test.ts` |
| A speech answer with a JSON content type and status 200 is a failed voice that passes on; a body that ends with no byte is the same (builder choices 8 and 9). | `speech.test.ts` |
| The sample rate when the provider's `x-sample-rate` is outside 8,000 to 192,000: not tested. | none |
| The text of `model_timeout` for no first byte on `/v1/speech`: errors.md's "The AI took too long." | `speech.test.ts` |
| What the panel shows for an HTTP error with no error body: tests require a notice that is not the provider's text; the wording is the code's (`http_<status>`). | `voice-lesson.test.ts` |
| When the browser's voice has no `speechSynthesis`: the lesson shows the sentences and goes on (no hang). The doc does not say. | `voice-lesson.test.ts` |
| An `error` event in a lesson stream still lets the sentences already queued play, then the lesson ends idle (TE4 note in builder choice 10; TE4 itself only says `done` and `error` queue the end marker). | `voice-lesson.test.ts` |
| The harness read these implementation files to wire its fakes, not to set expected values: `packages/server/src/providers/speech.ts` and `jobs/speech.ts` (option names, `firstByteMs`), `apps/studio/src/voice.ts` (`VoiceOptions`), `voice-audio.ts` (the globals it reads), `voice-ui.ts` (class names of the panel), `packages/teacher/src/loop/live.ts` (`LiveTurnOptions`). | all |

## What the new tests cover

- **Film tools (34):** the four are built-in names with schemas that match design 4; `pause`/`resume` stop and play the clock, give `{ ok: true, t }` and a `control` output, twice in a row is fine; `seek_beat` moves the clock, keeps the play state, clamps past the end and sends the time the figure stands at, and rejects a missing, text, negative, null or list `t` with `tool_input`; `show_me` writes `SetValue` for a number, true or false, a text and a point, gives the `draw` result (and the kernel's `unknown_name` / `not_free` objects, unchanged) and sends a `lines` output only when the line passed, accepts `{ name, to, seconds }` at once, checks `seconds` (above 0, at most 30), refuses `value` with `to`, neither, a bad name or a bad value; `tool_busy` (T002) for each; `tool_unknown` (T004) when a host leaves them out; on a live board target they move the focus figure's clock, send their controls, and `show_me` is sent on as it is; a board target with no figure keeps a clock record.
- **Sentence splitter (34):** whole sentences only, in any piece size (every cut of a text into two, and pieces of 1 to 11 characters, give the sentences of the whole); `. ! ? …` and runs of marks, closing quotes and brackets, line breaks; `2.5`, `3.14`, `1.2.3`, `a.txt`, `e.g.`, `i.e.`, `Dr.`, `Mr.`, `Mrs.`, `Ms.`, `vs.`, `Fig.`; `x = 3.` at the end of the text, followed by a space, followed by `5` (3.5); markdown marks and dollars dropped; text with no letter or digit dropped; a run of more than 400 characters cut at a comma or a space with nothing lost, a word of 1,000 characters cut; the failing test above.
- **The live job (27):** `say` events are sentences (pieces cut mid-word, decimals, marks), a sentence comes before the lines of its own reply, controls flush the sentence before them; lines that fail never reach the client; the film tools in order; stop gives `done`; a model error and a cut answer end with `error` and with `done` plus a `stream_cut` notice; `liveTools` and the tools offered on a figure and on a board (with and without a focus script); board actions are sent; the prompt names the tools and the spoken-lesson rules, stays under 4,000 tokens in six modes and on a board, holds the learner's words only inside `<material>` (a planted closing tag does not escape), and puts earlier turns before the new request; the 8-model-call limit.
- **Acceptance lessons (36 + 15):** each recording replays through `liveTurn` and through `POST /v1/teach` (as the SSE stream a model sends); the turn ends with a bare `done`, every reply is used, the objects are exactly `expect.objects` (checked on the teacher's copy and on a client that applied only the lines the server sent), the value `show_me` set is on the figure, nothing is undefined, every line the model wrote was sent, the sentences are as many as `expect.sentences` (each whole, at most 500 characters, no marks), the words spoken are the words written, the controls are `expect.control`, the replay is deterministic, and the server's events equal the teacher's own replay.
- **`POST /v1/teach` (62):** the stream shape and flush, sentences by piece size, say before lines, lines checked on the copy of the request's script, the first message (mode, script, `t`, board items), the learner's words in a material block, `pause`/`resume`/`seek_beat`/`show_me` events, the board lesson's tools and actions (a bad action fails alone, a figure action's bad line is dropped), every request limit (text 4,000 and 4,001, script 64 KB, history 10 turns and 8,000 characters, 60 board items, body 256 KB, not JSON, GET, origin), the history reaching the model, no key (503), all busy (200 and a `model_busy` event), a failed model, a cut answer (`stream_cut` notice), `retry_spent`, the turn limit, `superseded`, closing the connection, the rate limit and the daily budget, an unknown tool, no key or words in the log.
- **`POST /v1/speech` (55):** Fish MP3 and HeyGen PCM with the voice, what is asked of each (URL, key only in `Authorization`, `mp3` / `pcm`, `instructions` to Fish only), the bytes unchanged, `x-sample-rate` (header, `rate=`, default) and its exposure, the audio on the wire while the provider holds the rest, an error after the first byte ends the response with no error line, fallback on 429, 500, 503, a network error, no first byte, a head with no byte, an empty body and a JSON answer, the 60 s skip after a 429 (and not after a 500), all busy / all slow / a mix as `503 model_busy` with `retry-after`, `504 model_timeout`, `503 model_unavailable`, no key, 500 and 501 characters, instructions 200 and 201, bad fields, body over 16 KB, origin, the 0.1 weight (ten fit in RATE_PER_MINUTE=1, the eleventh is 429), no model slot (three at once, and a lesson turn is not replaced), no model call of the day, a closed client aborts the provider call (streaming, and before the first byte), free ids only and the voice setting, `/v1/health` `voice`, no key, no sentence and no provider text in the log or the answers.
- **Studio `VoiceLesson` (75):** the `VOICE_MACHINE` table row by row (19 rows, and no other), each row with fakes (recogniser, clips, browser voice, `/v1/teach` fed by hand): `listen`, `heard` (final only, empty ignored), `stop`, recognition failure, `type` from idle, listening, thinking and speaking, `play`, `wait`, `drained` (only at the end marker, never at an empty queue), `fail`; the text box where nothing can listen; the request fields and the history cap (10 turns, 8,000 characters); the transcript cap (60); lines, actions and controls applied while a clip plays, in order; sentences play in order, are fetched ahead, and a later sentence that is ready first waits; the browser's voice in its place for a missing or unplayable clip and with no browser voice; barge-in by typing, by voice and by Stop stops the clip and the browser's voice, drops and frees the queue, aborts the turn and the audio requests, and ignores every late event of the old turn; failures (no target, no network, an HTTP error with and without a body, an `error` event, a cut stream, a target that throws); `SentenceQueue`. No test saw a refused move of the machine (`onFault`).
- **Studio sound and panel (34):** `speechClips` (the request, MP3 on an audio element, PCM through Web Audio at the answer's rate with 16-bit little-endian samples, 24,000 by default, stop on abort, no clip for 429, 503, 504, an empty body, a network error or an abort); `browserVoice` and `browserRecogniser` over fake browser objects; the Talk panel's text box, Enter, sentences going to `/v1/speech` in order, open and close, the state words, text shown as text, `setAvailable`; the Talk button in the mounted studio (visible in graphing, geometry and notes, hidden in scientific).

## Not tested

- A live capture of either voice (TR-37), a real model, a real microphone or speaker; round 5's smoke run has them.
- A timed `show_me` glide (TR-34), a card made this turn taking the film tools on the server (TR-35), playing a clip while it streams (TR-36). The tests hold the behaviour the docs describe today.
- The first-byte timeout of 15 s (the voices take `firstByteMs`; the tests use 60 to 400 ms) and the 60 s turn limit of `/v1/teach`.
- The studio's page layout of the panel (no screenshot: needs a running server with a fake model).

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

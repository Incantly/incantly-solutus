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

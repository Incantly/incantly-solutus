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

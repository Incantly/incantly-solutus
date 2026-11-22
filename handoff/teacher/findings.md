# Teacher and server: findings (fix later)

Items found in a review that do not hold up the merge. Each is fixed in a later batch, not inline. Round 1 review: `review-r1.md`.

## Fix later

| Id | Where | Problem | Idea |
|---|---|---|---|
| TR-9 | `/v1/teach`, `/v1/board/ask` (round 3 and 4 routes), the `history` field of the request | `history` comes from the client, so a client can write `assistant` turns that the model will trust. The model's output is still checked before it leaves the server (only lines and board actions pass, both checked), so the harm is small | Keep the conversation on the server, or send earlier assistant turns inside the material block so the model treats them as data |

## Moved out of round 1

None. TR-8 was fixed in round 1: the SDK's `run(lines, { independent: true })` passes the kernel's `failed` map from line to line, which was a small option and not a new batch mode. `figureTarget` uses it, so a line that reads a name a failed line of the same `draw` call was to make gets `blockedBy` and `recovery: 'fix_earlier'`.

## Noted while fixing round 1

| Id | Where | Note |
|---|---|---|
| TR-10 | `docs/features/tools-2d/design.md`, `docs/features/conics/agent.md` | Both docs use `t = Tangent(…)` in examples. `t` is the film time (K003 `reserved_name`), so the same example fails there. Not in TR-4's scope; change the name in a docs batch |
| TR-11 | `incantly/state-no-io-flags` | `destroyed` is checked only in a file that imports a `node:` module, because in browser files it is the name of a part's own state (`app.destroyed` of an SDK app, a view's `destroyed` getter). A browser-side I/O object (`WebSocket.readyState`) is covered through `readyState`, which is checked in every file with a machine. If a browser file ever reads `socket.destroyed`-like flags, widen the rule then |

## Noted while fixing round 2 (review: `review-r2.md`)

| Id | Where | Note |
|---|---|---|
| TR-20 | `jobs/figure.ts`, `limits/rate.ts` | The daily budget is checked once before the stream opens (`checkDailyBudget`, which takes nothing) and taken at each model call. When two requests race for the last call of the day, the second passes the check and then gets `daily_budget` as a stream event on a `200`, not a `429`. Fix by taking the first call at the check and handing it to the first model call |
| TR-21 | `jobs/figure.ts`, Tiptap `AiEvent`, board `BoardAgentEvent` | A `model_busy` or `rate_limited` answer carried its wait in `retry-after` and `detail.retryAfterMs`. Both clients keep only `kind` and `message`, and a `model_busy` is now a stream event with no header, so a client cannot back off by the number. The message holds the seconds. Add `retryAfterMs` to the clients' error shape if a client needs it |
| TR-22 | `jobs/figure.ts` | A script over 64 KB is still `400 bad_request`; `errors.md` says `payload_too_large` covers the "text limits", and the review rules only the text and history limits. Decide whether a script over its limit is `413` too, and give the answer one status in the docs |
| TR-23 | `jobs/figure.ts` | A superseded request is told only at the next event of its stream (the model's next event, or the abort that `AbortSignal.any` hands the teacher). A job whose stream already ended with `done` when the newer request arrived is not touched, which is right, but there is no test for the instant between the last line and `done` |

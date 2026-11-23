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

## Noted while fixing round 3 (review: `review-r3.md`)

| Id | Where | Note |
|---|---|---|
| TR-31 | `packages/teacher/src/loop/board.ts` | A circle that answers in words only (for example the `explain` choice, where an explanation is the natural answer) still ends with `model_bad_output`, and its words are dropped. TR-28 rules only the talk. Decide whether `explain` may end with `say` and `done` |
| TR-32 | `packages/board/src/core/agent-service.ts` | The words of an answer are written as one `agent` line when the answer ends, after the lines about the actions. A long answer shows nothing of the words until it ends. Show the pieces as they come if that reads better |
| TR-33 | `packages/server/test/spec/body.test.ts` | An `it.todo` still says "a request with a picture may be 2 MB" (the limit is now 2.5 MB). Reword it when its test is written |

## Noted while building round 4 (builder notes: `builder-notes.md`, "Round 4")

| Id | Where | Note |
|---|---|---|
| TR-34 | `packages/teacher/src/tools/film.ts`, `/v1/teach` events | `show_me` takes only `{ name, value }` and sets the value at once (review r4, TR-42: the timed `{ name, to, seconds }` form left the schema and the instructions). A timed glide needs either a field on the `lines` event or a new `control` op, and server design 6 lists only `pause`, `resume` and `seek`. Decide the protocol field, then add the timed form back and let the studio glide the value over the time |
| TR-35 | `packages/teacher/src/loop/live.ts` | On a board, `draw` and `figure` run on a headless copy of the card in focus's script (the request's `script`). A card the same turn made with a `board` `figure` action is not in that copy, so a later `draw` of the turn is checked against the older script, and the client (card made last, else the one in focus) applies it again with its own checks. Fix by letting the request carry each card's script, or by giving the copy the `figure` action's lines |
| TR-36 | `apps/studio/src/voice-audio.ts` | A sentence's clip is played when it has arrived whole, not as its first bytes come (the server does stream them). The next sentences are fetched ahead, so a pause shows only before the first sentence (about 1 to 2 s). Playing MP3 from a `MediaSource` and scheduling PCM chunks as they come would start the first sentence earlier |
| TR-37 | `packages/server/src/providers/speech.ts` | HeyGen's PCM is read as 16-bit little-endian mono at the `x-sample-rate` of the answer (default 24,000). That is what OpenRouter documents for its speech route; no live capture was made. Round 5's smoke run should record one clip of each voice and check the head |
| TR-38 | `/v1/teach` `history` | TR-9 holds for the new route: `history` is written by the client. The first message of each earlier user turn is inside `<material>`; earlier assistant turns are not |
| TR-39 | `/v1/teach` studio client | The studio sends the whole script of the figure (up to 64 KB) on every turn. For a long lesson that is a few hundred KB over a session; send it only when it changed, or send the figure summary and the lines since the last turn |

## Noted while fixing round 4 (review r4)

| Id | Where | Note |
|---|---|---|
| TR-45 | `packages/server/src/errors.ts` (`fromStreamError`), `jobs/figure.ts`, `jobs/board.ts` | Review r4 ruled that a turn's own limits (8 model calls, 24 tool calls, 60 s) end with `turn_limit`, and TR-41 applied it to `/v1/teach` only. `/v1/figure/draw` and `/v1/board/ask` still map the teacher's `turn_limit` to `model_timeout` ("The AI took too long."), and earlier specs (`figure-draw.test.ts`, `board-ask.test.ts`, `stream.test.ts`) pin that. Server `errors.md` says so in the `model_timeout` row. Decide whether both jobs move to `turn_limit` too, then change `fromStreamError` and those specs together |

## Found in the round 5 live run (`live-run.md`)

| Id | Where | Note |
|---|---|---|
| TR-46 | `packages/teacher/src/stream/apply.ts` (prompt to figure) | The first line reached the client 9 to 23 s after the request, because the plan call is a whole model reply before the script call starts. The voice lesson, with no plan call, drew its first line in 1.5 s. Skip the plan call for short requests, or ask for the plan and the script in one reply |
| TR-47 | `packages/teacher/src/prompt/grammar.ts` | Asked for a tangent, the model named it `t` twice (the film time, `reserved_name`), then `t_1`, and the tangent was left out (`retry_spent`). The grammar summary should list the reserved names (`t`, `x`, `y`, `z`, `e`, `pi`, the unit names) and the hint of K003 should offer a free name |
| TR-48 | `packages/server/src/log.ts`, the jobs | The log does not say which model answered, how long it took, or which fell back. Add one line per model call: model id, time to first event, total time, fallback reason. No bodies |
| TR-49 | `/v1/board/ask` circle | In one of three runs the model sent the same `arrow` and `write` twice over three `board` calls, so the board got two arrows and two captions. The tool results said each passed. The circle instructions should say an action that passed is done, and the server could drop an action equal to one already sent in the answer |
| TR-50 | `apps/studio/src/voice*.ts` | Opening the Talk panel starts the microphone at once. Where the page has no microphone permission (or the person says no), the first line of the panel is a red "The microphone stopped: not-allowed." Start listening only on the microphone button, and say plainly that typing works |
| TR-51 | live run | A circle with a picture (the vision list) was not run live in round 5: a safety rule blocks sending a local file off this computer from the agent's shell. The vision models were checked by hand on 2026-11-22 with a handwritten equation |
| TR-52 | live run | The error test set and its fix rate (teacher R8.3, 9 in 10) were not measured. The live runs show one fix failure (TR-47) |

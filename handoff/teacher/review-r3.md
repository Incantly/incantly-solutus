# Teacher and server, round 3: review

One review (Opus), after the tester's report (`test-report.md` "Round 3", 7 failing of 12,574). The fixer fixes TR-24 to TR-30, then merges. No new kind of hidden state: the board target holds the request's items as data, and the job reuses the round 1 and 2 machines.

## Rulings

| Question | Ruling |
|---|---|
| 21 actions in one call: T001 or `agent_refused` | Both are right, at different layers. The teacher's `board` tool answers T001 (`tool_input`) before anything reaches the board; the board's own runner answers `agent_refused` for a call that reaches it. Board agent.md 2 says so |
| Tools of the circle and talk jobs | Only `board_read` and `board`; a `figure` action carries the lines, checked like `draw` lines. Teacher design 2 and agent.md 1 change to match |
| Action results without `id` | The server answers `{ ok: true }` per action, since ids are made by the client. `$last` is resolved by the client. Board agent.md 1 says the server's results carry no id |
| Circle and talk prompt size | About 3,300 tokens, under the 4,000 cap. Teacher agent.md 6 gives the real numbers |
| `/v1/health` `ready` | Part of the contract: `ready` is true when a model client is set and its key is there. Server design 3 names it |
| A talk reply with words and no action | A valid answer, not `model_bad_output` (TR-28) |

## Findings, fix now

| Id | Where | Problem | Fix |
|---|---|---|---|
| TR-24 | `packages/teacher/src/tools/board.ts` | The whole call is checked against the JSON schema first, so one bad action (a wrong enum, a stroke point with one number) makes the call T001 and the other actions never run. Board agent.md 2: each action fails alone | Check the call's outer shape (an `actions` array of 1 to 20) as a whole; check each action on its own, so a bad one gets its own error and the rest run |
| TR-25 | `packages/board/src/core/agent.ts` `BOARD_READ_TOOL` | Its description omits `madeBy`, which agent.md 1 lists and the server now uses | Add `madeBy` to the description and the item schema |
| TR-26 | `packages/server/src/jobs/board.ts` | `model_bad_output` says "The model sent no board action that passed its checks." | Use the `errors.md` message "The AI could not draw this." Detail may keep the longer reason |
| TR-27 | `http/body.ts`, server design 7, `errors.md` | A 1.5 MB picture is 2 MB as base64, the whole body limit, so an allowed picture gets 413 | The body limit with a picture is 2.5 MB. Docs and constant change together |
| TR-28 | board protocol, `jobs/board.ts`, board `agent-service.ts`, `web/agent-http.ts`, the agent panel | **The talking agent's words are lost.** The board's answer stream has no text event and turns unknown events into `bad_stream`, so the server drops what the model says, and a words-only talk reply ends as `model_bad_output` | Add `{ "say": "…" }` to the board's NDJSON events (agent.md 3): the server sends the model's text as `say` pieces; the board's parser accepts them; the agent panel shows them in the conversation as the agent's reply, joined per answer. A talk turn with `say` and no action ends with `done`. Circle answers may carry `say` too; the panel shows it under the circle's answer |
| TR-29 | docs | The rulings above | Board agent.md 1, 2, 3 and 6; teacher design 2 and agent.md 1 and 6; server design 3 and 7; `errors.md` body limit |
| TR-30 | tests | Tests that rest on the rulings | Change only those to the rulings, and list each |

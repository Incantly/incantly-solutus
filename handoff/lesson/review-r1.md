# Lesson, round 1: review

One review (Opus), after the tester's report (`test-report.md`, 204 new tests, none failing). The fixer fixes LR-1 to LR-8, then merges.

## Rulings

| Question | Ruling |
|---|---|
| `lesson_busy` for the same client | The plan wins: a newer turn from the same client replaces the running one, which ends with `superseded`. `lesson_busy` is for a turn from another client while one runs. `errors.md` says so |
| The `replan` move (`waiting` to `planning`) | Keep it: a turn with no plan yet goes back to planning, so `teaching` always has a plan. Design 6 gets the row |
| The same note again after a new page | Allowed: the repeat check is per page within an answer. Agent.md rule 8 says "in the same answer on the same page" |
| The 200th turn | It runs, and its `done` carries `ended: true`. The server adds one `say` before it: "That's the end of this lesson. Start a new one to go on." (LR-4) |
| The builder's caps (800 characters a side of a kept turn, 80 for a hard note, 120 for the topic) | Keep them; design 4 lists them |
| `/start` without a key | `model_unavailable` (503): a lesson that cannot have a turn should not start (LR-5) |

## Findings, fix now

| Id | Where | Problem | Fix |
|---|---|---|---|
| LR-1 | `packages/server/src/lessons/store.ts` `Lesson.run` | **A new kind of hidden state.** The running turn is held in `run`, set to a sentinel record `NO_RUN` when none runs, beside the machine's `planning`/`teaching`. It is the shadow-null pattern with a sentinel in place of `null`, so `state-no-shadow-null` does not see it. In `interrupt`, a refused `turnEnd` leaves `run` set while the machine says otherwise | Keep the run inside the state's data, or set and clear it only on the moves that enter and leave the running states, in one method each. Extend `state-no-shadow-null` so a field set to a module constant named `NO_*`, `NONE_*`, `EMPTY_*` or `IDLE_*` counts as its "null", with rule tests; fix what it finds in every package |
| LR-2 | `Lesson` constructor, `StateMachine(..., onFault === undefined ? undefined : ...)` | A refused move of the lesson machine can be silent when no `onFault` is passed | Always report: the store passes its own reporter (the server log as `internal`). Turn `state-refusal-reported` on for `packages/server` and `packages/teacher` too, and fix what it finds |
| LR-3 | `lessonTurn`, the store | An interrupted or replaced turn leaves nothing in the memory, so the teacher does not know what the learner asked | Record the learner's words with the teacher's reply marked "(interrupted)" and what was said so far |
| LR-4 | `jobs/lesson.ts` | The ruling above: the 200th turn ends with no word | One closing `say` before `done: { ended: true }` |
| LR-5 | `jobs/lesson.ts` `/start` | The ruling above | `model_unavailable` without a key |
| LR-6 | docs | The rulings above, and the lesson routes and errors not in the server docs | Lesson design 4 and 6, `errors.md`, `agent.md` 1 rule 8; server design 1 and 6 (the three routes), server `errors.md` (`lesson_unknown`, `lesson_busy`, `lesson_full`) |
| LR-7 | `apps/studio/src/lesson-client.ts` | Untested, and round 2 builds on it | The fixer adds tests for it: start, a turn's events parsed, end, a JSON error body read as the server's error |
| LR-8 | tests | Tests resting on the rulings | Change only those, and list each |

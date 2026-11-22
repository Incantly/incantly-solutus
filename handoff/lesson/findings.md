# Lesson: findings (fix later)

Bugs and gaps found while fixing round 1 (LR-1 to LR-8) that are not in `review-r1.md`. They wait for a later batch.

| Id | Where | Problem | Suggested fix |
|---|---|---|---|
| LF-1 | `packages/teacher/src/lesson/turn.ts` | A turn that ends with an error (a model failure, `turn_limit`, `model_bad_output`) is not recorded in the memory, so the learner's words in it are lost to the next turn. LR-3 covers only a turn that was stopped (signal aborted, or the consumer closed the stream). | Decide whether a failed turn is kept as `(interrupted)` too, or kept with the error marked; the learner who asks again after a failure repeats the same words, so a duplicate record is the risk to weigh. |
| LF-2 | `packages/teacher/src/lesson/turn.ts` | A turn that stops at the 60 s deadline is recorded as `(interrupted)` the moment its signal fires, and then also ends with the `turn_limit` error. The record is right for the memory, but the turn is told as interrupted although the model was cut by time. | Read the signal's reason: a deadline could be marked "(cut by time)". |
| LF-3 | `tools/eslint-rules/state.js` `state-no-shadow-null` | The rule sees a "begin" only in a literal `send('begin…')`. The lesson store moves its machine through `enter(event)` with a variable event, so the rule cannot prove that `run` is cleared on every leave; it holds by the shape of `enter` and `leave` (one setter, one clearer) and by the tests, not by the rule. | Let the rule treat `send(<identifier>)` in a method that also assigns a nullable or sentinel field as a begin, and count a clearing in a method that sends `end`-like events. |
| LF-4 | `tools/eslint-rules/purity.js` `state-refusal-reported` | The rule refuses a third argument that is `undefined`, `null`, `void 0` or a choice with such a branch. A variable that may be undefined (`new StateMachine(T, 's', onFault)` where `onFault?:` is optional) is still accepted. | Use the type: refuse a third argument whose type includes `undefined` (needs type information in the rule). |
| LF-5 | `apps/studio` (round 2) | The server's closing sentence of the 200th turn ("That's the end of this lesson. …") arrives as a `say` before `done: { ended: true }`. The studio's conversation must speak it and then show the lesson as ended; round 2's `CONVERSATION_MACHINE` has the row "the server says the lesson ended" but not "after a last sentence". | Round 2: queue the sentence like any other, and leave the conversation when the queue drains after `ended`. |

## What the two extended rules found in old code

- `state-no-shadow-null` (a field set to a `NO_*`, `NONE_*`, `EMPTY_*` or `IDLE_*` constant counts as its null): no site in any package. The only class with such a field is the lesson `Lesson` (`run = NO_RUN`), now set in one method and cleared in one.
- `state-refusal-reported` (already an error for `packages/server` and `packages/teacher` in `eslint.config.js`; now it also refuses a third argument that can be nothing): one site, the lesson's `StateMachine`, fixed. Nothing is left for a later batch.

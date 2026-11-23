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

## Found while fixing round 2 (LR-9 to LR-12)

| Id | Where | Problem | Suggested fix |
|---|---|---|---|
| LF-6 | `apps/studio/src/voice.ts` (single-turn voice) | LR-10 changed only the refused microphone (`not-allowed`, `service-not-allowed`). Any other microphone failure (`audio-capture`, `network`, `no-speech` with an error) still shows "The microphone stopped: <reason>." with no word that typing works. | Add "Type your question below." to that line too, as the lesson's `microphoneMessage` already does. |

## Found in the live run (`live-run.md`)

| Id | Where | Problem | Suggested fix |
|---|---|---|---|
| LF-7 | `packages/teacher/src/prompt/jobs.ts` (lesson instructions) | The teacher drew no pen sketches, arrows or shapes in 6 turns: every picture was a figure card or a note, and vectors were points, not arrows | Make sketches the default in agent.md 1 rule 3 with two worked snippets (an arrow labelled $\vec v$, a box and arrows); say a figure card is the exception; in a card, a vector is `Vector(...)`, not a point |
| LF-8 | lesson instructions | "Explain it another way" gave new words but no new picture | Rule 5: a second explanation always adds a new sketch beside the first |
| LF-9 | lesson instructions, `lessonTurn` | Step 1 shared page 1 with the plan | The plan has page 1; step 1 starts with `page: new` like every step (or the turn adds it) |
| LF-10 | lesson instructions / board placing | The plan's title sits under the page bar | Start notes below the page bar's height, or `Place` `'free'` for the first note |
| LF-11 | `apps/studio/src/voice-ui.ts` plan view, or `lesson_plan` | "1. 1. Vectors as arrows": the model numbers steps and the list numbers them again | Strip a leading number from each step in `lesson_plan` |
| LF-12 | lesson instructions | Turn 2 said "Right" to an answer of a different question | Rule 5: compare the answer with the question asked; if it answers another one, say so kindly and ask again |
| LF-13 | `lessonTurn`, the model | The first sentence took about 10 s on turns that drew first (1, 4, 5); about 2 s on the others; the target is 3 s | Ask for the spoken sentence before the board call (instructions), or stream `say` from the first reply's text before tool calls run |

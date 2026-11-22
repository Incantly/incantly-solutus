# Lesson: test report, round 1

Tester for `feat/lesson-r1` (draft PR #150). Tests were written from `docs/features/lesson/{design,errors,agent}.md`, `.kiro/specs/lesson/requirements.md` (R2 to R6), `handoff/lesson/plan.md` round 1, `docs/state-machines.md` LE1, and the stream rulings of `handoff/teacher/review-r2.md` and `review-r3.md`, using public exports only. No implementation was changed. No break-the-code checks. No network.

## Counts

| File | Tests | Failing |
|---|---|---|
| `packages/teacher/test/spec/lesson-memory.test.ts` (memory caps, `lesson_plan`, `lesson_step`) | 42 | 0 |
| `packages/teacher/test/spec/lesson-prompt.test.ts` (agent.md rules read from the doc, reserved names, material blocks, token budget) | 25 | 0 |
| `packages/teacher/test/spec/lesson-turn.test.ts` (`lessonTurn` over a board target with `fakeModel`) | 47 | 0 |
| `packages/server/test/spec/lesson-store.test.ts` (store limits, busy, `LESSON_MACHINE` rows) | 40 | 0 |
| `packages/server/test/spec/lesson-routes.test.ts` (start, turn, end over HTTP with a fake OpenRouter fetch) | 46 | 0 |
| `packages/server/test/spec/lesson-perf.test.ts` (design 8 numbers) | 4 | 0 |
| Total new | 204 | 0 |
| Helper files (no tests) | `teacher/test/spec/lesson-helpers.ts` | |

Full run, once at the end: 324 files, 13,153 tests passed, 11 skipped, 6 todo (the builder's 12,949 plus the 204 new). `npm run lint` and `npm run typecheck` pass (lint fixed once during the work: `incantly/state-refusal-reported` on a `StateMachine` in the store spec, now given an `onRefused`).

## Failing tests

None. Every doc rule that was tested held in the builder's code.

## What is covered

- **Memory:** 6 recent turns (oldest first, never more than 12 history items), 1,200-char summary, 10 hard notes (last ten kept), memory block at most 600 tokens with every part full, learner words inside `<material>` and unable to close it.
- **`lesson_plan`:** 3, 5 and 8 steps pass with `{ ok: true, step: 1 }`; 0, 1, 2, 9, 12 steps, an 81-char step, and wrong types are T001 and change nothing; replace resets the step to 1; a good call sends a `lesson` event.
- **`lesson_step`:** `next`, numbers 1 to 5, summary, hard, combined call; `0`, `6`, `-1`, `99`, `1.5`, a word, no plan, and `next` past the last step are T001 and change nothing.
- **Job prompt:** the ten rules of agent.md 1 are read from the doc and each must be in the prompt word for word; reserved names (`t x y z e pi`, units, and `v w A tg c1`) in graphing and geometry; user words only inside material; system text under the 4,000 token cap with a full memory.
- **`lessonTurn`:** say as whole sentences (also across split pieces), actions, `lesson` event `{ plan, step, state: 'teaching' }`, one final event, memory recorded, turn 2 sees turn 1 (words, plan, step), 6-turn cap seen in the request, summary and notes reach the next prompt, a repeated board action is sent once (across calls, within a call, key order ignored), `done: { ended: true }` after "stop the lesson" with no board change and no tool that ends a lesson, `isEndRequest` yes and no lists, `turn_limit`.
- **Store:** UUID-shaped ids, 15 minutes idle from the injected clock (14:59 held, 15:01 gone, counted from the last turn), no timers, 200 turns, 100 held with oldest-idle eviction, a running lesson never evicted, `lesson_full` (503), `lesson_busy` (409) from another client, same-client takeover with the older turn stopped, `lesson_unknown` (404).
- **`LESSON_MACHINE`:** each of the ten rows, every other state and move pair refused and reported once with the state unchanged, `ended` takes nothing, and the lesson walking the machine.
- **Routes:** start, turn, turn, end of lesson by "stop", then `lesson_unknown`; `/end`; no key gives `model_unavailable`; rate limits with `retry-after`; daily budget; 4,000/4,001 chars; 256 KB body on all three routes; bad JSON; no board; 61 items; model failure after the checks is a 200 stream whose last event is the error; `finish_reason` without `[DONE]` is whole (TR-13); a cut answer is `done` with a `stream_cut` notice (TR-15); the client's history is ignored (TR-9, TR-38); `superseded` ends the older stream with no `done` (TR-16); a closed connection aborts the model call; ending a lesson mid-turn aborts the model call; 101 starts over HTTP; 200 turns over HTTP with `ended: true` on the 200th; key and bodies absent from logs.
- **Numbers:** server work before the model, median over 60 runs in process (full memory, 60 items) and over 40 HTTP turns: both under 5 ms. A full memory is under 64 KB as JSON, and 300 full lessons average under 64 KB on the heap.

## Where a builder choice differs from, or goes beyond, the docs

None of these fail a test, because each was tested as the docs and the builder's notes agree on, or left untested when the docs are silent or conflict. They need a ruling in the review.

1. **`lesson_busy` for the same client.** `errors.md` says `lesson_busy` (409) is returned when "a turn of this lesson is still running" and the studio aborts first. The plan (item 6), design 7 ("limits and errors are those of `/v1/teach`") and review-r2 TR-16 say a newer request from the same client replaces the older with `superseded`. The builder did the second: `lesson_busy` only for another client address (builder notes 9). Tested as the plan and TR-16 say; `errors.md` and the plan disagree and one of them needs a change. Consequence: within one browser `lesson_busy` is never seen.
2. **`replan` move.** LE1 has `waiting --replan--> planning`; design 6 has no such row (a lesson whose first turn ended with no plan). Tested as LE1. Design 6's table should gain the row, or the review should rule it out.
3. **Same note on a new page.** Agent.md rule 8 and design 5 say an action that passed is never sent again in the same answer. The builder clears the repeat memory when a `page` action passes (notes 7), so the same note on a new page goes out. Not tested either way; the doc is literal, the builder's reading is the sensible one for step pages. The doc should say it.
4. **The 200th turn.** Design 4 says a lesson ends "at 200 turns". The builder lets the 200th run and ends the lesson when it ends, with `ended: true` and no closing summary. Tested as that (199 do not end it, the 200th does).
5. **Limits the docs do not give.** Turn text kept 800 characters a side, hard note 80, topic 120, start `topic` at most 4,000: builder numbers in code, not in the docs. Not tested.
6. **Closing turn.** The learner's end phrase is a list in code (`isEndRequest`); only the whole utterance counts ("Stop, I don't get it" is not an end). The docs list three examples. Tested with the builder's list plus clear negatives.
7. **An interrupted turn is not in the memory** (notes 8). Tested for an aborted turn. The learner's words in it are lost to the next turn; design 4 says "the last turns as they were" and does not say.
8. **`/start` with no key.** The docs do not say whether `/start` needs the key. It does not (no model call), so `model_unavailable` first shows on `/turn`. The test accepts a 503 from either call.
9. **Docs not updated by the builder** (notes "Left undone"): `docs/features/server/design.md` 6 and `server/errors.md` do not list the three lesson routes and errors yet.

## Not covered

- `apps/studio/src/lesson-client.ts` (round 1 item 8): not in the list for this round; studio tests belong with round 2's UI.
- `CONVERSATION_MACHINE`, the Talk panel and TR-50 are round 2.
- The live run (R7.2) is round 2.

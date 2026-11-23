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


# Lesson: test report, round 2

Tester for `feat/lesson-r2` (draft PR #151). Tests were written from `docs/features/lesson/design.md` (1, 3, 6 `CONVERSATION_MACHINE`, 7, 8), `.kiro/specs/lesson/requirements.md` R1 and R7.1, `handoff/lesson/plan.md` Round 2, `docs/state-machines.md` LE2 and `handoff/teacher/findings.md` TR-50, using the public API only (`LessonConversation`, `CONVERSATION_MACHINE`, `boardConversation`, `mountVoice`, `mountStudio`). The builder's notes were read for choices; where a choice differs from the docs the docs were tested. No implementation was changed. No break-the-code checks. No network, microphone or speaker: a fake server (NDJSON fed by hand), fake recogniser, fake silence timer (and `vi.useFakeTimers` for the panel), fake clips and audio elements, a fake `SpeechRecognition`, and a real board in happy-dom for the undo steps.

## Counts

| File | Tests | Failing |
|---|---|---|
| `apps/studio/test/spec/lesson-conversation-machine.test.ts` (the 22 LE2 rows read from `docs/state-machines.md`, every other pair refused and reported, the public calls in every state, no fault) | 62 | 0 |
| `apps/studio/test/spec/lesson-conversation.test.ts` (start, thinking, speaking, microphone by itself, closed while speaking, barge-in, 8 s silence, no recogniser, End, `ended`, `lesson_unknown`, failed start, plan view, `say`, `actions`) | 76 | 1 |
| `apps/studio/test/spec/lesson-board.test.ts` (`boardConversation` on a real board: one undo step for each answer) | 9 | 0 |
| `apps/studio/test/spec/lesson-panel.test.ts` (Talk panel: TR-50, Start/End lesson, plan and step, microphone, Space, silence, text box, single-turn voice, the opened studio) | 33 | 1 |
| Total new | 180 | 2 |
| Helper file (no tests) | `apps/studio/test/spec/lesson-helpers.ts` | |

Full run, once at the end (before the last test, the TR-50 one, was added): 329 files, 13,375 passed, 1 failed, 11 skipped, 6 todo. The TR-50 test was then run on its own file (32 pass, 1 fail). `npm run lint` (eslint and check-repo) and `npm run typecheck` pass (lint fixed once during the work: `incantly/state-no-flag-soup` on a fake clip, now a `StateMachine`). The studio benches (`npx vitest run --config apps/studio/bench/vitest.config.ts`) pass: one line 0.0004 ms (target 0.01), one event 0.0026 ms (0.2), a turn of 10 events and 3 board actions 0.23 ms (5), a turn after 320 turns 0.026 ms (flat).

## Failing tests

1. `lesson-conversation.test.ts`: "lesson_unknown while a sentence plays ends the lesson at once, by LE2". LE2 says an error `lesson_unknown` is handled "at once". The conversation keeps the sentence playing and goes `off` only when the end marker is reached (the sentences already queued are spoken first). With no sentence queued it is off at once and that case passes. The docs are ambiguous (see contradiction 1); the review should rule it, then either the code or the doc changes.
2. `lesson-panel.test.ts`: "TR-50: a microphone that is refused says plainly that typing works" (single-turn voice). TR-50 asks for the microphone to start only on its button (that holds, tested) and for a plain line that typing works. In the single-turn voice (graph and geometry views) the refused microphone still shows only "The microphone stopped: not-allowed." with no word about typing. The lesson's conversation does say it (`microphoneMessage`, tested and passing).

## Where a builder choice differs from, or goes beyond, the docs

1. **`lesson_unknown` "at once" (failing test 1).** LE2 invariants say `lesson_unknown` "is the same, at once" as the server's `ended`; the transitions table lists it as its own guard of `end`, apart from "the end marker of a turn the server ended". The code treats it as the end marker case (the sentences already queued are spoken, then `end`). Either reading is a doc ruling; I tested the one the table lists.
2. **Design 6 table and LE2 disagree.** Design 6 has no `pause` by a tap, no `listen` from `off`, no `type` from `paused` to `thinking` as its own row (it says "`listening` or `thinking`"), and no `end` from `paused` as such. LE2 has all of them. LE2 was tested. Design 6 should gain the rows or say "see LE2".
3. **Space.** Design 6 says "learner taps the microphone or presses Space". The panel acts on Space only while the panel is open, only while the teacher thinks or speaks, and not from a text box or a button (builder choice 4). Tested: Space interrupts while speaking; a space typed in the text box does not. Not tested: Space with the panel closed (the docs are silent).
4. **Closing the panel pauses** (builder choice 3). LE2's `pause` row lists "the panel was closed", so this is the doc and was tested as such. The builder's open point (end instead of pause) is a product ruling.
5. **A failed `/start` ends the lesson** (builder choice 2). LE2 says so ("a lesson that is over: the notice is shown and the conversation goes `off`"). Tested as the doc says.
6. **Recognition that ends on words not marked final sends them** (builder choice 6). Not in LE2 (it says an end of recognition with nothing heard pauses). Not tested.
7. **The plan view is cleared by a new lesson, not by `end`** (builder choice 10). LE2 says the plan view is cleared on `start` and on `listen` from `off`; tested as that, and that the ended lesson's transcript stays until then.
8. **Design 8 studio rows.** The doc names `apps/studio/bench/lesson.bench.ts`; the three studio rows hold in it. They are not repeated as spec tests.
9. **`lesson_busy`.** The studio never meets it from the same address (round 1 report, contradiction 1); no studio test, since the barge-in sends a new turn and the old one is aborted.

## What is covered

- **LE2:** the 22 rows are parsed from the doc and compared with the table both ways (no row missing, none extra); the other 23 pairs are refused, reported once, and leave the state; the doc's "reachable invalid" pairs have no row; every public call in every state does what the table says (33 combinations) and reports no fault.
- **Start lesson to listening:** off to thinking at once, `/start` with the board, then `/turn` with the id, the words and the board; thinking to speaking when the first clip plays; sentences in order, one at a time, audio asked for at once; a missing clip spoken by the browser's voice; after the queue drains the microphone opens by itself (not before, not while the stream is open, not while a clip plays); a turn with only actions goes to listening; the id is kept (no second `/start`).
- **Microphone closed while speaking:** no recogniser open when any clip starts, over three turns; never open in `thinking` or `speaking`; a result that arrives after the learner was answered is dropped.
- **Barge-in:** a tap or Space while speaking or thinking stops the clip, drops the queue, aborts the turn, commits the board's gesture as stopped (once) and opens the microphone; typing does the same and starts the next turn at once; events of the old turn that arrive late (a stream that ignores the abort) add no line, sound, action or plan, and do not end the new turn.
- **Silence:** the 8 s timer starts when the microphone opens, is cancelled by any heard words, none while the teacher thinks or speaks; fired, the conversation pauses and the microphone closes; the browser's own end with nothing heard pauses; a failed microphone pauses and says typing works; a tap while listening pauses; from `paused` a tap, Space or typing goes on with the same lesson id. Also through the panel with faked `setTimeout`: 7.999 s nothing, 8 s paused.
- **No recogniser:** `listen()` refused; the lesson starts by typing; `listening` has nothing open, no timer and never pauses; the text box takes the focus; typing goes on turn after turn; a tap or Space still interrupts.
- **End:** End in each state; the server is told with the lesson id; `done: { ended: true }` speaks the last sentences, then off, no microphone, no `/end` call; `lesson_unknown` in the stream and as the server's 404 is off with "Start a new lesson" and no `/end` call; a new lesson gets a new id and an empty transcript and plan view; a failed start (503 with a message, unreachable, begun by the microphone) shows the message and goes off; another error shows its notice and the lesson goes on; a cut stream or junk waits for the learner.
- **Plan view:** the last `lesson` event as it came, replaced by the next, applied in any state without a move, kept through a turn, a pause and the next words, cleared by a new lesson; shown in the panel with the step marked (`aria-current="step"`) and before the transcript.
- **Board:** `say` is a teacher line in order, transcript capped at 60; `actions` are applied when they arrive while the teacher still speaks; one `begin` and one `finish` for each answer however many `actions` events; a barge-in finishes once as stopped; late actions after a barge-in are not run; on a real board three `actions` events are one undo step, two answers are two steps, a stopped answer is one step, and a new answer begun before the last was finished commits the last first.
- **Talk panel and TR-50:** opening the panel (on a board, in a graph view, reopened, in the opened studio notes and graphing modes) starts no recognition; the microphone starts only on its button or on Start lesson with an empty box; where nothing can listen there is no microphone button and the text box has the focus; Start lesson, End lesson, Enter, the plan, "Start a new lesson", the failed-start message, transcript text (not HTML), click on the microphone and Space interrupt, Space in the text box does not, closing the panel pauses, and the single-turn voice goes idle and does not reopen the microphone.

## Not covered

- The live run (R7.2) is Opus's (plan Round 2 item 6); no screenshots here.
- Space with the panel closed, and the studio's own Space (pan) when the teacher is silent: the docs say nothing precise.
- `/v1/speech` details (audio formats, sample rate) belong to the round 4 voice tests.
- The three studio design 8 rows are measured by the builder's bench, which was run, not copied.

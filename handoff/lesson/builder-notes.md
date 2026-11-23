# Lesson: builder notes, round 1

Branch `feat/lesson-r1`. Round 1 of `handoff/lesson/plan.md` (items 1 to 8). No tests were written (testers do that); the builder ran scratch tests only and deleted them. `npm run lint`, `npm run typecheck` and `npx vitest run` pass (318 files, 12,949 tests, 11 skipped, 6 todo; the skips are the same as before).

## What was built

| Item | Where |
|---|---|
| 1. `LESSON_MACHINE` (LE1), written first, own commit | `docs/state-machines.md`, section "lesson" |
| 2. Lesson memory: `LessonMemory`, `newMemory`, `memoryBlock` (at most 600 tokens), `recordTurn`, `historyOf`, `lessonView` | `packages/teacher/src/lesson/memory.ts` |
| 3. `lesson_plan`, `lesson_step` (`lessonTools(memory)`, extra tools of a toolset) | `packages/teacher/src/lesson/tools.ts` |
| 4. Job `lesson`, instructions of `agent.md` 1; reserved names in the grammar (TR-47) | `packages/teacher/src/prompt/jobs.ts` (`LESSON`, `LESSON_END_INSTRUCTION`), `prompt/grammar.ts` |
| 5. `lessonTurn` over the board target; no repeated board action in a turn (TR-49) | `packages/teacher/src/lesson/turn.ts` (`OnceBoard`, `isEndRequest`) |
| 6. The lesson store: `Lesson`, `LessonStore`, `LESSON_MACHINE` | `packages/server/src/lessons/store.ts` |
| 7. `POST /v1/lesson/start`, `/turn`, `/end`; `lesson_unknown`, `lesson_busy`, `lesson_full` | `packages/server/src/jobs/lesson.ts`, `errors.ts`, `http/server.ts` (route table, `Server.lessons`), `jobs/context.ts` (`Context.lessons`) |
| 8. The studio client: `startLesson`, `streamLessonTurn`, `endLesson`, `parseLessonEvent` (no UI) | `apps/studio/src/lesson-client.ts` |

Changes to what was there: `tools/types.ts` (`LessonView`; `TurnOutput` has `{ lesson }`), `loop/turn.ts` (`TurnEvent` has `{ lesson }`, and `done` may carry `ended`), `prompt/build.ts` (`TurnRequest.memory`, a string put in the system text and counted in its room), `index.ts` of both packages, `jobs/teach.ts` (`readBoard` is exported).

Checked by scratch tests (no network, the fake model): a first turn plans, writes the plan on the board and records itself; a second turn sees the first as history; a repeated action in one answer is answered "already done" and not sent; a `page` action starts the count again; the closing turn after "stop the lesson" has only `board_read` and ends with `done` and `ended`; the memory block of a full memory is 584 tokens and the lesson prompt 2,469 tokens with it; start, turn, turn, end over HTTP; a second turn of the same client while the first runs ends the first with `superseded`; the store's limits (idle, 100 held, eviction, busy from another client).

## Choices where the docs were silent

1. **`LESSON_MACHINE` has one move more than design 6 names,** `replan` (`waiting` to `planning`), written in LE1. A turn that ends without a plan (the model never called `lesson_plan`, or it failed) leaves the lesson `waiting`; its next turn sends `replan`, so `teaching` always has a plan and the lesson asks for one again. `speak` is the move when a plan exists.
2. **Who owns the machine.** It is in the server's store (as `design.md` "Where" says). The teacher's `lesson` event carries `{ plan, step, state }` with `state` read from the memory (`planning` until a plan exists, then `teaching`); the route moves the machine (`planned`) and sends the machine's own `state` on the wire. They are equal by construction.
3. **Recent turns are the request's `history`, not part of the memory block.** The block holds the topic, the plan with the step now, the summary and the hard notes, inside a `<material>` block (the topic and notes come from what the learner said), and is cut to 600 tokens: oldest hard notes first, then the summary from its end. The block goes in the system text, so the catalogue gets less room (`SYSTEM_TARGET` is unchanged). The kept turns go as chat messages, the learner's in `<material>` and the teacher's as the teacher's own words (it is the server's own record, TR-9, TR-38).
4. **Sizes.** A turn kept in memory holds at most 800 characters a side; a hard note 80; the topic 120 (the first words of the first turn when `/start` gave none); a step 80; the summary 1,200. A lesson is about 14 KB at most.
5. **`lesson_plan` resets the step to 1** when it replaces a plan (design 5: `{ ok: true, step: 1 }`). After a replan the model sets the step with `lesson_step`. `lesson_step` is T001 when: nothing was sent, there is no plan, `to` is not `'next'` or a whole number of the plan, `'next'` is asked on the last step, `summary` or `hard` is blank. The summary replaces the old one; a hard note is added (the same note once), the last 10 stay. The result is `{ ok: true, step }`. Every good call sends a `lesson` event, also when only the summary changed.
6. **The learner ends the lesson** with a phrase that is the whole utterance (`isEndRequest`): "stop", "stop the lesson", "end the lesson", "that's all", "I'm done", "bye" and the like, after dropping case, punctuation and a polite word ("ok", "please") at either end. "Stop, I don't get it" is not an end. The closing turn has `board_read` only, and a request instruction that says the rules above give way: two spoken sentences, goodbye, no question, no board change. Its `done` carries `ended: true`; the turn is not recorded in memory. The list is in code; the model has no tool to end a lesson.
7. **Repeated actions (TR-49).** The key is the action as JSON with sorted keys. An action that names `$last` is equal to an earlier one only when no action passed between them. A `page` action that passed empties the keys (the same note on a new page is new). The answer for a repeat is `{ ok: true, already: 'done', message }` and `applied` counts only what was sent. The count is for the turn, across its `board` calls.
8. **A turn is recorded in the memory by `lessonTurn`** when it ends with `done` and its signal was not aborted. A turn that the client closed, that a newer turn replaced, or that the lesson's end stopped is not in the memory; the board still shows what it drew.
9. **Busy and barge-in.** "A turn runs" is the machine being in `planning` or `teaching`. A turn from the client whose turn runs replaces it (the store sends `turnEnd` for the old one, stops it, and begins the new one in one step; the old stream ends with `superseded`). From another client it is `lesson_busy` (409, an HTTP status). So `lesson_busy` only shows between two addresses; the same address is the studio's barge-in and needs no abort-first round trip. A late end of the replaced turn is dropped by its turn number.
10. **Limits.** Idle time is from the last turn's begin or end on the injected clock; a lesson with a turn running is never idle. The 200th turn is allowed, and the lesson ends when it ends, with `ended: true` on that `done` and no closing summary. `/start` ends the idle lessons first, then at 100 held ends the idle lesson with the oldest last call; a lesson with a turn running is never evicted, and `lesson_full` (503, `retryAfterMs` 60,000, so `retry-after: 60`) is only when all 100 run turns. A call for an id past its idle time answers `lesson_unknown`. `/end` while a turn runs stops it: that stream ends with `lesson_unknown` ("This lesson has ended.").
11. **Checks and order of `/turn`:** fields (400, 413), key (503), daily budget (429), `lesson_unknown` (404), `lesson_busy` (409), the client's slot (429), then the stream. `board` is required in `/start` and `/turn` (design 7 does not mark it optional); the topic is at most 4,000 characters (413) and cut to 120 in memory. `/turn` takes the client's one model slot as `/v1/teach` does, so a `/turn` also ends a running `/v1/teach` or board request of the same client, and the other way. `/start` counts 1 in the client's minute, `/end` 0.1; neither takes the slot.
12. **TR-47.** "The unit names" is read as the angle units `deg`, `turn`, `grad`; the card now lists every reserved word of `names.ts` (also `bt`, `beat`, the axis names, `undefined`, the keywords) and free names for objects. The hint of K003 was not changed (it is not in plan item 4).
13. **Two existing tests changed** because `JobId` has a fifth member: `packages/teacher/test/spec/prompt.test.ts` has `lesson` in its `JOB_TOOLS` record (the type needs it) and "the four jobs have four different instructions" counts `JOB_IDS.length`. Nothing else in any test file changed.
14. **The studio client** repeats the NDJSON reading loop of `teach-client.ts` instead of sharing it, so the working voice lesson is untouched. Network and abort failures are values (`unreachable`, `aborted`), and a `/v1/lesson/turn` HTTP error is one `error` event with the server's `kind`.

## Left undone

- No tests, no benches (design 8): the tester and round 2. The server work per turn before the model, and the memory size, are not measured.
- `.kiro/specs/lesson/tasks.md` is not ticked and `.kiro/steering/kiro-usage-log.md` has no row for this round yet (after the tester and the review).
- `docs/features/server/design.md` 6 does not list the three lesson endpoints yet (`docs/features/lesson/design.md` 7 does); `server/errors.md` does not list the three lesson errors (`lesson/errors.md` does).
- The studio has no UI and no use of the client (round 2). TR-50 (the microphone opening with the panel) is round 2.
- The hint of K003 (a free name offered, TR-47) is not changed.

## Open points for the review

- `lesson_busy` is only between two client addresses (choice 9). If the product owner wants it also for the same client, the studio must abort first and the store must stop replacing.
- The 200th turn ends the lesson with no closing words (choice 10).
- An interrupted turn is not in the memory (choice 8), so the learner's words in it are lost to the next turn.

# Lesson: builder notes, round 2

Branch `feat/lesson-r2`. Round 2 of `handoff/lesson/plan.md` (items 1 to 5; item 6, the live run, is Opus's). No tests were written (testers do that); the builder ran two scratch test files (the conversation with a fake server, microphone and timer; the panel in happy-dom) and deleted them. `npm run lint`, `npm run typecheck` and `npx vitest run` pass (325 files, 13,197 tests, 11 skipped, 6 todo; the same skips as before). Nothing in `packages/server` or `packages/teacher` changed.

## What was built

| Item | Where |
|---|---|
| 1. `CONVERSATION_MACHINE` (LE2), written first, own commit | `docs/state-machines.md`, section "lesson", "Round 2" |
| 2. The conversation: `LessonConversation`, `CONVERSATION_MACHINE`, `ConversationTarget`, `microphoneMessage`, `SILENCE_MS` | `apps/studio/src/lesson.ts` |
| 2. Shared speech of a sentence (`speakSentence`), moved out of `VoiceLesson` so both lessons use it | `apps/studio/src/voice.ts` |
| 3. Talk panel: Start lesson, End lesson, plan and step at the top, no microphone on open (TR-50, also in the single-turn voice), Space | `apps/studio/src/voice-ui.ts`, `page.css`, `studio-page.ts` (`mountVoice` gets `conversation`) |
| 4. `actions` through the board's runner in one gesture for each answer | `apps/studio/src/voice-targets.ts` `boardConversation` |
| 5. Benches with a fake model | `apps/studio/bench/lesson.bench.ts`, `apps/studio/bench/vitest.config.ts` (run: `npx vitest run --config apps/studio/bench/vitest.config.ts`) |

Config: `eslint.config.js` and `tsconfig.json` now include `apps/*/bench` as dev code (as `packages/*/bench`). Docs: lesson design 8 has three studio rows.

Bench numbers (Node, warm, fake model): one line parsed 0.0004 ms (target 0.01); one event through the conversation 0.003 ms (0.2); a turn of 10 events and 3 board actions on a headless board 0.24 ms (5); a turn after 320 turns 0.026 ms (flat, transcript capped at 60 lines).

## Choices where the docs were silent

1. **Machine moves.** Design 6 has no `pause` by tap and no `listen` from `off`. LE2 adds: `pause` (silence, the browser ending the recognition with nothing heard, a microphone failure, a tap on the microphone while listening, closing the panel); `listen` from `off` (the microphone starts a lesson when the box is empty and the browser can listen); `type` also from `paused`; `end` also from `paused`.
2. **Where the lesson starts.** `/v1/lesson/start` is asked inside the first turn (`thinking`), with no `topic`: the server takes the first words as the topic (round 1, choice 4). A start that fails (no key, unreachable) is a lesson that is over: the notice shows the server's message, the conversation goes `off`, and the panel offers Start lesson. For a lesson begun by the microphone, `/start` is asked at the first words.
3. **Closing the panel does not end the lesson.** It pauses it (teacher silenced, microphone closed, the turn aborted so the server records it as interrupted, LR-3); the plan stays; the learner reopens the panel and taps the microphone or types. End lesson ends it, and so does a view with nothing to teach on (`setAvailable(false)`).
4. **Space** interrupts only while the teacher thinks or speaks, and not from a text box, field or button, and only with the panel open. It acts on the document in the capture phase, so the board's own Space (pan) is untouched while the teacher is silent or the learner's turn. A tap on the microphone is the barge-in everywhere else; in `listening` it pauses (a second tap).
5. **Where the browser cannot listen,** `listening` is the text box's turn: no microphone, no timer (so no pause), the status says "Your turn: type your answer.", and the text box takes the focus when the lesson enters `listening`.
6. **Silence.** The 8 s timer starts when the microphone opens and is cleared at the first interim words. A recognition that ends with words not marked final sends them as the answer; with none it pauses.
7. **LF-5** (the 200th turn's closing sentence): the conversation speaks the sentences of the turn, and at the end marker `ended` sends `end` instead of `drained`. `lesson_unknown` goes `off` at once with the notice "This lesson has ended. Start a new lesson to go on." and the button reads "Start a new lesson" (derived from a non-empty transcript, not a flag).
8. **One undo step.** `boardConversation.begin` opens a `model` gesture, `actions` run the runner with it, `finish` commits it; a stopped turn first calls `runner.stop()`, so waiting actions do not run (what was made stays). The gesture is a record in the target's closure, not a class field.
9. **The single-turn voice.** The Talk panel is a lesson wherever the board is open, else the single-turn voice (`VoiceLesson`, TE4) for graph and geometry views. `boardLesson` (single turn on the board) is no longer used by the page; it is left exported for its tests.
10. **A new lesson clears the transcript and the plan view;** an ended lesson's transcript stays on screen until then.

## Left undone

- No tests (testers). No live run and no screenshots: the plan gives them to Opus (item 6), and a fake-transport screenshot needs Playwright, which is not in the repository.
- `.kiro/specs/lesson/tasks.md` is not ticked and `.kiro/steering/kiro-usage-log.md` has no row for this round yet (after the tester and the review).
- LF-1 to LF-4 of `findings.md` are untouched.

## Open points for the review

- Closing the panel pauses instead of ending (choice 3); if the product owner wants it to end, change `closePanel`.
- A failed `/start` ends the lesson (choice 2); the alternative is to wait for the learner's next words.
- The microphone's `pause` on a second tap is not in design 6 (choice 1).

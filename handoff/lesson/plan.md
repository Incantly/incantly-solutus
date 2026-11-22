# Lesson: build plan

For the builder (Sonnet 5.5). Read `AGENTS.md`, `docs/features/lesson/*`, `.kiro/specs/lesson/*`, and what it builds on: `docs/features/teacher/design.md` 5, 6, 8; `docs/features/server/design.md` 6, 7; `docs/features/board/agent.md`; `handoff/teacher/findings.md` TR-9, TR-38, TR-47, TR-49, TR-50. Builders write no tests. No new library; no network.

Existing code to build on:

| What | Where |
|---|---|
| The turn loop, toolsets, prompt builder | `packages/teacher/src/loop/turn.ts`, `tools/toolset.ts`, `prompt/build.ts`, `prompt/jobs.ts` |
| Board tools and target | `packages/teacher/src/tools/board.ts`, `board-target.ts`, `loop/board.ts` |
| The live job (voice) | `packages/teacher/src/loop/live.ts`, `stream/sentences.ts` |
| Server routes, jobs, limits, errors | `packages/server/src/http/server.ts` (`ROUTES`), `jobs/teach.ts`, `jobs/board.ts`, `limits/rate.ts`, `errors.ts` |
| Studio voice lesson, Talk panel, teach client | `apps/studio/src/voice.ts`, `voice-ui.ts`, `voice-audio.ts`, `voice-targets.ts`, `teach-client.ts` |
| Board in the studio, its agent transport | `apps/studio/src/board-agent.ts`, `studio-page.ts` |

## Round 1: the teacher and the server

1. `docs/state-machines.md`: section "lesson", `LESSON_MACHINE` as design 6. Commit first.
2. `packages/teacher/src/lesson/memory.ts`: `LessonMemory` (plain data: topic, plan, step, recent turns ≤ 6, summary ≤ 1,200 chars, hard ≤ 10), `memoryBlock(memory)` for the prompt (at most 600 tokens), `recordTurn`.
3. `lesson/tools.ts`: `lesson_plan` (3 to 8 steps, each ≤ 80 chars), `lesson_step` (`to: 'next' | number`, `summary`, `hard`); T001 on bad input; they write into the memory the job passes.
4. `prompt/jobs.ts`: job `lesson` with `agent.md` 1 as its instructions. The grammar summary lists the reserved names (TR-47).
5. `lesson/turn.ts`: `lessonTurn({ client, memory, board, text, signal, now })` over the board target, toolset `board_read`, `board`, `lesson_plan`, `lesson_step`; emits `say` (whole sentences), `actions`, `lesson` (`{ plan, step, state }`), `done` (with `ended` when the learner ended it). A `board` action equal to one already sent in the turn is answered "already done" and not sent again (TR-49).
6. `packages/server/src/lessons/store.ts`: lessons by `crypto.randomUUID()`; one field over `LESSON_MACHINE` each; 15 min idle and 200 turns end a lesson (checked from the injected clock on each call, no timers); at most 100, evicting the oldest idle; `lesson_busy` while a turn runs (a newer turn of the same lesson from the client aborts the older one first, as the route's superseded rule).
7. `jobs/lesson.ts`: the three routes of design 7 with the server's checks, limits and rulings (HTTP status for checks, stream events after); `lesson_unknown`, `lesson_busy`, `lesson_full` in `errors.ts`; the learner's "stop" ends the lesson through the model's closing turn and `done: { ended: true }`; `/end` ends it at once.
8. Studio: `teach-client`-style `lesson-client.ts` (start, turn as NDJSON, end). No UI yet.

## Round 2: the studio conversation and the proof

1. `docs/state-machines.md`: `CONVERSATION_MACHINE` as design 6. Commit first.
2. `apps/studio/src/lesson.ts`: the conversation over `CONVERSATION_MACHINE`, reusing the sentence queue and audio of `voice*.ts`; after the queue drains, listen again (or wait for the text box); 8 s silence pauses; a tap on the microphone or Space interrupts; End and the server's `ended` stop it.
3. Talk panel on the board: "Start lesson" (asks for a topic or takes the first words), "End lesson", the plan and current step shown at the top of the panel; opening the panel no longer starts the microphone (TR-50).
4. Board events: `actions` applied through the board's agent runner, `say` into the conversation, `lesson` updates the plan view.
5. Benches (design 8) with the fake model.
6. Live run (done by Opus after the round 2 merge, not by the builder): the server with the real key, the studio, headless Chrome typing the learner's turns ("Teach me about linear algebra", an answer to the first check, "I don't get it", "go on", a new question, "stop the lesson"). `handoff/lesson/live-run.md` gets each turn's time to the first sentence, and `handoff/lesson/screens/` the board after turns 1, 3 and 6.

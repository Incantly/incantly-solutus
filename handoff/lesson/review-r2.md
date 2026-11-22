# Lesson, round 2: review

One review (Opus), after the tester's report (`test-report.md` "Round 2", 2 failing of 180). The fixer fixes LR-9 to LR-12, then merges. No new kind of hidden state: the conversation is one field over `CONVERSATION_MACHINE`; its run and its microphone handle are cleared on the moves that leave their states, and `micOpen` reads the handle of the open microphone, which is the device, not a second record of the state.

## Rulings

| Question | Ruling |
|---|---|
| `lesson_unknown` while a sentence plays | "At once" wins: the lesson is gone on the server, so playing on would teach into nothing. Stop the clip, drop the queue, go `off`, offer "Start a new lesson" (LR-9) |
| The moves LE2 adds (`listen` from `off`, `pause` by a second tap, `type` and `end` from `paused`) | Keep them. Lesson design 6 gets the rows |
| Space | Only with the panel open, only while the teacher thinks or speaks, never from a text box or button. Design 6 says so |
| Closing the panel | Pauses the lesson; opening it again shows the paused lesson and its plan. Design 6 says so |
| A failed `/start` | The lesson goes `off` with the server's message and offers Start lesson again. Design 6 says so |
| Words the browser ended without marking final | Sent as the answer, as a final result would be: the learner stopped speaking. Design 6 says so |

## Findings, fix now

| Id | Where | Problem | Fix |
|---|---|---|---|
| LR-9 | `apps/studio/src/lesson.ts` | The ruling above: `lesson_unknown` waits for the playing sentence to end | Stop at once |
| LR-10 | `apps/studio/src/voice*.ts` (single-turn voice) | A refused microphone shows only "The microphone stopped: not-allowed." (TR-50) | Say what to do: "The microphone is off. Type your question below." (the lesson's own wording) |
| LR-11 | docs | The rulings above | Lesson design 6 |
| LR-12 | tests | Tests resting on the rulings | Change only those, list each |

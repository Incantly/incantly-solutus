# Lesson: requirements

Area: `docs/features/lesson/` (`design.md`, `errors.md`, `agent.md`). Packages `packages/teacher`, `packages/server`, `apps/studio`; the board's agent actions as they are. Branches `feat/lesson-r1`, `feat/lesson-r2`.

### R1. A conversation (design 1, 6)

1. A lesson SHALL go on turn after turn until the learner ends it, or it times out (15 minutes idle, 200 turns).
2. After the teacher's last sentence of a turn, the studio SHALL open the microphone again by itself; where the browser cannot listen, the text box SHALL stay the way in.
3. The microphone SHALL be closed while the teacher speaks; a tap on the microphone or Space SHALL interrupt the teacher and listen.
4. Opening the Talk panel SHALL not start the microphone; "Start lesson" SHALL.
5. "Stop", "end the lesson" or the End button SHALL end the lesson with a short spoken summary.

### R2. Teaching (design 3, agent.md)

1. The first turn SHALL make a plan of 3 to 8 steps (`lesson_plan`), say it and write it on the board.
2. Each turn SHALL teach one idea: speak, write a short note, sketch when a picture helps, and use a figure card only when maths must move or be exact.
3. Each turn SHALL end with one check question, and the teacher SHALL then wait.
4. An answer SHALL be judged and explained; a wrong one SHALL be taught again another way.
5. Each step SHALL start on a new board page named after it.
6. The same board action SHALL not be sent twice in one answer (TR-49).
7. The instructions SHALL list the reserved names (TR-47).

### R3. Memory (design 4)

1. The server SHALL hold each lesson in memory only: plan, step, the last 6 turns, a summary of at most 1,200 characters, at most 10 hard notes.
2. A lesson id SHALL be a random 128-bit value; the client SHALL send only the learner's words and the board in view.
3. The server SHALL hold at most 100 lessons and end the oldest idle one past that, and SHALL end a lesson after 15 minutes idle or 200 turns.

### R4. Tools (design 5)

`lesson_plan` and `lesson_step` SHALL be teacher tools with schemas, and refuse bad input with T001.

### R5. Server (design 7, errors.md)

1. `POST /v1/lesson/start`, `/v1/lesson/turn` and `/v1/lesson/end` SHALL work as design 7, under the server's limits and rulings.
2. `lesson_unknown` (404), `lesson_busy` (409) and `lesson_full` (503) SHALL be returned as `errors.md` says.

### R6. States (design 6)

`LESSON_MACHINE` and `CONVERSATION_MACHINE` SHALL be written in `docs/state-machines.md` before the code, and be the only state of the lesson and of the studio's conversation.

### R7. Speed and proof (design 8)

1. The design 8 budgets SHALL hold in benches with the fake model.
2. A live run with the free models SHALL show a lesson of at least 6 turns on the board (a plan, notes, a sketch, a check answered, a new page, an end), with screenshots.

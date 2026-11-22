# Lesson: errors

Errors use the SDK shape, as the server's (`docs/features/server/errors.md`), and follow its rulings: a check answers with an HTTP status; after the stream opens, an error is the last event.

| Kind | HTTP | When | Message | Recovery |
|---|---|---|---|---|
| `lesson_unknown` | 404 | The lesson id is not held: it ended (the learner, 15 minutes idle, 200 turns, evicted) or never was | "This lesson has ended." | The studio offers "Start a new lesson" |
| `lesson_busy` | 409 | A turn of this lesson is still running | "The teacher is still answering." | The studio aborts the running turn first (a barge-in), then sends |
| `lesson_full` | 503 | 100 lessons are held and none is idle enough to end | "The server is teaching too many lessons; try again in a minute." | Retry |

The teacher's tool errors (`docs/features/teacher/errors.md`) apply to `lesson_plan` and `lesson_step`: a plan of fewer than 3 or more than 8 steps, or a step outside the plan, is `tool_input` (T001).

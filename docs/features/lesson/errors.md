# Lesson: errors

Errors use the SDK shape, as the server's (`docs/features/server/errors.md`), and follow its rulings: a check answers with an HTTP status; after the stream opens, an error is the last event.

| Kind | HTTP | When | Message | Recovery |
|---|---|---|---|---|
| `lesson_unknown` | 404 | The lesson id is not held: it ended (the learner, 15 minutes idle, its 200th turn, evicted) or never was | "This lesson has ended." | The studio offers "Start a new lesson" |
| `lesson_busy` | 409 | A turn from another client address is still running on this lesson | "The teacher is still answering." | Wait, then send. A newer turn from the same client is not busy: it replaces the running one, which ends with `superseded` (a barge-in) |
| `lesson_full` | 503 | 100 lessons are held and every one has a turn running | "The server is teaching too many lessons; try again in a minute." | Retry (`retryAfterMs` 60,000) |
| `model_unavailable` | 503 | `/v1/lesson/start` or `/turn` with no model key on the server | "The AI is not set up." | Set the key. A lesson that cannot have a turn does not start |

The teacher's tool errors (`docs/features/teacher/errors.md`) apply to `lesson_plan` and `lesson_step`: a plan of fewer than 3 or more than 8 steps, or a step outside the plan, is `tool_input` (T001).

The 200th turn is not an error: it runs, the server says "That's the end of this lesson. Start a new one to go on." before its `done`, and that `done` carries `ended: true`. The next call is `lesson_unknown`.

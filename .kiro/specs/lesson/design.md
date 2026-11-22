# Lesson: design

The feature design is `docs/features/lesson/design.md`; this file says where each part lives. The build plan is `handoff/lesson/plan.md`.

| Path | Holds |
|---|---|
| `packages/teacher/src/lesson/memory.ts` | `LessonMemory`: plan, step, recent turns, summary, hard notes, as data; its prompt block |
| `packages/teacher/src/lesson/tools.ts` | `lesson_plan`, `lesson_step` |
| `packages/teacher/src/lesson/turn.ts` | `lessonTurn`: the `lesson` job over the board target, the memory and the turn loop |
| `packages/teacher/src/prompt/jobs.ts` | The `lesson` job's instructions, from `agent.md` |
| `packages/server/src/lessons/store.ts` | The lessons in memory: ids, `LESSON_MACHINE`, idle and turn limits, eviction |
| `packages/server/src/jobs/lesson.ts` | `/v1/lesson/start`, `/turn`, `/end` |
| `apps/studio/src/lesson*.ts` | The conversation over `CONVERSATION_MACHINE`, the Start lesson and End buttons in the Talk panel, the auto-listen loop |

## Rules

- No new library. No network in tests; the fake model only.
- The board's actions and the voice code are reused; the board package is not changed unless a test shows it must be.
- Every lint rule is an error; every state is one field over a `*_MACHINE` table.
- Tests are written by the tester from the docs. Testers run only their packages' tests while writing and the full suite once at the end, with no break-the-code checks.

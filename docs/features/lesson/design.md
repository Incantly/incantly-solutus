# Lesson: design

A lesson is a conversation with the teacher that goes on until the learner ends it. The learner says "Teach me about linear algebra", and the teacher does not just draw something. It plans the lesson, says the plan, and teaches one idea at a time: it speaks, writes notes on the board, sketches with the pen, draws a live figure only when the maths must move or be exact, and then asks the learner something and listens. The microphone opens again by itself after each answer. The lesson ends only when the learner says so.

The lesson builds on the teacher's turn loop (`docs/features/teacher/design.md` 6), the board's agent actions (`docs/features/board/agent.md`), the server (`docs/features/server/design.md`) and the voice lesson (teacher design 8). This file says what is new.

## 1. What the learner sees

```
"Teach me about linear algebra"
  -> the teacher: "We'll learn it in five steps: vectors, adding them, scaling, matrices as moves, and solving." (spoken, and written as a list on page 1)
  -> step 1: "A vector is an arrow: how far and which way." It writes "Vector = size + direction", draws an arrow with the pen, labels it v.
  -> "Can you tell me what changes if I make the arrow twice as long?"  (the microphone opens)
"It gets bigger?"
  -> "Yes, its size doubles, and its direction stays." It writes "2v: same direction, twice as long" and draws 2v beside v.
  -> ... step by step ...
"OK, stop the lesson."
  -> "Well done. Today we covered vectors and adding them. We'll start with scaling next time." The lesson ends.
```

| Part | Where |
|---|---|
| The conversation | The Talk panel, with each spoken sentence as text |
| Notes, lists, formulas | The board, as text (typed or hand style, `$…$` for maths) |
| Sketches | The board, as pen strokes, shapes, arrows and marks |
| Live figures | A figure card, only when a value must move or a graph must be exact |
| Parts of the lesson | One board page a part, named after the step |

## 2. Words

| Word | Means |
|---|---|
| Lesson | One conversation on one board, from its start until the learner ends it, or it times out |
| Plan | The lesson's steps: 3 to 8 short titles, made in the first turn and changed when the learner asks |
| Step | One idea of the plan. A step takes one or more turns |
| Turn | One thing the learner says and the teacher's whole answer to it (teacher design 6) |
| Check | The question the teacher ends a turn with, to see if the learner follows |
| Memory | What the server keeps about a lesson: the plan, the step, a short summary of earlier turns, the last turns as they were, what the learner found hard |

## 3. How the teacher teaches

Every turn follows the same order. The lesson job's instructions hold it (`agent.md`).

1. **Answer what the learner said.** If they answered a check, say whether it is right, kindly, and why.
2. **Teach one idea.** One to three short spoken sentences.
3. **Show it.** Write the idea as a short note on the board. Sketch it if a picture helps: an arrow, a box, a line, a mark around something. Use a figure card only when the maths must move (a slider, a dragged point, motion) or be exact (a graph, a shape built from points).
4. **Check.** End with one question, or "Shall we go on?". Then stop and wait.

| The learner says | The teacher |
|---|---|
| A topic ("teach me X") | Makes the plan, says it, writes it, starts step 1 |
| An answer to a check | Says if it is right; explains again another way if not; goes on when it is |
| "Go on", "next" | Moves to the next step |
| "I don't get it", "again" | Explains the same idea another way, with another picture |
| A new question | Answers it, then comes back to the plan |
| "Change the plan", "skip this" | Changes the plan and says the new one |
| "Stop", "end the lesson", "that's all" | Says a two-sentence summary and ends the lesson |

## 4. Memory on the server

The server keeps each lesson in memory, so the browser sends only what the learner said and the board in view. This also closes TR-9 and TR-38: the earlier turns are the server's own, not the client's.

| Held | Size |
|---|---|
| Topic, plan, current step | At most 8 steps of 80 characters |
| The last turns as they were | The last 6 turns |
| A summary of older turns | At most 1,200 characters, rewritten by the teacher's `lesson` tool |
| What the learner found hard | At most 10 short notes |

- A lesson lives in the server's memory only, never on disk. It ends after 15 minutes without a turn, or when its 200th turn ends. The server holds at most 100 lessons; a new one past that ends the oldest idle one.
- The 200th turn runs like any other. Before its `done` (which carries `ended: true`) the server adds one `say`: "That's the end of this lesson. Start a new one to go on."
- A turn that was interrupted (the learner spoke over it, or a newer turn replaced it) is kept in the memory: the learner's words, and what the teacher had said so far followed by "(interrupted)". The next turn so knows what was asked and that the answer was not finished.
- Sizes the table does not list: a kept turn holds at most 800 characters a side, a hard note 80, the topic 120 and a plan step 80.
- A lesson id is a random 128-bit value (`crypto.randomUUID`), held by the browser for that board. Another client cannot guess it.
- The browser may end a lesson at any time; the server forgets it then.

## 5. Tools

The lesson job offers the board tools (`board_read`, `board`) and two new ones.

| Tool | Input | Result |
|---|---|---|
| `lesson_plan` | `{ steps: string[] }` (3 to 8) | `{ ok: true, step: 1 }`. Sets or replaces the plan |
| `lesson_step` | `{ to?: 'next' \| number, summary?: string, hard?: string }` | `{ ok: true, step }`. Moves the step, rewrites the summary, notes what was hard |

The lesson ends through the request (`end`), not through a tool, so only the learner ends it.

Board rules the lesson adds (board agent.md 4 still holds):

- Write each step on its own page: `page` with `to: 'new'` and the step's title as `name`, when a step starts.
- Notes go down the left of the page, sketches and figures to their right (`near` with `side: 'right'`).
- A note is at most 80 characters. A list is one `write` a line.
- Pen sketches use `stroke` with at most 64 points, or the shape kinds, arrows and marks, which read better than freehand.
- An action that passed is done: never send it again in the same answer on the same page (TR-49). The same note on a new page is a new action.

## 6. States

The lesson on the server is one field over `LESSON_MACHINE` (written in `docs/state-machines.md` before the code):

| From | Event | To |
|---|---|---|
| `new` | first turn | `planning` |
| `planning` | `lesson_plan` passed | `teaching` |
| `planning`, `teaching` | turn ended with a check | `waiting` |
| `waiting` | the learner speaks, and the lesson has a plan | `teaching` |
| `waiting` | the learner speaks, and the lesson has no plan yet (`replan`) | `planning` |
| `teaching` | turn ended | `waiting` |
| `new`, `planning`, `teaching`, `waiting` | `end`, idle 15 min, 200 turns, evicted | `ended` |

`replan` is for a first turn that ended with no plan (the model never called `lesson_plan`, or the call failed): the lesson asks for a plan again, so `teaching` always has one.

The turn that runs is the machine being in `planning` or `teaching`. A turn from the same client while one runs replaces it (the older ends with `superseded`); the store ends the old turn and begins the new one in one step.

The studio's conversation is one field over `CONVERSATION_MACHINE`, which replaces the single-turn use of `VOICE_MACHINE` on the board:

| From | Event | To |
|---|---|---|
| `off` | start lesson | `thinking` |
| `off` | learner taps the microphone (where the browser can listen, box empty) | `listening` |
| `listening` | heard | `thinking` |
| `listening` | silence for 8 s, the browser ends the recognition with nothing heard, the microphone fails, or a second tap on the microphone (pause) | `paused` |
| `listening` | learner types | `thinking` |
| `thinking` | first sentence | `speaking` |
| `speaking` | queue drained | `listening` |
| `thinking`, `speaking` | learner taps the microphone or presses Space (barge-in) | `listening` |
| `thinking`, `speaking` | learner types (barge-in), or the panel is closed (pause) | `thinking`, `paused` |
| `paused` | learner taps the microphone or presses Space | `listening` |
| `paused` | learner types | `thinking` |
| any but `off` | End, the server says the lesson ended, `lesson_unknown`, or a `/start` that fails | `off` |

`docs/state-machines.md` LE2 is the full table (22 rows); this one lists the moves in the learner's words.

- The microphone is closed while the teacher speaks, so it does not hear the teacher's voice. A barge-in is a tap or Space, not speech.
- Where the browser cannot listen, the text box is the way in, and the conversation goes on the same way.
- Opening the Talk panel does not start the microphone (TR-50); "Start lesson" does.
- **`lesson_unknown`** (the lesson is gone on the server) wins at once: the playing sentence stops, the queue is dropped, the conversation goes `off`, and the panel offers "Start a new lesson". Playing on would teach into nothing.
- **Space** acts only with the Talk panel open, only while the teacher thinks or speaks, and never from a text box or a button.
- **Closing the panel** pauses the lesson. Opening it again shows the paused lesson and its plan.
- **A failed `/start`** puts the lesson `off` with the server's message and offers Start lesson again.
- **Words the browser ended without marking final** are sent as the answer, as a final result would be: the learner stopped speaking.
- **A refused microphone** in the single-turn voice (graph and geometry views) says "The microphone is off. Type your question below."; the lesson's own wording is in `microphoneMessage`.

## 7. Server

| Endpoint | Request | Answer |
|---|---|---|
| `POST /v1/lesson/start` | `{ topic?: string, mode?: string, board: { items, more, page } }` | `200` `{ lessonId }` |
| `POST /v1/lesson/turn` | `{ lessonId, text, board: { items, more, page } }` | NDJSON: `say`, `actions`, `lesson` (`{ plan, step, state }`), `done`, `error` |
| `POST /v1/lesson/end` | `{ lessonId }` | `200` `{ ok: true }` |

- Limits and errors are those of `/v1/teach` (server design 6, 7). New errors: `lesson_unknown` (404, the id is not held: it ended or never was) and `lesson_busy` (409, a turn from another client address is running on this lesson). A newer turn from the same client replaces the running one, which ends with `superseded`, so the studio's barge-in needs no abort-first round trip.
- `/start` needs the server's model key: without one it answers `model_unavailable` (503), since a lesson that cannot have a turn should not start.
- Every turn is a teacher turn of the `lesson` job, under the turn limits (teacher design 6).
- The `done` event of a turn that ended the lesson carries `ended: true`.

## 8. Performance

| Measure | Target |
|---|---|
| Server work per turn, before the model | under 5 ms |
| Memory per lesson | under 64 KB |
| From the end of the learner's words to the teacher's first spoken sentence | under 3 s with the free models (measured in the live run) |
| Studio work for one line of the answer, read | under 0.01 ms (`apps/studio/bench/lesson.bench.ts`) |
| Studio work for one event of a turn (read, transcript, queue, plan view) | under 0.2 ms, with the fake model |
| Studio work for a whole turn of 10 events and 3 board actions on a headless board, from the learner's words to waiting again | under 5 ms, with the fake model |

## 9. Open questions

1. Whether a lesson should be saved with the board file, so it can be continued another day (today: memory only).

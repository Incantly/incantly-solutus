# Lesson: live run

2026-11-22, on the developer's machine, after lesson round 2 merged (`5c604a2`). The server ran with the real OpenRouter key (free models from `.env.example`); the studio's board in headless Chrome, with speech recognition removed so the text box was the way in, and the server's voice playing each sentence. Times are from sending the words to the teacher's first sentence, and to the microphone's turn again.

| Turn | The learner typed | First sentence | Turn over | What the teacher did |
|---|---|---|---|---|
| 1 | "Teach me about linear algebra." | 9.8 s | 44.5 s | A plan of 6 steps, said and written as a list; step 1 as a figure card with v = (3, 1) and w = (−1, 2); explained; asked "Which way does w = (−1, 2) send you from the origin?" |
| 2 | "I think it gets twice as long but points the same way." | 2.1 s | 27.4 s | Said "Right" and explained scaling (2v = (6, 2), a negative flips it); asked "what number times v gives (2, 6)?" |
| 3 | "I don't get it, can you explain it another way?" | 1.8 s | 34.1 s | Explained again in words (the ratio of right to up stays fixed); asked "Does that make sense?" |
| 4 | "OK, go on." | 9.8 s | 42.1 s | Step 2 on page 2: a card with v, w and s = v + w, a note "Add matching parts…"; asked "what is (3, 1) + (1, 4)?" |
| 5 | "How is this used in computer games?" | 10.3 s | 32.3 s | Answered (position + movement = new position, as a hand-written note), then came back: "Back to step 2: what is (3, 1) + (1, 4)?" |
| 6 | "Stop the lesson." | 2.1 s | 25.4 s | A spoken summary and goodbye; the lesson ended; the panel offers "Start a new lesson" |

The conversation held for 6 turns: a plan, one idea a turn, a check each turn, a new page for step 2, a side question answered with a return to the plan, and an end on the learner's word.

Screens: `screens/live-lesson-turn1.png`, `screens/live-lesson-turn3.png`, `screens/live-lesson-turn6.png`.

## What fell short (fix later, `findings.md` LF-7 to LF-13)

- The teacher drew no pen sketches, arrows or shapes: every picture was a figure card or a note. The vectors were drawn as points, not arrows.
- "Explain it another way" gave new words but no new picture.
- Step 1 shared page 1 with the plan; the plan's title sits under the page bar.
- The plan in the panel reads "1. 1. Vectors as arrows" (the model numbers its steps and the list numbers them again).
- Turn 2 said "Right" to an answer of a different question.
- The first sentence took about 10 s on the turns that drew first (1, 4, 5), against the 3 s target; about 2 s on the others.

# Teacher and server, round 4: review

One review (Opus), after the tester's report (`test-report.md` "Round 4", 1 failing of 12,958). The fixer fixes TR-40 to TR-44, then merges. No new kind of hidden state: the voice lesson is one field over `VOICE_MACHINE`, its run and recogniser are cleared on the moves that leave their states (`state-no-shadow-null` holds), and the speech call is one machine (SV3).

## Rulings

| Question | Ruling |
|---|---|
| A line break ends a sentence only "when followed by a space" (design 8) vs at every line break (code) | Every line break ends a sentence: the model often writes one sentence a line, and a line break inside a sentence is rare in speech. Design 8 is reworded |
| The turn hitting 8 model calls answers `model_timeout` | Wrong kind. A turn's own limits (model calls, tool calls, 60 s) end with `turn_limit` (T003) and its message. `model_timeout` is only for no first byte from any model. Server `errors.md` gets a `turn_limit` row (stream only) |
| Timed `show_me` (`to`, `seconds`) moves the value at once | Not built yet (TR-34, fix later). Until then the tool takes only `{ name, value }`: the timed form leaves the schema and the live instructions, and design 4 marks it as later |
| Film tools on a card made earlier in the same board turn (TR-35) | Stays on the fix-later list |

## Findings, fix now

| Id | Where | Problem | Fix |
|---|---|---|---|
| TR-40 | `packages/teacher/src/stream/sentences.ts` (the splitter) | The 400-character cut applies only when no end mark is found, so a 754-character piece that holds its full stop comes out as one sentence; `/v1/speech` then answers 413 and the browser's voice reads it | Cut any sentence over 400 characters at the last comma or space before 400, whether or not its end mark came in the same piece |
| TR-41 | `packages/server/src/jobs/teach.ts` | The ruling above: 8 model calls give `model_timeout` | `turn_limit` with the teacher's message; `model_timeout` only for the first byte |
| TR-42 | `tools/film.ts`, `prompt/jobs.ts`, teacher design 4 | The ruling above: the prompt offers a glide that does not happen | `show_me` takes `{ name, value }` only; the instructions stop suggesting a timed move; design 4 marks `to`/`seconds` as later (TR-34) |
| TR-43 | docs | The rulings above | Teacher design 4 and 8, server `errors.md`, teacher `errors.md` T003 (server stream kind) |
| TR-44 | tests | Tests that rest on the rulings (the line-break test, the either-kind turn-limit test, the timed `show_me` tests) | Change only those, and list each |

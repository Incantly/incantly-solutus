# Teacher and server: live run (round 5)

2026-11-22, on the developer's machine. The server ran with the real OpenRouter key (`npm run server`, `127.0.0.1:8787`), the studio on `127.0.0.1:5173` proxying `/v1`. Free models only, from `.env.example`. About 20 model calls and one speech call. Times are from the request to the event, on this network.

## `/v1/health`

`ready: true`, `voice: true`, provider `openrouter`, the text, vision and speech lists. No key in the answer.

## Prompt to figure (`POST /v1/figure/draw`, graphing)

| Request | Lines that passed | First line | Done | Notes |
|---|---|---|---|---|
| "show the area under x^2 from 0 to 2" | `f(x) = x^2`, `R = AreaUnder(f, 0, 2)` | 10.0 s | 10.1 s | Right |
| "a circle of radius 2, a point on it and its tangent" | `O = (0, 0)`, `c = Circle(O, 2)`, `P = PointOn(c)` | 8.7 s | 16.4 s | The tangent was named `t`, then `t_1`, and left out (`retry_spent`); TR-47 |
| "a pendulum swinging" | `O`, `L` slider, `th` slider, `B`, `rod` | 23.0 s | 36.0 s | A pendulum you can move with sliders; it does not swing by itself |

The first line is slow because the plan call is a whole reply before the lines start (TR-46).

## Board (`POST /v1/board/ask`)

| Request | Result | Time |
|---|---|---|
| Circle, `graph`, an ink curve and a text `y = x^2 - 3x` | `model_bad_output` | 1.9 s |
| Circle, `graph`, the text alone (run 1) | A figure card (`f(x) = x^2 - 3x`, the vertex), an arrow from the circle, a hand caption, and a `say` | about 6 s |
| Circle, `graph`, the text alone (run 2) | The same, but the arrow and the caption were sent twice (TR-49) | about 10 s |
| Talk, "Write the formula for the area of a circle under the circle I drew" | `write` of `$A = \pi r^2$` below the circle, then `say` | 2.5 s, done 4.4 s |

## Voice (`POST /v1/teach`, `POST /v1/speech`)

| Request | Result | Time |
|---|---|---|
| Teach, geometry, "Take a circle of radius 2, and a point on it." | `say` "I'll take a circle of radius 2." with `c = Circle((0, 0), 2)`; `say` "Now a point on the circle." with `P = PointOn(c)`; a closing `say` | first line 1.5 s, done 4.9 s |
| Speech, "Take a circle of radius two, and a point on it." | 200, `audio/mpeg`, 61,857 bytes (MP3, 44.1 kHz, mono) from Fish | first byte 0.71 s, total 2.29 s |

## In the studio (screenshots)

Typed into the Talk panel (headless Chrome has no microphone, so the panel's first line is TR-50):

| Screen | What the teacher did |
|---|---|
| `screens/live-voice-geometry.png` | A circle of radius 2, a point on it and the tangent at the point, sentence by sentence |
| `screens/live-voice-graphing.png` | `f(x) = x²` and the shaded `AreaUnder(f, 0, 2) = 2.67` |
| `screens/live-voice-board.png` | A live graph card of `y = x² - 3x` with its vertex `V`, and "lowest point (1.5, −2.25)" written under it |

## Not run

- A circle with a picture (TR-51).
- The error test set and its fix rate (TR-52).

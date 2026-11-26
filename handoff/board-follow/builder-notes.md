# Board follow

The runner keeps an agent's new work on screen. The figure SDK does not.

## Built

- `BoardAgent.#follow`: `idle`, a claimed pose, or `released`. `followBegin` / `followEnd(ticket)` bracket an answer. A newer answer wins over an older end.
- A working point outside the view pans, zoom unchanged. After a call, shapes on the current page that are not fully in view are framed. The zoom never increases.
- A successful `camera` action is left alone. `{ x, y }` places are not rewritten.
- `agent.follow: false` turns it off. Default on.
- The service, the board lesson, and the board conversation open and close the follow. A direct `run` opens and closes its own when no answer is open.
- One sentence in the board prompt.

## Left out

- No camera glide. The move is immediate, so a test does not wait on a frame.
- The hand is panned when it leaves the view, not when it merely leaves the middle third. A shape already on screen does not shift the page.
- Peripheral clusters of off-screen content are not sent to the model.

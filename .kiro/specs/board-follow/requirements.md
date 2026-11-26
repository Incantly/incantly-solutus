# Board follow

The board keeps what an agent adds on screen. The figure inside a card is not involved: board zoom never changes that card's maths window.

## R1. The runner follows

- The board's agent runner moves the camera. The model is not required to send a `camera` action. The server does not frame.
- Following is on unless the board is created with `agent.follow: false`.
- A whole answer is one follow: the talking agent, a circle, and a lesson turn. A single `board` call with no answer open is its own follow.
- A newer answer cannot be ended by the older one's finish.

## R2. While it draws

- When the working point leaves the view, the camera pans so that point sits in the middle. The zoom stays.
- A point that is already in view does not move the camera.

## R3. After a call

- If the shapes that call made or changed are not fully in view, the camera frames their box.
- The zoom never increases. It decreases only so the box fits, with about 48 pixels of padding, and it stays between 0.05 and 20.
- Shapes already fully in view leave the camera where it is.
- Absolute places `{ x, y }` stay the coordinates the action asked for. Following moves the camera, not the shapes.
- A `camera` action that succeeded is left as it is. The automatic frame does not run over it.

## R4. The user takes the camera

- If the user pans or zooms during the answer, following stops until that answer ends. The next answer follows again.
- The runner's own pan, frame, `camera` action, and page change count as its moves, not the user's.

## R5. The model is told

- The board prompt says to place with `near` or `free`, and that the board moves the view. A `camera` action is only for a view the model chooses.

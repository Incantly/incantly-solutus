# Board follow

Follow lives in `@incantly/board`, on `BoardAgent` (`core/agent.ts`). `@incantly/sdk` is the figure inside a card and does not move. The server checks actions; only the client knows the window.

## One field

`#follow` is `idle`, `released`, or the pose `{ x, y, zoom }` the runner last set. It is not a state machine: an answer may be released at any moment, and the runner's own machine (B31) already covers the call. A count `#followEpoch` makes an older `followEnd` a no-op once a newer answer has begun.

`followBegin` starts an answer (or one direct `run` when nothing is open). `followEnd(ticket)` ends it only when `ticket` is still current. `AgentService.ask`, the lesson's board target, and the board conversation call these. `follow: false` begins the answer already `released`.

## Moves

`core/agent-follow.ts` is the arithmetic.

- A tip outside `view()` pans with `panPose`: same zoom, tip in the middle. `followTip` does this, from the action's working point and from each frame of the hand.
- After the call, the boxes of the results that are still shapes on the current page are unioned. If that box is not inside the view (one page unit of slack), `framePose` sets the zoom to `clamp(min(currentZoom, fit))`. `fit` is the zoom at which the box fits with 48 screen pixels of padding, or less padding when the screen is small. The camera never zooms in.
- Before either move, if the camera is not the claimed pose, `#follow` becomes `released` and the answer stops following.
- `camera` and `page` call `onCamera`, which claims the pose they left, so those moves are not read as the user. A successful `camera` action skips the automatic frame.

`moveTo` is immediate. Reduced motion is the same jump: there is no camera glide.

## What does not change

- `cameraTo` in `agent-actions.ts` keeps its own zoom (at most 1.5, margin 60). That is the explicit `camera` action.
- `'free'` and `near` placement are unchanged. Following moves the camera after the place is chosen.
- A write with no style still appears at once, in the handwriting font.

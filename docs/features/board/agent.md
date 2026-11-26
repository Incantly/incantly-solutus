# Board: agent

How a model reads and changes the board. Two ways in (design 11): **circle to ask** and the **talking agent**. Both use the same board actions; every action is one transaction with origin `model`, so the user can undo it.

## 1. Tools

The live teacher (core design 10) keeps `draw`, `figure`, `pause`, `resume`, `seek_beat` and `show_me`, and gains the two tools below. The jobs behind circle to ask and the talking agent get only these two: a board has no figure of its own, so a `figure` action carries the card's lines and the server checks them like `draw` lines.

| Tool | Input | Result |
|---|---|---|
| `board_read` | `{ area?: Box, page?: string }` | Items in the area (default: the visible part of the current page), in reading order: `{ id, kind, box, text?, summary?, shape?, madeBy? }`. `summary` is a figure card's `figureSummary`; `shape` is the recognised shape of an ink group; `madeBy` is `"model"` on what the agent made (the server's check of `edit`, `move` and `delete` reads it) |
| `board` | `{ actions: BoardAction[] }` (1 to 20) | Per action: `{ ok: true, id }` or an error from `errors.md`. On the server the results carry no `id`: they are `{ ok: true }` or an error, since ids are made by the client, which also resolves `$last` |

## 2. Actions

```ts
type BoardAction =
  | { op: 'write'; text: string; at: Place; style?: 'hand' | 'typed'; size?: number; color?: string }   // handwriting unless style is typed; $…$ is maths
  | { op: 'shape'; kind: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'line' | 'sticky' | 'frame'; at: Place; w?: number; h?: number; label?: string; color?: string }
  | { op: 'arrow'; from: Target; to: Target; label?: string }
  | { op: 'stroke'; points: readonly [number, number][]; at: Place; color?: string; size?: number }      // drawn as if by hand
  | { op: 'figure'; lines: readonly string[]; mode?: AppModeId; at: Place; w?: number; h?: number }     // lines go through `draw`
  | { op: 'mark'; target: Target; how: 'circle' | 'underline' | 'highlight' | 'box' }
  | { op: 'point'; target: Target }                                                                     // laser, not stored
  | { op: 'move'; id: string; at: Place } | { op: 'edit'; id: string; text: string } | { op: 'delete'; id: string }
  | { op: 'camera'; target: Target | 'all' } | { op: 'page'; to: string | 'new' | 'next' | 'previous'; name?: string };

type Box = [x: number, y: number, w: number, h: number];            // page units
type Target = string | Box;                                         // a shape id, `$last`, or an area
type Place = { x: number; y: number } | { near: Target; side: 'right' | 'left' | 'above' | 'below' } | 'free';
```

- `Place` with `near` is the normal way: the board finds a free spot on that side and never covers other shapes. `'free'` picks the nearest empty spot in view: it looks at every empty strip between the shapes' boxes, the one nearest the middle of the view first, and only when no strip holds the thing (with a margin of 40 units from the edge of the view) does it go below all content.
- A `write` with no style uses the handwriting font and appears at once. `style: 'hand'` is the same font, drawn on the live layer (about 400 characters a second). `style: 'typed'` uses the plain font and appears at once. A `stroke` is stored as ink; a hand-style `write` is stored as a text shape in the hand font, since there is no stroke font (BR-59). With reduced motion they appear at once. A label the agent puts on a shape uses the handwriting font too.
- The board keeps new work on screen. A working point that leaves the view pans the camera and the zoom stays. After a call, shapes that are not fully in view are framed: the zoom never increases, and it decreases only so the group fits, with about 48 pixels of padding. `{ x, y }` stays the place the action asked for. A `camera` action that succeeded is left as it is. If the user pans or zooms during the answer, the camera stays where they put it until the answer ends. `follow: false` on the board's agent option turns this off.
- `figure` makes a figure card and runs its lines through the teacher's `draw`, so line errors come back in the kernel's format.
- An action that fails changes nothing and does not stop the actions after it, as with `draw` lines: each action is checked on its own, so an action with a wrong field gets its own error and the rest run. A refusal (`agent_refused`) is a shape that is gone or on another page, a locked shape, a shape the model did not make (below), a limit, or more than 20 actions in the call. Both layers say so for a call of 21 or more: the teacher's `board` tool answers `tool_input` (T001) before anything reaches the board, and the board's own runner answers `agent_refused` for a call that reaches it.
- `Place` `{ x, y }` is where the thing's box begins. `mark` has no `Place`: it goes round, under or over its target (`circle` is an ellipse, `underline` a line, `highlight` a translucent rectangle, `box` a rectangle, in red or yellow). `point` is the laser over the target's box for a moment and stores nothing. `arrow` with a `label` also writes the label above the arrow's middle. `edit` of a figure card takes its lines as `text` (one a line) and runs them again; `edit` of other shapes sets their text (a label, a sticky note's text, a frame's name).
- Everything the model makes carries `meta.madeBy: 'model'`. `edit`, `move` and `delete` of a shape without that mark are refused (`agent_refused`, `detail.reason: 'not_model'`) unless the request allows it: the panel's "Let the agent change my work" box, or a circle's `slider` and `animate` choices.
- `$last` is the shape the previous action made. An arrow does not count, so a label can follow it; it carries over from one `board` call to the next of the same answer and goes when a `page` action changes the page or a new request begins.
- A hand-style `write` is stored as a text shape in the hand font, not as ink (no stroke font; BR-59): its characters appear as if written, and a stopped one is stored as far as it got. A `stroke` is stored as ink. An `arrow` between shapes sticks to both and its ends stop 8 units short of their outlines, so the head shows beside a card, not under it.

## 3. Circle to ask

The board sends the server one request:

```json
{
  "kind": "circle",
  "choice": "graph",
  "items": [{ "id": "shape:a1", "kind": "ink", "shape": "curve", "box": [120, 40, 300, 180] }],
  "picture": "data:image/png;base64,…",
  "page": "page:1"
}
```

`choice` is the suggestion the user picked (`graph`, `formula`, `solve`, `steps`, `measure`, `geometry`, `explain`, `animate`, `slider`, or `ask` with a `text`). `box` is `[x, y, w, h]`. The request also holds `more` (items the circle holds beyond the 60 listed) and `circle` (the loop's area, `[x, y, w, h]`, so the answer can be placed `near` it). `picture` is sent only when the board's `agent.vision` option is on, which is for a model that reads pictures (design 16); it is off by default. The answer is a stream of `board` actions, normally one `figure` placed `near` the circle and one `arrow` from the circle to it.

What the user says to the talking agent is `{ "kind": "talk", "text": "…", "items": […], "more": 0, "page": "page:1", "allowEdit": false }`: the board in view comes with it, as `board_read` gives it. `allowEdit` is always there: `false` unless the user ticked "Let the agent change my work", then `true` (BR-56).

The answer is NDJSON, one event a line: `{ "say": "…" }` (a piece of the agent's words), `{ "actions": [...] }` (one `board` call, applied at once), then `{ "done": true }`, or `{ "error": { "kind", "message" } }`. A whole answer is one gesture, so one undo takes it all back. `say` pieces are text, not changes: the panel joins the pieces of one answer and shows them in the conversation as the agent's reply, after the lines that say what the actions did. A talk whose answer holds words and no action ends with `done`; a circle's words come in one `say` piece before `done`, only when it drew something. Stop ends the job at once and what was drawn stays; a newer request aborts the older one.

**On the server** (server design 5): the board is not there, so the request's `items` stand for it. The server checks each action before it streams: the action's fields (`readAction`), a shape id that is not among the items (when `more` is 0), `edit`, `move` and `delete` of an item without `madeBy: "model"` when the request does not allow it (a talk's `allowEdit`, a circle's `slider` and `animate`), and a `figure`'s lines on a headless app of its mode. Only actions that passed are streamed, and a `figure` carries only its lines that ran. The board checks again as it applies them. The server sends the model's words as `say` events. An answer with no action that passed and no words (and a circle that drew nothing) ends with `model_bad_output`.

## 4. Rules for the model

1. Read before writing: call `board_read` when the request names something on the board.
2. Place new things `near` what they explain. The board moves the view onto what you add; do not move the user's work unless asked.
3. Maths that changes or can be dragged is a `figure`; a fixed formula is `write` with `$…$`.
4. Say only what the results report, as for `draw` (core design 10, rule 4).
5. At most 20 actions per call and 3 live figure cards in view; more cards are fine, but only 3 run at once.
6. Never delete or edit a shape the model did not make unless the user asked.

## 5. Lesson snippet

> "Here is the parabola you drew, as a graph."

```json
{ "actions": [
  { "op": "figure", "lines": ["f(x) = (x - 1)^2 - 2"], "mode": "graphing", "at": { "near": "shape:a1", "side": "right" } },
  { "op": "arrow", "from": "shape:a1", "to": "$last" },
  { "op": "write", "text": "$f(x) = (x-1)^2 - 2$", "at": { "near": "$last", "side": "below" }, "style": "hand" }
] }
```

`$last` names the shape the previous action made.

## 6. Token budget

The board tools and the action list cost about 450 tokens in the prompt. The whole prompt of a `circle` or `talk` job is about 3,300 tokens (the instructions, the mode's catalogue, the board tools and one example), under the cap of 4,000; the items come on top. `board_read` gives at most 60 items (about 1,200 tokens); a larger area is cut and says how many items it left out.

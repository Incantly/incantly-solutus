# Board: agent

How a model reads and changes the board. Two ways in (design 11): **circle to ask** and the **talking agent**. Both use the same board actions; every action is one transaction with origin `model`, so the user can undo it.

## 1. Tools

The live teacher (core design 10) keeps `draw`, `figure`, `pause`, `resume`, `seek_beat` and `show_me`, and gains:

| Tool | Input | Result |
|---|---|---|
| `board_read` | `{ area?: Box, page?: string }` | Items in the area (default: the visible part of the current page), in reading order: `{ id, kind, box, text?, summary?, shape? }`. `summary` is a figure card's `figureSummary`; `shape` is the recognised shape of an ink group |
| `board` | `{ actions: BoardAction[] }` (1 to 20) | Per action: `{ ok: true, id }` or an error from `errors.md` |

## 2. Actions

```ts
type BoardAction =
  | { op: 'write'; text: string; at: Place; style?: 'hand' | 'typed'; size?: number; color?: string }   // $…$ is maths
  | { op: 'shape'; kind: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'line' | 'sticky' | 'frame'; at: Place; w?: number; h?: number; label?: string; color?: string }
  | { op: 'arrow'; from: Target; to: Target; label?: string }
  | { op: 'stroke'; points: readonly [number, number][]; at: Place; color?: string; size?: number }      // drawn as if by hand
  | { op: 'figure'; lines: readonly string[]; mode?: AppModeId; at: Place; w?: number; h?: number }     // lines go through `draw`
  | { op: 'mark'; target: Target; how: 'circle' | 'underline' | 'highlight' | 'box' }
  | { op: 'point'; target: Target }                                                                     // laser, not stored
  | { op: 'move'; id: string; at: Place } | { op: 'edit'; id: string; text: string } | { op: 'delete'; id: string }
  | { op: 'camera'; target: Target | 'all' } | { op: 'page'; to: string | 'new' | 'next' | 'previous'; name?: string };

type Target = string | Box;                                         // a shape id, or an area
type Place = { x: number; y: number } | { near: Target; side: 'right' | 'left' | 'above' | 'below' } | 'free';
```

- `Place` with `near` is the normal way: the board finds a free spot on that side and never covers other shapes. `'free'` picks the nearest empty spot in view.
- `stroke` and `write` with `style: 'hand'` animate on the live layer (about 400 characters a second) and are stored as normal ink. With reduced motion they appear at once.
- `figure` makes a figure card and runs its lines through the teacher's `draw`, so line errors come back in the kernel's format.
- An action that fails changes nothing and does not stop the actions after it, as with `draw` lines.

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

`choice` is the suggestion the user picked (`graph`, `formula`, `solve`, `steps`, `measure`, `explain`, `animate`, `slider`, or `ask` with a `text`). `picture` is sent only when the model reads pictures (design 16). The answer is a stream of `board` actions, normally one `figure` placed `near` the circle and one `arrow` from the circle to it.

## 4. Rules for the model

1. Read before writing: call `board_read` when the request names something on the board.
2. Place new things `near` what they explain; do not move the user's work unless asked.
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

The board tools and the action list cost about 450 tokens in the prompt. `board_read` gives at most 60 items (about 1,200 tokens); a larger area is cut and says how many items it left out.

# Board: UI

What a user sees and does. Every part below can be changed or removed by the host (`design.md` 10); this file describes the defaults.

## Layout

| Part | Where | Default |
|---|---|---|
| Toolbar | Bottom centre | Select, Hand, Pen, Highlighter, Eraser, Laser, Lasso · Rect (with a More shapes menu: Triangle, Diamond, Star), Ellipse, Arrow, Line, Text, Sticky, Frame, Image · Figure, Ask |
| Style bar | Right, when a tool or a selection has styles | Colour, size, nib, fill, dash, opacity, font |
| Page bar | Top left | Current page name, a list of pages, add page |
| Zoom bar | Bottom right | −, the zoom as a number (click for 100%), +, zoom to fit, zoom to selection |
| Main menu | Top left button | New, Open, Save, Export (PNG, SVG, PDF of a page or all pages), Undo, Redo, Settings |
| Context menu | Right-click or long press | Depends on the target |
| Agent panel | Right, when an agent is set | The conversation with the talking agent |

The canvas fills the rest. The toolbar is one row that never wraps: it fits a laptop, and on a phone it scrolls sideways and the style bar opens from it. The More shapes menu is the small arrow after the Rect button; it opens above the toolbar, closes when a shape is chosen, on Esc or on a press elsewhere, and its arrow shows as pressed while one of its shapes is the tool.

## Pen

- The pen draws with no wait. Pressure changes the width as you press.
- The pen's eraser end erases while it is used, then the last tool comes back.
- The barrel button, held, gives the Ask tool for that stroke.
- Hovering shows a small dot of the nib's size and colour.
- While a pen is near, a palm or finger on the screen does not draw.

## Keys (defaults)

| Action | Key |
|---|---|
| Select, Hand | `v`, `h` (hold Space for the hand) |
| Pen, Highlighter, Eraser, Laser, Lasso | `p`, `shift+p`, `e`, `k`, `l` |
| Rect, Ellipse, Arrow, Line, Text, Sticky, Frame | `r`, `o`, `a`, `shift+l`, `t`, `n`, `f` |
| Triangle, Diamond, Star (More shapes) | `shift+t`, `d`, `shift+s` |
| Figure, Ask | `g`, `?` |
| Undo, Redo | `mod+z`, `mod+shift+z` and `mod+y` |
| Copy, Cut, Paste, Duplicate | `mod+c`, `mod+x`, `mod+v`, `mod+d` |
| Delete | `Delete`, `Backspace` |
| Group, Ungroup | `mod+g`, `mod+shift+g` |
| Forward, Back, To front, To back | `]`, `[`, `mod+]`, `mod+[` |
| Zoom in, out, 100%, fit, selection | `mod+=`, `mod+-`, `shift+0`, `shift+1`, `shift+2` |
| Next page, previous page | `mod+pagedown`, `mod+pageup` |
| Nudge, big nudge | arrows, `shift`+arrows |
| Leave a figure card, cancel a tool | `Escape` |

## Shapes and editing

- Drag on the canvas with a shape tool to make the shape; click makes the default size.
- Hold Shift while drawing a shape for a square or a circle; Alt draws from the centre.
- A selected shape shows 8 handles to resize, one to rotate, and its own handles (an arrow's bend, a line's points). A line or an arrow alone shows only its own handles; select it with another shape and the box with its 8 handles and the rotate handle shows.
- Esc or a cancelled touch in the middle of a drag, a resize, a turn or an arrow-end drag puts everything back as it was, the bindings an arrow end dropped included, and leaves nothing to undo.
- Bring forward and send back keep the order of the shapes you selected.
- Moving shows snap lines in the accent colour when edges, centres or gaps line up.
- Double-click a shape with text (or press Enter) to type in it.
- Draw a rough circle, line or polygon and keep the pen still for half a second: it turns into a clean shape (a pentagon or a hexagon stays a pentagon or a hexagon, and a circle stays a circle). Undo brings the ink back.

## Figure cards

- The Figure tool asks for a mode (graph, geometry, 3D, …) and places an empty card; or paste a script.
- A card shows its picture until it comes into view, then goes live (at most 3 at once).
- Double-click a card to use it: drag points, move sliders, play. Esc gives the pen back to the board.
- A card's toolbar: edit lines, mode, play, ask the agent, delete.

## Pages

- The page bar lists every page with its thumbnail. Drag to reorder. The menu on a page: rename, duplicate, delete.
- Each page remembers where you were looking.

## Circle to ask

1. Pick Ask (or hold the barrel button) and circle part of the board.
2. Suggestions appear beside the circle at once, such as "Graph it", "Solve it", "Measure it", or "Ask something else".
3. Pick one. A card appears next to the circle and fills in as the agent writes its lines.
4. The card stays on the board, joined to what you circled by an arrow. Undo removes the agent's work.

## The talking agent

- The agent panel shows what you said and what the agent did.
- While the agent draws, a small hand icon moves where it draws, and its strokes appear as if written by hand.
- Anything the agent made can be selected, changed or deleted like your own.
- A "Stop" button stops the agent at once; what it drew so far stays.

## Accessibility

- Every tool and menu item has a label and a spoken name; the toolbar works with Tab and arrows.
- Shapes are listed in a hidden list for screen readers, in reading order, with their text and a figure card's summary.
- High-contrast theme; the focus ring is always shown on keyboard use.
- Motion: with reduced motion, the agent's strokes appear at once and the laser does not fade.

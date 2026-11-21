# Board: the final screenshots

Taken in Chrome 158 (headless, 1280 × 800 at 1:1, WebGL 2) in the studio's Board mode (`?mode=notes`) on a free port of 127.0.0.1, at the end of round 6. The files named `round2-` to `round5-` are the earlier rounds' shots and are kept; these `final-` files are one for each feature. The scripts are Playwright scripts run from outside the repository (Playwright is a dev tool, not a dependency).

| Feature | File | What it shows |
|---|---|---|
| Empty board | `final-empty-board.png` | A new board: toolbar, page bar, zoom bar, nothing on the page. |
| Pen, highlighter, nibs | `final-pen-highlighter.png` | Three pen strokes (pen, marker and pencil nibs chosen in turn; with a mouse they look alike, see BR-71) and a highlighter stroke with its colours. |
| Eraser | `final-eraser.png` | The eraser (whole stroke mode, its ring and its bar) after it took out a stroke; the circle has a small gap where the ring cut it. |
| Laser | `final-laser.png` | The laser's red trail fading behind its head. Nothing is stored. |
| Lasso selection | `final-lasso-selection.png` | Strokes inside a lasso loop selected, with the selection bar. |
| Pages and the page bar | `final-pages-page-bar.png` | Two pages, the page list open on page 2 with its own stroke. |
| Zoom | `final-zoom.png` | The board zoomed, the zoom bar showing the percentage. |
| Backgrounds | `final-background-grid.png`, `final-background-dots.png`, `final-background-lines.png` | The grid, dots and ruled paper. The ruled-paper shot (`final-background-lines.png`) was taken before one tile was drawn: the column of the page from x 512 to 1024 (screen) has no ruled lines and the strokes are cut off at its left edge, and the laser's fading trail is still on the overlay. Retake it after the last tile is drawn. |
| Every shape kind | `final-shapes-all-kinds.png` | Rectangle, ellipse, triangle, diamond, star, line, arrow, frame, sticky note and text with maths. |
| Select with handles | `final-select-handles.png` | A rectangle selected after a resize, with its handles and the style bar. |
| Rotate | `final-rotate.png` | The same rectangle turned by its rotate handle. |
| Snap guides | `final-snap-guides.png` | The ellipse dragged, the pink guide showing its top lining up with the triangle, diamond and star; the first rectangle is turned. |
| Arrows bound to shapes | `final-arrows-bound.png`, `final-arrow-follows-shape.png` | An arrow stuck to two boxes, then one box moved and the arrow following. |
| Text with maths | `final-text-maths.png` | `Area = x² and ½bh` typeset, not cut off. |
| Sticky, frame | `final-shapes-all-kinds.png` | The sticky note and the frame are in the shapes shot. |
| Image | `final-image.png` | An image added through the Image button's file picker. |
| Shape fixing | `final-fix-before.png`, `final-fix-after.png` | A rough pentagon, held still for half a second, and the regular pentagon it becomes. |
| Clipboard paste | `final-clipboard-paste.png` | Pasted text made into a text shape with maths. |
| A live graph card | `final-live-card.png` | A figure card with a live graph, a point to drag. |
| Three live cards with pictures | `final-three-live-cards-with-pictures.png` | Five cards on the page, one selected with its toolbar. Nothing in the picture tells the live cards from the pictures (the page was made with three live and two pictures). |
| A card taking input | `final-card-takes-input.png` | A card that has the input (a double click): the selected card has the thick blue border. The point A is still at its starting place; no drag is shown. |
| The More shapes menu | `final-more-shapes-menu.png` | The toolbar in one row with the More shapes menu open. |
| The style bar | `final-style-bar.png` | Colours, fill, dash, size and font for the shape tool. |
| The customised board | `final-customised-board.png` | `?mode=notes&board=custom`: the toolbar on the left with names, the pen called "Stylo", the bin icon, teal accent. |
| Circle to ask: suggestions | `final-circle-to-ask-suggestions.png` | A curve circled with the Ask tool and the menu of what to do with it. |
| The answer card with its arrow | `final-answer-card-with-arrow.png` | The agent's figure card, an arrow from the curve to it, and "Here it is as a graph." in hand style; the agent panel lists the three actions. |
| The agent panel writing in hand style | `final-agent-panel-hand-writing.png` | Text being written in the hand font, the hand icon at the pen's tip, the Stop button showing. |
| Stop | `final-stop.png` | The agent stopped part way through drawing a wave: the panel says "Stopped. What the agent drew so far stays." |
| Undo of the agent's work | `final-undo-agent-work.png` | One undo takes back everything the agent did. |
| A stroke over a live card | `final-stroke-over-live-card.png` | A pen stroke drawn across a live card shows over it. |

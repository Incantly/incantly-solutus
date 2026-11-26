# Board chrome

The default board chrome, on top of design 10. A host can still move, hide, or replace every part.

## R1. Pen row

- Clicking Pen, Highlighter, or Eraser opens a small row on that toolbar button: above it when the toolbar is at the bottom or the top, beside it when the toolbar is on the left or the right.
- The pen row shows each nib as its own icon (pen, marker, pencil), then the colours, then the size. The highlighter row shows its colours and size. The eraser row shows whole or partial and its size.
- The held nib's icon and the toolbar button's icon take the chosen colour.
- When the toolbar is hidden, the same controls stay in the style bar.
- Turning the style bar off hides this row too. The zoom bar stays where it is.

## R2. Text inside a shape

- Double-click a rectangle, ellipse, triangle, diamond, or star to type in it (already the rule for any shape that has text).
- The label has a horizontal place (`start`, `center`, `end`) and a vertical place (`start`, `middle`, `end`). A new shape starts centered.
- With the shape selected, the style row shows both places. The choice is stored on the shape.
- Typing in a text shape keeps the first line where it is. The field is not written again when its place has not changed.

## R3. Edge pan

- Dragging a selection into the margin at the edge of the view pans the page, so the shape can move onto the part that was off screen.
- The page does not pan while text is being edited, or while the hand tool is the one moving the view.

## R4. Figure buttons

- The default toolbar has one Figures button. It opens a menu: Figure, Graph, Geometry, Calculator, Probability, and 3D. Each adds a figure card, and the five modes open in that mode.
- A host who lists their own toolbar groups is unchanged. Naming `figure`, `graph`, `geometry`, `scientific`, `probability`, `space`, or `figures` still places that button.

## R5. A card shows its mode

- A Calculator card is the scientific results column: the rows, the DEG/RAD switch, S↔D, and the input. It is not a graph.
- A Probability card is the probability calculator: the distribution picker, its parameters, the shaded plot, and the probability. It is not an empty graph.
- A Geometry card is the graphics view with that mode's axes, grid, and window, and the construction tools. With no `@axes` or `@grid` line, the axes are off and the grid is none.
- A Graph card stays a graph. A 3D card stays the space view. Zooming the board still does not zoom the maths inside a graph.

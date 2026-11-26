# Board chrome

## Pen row

`renderStyle` in `packages/board/src/web/board-view.ts` fills `.ib-penbar` when the tool is pen, highlighter, or eraser and the toolbar is showing. The row is positioned from that tool's button. Nib choices are buttons, not a menu. The toolbar icon's SVG colour is the pen or highlighter colour. Hiding the toolbar, or turning `ui.styleBar` off, leaves the old style bar path (or nothing).

## Labels

`BoxProps` gains `labelAlign` and `labelV`, filled by `check` so an older shape loads centered. `draw` lays the label in the box with those places. `StylePatch` carries the same two fields; only a box kind writes them. The style row's buttons call `styleShapes`.

The text field is placed once per change. A text shape is anchored at its top left, so a new line grows down instead of recentering the field.

## Edge pan

Before a select-tool move sample is given to the tool, a pointer inside 28 screen pixels of the view edge pans the camera by 8 screen pixels. The tool then reads the page point, so the shape stays under the pointer. No new state machine: it is a step of the drag that already exists.

## Figure buttons

The default groups name `figures`, a menu of `figure`, `graph`, `geometry`, `scientific`, `probability`, and `space`. Each calls `addFigure` with `graphing`, `geometry`, `scientific`, `probability`, or `graphing3d`. `figure` still adds a card with no mode chosen. A host who names one of those ids gets that button on the bar.

## Mode faces

`createApp` mounts the view that mode opens on. Scientific mounts the results column and hides the graph. Probability mounts the probability calculator and hides the graph. Geometry keeps the graph, with the mode's axes, grid, and window as the fallback when the script has no `@axes`, `@grid`, or `@view`, and mounts the construction tool strip on it. Graphing and 3D are unchanged. A calculator or probability card stays live while the board zooms, so a graph picture does not cover it.

## Board zoom and the graph

A live card's canvas is sized from its layout box, not from the CSS-scaled box. When the board zoom changes the host scale, the graph's pixels per unit change by the same factor, so the maths window stays. The graph's own scroll zoom is unchanged. Resizing the card still shows more of the graph.

## Out of scope

Dragging a point on a graph without opening the card. New benchmark rows. The zoom bar's position.

# 2D tools: design

## Code

- `packages/ui/src/tools/types.ts`: `ToolSpec`, slots, picks, refusals (design 4, errors 2).
- `packages/ui/src/tools/catalog.ts`: the tool table. `emit` turns resolved picks into lines with typed name
  placeholders (`{point}`, `{line}`, `{circle}`, `{number}`, `{angle}`, …).
- `packages/ui/src/tools/names.ts`: the name allocator of design 5.7.
- `packages/ui/src/tools/engine.ts`: `ToolSession`, a pure state machine. It needs a `ToolHost` for what only the
  figure knows: the types of objects, the parameter of a point on a path, and the intersection index nearest a click.
  The engine has no DOM and no kernel import.
- `apps/studio/src/graph/hit.ts`: hit testing in maths space, ranked by pixel distance, filtered by type.
- `apps/studio/src/tools-ui.ts`: the tool strip, hint line, inline number field, overlay of pending points and ghost,
  and the `ToolHost` built on a scratch copy of the figure.

## Placeholders

`emit` writes `{kind}` for a new name; the engine replaces each in order with the next free name of that kind. Pending
points are `{point}` lines the engine writes before the tool's own lines.

## Previews

A preview resolves the missing point slot from the pointer as a free point, runs the lines on a scratch copy of the
figure and draws the result objects as ghosts. The scratch copy is rebuilt once per pick, not per pointer move.

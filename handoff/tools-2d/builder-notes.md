# 2D tools: builder notes

Built on `feat/tools-2d` from `.kiro/specs/tools-2d`.

## What is in

- `packages/ui/src/tools/`: types, the catalogue of 57 tools in 11 groups, the name allocator and the engine
  (`ToolSession`): picks by the rules of design 5.3, narrowing of variants, preselection, Esc, Backspace and Enter,
  typed numbers checked by the language, refusals of errors.md 2, previews by simulated clicks. No DOM, no kernel.
- `apps/studio/src/tools-host.ts`: the engine's host on a scratch copy of the figure (types, `PointOn` parameters by
  the kernel's drag plan, intersection indices, typed numbers, free names).
- `apps/studio/src/tools-ui.ts`: the tool strip with drawers, the hint line, pending points with pick numbers, the
  ghost of the result, the inline number field, one atomic batch per tool with the rows highlighted.
- `apps/studio/src/graph/hit.ts`: hit testing for every drawn type.
- The painter draws conics, arcs, sectors and polylines; the Move tool drags points on paths and other points whose
  rule can be inverted.

## Tests

`apps/studio/test/tools.test.ts`: every tool variant through the real kernel, the ambiguity check over all variants,
the engine (picking, narrowing, refusals, numbers, preselection, previews, edits, names), the strip in the page, and the
hit-list speed (under 0.3 ms at 1,000 objects).

## Second round (15 November 2026)

- Keyboard (ui.md 2): with a tool on, arrows move a virtual cursor by a grid step (Shift ×5, Alt ÷5), Enter or Space
  clicks there, Tab cycles the hit list ("2 of 3: …"); the position is spoken at most twice a second. Ctrl+1…9 pick
  the first nine groups' current tools. `ToolStrip.keyDown`.
- Moving while building (design 7.2): press on a pending free point and drag; it snaps to the grid
  (`ToolSession.movePending`). A finger with a tool on shows a loupe; the release is the click.
- Alt (ui.md 2): Angle takes the reflex angle (arms reversed); Angle with size and Rotate turn clockwise; a typed
  literal becomes a slider used by name (`r = 3 in 0..6 step 0.1`).
- `degenerate` (errors.md 2): the engine asks the host for undefined results (collinear, coincident, parallel,
  zero length) and refuses the last pick unless Alt was held.
- Tests: `apps/studio/test/tools-keys.test.ts`. Example: **Tools** in the Examples menu.

## Not done

- Readouts, `@tools`, `Suggest` and learner events (decided against the design for this area).
- The deferred tools in `DEFERRED`.

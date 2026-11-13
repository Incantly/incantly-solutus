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

## Not done

- Keyboard virtual cursor (ui.md 2, Keyboard) and Tab cycling of the hit list; Ctrl+1…9 for groups.
- Touch loupe and dragging a pending point before the next click (design 7.2).
- Alt variants: reflex angle, clockwise rotation, "use slider", committing a degenerate pick.
- The selection in the studio: preselection works in the engine but the studio has no selection to pass yet.
- Readouts, `@tools`, `Suggest` and learner events (decided against the design for this area).
- The deferred tools in `DEFERRED`.

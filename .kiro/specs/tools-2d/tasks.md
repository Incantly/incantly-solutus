# 2D tools: tasks

Pipeline: `docs/process/pipeline.md`. Branch: `feat/tools-2d`.

- [x] 1. Tools as data: `ToolSpec`, the catalogue of 57 tools in 11 groups, deferred tools listed (R1)
- [x] 2. One engine, `ToolSession`: picks, narrowing, preselection, Esc, Backspace, Enter, refusals, typed numbers (R2)
- [x] 3. Previews by simulated clicks; one atomic batch per tool (R3)
- [x] 4. The studio: tool strip, drawers, hint line, pending points, ghost, number field, hit testing (R4)
- [x] 5. Tests: every variant through the kernel, the ambiguity check, the engine, the strip, hit-list speed
- [x] 6. Merge into `integration` (PR #47)
- [x] 7. The studio selection passed to the engine as preselection
- [ ] 8. Keyboard virtual cursor, Tab cycling of the hit list, Ctrl+1…9 for groups (ui.md 2)
- [ ] 9. Touch loupe and dragging a pending point before the next click (design 7.2)
- [ ] 10. Alt variants: reflex angle, clockwise rotation, "use slider", committing a degenerate pick

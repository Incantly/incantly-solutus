# Board: tasks

- [x] 1. Round 1: store, transactions, history, pages, camera, spatial grid, file save and load (R1, R2, R3, R9)
- [x] 2. Round 2: ink: web input, samples, simulated pressure, outline, live layer, painter with tiles and culling, pen tools (R4, R1.2)
- [x] 3. Round 3: shapes, kinds, editing, handles, snap, bindings, clipboard, shape fixing (R5)
- [x] 4. Round 4: figure cards under the scheduler; the customisable UI shell: toolbar, style bar, page bar, menus, keys, icons, theme, strings (R6, R7)
- [x] 5. Round 5: agent actions, `board_read`, circle to ask, the transport and the agent panel (R8)
- [x] 6. Round 6: errors pass, benches against design 13, Chrome check with the CPU 4× slower, studio page, screenshots (R10, R11)
- [ ] 7. React Native: spike only (stylus data and a Skia painter), when the product owner asks
- [x] 8. Fix round, drag and garbage (BR-77, BR-82, BR-83; design 9 item 7, 13 "How" item 9; B36): shapes a person's gesture moves are lifted out of the tiles and drawn on the overlay until they settle; the GPU target clears with its masks set (lint rule `gl-clear-masks`); the pen's path makes no garbage per sample or frame (own tail guess instead of `getPredictedEvents()`, lists kept by index with lint rule `no-length-reset`, no boxed number arguments in hot calls, live arrays sized for a long stroke, a warm-up stroke after the board opens). Tests: `drag-lift.test.ts`, the input tests of the tail guess, `clear-masks.test.ts` (view), the two rules' cases; Chrome: `chrome-drag.mjs`, `chrome-board.mjs`.
- [ ] 9. Fix later: `no-length-reset` in the other areas (BR-84); the stored stroke's outline taken from the live one at commit (BR-77).

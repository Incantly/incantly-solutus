# Examples per app mode: requirements

Area: `apps/studio` (examples and the Examples menu), on top of `.kiro/specs/app-modes`. Branch: `feat/mode-examples`.

### R1. Each example belongs to modes

1. THE SYSTEM SHALL tag every example with the app modes it is made for.
2. The Examples menu SHALL list only the examples of the mode in force, and change when the mode changes.
3. In `classic`, its own examples come first; the examples of the other modes follow in groups, because classic can run everything.
4. Every example SHALL load with no failed line in each mode it is tagged with.

### R2. More examples

1. Geometry SHALL have at least three new animated examples that use the clock, such as Euler's formula on the unit circle, a rolling wheel (cycloid) and Thales' circle.
2. Graphing SHALL have at least three new particle examples (particles are allowed there), beside its function and animation examples.
3. Scientific SHALL have examples of calculation rows (`r1`, `r2`, …).
4. CAS SHALL have at least two new examples.
5. Probability SHALL show its graph, as ui.md 2 says ("the graph with shaded interval"), so its examples can be seen.

### R3. Tests and screenshots

1. A test SHALL load every example in every mode it is tagged with and find no error.
2. Screenshots SHALL show the menu per mode and the new animations.

### R4. Particles in geometry (product owner, 2026-11-16)

1. Geometry mode SHALL allow `Particles`. `state()` motion stays off there.
2. Geometry SHALL have at least two particle examples built on its shapes.

### R5. Motion with state() in geometry (product owner, 2026-11-16)

1. Geometry mode SHALL allow `state()` lines and their rates. Scientific and probability still refuse them.
2. Geometry SHALL have at least two examples driven by `state()`.

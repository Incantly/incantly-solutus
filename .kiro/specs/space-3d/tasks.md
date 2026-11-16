# Space (3D): tasks

Branch per round: `feat/space-3d-<n>`, one PR into `integration` each, merged after CI passes.

- [x] 1. Round 1: points, vectors, lines and planes in the kernel; the core hooks; `mixed_dimension` (R1)
- [x] 2. Round 2: solids, spheres, cylinders, cones, measures and their intersections (R2)
- [x] 3. Round 3: the `space` camera object, the software painter, the Space pane, export (R3)
- [x] 4. Round 4: orbit, pan, zoom, drag, picking, the style bar, the 3D app and its examples (R4)
- [x] 5. Round 5: benches; the WebGL2 back-end if the painter misses its frame budget; screenshots (R5)
  - Measured: 200 lines 7.3 ms, one line 0.05 ms, a section 0.12 ms, a frame of 500 objects 4.8 ms (Node) and 4.4 ms
    (Chrome, with the canvas), a pick 0.03 ms. The painter meets its budget, so the WebGL2 back-end moves to phase 2
    with transparency and the hide-depth pass (design.md, The screen).

# Physics: tasks

Each round is one branch `feat/physics-<n>` and one PR into `integration`, merged after CI passes, with tests, studio examples and screenshots.

- [x] 1. Round 1: 2D bodies (R1, R2, R8)
  - [x] 1.1 Exact maths module and its tests
  - [x] 1.2 Core hooks: post-pass drivers, driven rule objects, input lines, free writes
  - [x] 1.3 2D world: shapes, convex split, broad phase, narrow phase, solver, friction, bounce, speculative contacts, bullets, sleep
  - [x] 1.4 `Body`, `Bodies`, `Box`, `Ground`, `with solid = true`, movers, curves as ground
  - [x] 1.5 The `world` object and its properties and readouts
  - [x] 1.6 The driver: steps, checkpoints with cap, seek, catch-up, `rerun`, falling behind
  - [x] 1.7 Errors, reasons, notices, the `physics` group in modes
  - [x] 1.8 Spec tests
- [x] 2. Round 2: joints, forces, events (R3)
  - [x] 2.1 `Hinge`, `Spring`, `Rope`, `Rod`, `Weld`, `Slider`, `Pulley`, `Grab`
  - [x] 2.2 Force accounting by kind, `force(kind)`, `Forces`, energy and momentum measures
  - [x] 2.3 `Push`, `Wake`, `Sleep`, `Restart`; logged and saved as `@input`
  - [x] 2.4 `on b hit` handlers
  - [x] 2.5 Spec tests, including accuracy checks of design 11.5
- [x] 3. Round 3: studio and embed in 2D (R4)
  - [x] 3.1 Drawing bodies, solids, joints, arrows, contacts
  - [x] 3.2 Player bar, catching up and slow marks; the host measures physics time per frame and slows the film when it goes over 6 ms (the kernel holds the clock while the world catches up)
  - [x] 3.3 Drag: start move at t = 0, grab while playing; arrow-key pushes
  - [x] 3.4 Algebra rows, Physics tools, performance row
  - [x] 3.5 2D car (`Wheel`, `Vehicle` in the plane)
  - [x] 3.6 Examples and screenshots
- [ ] 4. Round 4: 3D bodies (R5)
- [ ] 5. Round 5: 3D vehicles and crashes (R6)
- [ ] 6. Round 6: water and 2D liquid, worker (R7)
- [ ] 7. Round 7: 3D liquid and waves (R7)
- [ ] 8. Round 8: smoke (R7)
- [ ] 9. Round 9: speed (R9)
  - [ ] 9.1 Node benches for every budget of design 11.2
  - [ ] 9.2 Throttled Chrome bench script
  - [ ] 9.3 Checks of design 11.4
  - [ ] 9.4 Cross-browser hash test
  - [ ] 9.5 Exact maths in compiled user formulas

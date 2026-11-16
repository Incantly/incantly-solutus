# Examples per app mode: design

- `Example` gains `modes: readonly AppModeId[]`. `examplesFor(mode)` returns the mode's examples; for `classic` it returns its own first, then the others grouped by mode.
- The studio rebuilds the Examples `<select>` on every mode change (`AppModes.onChange`), with `<optgroup>` per mode in classic. The menu shows in every mode but `figure`.
- Geometry animations use the clock `t` and `Trace`, never `state()` or particles, which geometry leaves out.
- Particles are allowed in graphing, classic and (R4) geometry.
- Scientific examples are rows `r1 = …`, which the results column shows; trig there uses `pi`, since a loaded line is not rewritten to degrees.
- Probability gets `graphics` in its views (initial: distribution, graphics), following ui.md 2.

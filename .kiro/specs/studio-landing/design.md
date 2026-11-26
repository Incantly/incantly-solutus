# Studio landing

The page is drawn by `apps/studio/src/landing.ts` into `#app`. `main.ts` shows it only when the address has no `mode`, no `start`, and no `#f=` figure. Start and a section's Open replace `#app` and call `mountStudio`.

There is no state machine. The page is either the landing or the studio, and Start only goes one way.

Each example is that app itself, mounted in the section and running an example the studio already has. The page does not draw a second graph, calculator, or board. The page is English, the same language as the source catalogue. The studio's own language switch is inside, after Start.

The embed and the notes page do not use this entry.

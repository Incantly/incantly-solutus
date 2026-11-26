# Studio landing

The first visit to the studio is a page that explains each part. Start opens the studio.

## Built

- `apps/studio/src/landing.ts` draws the page: the spoken lesson, Graphing, Geometry, Scientific, Probability, Board, 3D, CAS, and Classic. Each section runs that app on one of the studio's examples. The page does not draw a stand-in graph, calculator, or board.
- Start opens Classic. A section's Open opens that app.
- `?mode=`, `?start`, and a shared `#f=` link skip the page and open the studio, as before.

## Left out

- The page is English. The language switch stays inside the studio, after Start.
- The embed and the notes page are unchanged.

# Board: speed against design 13 (round 6)

Two sets of numbers: Chrome with the CPU 4 times slower (the studio's Board mode, real input through the DevTools protocol) and Node, warm. Run them with:

- Chrome: `PLAYWRIGHT_DIR=<folder with node_modules/playwright-core> node packages/board/bench/chrome-board.mjs` (flags: `--md <file>` writes the table to a file, `--rows pen,gc,pan,fit,zoom,cards,lasso,switch,open`, `--cpu` for a CPU profile of each row, `--mix strokes|boxes|mixed`, `--debug`).
- Node: `npx vitest run --config packages/board/bench/vitest.config.ts` (each row is a test that fails past its goal).

## Chrome 158, CPU ×4, 1280 × 800 at 1:1, WebGL 2 back-end

The boards: 10,000 shapes are 7,000 strokes of 16 points, 1,500 rects and ellipses, 500 text shapes and 500 sticky notes, pasted into the studio as a board copy (`chrome/data.ts`). The table is from `chrome-board.mjs`.

| What | Goal | Measured | Compared as | Result |
|---|---|---|---|---|
| Pen sample to pixel (sample to end of its frame), 60 Hz | 16 ms | 10.4 ms | mean | ok |
| One frame while drawing a stroke (script) | 2 ms | 0.32 ms | mean | ok |
| Collections over a 10 s stroke | 0 | 4 | count | **over** |
| Pan, 10,000 shapes, 1:1 (script, 95th percentile) | 8 ms | 1.1 ms | p95 | ok |
| Pan, 10,000 shapes, all in view (script, 95th percentile) | 8 ms | 0.9 ms | p95 | ok |
| Zoom, 10,000 shapes (script, 95th percentile) | 8 ms | 10.2 ms | p95 | **over** |
| Pan, 2,000 strokes + 3 live cards (script, 95th percentile) | 8 ms | 2.2 ms | p95 | ok |
| Lasso of 2,000 strokes (pointer-up handler) | 4 ms | 4.0 to 4.3 ms | best of 4 | at the goal (3.8 to 4.3 over runs) |
| Switch to a page of 2,000 shapes (click to all tiles drawn) | 100 ms | 65 ms | best of 4 | ok |
| Open a 1,000-shape board (call to first picture) | 200 ms | 51 ms | best of 4 | ok |

How each is measured (the script's header has the same):

- A frame's script time is the time in the page's animation-frame callbacks plus the input handlers (pointer, wheel, paste) since the previous frame, as a patched `requestAnimationFrame` and `addEventListener` see it. Raster and compositing after the script are not in it.
- Pen sample to pixel is from each pen sample's own timestamp (every coalesced sample of a pointermove) to the end of the animation frame that draws it on the live canvas. The pen is driven as a pen (pointer type `pen`, 120 samples a second, not waited for one by one: the browser answers an input event when its frame has run, so waiting would tie the samples to the frames). At 60 Hz a sample waits for the next frame on average 8 ms, so the **mean** is compared with the 16 ms goal; the 95th percentile is one frame longer (15.8 ms, worst 27 ms). The start of the frame after it is 26.8 ms on average, an upper bound for the picture on screen.
- Collections are counted from a protocol trace (`MinorGC`, `MajorGC`) over a 10 s stroke, after a forced collection so the young generation starts empty. A page with nothing of the bench's own in it is used. An idle page of the same length gives 0.
- Zoom: three cycles of a pinch in by a factor of 4 (40 frames of 3.5%), a pause for the tiles of the new step, a pinch out. The number compared is the 95th percentile of all frames, moving and settling.
- Switch: from the click on the page list to the end of the last frame that draws a tile. The first frame is 10 to 13 ms.
- Open: `createBoard({ container, document })` to the end of the board's first frame, on `chrome/index.html`.

Details of the last run:

- **Pen:** mean 10.36 ms, 95% 15.8 ms, worst 27.2 ms; 1,201 samples in 601 frames. Script per frame while drawing: mean 0.32 ms, 95% 0.9 ms; the pointer-move handler takes 0.04 ms.
- **Collections:** 4 while drawing (2 scavenges, 2 major); with the browser's coalesced events hidden, 2 scavenges. See "Why not 0" below.
- **Pan 1:1:** mean 0.59 ms, 95% 1.1 ms, worst 7.6 ms; 60.2 frames a second, 95% of frame gaps 17.3 ms; 30 tiles. **All in view (zoom 11%):** mean 0.45 ms, 95% 0.9 ms, worst 1.2 ms; 62 tiles.
- **Zoom:** moving 262 frames, mean 2.0 ms, 95% 9.2 ms, worst 35.7 ms; the tiles of the new step after it: 15 frames, mean 8.0 ms, 95% 12.1 ms. With 10,000 strokes only the same row is 7.1 ms (ok); with strokes, rects and ellipses 8.8 ms.
- **Pan with 2,000 strokes and 3 live cards:** mean 0.98 ms, 95% 2.2 ms, worst 16.9 ms; 3 cards, 3 live.
- **Lasso:** 2,000 selected each time; 10.5 ms for the first, then 4.2 to 5.4 ms in the earlier runs and 3.8 to 4.3 ms in the last ones. The frame after it, which draws the outlines of 2,000 selected shapes, is 9 to 10 ms.
- **Switch:** 11.3 to 13.6 ms to the first frame, 65 to 82 ms to the last of 5 frames; 15 tiles.
- **Open:** 34.6 ms to `createBoard`, 51.3 ms to the end of the first frame, 58.4 ms to the start of the next (best of the runs after a warm-up).

## What was slow, and what was done

1. **Mixed tiles drew every stroke with Canvas 2D (BR-35).** A tile that held any shape (a rect, text, a sticky note) or the paper drew all its strokes as Canvas 2D paths, 4 calls for each triangle. Zooming a 10,000-shape board redrew tiles at 116 ms a frame on average (341 ms worst). The tile is now drawn in order on the GPU: strokes as before, each run of shapes and the paper with Canvas 2D on one canvas, copied to a texture and drawn over what the tile has so far. The same frames: mean 14 ms, then 8 ms with the budget below. `core/draw.ts` and `web/painter-gl.ts`.
2. **A frame that drew no tile still composed every tile (62 draw calls) and sorted them.** The painter now remembers what the tile canvas shows (camera, size, the tiles drawn, the list of tiles) and composes only when it changes; a stroke being drawn changes the live layer and the overlay, never the tiles. The sort of the tiles from the middle is done only when a tile is to be drawn, and makes no object. Composing a frame reuses its buffers.
3. **Tiles are drawn on a time budget** (4 ms, at least one a frame, at most 6) instead of 6 a frame whatever they cost.
4. **Zoomed far out from the steady zoom, the steady step needed up to 90 tiles, all drawn again when the zoom settled.** Past 48 tiles in view the step of the zoom as it is now is used (`MAX_VISIBLE_TILES`).
5. **Garbage while drawing:** 12 MB of allocation over a 10 s stroke (sampling heap profiler) went to 3 MB. The frame loop made objects every frame (the overlay's items, a size object, a list of tiles' boxes for the sort, an empty list for cards over a card, strings for the data attributes and the zoom label), `StateMachine.is(...)` made a rest array on every call in the hot paths (now `.state ===`), and the last colour string is kept.
6. The lasso's `expandGroups` no longer makes a list for each stroke.

## Why not 0 collections

Two things are left, both outside what the board's core makes (the core makes none: 0 over the simulated 10 s stroke in Node).

- Chrome's `getCoalescedEvents()` makes garbage of its own: on a blank page with one listener that only calls it, a 120 Hz pen gives 3 scavenges in 10 s; `getPredictedEvents()` and plain pointer fields give 0. `pointerrawupdate` would remove the call, but the DevTools protocol does not make raw updates, so the change could not be tried here.
- Canvas 2D calls with decimal arguments (`moveTo`, `lineTo` of the live stroke's triangles and its tail on the overlay) allocate a number object for each argument. Drawing the live layer with WebGL, which takes a typed array, would remove them.

Both are on the fix-later list (`findings.md`, BR-66, BR-67).

## Node, warm (`packages/board/bench/*.bench.ts`)

Every row of design 13 has a row; each is a test with the goal as its limit. The round 6 rows are the last two.

| Design 13 row | Bench row | Measured | Goal |
|---|---|---|---|
| Core work per input sample | core work per input sample | 0.0004 ms | 0.1 ms |
| One frame while drawing a stroke | frame while drawing (mean over 10 s) | 0.011 ms (p95 0.026) | 2 ms |
| Pan and zoom with 10,000 shapes | pan cold / warm, zoom (mean frame) | 0.16 / 0.057 / 0.074 ms (p95 up to 0.2) | 8 ms |
| Hit test at a point | hit test at a point (10,000 shapes) | 0.002 ms | 0.1 ms |
| Lasso of 2,000 strokes | lasso of 2,000 strokes | 1.14 ms | 4 ms |
| Open a 1,000-shape board | open (load + index); open to its first picture, real shapes | 2.2 ms; 6.3 ms | 200 ms |
| Switch to a page of 2,000 shapes | switch (index); switch, first picture, real shapes, nothing cached | 0.37 ms; 4.6 ms | 100 ms |
| Undo of a 500-shape paste | undo of a 500-shape paste, rects with bindings | 0.18 ms; 0.31 ms | 16 ms |
| Garbage while drawing | collections during the second simulated 10 s stroke | 0 | 0 |
| Memory for 100,000 ink points | memory for 100,000 ink points | 3.1 MB (3.9 MB with tilt) | 8 MB |

The other rows (3 live cards while panning 0.065 ms, drag of 200 shapes 1.5 ms, snap search 0.067 ms, recognising a stroke 0.01 to 0.07 ms, the agent's 20-action answer 0.98 ms, `board_read` 3 ms) pass their own limits; the full output of the run is in the table of the command above.

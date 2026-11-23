# Board: speed against design 13 (round 6 and its fix round)

Two sets of numbers: Chrome with the CPU 4 times slower (the studio's Board mode, real input through the DevTools protocol) and Node, warm. Run them with:

- Chrome: `PLAYWRIGHT_DIR=<folder with node_modules/playwright-core> node packages/board/bench/chrome-board.mjs` (flags: `--md <file>` writes the table to a file, `--warm <seconds>` is the stroke that warms the garbage row, `--rows pen,gc,pan,fit,zoom,cards,lasso,switch,open`, `--cpu` for a CPU profile of each row, `--mix strokes|boxes|mixed`, `--debug`).
- Node: `npx vitest run --config packages/board/bench/vitest.config.ts` (each row is a test that fails past its goal).

## Chrome 158, CPU ×4, 1280 × 800 at 1:1, WebGL 2 back-end (after the round 6 fixes)

The boards: 10,000 shapes are 7,000 strokes of 16 points, 1,500 rects and ellipses, 500 text shapes and 500 sticky notes, pasted into the studio as a board copy (`chrome/data.ts`). The table is from `chrome-board.mjs`, the whole script, run twice; each row is the second run's, and the first run's number is in the last column.

| What | Goal | Before (round 6 build) | Measured | First run | Compared as | Result |
|---|---|---|---|---|---|---|
| Pen sample to pixel (sample to end of its frame), 60 Hz | 16 ms | 10.4 ms | 7.34 ms | 10.15 ms | mean | ok |
| One frame while drawing a stroke (script) | 2 ms | 0.32 ms | 0.25 ms | 0.42 ms | mean | ok |
| Collections over a 10 s stroke (the board's page minus a blank page's) | 0 | 4 (blank page not subtracted) | 3 (blank page: 0) | 3 (blank page: 0) | count | **over** |
| Pan, 10,000 shapes, 1:1 (script, 95th percentile) | 8 ms | 1.1 ms | 1.00 ms | 1.20 ms | p95 | ok |
| Pan, 10,000 shapes, all in view (script, 95th percentile) | 8 ms | 0.9 ms | 0.80 ms | 1.10 ms | p95 | ok |
| Zoom, 10,000 shapes (script, 95th percentile) | 8 ms | 10.2 ms | 5.40 ms | 5.50 ms | p95 | ok |
| Pan, 2,000 strokes + 3 live cards (script, 95th percentile) | 8 ms | 2.2 ms | 1.80 ms | 2.10 ms | p95 | ok |
| Lasso of 2,000 strokes (pointer-up handler) | 4 ms | 4.0 to 4.3 ms (best of 4) | 3.30 ms | 2.60 ms | slowest of 4 | ok |
| Switch to a page of 2,000 shapes (click to all tiles drawn) | 100 ms | 65 ms | 42.3 ms | 51.2 ms | best of 4 | ok |
| Open a 1,000-shape board (call to first picture) | 200 ms | 51 ms | 61.8 ms | 67.8 ms | best of 4 | ok |

How each is measured (the script's header has the same):

- A frame's script time is the time in the page's animation-frame callbacks plus the input handlers (pointer, wheel, paste) since the previous frame, as a patched `requestAnimationFrame` and `addEventListener` see it. Raster and compositing after the script are not in it.
- Pen sample to pixel is from each pen sample's own timestamp (every coalesced sample of a pointermove) to the end of the animation frame that draws it on the live canvas. The pen is driven as a pen (pointer type `pen`, 120 samples a second, not waited for one by one: the browser answers an input event when its frame has run, so waiting would tie the samples to the frames). At 60 Hz a sample waits for the next frame on average 8 ms, so the **mean** is compared with the 16 ms goal.
- Collections are counted from a protocol trace (`MinorGC`, `MajorGC`) over a 10 s stroke, after a forced collection that is given 400 ms to finish, so the young generation starts empty. The row is the board's page minus a blank page's: the same stroke on a page of its own (a context of its own, served from the loopback address because `getCoalescedEvents` exists only in a secure context) whose one listener only calls `getCoalescedEvents()`, after 3 s for its heap to settle. Both counts are printed, with an idle page's.
- Zoom: three cycles of a pinch in by a factor of 4 (40 frames of 3.5%), a pause for the tiles of the new step, a pinch out. The number compared is the 95th percentile of all frames, moving and settling.
- Lasso: five runs on a board of 2,000 strokes, the first to warm the code; the row is the **slowest** of the other four (it was the best of four before).
- Switch: from the click on the page list to the end of the last frame that draws a tile. Open: `createBoard({ container, document })` to the end of the board's first frame, on `chrome/index.html`.

Details of the last two runs (second, then first):

- **Pen:** mean 7.34 ms, 95% 17.0 ms, worst 44.5 ms (first: 10.15, 15.2, 21.6); 1,201 samples in 604 frames. Script per frame while drawing: mean 0.25 ms (0.42).
- **Collections:** the board's page 3 (1 scavenge, 2 major; the first run the same) and the blank page 0. Run alone, the row gives 4 scavenges. See "Why not 0" below.
- **Pan 1:1:** mean 0.38 ms, 95% 1.0 ms, worst 5.2 ms; 60.2 frames a second; 27 tiles. **All in view (zoom 11%):** mean 0.25 ms, 95% 0.8 ms, worst 1.4 ms; 62 tiles.
- **Zoom:** moving 282 frames, mean 0.92 ms, 95% 5.2 ms, worst 10.8 ms; the tiles of the new step after it: 19 frames, mean 4.09 ms, 95% 7.7 ms. Run alone: 5.4 to 5.7 ms in three runs, 7.2 to 8.4 ms before tiles were drawn in slices.
- **Pan with 2,000 strokes and 3 live cards:** mean 0.80 ms, 95% 1.8 ms, worst 17.3 ms; 3 cards, 3 live.
- **Lasso:** 2,000 selected each time; 7.0 ms for the first run, then 2.8, 2.2, 3.3 and 2.0 ms (first run: 6.8, then 2.6, 2.1, 1.7, 2.1). The frame after it, which draws the outlines of 2,000 selected shapes, is 7 ms (BR-70).
- **Switch:** 8.0 to 10.0 ms to the first frame, 42 to 68 ms to the last of 4 or 5 frames; 15 tiles.
- **Open:** 61.8 ms to the end of the first frame at best, 74 ms to the start of the next (best of the runs after a warm-up).

## What was slow, and what was done

Round 6 build (the first six):

1. **Mixed tiles drew every stroke with Canvas 2D (BR-35).** A tile that held any shape (a rect, text, a sticky note) or the paper drew all its strokes as Canvas 2D paths. The tile is drawn in order on the GPU: strokes as triangles, each run of shapes and the paper with Canvas 2D on one canvas copied to a texture. `core/draw.ts` and `web/painter-gl.ts`.
2. **A frame that drew no tile still composed every tile (62 draw calls) and sorted them.** The painter remembers what the tile canvas shows (camera, size, the tiles drawn, the list of tiles) and composes only when it changes.
3. **Tiles are drawn on a time budget** (4 ms, at least one a frame, at most 6) instead of 6 a frame whatever they cost.
4. **Zoomed far out from the steady zoom, the steady step needed up to 90 tiles.** Past 48 tiles in view the step of the zoom as it is now is used (`MAX_VISIBLE_TILES`).
5. **Garbage while drawing:** 12 MB of allocation over a 10 s stroke went to 3 MB (frame objects, `StateMachine.is(...)` rest arrays, strings).
6. The lasso's `expandGroups` no longer makes a list for each stroke.

The fix round (BR-72 to BR-76):

7. **A tile left blank (BR-72).** The paper layer's target was made inside the first tile's frame, which unbinds the frame's framebuffer: the first tile with paper was drawn into the canvas and resolved from an empty target. The target is made when the GPU raster opens.
8. **Shapes were Canvas 2D (BR-73).** `packages/view/src/core/tessellate.ts` flattens paths and makes triangles (fan or ear clipping for a fill; quads, round joins and caps and dashes for a line). A shape's fills and lines are runs of triangles with their own colour and depth, in the same draw call as the strokes; text is quads from a glyph atlas (`web/painter-atlas.ts`, one 1024 × 1024 texture); only pictures, shapes inside a frame and a shape the tessellator refuses are painted on a layer. A tile of 400 shapes with notes and text is one draw call, where it was one for every run of shapes and a copy of a whole tile picture for each.
9. **Zoom was dear in the parts the GPU does not do (BR-73).** A stroke's outline is the same for every zoom step that cuts its arcs with the largest step (`saturatedTolerance`), so a small stroke is built once for all the steps far out; a shape's mesh and draw item are kept for its last four scales; strokes too small to see leave the draw list before the sort; the sort has the two layers apart; and a tile with many shapes is drawn in slices: `DrawList.plan` finds and orders the shapes, their items are made 64 at a time, and the GPU raster stops after the frame's budget (4 ms from the start of the frame, at least 32 items) and goes on in the next frame, with the same scratch target, depth and atlas. No frame draws more than a slice.
10. **The live stroke (BR-74).** One WebGL context for the live layer (`web/painter-live.ts`): the outliner's own `Float32Array` and `Uint32Array` go to the GPU every frame (`bufferSubData` with an offset and a length, so no copy), the whole stroke is drawn in one opaque colour (the opacity stays the canvas's CSS opacity), and the predicted tail is a strip of triangles built in an array the layer owns. The live layer no longer needs the overlay for the part of the stroke that is not final. Canvas 2D stays for a painter asked for Canvas 2D only.
11. **The lasso (BR-75).** A grid of 16 by 16 cells over the loop's box answers most strokes without a test against the loop's edges; the ids of a lasso that touches no group are the selection as they are; ids the lasso's own grid gave are looked up without the page checks.
12. **Small things in the frame:** the frame loop's callback is made once; the tile cache sweeps with a callback kept on the cache and reuses the tiles of the last frame when the view is the same.

## Why not 0 collections

The row is the board's page minus a blank page's, and it is not 0: 3 collections over a 10 s stroke (a scavenge and two major collections in the full script, 4 scavenges when the row is run alone), against 0 on the blank page.

- The browser's share is small. On a page that can call `getCoalescedEvents()` a 120 Hz pen costs the browser about 90 KB in 10 s and no collection. The earlier note (BR-66), that the browser makes 3 scavenges of its own, came from a blank page that was not a secure context: there the call is not a function, and the errors thrown into the listener were the garbage.
- Ours is about 2 MB over the 10 s (sampling heap profile, `--rows gc --profile`): `getPredictedEvents()` for every pointer move (0.4 MB, and one of the collections), the outliner's arrays growing for each stroke (0.4 MB), the pointer path's numbers and samples (0.6 MB), the frame loop (0.4 MB) and the live layer's calls. Running Chrome with every function optimised (`--js-flags=--always-turbofan`) changes none of it, so these are real allocations. Drawing the live layer with WebGL took the Canvas 2D calls out (BR-67) and was not the main part.

It is on the fix-later list as BR-77 with the order to take the sites in.

### After the drag and garbage fix round (branch `fix/board-drag-gc`)

Chrome, CPU ×4, the same script (`chrome-board.mjs`, every row): pen sample to pixel 9.4 ms mean, one frame while drawing 0.19 ms mean (was 0.25 to 0.42), pan 1.0 ms, fit 0.8 ms, zoom 5.7 ms, 3 cards 1.8 ms, lasso 2.8 ms, page switch 40 ms, open 62 ms: all within goal. The garbage row reads 2: no scavenge, two major collections back to back about 8 s after the script's forced collection (V8's memory reducer). Run alone (`--rows gc`, a fresh page with a 2 s warm-up stroke) it reads 1 scavenge, about 7 s into the stroke; it read 3 to 5. Script garbage over the stroke is about 0.7 MB (was about 2 MB); the blank page's is 0.09 MB. With a 5 s warm-up stroke the row reads 1, with 10 s no scavenge: what is left is the engine's first tiers running the outline code before it is optimised (they keep every number on the heap), which a longer use of the pen, or the warm-up stroke the board draws 400 ms after it opens, takes away. A calibration on a blank page (`young.mjs`, not in the repository): 1 KB of plain garbage a frame makes no scavenge in 10 s, 2 KB makes 1, 4 KB makes 2. What was changed is in `findings.md` BR-77; the new options of the script are `--gcdetail`, `--usage`, `--track`, `--alloc` and `--gcpage bare`.

The drag (`chrome-drag.mjs`, BR-82): 2,000 strokes under a rectangle and a 3000 × 2000 picture, each shaken for 3 s at a 2× pixel ratio. Frame script 2.3 to 3.1 ms mean before, 0.4 to 0.5 ms after; no tile is drawn after the first move. The picture's drag is filmed with the screencast, and every frame is checked for a ghost (the box round the picture's red wider or taller than the picture) and a missing part (fewer red pixels): none, before or after. In this scene the picture itself stayed whole before the fix too; what tore was the strokes in the tiles drawn again under and round the moving shape (BR-83), plus the cost of drawing those tiles at every move. On a slower machine, or with a picture that takes longer to draw into a tile than the 4 ms budget, the old path also left parts of the shape where they had been for a few frames.

## Node, warm (`packages/board/bench/*.bench.ts`)

Every row of design 13 has a row; each is a test with the goal as its limit. The round 6 rows are the last two.

| Design 13 row | Bench row | Measured | Goal |
|---|---|---|---|
| Core work per input sample | core work per input sample | 0.0004 ms | 0.1 ms |
| One frame while drawing a stroke | frame while drawing (mean over 10 s) | 0.0094 ms (p95 0.026) | 2 ms |
| Pan and zoom with 10,000 shapes | pan cold / warm, zoom (mean frame) | 0.15 / 0.051 / 0.044 ms (p95 up to 0.25) | 8 ms |
| Hit test at a point | hit test at a point (10,000 shapes) | 0.002 ms | 0.1 ms |
| Lasso of 2,000 strokes | lasso of 2,000 strokes | 0.39 ms | 4 ms |
| Open a 1,000-shape board | open (load + index); open to its first picture, real shapes | 2.2 ms; 6.3 ms | 200 ms |
| Switch to a page of 2,000 shapes | switch (index); switch, first picture, real shapes, nothing cached | 0.37 ms; 4.6 ms | 100 ms |
| Undo of a 500-shape paste | undo of a 500-shape paste, rects with bindings | 0.18 ms; 0.31 ms | 16 ms |
| Garbage while drawing | collections during the second simulated 10 s stroke | 0 | 0 |
| Memory for 100,000 ink points | memory for 100,000 ink points | 3.1 MB (3.9 MB with tilt) | 8 MB |

The other rows (3 live cards while panning 0.065 ms, drag of 200 shapes 1.5 ms, snap search 0.067 ms, recognising a stroke 0.01 to 0.07 ms, the agent's 20-action answer 0.98 ms, `board_read` 3 ms) pass their own limits; the full output of the run is in the table of the command above.

# Biology kit

`inc.biology` draws the pictures biology is taught with: cells and their organelles, particles crossing a membrane, DNA's double helix, and flows along vessels. It is a domain kit (DG-6): the biology kit script loads only for scenes that call it.

```js
const bio = inc.biology('#stage', { title: 'Cells', viewBox: [0, 0, 900, 360] });
const plant = bio.cell(450, 165, { kind: 'plant', size: 260 });
bio.stage.part('Chloroplasts', plant.organelle('chloroplasts'), { label: 'Chloroplasts', info: 'Photosynthesis makes glucose here from light.' });
```

## Cells

`bio.cell(x, y, { kind, size, organelles, seed })` draws an animal cell (the default), a plant cell or a bacterium, centred on (x, y) and `size` stage units wide:

| Kind | Organelles |
| --- | --- |
| animal | cytoplasm, membrane, er, golgi, mitochondria, ribosomes, nucleus, nucleolus |
| plant | wall, cytoplasm, membrane, vacuole, chloroplasts, mitochondria, ribosomes, nucleus, nucleolus |
| bacterium | flagellum, wall, cytoplasm, membrane, nucleoid, plasmids, ribosomes |

`organelles` draws only some of them. Each organelle is its own group: `cell.organelle('nucleus')` returns it, for a part, a callout or a connector, or to fade or hide it; `cell.where('nucleus')` gives a point on it for a label or an arrow. The kit refuses an organelle a cell does not have ("an animal cell has no vacuole"). The animal cell's outline is a gently irregular blob, and the same `seed` draws the same one.

## Membranes

`bio.membrane({ particles: [left, right], channels, permeability, pump, speed, box, tone })` runs a box split down the middle by a membrane with channel proteins in it. Particles move like molecules in a fluid, each running straight for a while and drifting off course at random, and cross only through a channel, each time with the chance `permeability`. So a crowded side empties until the two sides are about even, with particles still crossing both ways; shut channels (permeability 0) stop all crossing; and a pump (`pump` particles a second) carries particles from left to right against the gradient, as in active transport. The channels look as open as they are and the pump shows while it works.

`membrane.left`, `membrane.right` and `membrane.crossed` give the counts now, and the counts are written over each side. `set({ permeability, pump, speed })` changes it as it runs; `reset(left, right)` scatters the particles again. The particles move at a fixed step while the figure plays, from a seeded generator, so a run is the same every time. They are drawn as dots on the canvas layer behind the drawing.

## DNA

`bio.helix({ sequence, from, to, radius, perTurn, letters, spin })` draws the double helix between two points: two backbones and a rung for every base pair, each base in its own tone, A with T and G with C. `helix.partner` is the paired strand. Letters show beside the pairs that face the viewer. `unzip(fraction)` pulls the strands apart from the start, each base sticking out from its own strand, as in replication or transcription; `base(index)` returns one pair's drawing for a part. `spin` turns the helix while the figure plays.

## Flows

`bio.stream(points, { count, speed, shape, size, tone, width })` moves particles along the path through `points`: dots, or discs like red blood cells with `shape: 'cell'`, and with `width` the path is drawn as a vessel with two walls. A change of `speed` carries on from where the particles are; `at(index)` gives where one is now. The particles stand still when the learner asks for reduced motion.

## Reference scenes

Two reviewed figures use the kit: `cells` (animal, plant and bacterial cells side by side, picking out what they share and what only some have) and `diffusion` (particles crossing a membrane, with channels to shut and a pump to run).

## Limits

A stage draws at most 8 cells and 2 membranes; a membrane holds at most 400 particles and 8 channels, a helix 48 base pairs, and a stream 60 particles along up to 200 points.

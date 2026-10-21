// Two bar magnets: the field around them and the force between them, as the gap closes or one flips.
inc.idea('Opposite poles pull together and like poles push apart, and the force grows quickly as the gap between the magnets closes.');

const gap = inc.param('gap', { min: 1, max: 8, step: 0.1, value: 4, label: 'Gap', unit: 'cm' });
const flip = inc.toggle('flip', { value: false, label: 'Flip the right magnet' });

// Each magnet is 6 cm long with a pole of strength Q at each end: N counts +1, S counts -1.
const L = 6;
const Q = 20; // A·m
const model = inc.model(({ gap: g, flip: f }) => {
  const s = f ? 1 : -1; // the right magnet's inner pole
  const poles = [[-L, -1], [0, 1], [g, s], [g + L, -s]];
  // Force on the right magnet in newtons, + pushing it right: 1e-7 Q² q1 q2 / d² for each pair, d in metres.
  const force = (x) => {
    let sum = 0;
    for (const [xr, qr] of [[x, s], [x + L, -s]]) {
      for (const [xl, ql] of [[-L, -1], [0, 1]]) sum += (qr * ql) / ((xr - xl) / 100) ** 2;
    }
    return 1e-7 * Q * Q * sum;
  };
  return { g, poles, force: force(g), half: force(g / 2), repel: s > 0 };
});

const graph = inc.graph2d('#stage', {
  x: [-11, 16],
  y: [-7, 7],
  viewBox: [0, 0, 760, 420],
  axes: false,
  grid: false,
  zoom: false,
  title: 'Two bar magnets',
  description: 'Two bar magnets on a line, with arrows showing the direction of the magnetic field around them. Drag the dot on the right magnet to change the gap.',
});

// Arrows of equal length show only the field's direction: B is the sum of q r / r³ over the poles.
const field = graph.field(
  (x, y) => {
    if (Math.abs(y) < 0.9 && ((x > -L - 0.2 && x < 0.2) || (x > model.g - 0.2 && x < model.g + L + 0.2))) return null;
    let bx = 0;
    let by = 0;
    for (const [px, q] of model.poles) {
      const r3 = ((x - px) ** 2 + y * y) ** 1.5;
      bx += (q * (x - px)) / r3;
      by += (q * y) / r3;
    }
    const b = Math.hypot(bx, by);
    return [bx / b, by / b];
  },
  { tone: 'mid', step: 1.5, scale: 1 },
);

// A magnet drawn from its left end at x = 0, as two halves with their pole letters.
const H = graph.toY(-0.8) - graph.toY(0.8);
const W = graph.toX(L / 2) - graph.toX(0);
const magnet = (x) => {
  const group = graph.stage.group({ layer: 'front' });
  const half = (dx, tone, name) => [
    graph.stage.rect(graph.toX(x + dx), graph.toY(0.8), W, H, { tone, fill: true, parent: group }).set({ 'fill-opacity': 0.3 }),
    graph.label(x + dx + L / 4, -0.3, name, { tone, parent: group }).set({ 'text-anchor': 'middle' }),
  ];
  return { group, inner: half(0, 'b', 'S'), outer: half(L / 2, 'a', 'N') };
};
const left = magnet(-L);
const right = magnet(0);
graph.handle({ x: 'gap', y: 0, tone: 'lit', r: 7, label: 'the right magnet' });

graph.stage.part('Left magnet', left.group, { label: 'Left magnet', info: 'Fixed, with its north pole facing right.' });
graph.stage.part('Right magnet', right.group, { label: 'Right magnet', info: 'Drag its inner end to change the gap; flip it to swap its poles.' });
graph.stage.part('Field', field.handle, { label: 'Field', info: 'The direction a compass needle would point: out of N, into S.' });

inc.onFrame(() => {
  right.group.at(graph.toX(model.g) - graph.toX(0), 0);
  for (const [piece, north] of [[right.inner, model.repel], [right.outer, !model.repel]]) {
    piece[0].tone(north ? 'a' : 'b');
    piece[1].tone(north ? 'a' : 'b').text(north ? 'N' : 'S');
  }
});

const mN = () => (Math.abs(model.force) * 1000).toFixed(0);
inc.readout({ Force: () => `${mN()} mN`, 'Push or pull': () => (model.repel ? 'repel' : 'attract') });

inc.explain(
  () =>
    `${model.repel ? 'Like poles face each other, so the magnets push apart' : 'Opposite poles face each other, so the magnets pull together'} with ${mN()} mN; at half this gap the force would be ${(model.half / model.force).toFixed(1)} times as strong.`,
);

inc.describe(
  () =>
    `Two bar magnets ${model.g.toFixed(1)} cm apart with ${model.repel ? 'north facing north' : 'north facing south'}. The field arrows run out of each N pole and round into an S pole, and the magnets ${model.repel ? 'push apart' : 'pull together'} with ${mN()} mN.`,
);

inc.steps([
  { say: 'The field runs out of each north pole and round into a south pole.', focus: 'Field' },
  { say: 'North faces south, so the magnets pull together.', focus: 'Right magnet', set: { flip: 0 } },
  { say: 'Flip the right magnet: north faces north and they push apart.', focus: 'Right magnet', set: { flip: 1 } },
  { say: 'Close the gap and the force grows fast, because the pull between facing poles goes as one over their distance squared.', focus: 'Right magnet', set: { gap: 1.5 } },
]);

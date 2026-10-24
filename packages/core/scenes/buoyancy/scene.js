// Buoyancy: a block dropped into a tank floats or sinks, depending on its density and the liquid's.
inc.idea('A block sinks until the liquid it pushes aside weighs as much as it does; a block denser than the liquid never gets there, so it sinks.');

const density = inc.param('density', { min: 200, max: 2000, step: 50, value: 600, label: 'Block density', unit: 'kg/m³' });
const liquid = inc.param('liquid', { min: 700, max: 1300, step: 50, value: 1000, label: 'Liquid density', unit: 'kg/m³' });

// The block is 2 m wide and 1 m tall; the tank is 8 m wide and filled 3 m deep (all per metre of depth).
const W = 2;
const H = 1;
const model = inc.model(({ density: rb, liquid: rl }) => {
  const under = Math.min(1, rb / rl); // the share of the block under the surface once it settles
  const level = 3 + (W * H * under) / 8; // the surface rises by the liquid pushed aside
  return { under, floats: rb < rl, weight: rb * W * H * 9.8, bottom: rb < rl ? level - under * H : 0 };
});

// A 12 m by 6.4 m world: 50 stage units per metre.
const world = inc.physics2d('#stage', {
  viewBox: [0, 0, 600, 320],
  title: 'Block in a tank',
  description: 'A block drops into a tank of liquid and floats or sinks, with arrows for its weight and the push of the liquid. A dashed line marks where its bottom comes to rest. Drag the block to dunk it.',
});
const tank = world.tank({ x: 2, w: 8, depth: 3, density: () => liquid.value, tone: 'b' });
const block = world.box({ at: [6, 4.5], w: W, h: H, density: () => density.value, tone: 'a', draggable: true });
world.forces(block, { show: ['gravity', 'buoyancy', 'normal'] });
// Archimedes' prediction: where the bottom of the block comes to rest.
const rest = world.stage.line(0, 0, 0, 0, { tone: 'lit', dashed: true, layer: 'front' });

world.stage.part('Block', block.handle, { label: 'Block', info: 'Its weight is its density times its volume times g.' });
world.stage.part('Liquid', tank.handle, { label: 'Liquid', info: 'It pushes up with the weight of the liquid the block pushes aside.' });
world.stage.part('Resting depth', rest, { label: 'Resting depth', info: 'Where the bottom of the block comes to rest, from Archimedes’ principle.' });

inc.onFrame(() => {
  const [x1, y] = world.toStage([4.4, model.bottom]);
  const [x2] = world.toStage([7.6, model.bottom]);
  rest.set({ x1, y1: y, x2, y2: y });
});

const percent = () => `${(model.under * 100).toFixed(0)}%`;
inc.readout({
  Weight: () => `${model.weight.toFixed(0)} N`,
  'Upward push': () => `${tank.buoyancy(block).toFixed(0)} N`,
  'Under at rest': () => (model.floats ? percent() : 'all of it'),
});

inc.explain(() =>
  model.floats
    ? `The block is ${percent()} as dense as the liquid, so it settles with ${percent()} of it under the surface: there the liquid it pushes aside weighs as much as the block.`
    : 'The block is denser than the liquid: even fully under, the liquid it pushes aside weighs less than the block, so it sinks to the bottom.',
);

inc.describe(
  () =>
    `A block of density ${density.value.toFixed(0)} kg/m³ in a liquid of density ${liquid.value.toFixed(0)} kg/m³ ${model.floats ? `floats with ${percent()} of it under the surface` : 'sinks to the bottom'}.`,
);

inc.steps([
  { say: 'The liquid pushes up with a force equal to the weight of the liquid the block pushes aside.', focus: 'Liquid' },
  { say: 'A lighter block balances its weight with less liquid pushed aside, so it floats higher.', focus: 'Block', set: { density: 300 } },
  { say: 'A block denser than the liquid cannot push aside its own weight, so it sinks.', focus: 'Resting depth', set: { density: 1500 } },
]);

// Spring-mass oscillator: x(t) = A cos(ωt) with ω = √(k/m), on a frictionless floor.
inc.idea('A block on a spring oscillates about equilibrium; its period depends on the mass and the stiffness, never on how far it swings.');

const mass = inc.param('mass', { min: 0.2, max: 2, step: 0.1, value: 0.5, label: 'Mass', unit: 'kg' });
const stiffness = inc.param('stiffness', { min: 5, max: 50, step: 1, value: 20, label: 'Stiffness', unit: 'N/m' });
const amplitude = inc.param('amplitude', { min: 0.05, max: 0.25, step: 0.01, value: 0.15, label: 'Amplitude', unit: 'm' });

const model = inc.model(({ mass: m, stiffness: k, amplitude: A }) => {
  const omega = Math.sqrt(k / m);
  return { m, k, A, omega, period: (2 * Math.PI) / omega, top: A * omega, side: 40 + 40 * Math.sqrt(m) };
});

// Each change starts the block again from rest at the amplitude, on the side it was last pulled to.
let now = 0;
let start = 0;
let side = 1;
inc.onParamChange(() => {
  start = now;
});
inc.onReset(() => {
  start = 0;
});

// 800 stage units per metre; at equilibrium the block's left face is at x = 360, the wall at x = 60.
const S = 800;
const REST = 360;
const FLOOR = 200;
const stage = inc.svg('#stage', { viewBox: [0, 0, 760, 230], title: 'Mass on a spring', description: 'A block on a frictionless floor, joined to a wall by a spring, slides back and forth about equilibrium, with an arrow for the spring force. Pull the block and let go.' });
stage.line(60, 40, 60, FLOOR, { tone: 'mid' });
stage.line(60, FLOOR, 740, FLOOR, { tone: 'mid' });
const rest = stage.line(REST, 30, REST, FLOOR, { tone: 'faint', dashed: true });
const spring = stage.path('', { tone: 'b' });
const springLabel = stage.text(0, 0, '', { tone: 'b' }).set({ 'text-anchor': 'middle' });
const block = stage.rect(REST, 0, 0, 0, { tone: 'a', fill: true });
const blockLabel = stage.text(0, 0, '', { tone: 'a' }).set({ 'text-anchor': 'middle' });
const force = stage.path('', { tone: 'c' });
stage.drag(block, (p) => {
  side = p.x < REST + model.side / 2 ? -1 : 1;
  return { amplitude: Math.abs(p.x - REST - model.side / 2) / S };
}, { label: 'the block' });

stage.part('Spring', spring, { label: 'Spring', info: 'It pulls or pushes the block back toward equilibrium.' });
stage.part('Block', block, { label: 'Block', info: 'Its mass resists changes in speed. Drag it and let go.' });
stage.part('Equilibrium', rest, { label: 'Equilibrium', info: 'Where the spring neither pushes nor pulls.' });
stage.part('Spring force', force, { label: 'Spring force', info: 'F = -kx: always toward equilibrium, strongest at the ends.' });

inc.onFrame(({ time }) => {
  now = time;
  const x = side * model.A * Math.cos(model.omega * (time - start));
  const face = REST + x * S;
  const top = FLOOR - model.side;
  block.set({ x: face, y: top, width: model.side, height: model.side });
  blockLabel.set({ x: face + model.side / 2, y: FLOOR + 20 }).text(`${model.m.toFixed(1)} kg`);
  spring.d(inc.shapes.spring(60, top + model.side / 2, face, top + model.side / 2, { coils: 12, width: 12 }));
  springLabel.set({ x: (60 + face) / 2, y: top + model.side / 2 - 22 }).text(`k = ${model.k.toFixed(0)} N/m`);
  // F = -kx, drawn 16 stage units per newton above the block.
  force.d(inc.path.arrow({ from: [face + model.side / 2, top - 14], by: [-model.k * x * 16, 0] }));
});

inc.readout({
  Period: () => `${model.period.toFixed(2)} s`,
  Frequency: () => `${(1 / model.period).toFixed(2)} Hz`,
  'Top speed': () => `${model.top.toFixed(2)} m/s`,
});

inc.explain(
  () =>
    `With ${model.m.toFixed(1)} kg on a ${model.k.toFixed(0)} N/m spring, ω = √(k/m) = ${model.omega.toFixed(2)} rad/s, so each oscillation takes ${model.period.toFixed(2)} s, however far it swings; it passes equilibrium at ${model.top.toFixed(2)} m/s.`,
);

inc.describe(
  () =>
    `A ${model.m.toFixed(1)} kg block on a spring of stiffness ${model.k.toFixed(0)} N/m slides ${(model.A * 100).toFixed(0)} cm either side of equilibrium, taking ${model.period.toFixed(2)} s for each oscillation.`,
);

inc.steps([
  { say: 'A heavier block responds more slowly, so each oscillation takes longer: the period grows with √m.', focus: 'Block', set: { mass: 2 } },
  { say: 'A stiffer spring pulls back harder, so the block oscillates faster.', focus: 'Spring', set: { mass: 0.5, stiffness: 50 } },
  { say: 'A bigger amplitude means more distance at higher speed, so the period stays the same.', focus: 'Equilibrium', set: { stiffness: 20, amplitude: 0.25 } },
]);

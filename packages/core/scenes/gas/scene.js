// Ideal gas: particles in a box with a piston; heating or squeezing the gas raises its pressure.
inc.idea('Gas pressure is particles hitting the walls: heating them speeds them up and squeezing them into less room makes them hit more often, so P = nRT/V.');

const temperature = inc.param('temperature', { min: 100, max: 600, step: 10, value: 300, label: 'Temperature', unit: 'K' });
const volume = inc.param('volume', { min: 1, max: 3, step: 0.1, value: 2, label: 'Volume', unit: 'L' });

// 0.1 mol of nitrogen (M = 0.028 kg/mol) drawn as 40 particles; 160 stage units of box per litre.
const MOLES = 0.1;
const N = 40;
const [LEFT, TOP, BOTTOM, R] = [30, 30, 290, 4];
const model = inc.model(({ temperature: T, volume: V }) => ({
  T,
  V,
  pressure: (MOLES * 8.314 * T) / (V / 1000) / 1000, // kPa: P = nRT/V with V in m³
  speed: Math.sqrt((8 * 8.314 * T) / (Math.PI * 0.028)), // mean molecular speed, m/s
  face: LEFT + 160 * V,
  mercury: 288 - 0.4 * T,
}));

const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 340], zoom: false, title: 'Gas in a box', description: 'Particles bounce around a box closed by a piston, with a thermometer beside it. Drag the piston or the thermometer.' });
const walls = stage.path('M530 30H30V290H530', { tone: 'mid' });
const piston = stage.rect(0, TOP, 12, BOTTOM - TOP, { tone: 'b', fill: true });
const rod = stage.line(0, 160, 548, 160, { tone: 'mid' });
// The rod ends in a handle.
stage.circle(548, 160, 6, { tone: 'mid' });
const thermometer = stage.group();
stage.rect(566, 40, 18, 250, { tone: 'faint', parent: thermometer }).set({ rx: 9 });
const column = stage.rect(571, 0, 8, 0, { tone: 'lit', fill: true, parent: thermometer });
stage.circle(575, 296, 12, { tone: 'lit', fill: true, parent: thermometer });
const gas = stage.dots({ tone: 'a', r: R });
stage.drag(piston, (p) => ({ volume: (p.x - LEFT) / 160 }), { label: 'the piston' });
stage.drag(thermometer, (p) => ({ temperature: (288 - p.y) / 0.4 }), { label: 'the thermometer' });

stage.part('Box', walls, { label: 'Box', info: 'The gas fills it up to the piston.' });
stage.part('Piston', piston, { label: 'Piston', info: 'Its position sets the volume. Drag it.' });
stage.part('Thermometer', thermometer, { label: 'Thermometer', info: 'The temperature sets how fast the particles move. Drag it.' });

// Random directions; speeds spread as in a 2D gas, averaging 1, scaled by the model's mean speed.
const molecules = [];
for (let i = 0; i < N; i++) {
  const a = 2 * Math.PI * inc.random();
  const v = 0.8 * Math.sqrt(-2 * Math.log(1 - inc.random()));
  molecules.push({ x: LEFT + inc.random() * (model.face - LEFT), y: TOP + inc.random() * (BOTTOM - TOP), vx: v * Math.cos(a), vy: v * Math.sin(a) });
}
let hits = 0;
let clock = 0;
let rate = 0;

// 0.25 stage units per m/s; particles bounce off the walls, and the piston pushes any it passes.
inc.simulate((dt) => {
  const step = 0.25 * model.speed * dt;
  for (const m of molecules) {
    m.x += m.vx * step;
    m.y += m.vy * step;
    if (m.x < LEFT + R) m.vx = Math.abs(m.vx);
    if (m.y < TOP + R) m.vy = Math.abs(m.vy);
    if (m.y > BOTTOM - R) m.vy = -Math.abs(m.vy);
    if (m.x > model.face - R) {
      m.x = model.face - R;
      m.vx = -Math.abs(m.vx);
      hits += 1;
    }
  }
  clock += dt;
  if (clock >= 1) {
    rate = hits / clock;
    hits = 0;
    clock = 0;
  }
});

inc.onFrame(() => {
  gas.set(molecules.map((m) => [Math.min(m.x, model.face - R), m.y]));
  piston.set({ x: model.face });
  rod.set({ x1: model.face + 12 });
  column.set({ y: model.mercury, height: 290 - model.mercury });
});

inc.readout({
  Pressure: () => `${model.pressure.toFixed(0)} kPa`,
  'Mean speed': () => `${model.speed.toFixed(0)} m/s`,
  'Piston hits': () => `${rate.toFixed(0)} per second`,
});

inc.explain(
  () =>
    `At ${model.T.toFixed(0)} K the particles average ${model.speed.toFixed(0)} m/s, and in ${model.V.toFixed(1)} L they hit the piston often and hard enough to push with ${model.pressure.toFixed(0)} kPa.`,
);

inc.describe(
  () =>
    `${N} particles standing for ${MOLES} mol of nitrogen at ${model.T.toFixed(0)} K bounce around ${model.V.toFixed(1)} L of box; the pressure is ${model.pressure.toFixed(0)} kPa.`,
);

inc.steps([
  { say: 'Heat the gas: faster particles hit the piston more often and harder, so the pressure rises.', focus: 'Thermometer', set: { temperature: 600 } },
  { say: 'Push the piston in: with less room the particles hit it more often, so the pressure rises again.', focus: 'Piston', set: { volume: 1 } },
  { say: 'Pressure grows with temperature and falls with volume: P V = n R T.', focus: 'Box' },
]);

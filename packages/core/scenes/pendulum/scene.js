// Simple pendulum: the full swing equation, stepped with RK4, and its energy.
inc.idea("A pendulum's period depends on its length and on gravity, and only a little on how far it swings.");

const length = inc.param('length', { min: 0.5, max: 2.5, step: 0.1, value: 1.5, label: 'Length', unit: 'm' });
const amplitude = inc.param('amplitude', { min: 5, max: 80, step: 1, value: 30, label: 'Amplitude', unit: 'degrees' });
const gravity = inc.param('gravity', { min: 1.6, max: 25, step: 0.1, value: 9.8, label: 'Gravity', unit: 'm/s²' });

// Exact period 4√(L/g)·K(k) with k = sin(θ₀/2); for tiny swings it is 2π√(L/g).
const model = inc.model(({ length: L, amplitude: a, gravity: g }) => {
  const theta0 = (a * Math.PI) / 180;
  const k = Math.sin(theta0 / 2);
  const K = inc.calc.integral((phi) => 1 / Math.sqrt(1 - k * k * Math.sin(phi) * Math.sin(phi)), 0, Math.PI / 2);
  return { L, g, theta0, period: 4 * Math.sqrt(L / g) * K, small: 2 * Math.PI * Math.sqrt(L / g), top: Math.sqrt(2 * g * L * (1 - Math.cos(theta0))) };
});

// θ'' = -(g/L) sin θ, from rest at the amplitude, on the side the bob was last pulled to.
let theta = 0;
let omega = 0;
let side = 1;
const reset = () => {
  theta = side * model.theta0;
  omega = 0;
};
inc.onReset(reset);
inc.onParamChange(reset);
inc.simulate((dt) => {
  [theta, omega] = inc.calc.rk4((t, y) => [y[1], (-model.g / model.L) * Math.sin(y[0])], 0, [theta, omega], dt);
});

// 110 stage units per metre from a pivot at (300, 40): the longest, widest swing still fits.
const S = 110;
const PX = 300;
const PY = 40;
const stage = inc.svg('#stage', { viewBox: [0, 0, 760, 420], title: 'Simple pendulum', description: 'A bob swings on a string under gravity, beside bars for its kinetic and potential energy. Pull the bob to a new angle and let go.' });
stage.line(PX - 50, PY, PX + 50, PY, { tone: 'mid' });
const swing = stage.path('', { tone: 'faint', dashed: true });
const string = stage.line(PX, PY, PX, PY, { tone: 'mid' });
const pull = stage.path('', { tone: 'c' });
const bob = stage.circle(PX, PY, 14, { tone: 'lit', fill: true, shade: 'sphere' });
const energy = stage.group();
const kinetic = stage.rect(640, 370, 40, 0, { tone: 'a', fill: true, parent: energy });
const potential = stage.rect(700, 370, 40, 0, { tone: 'b', fill: true, parent: energy });
stage.text(636, 392, 'kinetic', { tone: 'mid', parent: energy });
stage.text(696, 392, 'potential', { tone: 'mid', parent: energy });
// The small-angle period, written as it is on paper.
stage.equation(100, 64, 'T ≈ 2*pi*sqrt(L/g)', { size: 18 });
stage.drag(bob, (p) => {
  const angle = Math.atan2(p.x - PX, p.y - PY);
  side = angle < 0 ? -1 : 1;
  return { amplitude: (Math.abs(angle) * 180) / Math.PI };
}, { label: 'the bob' });

stage.part('Bob', bob, { label: 'Bob', info: 'Drag it to a new angle and let go.' });
stage.part('String', string, { label: 'String', info: 'Its length sets the period.' });
stage.part('Swing', swing, { label: 'Swing', info: 'The arc between the turning points.' });
stage.part('Gravity', pull, { label: 'Gravity', info: 'The pull on each kilogram, g.' });
stage.part('Energy', energy, { label: 'Energy', info: 'Kinetic and potential shares of a total that never changes.' });

inc.onFrame(() => {
  const R = model.L * S;
  const x = PX + R * Math.sin(theta);
  const y = PY + R * Math.cos(theta);
  swing.d(inc.path.arc(PX, PY, R, Math.PI / 2 - model.theta0, Math.PI / 2 + model.theta0));
  string.set({ x2: x, y2: y });
  bob.set({ cx: x, cy: y });
  pull.d(inc.path.arrow(x, y + 16, 0, model.g * 3));
  // Kinetic energy ½(Lω)² as a share of the total gL(1 − cos θ₀); potential is the rest.
  const k = Math.min(1, (0.5 * (model.L * omega) ** 2) / (model.g * model.L * (1 - Math.cos(model.theta0))));
  kinetic.set({ y: 370 - 220 * k, height: 220 * k });
  potential.set({ y: 150 + 220 * k, height: 220 * (1 - k) });
});

inc.readout({
  Period: () => `${model.period.toFixed(2)} s`,
  'Small-angle period': () => `${model.small.toFixed(2)} s`,
  'Top speed': () => `${model.top.toFixed(2)} m/s`,
});

inc.explain(
  () =>
    `One full swing takes ${model.period.toFixed(2)} s, ${((model.period / model.small - 1) * 100).toFixed(1)}% longer than the small-angle value 2π√(L/g) = ${model.small.toFixed(2)} s, because the pull back grows more slowly than the angle.`,
);

inc.describe(
  () =>
    `A pendulum ${model.L.toFixed(1)} m long swings ${amplitude.value.toFixed(0)}° each side under gravity of ${model.g.toFixed(1)} m/s², taking ${model.period.toFixed(2)} s per swing and reaching ${model.top.toFixed(2)} m/s at the bottom.`,
);

inc.steps([
  { say: 'A longer string swings more slowly: the period grows with the square root of the length.', focus: 'String', set: { length: 2.5 } },
  { say: 'Weaker gravity, as on the Moon, slows the swing too.', focus: 'Gravity', set: { length: 1.5, gravity: 1.6 } },
  { say: 'Wide swings take longer than the small-angle formula says.', focus: 'Swing', set: { gravity: 9.8, amplitude: 80 } },
  { say: 'Energy turns from potential at the ends to kinetic at the bottom and back; the total stays.', focus: 'Energy' },
]);

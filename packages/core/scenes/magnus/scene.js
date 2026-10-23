// The Magnus effect: a spinning cylinder in a wind, as potential flow with circulation.
inc.idea('A spinning cylinder in a wind drags the air round with it, so the air flows faster on one side than the other, and the pressure difference lifts it: the lift per metre is ρUΓ.');

const wind = inc.param('wind', { min: 2, max: 30, step: 0.5, value: 15, label: 'Wind speed', unit: 'm/s' });
const spin = inc.param('spin', { min: -20, max: 20, step: 0.5, value: 0, label: 'Spin', unit: 'rev/s' });

// A cylinder of radius 0.11 m in air; positive spin turns its top with the wind.
const A = 0.11;
const RHO = 1.2;
const model = inc.model(({ wind: U, spin: n }) => {
  const surface = 2 * Math.PI * n * A;
  // Circulation round the cylinder, positive when the top turns with the wind: Γ = 2πa × its surface speed.
  const gamma = 2 * Math.PI * A * surface;
  // Where the flow stops on the surface: sin θ = Γ / (4πUa), below the middle when the cylinder lifts.
  const s = gamma / (4 * Math.PI * U * A);
  return { U, surface, gamma, lift: RHO * U * gamma, s };
});

// 500 stage units per metre, the cylinder in the middle; the flow is shown 6 units a second for each metre a second.
const SCALE = 500;
const CX = 320;
const CY = 180;
const R = A * SCALE;
const SHOW = 6;
const stage = inc.svg('#stage', {
  viewBox: [0, 0, 640, 360],
  title: 'A spinning cylinder in a wind',
  description: 'Air streams past a cylinder from left to right. Spinning the cylinder drags the air round with it: the streaks crowd and speed up on one side, a lift arrow shows the force, and dots mark where the flow stops.',
});
stage.fluid(
  (x, y) => {
    const dx = (x - CX) / SCALE;
    const dy = (CY - y) / SCALE;
    const r2 = dx * dx + dy * dy;
    if (r2 < A * A) return [NaN, NaN];
    // u − iv = U(1 − a²/z²) + iΓ/(2πz), the flow round the cylinder with the top turning with the wind.
    const k = (A * A) / (r2 * r2);
    const u = model.U * (1 - k * (dx * dx - dy * dy)) + (model.gamma * dy) / (2 * Math.PI * r2);
    const v = -model.U * 2 * k * dx * dy - (model.gamma * dx) / (2 * Math.PI * r2);
    return [u * SHOW, -v * SHOW];
  },
  { count: 650, trail: 0.7, tone: 'b', life: 6 },
);
const body = stage.circle(CX, CY, R, { tone: 'mid', fill: true, shade: 'sphere' });
const mark = stage.line(CX, CY, CX + R, CY, { tone: 'lo' });
const turn = stage.path('', { tone: 'lit' });
const stopping = stage.group();
const stops = [stage.circle(CX - R, CY, 5, { tone: 'lit', fill: true, parent: stopping }), stage.circle(CX + R, CY, 5, { tone: 'lit', fill: true, parent: stopping })];
const lift = stage.path('', { tone: 'a' });
// The wind coming in, as long as it is fast.
const gusts = stage.group();
const arrows = [0, 1, 2].map(() => stage.path('', { tone: 'c', parent: gusts }));
stage.equation(70, 40, "L' = ρ*U*Γ", { size: 18 });

stage.part('Cylinder', body, { label: 'Cylinder', info: 'Its spin drags the air round with it.' });
stage.part('Spin', turn, { label: 'Spin', info: 'Which way the cylinder turns.' });
stage.part('Stagnation', stopping, { label: 'Stagnation points', info: 'Where the flow stops.' });
stage.part('Lift', lift, { label: 'Lift', info: 'The force across the wind, ρUΓ for each metre of cylinder.' });
stage.part('Wind', gusts, { label: 'Wind', info: 'The air coming in, before the cylinder turns it.' });

let angle = 0;
inc.onFrame(({ dt }) => {
  arrows.forEach((arrow, i) => arrow.d(inc.path.arrow({ from: [16, 90 * (i + 1)], by: [model.U * 2.5, 0] }, 8)));
  // The mark turns at the cylinder's spin, slowed down like the flow; on the stage, clockwise for positive spin.
  angle += (2 * Math.PI * spin.value * dt * SHOW) / 40;
  mark.set({ x2: CX + R * Math.cos(angle), y2: CY + R * Math.sin(angle) });
  // An arrow round the cylinder in the direction it spins: clockwise on the stage for positive spin.
  const sign = spin.value >= 0 ? 1 : -1;
  if (spin.value === 0) turn.d('');
  else {
    const start = -Math.PI / 2 - sign * 0.9;
    const end = -Math.PI / 2 + sign * 0.9;
    const ex = CX + (R + 14) * Math.cos(end);
    const ey = CY + (R + 14) * Math.sin(end);
    turn.d(`${inc.path.arc(CX, CY, R + 14, Math.min(start, end), Math.max(start, end))}${inc.path.arrow({ from: [ex, ey], by: [-sign * 8 * Math.sin(end), sign * 8 * Math.cos(end)] }, 7)}`);
  }
  // Stagnation points: on the surface while |sin θ| ≤ 1, below the middle when the cylinder lifts; one point off the surface beyond.
  if (Math.abs(model.s) <= 1) {
    const theta = -Math.asin(model.s);
    stops[0].set({ cx: CX - R * Math.cos(theta), cy: CY - R * Math.sin(theta) });
    stops[1].set({ cx: CX + R * Math.cos(theta), cy: CY - R * Math.sin(theta) });
    stops[0].show();
    stops[1].show();
  } else {
    // One point off the surface, on the far side from the lift, at r = a(|s| + √(s² − 1)): shown while it is on the stage.
    const r = A * SCALE * (Math.abs(model.s) + Math.sqrt(model.s * model.s - 1));
    stops[0].set({ cx: CX, cy: CY + Math.sign(model.s) * Math.min(r, 170) });
    stops[0].show(r <= 170);
    stops[1].hide();
  }
  // Lift drawn 1 stage unit per newton per metre, up for positive lift.
  const length = Math.max(-150, Math.min(150, model.lift));
  lift.d(Math.abs(length) < 2 ? '' : inc.path.arrow({ from: [CX, CY], by: [0, -length] }, 10));
});

inc.readout({
  Circulation: () => `${model.gamma.toFixed(2)} m²/s`,
  'Lift per metre': () => `${model.lift.toFixed(0)} N/m`,
  'Surface speed': () => `${Math.abs(model.surface).toFixed(1)} m/s`,
});

inc.explain(() =>
  model.gamma === 0
    ? 'Without spin the flow is the same above and below, so the pressures balance and there is no lift.'
    : `Spinning at ${Math.abs(spin.value)} revolutions a second, the surface moves at ${Math.abs(model.surface).toFixed(1)} m/s and drags the air round: the flow is faster ${model.gamma > 0 ? 'over the top' : 'underneath'}, the pressure lower there, and the lift ρUΓ is ${Math.abs(model.lift).toFixed(0)} N for each metre of cylinder, ${model.gamma > 0 ? 'upwards' : 'downwards'}.`,
);

inc.describe(
  () =>
    `Air at ${model.U.toFixed(1)} m/s streams past a cylinder of radius 11 cm spinning at ${spin.value} revolutions a second. The circulation is ${model.gamma.toFixed(2)} m²/s and the lift ${model.lift.toFixed(0)} N per metre.`,
);

inc.steps([
  { say: 'Without spin the air parts evenly round the cylinder and meets again behind it: there is no lift.', focus: 'Stagnation', set: { spin: 0, wind: 15 } },
  { say: 'Spin the top with the wind: the air is dragged faster over the top and slower underneath, so the pressure is lower on top and the cylinder is lifted.', focus: 'Lift', set: { spin: 8 } },
  { say: 'A faster wind lifts it harder: the lift grows with the wind speed and with the circulation.', focus: 'Lift', set: { wind: 30 } },
  { say: 'Spin it the other way and the lift turns round.', focus: 'Spin', set: { spin: -8, wind: 15 } },
  { say: 'Spin fast enough and the two points where the flow stops meet, then leave the surface.', focus: 'Stagnation', set: { spin: 20, wind: 8 } },
]);

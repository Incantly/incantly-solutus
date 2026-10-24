// Projectile motion: launch speed, angle and gravity, with the velocity split into its two parts.
inc.idea('A thrown ball keeps its horizontal speed while gravity changes its vertical speed, so its path is a parabola.');

const speed = inc.param('speed', { min: 5, max: 20, step: 0.5, value: 18, label: 'Launch speed', unit: 'm/s' });
const angle = inc.param('angle', { min: 10, max: 80, step: 1, value: 45, label: 'Launch angle', unit: 'degrees' });
const gravity = inc.param('gravity', { min: 5, max: 20, step: 0.1, value: 9.8, label: 'Gravity', unit: 'm/s²', note: "From half to twice Earth's gravity." });

const model = inc.model(({ speed: v, angle: degrees, gravity: g }) => {
  const radians = (degrees * Math.PI) / 180;
  const vx = v * Math.cos(radians);
  const vy = v * Math.sin(radians);
  const flight = (2 * vy) / g;
  return {
    vx,
    vy,
    flight,
    range: vx * flight,
    peak: (vy * vy) / (2 * g),
    peakTime: vy / g,
    x: (t) => vx * t,
    y: (t) => vy * t - (g * t * t) / 2,
    vyAt: (t) => vy - g * t,
  };
});

// Equal scales on both axes, so the launch angle looks the way it is.
const graph = inc.graph2d('#stage', {
  x: [0, 86],
  y: [0, 40],
  title: 'Projectile path',
  description: 'A ball launched from the origin flies along a parabola and lands on the ground to the right. Drag the launch arrow to aim.',
  labels: { x: 'distance (m)', y: 'height (m)' },
});

// The path over the whole flight: u runs from launch (0) to landing (1).
const path = graph.parametric((u) => model.x(u * model.flight), (u) => model.y(u * model.flight), 0, 1, { tone: 'mid', samples: 120 });
const peak = graph.segment(0, 0, 0, 0, { tone: 'c', dashed: true });
const ball = graph.point(0, 0, { tone: 'lit', r: 7 });
const aim = graph.arrow(0, 0, 1, 1, { tone: 'hi' });
const horizontal = graph.arrow(0, 0, 1, 0, { tone: 'a' });
const vertical = graph.arrow(0, 0, 0, 1, { tone: 'b' });
// The aim arrow is the launch velocity, one metre per m/s: dragging its tip sets speed and angle.
graph.drag(aim, (p) => ({ speed: Math.hypot(p.x, p.y), angle: (Math.atan2(p.y, p.x) * 180) / Math.PI }), { label: 'the launch arrow' });

graph.stage.part('Path', path.handle, { label: 'Path', info: 'The parabola the ball follows.' });
graph.stage.part('Ball', ball.handle, { label: 'Ball', info: 'Where the ball is now.' });
graph.stage.part('Launch velocity', aim.handle, { label: 'Launch velocity', info: 'Speed and direction at launch. Drag its tip to aim.' });
graph.stage.part('Horizontal velocity', horizontal.handle, { label: 'Horizontal velocity', info: 'The sideways part of the velocity. Its length never changes.' });
graph.stage.part('Vertical velocity', vertical.handle, { label: 'Vertical velocity', info: 'The upward part. Gravity shrinks it, then reverses it.' });
graph.stage.part('Peak', peak.handle, { label: 'Peak', info: 'The highest point, where the vertical velocity is zero.' });

// Velocity arrows show how far the ball would go in 0.4 s; the ball rests 0.8 s before the next throw.
const ARROW = 0.4;
const REST = 0.8;

inc.onFrame(({ time }) => {
  const t = Math.min(time % (model.flight + REST), model.flight);
  const x = model.x(t);
  const y = Math.max(0, model.y(t));
  ball.at(x, y);
  aim.from(0, 0, model.vx, model.vy);
  horizontal.from(x, y, model.vx * ARROW, 0);
  vertical.from(x, y, 0, model.vyAt(t) * ARROW);
  peak.between(model.vx * model.peakTime, 0, model.vx * model.peakTime, model.peak);
});

inc.readout({
  Range: () => `${model.range.toFixed(1)} m`,
  'Peak height': () => `${model.peak.toFixed(1)} m`,
  'Time in the air': () => `${model.flight.toFixed(2)} s`,
});

inc.explain(
  () =>
    `The ball keeps a horizontal speed of ${model.vx.toFixed(1)} m/s all the way, while gravity slows its climb, stops it at ${model.peak.toFixed(1)} m and brings it back down after ${model.flight.toFixed(2)} s, ${model.range.toFixed(1)} m from where it started.`,
);

inc.describe(
  () =>
    `A ball launched at ${speed.value.toFixed(1)} m/s and ${angle.value.toFixed(0)} degrees, under gravity of ${gravity.value.toFixed(1)} m/s², rises to ${model.peak.toFixed(1)} m and lands ${model.range.toFixed(1)} m away after ${model.flight.toFixed(2)} s.`,
);

inc.steps([
  { say: 'The horizontal part of the velocity never changes, because nothing pushes the ball sideways.', focus: 'Horizontal velocity' },
  { say: 'Gravity shrinks the vertical part on the way up and grows it again on the way down.', focus: 'Vertical velocity' },
  { say: 'At the top the vertical part is zero for an instant: that moment is the peak.', focus: 'Peak' },
  { say: 'Stronger gravity pulls the same throw down sooner, so it lands closer.', focus: 'Path', set: { gravity: 16 } },
]);

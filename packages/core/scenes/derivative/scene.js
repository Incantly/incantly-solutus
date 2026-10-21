// Derivative as slope: a secant through two points of a curve turns into the tangent as the gap closes.
inc.idea('The derivative at a point is the slope of the tangent there: the value the slopes of secant lines approach as their second point slides in.');

const x0 = inc.param('x0', { min: -3, max: 3, step: 0.05, value: 1.5, label: 'Point x₀' });
const h = inc.param('h', { min: 0.05, max: 2, step: 0.05, value: 1.5, label: 'Gap h' });
// The learner can edit the function; everything below follows it.
const f = inc.formula('x^3/12 - x', { editable: true, label: 'f(x)' });

const model = inc.model(({ x0: a, h: gap }) => {
  const y = f(a);
  const yb = f(a + gap);
  return { a, gap, y, b: a + gap, yb, secant: (yb - y) / gap, slope: inc.calc.derivative(f, a) };
});

const BOX = [-3.5, -3, 7, 6];
const graph = inc.graph2d('#stage', {
  x: [-3.5, 3.5],
  y: [-3, 3],
  title: 'Derivative as slope',
  description: 'A curve with a point on it, its tangent, a secant to a second point h along, and a dashed curve of the slope at every x. Drag either point.',
});
const curve = graph.plot(f, { tone: 'mid' });
const slopes = graph.plot((x) => inc.calc.derivative(f, x), { tone: 'c', dashed: true });
const tangent = graph.segment(0, 0, 0, 0, { tone: 'lit' });
const secant = graph.segment(0, 0, 0, 0, { tone: 'a' });
const run = graph.segment(0, 0, 0, 0, { tone: 'a', dashed: true });
const rise = graph.segment(0, 0, 0, 0, { tone: 'a', dashed: true });
const rate = graph.point(0, 0, { tone: 'c', r: 5 });
const point = graph.point(0, 0, { tone: 'lit', r: 8 });
const second = graph.point(0, 0, { tone: 'a', r: 6 });
graph.drag(point, (p) => ({ x0: p.x }), { label: 'the point' });
graph.drag(second, (p) => ({ h: p.x - model.a }), { label: 'the second point' });

graph.stage.part('Curve', curve.handle, { label: 'Curve', info: 'y = f(x). Edit the formula to try another.' });
graph.stage.part('Point', point.handle, { label: 'Point', info: 'Where the slope is measured. Drag it along the curve.' });
graph.stage.part('Secant', secant.handle, { label: 'Secant', info: 'Through the point and a second point h further along.' });
graph.stage.part('Tangent', tangent.handle, { label: 'Tangent', info: 'Touches the curve at the point; its slope is the derivative.' });
graph.stage.part('Slope curve', slopes.handle, { label: 'Slope curve', info: 'f′(x): the tangent’s slope at every x.' });

// A line through (x, y) with slope m, clipped to the graph.
const line = (segment, x, y, m) => {
  const s = inc.geom.clipLine(inc.geom.point(x, y), inc.geom.point(x + 1, y + m), BOX);
  segment.show(s !== null);
  if (s) segment.between(s.from.x, s.from.y, s.to.x, s.to.y);
};

inc.onFrame(() => {
  const { a, y, b, yb } = model;
  line(tangent, a, y, model.slope);
  line(secant, a, y, model.secant);
  run.between(a, y, b, y);
  rise.between(b, y, b, yb);
  point.at(a, y);
  second.at(b, yb);
  rate.at(a, model.slope);
  // Past the right edge, hide the second point and its triangle.
  for (const item of [second, run, rise]) item.show(b <= 3.5);
});

inc.readout({
  'Secant slope': () => model.secant.toFixed(3),
  'Tangent slope f′(x₀)': () => model.slope.toFixed(3),
});

inc.explain(
  () =>
    `Over a run of ${model.gap.toFixed(2)} the curve changes by ${(model.yb - model.y).toFixed(3)}, a secant slope of ${model.secant.toFixed(3)}. The tangent's slope, the derivative at x₀ = ${model.a.toFixed(2)}, is ${model.slope.toFixed(3)}: what the secant's slope approaches as h shrinks.`,
);

inc.describe(
  () =>
    `The curve y = ${f.source} with a point at x = ${model.a.toFixed(2)} where the tangent has slope ${model.slope.toFixed(3)}, and a secant to x = ${model.b.toFixed(2)} with slope ${model.secant.toFixed(3)}.`,
);

// Where the curve turns, for the last step: the first turning point of f.
const turn = inc.calc.extrema(f, -3, 3)[0]?.x ?? 0;
inc.steps([
  { say: 'The secant joins two points of the curve: its slope is the rise over the run.', focus: 'Secant' },
  { say: 'Shrink the gap and the second point slides in: the secant turns into the tangent.', focus: 'Tangent', set: { h: 0.05 } },
  { say: 'The derivative is the tangent’s slope. The dashed slope curve plots it for every x.', focus: 'Slope curve' },
  { say: 'Where the tangent is level the derivative is zero, and the curve turns.', focus: 'Point', set: { x0: turn } },
]);

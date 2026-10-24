// Normal distribution of exam scores: the mean moves the bell, σ widens it, and a band of ±k σ holds a fixed share.
inc.idea('The mean sets where a normal curve is centred and the standard deviation how wide it is, and the share within k standard deviations of the mean never changes.');

const mean = inc.param('mean', { min: 40, max: 80, step: 1, value: 60, label: 'Mean μ', unit: 'points' });
const sd = inc.param('sd', { min: 4, max: 15, step: 0.5, value: 10, label: 'Standard deviation σ', unit: 'points' });
const k = inc.param('k', { min: 0.5, max: 3, step: 0.1, value: 1, label: 'Band half-width', unit: 'σ' });

const { normal, normalCdf } = inc.calc;
const model = inc.model(({ mean: m, sd: s, k: n }) => {
  const share = normalCdf(m + n * s, m, s) - normalCdf(m - n * s, m, s);
  // bend: the curve turns from hill to tail one σ from the mean.
  return { m, s, n, lo: m - n * s, hi: m + n * s, share, above: (1 - share) / 2, peak: normal(m, m, s), bend: normal(m + s, m, s) };
});
const percent = (x) => `${(x * 100).toFixed(1)}%`;

const graph = inc.graph2d('#stage', {
  x: [0, 100],
  y: [0, 0.11],
  title: 'Exam scores',
  description: 'A bell curve of exam scores with the area within k standard deviations of the mean shaded. Drag the point on the axis to move the mean.',
  labels: { x: 'score (points)', y: 'probability density' },
});
const pdf = (x) => normal(x, model.m, model.s);
// The band is drawn inside the graph; its share is the whole band's.
const band = graph.area(pdf, () => Math.max(0, model.lo), () => Math.min(100, model.hi), { tone: 'b' });
const curve = graph.plot(pdf, { tone: 'lit' });
const centre = graph.segment(0, 0, 0, 0, { tone: 'mid', dashed: true });
const sigma = graph.dimension(0, 0, 1, 0, 'σ', { tone: 'a' });
const share = graph.label(0, 0, '').set({ 'text-anchor': 'middle' });
const handle = graph.handle({ x: 'mean', y: 0, label: 'the mean' });

graph.stage.part('Curve', curve.handle, { label: 'Normal curve', info: 'Probability density: the area under it is 1.' });
graph.stage.part('Band', band.handle, { label: 'Band', info: 'Every score within k standard deviations of the mean.' });
graph.stage.part('Mean', handle.handle, { label: 'Mean', info: 'The centre of the bell. Drag it.' });
graph.stage.part('Standard deviation', sigma.handle, { label: 'Standard deviation', info: 'From the mean to where the curve bends.' });

inc.onFrame(() => {
  centre.between(model.m, model.bend, model.m, model.peak);
  sigma.between(model.m, model.bend, model.m + model.s, model.bend);
  share.text(percent(model.share)).set({ x: graph.toX(model.m), y: graph.toY(model.bend * 0.4) });
});

inc.readout({
  'Inside the band': () => percent(model.share),
  Band: () => `${model.lo.toFixed(1)} to ${model.hi.toFixed(1)} points`,
  'Above the band': () => percent(model.above),
});

inc.explain(
  () =>
    `Within ${model.n.toFixed(1)} standard deviations of the mean, from ${model.lo.toFixed(1)} to ${model.hi.toFixed(1)} points, lie ${percent(model.share)} of the scores and ${percent(model.above)} lie above. Those shares depend only on k, not on where the bell sits or how wide it is.`,
);

inc.describe(
  () =>
    `A normal curve of exam scores with mean ${model.m.toFixed(0)} and standard deviation ${model.s.toFixed(1)} points; the shaded band from ${model.lo.toFixed(1)} to ${model.hi.toFixed(1)} holds ${percent(model.share)} of the scores.`,
);

const within = (n) => percent(normalCdf(n) - normalCdf(-n));
inc.steps([
  { say: `Within one standard deviation of the mean lie ${within(1)} of the scores.`, focus: 'Band', set: { k: 1 } },
  { say: `Within two lie ${within(2)}.`, focus: 'Band', set: { k: 2 } },
  { say: `Within three lie ${within(3)}: almost all of them.`, focus: 'Band', set: { k: 3 } },
  { say: 'A bigger standard deviation spreads the bell wider and lower, yet each band keeps its share.', focus: 'Standard deviation', set: { sd: 14 } },
  { say: 'The mean slides the whole bell without changing its shape.', focus: 'Mean', set: { mean: 72 } },
]);

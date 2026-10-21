// Sine wave: amplitude, frequency and phase, with an animated trace.
inc.idea('Amplitude sets how tall a sine wave is; frequency sets how often it repeats.');

const A = inc.param('amplitude', { min: 0.5, max: 4, step: 0.1, value: 2, label: 'Amplitude' });
const w = inc.param('frequency', { min: 0.5, max: 4, step: 0.1, value: 1, label: 'Frequency', unit: 'rad per unit' });
const phi = inc.param('phase', { min: 0, max: 6.28, step: 0.01, value: 0, label: 'Phase', unit: 'rad' });

const model = inc.model(({ amplitude, frequency, phase }) => ({
  amplitude,
  frequency,
  phase,
  period: (2 * Math.PI) / frequency,
}));

// The authored formula stays visible; t is scene time, so the wave travels right.
const wave = inc.formula('A*sin(w*x + phi - t)', { vars: { A, w, phi } });

const graph = inc.graph2d('#stage', {
  x: [-7, 7],
  y: [-5, 5],
  title: 'Sine wave',
  description: 'The curve y = A sin(w x + phi - t) across the graph, with a marker riding the wave on the y axis.',
  labels: { x: 'x', y: 'y' },
});

const curve = graph.plot(wave, { tone: 'lit' });
const upper = graph.segment(-7, 2, 7, 2, { tone: 'b', dashed: true });
const lower = graph.segment(-7, -2, 7, -2, { tone: 'b', dashed: true });
const period = graph.segment(0, -4.4, 6.28, -4.4, { tone: 'c' });
const marker = graph.point(0, 0, { tone: 'hi' });

graph.stage.part('Wave', curve.handle, { label: 'The wave', info: 'Its shape repeats every period.' });
graph.stage.part('Amplitude', upper.handle, { label: 'Amplitude guide', info: 'The crest height above the axis.' });
graph.stage.part('Period', period.handle, { label: 'One period', info: 'The length of one full wave.' });
graph.stage.part('Marker', marker.handle, { label: 'Marker', info: 'The height of the wave at x = 0.' });

inc.onFrame(({ time }) => {
  upper.between(-7, model.amplitude, 7, model.amplitude);
  lower.between(-7, -model.amplitude, 7, -model.amplitude);
  period.between(0, -4.4, Math.min(model.period, 7), -4.4);
  marker.at(0, wave(0, time));
});

inc.readout({
  Amplitude: () => model.amplitude.toFixed(1),
  Period: () => model.period.toFixed(2) + ' units',
});

inc.explain(
  () =>
    'The wave peaks at ' +
    model.amplitude.toFixed(1) +
    ' and repeats every ' +
    model.period.toFixed(2) +
    ' units, so ' +
    (14 / model.period).toFixed(1) +
    ' waves fit across the graph.',
);

inc.describe(
  () =>
    'A sine wave with amplitude ' +
    model.amplitude.toFixed(1) +
    ', period ' +
    model.period.toFixed(2) +
    ' units and phase ' +
    model.phase.toFixed(2) +
    ' radians, travelling to the right.',
);

inc.steps([
  { say: 'The height of each crest above the axis is the amplitude.', focus: 'Amplitude', set: { amplitude: 3 } },
  { say: 'Higher frequency packs more waves in, so each period gets shorter.', focus: 'Period', set: { frequency: 2 } },
  { say: 'Phase slides the whole wave sideways without changing its shape.', focus: 'Wave', set: { phase: 1.57 } },
]);

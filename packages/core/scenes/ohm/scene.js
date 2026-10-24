// Ohm's law: a battery drives a current through a resistor, and an ammeter reads it.
inc.idea('Current is voltage divided by resistance: more voltage pushes more current round a circuit, and more resistance lets less through.');

const voltage = inc.param('voltage', { min: 1, max: 12, step: 0.5, value: 6, label: 'Voltage', unit: 'V' });
const resistance = inc.param('resistance', { min: 2, max: 20, step: 0.5, value: 4, label: 'Resistance', unit: 'Ω' });
inc.idle({ sweep: 'voltage' });

// I = V / R, and the resistor turns P = V I into heat.
const model = inc.model(({ voltage: V, resistance: R }) => ({ V, R, I: V / R, P: (V * V) / R }));

const stage = inc.svg('#stage', {
  viewBox: [30, 20, 560, 280],
  title: "Ohm's law circuit",
  description: 'A battery on the left drives a current round one loop, through a resistor at the top and an ammeter on the right. Dashes on the wires move with the current. Drag the knob above the resistor to change its resistance.',
});

// Wires follow the conventional current, clockwise from the battery's + terminal at the top.
const wires = stage.path('M110 120V80H230M370 80H490V150M490 200V270H110V230', { tone: 'mid' });
const glow = stage.rect(222, 62, 156, 36, { tone: 'lit' }).set({ rx: 18 });
const resistor = stage.path(inc.shapes.zigzag(230, 80, 370, 80, { teeth: 7, width: 10 }), { tone: 'hi' });
const battery = stage.path(inc.shapes.battery(110, 120, 110, 230, { cells: 2 }), { tone: 'hi' });
const ammeter = stage.group();
stage.path('M515 175a25 25 0 1 0 -50 0a25 25 0 1 0 50 0', { tone: 'hi', parent: ammeter });
stage.text(490, 180, 'A', { tone: 'hi', parent: ammeter }).set({ 'text-anchor': 'middle' });
const vText = stage.text(88, 180, '', { tone: 'hi' }).set({ 'text-anchor': 'end' });
const rText = stage.text(300, 122, '', { tone: 'hi' }).set({ 'text-anchor': 'middle' });
const iText = stage.text(526, 181, '', { tone: 'lit' });
// The rheostat knob: where it sits along the resistor sets the resistance.
stage.line(230, 44, 370, 44, { tone: 'faint' });
const knob = stage.circle(230, 44, 8, { tone: 'lit', fill: true });
stage.drag(knob, (p) => ({ resistance: 2 + (18 * (p.x - 230)) / 140 }), { label: 'the resistor knob' });

stage.part('Battery', battery, { label: 'Battery', info: 'Its voltage pushes charge round the loop.' });
stage.part('Resistor', resistor, { label: 'Resistor', info: 'It resists the current and turns energy into heat. Drag the knob to change it.' });
stage.part('Ammeter', ammeter, { label: 'Ammeter', info: 'It measures the current in the loop.' });
stage.part('Current', wires, { label: 'Current', info: 'The moving dashes: the faster they go, the bigger the current.' });

inc.onFrame(() => {
  wires.flow(30 * model.I);
  glow.set({ opacity: Math.min(0.45, model.P / 30) });
  knob.set({ cx: 230 + (140 * (model.R - 2)) / 18 });
  vText.text(`${model.V.toFixed(1)} V`);
  rText.text(`${model.R.toFixed(1)} Ω`);
  iText.text(`${model.I.toFixed(2)} A`);
});

inc.readout({ Current: () => `${model.I.toFixed(2)} A`, Power: () => `${model.P.toFixed(1)} W` });

inc.explain(
  () =>
    `I = V / R: ${model.V.toFixed(1)} V across ${model.R.toFixed(1)} Ω drives ${model.I.toFixed(2)} A round the loop, and the resistor turns ${model.P.toFixed(1)} W into heat.`,
);

inc.describe(
  () =>
    `A ${model.V.toFixed(1)} V battery, a ${model.R.toFixed(1)} Ω resistor and an ammeter in one loop. The ammeter reads ${model.I.toFixed(2)} A and the resistor gives off ${model.P.toFixed(1)} W of heat.`,
);

inc.steps([
  { say: 'The current is the voltage divided by the resistance: I = V / R.', focus: 'Ammeter', set: { voltage: 6, resistance: 4 } },
  { say: 'Double the voltage and the current doubles.', focus: 'Battery', set: { voltage: 12 } },
  { say: 'Four times the resistance lets only a quarter of the current through.', focus: 'Resistor', set: { resistance: 16 } },
  { say: 'The resistor turns electrical energy into heat at a rate P = V I.', focus: 'Resistor' },
]);

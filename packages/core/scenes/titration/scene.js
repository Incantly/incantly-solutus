// Titration: the pH of a strong acid as strong base is added, with its equivalence point.
inc.idea('Adding base to an acid barely changes the pH until the acid is almost used up, then the pH leaps through 7 at the equivalence point.');

const acid = inc.param('acid', { min: 0.05, max: 0.2, step: 0.01, value: 0.1, label: 'Acid concentration', unit: 'mol/L' });
const base = inc.param('base', { min: 0.05, max: 0.2, step: 0.01, value: 0.1, label: 'Base concentration', unit: 'mol/L' });
const added = inc.param('added', { min: 0, max: 50, step: 0.1, value: 15, label: 'Base added', unit: 'mL' });
inc.idle({ sweep: 'added' });

// 25 mL of acid in the flask. The charge balance gives [H+] from the excess acid per litre
// (negative once base is in excess) and water's own ions, Kw = 1e-14, so it is exact through equivalence.
const VA = 25;
const model = inc.model(({ acid: ca, base: cb, added: vb }) => {
  const pH = (v) => {
    const excess = (ca * VA - cb * v) / (VA + v);
    return -Math.log10((excess + Math.sqrt(excess * excess + 4e-14)) / 2);
  };
  return { pH, vb, now: pH(vb), start: pH(0), equivalence: (ca * VA) / cb };
});

const graph = inc.graph2d('#stage', {
  x: [0, 50],
  y: [0, 14],
  title: 'Titration curve',
  description: 'The pH of 25 mL of strong acid as strong base is added: it rises slowly, then leaps at the equivalence point, marked with a dashed line. Drag the point along the curve.',
  labels: { x: 'base added (mL)', y: 'pH' },
});

graph.segment(0, 7, 50, 7, { tone: 'faint', dashed: true });
const curve = graph.plot((v) => model.pH(v), { tone: 'mid' });
const equivalence = graph.segment(25, 0, 25, 14, { tone: 'c', dashed: true });
const mixture = graph.point(15, 1, { tone: 'lit', r: 7 });
graph.drag(mixture, (p) => ({ added: p.x }), { label: 'the point along the curve' });

graph.stage.part('Curve', curve.handle, { label: 'Titration curve', info: 'The pH after each volume of base.' });
graph.stage.part('Equivalence', equivalence.handle, { label: 'Equivalence point', info: 'Where the base added exactly cancels the acid.' });
graph.stage.part('Mixture', mixture.handle, { label: 'The mixture now', info: 'The pH in the flask after this much base. Drag it.' });

inc.onFrame(() => {
  mixture.at(model.vb, model.now);
  equivalence.show(model.equivalence <= 50).between(model.equivalence, 0, model.equivalence, 14);
});

const excess = () => (Math.abs(model.vb - model.equivalence) < 0.05 ? 'neither' : model.vb < model.equivalence ? 'acid' : 'base');
inc.readout({
  pH: () => model.now.toFixed(2),
  'Equivalence at': () => `${model.equivalence.toFixed(1)} mL`,
  'In excess': excess,
});

inc.explain(() =>
  model.vb < model.equivalence
    ? `Acid is still in excess, so the pH is only ${model.now.toFixed(2)}; it will leap once the last of the acid is used up, after ${model.equivalence.toFixed(1)} mL of base.`
    : `All the acid has been used up, so the extra base has raised the pH to ${model.now.toFixed(2)}; the leap came at ${model.equivalence.toFixed(1)} mL.`,
);

inc.describe(
  () =>
    `A titration curve: ${base.value.toFixed(2)} mol/L base added to 25 mL of ${acid.value.toFixed(2)} mol/L acid. The pH starts at ${model.start.toFixed(2)} and leaps through 7 at the equivalence point, ${model.equivalence.toFixed(1)} mL; the marked mixture has ${model.vb.toFixed(1)} mL of base and a pH of ${model.now.toFixed(2)}.`,
);

inc.steps([
  { say: 'While the acid is in excess, adding base barely moves the pH.', focus: 'Curve', set: { acid: 0.1, base: 0.1, added: 10 } },
  { say: 'Near the equivalence point, one more drop of base makes the pH leap.', focus: 'Mixture', set: { added: 24.8 } },
  { say: 'At equivalence the acid and base cancel exactly: for a strong acid and a strong base the pH is 7.', focus: 'Equivalence', set: { added: 25 } },
  { say: 'With stronger base, less of it is needed, so the equivalence point comes sooner.', focus: 'Equivalence', set: { base: 0.2 } },
]);

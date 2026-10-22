// Diffusion across a membrane: particles wander through its channels until the sides even out; a pump can push them back.
inc.idea('Particles spread from where they are crowded to where they are sparse, through the channels in a membrane, until both sides hold about the same number; only a pump, using energy, can push them the other way.');

const start = inc.param('start', { min: 40, max: 160, step: 10, value: 120, label: 'Particles on the left at the start' });
const open = inc.param('open', { min: 0, max: 1, step: 0.1, value: 1, label: 'Channels open' });
const pump = inc.param('pump', { min: 0, max: 8, step: 1, value: 0, label: 'Pump rate', unit: 'per second' });

const model = inc.model(({ start: n, open: p, pump: q }) => ({ n, p, q }));

const bio = inc.biology('#stage', {
  viewBox: [0, 0, 640, 320],
  title: 'Diffusion across a membrane',
  description: 'A box split down the middle by a membrane with three channel proteins in it. Particles wander on both sides and cross through the channels; the number on each side is shown at the top. A pump at the bottom can carry particles from left to right.',
});
const membrane = bio.membrane({ particles: [120, 0], channels: 3, permeability: 1, speed: 110, box: [10, 10, 620, 300] });
bio.stage.part('Membrane', membrane.handle, { label: 'Membrane', info: 'Particles cross it only through its channel proteins.' });

// A new start scatters the particles again; the channels and the pump change as the learner moves them.
inc.onParamChange((name) => {
  if (name === 'start') membrane.reset(model.n, 0);
  else membrane.set({ permeability: model.p, pump: model.q });
});
inc.onReset(() => membrane.reset(model.n, 0));

inc.readout({
  Left: () => `${membrane.left}`,
  Right: () => `${membrane.right}`,
  'Crossed so far': () => `${membrane.crossed}`,
});

inc.explain(() =>
  model.q > 0
    ? `The pump carries ${model.q} particles a second to the right, against the gradient, so the right side keeps gaining.`
    : model.p === 0
      ? 'With the channels shut, no particle can cross, so each side keeps what it has.'
      : membrane.left > membrane.right + 6
        ? `More particles on the left (${membrane.left}) than the right (${membrane.right}), so more wander across to the right than come back.`
        : `The sides are about even (${membrane.left} and ${membrane.right}): particles still cross both ways, but in equal numbers.`,
);

inc.describe(() => `${membrane.left} particles on the left and ${membrane.right} on the right; ${membrane.crossed} have crossed overall. The channels are ${Math.round(model.p * 100)}% open and the pump moves ${model.q} a second.`);

inc.steps([
  { say: 'All the particles start on the left. Press play and watch them spread.', focus: 'Membrane', set: { start: 120, open: 1, pump: 0 } },
  { say: 'Close the channels and nothing crosses, however crowded one side is.', set: { open: 0 } },
  { say: 'A pump uses energy to carry particles against the gradient, from fewer to more.', set: { open: 1, pump: 6 } },
]);

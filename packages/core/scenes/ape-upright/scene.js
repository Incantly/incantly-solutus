// An ape on all fours and on two legs: the kit grows it from its skeleton and tips it up to balance over its hips.
inc.idea('An ape walks on all fours, leaning on its knuckles, but its skeleton also lets it stand: its body tips up until it balances over its hips, and its arms hang free.');

inc.choice('posture', { options: ['On all fours', 'On two legs'], buttons: true, label: 'Posture' });
const speed = inc.param('speed', { min: 0, max: 3, step: 0.1, value: 1, unit: 'm/s', label: 'Speed' });
const model = inc.model(({ posture }) => ({ mode: posture === 1 ? 'bipedal' : 'quadruped' }));

const zoo = inc.anatomy('#stage', {
  viewBox: [0, 0, 800, 400],
  title: 'An ape on four legs and on two',
  description: 'An ape seen from the side, walking on the spot over a ground that slides under it, on its knuckles or upright.',
});
// A chimpanzee's bones, as fractions of its 0.85 m body: arms longer than its legs, a short face and no tail.
const ape = zoo.skeleton({
  size: 0.85,
  skull: { length: 0.2, depth: 0.9, snout: 0.25 },
  neck: { length: 0.07 },
  spine: { length: 0.6, flex: 0.2 },
  forelimb: { upper: 0.36, lower: 0.33, foot: 0.14, posture: 'digitigrade' },
  hindlimb: { upper: 0.28, lower: 0.26, foot: 0.16, posture: 'plantigrade' },
  tail: { length: 0 },
  modes: ['quadruped', 'bipedal'],
  at: [400, 360],
  width: 420,
});
ape.move({ speed, mode: () => model.mode });
zoo.part('Ape', ape, { label: 'Ape', info: 'Its posture, balance and gait are worked out from its skeleton.' });
zoo.part('Arms', ape.piece('forelimbs'), { label: 'Arms', info: 'Longer than its legs: on all fours it walks on its knuckles.' });
zoo.part('Legs', ape.piece('hindlimbs'), { label: 'Legs', info: 'Short for its body, so it stands with bent knees.' });
zoo.part('Back', ape.piece('body'), { label: 'Back', info: 'It tips up until the body balances over the hips.' });

inc.readout({
  Posture: () => (ape.mode === 'bipedal' ? 'two legs' : 'all fours'),
  Gait: () => ape.gait,
  'Hip height': () => `${ape.hipHeight.toFixed(2)} m`,
  'Strides a second': () => ape.frequency.toFixed(1),
});

inc.explain(() =>
  ape.mode === 'bipedal'
    ? `Upright, the ape balances over its hips with its arms hanging free, and ${ape.gait === 'stand' ? 'stands still' : `${ape.gait}s at ${speed.value.toFixed(1)} m/s`}.`
    : `On all fours the ape leans on the knuckles of its long arms, and ${ape.gait === 'stand' ? 'stands still' : `${ape.gait}s at ${speed.value.toFixed(1)} m/s`}.`,
);

inc.describe(() => `An ape ${ape.mode === 'bipedal' ? 'upright on two legs' : 'on all fours'}, ${ape.gait === 'stand' ? 'standing still' : `${ape.gait}ing at ${speed.value.toFixed(1)} m/s`}.`);

inc.steps([
  { say: 'On all fours, its long arms take the weight on its knuckles.', focus: 'Arms', set: { posture: 0, speed: 1 } },
  { say: 'Standing up, the body tips until it balances over the hips.', focus: 'Back', set: { posture: 1, speed: 0 } },
  { say: 'On two legs the arms hang free and swing as it walks.', focus: 'Arms', set: { posture: 1, speed: 1 } },
  { say: 'Its legs are short for its body, so it stands and walks with its knees bent.', focus: 'Legs' },
]);

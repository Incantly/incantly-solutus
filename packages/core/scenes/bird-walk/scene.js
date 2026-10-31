// A hen walking: the kit grows it from a bird's bones and balances its level body over its legs.
inc.idea('A bird walks on two legs with its body held level and leaning forward, so its weight sits over its feet; its head bobs as it steps to keep its eyes still.');

const speed = inc.param('speed', { min: 0, max: 3, step: 0.1, value: 0.8, unit: 'm/s', label: 'Speed' });

const zoo = inc.anatomy('#stage', {
  viewBox: [0, 0, 800, 400],
  title: 'A hen walking',
  description: 'A hen seen from the side, walking on the spot over a ground that slides under it.',
});

// A hen's bones, as fractions of its 0.4 m body: wings, no forelimb, long legs on its toes, a short stiff tail.
const hen = zoo.skeleton({
  size: 0.4,
  skull: { length: 0.17, depth: 0.8, snout: 0.2 },
  neck: { length: 0.24 },
  spine: { length: 0.45, flex: 0.1 },
  // Long foot bones, but a bird stands on its toes, not on hooves.
  hindlimb: { upper: 0.2, lower: 0.3, foot: 0.22, posture: 'digitigrade' },
  tail: { length: 0.22, stiffness: 0.9 },
  wings: true,
  tone: 'lit',
  at: [400, 360],
  width: 360,
});
hen.move({ speed });

// What makes it a hen: a beak, a red comb and wattle, a fan of tail feathers and a darker wing.
const beak = hen.skin('skull', { points: [[0.85, 0.02], [1.4, -0.1], [0.85, -0.18]], as: 'part', tone: 'b' });
hen.skin('skull', { points: [[0.25, 0.4], [0.35, 0.68], [0.45, 0.46], [0.56, 0.7], [0.66, 0.46], [0.75, 0.62], [0.82, 0.35]], as: 'part', tone: 'a' });
hen.skin('skull', { points: [[0.8, -0.16], [0.92, -0.5], [0.7, -0.3]], as: 'part', tone: 'a' });
hen.skin('tail', { points: [[0, 0.15], [0.5, 0.9], [1.1, 0.75], [1.0, -0.1], [0.2, -0.2]] });
const wing = hen.skin('wing', { points: [[0.05, 0.12], [0.85, 0.05], [1.05, -0.05], [0.25, -0.18]], as: 'mark', tone: 'hi' });

zoo.part('Hen', hen, { label: 'Hen', info: 'Its level body leans forward over its two legs.' });
zoo.part('Legs', hen.piece('hindlimbs'), { label: 'Legs', info: 'A bird walks on its toes; what looks like a backward knee is its ankle.' });
zoo.part('Wing', wing, { label: 'Wing', info: 'Folded along the body while it walks.' });
zoo.part('Head', beak, { label: 'Head', info: 'It bobs with each step to keep the eyes still.' });

inc.readout({
  Gait: () => hen.gait,
  'Strides a second': () => hen.frequency.toFixed(1),
  Stride: () => `${hen.stride.toFixed(2)} m`,
});

inc.explain(() => (hen.gait === 'stand' ? 'The hen stands with its weight over its feet.' : `At ${speed.value.toFixed(1)} m/s the hen ${hen.gait}s, ${hen.frequency.toFixed(1)} strides a second.`));

inc.describe(() => `A hen ${hen.gait === 'stand' ? 'standing' : `${hen.gait === 'run' ? 'running' : 'walking'}`} at ${speed.value.toFixed(1)} m/s.`);

inc.steps([
  { say: 'A bird carries its body level, leaning forward so its weight sits over its two feet.', focus: 'Hen', set: { speed: 0 } },
  { say: 'Walking, the legs step in turn; what looks like a backward knee is really the ankle.', focus: 'Legs', set: { speed: 0.8 } },
  { say: 'Faster, it runs: each foot is down for less of the stride.', focus: 'Legs', set: { speed: 2.5 } },
]);

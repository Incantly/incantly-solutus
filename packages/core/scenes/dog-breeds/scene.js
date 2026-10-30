// Two dog breeds on the same skeleton: the kit moves the bones, and each breed's look is skin drawn on them.
inc.idea("A German Shepherd and a Rottweiler share a dog's skeleton and gait; what tells them apart is drawn on top: ears, head shape, coat colour and markings, and the tail.");

const speed = inc.param('speed', { min: 0, max: 12, step: 0.1, value: 2, unit: 'm/s', label: 'Speed' });

const zoo = inc.anatomy('#stage', {
  viewBox: [0, 0, 1000, 380],
  title: 'Two breeds, one skeleton',
  description: 'A tan German Shepherd with a black saddle on the left and a black Rottweiler with tan points on the right, side by side, moving in step.',
});

// A dog's bones, as fractions of its 0.9 m body. Both breeds stand on these.
const bones = {
  size: 0.9,
  skull: { length: 0.24, depth: 0.5, snout: 0.5 },
  neck: { length: 0.2 },
  spine: { length: 0.56, flex: 0.45 },
  forelimb: { upper: 0.2, lower: 0.22, foot: 0.12 },
  hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14 },
  tail: { length: 0.45, stiffness: 0.5 },
};

// German Shepherd: tan, tall pointed ears, a long black muzzle, a black saddle and a bushy tail.
const shepherd = zoo.skeleton({ ...bones, tone: 'lit', at: [260, 330], width: 420 });
shepherd.move({ speed });
const shepherdEar = shepherd.skin('ear', { points: [[-0.2, -0.05], [-0.08, 0.6], [0.1, -0.02]], as: 'part', replace: true });
shepherd.skin('skull', { points: [[0.55, 0.08], [1.18, -0.04], [1.12, -0.24], [0.55, -0.3]] });
shepherd.skin('skull', { points: [[0.7, 0.06], [1.18, -0.04], [1.12, -0.24], [0.7, -0.28]], as: 'mark' });
const saddle = shepherd.skin('spine', { points: [[0.02, 0.07], [0.85, 0.07], [0.72, -0.2], [0.12, -0.24]], as: 'mark' });
shepherd.skin('tail', { points: [[0.05, 0.06], [0.55, 0.12], [1.05, 0], [0.55, -0.13], [0.05, -0.07]] });
shepherd.skin('tail', { points: [[0.3, 0.1], [1.05, 0], [0.4, -0.02]], as: 'mark' });

// Rottweiler: black, a broad round head, small folded ears, tan muzzle, brows, chest and feet, and a docked tail.
const rottweiler = zoo.skeleton({ ...bones, tone: 'hi', at: [740, 330], width: 420 });
rottweiler.move({ speed });
rottweiler.skin('skull', { at: [0.32, 0.05], r: [0.36, 0.32] });
rottweiler.skin('ear', { points: [[-0.12, 0.02], [0.14, 0.06], [0.1, -0.24]], as: 'part', replace: true });
rottweiler.skin('skull', { points: [[0.75, -0.1], [1.05, -0.12], [1.02, -0.3], [0.75, -0.32]], as: 'mark', tone: 'lit' });
rottweiler.skin('skull', { at: [0.55, 0.16], r: 0.05, as: 'mark', tone: 'lit' });
rottweiler.skin('tail', { at: [0.04, 0], r: 0.09, replace: true });
rottweiler.skin('forefoot', { at: [0.5, 0], r: [0.6, 0.35], as: 'mark', tone: 'lit' });
rottweiler.skin('hindfoot', { at: [0.5, 0], r: [0.6, 0.35], as: 'mark', tone: 'lit' });
rottweiler.skin('spine', { at: [0.95, -0.42], r: [0.08, 0.1], as: 'mark', tone: 'lit' });

zoo.part('Shepherd', shepherd, { label: 'German Shepherd', info: 'Tall ears, a long muzzle and a black saddle over tan.' });
zoo.part('Rottweiler', rottweiler, { label: 'Rottweiler', info: 'A broad head, folded ears and tan points on black.' });
zoo.part('Saddle', saddle, { label: 'Saddle', info: 'The black patch over a Shepherd’s back.' });
zoo.part('Ears', shepherdEar, { label: 'Ears', info: 'Upright on a Shepherd, folded on a Rottweiler.' });

inc.readout({
  Gait: () => shepherd.gait,
  Stride: () => `${shepherd.stride.toFixed(2)} m`,
  'Strides a second': () => shepherd.frequency.toFixed(1),
});

inc.explain(() => `Both dogs ${shepherd.gait === 'stand' ? 'stand' : `${shepherd.gait} at ${speed.value.toFixed(1)} m/s`} in step: the same bones give the same gait, whatever the coat.`);

inc.describe(() => `A German Shepherd and a Rottweiler side by side, ${shepherd.gait === 'stand' ? 'standing' : `${shepherd.gait}ing`} in step at ${speed.value.toFixed(1)} m/s.`);

inc.steps([
  { say: 'Under the coats, both dogs have the same skeleton.', focus: 'Shepherd', set: { speed: 0 } },
  { say: 'A German Shepherd has tall, upright ears and a black saddle over tan.', focus: 'Saddle' },
  { say: 'A Rottweiler has a broader head, folded ears, and tan points on black.', focus: 'Rottweiler' },
  { say: 'Same bones, same gait: at any speed they move in step.', focus: 'Shepherd', set: { speed: 6 } },
]);

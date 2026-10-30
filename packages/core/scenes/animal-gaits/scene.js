// A dog walking, trotting and galloping: the kit grows it from its skeleton and picks the gait from its speed.
inc.idea('As a dog speeds up it changes gait, from a walk to a trot to a gallop, at the same dimensionless speeds as animals of every size; its strides grow longer and each foot spends less of the stride on the ground.');

const speed = inc.param('speed', { min: 0, max: 14, step: 0.1, value: 3, unit: 'm/s', label: 'Speed' });
inc.choice('layer', { options: ['Skin', 'Muscles', 'Bones'], buttons: true, label: 'Show' });
const model = inc.model(({ layer }) => ({ show: ['skin', 'muscles', 'bones'][layer] }));

const zoo = inc.anatomy('#stage', {
  viewBox: [0, 0, 800, 380],
  title: 'A dog changing gait',
  description: 'A dog seen from the side, moving on the spot over a ground that slides under it.',
});
const dog = zoo.skeleton('dog', { at: [400, 330], width: 560 });
dog.move({ speed });
zoo.part('Dog', dog, { label: 'Dog', info: 'Its body, gait and stride are worked out from its skeleton and speed.' });
zoo.part('Hind legs', dog.piece('hindlimbs'), { label: 'Hind legs', info: 'The big thigh muscles drive the dog forward.' });
zoo.part('Front legs', dog.piece('forelimbs'), { label: 'Front legs', info: 'They catch the body and steer.' });
zoo.part('Spine', dog.piece('body'), { label: 'Back', info: 'At a gallop the back bends and stretches, adding to each stride.' });

let shown = 'skin';
inc.onFrame(() => {
  if (model.show !== shown) {
    shown = model.show;
    dog.show(shown);
  }
});

inc.readout({
  Gait: () => dog.gait,
  Stride: () => `${dog.stride.toFixed(2)} m`,
  'Strides a second': () => dog.frequency.toFixed(1),
  'Foot on the ground': () => `${Math.round(dog.duty * 100)}%`,
  'All feet off the ground': () => `${Math.round(dog.airborne * 100)}%`,
});

inc.explain(() =>
  dog.gait === 'stand'
    ? 'Standing still. Raise the speed to see it walk, then trot, then gallop.'
    : `At ${speed.value.toFixed(1)} m/s the dog ${dog.gait}s: strides of ${dog.stride.toFixed(2)} m, ${dog.frequency.toFixed(1)} a second, each foot down for ${Math.round(dog.duty * 100)}% of the stride.`,
);

inc.describe(() => `A dog ${dog.gait === 'stand' ? 'standing' : `${dog.gait}ing`} at ${speed.value.toFixed(1)} m/s, showing its ${model.show}.`);

inc.steps([
  { say: 'Walking, the feet land one at a time and two or three are always down.', focus: 'Dog', set: { speed: 1, layer: 0 } },
  { say: 'Faster, it trots: diagonal legs move together, front left with back right.', focus: 'Front legs', set: { speed: 3.5 } },
  { say: 'At a gallop the back bends and stretches, and for part of each stride no foot touches the ground.', focus: 'Spine', set: { speed: 11 } },
  { say: 'Under the skin, the biggest muscles sit high on the legs, near the body, so the legs stay light to swing.', focus: 'Hind legs', set: { speed: 4, layer: 1 } },
  { say: 'Every shape you see was worked out from these bones.', focus: 'Dog', set: { layer: 2 } },
]);

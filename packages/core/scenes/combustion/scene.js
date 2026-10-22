// Methane burning: its atoms rearrange as bonds break and form, beside the energy profile of the reaction.
inc.idea('Burning methane breaks C–H and O=O bonds, which takes energy in, then makes stronger C=O and O–H bonds, which gives out more, so the reaction releases energy.');

const progress = inc.param('progress', { min: 0, max: 1, step: 0.01, value: 0, label: 'Reaction progress' });
const activation = inc.param('activation', { min: 50, max: 400, step: 10, value: 250, label: 'Activation energy', unit: 'kJ/mol' });
inc.idle({ sweep: 'progress' });

const model = inc.model(({ progress: p, activation: ea }) => ({ p, ea, phase: p < 0.35 ? 'breaking' : p < 0.65 ? 'moving' : 'forming' }));

const chem = inc.chemistry('#stage', {
  viewBox: [0, 0, 760, 460],
  scale: 52,
  title: 'Methane burning in oxygen',
  description: 'Above, one methane molecule and two oxygen molecules break apart, and their atoms join again as carbon dioxide and two water molecules. Below, the energy profile of the reaction, with a ball at the current point.',
});

// The kit counts every bond broken and made, with average bond enthalpies, so the energies are computed, not typed.
const reaction = chem.reaction('CH4 + 2O2 -> CO2 + 2H2O', { box: [0, 0, 760, 250] });
const energy = reaction.energy;
const profile = chem.profile({ reactants: 0, peak: 250, products: energy.change, box: [40, 255, 680, 200] });

chem.stage.part('Reaction', reaction.handle, { label: 'Reaction', info: 'One methane and two oxygen molecules. Move the progress slider to watch their atoms rearrange.' });
chem.stage.part('Carbon', reaction.atoms[0].handle, { label: 'Carbon atom', info: 'It starts bonded to four hydrogens and ends double-bonded to two oxygens.' });
chem.stage.part('Energy profile', profile.handle, { label: 'Energy profile', info: 'Energy climbs while bonds break, then falls lower as stronger bonds form.' });

inc.onFrame(() => {
  reaction.progress(model.p);
  profile.set({ peak: model.ea }).marker(model.p);
});

inc.readout({
  'Bonds broken': () => `${energy.broken} kJ/mol in`,
  'Bonds made': () => `${energy.formed} kJ/mol out`,
  'Energy change': () => `${energy.change} kJ/mol`,
});

inc.explain(() =>
  model.phase === 'breaking'
    ? `Breaking the bonds in methane and oxygen takes in ${energy.broken} kJ/mol.`
    : model.phase === 'moving'
      ? 'The free atoms rearrange: the carbon joins two oxygens, and each other oxygen takes two hydrogens.'
      : `Making the bonds in carbon dioxide and water gives out ${energy.formed} kJ/mol, so ${-energy.change} kJ/mol is released overall.`,
);

inc.describe(
  () =>
    `Methane and oxygen react to give carbon dioxide and water, ${Math.round(model.p * 100)}% of the way through. Breaking bonds takes in ${energy.broken} kJ/mol, making bonds gives out ${energy.formed} kJ/mol, so the energy change is ${energy.change} kJ/mol, with an activation energy of ${model.ea} kJ/mol.`,
);

inc.steps([
  { say: 'Methane and oxygen: four C–H bonds and two O=O bonds hold them together.', focus: 'Reaction', set: { progress: 0, activation: 250 } },
  { say: 'Breaking those bonds takes energy in, so the energy climbs.', focus: 'Energy profile', set: { progress: 0.35 } },
  { say: 'The atoms rearrange and make C=O and O–H bonds, which give out more energy than went in.', focus: 'Carbon', set: { progress: 1 } },
  { say: 'A lower hump lets the reaction start more easily, but the energy released stays the same.', focus: 'Energy profile', set: { activation: 100 } },
]);

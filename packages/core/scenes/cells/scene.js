// Animal, plant and bacterial cells side by side: what every cell shares, and what only some have.
inc.idea('Every cell has a membrane, cytoplasm and ribosomes; animal and plant cells keep their DNA in a nucleus, plants add a wall, chloroplasts and a vacuole, and bacteria have no nucleus at all.');

const show = inc.choice('highlight', { options: ['Everything', 'In every cell', 'Plants, not animals', 'Bacteria only'], buttons: true, label: 'Show' });

// Which organelles each choice picks out, in which kind of cell.
const PICKS = [
  null,
  { animal: ['membrane', 'cytoplasm', 'ribosomes'], plant: ['membrane', 'cytoplasm', 'ribosomes'], bacterium: ['membrane', 'cytoplasm', 'ribosomes'] },
  { animal: [], plant: ['wall', 'chloroplasts', 'vacuole'], bacterium: [] },
  { animal: [], plant: [], bacterium: ['nucleoid', 'plasmids', 'flagellum'] },
];
const model = inc.model(({ highlight }) => ({ pick: PICKS[highlight], name: ['everything', 'what every cell has', 'what plant cells have and animal cells lack', 'what only bacteria have'][highlight] }));

const bio = inc.biology('#stage', {
  viewBox: [0, 0, 900, 360],
  title: 'Animal, plant and bacterial cells',
  description: 'Three cells side by side: an animal cell on the left, a plant cell in the middle with its wall, chloroplasts and large vacuole, and a bacterium on the right with a loop of DNA and no nucleus.',
});
const cells = {
  animal: bio.cell(150, 165, { kind: 'animal', size: 250 }),
  plant: bio.cell(450, 165, { kind: 'plant', size: 260 }),
  bacterium: bio.cell(700, 165, { kind: 'bacterium', size: 200 }),
};
for (const [x, name] of [[150, 'Animal cell'], [450, 'Plant cell'], [700, 'Bacterium']]) {
  bio.stage.text(x, 330, name, { tone: 'mid' }).set({ 'text-anchor': 'middle' });
}

bio.stage.part('Membrane', cells.animal.organelle('membrane'), { label: 'Cell membrane', info: 'It controls what enters and leaves the cell.' });
bio.stage.part('Nucleus', cells.animal.organelle('nucleus'), { label: 'Nucleus', info: 'It holds the DNA that controls the cell.' });
bio.stage.part('Mitochondria', cells.animal.organelle('mitochondria'), { label: 'Mitochondria', info: 'Respiration here releases energy from glucose.' });
bio.stage.part('Ribosomes', cells.animal.organelle('ribosomes'), { label: 'Ribosomes', info: 'They build proteins.' });
bio.stage.part('Cell wall', cells.plant.organelle('wall'), { label: 'Cell wall', info: 'Cellulose that keeps the plant cell firm.' });
bio.stage.part('Chloroplasts', cells.plant.organelle('chloroplasts'), { label: 'Chloroplasts', info: 'Photosynthesis makes glucose here from light.' });
bio.stage.part('Vacuole', cells.plant.organelle('vacuole'), { label: 'Vacuole', info: 'Cell sap that presses out on the wall.' });
bio.stage.part('Nucleoid', cells.bacterium.organelle('nucleoid'), { label: 'Bacterial DNA', info: 'One loop of DNA, loose in the cytoplasm.' });

inc.onFrame(() => {
  for (const kind of ['animal', 'plant', 'bacterium']) {
    for (const name of cells[kind].organelles) {
      const lit = model.pick === null || model.pick[kind].includes(name);
      cells[kind].organelle(name).set({ opacity: lit ? 1 : 0.15 });
    }
  }
});

inc.explain(() => (model.pick === null ? 'Point at a part of a cell to see what it does.' : `Picked out: ${model.name}.`));

inc.describe(() => `An animal cell, a plant cell and a bacterium side by side, showing ${model.name}.`);

inc.steps([
  { say: 'Every cell has a membrane round its cytoplasm, and ribosomes that make proteins.', focus: 'Membrane', set: { highlight: 1 } },
  { say: 'Animal and plant cells keep their DNA in a nucleus, and release energy in mitochondria.', focus: 'Nucleus', set: { highlight: 0 } },
  { say: 'Plant cells also have a cellulose wall, chloroplasts for photosynthesis and a large vacuole.', focus: 'Chloroplasts', set: { highlight: 2 } },
  { say: 'A bacterium has no nucleus: its DNA is one loose loop, with small rings called plasmids.', focus: 'Nucleoid', set: { highlight: 3 } },
]);

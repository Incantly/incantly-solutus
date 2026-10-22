# Chemistry kit

`inc.chemistry` draws chemistry the way it is taught: atoms, bonds and molecules from their formulas with real bond lengths and angles, lone pairs and partial charges, electron shells, reactions acted out by their atoms with the bond energies they take in and give out, and energy profiles. It is a domain kit (DG-6): the chemistry kit script loads only for scenes that call it, beside the space3d, physics2d, chart and flow kits.

```js
const chem = inc.chemistry('#stage', { title: 'Water', viewBox: [0, 0, 640, 400], scale: 40, look: 'balls' });
const water = chem.molecule('H2O', { at: [320, 200], lonePairs: true, polar: true });
chem.stage.part('Oxygen', water.atoms[2].handle, { label: 'Oxygen', info: 'It pulls the shared electrons towards itself.' });
```

`scale` is stage units per ångström (default 40, so a C–H bond is 44 units long). `look: 'balls'` (default) shades each atom as a ball with its symbol; `look: 'symbols'` writes a displayed formula: symbols joined by lines, with gaps around each letter.

## Atoms and bonds

- `chem.atom(element, x, y, { tone, r, charge, draggable })` draws one atom in its element's tone (hydrogen soft, carbon strong, nitrogen blue, oxygen red, halogens green, sulfur and phosphorus orange, noble gases and reactive metals teal, other metals grey). Its radius follows the element's covalent radius. `charge: -2` writes 2− at its top right.
- `chem.bond(a, b, { order, kind, tone })` joins two atoms and follows them as they move: order 1, 2 or 3 lines, 1.5 as one solid and one dashed line; `kind: 'hydrogen'` is a dotted line between the atoms' surfaces and `kind: 'ionic'` draws nothing between ions.
- An atom's `at`, `charge`, `partial('+' | '-' | null)`, `tone`, `show` and `hide` change it; a bond's `order`, `strength` (0 to 1: it thins and fades as it breaks), `tone`, `show` and `hide` change it. Both have a `handle` for parts, callouts and connectors.
- A draggable atom moves under the learner's pointer and keyboard, and its bonds follow.

## Molecules

`chem.molecule(formula, { at, angle, lonePairs, polar, draggable })` builds a molecule or ion from its formula:

- **A library of common molecules and ions** with measured bond lengths and angles: H₂, N₂, O₂, the halogens and hydrogen halides, CO, NO, OH⁻, H₂O, H₂S, SO₂, NO₂, O₃, CO₂, HCN, NH₃, PH₃, H₃O⁺, BF₃, SO₃, CH₄, SiH₄, CCl₄, NH₄⁺, CO₃²⁻, NO₃⁻, SO₄²⁻, H₂O₂, H₂SO₄, ethane, ethene, ethyne, propane, methanol, ethanol, ethanoic acid, methanal, benzene, NaOH, KOH, CaCO₃ and NH₄Cl.
- **Salts** of a metal and one non-metal (NaCl, MgCl₂, Al₂O₃, Fe₂O₃) as rows of ions whose charges balance.
- **A centre with atoms around it** (CCl₄, PCl₅, SF₆, XeF₄, ClF₃, CS₂, COCl₂, BF₄⁻): oxygen and sulfur take double bonds while the centre has electrons to share, and the angles come from the centre's lone pairs, as electron-pair repulsion gives them, drawn on paper.
- **Single atoms and ions**: `Na`, `Cl-`, `Mg^2+`, `Fe^{3+}`. Write a charge with `^` when a digit comes before the sign: `Mg2+` reads as two magnesium atoms.
- **A structure you give**, for anything else: `{ atoms: [['C', 0, 0], ['O', 1.2, 0]], bonds: [[0, 1, 2]], charge: 0 }`, positions in ångströms with y down.

`molecule.atoms` lists the atoms in the order the formula writes them (H2O is H, H, O); `at` and `rotate` move and turn the whole molecule. `lonePairs: true` draws each atom's lone pairs, worked out from its valence electrons, its bonds and any charge, in the widest gaps between its bonds; an odd count is settled by the ion's charge, filling octets first, so OH⁻, NH₄⁺, NO₃⁻ and CO come out as written in textbooks. `polar: true` marks δ+ and δ− on the atoms at the ends of polar bonds, from the difference in electronegativity. A polyatomic ion is drawn in square brackets with its charge at the top right.

## Electron shells

`chem.shells(element, x, y, { electrons, mark, spin, r, gap, tone })` draws a Bohr model: the nucleus with its symbol, and the electrons in shells, filled in the order orbitals fill (with chromium, copper, silver, platinum and gold moving an s electron into the d shell below). `electrons: [2, 8]` gives an ion; `setElectrons([2, 8])` changes it later, as when sodium gives its outer electron to chlorine. An ion is drawn in square brackets with its charge outside. `mark: 'cross'` draws crosses for dot-and-cross diagrams; `spin` turns the shells while the figure plays, unless the learner asks for reduced motion. `electron(shell, index)` gives where one electron is drawn now.

## Reactions

`chem.reaction('2H2 + O2 -> 2H2O', { box, structures, equation })` acts out a balanced equation. Every reactant molecule is laid out across the box, every product too, and each atom is matched to the nearest product atom of the same element. `progress(0)` shows the reactants; as progress rises the reactants' bonds thin and fade, the free atoms move apart and on to their places in the products, and the products' bonds form; `progress(1)` shows the products. Ions change charge midway, so `2Na + Cl2 -> 2NaCl` ends with Na⁺ and Cl⁻. The equation is written beneath, with sub and superscripts.

The kit refuses an equation that is not balanced, naming the element and its counts. `reaction.broken` and `reaction.formed` list every bond in the reactants and the products (`H–H`, `O=O`, `O–H`), and `reaction.energy` gives the energy taken in to break them, given out making them and the change, in kJ/mol from average bond enthalpies (2H₂ + O₂ → 2H₂O comes to −486 kJ/mol). It is null when an ionic bond, or a bond the table does not hold, is involved.

## Energy profiles

`chem.profile({ reactants, peak, products, catalysed, box, unit, labels, names })` draws the energy of a reaction against its progress: a plateau for the reactants, the activation hump, and a plateau for the products, with arrows and values for the activation energy (Eₐ) and the energy change (ΔH), and a lower dashed path when `catalysed` gives a lower peak. `set` changes the energies, `marker(progress)` puts a ball on the curve, `energy(progress)` reads it, and `activation` and `change` give the two differences.

The combustion reference scene puts the two together: methane's atoms rearrange above, a ball crosses the hump below, and the readouts show the bond energies the kit computed.

## Limits

A stage draws at most 160 atoms, 200 bonds, 6 shell models and 2 profiles, and a molecule at most 40 atoms. Elements are hydrogen to krypton and a few heavier ones met in school chemistry (Rb, Sr, Ag, Sn, I, Xe, Cs, Ba, Pt, Au, Hg, Pb).

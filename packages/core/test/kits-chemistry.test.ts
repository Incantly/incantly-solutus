import { describe, expect, it } from 'vitest';
import type { Chemistry, Inc, Molecule, Profile, Reaction, Shells } from '../src/api/types';
import { kit } from '../src/kits/chemistry';
import { matchAtoms, spread } from '../src/kits/chemistry/chemistry';
import { ELEMENTS, groundShells, valenceElectrons } from '../src/kits/chemistry/elements';
import { bondEnthalpy, lonePairs, parseFormula, structureFrom, structureOf, type Structure } from '../src/kits/chemistry/structures';
import { isKitModule, KIT_GLOBAL, type KitModule } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import { KIT_SCRIPTS } from '../src/sandbox/generated/kit-scripts';
import { SHARED_GLOBAL, SHARED_MODULES } from '../src/sandbox/kit-shared';
import type { VNode } from '../src/scene/graph';
import { validateSceneJs } from '../src/validation/js';

function run(scene: (inc: Inc) => void, chemistry: KitModule = kit) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { chemistry } });
  const mount = runtime.mount(scene);
  runtime.tick(0);
  return { runtime, mount };
}

/** Whether a node and every group above it are shown. */
function shown(runtime: SceneRuntime, node: VNode): boolean {
  for (let n: VNode | undefined = node; n; n = n.parent === null ? undefined : runtime.graph.nodes.get(n.parent)) if (n.hidden) return false;
  return true;
}

const all = (runtime: SceneRuntime) => [...runtime.graph.nodes.values()];
const texts = (runtime: SceneRuntime) => all(runtime).filter((n) => n.kind === 'text' && shown(runtime, n) && n.text).map((n) => n.text!);
const translate = (node: VNode): [number, number] => [node.transform.tx, node.transform.ty];

function angleAt(s: Structure, centre: number, a: number, b: number): number {
  const c = s.atoms[centre]!;
  const p = s.atoms[a]!;
  const q = s.atoms[b]!;
  const u = Math.atan2(p.y - c.y, p.x - c.x);
  const v = Math.atan2(q.y - c.y, q.x - c.x);
  let d = Math.abs(u - v) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

const distance = (s: Structure, a: number, b: number) => Math.hypot(s.atoms[a]!.x - s.atoms[b]!.x, s.atoms[a]!.y - s.atoms[b]!.y);

describe('elements', () => {
  it('fills electron shells in the order orbitals fill, with the d-shell exceptions', () => {
    const shells = (symbol: string) => groundShells(ELEMENTS.get(symbol)!.z, symbol);
    expect(shells('H')).toEqual([1]);
    expect(shells('C')).toEqual([2, 4]);
    expect(shells('Na')).toEqual([2, 8, 1]);
    expect(shells('Cl')).toEqual([2, 8, 7]);
    expect(shells('K')).toEqual([2, 8, 8, 1]);
    expect(shells('Ca')).toEqual([2, 8, 8, 2]);
    expect(shells('Fe')).toEqual([2, 8, 14, 2]);
    expect(shells('Cr')).toEqual([2, 8, 13, 1]);
    expect(shells('Cu')).toEqual([2, 8, 18, 1]);
    expect(shells('Br')).toEqual([2, 8, 18, 7]);
    expect(shells('Ag')).toEqual([2, 8, 18, 18, 1]);
    expect(shells('Au')).toEqual([2, 8, 18, 32, 18, 1]);
    expect(shells('Pb')).toEqual([2, 8, 18, 32, 18, 4]);
    expect(valenceElectrons(ELEMENTS.get('O')!)).toBe(6);
    for (const element of ELEMENTS.values()) expect(groundShells(element.z, element.symbol).reduce((s, n) => s + n, 0)).toBe(element.z);
  });
});

describe('formulas and structures', () => {
  it('reads formulas with brackets, charges and states, telling CO from Co', () => {
    expect(parseFormula('H2O')).toEqual({ core: 'H2O', counts: [['H', 2], ['O', 1]], charge: 0 });
    expect(parseFormula('Ca(OH)2(aq)')).toEqual({ core: 'Ca(OH)2', counts: [['Ca', 1], ['O', 2], ['H', 2]], charge: 0 });
    expect(parseFormula('SO4^2-')).toMatchObject({ core: 'SO4', charge: -2 });
    expect(parseFormula('NH4+')).toMatchObject({ core: 'NH4', charge: 1 });
    expect(parseFormula('Fe^{3+}')).toMatchObject({ core: 'Fe', charge: 3 });
    expect(parseFormula('CO').counts).toEqual([['C', 1], ['O', 1]]);
    expect(parseFormula('Co').counts).toEqual([['Co', 1]]);
    expect(() => parseFormula('H2X')).toThrow(/not an element/);
    expect(() => parseFormula('Ca(OH2')).toThrow(/not closed/);
    expect(() => parseFormula('H2O)')).toThrow(/closing bracket/);
    expect(() => structureOf('Mg2+')).toThrow(/Mg\^2\+/);
  });

  it('draws library molecules with their real bond lengths and angles', () => {
    const water = structureOf('H2O')!;
    expect(water.atoms.map((a) => a.element)).toEqual(['H', 'H', 'O']);
    expect(distance(water, 0, 2)).toBeCloseTo(0.96, 2);
    expect(angleAt(water, 2, 0, 1)).toBeCloseTo(104.5, 1);
    const co2 = structureOf('CO2')!;
    expect(angleAt(co2, 0, 1, 2)).toBeCloseTo(180, 6);
    expect(co2.bonds.map((b) => b.order)).toEqual([2, 2]);
    expect(structureOf('N2')!.bonds[0]!.order).toBe(3);
    expect(structureOf('NH4+')!.charge).toBe(1);
    expect(structureOf('SO4^2-')!.charge).toBe(-2);
    expect(() => structureOf('NH4-')).toThrow(/charge 1 in this kit, not -1/);
    expect(structureOf('C6H6')!.bonds.filter((b) => b.order === 2)).toHaveLength(3);
    // Centred on the middle of the drawing.
    const ethanol = structureOf('C2H5OH')!;
    const xs = ethanol.atoms.map((a) => a.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 9);
  });

  it('builds salts as rows of ions with balancing charges', () => {
    const salt = structureOf('NaCl')!;
    expect(salt.atoms.map((a) => [a.element, a.charge])).toEqual([['Na', 1], ['Cl', -1]]);
    expect(salt.bonds).toEqual([{ a: 0, b: 1, order: 1, kind: 'ionic' }]);
    const chloride = structureOf('MgCl2')!;
    expect(chloride.atoms.map((a) => [a.element, a.charge])).toEqual([['Mg', 2], ['Cl', -1], ['Cl', -1]]);
    // Cl Mg Cl: the magnesium sits between the chlorides.
    expect(chloride.atoms[0]!.x).toBeCloseTo((chloride.atoms[1]!.x + chloride.atoms[2]!.x) / 2, 6);
    const alumina = structureOf('Al2O3')!;
    expect(alumina.atoms.reduce((sum, a) => sum + a.charge, 0)).toBe(0);
    expect(alumina.atoms.filter((a) => a.element === 'Al').every((a) => a.charge === 3)).toBe(true);
    expect(structureOf('Fe2O3')!.atoms.find((a) => a.element === 'Fe')!.charge).toBe(3);
  });

  it('places atoms around a centre at the angles its lone pairs give', () => {
    const ccl4 = structureOf('CCl4')!;
    expect(angleAt(ccl4, 0, 1, 2)).toBeCloseTo(90, 6);
    const sf6 = structureOf('SF6')!;
    expect(sf6.atoms).toHaveLength(7);
    expect(angleAt(sf6, 0, 1, 2)).toBeCloseTo(60, 6);
    // Two lone pairs on xenon leave its four fluorines square; three on chlorine trifluoride make a T.
    const xef4 = structureOf('XeF4')!;
    expect(angleAt(xef4, 0, 1, 3)).toBeCloseTo(180, 6);
    const clf3 = structureOf('ClF3')!;
    expect([angleAt(clf3, 0, 1, 2), angleAt(clf3, 0, 1, 3)].sort((a, b) => a - b)).toEqual([90, 180]);
    expect(angleAt(structureOf('BF3')!, 0, 1, 2)).toBeCloseTo(120, 6);
    expect(structureOf('PCl5')!.atoms).toHaveLength(6);
    expect(structureOf('BF4-')).toMatchObject({ charge: -1 });
    expect(angleAt(structureOf('BF4-')!, 0, 1, 3)).toBeCloseTo(180, 6);
    // Phosgene: carbon double-bonded to its oxygen, single to each chlorine.
    expect(structureOf('COCl2')!.bonds.map((b) => b.order)).toEqual([2, 1, 1]);
    // Sulfur shares two electrons with each sulfur of CS2.
    expect(structureOf('CS2')!.bonds.map((b) => b.order)).toEqual([2, 2]);
    expect(structureOf('Cl2O')!.atoms.map((a) => a.element)).toEqual(['Cl', 'Cl', 'O']);
    expect(structureOf('C4H10')).toBeNull();
    expect(structureOf('Fe')).toEqual({ atoms: [{ element: 'Fe', x: 0, y: 0, charge: 0 }], bonds: [], charge: 0 });
  });

  it('counts lone pairs from valence electrons, settling odd counts with the ion’s charge', () => {
    const pairs = (formula: string) => lonePairs(structureOf(formula)!);
    expect(pairs('H2O')).toEqual([0, 0, 2]);
    expect(pairs('NH3')).toEqual([1, 0, 0, 0]);
    expect(pairs('CO2')).toEqual([0, 2, 2]);
    expect(pairs('N2')).toEqual([1, 1]);
    expect(pairs('OH-')).toEqual([3, 0]);
    expect(pairs('NH4+')).toEqual([0, 0, 0, 0, 0]);
    expect(pairs('CO')).toEqual([1, 1]);
    expect(pairs('NO3-')).toEqual([0, 2, 3, 3]);
    expect(pairs('Cl-')).toEqual([4]);
    // Resonance bonds leave no whole number of pairs to draw.
    expect(pairs('O3')).toEqual([null, null, null]);
  });

  it('checks structures a scene gives', () => {
    const custom = structureFrom({ atoms: [['C', 0, 0], ['O', 1.2, 0]], bonds: [[0, 1, 2]] });
    expect(custom.atoms.map((a) => a.x)).toEqual([-0.6, 0.6]);
    expect(() => structureFrom({ atoms: [['Q', 0, 0]] })).toThrow(/not an element/);
    expect(() => structureFrom({ atoms: [['C', 0, 0]], bonds: [[0, 0]] })).toThrow(/two different atoms/);
    expect(() => structureFrom({ atoms: [['C', 0, 0], ['C', 1, 0]], bonds: [[0, 1, 4]] })).toThrow(/order 4/);
  });

  it('looks up average bond enthalpies whichever way round the atoms are named', () => {
    expect(bondEnthalpy('O', 'H', 1)).toBe(464);
    expect(bondEnthalpy('H', 'O', 1)).toBe(464);
    expect(bondEnthalpy('O', 'O', 2)).toBe(498);
    expect(bondEnthalpy('Xe', 'F', 1)).toBeNull();
  });

  it('spreads lone pairs into the widest gaps between bonds, and matches atoms nearest first', () => {
    const deg = (list: number[]) => list.map((a) => Math.round((((a * 180) / Math.PI) % 360) + 360) % 360);
    // Water's hydrogens below the oxygen: both pairs go above, symmetrically.
    expect(deg(spread([(52 * Math.PI) / 180, (128 * Math.PI) / 180], 2))).toEqual([223, 317]);
    expect(deg(spread([], 4))).toEqual([270, 0, 90, 180]);
    expect(matchAtoms([{ element: 'H', x: 0, y: 0 }, { element: 'H', x: 10, y: 0 }], [{ element: 'H', x: 11, y: 0 }, { element: 'H', x: 1, y: 0 }])).toEqual([1, 0]);
  });
});

describe('the chemistry kit', () => {
  it('draws a molecule from its formula: balls with symbols, bonds as bars, lone pairs and partial charges', () => {
    let water: Molecule | null = null;
    const { runtime } = run((inc) => {
      const chem = inc.chemistry('#c', { title: 'Water' });
      water = chem.molecule('H2O', { at: [320, 200], lonePairs: true, polar: true });
    });
    expect(texts(runtime)).toEqual(expect.arrayContaining(['H', 'O', 'δ−', 'δ+']));
    const w = water! as Molecule;
    expect(w.atoms.map((a) => a.element)).toEqual(['H', 'H', 'O']);
    // 40 units per ångström: each O–H bond is 38.4 long.
    const [h, , o] = w.atoms;
    expect(Math.hypot(h!.x - o!.x, h!.y - o!.y)).toBeCloseTo(38.4, 1);
    const bars = all(runtime).filter((n) => n.kind === 'path' && n.fill && shown(runtime, n));
    expect(bars).toHaveLength(2);
    const dots = all(runtime).filter((n) => n.kind === 'circle' && n.tone === 'hi' && shown(runtime, n));
    expect(dots).toHaveLength(4);
    // The oxygen's pairs sit above it, away from the hydrogens below.
    expect(dots.every((d) => Number(d.attrs.get('cy')) < 0)).toBe(true);
    expect(runtime.uiState().error).toBeNull();
  });

  it('moves and turns a molecule, its bonds and labels following', () => {
    let co2: Molecule | null = null;
    const { runtime } = run((inc) => {
      const chem = inc.chemistry('#c', { title: 'Carbon dioxide' });
      co2 = chem.molecule('CO2', { at: [200, 200] });
      inc.onFrame(() => co2!.rotate(90).at(300, 150));
    });
    runtime.tick(1 / 60);
    const m = co2! as Molecule;
    const [c, o1, o2] = m.atoms;
    expect([c!.x, c!.y]).toEqual([300, 150]);
    expect(o1!.x).toBeCloseTo(300, 6);
    expect(Math.abs(o1!.y - 150)).toBeCloseTo(46.4, 1);
    expect(o2!.y - 150).toBeCloseTo(-(o1!.y - 150), 6);
    const bars = all(runtime).filter((n) => n.kind === 'path' && n.fill && shown(runtime, n));
    expect(bars).toHaveLength(4);
    // The double bonds now run up and down the stage, either side of the carbon.
    for (const bar of bars) {
      const [x1, , x2] = (bar.attrs.get('d') ?? '').match(/-?[\d.]+/g)!.map(Number);
      expect(x1).toBeCloseTo(x2!, 6);
      expect(Math.abs(x1! - 300)).toBeLessThan(5);
    }
  });

  it('writes a displayed formula with the symbols look', () => {
    const { runtime } = run((inc) => {
      const chem = inc.chemistry('#c', { title: 'Ethene', look: 'symbols' });
      chem.molecule('C2H4');
    });
    expect(all(runtime).filter((n) => n.kind === 'circle').every((n) => n.attrs.get('opacity') === '0')).toBe(true);
    const lines = all(runtime).filter((n) => n.kind === 'path' && !n.fill && shown(runtime, n));
    // One double bond (two lines) and four single bonds.
    expect(lines).toHaveLength(6);
    expect(texts(runtime).filter((t) => t === 'C')).toHaveLength(2);
  });

  it('acts out a balanced reaction: bonds break, atoms move, new bonds form, with bond energies', () => {
    let reaction: Reaction | null = null;
    const { runtime } = run((inc) => {
      const chem = inc.chemistry('#c', { title: 'Burning hydrogen' });
      reaction = chem.reaction('2H2 + O2 -> 2H2O');
    });
    const r = reaction! as Reaction;
    expect(r.atoms.map((a) => a.element).sort()).toEqual(['H', 'H', 'H', 'H', 'O', 'O']);
    expect(r.broken).toEqual(['H–H', 'H–H', 'O=O']);
    expect(r.formed).toEqual(['O–H', 'O–H', 'O–H', 'O–H']);
    expect(r.energy).toEqual({ broken: 1370, formed: 1856, change: -486 });
    expect(texts(runtime)).toContain('2H₂ + O₂ → 2H₂O');
    const bars = () => all(runtime).filter((n) => n.kind === 'path' && n.fill && shown(runtime, n)).length;
    // Reactants: two H–H and one O=O.
    expect(bars()).toBe(4);
    const startX = r.atoms.map((a) => a.x);
    r.progress(0.5);
    runtime.tick(0);
    // Midway the old bonds are gone and the new ones not yet made.
    expect(bars()).toBe(0);
    r.progress(1);
    runtime.tick(0);
    expect(bars()).toBe(4);
    expect(r.atoms.map((a) => a.x)).not.toEqual(startX);
    // Every hydrogen ends next to an oxygen.
    const oxygens = r.atoms.filter((a) => a.element === 'O');
    for (const hydrogen of r.atoms.filter((a) => a.element === 'H')) {
      expect(Math.min(...oxygens.map((o) => Math.hypot(o.x - hydrogen.x, o.y - hydrogen.y)))).toBeCloseTo(38.4, 1);
    }
  });

  it('turns sodium atoms into ions as salt forms, and refuses an unbalanced equation', () => {
    let reaction: Reaction | null = null;
    const { runtime } = run((inc) => {
      reaction = inc.chemistry('#c', { title: 'Salt' }).reaction('2Na + Cl2 -> 2NaCl');
    });
    expect(texts(runtime).filter((t) => t === '+')).toHaveLength(0);
    (reaction! as Reaction).progress(1);
    runtime.tick(0);
    expect(texts(runtime).filter((t) => t === '+')).toHaveLength(2);
    expect(texts(runtime).filter((t) => t === '−')).toHaveLength(2);
    expect((reaction! as Reaction).energy).toBeNull();
    const failed = new SceneRuntime({ autoplay: false, kits: { chemistry: kit } });
    failed.mount((inc) => {
      inc.chemistry('#c', { title: 'Wrong' }).reaction('2H2 + O2 -> H2O');
    });
    expect(failed.uiState().error?.message).toContain('not balanced: 4 H on the left, 2 on the right');
  });

  it('draws electron shells, and an ion in brackets with its charge when it loses an electron', () => {
    let sodium: Shells | null = null;
    const { runtime } = run((inc) => {
      sodium = inc.chemistry('#c', { title: 'Sodium' }).shells('Na', 200, 200);
    });
    const na = sodium! as Shells;
    expect(na.electrons).toEqual([2, 8, 1]);
    expect(na.charge).toBe(0);
    const electrons = () => all(runtime).filter((n) => n.kind === 'circle' && n.tone === 'b' && shown(runtime, n)).length;
    expect(electrons()).toBe(11);
    expect(na.electron(2, 0)).toEqual([200, 200 - (13 + 14 + 32)]);
    na.setElectrons([2, 8]);
    runtime.tick(0);
    expect(na.charge).toBe(1);
    expect(electrons()).toBe(10);
    expect(texts(runtime)).toContain('+');
    expect(() => na.setElectrons([2, 8, 8, 8, 8])).toThrow(/cannot hold 34 electrons/);
    expect(() => na.electron(3, 0)).toThrow(/shell 3 does not exist/);
  });

  it('draws an energy profile with its activation energy and energy change, and a catalysed path', () => {
    let profile: Profile | null = null;
    const { runtime } = run((inc) => {
      profile = inc.chemistry('#c', { title: 'Profile' }).profile({ reactants: 0, peak: 120, products: -90 });
    });
    const p = profile! as Profile;
    expect(p.activation).toBe(120);
    expect(p.change).toBe(-90);
    expect(p.energy(0.5)).toBeCloseTo(120, 9);
    expect(p.energy(0)).toBe(0);
    expect(p.energy(1)).toBe(-90);
    expect(texts(runtime)).toEqual(expect.arrayContaining(['Eₐ = 120 kJ/mol', 'ΔH = −90 kJ/mol', 'reactants', 'products']));
    expect(texts(runtime)).not.toContain('with a catalyst');
    p.set({ catalysed: 60 }).marker(0.5);
    runtime.tick(0);
    expect(texts(runtime)).toContain('with a catalyst');
    expect(() => p.set({ peak: -100 })).toThrow(/at least as high/);
    expect(p.activation).toBe(120);
  });

  it('lets the learner drag an atom, its bond following', () => {
    const { runtime } = run((inc) => {
      const chem = inc.chemistry('#c', { title: 'Pull' });
      const a = chem.atom('H', 100, 100, { draggable: true });
      const b = chem.atom('Cl', 160, 100);
      chem.bond(a, b);
    });
    const dragged = all(runtime).find((n) => n.drag !== null)!;
    const bar = all(runtime).find((n) => n.kind === 'path' && n.fill)!;
    const before = bar.attrs.get('d');
    expect(dragged.drag).toBe('the hydrogen atom');
    runtime.drag(dragged.id, 'start', 100, 100);
    runtime.drag(dragged.id, 'move', 100, 40);
    runtime.drag(dragged.id, 'end', 100, 40);
    runtime.tick(0);
    expect(translate(dragged)).toEqual([100, 40]);
    expect(bar.attrs.get('d')).not.toBe(before);
  });

  it('refuses unknown elements, formulas and options plainly', () => {
    const error = (scene: (chem: Chemistry) => void) => {
      const runtime = new SceneRuntime({ autoplay: false, kits: { chemistry: kit } });
      runtime.mount((inc) => scene(inc.chemistry('#c', { title: 'x' })));
      return runtime.uiState().error?.message ?? '';
    };
    expect(error((c) => c.atom('Xx', 0, 0))).toContain('"Xx" is not an element');
    expect(error((c) => c.molecule('C4H10'))).toContain('no structure for C4H10');
    expect(error((c) => c.reaction('H2 + O2'))).toContain('one arrow');
    expect(error((c) => c.shells('Na', 0, 0, { electrons: [2, 40] }))).toContain('from 0 to 32');
    expect(error((c) => c.atom('O', 0, 0, { tone: 'red' as never }))).toContain('unknown tone "red"');
    const bad = new SceneRuntime({ autoplay: false, kits: { chemistry: kit } });
    bad.mount((inc) => {
      inc.chemistry('#c', { title: 'x', look: 'sticks' as never });
    });
    expect(bad.uiState().error?.message).toContain("look is 'balls' or 'symbols'");
  });

  it('gives each atom its handle, for parts a step can focus', () => {
    const { runtime } = run((inc) => {
      const chem = inc.chemistry('#c', { title: 'Parts' });
      const water = chem.molecule('H2O');
      chem.stage.part('Oxygen', water.atoms[2]!.handle, { label: 'Oxygen', info: 'It pulls the shared electrons towards itself.' });
      chem.stage.part('Water', water.handle, { label: 'Water' });
    });
    expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Oxygen', 'Water']);
  });
});

describe('measuring molecules (VI-5)', () => {
  it('reads bond lengths in ångströms', () => {
    const { mount } = run((inc) => {
      inc.chemistry('#c', { title: 'Water', scale: 50 }).molecule('H2O');
    });
    expect(mount.commands.find((c) => c.op === 'interact')).toMatchObject({ measure: { scale: [0.02, 0.02], origin: [0, 0], unit: 'Å' } });
  });
});

describe('the chemistry kit script', () => {
  it('registers itself in the Worker and draws with the runtime’s own modules', async () => {
    const code = await KIT_SCRIPTS.chemistry!();
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[SHARED_GLOBAL] = SHARED_MODULES;
    try {
      new Function(code)();
      const registered = (scope[KIT_GLOBAL] as Record<string, unknown>).chemistry;
      expect(isKitModule(registered)).toBe(true);
      const { runtime } = run((inc) => {
        const chem = inc.chemistry('#c', { title: 'Built' });
        chem.stage.part('Ammonia', chem.molecule('NH3', { lonePairs: true }).handle, { label: 'Ammonia' });
      }, registered as KitModule);
      expect(runtime.uiState().parts.map((p) => p.name)).toEqual(['Ammonia']);
      expect(runtime.uiState().error).toBeNull();
    } finally {
      delete scope[SHARED_GLOBAL];
      delete scope[KIT_GLOBAL];
    }
  });
});

describe('a chemistry scene passes the validator', () => {
  it('has no diagnostics', () => {
    const js = `
inc.idea('Burning methane breaks strong bonds and makes stronger ones, so energy comes out.');
const progress = inc.param('progress', { min: 0, max: 1, step: 0.01, value: 0, label: 'Reaction progress' });
const chem = inc.chemistry('#chem', { title: 'Methane burning' });
const reaction = chem.reaction('CH4 + 2O2 -> CO2 + 2H2O', { box: [0, 0, 640, 240] });
const profile = chem.profile({ reactants: 0, peak: 250, products: reaction.energy.change, box: [0, 240, 640, 160] });
chem.stage.part('Carbon', reaction.atoms[0].handle, { label: 'Carbon' });
inc.onFrame(() => {
  reaction.progress(progress.value);
  profile.marker(progress.value);
});
inc.readout({ 'Energy change': () => reaction.energy.change + ' kJ/mol' });
inc.describe(() => 'The reaction is ' + Math.round(progress.value * 100) + '% done.');
inc.steps([{ say: 'Bonds break first.', set: { progress: 0.3 } }, { say: 'New bonds form.', set: { progress: 1 }, focus: 'Carbon' }]);
`;
    const { diagnostics, info } = validateSceneJs(js);
    expect(diagnostics).toEqual([]);
    expect(info.kits).toEqual(['chemistry']);
  });
});

import type { MoleculeStructure } from '../../api/types';
import { SceneApiError } from '../../scene/errors';
import { ELEMENTS, isMetal, usualCharge, valenceElectrons, type ElementData } from './elements';

/**
 * Molecules from their formulas: parsing, a library of common structures in
 * two dimensions with real bond lengths (ångströms) and angles, and builders
 * for the shapes the library does not hold: a central atom with the angles
 * electron-pair repulsion gives it, and ionic compounds as rows of ions.
 * Coordinates are in ångströms with y pointing down, as on the stage.
 */

export type BondOrder = 1 | 1.5 | 2 | 3;
export type BondKind = 'covalent' | 'ionic' | 'hydrogen';

export interface StructureAtom {
  readonly element: string;
  readonly x: number;
  readonly y: number;
  /** An ion's charge, 0 for none. */
  readonly charge: number;
}

export interface StructureBond {
  readonly a: number;
  readonly b: number;
  readonly order: BondOrder;
  readonly kind: BondKind;
}

export interface Structure {
  /** In the order the formula lists them: H2O is H, H, O. */
  readonly atoms: readonly StructureAtom[];
  readonly bonds: readonly StructureBond[];
  /** The charge of the whole, for a polyatomic ion such as OH−. */
  readonly charge: number;
}

function fail(message: string): never {
  throw new SceneApiError(message);
}

const MAX_ATOMS = 40;
const ORDERS: ReadonlySet<number> = new Set([1, 1.5, 2, 3]);

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

export interface ParsedFormula {
  /** The formula without its charge or state, such as Ca(OH)2. */
  readonly core: string;
  /** Elements and counts in the order written, brackets expanded: Ca(OH)2 is Ca 1, O 2, H 2. */
  readonly counts: ReadonlyArray<readonly [string, number]>;
  readonly charge: number;
}

/** The charge written at the end of a formula: +, -, 2+, ^2-, 3-. */
function splitCharge(text: string): { core: string; charge: number } {
  const match = /(?:\^?(\d*)([+-])|\^\{?(\d*)([+-])\}?)$/.exec(text);
  if (!match) return { core: text, charge: 0 };
  const digits = match[1] ?? match[3] ?? '';
  const sign = (match[2] ?? match[4]) === '-' ? -1 : 1;
  const core = text.slice(0, match.index);
  // A digit before the sign belongs to the charge only after ^: SO4^2- is −2, but SO42- would be ambiguous.
  if (digits !== '' && !text.slice(match.index).startsWith('^')) return { core: text.slice(0, match.index + digits.length), charge: sign };
  return { core, charge: sign * (digits === '' ? 1 : Number(digits)) };
}

/** Reads a formula such as H2O, Ca(OH)2, SO4^2- or NH4+, without state symbols. */
export function parseFormula(source: string): ParsedFormula {
  const text = source.replace(/\((?:s|l|g|aq)\)$/, '').trim();
  if (!/^[A-Za-z0-9()^{}+-]+$/.test(text)) fail(`chemistry: "${source}" is not a formula; write it like H2O, Ca(OH)2 or SO4^2-`);
  const { core, charge } = splitCharge(text);
  const order: string[] = [];
  const totals = new Map<string, number>();
  let i = 0;
  const group = (depth: number): Map<string, number> => {
    if (depth > 3) fail(`chemistry: "${source}" has too many brackets`);
    const here = new Map<string, number>();
    const add = (element: string, n: number) => {
      here.set(element, (here.get(element) ?? 0) + n);
    };
    while (i < core.length) {
      const c = core[i]!;
      if (c === '(') {
        i++;
        const inner = group(depth + 1);
        if (core[i] !== ')') fail(`chemistry: "${source}" has a bracket that is not closed`);
        i++;
        const n = readCount();
        for (const [element, k] of inner) add(element, k * n);
        continue;
      }
      if (c === ')') return here;
      const symbol = /^[A-Z][a-z]?/.exec(core.slice(i))?.[0];
      if (!symbol) fail(`chemistry: "${source}" is not a formula; elements start with a capital letter`);
      // Prefer a two-letter symbol only when it is an element: Co is cobalt, but CO is carbon and oxygen.
      const element = ELEMENTS.has(symbol) ? symbol : symbol.length === 2 && ELEMENTS.has(symbol[0]!) ? symbol[0]! : null;
      if (!element) fail(`chemistry: "${symbol}" in "${source}" is not an element this kit knows`);
      i += element.length;
      if (!order.includes(element)) order.push(element);
      add(element, readCount());
    }
    if (depth > 0) fail(`chemistry: "${source}" has a bracket that is not closed`);
    return here;
  };
  const readCount = (): number => {
    const digits = /^\d+/.exec(core.slice(i))?.[0];
    if (!digits) return 1;
    i += digits.length;
    const n = Number(digits);
    if (!(n >= 1 && n <= MAX_ATOMS)) fail(`chemistry: a count in "${source}" must be from 1 to ${MAX_ATOMS}`);
    return n;
  };
  for (const [element, n] of group(0)) totals.set(element, n);
  if (i < core.length) fail(`chemistry: "${source}" has a closing bracket without an opening one`);
  const counts = order.map((element) => [element, totals.get(element)!] as const);
  const atoms = counts.reduce((sum, [, n]) => sum + n, 0);
  if (atoms === 0) fail(`chemistry: "${source}" has no atoms`);
  if (atoms > MAX_ATOMS) fail(`chemistry: "${source}" has ${atoms} atoms; the kit draws at most ${MAX_ATOMS} in one molecule`);
  return { core, counts, charge };
}

/** Atoms in formula order, written out: C2H5OH is C, C, H, H, H, H, H, O, H. */
function writtenOrder(core: string): string[] {
  const out: string[] = [];
  const re = /([A-Z][a-z]?)(\d*)/g;
  for (const match of core.matchAll(re)) {
    let symbol = match[1]!;
    if (!ELEMENTS.has(symbol) && symbol.length === 2) symbol = symbol[0]!;
    const n = match[2] ? Number(match[2]) : 1;
    for (let k = 0; k < n; k++) out.push(symbol);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

type Entry = { readonly atoms: ReadonlyArray<readonly [string, number, number, number?]>; readonly bonds: ReadonlyArray<readonly [number, number, BondOrder?, BondKind?]>; readonly charge?: number };

const rad = (degrees: number) => (degrees * Math.PI) / 180;
/** A point `length` from (x, y) at `degrees` (0 is right, 90 is down). */
const from = (x: number, y: number, length: number, degrees: number): [number, number] => [x + length * Math.cos(rad(degrees)), y + length * Math.sin(rad(degrees))];

function diatomic(a: string, b: string, length: number, order: BondOrder = 1): Entry {
  return { atoms: [[a, -length / 2, 0], [b, length / 2, 0]], bonds: [[0, 1, order]] };
}

/** Two ligands on a centre at `angle` degrees apart, opening downwards; the centre is written last (H2O) or first (SO2). */
function bent(centre: string, ligand: string, length: number, angle: number, order: BondOrder, centreFirst: boolean): Entry {
  const [lx, ly] = from(0, 0, length, 90 + angle / 2);
  const [rx, ry] = from(0, 0, length, 90 - angle / 2);
  return centreFirst
    ? { atoms: [[centre, 0, 0], [ligand, lx, ly], [ligand, rx, ry]], bonds: [[0, 1, order], [0, 2, order]] }
    : { atoms: [[ligand, lx, ly], [ligand, rx, ry], [centre, 0, 0]], bonds: [[2, 0, order], [2, 1, order]] };
}

/** A centre first, then ligands at the given angles. */
function star(centre: string, ligand: string, length: number, angles: readonly number[], order: BondOrder = 1, charge = 0): Entry {
  return {
    atoms: [[centre, 0, 0], ...angles.map((a) => [ligand, ...from(0, 0, length, a)] as const)],
    bonds: angles.map((_, k) => [0, k + 1, order] as const),
    charge,
  };
}

function benzene(): Entry {
  const atoms: Array<readonly [string, number, number]> = [];
  for (let k = 0; k < 6; k++) atoms.push(['C', ...from(0, 0, 1.39, 30 + 60 * k)]);
  for (let k = 0; k < 6; k++) atoms.push(['H', ...from(0, 0, 2.48, 30 + 60 * k)]);
  const bonds: Array<readonly [number, number, BondOrder]> = [];
  for (let k = 0; k < 6; k++) bonds.push([k, (k + 1) % 6, k % 2 === 0 ? 2 : 1], [k, k + 6, 1]);
  return { atoms, bonds };
}

/** Common molecules and ions, keyed by formula as written. */
const LIBRARY: Readonly<Record<string, () => Entry>> = {
  H2: () => diatomic('H', 'H', 0.74),
  N2: () => diatomic('N', 'N', 1.1, 3),
  O2: () => diatomic('O', 'O', 1.21, 2),
  F2: () => diatomic('F', 'F', 1.42),
  Cl2: () => diatomic('Cl', 'Cl', 1.99),
  Br2: () => diatomic('Br', 'Br', 2.28),
  I2: () => diatomic('I', 'I', 2.67),
  HF: () => diatomic('H', 'F', 0.92),
  HCl: () => diatomic('H', 'Cl', 1.27),
  HBr: () => diatomic('H', 'Br', 1.41),
  HI: () => diatomic('H', 'I', 1.61),
  CO: () => diatomic('C', 'O', 1.13, 3),
  NO: () => diatomic('N', 'O', 1.15, 2),
  OH: () => ({ ...diatomic('O', 'H', 0.96), charge: -1 }),
  H2O: () => bent('O', 'H', 0.96, 104.5, 1, false),
  H2S: () => bent('S', 'H', 1.34, 92, 1, false),
  SO2: () => bent('S', 'O', 1.43, 119, 2, true),
  NO2: () => bent('N', 'O', 1.2, 134, 1.5, true),
  O3: () => bent('O', 'O', 1.28, 117, 1.5, true),
  CO2: () => ({ atoms: [['C', 0, 0], ['O', -1.16, 0], ['O', 1.16, 0]], bonds: [[0, 1, 2], [0, 2, 2]] }),
  HCN: () => ({ atoms: [['H', -1.6, 0], ['C', -0.54, 0], ['N', 0.62, 0]], bonds: [[0, 1, 1], [1, 2, 3]] }),
  NH3: () => star('N', 'H', 1.01, [30, 90, 150]),
  PH3: () => star('P', 'H', 1.42, [30, 90, 150]),
  H3O: () => ({ ...star('O', 'H', 0.98, [30, 90, 150]), atoms: [['H', ...from(0, 0, 0.98, 30)], ['H', ...from(0, 0, 0.98, 90)], ['H', ...from(0, 0, 0.98, 150)], ['O', 0, 0]], bonds: [[3, 0, 1], [3, 1, 1], [3, 2, 1]], charge: 1 }),
  BF3: () => star('B', 'F', 1.31, [270, 30, 150]),
  SO3: () => star('S', 'O', 1.42, [270, 30, 150], 2),
  CH4: () => star('C', 'H', 1.09, [0, 90, 180, 270]),
  SiH4: () => star('Si', 'H', 1.48, [0, 90, 180, 270]),
  CCl4: () => star('C', 'Cl', 1.77, [0, 90, 180, 270]),
  NH4: () => star('N', 'H', 1.01, [0, 90, 180, 270], 1, 1),
  CO3: () => ({ atoms: [['C', 0, 0], ['O', ...from(0, 0, 1.28, 270)], ['O', ...from(0, 0, 1.28, 30)], ['O', ...from(0, 0, 1.28, 150)]], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]], charge: -2 }),
  NO3: () => ({ atoms: [['N', 0, 0], ['O', ...from(0, 0, 1.25, 270)], ['O', ...from(0, 0, 1.25, 30)], ['O', ...from(0, 0, 1.25, 150)]], bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1]], charge: -1 }),
  SO4: () => ({ ...star('S', 'O', 1.49, [0, 90, 180, 270]), bonds: [[0, 1, 1], [0, 2, 2], [0, 3, 1], [0, 4, 2]], charge: -2 }),
  H2O2: () => ({
    atoms: [['H', ...from(-0.735, 0, 0.96, 225)], ['H', ...from(0.735, 0, 0.96, 45)], ['O', -0.735, 0], ['O', 0.735, 0]],
    bonds: [[2, 3, 1], [0, 2, 1], [1, 3, 1]],
  }),
  H2SO4: () => ({
    atoms: [['H', -2.53, 0], ['H', 2.53, 0], ['S', 0, 0], ['O', 0, -1.43], ['O', 0, 1.43], ['O', -1.57, 0], ['O', 1.57, 0]],
    bonds: [[2, 3, 2], [2, 4, 2], [2, 5, 1], [2, 6, 1], [0, 5, 1], [1, 6, 1]],
  }),
  C2H6: () => ({
    atoms: [['C', -0.77, 0], ['C', 0.77, 0], ['H', -0.77, 1.09], ['H', -1.86, 0], ['H', -0.77, -1.09], ['H', 0.77, 1.09], ['H', 1.86, 0], ['H', 0.77, -1.09]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7]],
  }),
  C2H4: () => ({
    atoms: [['C', -0.67, 0], ['C', 0.67, 0], ['H', ...from(-0.67, 0, 1.09, 150)], ['H', ...from(-0.67, 0, 1.09, 210)], ['H', ...from(0.67, 0, 1.09, 30)], ['H', ...from(0.67, 0, 1.09, 330)]],
    bonds: [[0, 1, 2], [0, 2], [0, 3], [1, 4], [1, 5]],
  }),
  C2H2: () => ({ atoms: [['C', -0.6, 0], ['C', 0.6, 0], ['H', -1.66, 0], ['H', 1.66, 0]], bonds: [[0, 1, 3], [0, 2], [1, 3]] }),
  C3H8: () => ({
    atoms: [
      ['C', -1.54, 0], ['C', 0, 0], ['C', 1.54, 0],
      ['H', -1.54, -1.09], ['H', -1.54, 1.09], ['H', -2.63, 0], ['H', 0, -1.09], ['H', 0, 1.09], ['H', 1.54, -1.09], ['H', 1.54, 1.09], ['H', 2.63, 0],
    ],
    bonds: [[0, 1], [1, 2], [0, 3], [0, 4], [0, 5], [1, 6], [1, 7], [2, 8], [2, 9], [2, 10]],
  }),
  CH3OH: () => ({
    atoms: [['C', -0.71, 0], ['H', -0.71, -1.09], ['H', -0.71, 1.09], ['H', -1.8, 0], ['O', 0.72, 0], ['H', 1.68, 0]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [4, 5]],
  }),
  C2H5OH: () => ({
    atoms: [
      ['C', -1.2, 0], ['C', 0.34, 0],
      ['H', -1.2, 1.09], ['H', -2.29, 0], ['H', -1.2, -1.09], ['H', 0.34, 1.09], ['H', 0.34, -1.09],
      ['O', 1.77, 0], ['H', 2.73, 0],
    ],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7], [7, 8]],
  }),
  CH3COOH: () => ({
    atoms: [
      ['C', -0.76, 0], ['H', -0.76, -1.09], ['H', -0.76, 1.09], ['H', -1.85, 0],
      ['C', 0.76, 0], ['O', ...from(0.76, 0, 1.21, 300)], ['O', ...from(0.76, 0, 1.36, 60)], ['H', ...from(...from(0.76, 0, 1.36, 60), 0.96, 0)],
    ],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [4, 5, 2], [4, 6], [6, 7]],
  }),
  HCHO: () => ({ atoms: [['H', ...from(0, 0, 1.1, 240)], ['C', 0, 0], ['H', ...from(0, 0, 1.1, 120)], ['O', 1.21, 0]], bonds: [[1, 0], [1, 2], [1, 3, 2]] }),
  C6H6: benzene,
  NaOH: () => ({ atoms: [['Na', -1.9, 0, 1], ['O', 0.4, 0, -1], ['H', 1.36, 0]], bonds: [[0, 1, 1, 'ionic'], [1, 2, 1]] }),
  KOH: () => ({ atoms: [['K', -2.1, 0, 1], ['O', 0.4, 0, -1], ['H', 1.36, 0]], bonds: [[0, 1, 1, 'ionic'], [1, 2, 1]] }),
  CaCO3: () => ({
    atoms: [['Ca', -2.6, 0, 2], ['C', 0.6, 0], ['O', ...from(0.6, 0, 1.28, 180)], ['O', ...from(0.6, 0, 1.28, 300)], ['O', ...from(0.6, 0, 1.28, 60)]],
    bonds: [[0, 2, 1, 'ionic'], [1, 2, 1], [1, 3, 2], [1, 4, 1]],
  }),
  NH4Cl: () => ({
    atoms: [['N', -1.3, 0], ['H', ...from(-1.3, 0, 1.01, 0)], ['H', ...from(-1.3, 0, 1.01, 90)], ['H', ...from(-1.3, 0, 1.01, 180)], ['H', ...from(-1.3, 0, 1.01, 270)], ['Cl', 1.9, 0, -1]],
    bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5, 1, 'ionic']],
  }),
};

/** Every formula the library holds, for messages. */
export const LIBRARY_FORMULAS: readonly string[] = Object.keys(LIBRARY);

// ---------------------------------------------------------------------------
// Builders for what the library does not hold
// ---------------------------------------------------------------------------

/** Ligand directions for a centre with `bonds` bonds and `pairs` lone pairs, as drawn on paper (degrees, 90 is down). */
function shapeAngles(bonds: number, pairs: number): number[] | null {
  switch (bonds) {
    case 1:
      return [0];
    case 2:
      if (pairs === 0 || pairs === 3) return [180, 0];
      return pairs === 1 ? [150, 30] : [142, 38];
    case 3:
      if (pairs === 0) return [270, 30, 150];
      return pairs === 1 ? [30, 90, 150] : [180, 90, 0];
    case 4:
      return pairs === 1 ? [180, 0, 60, 120] : [0, 90, 180, 270];
    case 5:
      return pairs === 0 ? [270, 90, 0, 150, 210] : [270, 0, 90, 180, 315];
    case 6:
      return [0, 60, 120, 180, 240, 300];
    default:
      return null;
  }
}

/** Bond length from covalent radii, shorter for multiple bonds. */
export function bondLength(a: ElementData, b: ElementData, order: number): number {
  const single = a.radius + b.radius;
  return order >= 3 ? single * 0.78 : order >= 2 ? single * 0.87 : order > 1 ? single * 0.93 : single;
}

/** A metal with one non-metal, such as NaCl, MgCl2 or Al2O3: ions in a row, alternating where they can. */
function ionic(counts: ReadonlyArray<readonly [string, number]>, order: readonly string[]): Entry | null {
  if (counts.length !== 2) return null;
  const metal = counts.find(([e]) => isMetal(e));
  const other = counts.find(([e]) => !isMetal(e));
  if (!metal || !other) return null;
  const qa = usualCharge(other[0]);
  if (qa >= 0) return null;
  const qm = (-qa * other[1]) / metal[1];
  if (!Number.isInteger(qm) || qm < 1 || qm > 4) return null;
  // Alternate cations and anions; the more numerous ion fills the ends.
  const [more, fewer] = metal[1] >= other[1] ? [metal, other] : [other, metal];
  const row: string[] = [];
  let m = more[1];
  let f = fewer[1];
  while (m > 0 || f > 0) {
    if (m > 0) {
      row.push(more[0]);
      m--;
    }
    if (f > 0 && (m > 0 || f > 0)) {
      row.push(fewer[0]);
      f--;
    }
  }
  const charge = (e: string) => (e === metal[0] ? qm : qa);
  const radius = (e: string) => ELEMENTS.get(e)!.radius;
  const placed: Array<{ element: string; x: number }> = [];
  let x = 0;
  row.forEach((e, k) => {
    if (k > 0) x += (radius(row[k - 1]!) + radius(e)) * 1.05;
    placed.push({ element: e, x });
  });
  const mid = x / 2;
  // Keep the formula's order for the atom list, then join neighbours in the row.
  const byElement = new Map<string, number[]>();
  placed.forEach((p, k) => byElement.set(p.element, [...(byElement.get(p.element) ?? []), k]));
  const list: number[] = [];
  for (const e of order) list.push(byElement.get(e)!.shift()!);
  const index = new Map(list.map((k, i) => [k, i]));
  return {
    atoms: list.map((k) => [placed[k]!.element, placed[k]!.x - mid, 0, charge(placed[k]!.element)] as const),
    bonds: placed.slice(1).map((_, k) => [index.get(k)!, index.get(k + 1)!, 1, 'ionic'] as const),
  };
}

/** A centre with atoms around it, such as CCl4, PCl5, SF6 or CHCl3, with angles from its lone pairs. */
function centred(counts: ReadonlyArray<readonly [string, number]>, order: readonly string[], charge: number): Entry | null {
  const singles = counts.filter(([e, n]) => n === 1 && e !== 'H');
  if (singles.length === 0) return null;
  // The centre is the lone atom that makes the most bonds; ties go to the one written first.
  const centre = singles.reduce((best, c) => (ELEMENTS.get(c[0])!.valence > ELEMENTS.get(best[0])!.valence ? c : best))[0];
  const centreData = ELEMENTS.get(centre)!;
  const ligands = order.filter((e, k) => !(e === centre && order.indexOf(centre) === k));
  if (ligands.length === 0 || ligands.length > 6) return null;
  // Each ligand bonds once; oxygen and sulfur take double bonds and nitrogen a triple while the centre has electrons to share.
  let electrons = valenceElectrons(centreData) - charge;
  const orders = ligands.map(() => 1 as BondOrder);
  electrons -= ligands.length;
  if (electrons < 0 && centreData.valence < ligands.length) return null;
  ligands.forEach((e, k) => {
    const wants = ELEMENTS.get(e)!.valence;
    while (orders[k]! < Math.min(3, wants) && electrons > 0) {
      orders[k] = (orders[k]! + 1) as BondOrder;
      electrons--;
    }
  });
  const pairs = Math.max(0, Math.floor(electrons / 2));
  const angles = shapeAngles(ligands.length, pairs);
  if (!angles) return null;
  const centreIndex = order.indexOf(centre);
  const atoms: Array<readonly [string, number, number]> = [];
  const bonds: Array<readonly [number, number, BondOrder]> = [];
  let ligand = 0;
  order.forEach((e, k) => {
    if (k === centreIndex) {
      atoms.push([e, 0, 0]);
      return;
    }
    const length = bondLength(centreData, ELEMENTS.get(e)!, orders[ligand]!);
    atoms.push([e, ...from(0, 0, length, angles[ligand]!)]);
    bonds.push([centreIndex, k, orders[ligand]!]);
    ligand++;
  });
  return { atoms, bonds, charge };
}

function normalise(entry: Entry, charge: number): Structure {
  const xs = entry.atoms.map((a) => a[1]);
  const ys = entry.atoms.map((a) => a[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return {
    atoms: entry.atoms.map(([element, x, y, q]) => ({ element, x: x - cx, y: y - cy, charge: q ?? 0 })),
    bonds: entry.bonds.map(([a, b, order, kind]) => ({ a, b, order: order ?? 1, kind: kind ?? 'covalent' })),
    charge: entry.charge ?? charge,
  };
}

/**
 * The structure of a formula: from the library, as an ionic compound, as a
 * centre with atoms around it, or as a single atom or ion. Null when none of
 * these fits, so the caller can ask for the structure itself.
 */
export function structureOf(source: string): Structure | null {
  const parsed = parseFormula(source);
  const key = parsed.core.replace(/[()]/g, '') === parsed.core ? parsed.core : null;
  const entry = key ? LIBRARY[key] : undefined;
  if (entry) {
    const built = entry();
    if (parsed.charge !== 0 && (built.charge ?? 0) !== parsed.charge) fail(`chemistry: ${parsed.core} has charge ${built.charge ?? 0} in this kit, not ${parsed.charge}`);
    return normalise(built, parsed.charge);
  }
  const total = parsed.counts.reduce((sum, [, n]) => sum + n, 0);
  if (total === 1) {
    const [element] = parsed.counts[0]!;
    return { atoms: [{ element, x: 0, y: 0, charge: parsed.charge }], bonds: [], charge: 0 };
  }
  if (!key) return null;
  if (/\d[+-]$/.test(source.trim()) && parsed.counts.length === 1) {
    fail(`chemistry: write an ion's charge with ^, as in ${parsed.counts[0]![0]}^${source.trim().slice(-2)}; ${source.trim()} reads as ${parsed.counts[0]![1]} atoms`);
  }
  const order = writtenOrder(parsed.core);
  const built = (parsed.charge === 0 ? ionic(parsed.counts, order) : null) ?? centred(parsed.counts, order, parsed.charge);
  return built ? normalise(built, parsed.charge) : null;
}

/** Checks and centres a structure a scene gives. */
export function structureFrom(spec: MoleculeStructure): Structure {
  if (typeof spec !== 'object' || spec === null || !Array.isArray(spec.atoms)) fail('chemistry: a structure is { atoms: [[element, x, y], ...], bonds: [[from, to, order], ...] }');
  if (spec.atoms.length === 0 || spec.atoms.length > MAX_ATOMS) fail(`chemistry: a structure has from 1 to ${MAX_ATOMS} atoms`);
  const atoms = spec.atoms.map((atom, k) => {
    const [element, x, y, q = 0] = atom;
    if (!ELEMENTS.has(element)) fail(`chemistry: atom ${k} is "${String(element)}", which is not an element this kit knows`);
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`chemistry: atom ${k} needs finite x and y in ångströms`);
    if (!Number.isInteger(q) || Math.abs(q) > 4) fail(`chemistry: atom ${k} has charge ${String(q)}; a charge is a whole number from -4 to 4`);
    return [element, x, y, q] as const;
  });
  const bonds = (spec.bonds ?? []).map((bond, k) => {
    const [a, b, order = 1] = bond;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= atoms.length || b >= atoms.length || a === b) {
      fail(`chemistry: bond ${k} must join two different atoms by their index, from 0 to ${atoms.length - 1}`);
    }
    if (!ORDERS.has(order)) fail(`chemistry: bond ${k} has order ${String(order)}; use 1, 1.5, 2 or 3`);
    return [a, b, order as BondOrder] as const;
  });
  const charge = spec.charge ?? 0;
  if (!Number.isInteger(charge) || Math.abs(charge) > 4) fail('chemistry: a charge is a whole number from -4 to 4');
  return normalise({ atoms, bonds }, charge);
}

/**
 * Lone pairs on each atom: valence electrons not in bonds, in pairs. Where an
 * atom is left with an odd number, an ion's charge or a shared formal charge
 * settles it, filling octets first (OH−, NH4+, NO3−, CO); null where that
 * leaves no whole number of pairs, as with resonance bonds or radicals.
 */
export function lonePairs(structure: Structure): Array<number | null> {
  const used = structure.atoms.map(() => 0);
  for (const bond of structure.bonds) {
    if (bond.kind !== 'covalent') continue;
    used[bond.a]! += bond.order;
    used[bond.b]! += bond.order;
  }
  const left = structure.atoms.map((atom, k) => (isMetal(atom.element) ? 0 : valenceElectrons(ELEMENTS.get(atom.element)!) - used[k]! - atom.charge));
  // Atoms with an odd count take or give one electron, towards a full shell, until the ion's charge is accounted for.
  const odd = left.map((n, k) => (Number.isInteger(n) && n > 0 && n % 2 === 1 ? k : -1)).filter((k) => k >= 0);
  const shift = new Map<number, number>();
  if (odd.length > 0) {
    const target = (k: number) => (structure.atoms[k]!.element === 'H' ? 2 : 8);
    const want = odd.map((k) => (left[k]! + 2 * used[k]! < target(k) ? 1 : -1));
    if (want.reduce((sum, w) => sum + w, 0) === -structure.charge) odd.forEach((k, i) => shift.set(k, want[i]!));
  }
  return left.map((n, k) => {
    const settled = n + (shift.get(k) ?? 0);
    if (!Number.isInteger(settled) || settled < 0 || settled % 2 !== 0) return null;
    return Math.min(4, settled / 2);
  });
}

// ---------------------------------------------------------------------------
// Bond enthalpies
// ---------------------------------------------------------------------------

/** Average bond enthalpies, kJ/mol, by the two elements in alphabetical order and the order. */
const ENTHALPY: Readonly<Record<string, number>> = {
  'H-H-1': 436,
  'C-H-1': 413,
  'H-N-1': 391,
  'H-O-1': 464,
  'F-H-1': 568,
  'Cl-H-1': 432,
  'Br-H-1': 366,
  'H-I-1': 299,
  'H-S-1': 364,
  'H-Si-1': 318,
  'H-P-1': 322,
  'C-C-1': 347,
  'C-C-1.5': 518,
  'C-C-2': 612,
  'C-C-3': 838,
  'C-N-1': 286,
  'C-N-2': 615,
  'C-N-3': 887,
  'C-O-1': 358,
  'C-O-2': 805,
  'C-O-3': 1077,
  'C-F-1': 467,
  'C-Cl-1': 346,
  'Br-C-1': 290,
  'C-I-1': 228,
  'C-S-1': 272,
  'N-N-1': 158,
  'N-N-2': 410,
  'N-N-3': 945,
  'N-O-1': 214,
  'N-O-1.5': 466,
  'N-O-2': 587,
  'O-O-1': 144,
  'O-O-1.5': 302,
  'O-O-2': 498,
  'F-F-1': 158,
  'Cl-Cl-1': 243,
  'Br-Br-1': 193,
  'I-I-1': 151,
  'S-S-1': 266,
  'O-S-2': 532,
  'O-Si-1': 466,
  'Cl-P-1': 326,
  'Cl-Si-1': 391,
};

/** The average enthalpy of a bond, kJ/mol, or null when the kit has no value for it. */
export function bondEnthalpy(a: string, b: string, order: number): number | null {
  const [x, y] = [a, b].sort();
  return ENTHALPY[`${x}-${y}-${order}`] ?? null;
}

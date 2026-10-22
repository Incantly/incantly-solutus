import type { Tone } from '../../api/types';

/**
 * The elements a scene can draw, with what the kit needs to draw them
 * truthfully: covalent radii for sizes and bond lengths, Pauling
 * electronegativity for partial charges, the usual number of bonds for
 * building structures, and electron shells worked out from the order
 * orbitals fill.
 */

export interface ElementData {
  readonly symbol: string;
  readonly name: string;
  /** Atomic number: protons in the nucleus. */
  readonly z: number;
  /** Covalent radius, ångströms. */
  readonly radius: number;
  /** Pauling electronegativity; 0 for the noble gases. */
  readonly en: number;
  /** The usual number of bonds it makes in molecules. */
  readonly valence: number;
}

/** symbol, name, Z, covalent radius (Å), electronegativity, usual bonds. */
const TABLE: ReadonlyArray<readonly [string, string, number, number, number, number]> = [
  ['H', 'hydrogen', 1, 0.31, 2.2, 1],
  ['He', 'helium', 2, 0.28, 0, 0],
  ['Li', 'lithium', 3, 1.28, 0.98, 1],
  ['Be', 'beryllium', 4, 0.96, 1.57, 2],
  ['B', 'boron', 5, 0.84, 2.04, 3],
  ['C', 'carbon', 6, 0.76, 2.55, 4],
  ['N', 'nitrogen', 7, 0.71, 3.04, 3],
  ['O', 'oxygen', 8, 0.66, 3.44, 2],
  ['F', 'fluorine', 9, 0.57, 3.98, 1],
  ['Ne', 'neon', 10, 0.58, 0, 0],
  ['Na', 'sodium', 11, 1.66, 0.93, 1],
  ['Mg', 'magnesium', 12, 1.41, 1.31, 2],
  ['Al', 'aluminium', 13, 1.21, 1.61, 3],
  ['Si', 'silicon', 14, 1.11, 1.9, 4],
  ['P', 'phosphorus', 15, 1.07, 2.19, 3],
  ['S', 'sulfur', 16, 1.05, 2.58, 2],
  ['Cl', 'chlorine', 17, 1.02, 3.16, 1],
  ['Ar', 'argon', 18, 1.06, 0, 0],
  ['K', 'potassium', 19, 2.03, 0.82, 1],
  ['Ca', 'calcium', 20, 1.76, 1, 2],
  ['Sc', 'scandium', 21, 1.7, 1.36, 3],
  ['Ti', 'titanium', 22, 1.6, 1.54, 4],
  ['V', 'vanadium', 23, 1.53, 1.63, 3],
  ['Cr', 'chromium', 24, 1.39, 1.66, 3],
  ['Mn', 'manganese', 25, 1.39, 1.55, 2],
  ['Fe', 'iron', 26, 1.32, 1.83, 2],
  ['Co', 'cobalt', 27, 1.26, 1.88, 2],
  ['Ni', 'nickel', 28, 1.24, 1.91, 2],
  ['Cu', 'copper', 29, 1.32, 1.9, 2],
  ['Zn', 'zinc', 30, 1.22, 1.65, 2],
  ['Ga', 'gallium', 31, 1.22, 1.81, 3],
  ['Ge', 'germanium', 32, 1.2, 2.01, 4],
  ['As', 'arsenic', 33, 1.19, 2.18, 3],
  ['Se', 'selenium', 34, 1.2, 2.55, 2],
  ['Br', 'bromine', 35, 1.2, 2.96, 1],
  ['Kr', 'krypton', 36, 1.16, 3, 0],
  ['Rb', 'rubidium', 37, 2.2, 0.82, 1],
  ['Sr', 'strontium', 38, 1.95, 0.95, 2],
  ['Ag', 'silver', 47, 1.45, 1.93, 1],
  ['Sn', 'tin', 50, 1.39, 1.96, 4],
  ['I', 'iodine', 53, 1.39, 2.66, 1],
  ['Xe', 'xenon', 54, 1.4, 2.6, 0],
  ['Cs', 'caesium', 55, 2.44, 0.79, 1],
  ['Ba', 'barium', 56, 2.15, 0.89, 2],
  ['Pt', 'platinum', 78, 1.36, 2.28, 2],
  ['Au', 'gold', 79, 1.36, 2.54, 1],
  ['Hg', 'mercury', 80, 1.32, 2, 2],
  ['Pb', 'lead', 82, 1.46, 2.33, 2],
];

export const ELEMENTS: ReadonlyMap<string, ElementData> = new Map(
  TABLE.map(([symbol, name, z, radius, en, valence]) => [symbol, Object.freeze({ symbol, name, z, radius, en, valence })]),
);

/** Subshells in the order they fill (the Madelung rule): [n, capacity]. */
const FILL_ORDER: ReadonlyArray<readonly [number, number]> = [
  [1, 2], // 1s
  [2, 2], // 2s
  [2, 6], // 2p
  [3, 2], // 3s
  [3, 6], // 3p
  [4, 2], // 4s
  [3, 10], // 3d
  [4, 6], // 4p
  [5, 2], // 5s
  [4, 10], // 4d
  [5, 6], // 5p
  [6, 2], // 6s
  [4, 14], // 4f
  [5, 10], // 5d
  [6, 6], // 6p
  [7, 2], // 7s
  [5, 14], // 5f
  [6, 10], // 6d
  [7, 6], // 7p
];

/** Elements whose ground state moves an s electron into the d shell below (half or fully filled d). */
const S_TO_D: Readonly<Record<string, number>> = { Cr: 1, Cu: 1, Ag: 1, Au: 1, Pt: 1 };

/** Electrons in each shell of a neutral atom in its ground state, innermost first. */
export function groundShells(z: number, symbol = ''): number[] {
  const shells: number[] = [];
  let left = z;
  for (const [n, capacity] of FILL_ORDER) {
    if (left <= 0) break;
    const put = Math.min(capacity, left);
    shells[n - 1] = (shells[n - 1] ?? 0) + put;
    left -= put;
  }
  const moved = S_TO_D[symbol] ?? 0;
  if (moved > 0 && shells.length >= 2) {
    // The outer s electron drops into the d subshell of the shell below.
    shells[shells.length - 1]! -= moved;
    shells[shells.length - 2]! += moved;
  }
  for (let i = 0; i < shells.length; i++) shells[i] ??= 0;
  return shells;
}

/** Electrons in the outer shell: the ones that bond. */
export function valenceElectrons(element: ElementData): number {
  const shells = groundShells(element.z, element.symbol);
  return shells[shells.length - 1] ?? 0;
}

const HALOGENS = new Set(['F', 'Cl', 'Br', 'I']);
const NOBLE = new Set(['He', 'Ne', 'Ar', 'Kr', 'Xe']);
const ALKALI = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba']);
const NON_METALS = new Set(['H', 'C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Se', 'Br', 'I', 'He', 'Ne', 'Ar', 'Kr', 'Xe', 'B', 'Si', 'As', 'Ge']);

export function isMetal(symbol: string): boolean {
  return ELEMENTS.has(symbol) && !NON_METALS.has(symbol);
}

/**
 * The theme tone an element is drawn in, after the usual model colours as far
 * as the theme's tones go: hydrogen soft, carbon strong, nitrogen blue,
 * oxygen red, halogens green, sulfur and phosphorus orange, noble gases and
 * reactive metals teal, other metals grey.
 */
export function elementTone(symbol: string): Tone {
  if (symbol === 'H') return 'lo';
  if (symbol === 'C') return 'hi';
  if (symbol === 'N') return 'b';
  if (symbol === 'O') return 'a';
  if (HALOGENS.has(symbol)) return 'c';
  if (symbol === 'S' || symbol === 'P' || symbol === 'B') return 'lit';
  if (NOBLE.has(symbol) || ALKALI.has(symbol)) return 'water';
  return 'mid';
}

/** The tone a symbol is written in on a ball of `tone`, so it reads in light and dark themes alike. */
export function labelTone(tone: Tone): Tone {
  return tone === 'lo' || tone === 'faint' || tone === 'mid' ? 'hi' : 'faint';
}

/** The usual charge of an element's ion: +1 for sodium, −2 for oxygen; 0 when it has no usual one. */
export function usualCharge(symbol: string): number {
  if (['Li', 'Na', 'K', 'Rb', 'Cs', 'Ag'].includes(symbol)) return 1;
  if (['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Zn', 'Fe', 'Cu', 'Ni', 'Co', 'Mn', 'Pb', 'Sn', 'Hg'].includes(symbol)) return 2;
  if (['Al', 'Sc', 'Cr', 'Ga'].includes(symbol)) return 3;
  if (HALOGENS.has(symbol) || symbol === 'H') return -1;
  if (symbol === 'O' || symbol === 'S' || symbol === 'Se') return -2;
  if (symbol === 'N' || symbol === 'P') return -3;
  return 0;
}

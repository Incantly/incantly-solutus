/**
 * Names: validity, reserved words and suggested names (docs/features/language/design.md 3.7).
 */
import type { TypeName } from '../contracts/values';
import type { CommandTable, FunctionTable } from './table';
import type { Ty } from './types';

export const MAX_NAME_LENGTH = 32;

export const KEYWORD_NAMES: readonly string[] = ['true', 'false', 'and', 'or', 'not', 'xor', 'if', 'in', 'step', 'with', 'on'];
export const CONSTANT_NAMES: readonly string[] = ['pi', 'tau', 'e', 'deg', 'inf', 'undefined'];
export const VARIABLE_NAMES: readonly string[] = ['t', 'bt', 'beat', 'x', 'y', 'z'];
export const AXIS_NAMES: readonly string[] = ['xaxis', 'yaxis', 'zaxis'];
/** Names held back for functions v1 does not have, so users cannot take them. */
export const HELD_BACK_NAMES: readonly string[] = ['state', 'arg', 'conjugate', 'real', 'imaginary', 'polygamma', 'zeta', 'si', 'ci', 'ei', 'lambertw'];

export type ReservedGroup = 'command' | 'function' | 'constant' | 'keyword' | 'variable' | 'axis' | 'held back';

const GROUP_TEXT: Record<ReservedGroup, string> = {
  command: 'a command',
  function: 'a built-in function',
  constant: 'a constant',
  keyword: 'a keyword',
  variable: 'a variable of the language',
  axis: 'an axis constant',
  'held back': 'held back for a later version',
};

export const reservedGroupText = (g: ReservedGroup): string => GROUP_TEXT[g];

export function reservedGroup(name: string, commands: CommandTable, functions: FunctionTable): ReservedGroup | undefined {
  if (commands.lookup(name)) return 'command';
  if (functions.lookup(name)) return 'function';
  if (CONSTANT_NAMES.includes(name)) return 'constant';
  if (KEYWORD_NAMES.includes(name)) return 'keyword';
  if (VARIABLE_NAMES.includes(name)) return 'variable';
  if (AXIS_NAMES.includes(name)) return 'axis';
  if (HELD_BACK_NAMES.includes(name)) return 'held back';
  return undefined;
}

const NAME_RE = /^[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*$/;

/** Why a name is not valid, or undefined when it is. Reserved words are checked separately. */
export function nameProblem(name: string): string | undefined {
  if (name.length === 0) return 'a name cannot be empty';
  if (name.length > MAX_NAME_LENGTH) return `it is longer than ${MAX_NAME_LENGTH} characters`;
  if (/^\d/.test(name)) return 'a name cannot start with a digit';
  if (/^[A-Za-z\u0370-\u03FF][A-Za-z0-9\u0370-\u03FF]*_\{[A-Za-z0-9,]+\}$/.test(name)) return undefined;
  if (!NAME_RE.test(name)) return 'a name uses letters, digits and _ only';
  if (name.endsWith('_')) return "a name cannot end with '_'";
  if (name.includes('__')) return "a name cannot contain '__'";
  return undefined;
}

export type Taken = ReadonlySet<string> | ((name: string) => boolean);

const isTaken = (taken: Taken, n: string): boolean => (typeof taken === 'function' ? taken(n) : taken.has(n));

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function seq(letters: readonly string[], taken: Taken, ok: (n: string) => boolean): string {
  for (const l of letters) if (ok(l) && !isTaken(taken, l)) return l;
  for (let i = 1; i < 100000; i++) {
    for (const l of letters) {
      const n = `${l}_${i}`;
      if (ok(n) && !isTaken(taken, n)) return n;
    }
  }
  return letters[0] + '_x';
}

function numbered(prefix: string, taken: Taken, ok: (n: string) => boolean): string {
  for (let i = 1; i < 100000; i++) {
    const n = `${prefix}${i}`;
    if (ok(n) && !isTaken(taken, n)) return n;
  }
  return prefix + 'x';
}

export interface SuggestOptions {
  /** `'angle'` for an angle-tagged Number. */
  unit?: 'angle';
  commands?: CommandTable;
  functions?: FunctionTable;
}

/**
 * The first free name in the type's sequence: points A B C …, vectors u v w, lines l m n, numbers
 * a b c d, angles α β γ δ, functions f g h p q r, circles c d k, lists L M N; then `A_1 B_1 …`.
 * Reserved and taken names are skipped.
 */
export function suggestName(type: Ty | TypeName | string, taken: Taken, opts: SuggestOptions = {}): string {
  const k = typeof type === 'string' ? type : type.k;
  const ok = (n: string): boolean => {
    if (opts.commands && opts.functions) return reservedGroup(n, opts.commands, opts.functions) === undefined;
    return !CONSTANT_NAMES.includes(n) && !VARIABLE_NAMES.includes(n) && !KEYWORD_NAMES.includes(n) && !AXIS_NAMES.includes(n);
  };
  switch (k) {
    case 'Point':
      return seq(UPPER, taken, ok);
    case 'Vector':
      return seq(['u', 'v', 'w'], taken, ok);
    case 'Line':
    case 'Ray':
    case 'Segment':
      return seq(['l', 'm', 'n'], taken, ok);
    case 'Number':
      return opts.unit === 'angle' ? seq(['α', 'β', 'γ', 'δ'], taken, ok) : seq(['a', 'b', 'c', 'd'], taken, ok);
    case 'Function':
      return seq(['f', 'g', 'h', 'p', 'q', 'r'], taken, ok);
    case 'Circle':
    case 'Arc':
    case 'Curve':
      return seq(['c', 'd', 'k'], taken, ok);
    case 'Polygon':
      return numbered('poly', taken, ok);
    case 'Region':
      return numbered('reg', taken, ok);
    case 'Text':
      return numbered('text', taken, ok);
    case 'List':
      return seq(['L', 'M', 'N'], taken, ok);
    case 'Bool':
      return numbered('cond', taken, ok);
    case 'Particles':
      return numbered('fx', taken, ok);
    case 'Color':
      return numbered('col', taken, ok);
    default:
      return numbered('obj', taken, ok);
  }
}

/** The name allocator of design 5.7: one sequence per kind of object, skipping used and reserved names. */

const LETTERS = (s: string): string[] => s.split('');

const SEQUENCES: Readonly<Record<string, readonly string[]>> = {
  point: LETTERS('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  vector: ['u', 'v', 'w'],
  line: ['l', 'm', 'n', 'g', 'h', 'k'],
  number: ['a', 'b', 'c', 'd', 'p', 'q', 'r', 's'],
  angle: ['α', 'β', 'γ', 'δ', 'ε', 'θ', 'φ'],
  circle: ['c', 'd', 'k', 'o'],
  conic: ['c', 'd', 'k', 'o'],
  list: ['L', 'M', 'N'],
  bool: ['cond'],
};

/** Kinds whose names are a word and a count: `poly1`, `poly2`. */
const NUMBERED: Readonly<Record<string, string>> = { polygon: 'poly', region: 'reg', text: 'text', fit: 'fit', locus: 'locus', bool: 'cond', relation: 'rel', body: 'body', joint: 'joint', ground: 'ground', water: 'water', liquid: 'liquid', smoke: 'smoke', cloth: 'cloth', pin: 'pin' };

/**
 * The first free name of a kind: the letters in order, then the letters with `_1`, `_2`, … (`A_1`), or a word with a
 * count. `free` says whether a name may be used.
 */
export function nextName(kind: string, free: (name: string) => boolean): string {
  const word = NUMBERED[kind];
  if (word) {
    for (let k = 1; k < 100000; k++) if (free(`${word}${k}`)) return `${word}${k}`;
  }
  const seq = SEQUENCES[kind] ?? SEQUENCES['number'] as readonly string[];
  for (const n of seq) if (free(n)) return n;
  for (let k = 1; k < 100000; k++) for (const n of seq) if (free(`${n}_${k}`)) return `${n}_${k}`;
  return `${kind}_new`;
}

/** The placeholders in lines, `{kind}` or `{kind#k}`, in order of first appearance. */
const TOKEN = /\{([a-z]+)(#\w+)?\}/g;

/**
 * Replaces every placeholder with a fresh name. A bare `{kind}` is a new name each time it appears; `{kind#k}` is the
 * same name wherever it appears. Returns the lines and the names given, in order.
 */
export function allocate(lines: readonly string[], free: (name: string) => boolean): { lines: string[]; names: string[] } {
  const given = new Set<string>();
  const named = new Map<string, string>();
  const names: string[] = [];
  const ok = (n: string): boolean => !given.has(n) && free(n);
  const out = lines.map((line) => line.replace(TOKEN, (_m, kind: string, tag: string | undefined) => {
    const key = tag ? `${kind}${tag}` : undefined;
    const hit = key ? named.get(key) : undefined;
    if (hit) return hit;
    const n = nextName(kind, ok);
    given.add(n);
    names.push(n);
    if (key) named.set(key, n);
    return n;
  }));
  return { lines: out, names };
}

/** The name a line defines (`c = Circle(A, B)` gives `c`), or undefined for a style line. */
export function definedName(line: string): string | undefined {
  const m = /^\s*([^\s=,()]+)\s*=(?!=)/.exec(line);
  return m && !/\swith\s/.test(line.slice(0, line.indexOf('='))) ? m[1] : undefined;
}

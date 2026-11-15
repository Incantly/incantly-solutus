/**
 * Numbers as exact-looking text (text-logic design 4.2 to 4.5): best rationals, surds, scientific form, continued
 * fractions. Pure functions of a double; no DOM.
 */

export interface Fraction {
  readonly p: number;
  readonly q: number;
}

/**
 * The convergent with the smallest denominator within `tol × max(1, |x|)` (design 4.3), or the best one found when the
 * tolerance is not met by `maxDen` (then `ok` is false).
 */
export function bestRational(x: number, maxDen = 1e6, tol = 1e-9): { readonly f: Fraction; readonly ok: boolean } {
  const sign = x < 0 ? -1 : 1;
  const a0 = Math.abs(x);
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = a0;
  let best: Fraction = { p: Math.round(a0), q: 1 };
  for (let i = 0; i < 64; i++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    best = { p: h1, q: k1 };
    if (Math.abs(a0 - h1 / k1) <= tol * Math.max(1, a0)) return { f: { p: sign * h1, q: k1 }, ok: true };
    const frac = b - a;
    if (frac < 1e-15) break;
    b = 1 / frac;
  }
  return { f: { p: sign * best.p, q: best.q }, ok: Math.abs(a0 - best.p / best.q) <= tol * Math.max(1, a0) };
}

/** LaTeX of a fraction: integers plain, the minus sign in front. */
export function fractionLatex(f: Fraction): string {
  if (f.q === 1) return String(f.p);
  return `${f.p < 0 ? '-' : ''}\\frac{${Math.abs(f.p)}}{${f.q}}`;
}

/** `n = s² × r` with `r` squarefree. */
function squareOut(n: number): { s: number; r: number } {
  let s = 1;
  let r = n;
  for (let k = 2; k * k <= r; k++) {
    while (r % (k * k) === 0) {
      r /= k * k;
      s *= k;
    }
  }
  return { s, r };
}

const isSquarefree = (n: number): boolean => squareOut(n).s === 1;

const KNOWN: readonly (readonly [string, number])[] = [
  ['\\pi', Math.PI], ['\\frac{1}{\\pi}', 1 / Math.PI], ['\\pi^{2}', Math.PI ** 2], ['\\sqrt{\\pi}', Math.sqrt(Math.PI)],
  ['e', Math.E], ['\\sqrt{e}', Math.sqrt(Math.E)], ['e\\pi', Math.E * Math.PI], ['\\ln 2', Math.LN2], ['\\ln 10', Math.LN10],
];

/** A rational times a symbol, as LaTeX: `\frac{3}{4}\pi`, `-2e`. */
function times(f: Fraction, sym: string): string {
  if (f.q === 1) return f.p === 1 ? sym : f.p === -1 ? `-${sym}` : `${f.p}${sym}`;
  const num = Math.abs(f.p) === 1 ? sym : `${Math.abs(f.p)}${sym}`;
  return `${f.p < 0 ? '-' : ''}\\frac{${num}}{${f.q}}`;
}

export interface SurdMatch {
  readonly latex: string;
  /** False when nothing small matched and the decimal is printed (design 4.4, step 6). */
  readonly exact: boolean;
  readonly residual: number;
}

/**
 * The simplest exact form of `x` within `tol` relative (design 4.4): a rational; a rational multiple of a known
 * constant; `a√b/c`; `(p + q√r)/s` for squarefree `r` up to 200. The integers must be small (their sum under 10^4), so a
 * random double does not match a large-integer relation.
 */
export function surd(x: number, tol = 1e-10, decimal: (v: number) => string = (v) => String(Number(v.toPrecision(10)))): SurdMatch {
  const rel = (y: number): number => Math.abs(x - y) / Math.max(1, Math.abs(x));
  const small = (...ns: number[]): boolean => ns.reduce((s, n) => s + Math.abs(n), 0) < 1e4;
  // 1. a rational
  const r = bestRational(x, 1e4, tol);
  if (r.ok && small(r.f.p, r.f.q)) return { latex: fractionLatex(r.f), exact: true, residual: rel(r.f.p / r.f.q) };
  // 2. a rational multiple of a known constant
  for (const [sym, c] of KNOWN) {
    const m = bestRational(x / c, 1000, tol);
    if (m.ok && m.f.p !== 0 && small(m.f.p, m.f.q)) return { latex: times(m.f, sym), exact: true, residual: rel((m.f.p / m.f.q) * c) };
  }
  // 3. a √b / c: x² is a small rational u / v
  const sq = bestRational(x * x, 1e4, tol);
  if (sq.ok && sq.f.p > 0 && small(sq.f.p, sq.f.q)) {
    // √(u/v) = √(u v) / v, then take out square factors
    const { s, r: rest } = squareOut(sq.f.p * sq.f.q);
    if (rest > 1) {
      const g = gcd(s, sq.f.q);
      const a = s / g;
      const c = sq.f.q / g;
      const sign = x < 0 ? '-' : '';
      const head = `${a === 1 ? '' : a}\\sqrt{${rest}}`;
      return { latex: c === 1 ? `${sign}${head}` : `${sign}\\frac{${head}}{${c}}`, exact: true, residual: rel((Math.sign(x) * a * Math.sqrt(rest)) / c) };
    }
  }
  // 4. (p + q√r) / s
  for (let root = 2; root <= 200; root++) {
    if (!isSquarefree(root)) continue;
    const sr = Math.sqrt(root);
    for (let s = 1; s <= 60; s++) {
      for (let q = -60; q <= 60; q++) {
        if (q === 0) continue;
        const p = Math.round(s * x - q * sr);
        if (!small(p, q, s, root) || rel((p + q * sr) / s) > tol) continue;
        const g = gcd(gcd(Math.abs(p), Math.abs(q)), s);
        const [pp, qq, ss] = [p / g, q / g, s / g];
        const qs = Math.abs(qq) === 1 ? '' : String(Math.abs(qq));
        const top = pp === 0 ? `${qq < 0 ? '-' : ''}${qs}\\sqrt{${root}}` : `${pp} ${qq < 0 ? '-' : '+'} ${qs}\\sqrt{${root}}`;
        return { latex: ss === 1 ? top : `\\frac{${top}}{${ss}}`, exact: true, residual: rel((p + q * sr) / s) };
      }
    }
  }
  return { latex: decimal(x), exact: false, residual: 0 };
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/** `1.23 \times 10^{4}` with `sig` significant figures (design 4.2). */
export function scientificLatex(x: number, sig: number): string {
  if (x === 0) return '0';
  let e = Math.floor(Math.log10(Math.abs(x)));
  let m = Number((x / 10 ** e).toPrecision(Math.max(1, sig)));
  if (Math.abs(m) >= 10) {
    m = Number((m / 10).toPrecision(Math.max(1, sig)));
    e += 1;
  }
  const ms = m.toPrecision(Math.max(1, sig));
  return e === 0 ? ms : `${ms} \\times 10^{${e}}`;
}

/** The partial quotients of `x`, at most `levels`, stopping when the float can no longer give them (design 4.5). */
export function continuedFraction(x: number, levels: number): { readonly terms: readonly number[]; readonly truncated: boolean } {
  const terms: number[] = [];
  let b = x;
  let err = Number.EPSILON * Math.max(1, Math.abs(x));
  for (let i = 0; i < levels; i++) {
    const a = Math.floor(b);
    terms.push(a);
    const frac = b - a;
    if (frac < 1e-12) return { terms, truncated: false };
    // the error of 1/frac grows by 1/frac²: stop once it passes the size of the next quotient's place
    err /= frac * frac;
    if (err > 0.01) return { terms, truncated: true };
    b = 1 / frac;
  }
  return { terms, truncated: terms.length >= levels };
}

/** The continued fraction as nested fractions, or `[a0; a1, a2, …]` when `short`. */
export function continuedFractionLatex(terms: readonly number[], short: boolean, more: boolean): string {
  if (terms.length === 0) return '0';
  if (short) return `\\left[${terms[0]}; ${terms.slice(1).join(', ')}${more ? ', \\ldots' : ''}\\right]`;
  let s = more ? '\\ddots' : '';
  for (let i = terms.length - 1; i >= 1; i--) s = s ? `\\cfrac{1}{${terms[i]} + ${s}}` : `\\cfrac{1}{${terms[i]}}`;
  return s ? `${terms[0]} + ${s}` : String(terms[0]);
}

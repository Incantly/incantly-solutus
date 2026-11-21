/**
 * The LaTeX subset (docs/features/text-logic/design.md 6.3) parsed into a box tree (6.1). Pure; no DOM. An unknown macro
 * is the error `latex_unsupported` with its name and position, so the caller can show the source instead.
 */

export type MathFont = 'math' | 'text' | 'bold' | 'italic' | 'upright' | 'bb' | 'cal';

export type MBox =
  | { readonly b: 'glyph'; readonly ch: string; readonly font: MathFont; readonly cls?: 'ord' | 'bin' | 'rel' | 'op' | 'punct' | 'open' | 'close' }
  | { readonly b: 'row'; readonly items: readonly MBox[] }
  | { readonly b: 'frac'; readonly num: MBox; readonly den: MBox; readonly rule: boolean; readonly display: boolean }
  | { readonly b: 'scripts'; readonly base: MBox; readonly sup?: MBox; readonly sub?: MBox }
  | { readonly b: 'root'; readonly body: MBox; readonly index?: MBox }
  | { readonly b: 'fence'; readonly open: string; readonly close: string; readonly body: MBox }
  | { readonly b: 'bigop'; readonly op: string; readonly lower?: MBox; readonly upper?: MBox; readonly limits: boolean }
  | { readonly b: 'matrix'; readonly rows: readonly (readonly MBox[])[]; readonly align: readonly ('l' | 'c' | 'r')[]; readonly hlines: readonly number[] }
  | { readonly b: 'accent'; readonly kind: 'hat' | 'bar' | 'vec' | 'dot' | 'ddot' | 'tilde'; readonly body: MBox }
  | { readonly b: 'over'; readonly kind: 'overline' | 'underline'; readonly body: MBox }
  | { readonly b: 'space'; readonly em: number }
  | { readonly b: 'color'; readonly color: string; readonly body: MBox };

export type TexResult = { readonly ok: true; readonly box: MBox } | { readonly ok: false; readonly kind: 'latex_unsupported'; readonly macro: string; readonly at: number; readonly message: string };

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', aleph: 'ℵ',
};

const REL: Readonly<Record<string, string>> = {
  ne: '≠', neq: '≠', le: '≤', leq: '≤', ge: '≥', geq: '≥', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡', cong: '≅', propto: '∝', parallel: '∥',
  perp: '⊥', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', to: '→', rightarrow: '→', Rightarrow: '⇒',
  Leftrightarrow: '⇔', mapsto: '↦', leftarrow: '←', Leftarrow: '⇐', iff: '⇔', mid: '∣',
};
const BIN: Readonly<Record<string, string>> = {
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗', circ: '∘', cap: '∩', cup: '∪', wedge: '∧', land: '∧', vee: '∨', lor: '∨', oplus: '⊕', setminus: '∖',
};
const ORD: Readonly<Record<string, string>> = {
  neg: '¬', lnot: '¬', forall: '∀', exists: '∃', nabla: '∇', partial: '∂', infty: '∞', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', emptyset: '∅',
  angle: '∠', triangle: '△', degree: '°', prime: '′', langle: '⟨', rangle: '⟩', hbar: 'ℏ', ell: 'ℓ',
  '%': '%', $: '$', '&': '&', '#': '#', _: '_', '{': '{', '}': '}', '|': '‖',
};
const FUNCS: ReadonlySet<string> = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'exp', 'det', 'gcd', 'deg', 'dim', 'lim', 'max', 'min', 'sup', 'inf']);
const LIMIT_FUNCS: ReadonlySet<string> = new Set(['lim', 'max', 'min', 'sup', 'inf']);
const BIGOPS: Readonly<Record<string, string>> = { sum: '∑', prod: '∏', int: '∫', oint: '∮', bigcup: '⋃', bigcap: '⋂', iint: '∬' };
const SPACES: Readonly<Record<string, number>> = { ',': 3 / 18, ':': 4 / 18, ';': 5 / 18, '!': -3 / 18, quad: 1, qquad: 2, ' ': 0.25 };
const BB: Readonly<Record<string, string>> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' };
const ACCENTS: Readonly<Record<string, 'hat' | 'bar' | 'vec' | 'dot' | 'ddot' | 'tilde'>> = { hat: 'hat', widehat: 'hat', bar: 'bar', vec: 'vec', overrightarrow: 'vec', dot: 'dot', ddot: 'ddot', tilde: 'tilde', widetilde: 'tilde' };
const DELIMS: ReadonlySet<string> = new Set(['(', ')', '[', ']', '{', '}', '|', '‖', '⟨', '⟩', '.', '']);

class Unsupported extends Error {
  constructor(readonly macro: string, readonly at: number) {
    super(macro);
  }
}

const row = (items: MBox[]): MBox => (items.length === 1 ? (items[0] as MBox) : { b: 'row', items });

/** Parses a LaTeX-subset source (without the dollar signs). */
export function parseTex(src: string): TexResult {
  let i = 0;
  const peek = (): string => src[i] ?? '';
  const skipWs = (): void => {
    while (i < src.length && /\s/.test(src[i] as string)) i++;
  };
  const readMacro = (): string => {
    // after the backslash: letters, or one other character
    const start = i;
    if (/[A-Za-z]/.test(peek())) {
      while (i < src.length && /[A-Za-z]/.test(src[i] as string)) i++;
      return src.slice(start, i);
    }
    i++;
    return src.slice(start, i);
  };
  /** A braced group, or a single token as an argument. */
  const arg = (): MBox => {
    skipWs();
    if (peek() === '{') {
      i++;
      const b = parseRow(['}']);
      if (peek() === '}') i++;
      return b;
    }
    const one = atom();
    return one ?? { b: 'row', items: [] };
  };
  /** The raw text of a braced group (for \text, \begin names, colours). */
  const rawGroup = (): string => {
    skipWs();
    if (peek() !== '{') return '';
    let depth = 0;
    const start = i + 1;
    for (; i < src.length; i++) {
      if (src[i] === '\\') {
        i++;
        continue;
      }
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) {
          i++;
          return src.slice(start, i - 1);
        }
      }
    }
    return src.slice(start);
  };
  const delim = (): string => {
    skipWs();
    if (peek() === '\\') {
      i++;
      const m = readMacro();
      const map: Record<string, string> = { '{': '{', '}': '}', '|': '‖', langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖', lbrace: '{', rbrace: '}' };
      const d = map[m];
      if (d === undefined) throw new Unsupported(`\\${m}`, i - m.length - 1);
      return d;
    }
    const c = peek();
    i++;
    if (!DELIMS.has(c)) throw new Unsupported(c, i - 1);
    return c === '.' ? '' : c;
  };

  const textBox = (s: string, font: MathFont): MBox => row(Array.from(s, (ch) => (ch === ' ' ? ({ b: 'space', em: 0.25 } as MBox) : ({ b: 'glyph', ch, font } as MBox))));

  function environment(name: string): MBox {
    let align: ('l' | 'c' | 'r')[] = [];
    if (name === 'array') align = Array.from(rawGroup()).filter((c) => 'lcr'.includes(c)) as ('l' | 'c' | 'r')[];
    const rows: MBox[][] = [];
    const hlines: number[] = [];
    let cells: MBox[] = [];
    for (;;) {
      skipWs();
      if (src.startsWith('\\hline', i)) {
        i += 6;
        hlines.push(rows.length);
        continue;
      }
      const cell = parseRow(['&', '\\\\', '\\end']);
      cells.push(cell);
      if (peek() === '&') {
        i++;
        continue;
      }
      if (src.startsWith('\\\\', i)) {
        i += 2;
        rows.push(cells);
        cells = [];
        continue;
      }
      if (src.startsWith('\\end', i)) {
        i += 4;
        rawGroup();
        rows.push(cells);
        break;
      }
      // end of input without \end: close the environment
      rows.push(cells);
      break;
    }
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const cases = name === 'cases';
    const al = Array.from({ length: cols }, (_, k) => align[Math.min(k, align.length - 1)] ?? (cases || name === 'aligned' ? 'l' : 'c'));
    if (name === 'aligned' && cols >= 2) al[0] = 'r';
    const m: MBox = { b: 'matrix', rows, align: al, hlines };
    switch (name) {
      case 'pmatrix': return { b: 'fence', open: '(', close: ')', body: m };
      case 'bmatrix': return { b: 'fence', open: '[', close: ']', body: m };
      case 'vmatrix': return { b: 'fence', open: '|', close: '|', body: m };
      case 'Bmatrix': return { b: 'fence', open: '{', close: '}', body: m };
      case 'cases': return { b: 'fence', open: '{', close: '', body: m };
      case 'matrix': case 'array': case 'aligned': return m;
      default: throw new Unsupported(`\\begin{${name}}`, i);
    }
  }

  /** One item of a row: a glyph, a group, a macro and its arguments; `undefined` at a stop. */
  function atom(): MBox | undefined {
    skipWs();
    const c = peek();
    if (c === '') return undefined;
    if (c === '{') {
      i++;
      const b = parseRow(['}']);
      if (peek() === '}') i++;
      return b;
    }
    if (c === '\\') {
      const at = i;
      i++;
      const m = readMacro();
      if (m === 'frac' || m === 'dfrac' || m === 'tfrac' || m === 'cfrac') {
        const num = arg();
        const den = arg();
        return { b: 'frac', num, den, rule: true, display: m === 'dfrac' || m === 'cfrac' };
      }
      if (m === 'binom') {
        const num = arg();
        const den = arg();
        return { b: 'fence', open: '(', close: ')', body: { b: 'frac', num, den, rule: false, display: false } };
      }
      if (m === 'sqrt') {
        skipWs();
        let index: MBox | undefined;
        if (peek() === '[') {
          i++;
          index = parseRow([']']);
          if (peek() === ']') i++;
        }
        const body = arg();
        return index ? { b: 'root', body, index } : { b: 'root', body };
      }
      if (m === 'left') {
        const open = delim();
        const body = parseRow(['\\right']);
        let close = '';
        if (src.startsWith('\\right', i)) {
          i += 6;
          close = delim();
        }
        return { b: 'fence', open, close, body };
      }
      if (m === 'right') throw new Unsupported('\\right', at);
      if (m === 'begin') return environment(rawGroup());
      if (m === 'text' || m === 'mathrm' || m === 'textrm' || m === 'operatorname') {
        const s = rawGroup().replace(/\\([{}$%&#_])/g, '$1');
        return m === 'operatorname' ? { b: 'glyph', ch: s, font: 'upright', cls: 'op' } : textBox(s, m === 'text' ? 'text' : 'upright');
      }
      if (m === 'mathbf' || m === 'textbf' || m === 'boldsymbol') return restyle(arg(), 'bold');
      if (m === 'mathit' || m === 'textit') return restyle(arg(), 'italic');
      if (m === 'mathbb') return textBox(Array.from(rawGroup(), (ch) => BB[ch] ?? ch).join(''), 'upright');
      if (m === 'mathcal') return textBox(rawGroup(), 'cal');
      if (m === 'color') {
        const color = rawGroup();
        return { b: 'color', color, body: arg() };
      }
      if (Object.hasOwn(ACCENTS, m)) return { b: 'accent', kind: ACCENTS[m] as 'hat', body: arg() };
      if (m === 'overline' || m === 'underline') return { b: 'over', kind: m, body: arg() };
      if (Object.hasOwn(SPACES, m)) return { b: 'space', em: SPACES[m] as number };
      if (Object.hasOwn(GREEK, m)) return { b: 'glyph', ch: GREEK[m] as string, font: /^[A-Z]/.test(m) ? 'upright' : 'math' };
      if (Object.hasOwn(REL, m)) return { b: 'glyph', ch: REL[m] as string, font: 'upright', cls: 'rel' };
      if (Object.hasOwn(BIN, m)) return { b: 'glyph', ch: BIN[m] as string, font: 'upright', cls: 'bin' };
      if (Object.hasOwn(ORD, m)) return { b: 'glyph', ch: ORD[m] as string, font: 'upright' };
      if (FUNCS.has(m)) {
        if (LIMIT_FUNCS.has(m)) return { b: 'bigop', op: m, limits: true };
        return { b: 'glyph', ch: m, font: 'upright', cls: 'op' };
      }
      if (Object.hasOwn(BIGOPS, m)) return { b: 'bigop', op: BIGOPS[m] as string, limits: m !== 'int' && m !== 'oint' && m !== 'iint' };
      if (m === 'limits' || m === 'nolimits' || m === 'displaystyle' || m === 'textstyle') return { b: 'row', items: [] };
      if (m === 'hline') return { b: 'row', items: [] };
      throw new Unsupported(`\\${m}`, at);
    }
    i++;
    if (c === '~') return { b: 'space', em: 0.25 };
    if (/[0-9.]/.test(c)) return { b: 'glyph', ch: c, font: 'upright' };
    if (/[A-Za-z]/.test(c)) return { b: 'glyph', ch: c, font: 'math' };
    if ('+-*'.includes(c)) return { b: 'glyph', ch: c === '-' ? '−' : c === '*' ? '∗' : c, font: 'upright', cls: 'bin' };
    if ('=<>'.includes(c)) return { b: 'glyph', ch: c, font: 'upright', cls: 'rel' };
    if (',;'.includes(c)) return { b: 'glyph', ch: c, font: 'upright', cls: 'punct' };
    if ('([' .includes(c)) return { b: 'glyph', ch: c, font: 'upright', cls: 'open' };
    if (')]'.includes(c)) return { b: 'glyph', ch: c, font: 'upright', cls: 'close' };
    if (c === "'") return { b: 'glyph', ch: '′', font: 'upright' };
    return { b: 'glyph', ch: c, font: /\p{L}/u.test(c) ? 'math' : 'upright' };
  }

  function parseRow(stops: readonly string[]): MBox {
    const items: MBox[] = [];
    for (;;) {
      skipWs();
      if (i >= src.length || stops.some((s) => src.startsWith(s, i))) break;
      if (peek() === '}' ) {
        // a stray closing brace ends the group
        break;
      }
      if (peek() === '^' || peek() === '_') {
        const prev = items.pop() ?? ({ b: 'row', items: [] } as MBox);
        let sup: MBox | undefined;
        let sub: MBox | undefined;
        let base = prev;
        if (prev.b === 'scripts') {
          base = prev.base;
          sup = prev.sup;
          sub = prev.sub;
        }
        while (peek() === '^' || peek() === '_') {
          const which = peek();
          i++;
          const s = arg();
          if (which === '^') sup = s;
          else sub = s;
          skipWs();
        }
        if (base.b === 'bigop') items.push({ ...base, ...(sub ? { lower: sub } : {}), ...(sup ? { upper: sup } : {}) });
        else items.push({ b: 'scripts', base, ...(sup ? { sup } : {}), ...(sub ? { sub } : {}) });
        continue;
      }
      const a = atom();
      if (!a) break;
      items.push(a);
    }
    return row(items);
  }

  try {
    const box = parseRow([]);
    return { ok: true, box };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, kind: 'latex_unsupported', macro: e.macro, at: e.at, message: `${e.macro} is not in the supported LaTeX subset.` };
    throw e;
  }
}

/** The same box with every glyph in another font (\mathbf, \mathit). */
function restyle(b: MBox, font: MathFont): MBox {
  switch (b.b) {
    case 'glyph': return { ...b, font };
    case 'row': return { b: 'row', items: b.items.map((x) => restyle(x, font)) };
    case 'scripts': return { b: 'scripts', base: restyle(b.base, font), ...(b.sup ? { sup: b.sup } : {}), ...(b.sub ? { sub: b.sub } : {}) };
    default: return b;
  }
}

/** A text split into plain runs and `$…$` math runs (`\$` is a literal dollar). */
export function splitMath(s: string): { readonly kind: 'text' | 'math'; readonly s: string }[] {
  const out: { kind: 'text' | 'math'; s: string }[] = [];
  let buf = '';
  let inMath = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k] as string;
    if (c === '\\' && s[k + 1] === '$') {
      buf += inMath ? '\\$' : '$';
      k++;
      continue;
    }
    if (c === '$') {
      if (buf) out.push({ kind: inMath ? 'math' : 'text', s: buf });
      buf = '';
      inMath = !inMath;
      continue;
    }
    buf += c;
  }
  // an unclosed dollar is a literal dollar
  if (buf) out.push(inMath ? { kind: 'text', s: `$${buf}` } : { kind: 'text', s: buf });
  return out;
}

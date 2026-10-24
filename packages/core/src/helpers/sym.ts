import { SceneApiError } from '../scene/errors';

/**
 * Symbols and chemical formulas as plain Unicode text for labels (DG-5).
 * SVG text cannot hold MathML, so `sym` and `chem` turn the notation people
 * type into characters any font can draw: sub and superscripts, Greek
 * letters, arrows and operators. A script with a character Unicode has no
 * sub or superscript for keeps its original notation rather than guessing.
 */

const MAX_LENGTH = 400;

const SUPER: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', '.': '·',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ',
  n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
  A: 'ᴬ', B: 'ᴮ', D: 'ᴰ', E: 'ᴱ', G: 'ᴳ', H: 'ᴴ', I: 'ᴵ', J: 'ᴶ', K: 'ᴷ', L: 'ᴸ', M: 'ᴹ', N: 'ᴺ',
  O: 'ᴼ', P: 'ᴾ', R: 'ᴿ', T: 'ᵀ', U: 'ᵁ', V: 'ⱽ', W: 'ᵂ',
  β: 'ᵝ', γ: 'ᵞ', δ: 'ᵟ', θ: 'ᶿ', φ: 'ᵠ', χ: 'ᵡ',
};

const SUB: Readonly<Record<string, string>> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
  β: 'ᵦ', γ: 'ᵧ', ρ: 'ᵨ', φ: 'ᵩ', χ: 'ᵪ',
};

const GREEK: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', Gamma: 'Γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', Theta: 'Θ', iota: 'ι', kappa: 'κ', lambda: 'λ', Lambda: 'Λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', Xi: 'Ξ', pi: 'π', Pi: 'Π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'φ', Phi: 'Φ', chi: 'χ', psi: 'ψ', Psi: 'Ψ', omega: 'ω', Omega: 'Ω',
};

/** Whole words that mean a symbol without a backslash. */
const WORDS: Readonly<Record<string, string>> = { ...GREEK, sqrt: '√', inf: '∞', infinity: '∞', hbar: 'ℏ' };

/** Backslash commands, as in \cdot or \theta. */
const COMMANDS: Readonly<Record<string, string>> = {
  ...WORDS,
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', to: '→', rightarrow: '→', leftarrow: '←',
  leftrightarrow: '↔', rightleftharpoons: '⇌', infty: '∞', approx: '≈', neq: '≠', ne: '≠', leq: '≤',
  le: '≤', geq: '≥', ge: '≥', partial: '∂', nabla: '∇', int: '∫', sum: '∑', prod: '∏', circ: '°',
  deg: '°', degree: '°', propto: '∝', angle: '∠', perp: '⊥', parallel: '∥', ell: 'ℓ', cdots: '⋯',
  ldots: '…', dots: '…',
};

/** Commands that put a mark over their argument: \vec{F}, \hat{x}, \bar{v}, \dot{x}. */
const ACCENTS: Readonly<Record<string, string>> = { vec: '\u20d7', hat: '\u0302', bar: '\u0305', dot: '\u0307' };

/** Operators typed as ASCII, longest first. */
const SYM_OPERATORS: ReadonlyArray<readonly [string, string]> = [
  ['<=>', '⇌'], ['<->', '↔'], ['...', '…'], ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['>=', '≥'], ['<=', '≤'],
  ['!=', '≠'], ['+-', '±'], ['~=', '≈'], ['*', '·'],
];

const CHEM_OPERATORS: ReadonlyArray<readonly [string, string]> = [
  ['<=>', '⇌'], ['<->', '⇌'], ['->', '→'], ['<-', '←'],
];

const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isGreek = (c: string | undefined): boolean => c !== undefined && /[Ͱ-Ͽ]/.test(c);

function checked(source: unknown, call: string): string {
  if (typeof source !== 'string') throw new SceneApiError(`inc.${call} needs a string`);
  if (source.length > MAX_LENGTH) throw new SceneApiError(`inc.${call} takes at most ${MAX_LENGTH} characters`);
  return source;
}

/** Replaces whole words that name symbols; leaves every other word alone. */
function words(text: string): string {
  return text.replace(/\\?[A-Za-z]+/g, (word, offset: number) => {
    if (word.startsWith('\\')) return COMMANDS[word.slice(1)] ?? word;
    if (isLetter(text[offset - 1])) return word;
    return WORDS[word] ?? word;
  });
}

/** Every character through `table`, or null when one has no form there. */
function through(text: string, table: Readonly<Record<string, string>>): string | null {
  let out = '';
  for (const c of text) {
    if (c === ' ') continue;
    const mapped = table[c];
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out;
}

/** The index just past the bracket that closes the one at `at`, or -1. */
function closing(text: string, at: number): number {
  const open = text[at]!;
  const close = open === '{' ? '}' : ')';
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The script after a ^ or _ at `at`: a {braced} or (bracketed) group, an
 * optionally signed run of digits, or a run of letters. A `charge` may also
 * end in its sign, as in ^2- or ^3+.
 */
function scriptAt(text: string, at: number, signed: boolean, charge: boolean): { readonly body: string; readonly end: number } | null {
  const first = text[at];
  if (first === undefined) return null;
  if (first === '{' || first === '(') {
    const end = closing(text, at);
    return end < 0 ? null : { body: text.slice(at + 1, end - 1), end };
  }
  const sign = first === '+' || first === '-' || first === '−';
  let i = at;
  if (signed && sign) i++;
  if (isDigit(text[i])) {
    while (isDigit(text[i])) i++;
    if (charge && !sign && (text[i] === '+' || text[i] === '-')) i++;
  } else if (isLetter(text[i]) || isGreek(text[i])) {
    while (isLetter(text[i]) || isGreek(text[i])) i++;
  }
  if (i === at) return null;
  return { body: text.slice(at, i), end: i };
}

/** Writes one script, or keeps its notation when Unicode cannot. */
function script(marker: string, body: string, table: Readonly<Record<string, string>>): string {
  const converted = through(words(body), table);
  if (converted !== null && converted !== '') return converted;
  return body.length === 1 ? `${marker}${body}` : `${marker}(${body})`;
}

function operatorAt(text: string, at: number, operators: ReadonlyArray<readonly [string, string]>): readonly [string, string] | undefined {
  return operators.find(([ascii]) => text.startsWith(ascii, at));
}

/** sym('v_0^2') is "v₀²"; sym('Delta theta') is "Δ θ"; sym('e^{-x}') is "e⁻ˣ". */
export function sym(source: string): string {
  const text = checked(source, 'sym');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\\' || (isLetter(c) && !isLetter(text[i - 1]))) {
      // A whole word or a command.
      let j = c === '\\' ? i + 1 : i;
      while (isLetter(text[j])) j++;
      const accent = c === '\\' ? ACCENTS[text.slice(i + 1, j)] : undefined;
      if (accent !== undefined && (text[j] === '{' || isLetter(text[j]))) {
        const end = text[j] === '{' ? closing(text, j) : j + 1;
        if (end > 0) {
          out += sym(text[j] === '{' ? text.slice(j + 1, end - 1) : text[j]!) + accent;
          i = end;
          continue;
        }
      }
      out += words(text.slice(i, j));
      i = j;
      continue;
    }
    if (c === '^' || c === '_') {
      const found = scriptAt(text, i + 1, c === '^', false);
      if (found) {
        out += script(c, found.body, c === '^' ? SUPER : SUB);
        i = found.end;
        continue;
      }
    }
    const operator = operatorAt(text, i, SYM_OPERATORS);
    if (operator) {
      out += operator[1];
      i += operator[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const STATE_SYMBOLS = ['(aq)', '(s)', '(l)', '(g)'];

/** chem('H2SO4') is "H₂SO₄"; chem('Fe^3+') is "Fe³⁺"; chem('CuSO4.5H2O') is "CuSO₄·5H₂O". */
export function chem(source: string): string {
  const text = checked(source, 'chem');
  let out = '';
  // True right after part of a formula (a letter, a closing bracket or a subscript),
  // where digits count atoms; false where digits are coefficients.
  let inFormula = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const operator = operatorAt(text, i, CHEM_OPERATORS);
    if (operator) {
      out += operator[1];
      i += operator[0].length;
      inFormula = false;
      continue;
    }
    if (c === '^' || c === '_') {
      const found = scriptAt(text, i + 1, true, true);
      if (found) {
        out += script(c, found.body, c === '^' ? SUPER : SUB);
        i = found.end;
        continue;
      }
    }
    if (isDigit(c) && inFormula) {
      let j = i;
      while (isDigit(text[j])) j++;
      out += through(text.slice(i, j), SUB)!;
      i = j;
      continue;
    }
    if ((c === '+' || c === '-') && inFormula) {
      const next = text[i + 1];
      const ends = next === undefined || /[\s,;)]/.test(next) || STATE_SYMBOLS.some((s) => text.startsWith(s, i + 1));
      if (ends) {
        out += SUPER[c]!;
        i++;
        inFormula = false;
        continue;
      }
    }
    if ((c === '.' || c === '*' || c === '·') && inFormula && (isDigit(text[i + 1]) || /[A-Z]/.test(text[i + 1] ?? ''))) {
      out += '·';
      i++;
      inFormula = false;
      continue;
    }
    out += c;
    inFormula = isLetter(c) || c === ')' || c === ']';
    i++;
  }
  return out;
}

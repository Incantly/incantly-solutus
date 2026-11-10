/**
 * Step 1a: normalisation and the offset map (docs/features/language/design.md 3.2).
 * The lexer works on the normalised text; every position shown to a writer is converted back
 * to UTF-16 columns of the text the writer sent.
 */

export const MAX_LINE_LENGTH = 2000;

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

/** One-for-one replacements (typed -> becomes). Word-like results are padded when glued to a name. */
const REPLACE: Readonly<Record<string, string>> = {
  '−': '-', '–': '-', '—': '-', '×': '*', '·': '*', '⋅': '*', '∙': '*', '÷': '/',
  '≤': '<=', '≥': '>=', '≠': '!=', '∧': ' and ', '∨': ' or ', '¬': ' not ',
  π: 'pi', τ: 'tau', '∞': 'inf', '√': '√',
  '\u00A0': ' ', '\t': ' ', '\u2009': ' ', '\u202F': ' ', '\u2003': ' ', '\u2002': ' ',
  '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'",
};

export interface Normalised {
  /** The text the lexer reads. */
  readonly text: string;
  /** `start[i]` is the original UTF-16 index where the character at normalised index i begins. */
  readonly start: Int32Array;
  /** `end[i]` is the exclusive original index where the character at normalised index i ends. */
  readonly end: Int32Array;
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_\u0370-\u03FF]/.test(c);

/** Rewrites typographic variants. Strings and comments are copied verbatim, except for smart quotes. */
export function normalise(raw: string): Normalised {
  // NFC, chunked at combining marks so the map stays exact.
  let src = raw;
  let srcStart: Int32Array | undefined;
  if (raw.normalize('NFC') !== raw) {
    const chunks: string[] = [];
    const starts: number[] = [];
    let i = 0;
    while (i < raw.length) {
      let j = i + 1;
      while (j < raw.length && /\p{M}/u.test(raw[j] as string)) j++;
      const piece = raw.slice(i, j).normalize('NFC');
      chunks.push(piece);
      for (let k = 0; k < piece.length; k++) starts.push(i);
      i = j;
    }
    src = chunks.join('');
    srcStart = Int32Array.from(starts);
  }
  const origIdx = (i: number): number => (srcStart ? (srcStart[i] as number) : i);
  const origEnd = (i: number): number => {
    if (!srcStart) return i + 1;
    // Exclusive end: the next different start, or the raw length.
    const s = srcStart[i] as number;
    let k = i + 1;
    while (k < src.length && srcStart[k] === s) k++;
    return k < src.length ? (srcStart[k] as number) : raw.length;
  };

  const out: string[] = [];
  const st: number[] = [];
  const en: number[] = [];
  const push = (s: string, a: number, b: number): void => {
    for (let k = 0; k < s.length; k++) {
      out.push(s[k] as string);
      st.push(a);
      en.push(b);
    }
  };

  type Mode = 'code' | 'string' | 'comment';
  let mode: Mode = 'code';
  let braceDepth = 0; // inside {..} of a string, code rules apply
  let stringOpen = '"';
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const a = origIdx(i);
    const b = origEnd(i);
    if (c === '\r') {
      // \r\n -> \n, lone \r -> \n
      const isCrLf = src[i + 1] === '\n';
      push('\n', a, isCrLf ? origEnd(i + 1) : b);
      i += isCrLf ? 2 : 1;
      mode = 'code';
      braceDepth = 0;
      continue;
    }
    if (c === '\n') {
      push('\n', a, b);
      i++;
      mode = 'code';
      braceDepth = 0;
      continue;
    }
    if (mode === 'comment') {
      push(c === '\u00A0' ? ' ' : c, a, b);
      i++;
      continue;
    }
    if (mode === 'string' && braceDepth === 0) {
      if (c === '\\' && i + 1 < src.length) {
        push(c, a, b);
        push(src[i + 1] as string, origIdx(i + 1), origEnd(i + 1));
        i += 2;
        continue;
      }
      if (c === '{') {
        braceDepth = 1;
        push(c, a, b);
        i++;
        continue;
      }
      if (c === '"' || c === '”' || c === '“' || c === '„') {
        // a straight or smart quote closes the string
        push('"', a, b);
        mode = 'code';
        i++;
        continue;
      }
      push(c, a, b);
      i++;
      continue;
    }
    // code mode (or inside {..} in a string)
    if (mode === 'string' && braceDepth > 0) {
      if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      else if (c === '"' || c === '”' || c === '“') {
        // closes the string (the lexer reports the unbalanced brace)
        push('"', a, b);
        mode = 'code';
        braceDepth = 0;
        i++;
        continue;
      }
    }
    if (mode === 'code' && c === '#') {
      mode = 'comment';
      push(c, a, b);
      i++;
      continue;
    }
    if (mode === 'code' && (c === '"' || c === '“' || c === '”' || c === '„')) {
      mode = 'string';
      stringOpen = c;
      braceDepth = 0;
      push('"', a, b);
      i++;
      continue;
    }
    // superscript runs: x² -> x^2, x⁻¹ -> x^-1
    if (SUPERSCRIPT[c] !== undefined || (c === '⁻' && SUPERSCRIPT[src[i + 1] ?? ''] !== undefined)) {
      let j = i;
      let neg = false;
      if (src[j] === '⁻') {
        neg = true;
        j++;
      }
      let digits = '';
      while (j < src.length && SUPERSCRIPT[src[j] as string] !== undefined) {
        digits += SUPERSCRIPT[src[j] as string];
        j++;
      }
      push('^' + (neg ? '-' : '') + digits, a, origEnd(j - 1));
      i = j;
      continue;
    }
    const rep = REPLACE[c];
    if (rep !== undefined) {
      let r = rep;
      if (c === 'π' || c === 'τ' || c === '∞') {
        // keep `2π` readable and stop `rπ` from fusing into one name
        if (isWordChar(out[out.length - 1])) r = ' ' + r;
        if (isWordChar(src[i + 1])) r = r + ' ';
      }
      push(r, a, b);
      i++;
      continue;
    }
    push(c, a, b);
    i++;
  }
  void stringOpen;
  return { text: out.join(''), start: Int32Array.from(st), end: Int32Array.from(en) };
}

export interface LineSpan {
  readonly line: number;
  readonly col: number;
  readonly endCol: number;
  readonly token: string;
}

/** Converts normalised offsets to line, column and the token as typed. */
export class SourceMap {
  readonly raw: string;
  readonly norm: Normalised;
  readonly firstLine: number;
  private readonly lineStarts: number[];

  constructor(raw: string, firstLine = 1) {
    this.raw = raw;
    this.norm = normalise(raw);
    this.firstLine = firstLine;
    this.lineStarts = [0];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '\n') this.lineStarts.push(i + 1);
    }
  }

  get text(): string {
    return this.norm.text;
  }

  /** Original index of the start of the normalised range. */
  origStart(s: number): number {
    const n = this.norm;
    if (n.text.length === 0) return 0;
    if (s >= n.text.length) return this.raw.length;
    return n.start[s] as number;
  }

  origEnd(e: number): number {
    const n = this.norm;
    if (n.text.length === 0 || e <= 0) return 0;
    if (e > n.text.length) return this.raw.length;
    return n.end[e - 1] as number;
  }

  private lineOf(origIdx: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= origIdx) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Span for the normalised range [s, e). A zero-width range gives endCol === col. */
  span(s: number, e: number): LineSpan {
    const os = this.origStart(s);
    let oe = e <= s ? os : this.origEnd(e);
    const li = this.lineOf(os);
    const lineStart = this.lineStarts[li] as number;
    const nextStart = this.lineStarts[li + 1];
    const lineEnd = nextStart === undefined ? this.raw.length : nextStart - 1;
    if (oe > lineEnd) oe = Math.max(os, lineEnd);
    const token = e <= s ? '' : this.raw.slice(os, this.origEnd(e));
    return { line: this.firstLine + li, col: os - lineStart + 1, endCol: oe - lineStart + 1, token };
  }

  /** Text of a normalised range (as normalised, for building suggestions). */
  slice(s: number, e: number): string {
    return this.norm.text.slice(s, e);
  }
}

/**
 * Splits a program into logical lines. A line continues onto the next physical line while a
 * bracket is open (README decision 17). Strings and comments are skipped when counting brackets.
 */
export interface LogicalLine {
  readonly text: string;
  /** 1-based number of the first physical line. */
  readonly firstLine: number;
  readonly lineCount: number;
}

export function splitLogicalLines(program: string): LogicalLine[] {
  const physical = program.replace(/\r\n?/g, '\n').split('\n');
  const result: LogicalLine[] = [];
  let i = 0;
  while (i < physical.length) {
    let text = physical[i] as string;
    const first = i + 1;
    let depth = bracketDepth(text, 0);
    let count = 1;
    while (depth > 0 && i + count < physical.length) {
      text += '\n' + (physical[i + count] as string);
      depth = bracketDepth(text, 0);
      count++;
    }
    result.push({ text, firstLine: first, lineCount: count });
    i += count;
  }
  return result;
}

/** Open round and square brackets at the end of `text`, ignoring strings and comments. Never negative. */
function bracketDepth(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let inComment = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '\n') {
      inComment = false;
      continue;
    }
    if (inComment) continue;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"' || c === '”' || c === '“') inString = false;
      continue;
    }
    if (c === '#') inComment = true;
    else if (c === '"' || c === '“' || c === '”' || c === '„') inString = true;
    else if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
  }
  return depth;
}

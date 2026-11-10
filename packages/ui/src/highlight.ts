/**
 * Turns the language's highlight tokens into styled runs of the editor text (docs/features/language/ui.md section 2).
 * Pure: the editor renders the runs.
 */
import type { HighlightToken } from '@incantly/kernel';
import { offsetOf } from './text';

/** A range of the editor text with extra classes (a squiggle, a bracket box). */
export interface Mark {
  readonly start: number;
  readonly end: number;
  readonly cls: string;
}

export interface Run {
  readonly text: string;
  readonly cls: string;
}

export interface Placed {
  readonly kind: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Tokens with their offsets in the editor text. Columns are 1-based UTF-16 columns of the text sent. */
export function placeTokens(text: string, tokens: readonly HighlightToken[]): Placed[] {
  return tokens
    .map((t) => ({ kind: t.kind, text: t.text, start: offsetOf(text, t.line, t.col), end: offsetOf(text, t.line, t.endCol) }))
    .filter((t) => t.end > t.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * A name on the left of the first `=` of a line is being defined, not looked up, so it is not an "unknown name"
 * (`c = Circle(A, 2)` where `c` does not exist yet). The language marks it unknown because the figure has no such object.
 */
export function markDefinitionTargets(text: string, tokens: readonly Placed[]): Placed[] {
  const out = [...tokens];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length;
    const eq = out.findIndex((t) => t.kind === 'operator' && t.text === '=' && t.start >= lineStart && t.end <= lineEnd);
    if (eq >= 0) {
      const eqTok = out[eq] as Placed;
      for (let i = 0; i < eq; i++) {
        const t = out[i] as Placed;
        if (t.kind === 'unknown' && t.start >= lineStart && t.end <= eqTok.start) out[i] = { ...t, kind: 'name' };
      }
    }
    lineStart = lineEnd + 1;
  }
  return out;
}

/** Runs of text, each with the token class and the classes of every mark that covers it. */
export function buildRuns(text: string, tokens: readonly Placed[], marks: readonly Mark[]): Run[] {
  if (text === '') return [];
  const cuts = new Set<number>([0, text.length]);
  for (const t of tokens) {
    cuts.add(t.start);
    cuts.add(t.end);
  }
  for (const m of marks) {
    cuts.add(Math.max(0, Math.min(text.length, m.start)));
    cuts.add(Math.max(0, Math.min(text.length, m.end)));
  }
  const points = [...cuts].filter((p) => p >= 0 && p <= text.length).sort((a, b) => a - b);
  const runs: Run[] = [];
  let ti = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as number;
    const b = points[i + 1] as number;
    while (ti < tokens.length && (tokens[ti] as Placed).end <= a) ti++;
    const tok = tokens[ti];
    const classes: string[] = [];
    if (tok && tok.start <= a && tok.end >= b) classes.push('tok-' + tok.kind);
    for (const m of marks) if (m.start <= a && m.end >= b) classes.push(m.cls);
    const cls = classes.join(' ');
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) runs[runs.length - 1] = { text: last.text + text.slice(a, b), cls };
    else runs.push({ text: text.slice(a, b), cls });
  }
  return runs;
}

export interface BracketInfo {
  /** Brackets with no partner: a red wavy underline at once. */
  readonly unmatched: Mark[];
  /** The bracket next to the caret and its partner, boxed. */
  readonly boxed: Mark[];
}

const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']' };
const CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[' };

/** Matches round and square brackets between the operator tokens (strings and comments hold none). */
export function bracketInfo(tokens: readonly Placed[], caret: number): BracketInfo {
  const stack: Placed[] = [];
  const unmatched: Mark[] = [];
  const pairs = new Map<Placed, Placed>();
  for (const t of tokens) {
    if (t.kind !== 'operator') continue;
    if (OPENERS[t.text] !== undefined) stack.push(t);
    else if (CLOSERS[t.text] !== undefined) {
      const top = stack[stack.length - 1];
      if (top && top.text === CLOSERS[t.text]) {
        stack.pop();
        pairs.set(top, t);
        pairs.set(t, top);
      } else unmatched.push({ start: t.start, end: t.end, cls: 'squiggle' });
    }
  }
  for (const t of stack) unmatched.push({ start: t.start, end: t.end, cls: 'squiggle' });
  const boxed: Mark[] = [];
  const touching = tokens.find((t) => pairs.has(t) && (t.start === caret || t.end === caret));
  const partner = touching ? pairs.get(touching) : undefined;
  if (touching && partner) {
    boxed.push({ start: touching.start, end: touching.end, cls: 'pair' }, { start: partner.start, end: partner.end, cls: 'pair' });
  }
  return { unmatched, boxed };
}

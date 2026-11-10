/**
 * Editing aids built on the same lexer, parser and checker: previews, signature help and
 * autocomplete (docs/features/language/design.md 3.16 to 3.18). All pure.
 */
import type { Notice } from '../contracts/errors';
import type { Span } from '../contracts/errors';
import { BUILTIN_CONSTANTS, BUILTIN_FUNCTIONS } from './builtins';
import { Checker, FIELDS } from './check';
import { compileLine, evaluate } from './compile';
import type { LanguageError } from './errors';
import { buildError, editDistance } from './errors';
import { checkLine } from './lines';
import { lex } from './lexer';
import type { Token } from './lexer';
import { CONSTANT_NAMES, KEYWORD_NAMES, suggestName } from './names';
import { parseExprTokens, parseLine } from './parser';
import { COLOR_WORDS, DIRECTIVES, PROPERTIES } from './props';
import { createEnv, valueText } from './runtime';
import { SourceMap } from './source';
import { formText } from './table';
import type { CommandForm, FigureView, FormLike, FunctionTable, ParamSpec } from './table';
import { T, accepts, parseTy, tyStr, typeSet } from './types';
import type { Ty, TypeSet } from './types';
import type { CheckedLine } from './check';

/* --------------------------------- analysis --------------------------------- */

/** Parse and check a line in one call. */
export function analyseLine(source: string, fig: FigureView, opts: { line?: number } = {}): import('../contracts/errors').Result<CheckedLine> {
  try {
    return analyseInner(source, fig, opts);
  } catch {
    return buildError('internal', 'lang.internal', { where: 'analysing the line' }, opts.line ?? 1, 1, 1, '', undefined, { recovery: 'report', fingerprintKey: 'analyse' });
  }
}

function analyseInner(source: string, fig: FigureView, opts: { line?: number }): import('../contracts/errors').Result<CheckedLine> {
  const parsed = parseLine(source, {
    ...(opts.line !== undefined ? { line: opts.line } : {}),
    isObjectCommand: (n) => fig.commands.lookup(n)?.kind === 'object',
  });
  if (!parsed.ok) return parsed;
  const checked = checkLine(parsed.value, fig);
  if (!checked.ok) return checked;
  return { ok: true, value: checked.value, notices: [...parsed.notices, ...checked.notices] };
}

/* --------------------------------- previews --------------------------------- */

export interface GhostSpec {
  readonly type: Ty;
  /** The computed value, when the line can be evaluated without the kernel. */
  readonly value: unknown;
}

export type PreviewResult =
  | { readonly ok: true; readonly name: string; readonly type: Ty | null; readonly valueText: string; readonly warnings: readonly Notice[]; readonly ghost: GhostSpec | null }
  | { readonly ok: false; readonly incomplete: boolean; readonly error: LanguageError };

function isIncomplete(e: LanguageError): boolean {
  if (e.kind === 'syntax') return e.token === '' || e.messageKey === 'lang.syntax_end';
  if (e.kind === 'unbalanced') return e.messageKey === 'lang.unbalanced_open';
  return e.kind === 'unterminated_string';
}

/**
 * Runs steps 1 to 5 against the figure without committing. An unnamed line gets the next suggested
 * name. Nothing is changed in the figure.
 */
export function preview(source: string, fig: FigureView): PreviewResult {
  try {
    return previewInner(source, fig);
  } catch {
    return { ok: false, incomplete: false, error: buildError('internal', 'lang.internal', { where: 'the preview' }, 1, 1, 1, '', undefined, { recovery: 'report', fingerprintKey: 'preview' }) };
  }
}

function previewInner(source: string, fig: FigureView): PreviewResult {
  const trimmed = source.trim();
  let r = analyseLine(source, fig);
  let tempName: string | undefined;
  if (!r.ok && r.kind === 'unnamed_object' && trimmed !== '') {
    tempName = 'pvw';
    let k = 1;
    while (fig.lookup(tempName + k)) k++;
    tempName = tempName + k;
    r = analyseLine(`${tempName} = ${trimmed}`, fig);
    if (!r.ok) return { ok: false, incomplete: isIncomplete(r), error: r };
  }
  if (!r.ok) return { ok: false, incomplete: isIncomplete(r), error: r };
  const line = r.value;
  const type = line.type ?? null;
  let name = line.names[0] ?? '';
  if (tempName !== undefined && line.type) {
    const taken = new Set(fig.names());
    name = suggestName(line.type, taken, line.unit ? { unit: line.unit, commands: fig.commands } : { commands: fig.commands });
  }
  let text = '';
  let ghost: GhostSpec | null = null;
  if (line.kind === 'function' && line.type) {
    text = line.text;
  } else if (line.expr && (line.kind === 'define') && !line.isState) {
    const compiled = compileLine(line);
    if (compiled.ok && compiled.value.command === undefined) {
      const clock = fig.clock?.() ?? { t: 0, bt: 0, beat: 0 };
      const env = createEnv({ ...clock, slots: Math.max(line.slots, 4), read: (id) => fig.read?.(id) });
      const ev = evaluate(compiled.value, env);
      if (ev.defined) {
        text = valueText(ev.value);
        if (line.type) ghost = { type: line.type, value: ev.value };
      } else text = `undefined (${ev.reason})`;
    } else if (line.type) text = tyStr(line.type);
  } else if (line.type) text = tyStr(line.type);
  return { ok: true, name, type, valueText: text, warnings: r.notices, ghost };
}

/* ---------------------------- cursor context ---------------------------- */

interface Frame {
  readonly bracket: '(' | '[';
  readonly callee: string | undefined;
  readonly openTok: number;
  readonly commas: number[];
}

interface CursorCtx {
  readonly sm: SourceMap;
  readonly toks: Token[];
  /** The word being typed, possibly empty. */
  readonly word: string;
  readonly wordStart: number;
  readonly frames: Frame[];
  readonly inString: boolean;
  readonly strExpr: boolean;
  readonly inComment: boolean;
}

function cursorContext(source: string, cursor: number): CursorCtx {
  const upto = source.slice(0, Math.max(0, Math.min(cursor, source.length)));
  const lastNl = upto.lastIndexOf('\n');
  // Only the logical line the cursor is on matters, but a call may continue over lines while brackets are open:
  // lex the whole prefix of the current logical line.
  const startsAt = logicalStart(upto, lastNl);
  const prefix = upto.slice(startsAt);
  const sm = new SourceMap(prefix);
  const lexed = lex(sm);
  let toks = lexed.tokens.filter((t) => t.kind !== 'eof' && t.kind !== 'nl');
  const textLen = sm.text.length;
  let word = '';
  let wordStart = textLen;
  const last = toks[toks.length - 1];
  if (last && (last.kind === 'name' || last.kind === 'kw') && last.e === textLen) {
    word = last.text;
    wordStart = last.s;
    toks = toks.slice(0, -1);
  }
  const inComment = toks.some((t) => t.kind === 'comment');
  const lastTok = toks[toks.length - 1];
  let inString = false;
  let strExpr = false;
  if (lastTok && lastTok.kind === 'str' && lastTok.e === textLen) {
    const closed = lastTok.text.length > 1 && lastTok.text.endsWith('"') && !lastTok.text.endsWith('\\"');
    if (!closed) {
      inString = true;
      const body = lastTok.text;
      const lb = body.lastIndexOf('{');
      const rb = body.lastIndexOf('}');
      strExpr = lb > rb && body[lb - 1] !== '\\';
      if (strExpr) {
        const m = /[A-Za-z_\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*$/.exec(body.slice(lb + 1));
        if (m) {
          word = m[0];
          wordStart = textLen - m[0].length;
        } else {
          word = '';
        }
      }
    }
  }
  const frames: Frame[] = [];
  toks.forEach((t, i) => {
    if (t.kind !== 'op' && !(t.kind === 'kw')) return;
    if (t.kind === 'op' && (t.text === '(' || t.text === '[')) {
      const prev = toks[i - 1];
      const callee = t.text === '(' && prev && (prev.kind === 'name' || (prev.kind === 'kw' && prev.text === 'if')) ? prev.name ?? prev.text : undefined;
      frames.push({ bracket: t.text as '(' | '[', callee, openTok: i, commas: [] });
    } else if (t.kind === 'op' && (t.text === ')' || t.text === ']')) {
      frames.pop();
    } else if (t.kind === 'op' && t.text === ',') {
      frames[frames.length - 1]?.commas.push(i);
    }
  });
  return { sm, toks, word, wordStart, frames, inString, strExpr, inComment };
}

function logicalStart(upto: string, lastNl: number): number {
  if (lastNl < 0) return 0;
  // walk back over physical lines while brackets stay open
  const lines = upto.split('\n');
  let start = lines.length - 1;
  // find the first physical line such that joined text from there has a balanced prefix before the last line
  for (let s = lines.length - 1; s >= 0; s--) {
    let depth = 0;
    let inStr = false;
    for (let li = s; li < lines.length - 1; li++) {
      const ln = lines[li] as string;
      for (let i = 0; i < ln.length; i++) {
        const c = ln[i] as string;
        if (c === '#' && !inStr) break;
        if (c === '"') inStr = !inStr;
        else if (!inStr && (c === '(' || c === '[')) depth++;
        else if (!inStr && (c === ')' || c === ']') && depth > 0) depth--;
      }
    }
    if (s === lines.length - 1) continue;
    // line s starts a logical line if the previous physical line is closed
    const prevLine = lines.slice(0, s).join('\n');
    let d = 0;
    for (const c of prevLine) {
      if (c === '(' || c === '[') d++;
      else if ((c === ')' || c === ']') && d > 0) d--;
    }
    if (d === 0 && depth > 0) {
      start = s;
      break;
    }
    if (d === 0) {
      start = depth > 0 ? s : lines.length - 1;
      if (depth === 0) break;
    }
  }
  let offset = 0;
  for (let i = 0; i < start; i++) offset += (lines[i] as string).length + 1;
  return offset;
}

function spanOf(ctx: CursorCtx, s: number, e: number): Span {
  const sp = ctx.sm.span(s, e);
  return { line: sp.line, col: sp.col, endCol: sp.endCol };
}

/** Types of the complete arguments to the left of the cursor in the innermost call. */
function typeArgs(ctx: CursorCtx, fig: FigureView, frame: Frame): { type: Ty | undefined; s: number; e: number; name?: string }[] {
  const out: { type: Ty | undefined; s: number; e: number; name?: string }[] = [];
  const toks = ctx.toks;
  const bounds = [frame.openTok, ...frame.commas];
  const parsed0 = { line: 1, source: ctx.sm.raw, sm: ctx.sm, node: { k: 'noop' } as const };
  for (let b = 0; b < bounds.length; b++) {
    const from = (bounds[b] as number) + 1;
    const to = b + 1 < bounds.length ? (bounds[b + 1] as number) : toks.length;
    // arguments before the last comma are complete; the one being typed is not
    if (b + 1 >= bounds.length) break;
    let slice = toks.slice(from, to);
    if (slice.length === 0) {
      out.push({ type: undefined, s: ctx.sm.text.length, e: ctx.sm.text.length });
      continue;
    }
    let name: string | undefined;
    if (slice.length > 2 && slice[0]?.kind === 'name' && slice[1]?.kind === 'op' && slice[1].text === '=') {
      name = slice[0].name ?? slice[0].text;
      slice = slice.slice(2);
    }
    const s = (slice[0] as Token).s;
    const e = (slice[slice.length - 1] as Token).e;
    const pe = parseExprTokens(slice, ctx.sm);
    let ty: Ty | undefined;
    if (pe.ok) {
      const ck = new Checker(fig, parsed0, {});
      try {
        const n = ck.inferArg(pe.value);
        ty = n && ck.errors.length === 0 ? n.ty : undefined;
      } catch {
        ty = undefined;
      }
    }
    out.push({ type: ty, s, e, ...(name ? { name } : {}) });
  }
  return out;
}

/* ------------------------------ signature help ------------------------------ */

export interface SignatureHelp {
  readonly command: string;
  readonly forms: readonly { readonly text: string; readonly summary: string; readonly matches: boolean; readonly active: boolean }[];
  /** Index of the argument being typed, within the active form. */
  readonly activeParam: number;
  readonly argsSoFar: readonly { readonly type: string; readonly span: Span }[];
}

function specForms(fig: FigureView, name: string): readonly FormLike[] | undefined {
  const cmd = fig.commands.lookup(name);
  if (cmd) return cmd.forms;
  const fn = (fig.functions ?? BUILTIN_FUNCTIONS).lookup(name);
  return fn?.forms;
}

function prefixMatches(form: FormLike, tys: (Ty | undefined)[], named: (string | undefined)[], k: number): boolean {
  if (k > form.params.length && !form.rest) return false;
  for (let i = 0; i < tys.length; i++) {
    const t = tys[i];
    const nm = named[i];
    const p = nm !== undefined ? form.params.find((x) => x.name === nm) : (form.params[i] ?? form.rest);
    if (!p) return false;
    if (t === undefined) continue;
    if ((p.kind ?? 'value') !== 'value') continue;
    if (!accepts(typeSet(p.type), t)) return false;
  }
  return true;
}

/** Help for the innermost open call at the cursor, or null when the cursor is not inside a command or function call. */
export function signatureHelp(source: string, cursor: number, fig: FigureView): SignatureHelp | null {
  try {
    return signatureHelpInner(source, cursor, fig);
  } catch {
    return null;
  }
}

function signatureHelpInner(source: string, cursor: number, fig: FigureView): SignatureHelp | null {
  const ctx = cursorContext(source, cursor);
  if (ctx.inString || ctx.inComment) return null;
  let frame: Frame | undefined;
  for (let i = ctx.frames.length - 1; i >= 0; i--) {
    const f = ctx.frames[i] as Frame;
    if (f.callee !== undefined && f.callee !== 'if') {
      frame = f;
      break;
    }
    if (f.callee === undefined && f.bracket === '(') continue;
  }
  if (!frame || frame.callee === undefined) return null;
  const forms = specForms(fig, frame.callee);
  if (!forms) return null;
  const args = typeArgs(ctx, fig, frame);
  const k = frame.commas.length;
  const tys = args.map((a) => a.type);
  const named = args.map((a) => a.name);
  const matching = forms.map((f) => prefixMatches(f, tys, named, k + 1));
  let activeIdx = matching.indexOf(true);
  if (activeIdx < 0) {
    // closest: the form with the fewest argument/type mismatches on the left
    let bestScore = Infinity;
    forms.forEach((f, i) => {
      let miss = Math.max(0, k + 1 - f.params.length) * 2;
      args.forEach((a, ai) => {
        const p = f.params[ai];
        if (!p) miss++;
        else if (a.type && (p.kind ?? 'value') === 'value' && !accepts(typeSet(p.type), a.type)) miss++;
      });
      if (miss < bestScore) {
        bestScore = miss;
        activeIdx = i;
      }
    });
  }
  const activeForm = forms[activeIdx] as FormLike;
  let activeParam = k;
  const typing = ctx.toks.slice((frame.commas[frame.commas.length - 1] ?? frame.openTok) + 1);
  if (typing.length >= 2 && typing[0]?.kind === 'name' && typing[1]?.kind === 'op' && typing[1].text === '=') {
    const idx = activeForm.params.findIndex((p) => p.name === typing[0]?.name);
    if (idx >= 0) activeParam = idx;
  }
  return {
    command: frame.callee,
    forms: forms.map((f, i) => ({ text: formText(frame.callee as string, f), summary: f.summary, matches: matching[i] as boolean, active: i === activeIdx })),
    activeParam,
    argsSoFar: args.map((a) => ({ type: a.type ? a.type.k : 'unknown', span: spanOf(ctx, a.s, a.e) })),
  };
}

/* ------------------------------- autocomplete ------------------------------- */

export type CompletionKind = 'object' | 'command' | 'function' | 'constant' | 'keyword' | 'field' | 'property' | 'directive' | 'snippet';

export interface Completion {
  readonly label: string;
  /** Text to insert; may contain $1, $2 placeholders. */
  readonly insert: string;
  readonly kind: CompletionKind;
  readonly detail?: string;
  readonly doc?: string;
  readonly score: number;
}

interface Candidate {
  label: string;
  insert: string;
  kind: CompletionKind;
  detail?: string;
  doc?: string;
  type?: Ty | undefined;
  recent?: number;
  formMatch?: boolean;
}

const lowerCache = new Map<string, string>();
function lower(s: string): string {
  let l = lowerCache.get(s);
  if (l === undefined) {
    if (lowerCache.size > 50000) lowerCache.clear();
    l = s.toLowerCase();
    lowerCache.set(s, l);
  }
  return l;
}

function boundarySubsequence(lq: string, c: string, lc: string): boolean {
  let qi = 0;
  for (let i = 0; i < lc.length && qi < lq.length; i++) {
    if (lc.charCodeAt(i) !== lq.charCodeAt(qi)) continue;
    const code = c.charCodeAt(i);
    const prev = i > 0 ? c.charCodeAt(i - 1) : 0;
    const boundary = i === 0 || (code >= 65 && code <= 90) || prev === 95 || (prev >= 48 && prev <= 57);
    if (boundary || (qi > 0 && lc.charCodeAt(i - 1) === lq.charCodeAt(qi - 1))) qi++;
  }
  return qi === lq.length;
}

function textScore(q: string, c: string): number {
  if (q === '') return 0;
  if (c.startsWith(q)) return 1000;
  const lq = lower(q);
  const lc = lower(c);
  if (lc.startsWith(lq)) return 800;
  if (q.length >= 2 && boundarySubsequence(lq, c, lc)) return 500;
  const maxD = c.length >= 6 ? 2 : 1;
  if (q.length >= 3 && Math.abs(c.length - q.length) <= maxD && editDistance(lq, lc, maxD) <= maxD) return 200;
  return -1;
}

function formParamPlaceholders(form: FormLike): string {
  const n = form.params.filter((p) => !p.optional).length;
  return Array.from({ length: Math.max(n, form.params.length > 0 ? 1 : 0) }, (_, i) => `$${i + 1}`).join(', ');
}

function returnTy(form: { returns: string | readonly string[] | null }): Ty | undefined {
  const r = form.returns;
  if (typeof r !== 'string' || r.startsWith('=') || r.includes('=')) return undefined;
  return parseTy(r);
}

function tyOfFunctionName(functions: FunctionTable, name: string): Ty | undefined {
  const spec = functions.lookup(name);
  const f = spec?.forms[0];
  return f ? returnTy(f) : undefined;
}

function expectedSetAt(fig: FigureView, frame: Frame, ctx: CursorCtx): { set: TypeSet | undefined; matched: readonly FormLike[] } {
  const forms = specForms(fig, frame.callee as string);
  if (!forms) return { set: undefined, matched: [] };
  const args = typeArgs(ctx, fig, frame);
  const k = frame.commas.length;
  const tys = args.map((a) => a.type);
  const named = args.map((a) => a.name);
  const matched = forms.filter((f) => prefixMatches(f, tys, named, k + 1));
  const members: Ty[] = [];
  let any = false;
  for (const f of matched) {
    const p: ParamSpec | undefined = f.params[k] ?? f.rest;
    if (!p) continue;
    if ((p.kind ?? 'value') !== 'value') continue;
    const s = typeSet(p.type);
    if (s.any) any = true;
    members.push(...s.members);
  }
  if (members.length === 0 && !any) return { set: undefined, matched };
  return { set: { text: '', members, any, size: members.length }, matched };
}

/** Completions at the cursor, best first. */
export function complete(source: string, cursor: number, fig: FigureView, opts: { limit?: number } = {}): Completion[] {
  try {
    return completeInner(source, cursor, fig, opts);
  } catch {
    return [];
  }
}

function completeInner(source: string, cursor: number, fig: FigureView, opts: { limit?: number }): Completion[] {
  const limit = opts.limit ?? 12;
  const ctx = cursorContext(source, cursor);
  if (ctx.inComment) return [];
  if (ctx.inString && !ctx.strExpr) return [];
  const functions = fig.functions ?? BUILTIN_FUNCTIONS;
  const word0 = ctx.word;
  const keep = limit + 12;
  const top: Completion[] = [];
  const consider = (c: Candidate): void => {
    const base = textScore(word0, c.label);
    if (word0 !== '' && base < 0) return;
    let score = Math.max(base, 0);
    if (expected && c.type && accepts(expected, c.type)) score += 300;
    else if (expected && expected.any) score += 100;
    if (c.recent !== undefined && c.recent < 10) score += 100 - 10 * c.recent;
    if (c.kind === 'command' && matchedForms.length > 0 && c.type && expected && accepts(expected, c.type)) score += 150;
    if (top.length >= keep && score <= (top[top.length - 1] as Completion).score) return;
    const out: Completion = {
      label: c.label,
      insert: c.insert,
      kind: c.kind,
      ...(c.detail !== undefined ? { detail: c.detail } : {}),
      ...(c.doc !== undefined ? { doc: c.doc } : {}),
      score,
    };
    let i = top.length;
    while (i > 0 && ((top[i - 1] as Completion).score < score || ((top[i - 1] as Completion).score === score && (top[i - 1] as Completion).label > c.label))) i--;
    top.splice(i, 0, out);
    if (top.length > keep) top.pop();
  };
  const cands = { push: (...cs: Candidate[]): void => cs.forEach(consider) };
  const toks = ctx.toks;
  const last = toks[toks.length - 1];
  const word = ctx.word;
  let expected: TypeSet | undefined;
  let matchedForms: readonly FormLike[] = [];

  const addObjects = (): void => {
    const names = fig.names();
    const start = word0 === '' && names.length > 300 ? names.length - 300 : 0;
    for (let i = start; i < names.length; i++) {
      const n = names[i] as string;
      if (word0 !== '' && textScore(word0, n) < 0) continue;
      const info = fig.lookup(n);
      cands.push({ label: n, insert: n, kind: 'object', ...(info ? { detail: tyStr(info.type), type: info.type } : {}), recent: names.length - 1 - i });
    }
  };
  const addCommands = (actions: boolean | 'only'): void => {
    for (const n of fig.commands.names()) {
      const spec = fig.commands.lookup(n);
      if (!spec) continue;
      if (actions === 'only' && spec.kind !== 'action') continue;
      if (actions === false && spec.kind === 'action') continue;
      const f0 = spec.forms[0] as CommandForm | undefined;
      cands.push({
        label: n,
        insert: `${n}(${f0 ? formParamPlaceholders(f0) : ''})`,
        kind: 'command',
        ...(f0 ? { detail: formText(n, f0), doc: f0.summary } : {}),
        type: f0 ? returnTy(f0) : undefined,
      });
    }
  };
  const addFunctions = (): void => {
    for (const n of functions.names()) {
      const spec = functions.lookup(n);
      const f0 = spec?.forms[0];
      cands.push({ label: n, insert: `${n}($1)`, kind: 'function', ...(f0 ? { detail: formText(n, f0), doc: f0.summary } : {}), type: tyOfFunctionName(functions, n) });
    }
  };
  const addConstants = (): void => {
    for (const c of BUILTIN_CONSTANTS) cands.push({ label: c.name, insert: c.name, kind: 'constant', detail: tyStr(c.type), doc: c.doc, type: c.type });
    cands.push({ label: 'true', insert: 'true', kind: 'constant', detail: 'Bool', type: T.Bool }, { label: 'false', insert: 'false', kind: 'constant', detail: 'Bool', type: T.Bool });
    cands.push({ label: 'undefined', insert: 'undefined', kind: 'constant', detail: 'Number' });
    for (const c of ['t', 'bt', 'beat']) cands.push({ label: c, insert: c, kind: 'constant', detail: 'Number', type: T.Number });
  };
  const addKeywords = (list: readonly string[]): void => {
    for (const k of list) cands.push({ label: k, insert: k, kind: 'keyword' });
  };

  const topFrame = ctx.frames[ctx.frames.length - 1];
  const withIdx = toks.findIndex((t) => t.kind === 'kw' && t.text === 'with');
  const afterDot = last && last.kind === 'op' && last.text === '.';
  const afterAt = last && last.kind === 'at' && last.e === ctx.wordStart;
  const afterIn = last && last.kind === 'kw' && last.text === 'in' && ctx.frames.length === 0;

  if (ctx.strExpr) {
    addObjects();
  } else if (afterAt || (toks.length === 1 && toks[0]?.kind === 'at')) {
    for (const d of [...Object.keys(DIRECTIVES), ...(fig.directives ?? [])]) cands.push({ label: d, insert: d, kind: 'directive', detail: (DIRECTIVES[d] ?? [])[0] ?? '@' + d });
  } else if (afterDot) {
    const before = toks[toks.length - 2];
    let ty: Ty | undefined;
    if (before && before.kind === 'name') ty = fig.lookup(before.name ?? before.text)?.type;
    const tables = ty ? [FIELDS[ty.k] ?? {}] : Object.values(FIELDS);
    const seen = new Set<string>();
    for (const tb of tables) {
      for (const [f, fty] of Object.entries(tb)) {
        if (seen.has(f)) continue;
        seen.add(f);
        cands.push({ label: f, insert: f, kind: 'field', detail: tyStr(fty), type: fty });
      }
    }
  } else if (afterIn) {
    cands.push({ label: 'lo..hi', insert: '$1..$2', kind: 'snippet', detail: 'range', doc: 'a slider range: in 0..10 step 0.5' });
  } else if (withIdx >= 0 && ctx.frames.length === 0 && last && ((last.kind === 'kw' && last.text === 'with') || (last.kind === 'op' && last.text === ','))) {
    for (const [k, spec] of Object.entries(PROPERTIES)) cands.push({ label: k, insert: `${k} = `, kind: 'property', detail: spec.allowed });
  } else if (withIdx >= 0 && ctx.frames.length === 0 && last && last.kind === 'op' && last.text === '=' && toks[toks.length - 2]?.kind === 'name') {
    const key = toks[toks.length - 2]?.name ?? '';
    const spec = PROPERTIES[key];
    if (spec?.values) for (const v of spec.values) cands.push({ label: v, insert: v, kind: 'property', detail: key });
    if (spec?.kind === 'color') {
      for (const v of COLOR_WORDS) cands.push({ label: v, insert: v, kind: 'property', detail: 'colour' });
      addObjects();
    }
    if (spec?.kind === 'bool') for (const v of ['true', 'false']) cands.push({ label: v, insert: v, kind: 'constant', detail: 'Bool' });
    if (spec?.expr) {
      addObjects();
      addFunctions();
    }
  } else if (toks.length === 0) {
    // start of line
    cands.push({ label: '@', insert: '@', kind: 'directive', detail: 'directive' }, { label: '#', insert: '#', kind: 'snippet', detail: 'comment' });
    cands.push({ label: 'name = …', insert: '$1 = $2', kind: 'snippet', detail: 'define an object' });
    cands.push({ label: 'f(x) = …', insert: 'f(x) = $1', kind: 'snippet', detail: 'define a function' });
    cands.push({ label: 'a = 1 in 0..10', insert: '$1 = 1 in 0..10 step 0.5', kind: 'snippet', detail: 'make a slider' });
    addCommands('only');
    if (word !== '') {
      addObjects();
      // `A with …`, `a in …`
    }
  } else if (topFrame && topFrame.callee !== undefined && topFrame.callee !== 'if' && (specForms(fig, topFrame.callee) !== undefined)) {
    const ex = expectedSetAt(fig, topFrame, ctx);
    expected = ex.set;
    matchedForms = ex.matched;
    addObjects();
    addCommands(false);
    addFunctions();
    addConstants();
    // named parameters
    const k = topFrame.commas.length;
    const seenParams = new Set<string>();
    for (const f of matchedForms) {
      for (const p of f.params.slice(k)) {
        if (seenParams.has(p.name)) continue;
        seenParams.add(p.name);
        cands.push({ label: `${p.name} =`, insert: `${p.name} = `, kind: 'property', detail: `parameter ${p.type}` });
      }
    }
  } else {
    addObjects();
    addCommands(false);
    addFunctions();
    addConstants();
    addKeywords(KEYWORD_NAMES.filter((k) => ['and', 'or', 'not', 'xor', 'if'].includes(k)));
    if (last && last.kind !== 'op') addKeywords(['in', 'with', 'step']);
  }

  const seen = new Set<string>();
  const result: Completion[] = [];
  for (const s of top) {
    const key = `${s.kind}:${s.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(s);
    if (result.length >= limit) break;
  }
  void CONSTANT_NAMES;
  return result;
}

/* -------------------------------- highlighting -------------------------------- */

export type HighlightKind =
  | 'number' | 'string' | 'operator' | 'comment' | 'directive' | 'keyword' | 'command' | 'function' | 'constant' | 'object' | 'unknown' | 'name' | 'error';

export interface HighlightToken {
  readonly kind: HighlightKind;
  readonly text: string;
  readonly line: number;
  readonly col: number;
  readonly endCol: number;
}

/**
 * Tokens with their classes for syntax colouring, in the columns of the text sent (design 3.3,
 * ui.md section 2). Without a figure, names are plain `name`. Never throws.
 */
export function tokenize(source: string, fig?: FigureView): { tokens: HighlightToken[]; errors: LanguageError[] } {
  try {
    const sm = new SourceMap(source);
    const r = lex(sm);
    const functions = fig?.functions ?? BUILTIN_FUNCTIONS;
    const consts = new Set([...CONSTANT_NAMES, 'true', 'false', 't', 'bt', 'beat', 'xaxis', 'yaxis', 'zaxis']);
    const out: HighlightToken[] = [];
    const toks = r.tokens.filter((t) => t.kind !== 'eof' && t.kind !== 'nl');
    toks.forEach((t, i) => {
      const sp = sm.span(t.s, t.e);
      let kind: HighlightKind;
      switch (t.kind) {
        case 'num':
          kind = 'number';
          break;
        case 'str':
          kind = 'string';
          break;
        case 'comment':
          kind = 'comment';
          break;
        case 'kw':
          kind = 'keyword';
          break;
        case 'at':
          kind = 'directive';
          break;
        case 'bad':
          kind = 'error';
          break;
        case 'sqrt':
          kind = 'function';
          break;
        case 'name': {
          const name = t.name ?? t.text;
          const next = toks[i + 1];
          const isCall = next !== undefined && next.kind === 'op' && next.text === '(';
          const prev = toks[i - 1];
          if (prev && prev.kind === 'at' && prev.e === t.s) kind = 'directive';
          else if (isCall && /^[A-Z]/.test(name)) kind = 'command';
          else if (isCall && functions.lookup(name)) kind = 'function';
          else if (consts.has(name)) kind = 'constant';
          else if (!fig) kind = 'name';
          else kind = fig.lookup(name) ? 'object' : 'unknown';
          break;
        }
        default:
          kind = 'operator';
      }
      out.push({ kind, text: sp.token, line: sp.line, col: sp.col, endCol: sp.endCol });
    });
    return { tokens: out, errors: r.errors };
  } catch {
    return { tokens: [], errors: [] };
  }
}

/**
 * The one engine that runs every tool (docs/features/tools-2d/design.md 5). A `ToolSession` takes clicks, keys and
 * typed numbers, narrows the tool's variants as picks arrive, and ends with the lines to apply as one batch. It is pure:
 * no DOM, no kernel, no clock. New points live only in the session until the tool completes.
 */
import { allocate, definedName } from './names';
import { PATH_TYPES } from './types';
import type { Arg, EmitContext, Hit, Pt, Slot, ToolDone, ToolHost, ToolRefusal, ToolSpec, ToolVariant } from './types';

interface Branch {
  readonly variant: ToolVariant;
  readonly args: readonly Arg[];
}

/** What the session says after an input. */
export type StepResult = ToolRefusal | ToolDone | { readonly ok: true; readonly done?: undefined; readonly cancel?: boolean };

/** A new point a click made, held in the session (drawn as a hollow ring). */
export interface PendingPoint {
  readonly tag: string;
  readonly line: string;
  readonly at: Pt;
  readonly how: 'free' | 'on-path' | 'intersection';
  /** Where it sits, for the hover label: "on c", "crossing of a and b". */
  readonly where: string;
}

const round = (v: number, step: number): number => {
  const r = Math.round(v / step) * step;
  return Number(r.toPrecision(12));
};

/** Does a slot that accepts these type names take an object of type `t`? */
export function accepts(accept: readonly string[], t: string): boolean {
  if (accept.includes('Any') || accept.includes(t)) return true;
  const base = /^(\w+)/.exec(t)?.[1] ?? t;
  if (accept.includes(base)) return true;
  if (accept.includes('Shape')) return ['Point', 'Segment', 'Ray', 'Line', 'Circle', 'Arc', 'Sector', 'Conic', 'Polygon', 'Polyline', 'Curve', 'Vector'].includes(base);
  if (accept.includes('Path')) return PATH_TYPES.includes(base);
  return false;
}

const article = (t: string): string => (/^[AEIOU]/.test(t) ? 'an' : 'a');
const words = (ts: readonly string[]): string => {
  const w = ts.map((t) => t.toLowerCase());
  return w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`;
};

/** The slider line for a typed literal under Alt: a range that holds the value with room to move (design 7.5). */
function sliderLine(v: number, slot: Extract<Slot, { kind: 'number' }>): string {
  const [lo0, hi0] = slot.range ?? [-Infinity, Infinity];
  const mag = Math.max(1, Math.abs(v));
  const p = Math.pow(10, Math.floor(Math.log10(mag)));
  const top = Math.ceil((mag * 2) / p) * p;
  const lo = Math.max(lo0, v >= 0 ? 0 : -top);
  const hi = Math.min(hi0, top);
  const step = slot.integer ? 1 : Number((p / 10).toPrecision(3));
  return `{number#slider} = ${v} in ${lo}..${hi} step ${step}`;
}

export class ToolSession {
  private branches: Branch[];
  private readonly history: Branch[][] = [];
  private readonly made = new Map<string, PendingPoint>();
  private counter = 0;
  /** The visible box; tools that scan the view read it. Grid step for free points: 1/100 of the view's width, rounded. */
  view = { x0: -10, x1: 10, y0: -10, y1: 10 };
  /** Alt held on the last input: the tool's alternative, and "use slider" for a typed literal (design 7.5, ui.md 2). */
  private alt = false;
  /** The most points a repeating tool takes (errors.md 6). */
  static readonly MAX_PENDING = 200;

  constructor(readonly spec: ToolSpec, private readonly host: ToolHost) {
    this.branches = spec.variants.map((variant) => ({ variant, args: [] }));
  }

  /* ------------------------------ state ------------------------------ */

  /** How many picks so far. */
  get step(): number {
    return this.branches[0]?.args.length ?? 0;
  }

  /** The variants still possible. */
  get alive(): readonly string[] {
    return this.branches.map((b) => b.variant.id);
  }

  /** The picks so far (of the first variant still possible). */
  get picks(): readonly Arg[] {
    return this.branches[0]?.args ?? [];
  }

  /** New points made so far, for the overlay. */
  pending(): PendingPoint[] {
    const used = new Set(this.branches.flatMap((b) => b.args.map((a) => a.text)));
    return [...this.made.values()].filter((p) => used.has(p.tag));
  }

  private slotOf(b: Branch): Slot | undefined {
    const n = b.args.length;
    const fixed = b.variant.slots.length;
    if (n < fixed) return b.variant.slots[n];
    const t = b.variant.tail;
    return t && n - fixed < t.max ? t.slot : undefined;
  }

  private full(b: Branch): boolean {
    const t = b.variant.tail;
    const n = b.args.length - b.variant.slots.length;
    return t ? n >= t.max : n >= 0;
  }

  private closable(b: Branch): boolean {
    const t = b.variant.tail;
    const n = b.args.length - b.variant.slots.length;
    return t ? n >= t.min : n >= 0;
  }

  /** The next step's words: "Circle through 3 points: click the second point." */
  prompt(): string {
    const b = this.branches[0];
    const s = b ? this.slotOf(b) : undefined;
    const close = this.branches.some((x) => x.variant.tail && this.closable(x)) ? ' (Enter or the first point to finish)' : '';
    return `${this.spec.label}: ${s ? s.prompt : 'press Enter to finish'}${close}`;
  }

  /** The number slot waiting for typed input, if any. */
  awaitingNumber(): Extract<Slot, { kind: 'number' }> | undefined {
    for (const b of this.branches) {
      const s = this.slotOf(b);
      if (s?.kind === 'number') return s;
    }
    return undefined;
  }

  private refuse(code: ToolRefusal['code'], message: string, hint: string, extra: { accepted?: readonly string[]; got?: readonly string[] } = {}): ToolRefusal {
    const b = this.branches[0];
    const s = b ? this.slotOf(b) : undefined;
    return { ok: false, source: 'tool', code, tool: this.spec.id, step: this.step, prompt: s?.prompt ?? '', message, hint, ...extra };
  }

  /* ------------------------------ picks ------------------------------ */

  private gridStep(): number {
    const raw = (this.view.x1 - this.view.x0) / 400;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p;
  }

  /** A point slot: existing, intersection, on a path or free, in that order and only as the slot allows (5.3). */
  private resolvePoint(slot: Extract<Slot, { kind: 'point' }>, at: Pt, hits: readonly Hit[], picked: readonly Arg[]): { arg: Arg; point?: PendingPoint } | ToolRefusal {
    const allow = new Set(slot.create);
    const existing = hits.find((h) => h.type === 'Point');
    if (existing && allow.has('existing')) {
      if (picked.some((p) => p.text === existing.name)) return this.refuse('already_picked', 'You already chose this point.', 'Pick a different point.');
      const p = this.made.get(existing.name);
      return { arg: { text: existing.name, type: 'Point', ...(p ? { at: p.at, made: true } : {}) } };
    }
    const paths = hits.filter((h) => accepts(['Path'], h.type));
    const uniq = paths.filter((h, i) => paths.findIndex((x) => x.name === h.name) === i);
    const tag = (): string => `{point#${++this.counter}}`;
    if (allow.has('intersection') && uniq.length >= 2) {
      for (let i = 0; i < Math.min(uniq.length, 3); i++) {
        for (let j = i + 1; j < Math.min(uniq.length, 3); j++) {
          const a = (uniq[i] as Hit).name;
          const b = (uniq[j] as Hit).name;
          const x = this.host.nearestIntersection(a, b, at);
          if (!x) continue;
          const t = tag();
          const line = `${t} = Intersect(${a}, ${b}${x.index === undefined ? '' : `, ${x.index}`})`;
          const point: PendingPoint = { tag: t, line, at: x.at, how: 'intersection', where: `crossing of ${a} and ${b}` };
          return { arg: { text: t, type: 'Point', at: x.at, made: true }, point };
        }
      }
    }
    const path = uniq[0];
    if (allow.has('on-path') && path) {
      const u = this.host.paramOn(path.name, at);
      if (u !== undefined) {
        const t = tag();
        const point: PendingPoint = { tag: t, line: `${t} = PointOn(${path.name}, ${Number(u.toPrecision(6))})`, at, how: 'on-path', where: `on ${path.name}` };
        return { arg: { text: t, type: 'Point', at, made: true }, point };
      }
    }
    if (allow.has('free')) {
      const g = this.gridStep();
      const p = { x: round(at.x, g), y: round(at.y, g) };
      const t = tag();
      const point: PendingPoint = { tag: t, line: `${t} = (${p.x}, ${p.y})`, at: p, how: 'free', where: '' };
      return { arg: { text: t, type: 'Point', at: p, made: true }, point };
    }
    if (allow.has('on-path')) return this.refuse('not_a_path', 'A point can only sit on a line, curve or edge.', 'Click on the edge.');
    return this.refuse(hits.length ? 'wrong_type' : 'no_target', 'No point under the pointer.', 'Click a point.', { accepted: ['Point'], got: hits.map((h) => h.type) });
  }

  private resolveObject(slot: Extract<Slot, { kind: 'object' }>, hits: readonly Hit[], picked: readonly Arg[]): { arg: Arg } | ToolRefusal {
    const ok = hits.filter((h) => accepts(slot.accept, h.type));
    const fresh = slot.distinct === false ? ok : ok.filter((h) => !picked.some((p) => p.text === h.name));
    const h = fresh[0];
    if (h) return { arg: { text: h.name, type: h.type, ...(this.made.get(h.name) ? { at: (this.made.get(h.name) as PendingPoint).at, made: true } : {}) } };
    if (ok.length > 0) return this.refuse('already_picked', `You already chose ${ok[0]?.name}.`, 'Pick a different one.');
    const want = words(slot.accept);
    if (hits.length === 0) return this.refuse('no_target', `No ${slot.accept[0]?.toLowerCase() ?? 'object'} under the pointer.`, `Click ${article(slot.accept[0] ?? '')} ${want}.`, { accepted: slot.accept });
    const got = hits[0] as Hit;
    return this.refuse('wrong_type', `That is ${article(got.type)} ${got.type.toLowerCase()}. This step needs ${article(slot.accept[0] ?? '')} ${want}.`, `Click ${article(slot.accept[0] ?? '')} ${want}.`, { accepted: slot.accept, got: hits.map((x) => x.type) });
  }

  /** A click in maths coordinates with the objects under the pointer, nearest first. */
  click(at: Pt, hits: readonly Hit[], opts: { readonly alt?: boolean } = {}): StepResult {
    this.alt = opts.alt === true;
    if (this.awaitingNumber()) return this.refuse('bad_number', 'Type the number first.', 'Press Enter to accept it, or Esc to cancel.');
    // a click on the first point of a repeating tool closes it (polygon)
    for (const b of this.branches) {
      const t = b.variant.tail;
      const first = b.args[b.variant.slots.length];
      if (t?.closeOnFirst && first && this.closable(b) && hits.some((h) => h.name === first.text)) return this.finish(b);
    }
    let firstRefusal: ToolRefusal | undefined;
    const next: { b: Branch; arg: Arg; point?: PendingPoint; object: boolean }[] = [];
    for (const b of this.branches) {
      const s = this.slotOf(b);
      if (!s) continue;
      let r: { arg: Arg; point?: PendingPoint } | ToolRefusal;
      if (s.kind === 'point') r = this.resolvePoint(s, at, hits, b.args);
      else if (s.kind === 'object') r = this.resolveObject(s, hits, b.args);
      else if (s.kind === 'position') r = { arg: { text: `(${round(at.x, this.gridStep())}, ${round(at.y, this.gridStep())})`, type: 'Position', at } };
      else continue;
      if ('ok' in r) {
        firstRefusal ??= r;
        continue;
      }
      next.push({ b, ...r, object: !r.arg.made || s.kind === 'object' });
    }
    if (next.length === 0) return firstRefusal ?? this.refuse('no_target', 'Nothing to pick here.', 'Follow the hint line.');
    // an object pick beats making a new point: clicking a segment in Angle picks the segment (5.2)
    const keep = next.some((n) => n.object) ? next.filter((n) => n.object) : next;
    if (this.pending().length >= ToolSession.MAX_PENDING) return this.refuse('limit', 'This tool has made as many points as it can.', 'Press Enter to finish.');
    this.history.push(this.branches);
    // all branches that made a point here share the first one made
    const shared = keep.find((k) => k.point)?.point;
    if (shared) this.made.set(shared.tag, shared);
    this.branches = keep.map((k) => ({ variant: k.b.variant, args: [...k.b.args, k.point && shared ? { ...k.arg, text: shared.tag, at: shared.at } : k.arg] }));
    return this.settle();
  }

  /** A typed number for the waiting number slot: a formula or a name, checked by the language (7.5). */
  entry(text: string, opts: { readonly alt?: boolean } = {}): StepResult {
    this.alt = opts.alt === true;
    const slot = this.awaitingNumber();
    if (!slot) return { ok: true };
    let src = text.trim().replace(/°$/, 'deg');
    if (src === '' && slot.def !== undefined) src = String(slot.def);
    const r = this.host.checkNumber(src);
    if (!r.ok) return this.refuse('bad_number', r.message, r.hint ?? 'Type a number, such as 3 or 2*r.');
    const [lo, hi] = slot.range ?? [-Infinity, Infinity];
    if ((slot.integer && !Number.isInteger(r.value)) || r.value < lo || r.value > hi) {
      const what = slot.integer ? `a whole number from ${lo} to ${hi}` : `from ${lo} to ${hi}`;
      return this.refuse('number_out_of_range', `${slot.prompt.replace(/^Type (the )?/, '').replace(/\.$/, '')} must be ${what}.`, `Type ${what}.`);
    }
    this.history.push(this.branches);
    // Alt on a typed literal makes it a slider and uses its name (design 7.5): `r = 3 in 0..10`
    const literal = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(src);
    const arg: Arg = this.alt && literal ? { text: '{number#slider}', type: 'Number', value: r.value, slider: sliderLine(r.value, slot) } : { text: src, type: 'Number', value: r.value };
    this.branches = this.branches.filter((b) => this.slotOf(b)?.kind === 'number').map((b) => ({ variant: b.variant, args: [...b.args, arg] }));
    return this.settle();
  }

  /** Esc drops the last pick, or leaves the tool; Backspace drops the last pick; Enter closes a repeating tool. */
  key(k: 'Enter' | 'Escape' | 'Backspace'): StepResult {
    if (k === 'Enter') {
      const b = this.branches.find((x) => x.variant.tail && this.closable(x)) ?? this.branches.find((x) => this.closable(x) && !x.variant.tail);
      if (b) return this.finish(b);
      const t = this.branches.find((x) => x.variant.tail);
      if (t?.variant.tail) return this.refuse('too_few', `This needs at least ${t.variant.tail.min + t.variant.slots.length} picks.`, 'Keep clicking.');
      return { ok: true };
    }
    const prev = this.history.pop();
    if (!prev) return k === 'Escape' ? { ok: true, cancel: true } : { ok: true };
    this.branches = prev;
    return { ok: true };
  }

  /** Objects selected before the tool started, used as picks in selection order (5.4). */
  preselect(names: readonly string[]): StepResult {
    let last: StepResult = { ok: true };
    for (const n of names) {
      const t = this.host.typeOf(n);
      if (!t) continue;
      const before = this.step;
      const r = this.click({ x: 0, y: 0 }, [{ name: n, type: t, dist: 0 }]);
      // a selected object that fits no slot is ignored; a point slot must not make a new point from it
      if (!r.ok || this.picks[this.picks.length - 1]?.made) {
        if (this.step > before) this.key('Backspace');
        continue;
      }
      last = r;
      if ('lines' in r) return r;
    }
    return last;
  }

  /** What a click at `at` would make, without changing the session: the lines and their result names. */
  preview(at: Pt, hits: readonly Hit[]): ToolDone | undefined {
    if (this.awaitingNumber() || this.spec.kind === 'mode' || this.spec.kind === 'edit') return undefined;
    const copy = this.clone();
    const r = copy.click(at, hits);
    if (r.ok && 'lines' in r) return r;
    if (!r.ok) return undefined;
    const b = copy.branches.find((x) => x.variant.tail && copy.closable(x));
    if (b) {
      const f = copy.finish(b);
      if (f.ok && 'lines' in f) return f;
    }
    return undefined;
  }

  private clone(): ToolSession {
    const s = new ToolSession(this.spec, this.host);
    s.branches = this.branches;
    s.counter = this.counter;
    s.view = this.view;
    for (const [k, v] of this.made) s.made.set(k, v);
    return s;
  }

  /** After a pick: complete when exactly the full variants are left (5.2). */
  private settle(): StepResult {
    const full = this.branches.filter((b) => this.full(b));
    if (full.length > 0 && full.length === this.branches.length) return this.finish(full[0] as Branch);
    return { ok: true };
  }

  private finish(b: Branch): StepResult {
    const used = new Set(b.args.map((a) => a.text));
    const pointLines = [...this.made.values()].filter((p) => used.has(p.tag)).map((p) => p.line);
    if (b.variant.act) {
      const action = b.variant.act(b.args);
      this.reset();
      return { ok: true, tool: this.spec.id, variant: b.variant.id, lines: [], results: [], points: [], action };
    }
    const ctx: EmitContext = { view: this.view, intersections: (x, y) => this.host.intersections(x, y), alt: this.alt };
    // a list of picks in a line (A, B, C) or a list literal
    const sliders = b.args.flatMap((a) => (a.slider ? [a.slider] : []));
    const own = [...sliders, ...(b.variant.emit ? b.variant.emit(b.args, ctx) : [])];
    // the point tools write only their new point; picking a point that is already there makes nothing
    if (own.length === 0 && pointLines.length === 0) return this.refuse('already_picked', 'That point is already there.', 'Click empty space, a path or a crossing.');
    const { lines } = allocate([...pointLines, ...own], (n) => this.host.nameFree(n));
    const points = lines.slice(0, pointLines.length).map((l) => definedName(l) as string);
    const results = lines.slice(pointLines.length).map(definedName).filter((n): n is string => n !== undefined);
    const alt = this.alt;
    this.reset();
    return { ok: true, tool: this.spec.id, variant: b.variant.id, lines, results, points, ...(alt ? { alt: true } : {}) };
  }

  /**
   * Moves a pending free point before the next click (design 7.2: press, drag, release), snapped to the grid.
   * Points on a path or at a crossing stay where they are. Returns false when `tag` is not a free pending point.
   */
  movePending(tag: string, at: Pt): boolean {
    const p = this.made.get(tag);
    if (!p || p.how !== 'free') return false;
    const g = this.gridStep();
    const q = { x: round(at.x, g), y: round(at.y, g) };
    this.made.set(tag, { ...p, at: q, line: `${tag} = (${q.x}, ${q.y})` });
    const move = (b: Branch): Branch => ({ variant: b.variant, args: b.args.map((a) => (a.text === tag ? { ...a, at: q } : a)) });
    this.branches = this.branches.map(move);
    for (let i = 0; i < this.history.length; i++) this.history[i] = (this.history[i] as Branch[]).map(move);
    return true;
  }

  /** Back to the first step (a sticky tool starts again). */
  reset(): void {
    this.branches = this.spec.variants.map((variant) => ({ variant, args: [] }));
    this.history.length = 0;
    this.made.clear();
  }
}

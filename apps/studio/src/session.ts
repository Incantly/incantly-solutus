/**
 * The studio's session: one kernel `Figure`, and the bookkeeping the screen needs around it (rows for the line list, the
 * outcome of each action as text or an error object, the clock). It uses only the kernel's public API.
 */
import { Figure, numberSource, valueText } from '@incantly/kernel';
import type { CommandRegistry, ErrorObject, ObjectView } from '@incantly/kernel';
import { rightSide } from '@incantly/ui';
import type { CauseLink, LineRow, RowControl, SubmitResult } from '@incantly/ui';
import { studioRegistry } from './registry';

/** What an action reports: a sentence for the status line (plus notices), or the error object. */
export type Outcome = { readonly ok: true; readonly message: string; readonly notices: readonly string[] } | { readonly ok: false; readonly error: ErrorObject };

export interface UndoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** What undo would take back, for the button's name. */
  readonly label: string | undefined;
  readonly redoDepth: number;
}

export interface LoadOutcome {
  /** Lines applied. */
  readonly applied: number;
  readonly total: number;
  readonly errors: readonly ErrorObject[];
  /** False when nothing usable came out and the current figure was kept. */
  readonly replaced: boolean;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const READS_CLOCK = /(?<![\w.'])(?:t|bt|beat)(?![\w(])/;

/** The value a text means for a free object of this type, or `undefined` when it is not a plain value of that type. */
export function parseFree(type: string, text: string): unknown {
  const t = text.trim().replace(/−/g, '-');
  if (type === 'Number') return NUMBER.test(t) ? Number(t) : undefined;
  if (type === 'Bool') return t === 'true' ? true : t === 'false' ? false : undefined;
  if (type === 'Point') {
    const m = /^\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)$/.exec(t);
    return m && NUMBER.test(m[1] as string) && NUMBER.test(m[2] as string) ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
  }
  return undefined;
}

export class KernelSession {
  figure: Figure;
  private readonly commands: CommandRegistry;
  private off: (() => void) | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(commands: CommandRegistry = studioRegistry()) {
    this.commands = commands;
    this.figure = new Figure({ commands });
    this.watch();
  }

  /** Called after every kernel event (a line, a value, a rename, undo, the clock). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Goes up when a directive line (`@algebra …`, `@seed …`) changes or a script is loaded, so readers of the script's
   * directives need not print the whole script on every change. */
  directiveVersion = 0;
  /** Goes up on every change except a value or the clock: objects added, removed, renamed, restyled or reordered. */
  structureVersion = 0;

  private watch(): void {
    this.off?.();
    this.directiveVersion++;
    this.structureVersion++;
    this.off = this.figure.on((ev) => {
      if (ev.ev === 'directive' || ev.ev === 'undo' || ev.ev === 'redo') this.directiveVersion++;
      // anything but a value or the clock may change which rows there are, their order, names or links
      if (ev.ev !== 'value' && ev.ev !== 'clock' && ev.ev !== 'step') this.structureVersion++;
      this.emit();
    });
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private done(message: string, notices: readonly { readonly message: string }[]): Outcome {
    return { ok: true, message, notices: notices.map((n) => n.message) };
  }

  /* ------------------------------ lines ------------------------------ */

  /** The input line's handler: one line through `apply`. A failing line changes nothing. */
  submit(source: string): SubmitResult {
    const r = this.figure.apply(source.trim());
    if (!r.ok) return { ok: false, error: r };
    return { ok: true, announcement: [r.summary, ...r.notices.map((n) => n.message)].join('. ') };
  }

  /** Several lines as one undo step; every line applies or fails on its own (the teacher's `draw`). */
  applyLines(lines: readonly string[], label: string, mode: 'independent' | 'atomic' = 'independent'): Outcome {
    const r = this.figure.applyBatch(lines, { group: label, mode });
    if (mode === 'atomic' && !r.ok) {
      const bad = r.results.find((x) => !x.ok);
      if (bad && !bad.ok) return { ok: false, error: bad };
    }
    const failed = r.results.length - r.applied;
    return this.done(failed > 0 ? `${label}: ${r.applied} of ${r.results.length} lines applied` : `${label}: ${r.applied} lines applied`, r.notices);
  }

  /* ------------------------------ rows ------------------------------ */

  rows(): LineRow[] {
    return this.figure.objects().map((v) => this.rowOf(v));
  }

  /** One row, by object id: the list builds only the rows in view. */
  row(id: number): LineRow | undefined {
    const v = this.figure.get(id as never);
    return v ? this.rowOf(v) : undefined;
  }

  private rowOf(v: ObjectView): LineRow {
    const cell = v.cell;
    const source = v.free && cell.defined ? this.freeSource(v) : v.definition;
    const base = { id: v.id, name: v.name, type: v.typeText, source, ...(v.free ? { free: true } : {}), ...(v.style.fixed ? { locked: true } : {}) };
    if (cell.defined) {
      const isFunction = v.type === 'Function';
      const control = v.free ? this.controlOf(v, cell.value) : undefined;
      return { ...base, ...(control ? { control } : {}), state: { defined: true, value: isFunction ? rightSide(source) : valueText(cell.value) } };
    }
    const cause = this.causeChain(v);
    return { ...base, state: { defined: false, reason: cell.reason, ...(cell.detail ? { detail: cell.detail } : {}), cause } };
  }

  /** A free object prints as its current value, as `toScript` does, so an edit in place shows in the row. */
  private freeSource(v: ObjectView): string {
    // lists and other literals keep their full text: a preview would cut them short
    if (v.type !== 'Number' && v.type !== 'Point' && v.type !== 'Bool') return v.definition;
    const value = v.cell.defined ? v.cell.value : undefined;
    let lit = valueText(value);
    if (typeof value === 'number') lit = numberSource(value);
    else if (v.type === 'Point') {
      const p = value as { x: number; y: number };
      lit = `(${numberSource(p.x)}, ${numberSource(p.y)})`;
    }
    const r = v.range;
    const range = r ? ` in ${numberSource(r.min)}..${numberSource(r.max)}${r.step !== undefined ? ` step ${numberSource(r.step)}` : ''}` : '';
    return `${v.name} = ${lit}${range}`;
  }

  private controlOf(v: ObjectView, value: unknown): RowControl | undefined {
    if (v.type === 'Number' && typeof value === 'number') {
      if (v.range) return { kind: 'slider', min: v.range.min, max: v.range.max, ...(v.range.step !== undefined ? { step: v.range.step } : {}), value, text: valueText(value) };
      return { kind: 'text', text: valueText(value) };
    }
    if (v.type === 'Point') return { kind: 'text', text: valueText(value) };
    if (v.type === 'Bool' && typeof value === 'boolean') return { kind: 'bool', checked: value };
    return undefined;
  }

  /** From the nearest undefined input to the root (the kernel's `cause` links), ending with `rootCause`. */
  private causeChain(v: ObjectView): CauseLink[] {
    const out: CauseLink[] = [];
    const seen = new Set<number>([v.id]);
    let cell = v.cell;
    while (!cell.defined && cell.cause !== undefined && !seen.has(cell.cause)) {
      seen.add(cell.cause);
      const next = this.figure.get(cell.cause);
      if (!next || next.cell.defined) break;
      out.push({ name: next.name, reason: next.cell.reason, ...(next.cell.detail ? { detail: next.cell.detail } : {}) });
      cell = next.cell;
    }
    const root = this.figure.rootCause(v.id);
    if (root && root.name !== v.name && out[out.length - 1]?.name !== root.name) out.push({ name: root.name, reason: root.reason });
    return out;
  }

  /* ------------------------------ edits ------------------------------ */

  rename(name: string, to: string): Outcome {
    const r = this.figure.rename(name, to.trim());
    return r.ok ? this.done(`Renamed ${name} to ${to.trim()}`, r.notices) : { ok: false, error: r };
  }

  /** The objects a delete would remove, the object first. */
  deletePlan(name: string): readonly string[] {
    return this.figure.deletePlan(name);
  }

  delete(name: string): Outcome {
    const r = this.figure.delete(name);
    if (!r.ok) return { ok: false, error: r };
    const gone = r.changed.removed;
    return this.done(gone.length > 1 ? `Deleted ${gone.join(', ')}` : `Deleted ${name}`, r.notices);
  }

  /** A value typed into a free object's field. A plain value of the object's type is a `setFree`; any other text is a line. */
  setText(name: string, text: string): Outcome {
    const v = this.figure.get(name);
    if (!v) {
      const e = this.figure.setFree(name, 0, 'api');
      return e.ok ? this.done('', []) : { ok: false, error: e };
    }
    const value = v.free ? parseFree(v.type, text) : undefined;
    if (value === undefined) {
      const r = this.figure.apply(`${name} = ${text.trim()}`);
      return r.ok ? this.done(r.summary, r.notices) : { ok: false, error: r };
    }
    const r = this.figure.setFree(name, value, 'api');
    if (!r.ok) return { ok: false, error: r };
    this.figure.flush();
    return this.done(`${name} = ${text.trim()}`, []);
  }

  /** A slider moved. The gesture is one undo step: `done` commits it. */
  slide(name: string, value: number, done: boolean): Outcome {
    const r = this.figure.setFree(name, value, 'slider');
    if (!r.ok) return { ok: false, error: r };
    this.figure.flush();
    if (!done) return this.done(`${name} = ${valueText(value)}`, []);
    this.figure.commitDrag();
    return this.done(`${name} = ${valueText(value)}`, []);
  }

  /** A free point dragged on the graph. The gesture is one undo step: `done` commits it. */
  /** True when dragging the point moves it: a free point, or one whose rule can be inverted (a point on a path). */
  draggable(name: string): boolean {
    const o = this.figure.get(name);
    if (!o || o.type !== 'Point' || !o.cell.defined) return false;
    return o.free || this.figure.dragPlan(name, o.cell.value).writes.length > 0;
  }

  dragPoint(name: string, x: number, y: number, done: boolean): Outcome {
    const round = (v: number): number => Number(v.toPrecision(6));
    if (!this.figure.get(name)?.free) {
      // a point on a path, or a midpoint of free points: move what it is built from (kernel design 7)
      const plan = this.figure.dragPlan(name, { x, y });
      const r = this.figure.drag(plan);
      if (!r.ok) return { ok: false, error: { ok: false, kind: 'not_draggable', message: `${name} cannot be dragged: ${String(r.reason ?? plan.reason ?? 'its rule cannot be inverted').replace(/_/g, ' ')}.` } as never };
      if (done) this.figure.commitDrag();
      return this.done(`moved ${name}`, []);
    }
    const r = this.figure.setFree(name, { x: round(x), y: round(y) }, 'drag');
    if (!r.ok) return { ok: false, error: r };
    this.figure.flush();
    if (done) this.figure.commitDrag();
    return this.done(`${name} = (${valueText(round(x))}, ${valueText(round(y))})`, []);
  }

  /* ------------------------------ history ------------------------------ */

  undoState(): UndoState {
    const i = this.figure.undoInfo();
    return { canUndo: i.depth > 0, canRedo: i.redoDepth > 0, label: i.next, redoDepth: i.redoDepth };
  }

  undo(): Outcome {
    const label = this.figure.undoInfo().next;
    const r = this.figure.undo({});
    return r.ok ? this.done(`Undid: ${label ?? r.summary}`, r.notices) : { ok: false, error: r };
  }

  redo(): Outcome {
    const r = this.figure.redo();
    return r.ok ? this.done(`Redid: ${r.summary}`, r.notices) : { ok: false, error: r };
  }

  /* ------------------------------ files ------------------------------ */

  save(): string {
    return this.figure.toScript();
  }

  /** Replaces the figure with the script's. When nothing in it could be used, the current figure stays. */
  load(text: string): LoadOutcome {
    const { figure, report } = Figure.fromScript(text, { commands: this.commands });
    const total = report.applied + report.skipped;
    const usable = report.ok || report.applied > 0;
    if (usable) {
      this.figure = figure;
      this.watch();
      this.emit();
    }
    return { applied: report.applied, total, errors: report.errors, replaced: usable };
  }

  /* ------------------------------ clock ------------------------------ */

  /** True when some object reads `t`: a definition that mentions it, confirmed by a `slice` from the clock. */
  hasClock(): boolean {
    for (const v of this.figure.objects()) {
      if (!READS_CLOCK.test(v.definition.replace(/"(?:[^"\\]|\\.)*"/g, '""'))) continue;
      const s = this.figure.slice('t', v.id);
      if ('chain' in s && s.chain.length > 0) return true;
    }
    return false;
  }

  time(): number {
    return this.figure.view.clock?.().t ?? 0;
  }

  range(): { from: number; to: number } {
    return this.figure.clockRange();
  }

  /** Moves the clock; the kernel clamps it to the film range. */
  setTime(t: number): Outcome {
    const r = this.figure.setClock(t);
    return 'ok' in r && r.ok === false ? { ok: false, error: r } : this.done(`t = ${valueText(this.time())}`, []);
  }
}

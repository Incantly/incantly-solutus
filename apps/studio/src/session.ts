/**
 * The studio's session: one kernel `Figure`, and the bookkeeping the screen needs around it (rows for the line list, the
 * outcome of each action as text or an error object, the clock). It uses only the kernel's public API.
 */
import { PhysicsWorkerHost, browserPhysicsChannel } from '@incantly/sdk/worker';
import type { PhysicsChannel } from '@incantly/sdk/worker';
import {
  CAS_COMMAND_NAMES, Figure, animatingIds, onCasEngine, brokenSteps, buttonLabelOf, captionsOf, choiceStateOf, clickButton, commitInputText, defaultCaption, getStoredHandler,
  inputErrorOf, inputNoticeOf, targetTextOf, inputTextOf, isClickable, listHandlers, numberSource, playerOf, runHandler, runLoadHandlers, setChoiceIndex,
  toggleCheckbox, tracedIds, typeInputText, valueText, isMuted, setMuted, space,
  physics,
} from '@incantly/kernel';
import type { HandlerEvent, HandlerRun, Player } from '@incantly/kernel';
import type { CommandRegistry, ErrorObject, LineGate, LineOrigin, ObjectView } from '@incantly/kernel';
import { rightSide } from '@incantly/ui';
import type { CauseLink, LineRow, RowControl, SubmitResult } from '@incantly/ui';
import { loadCasEngine, onCasAnswer, studioRegistry } from './registry';

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
  /** The app mode's gate (app-modes design 3.1): kept across a new or loaded figure. */
  private gate: LineGate | undefined;

  /** Installs the mode's line gate on this figure and every figure loaded after it. */
  setGate(gate: LineGate | undefined): void {
    this.gate = gate;
    this.figure.setGate(gate);
  }

  get registry(): CommandRegistry {
    return this.commands;
  }

  constructor(commands: CommandRegistry = studioRegistry()) {
    this.commands = commands;
    this.figure = new Figure({ commands });
    this.watch();
    // objects made while the algebra engine was still loading are computed again once it is in (cas spec R2.7)
    // objects made while the engine loaded are computed in place, so the undo history stays
    onCasEngine(() => this.recomputePending());
    // an answer from the CAS worker: the objects that were pending are computed again from the filled cache
    onCasAnswer(() => this.recomputePending());
  }

  /** Recomputes the objects that wait for the CAS worker, without an undo entry. */
  recomputePending(): void {
    const ids = this.figure.objects().filter((o) => !o.cell.defined && o.cell.reason === 'pending').map((o) => o.id);
    if (ids.length === 0) return;
    this.figure.recompute(ids);
    this.figure.flush();
    this.emit();
  }

  /** True when an object waits for the algebra engine. */
  hasPending(): boolean {
    return this.figure.objects().some((o) => !o.cell.defined && o.cell.reason === 'pending');
  }

  /** Builds the figure again from its own lines when something waited for the engine; the undo history is kept short. */
  refreshPending(): void {
    if (!this.hasPending()) return;
    const { figure, report } = Figure.fromScript(this.figure.toScript(), { commands: this.commands, ...(this.gate ? { gate: this.gate } : {}) });
    if (!report.ok && report.applied === 0) return;
    this.figure = figure;
    this.watch();
    this.emit();
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

  /** The physics worker of the figure: a world with liquid runs in it (physics design 9.6). */
  physicsHost: PhysicsWorkerHost | undefined;
  /** Where the physics worker comes from; tests put a channel that runs it in the same thread, or none. */
  physicsChannel: () => PhysicsChannel | undefined = browserPhysicsChannel;

  private watch(): void {
    this.off?.();
    this.physicsHost?.stop();
    this.physicsHost = new PhysicsWorkerHost(this.figure, () => this.physicsChannel(), () => performance.now());
    this.directiveVersion++;
    this.structureVersion++;
    this.off = this.figure.on((ev) => {
      if (ev.ev === 'directive' || ev.ev === 'undo' || ev.ev === 'redo') this.directiveVersion++;
      // anything but a value or the clock may change which rows there are, their order, names or links
      if (ev.ev !== 'value' && ev.ev !== 'clock' && ev.ev !== 'step') this.structureVersion++;
      this.emit();
    });
  }

  /** Goes up on each control gesture: a box's text, error or notice can change with no change to the figure. */
  controlVersion = 0;

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private linesChanged(): void {
    this.structureVersion++;
    this.emit();
  }

  private controlChanged(): void {
    this.controlVersion++;
    this.emit();
  }

  private done(message: string, notices: readonly { readonly message: string }[]): Outcome {
    return { ok: true, message, notices: notices.map((n) => n.message) };
  }

  /* ------------------------------ lines ------------------------------ */

  /* ------------------------------ sound ------------------------------ */

  isMuted(name: string): boolean {
    const id = this.figure.get(name)?.id;
    return id !== undefined && isMuted(this.figure, id);
  }

  /** The mute toggle of a sound row: playback state, not a line, so no undo step (sound ui). */
  toggleMute(name: string): void {
    const id = this.figure.get(name)?.id;
    if (id === undefined) return;
    setMuted(this.figure, id, !isMuted(this.figure, id));
    this.controlChanged();
  }

  /** The input line's handler: one line through `apply`. A failing line changes nothing. */
  submit(source: string, origin: LineOrigin = 'learner'): SubmitResult {
    this.needEngine(source);
    const r = this.figure.apply(source.trim(), { origin });
    if (!r.ok) return { ok: false, error: r };
    // `on` and `ClearHandler` lines change handlers, which raise no figure event of their own
    if (r.op === 'action') this.linesChanged();
    return { ok: true, announcement: [r.summary, ...r.notices.map((n) => n.message)].join('. ') };
  }

  /** Several lines as one undo step; every line applies or fails on its own (the teacher's `draw`). */
  applyLines(lines: readonly string[], label: string, mode: 'independent' | 'atomic' = 'independent', origin: LineOrigin = 'host'): Outcome {
    this.needEngine(lines.join('\n'));
    const r = this.figure.applyBatch(lines, { group: label, mode, origin });
    if (r.applied > 0) this.linesChanged();
    if (mode === 'atomic' && !r.ok) {
      const bad = r.results.find((x) => !x.ok);
      if (bad && !bad.ok) return { ok: false, error: bad };
    }
    const failed = r.results.length - r.applied;
    return this.done(failed > 0 ? `${label}: ${r.applied} of ${r.results.length} lines applied` : `${label}: ${r.applied} lines applied`, r.notices);
  }

  /** Starts loading the algebra engine when a text names a CAS command (the engine is its own chunk). */
  private needEngine(text: string): void {
    if (this.engineAsked) return;
    for (const m of text.matchAll(/\b([A-Z][A-Za-z]*)\s*\(/g)) {
      if (CAS_COMMAND_NAMES.has(m[1] as string)) {
        this.engineAsked = true;
        void loadCasEngine();
        return;
      }
    }
  }

  private engineAsked = false;

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
      const control = this.widgetOf(v) ?? (v.free ? this.controlOf(v, cell.value) : undefined);
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

  /** A Button, a Choice or an Input as the control its row draws (controls-scripting ui.md 1 to 3). */
  private widgetOf(v: ObjectView): RowControl | undefined {
    if (v.type === 'Button') return { kind: 'button', label: buttonLabelOf(this.figure, v.id) };
    if (v.type === 'Choice') {
      const st = choiceStateOf(this.figure, v.id);
      const options = captionsOf(this.figure, v.id) ?? st?.options.map((o) => (isFunctionValue(o) ? functionCaption(this.figure, o) : defaultCaption(o))) ?? [];
      return { kind: 'choice', options, index: st?.index ?? 0 };
    }
    if (v.type === 'Input') {
      const caption = (v.cell.defined ? (v.cell.value as { caption?: unknown } | undefined)?.caption : undefined) ?? '';
      const err = inputErrorOf(this.figure, v.id);
      const notice = inputNoticeOf(this.figure, v.id);
      return {
        kind: 'input',
        caption: typeof caption === 'string' ? caption : '',
        text: inputTextOf(this.figure, v.id),
        ...(err ? { error: { message: err.message, ...(err.col !== undefined ? { col: err.col, endCol: err.endCol } : {}) } } : {}),
        ...(notice ? { notice: notice.message } : {}),
      };
    }
    return undefined;
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
      const r = this.figure.apply(`${name} = ${text.trim()}`, { origin: 'learner' });
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
    // learner gestures raise events (design 3.3): change on each move, dragend on release
    this.raise(name, 'change', this.figure.value(name));
    if (!done) return this.done(`${name} = ${valueText(value)}`, []);
    this.figure.commitDrag();
    this.raise(name, 'dragend', this.figure.value(name));
    return this.done(`${name} = ${valueText(value)}`, []);
  }

  /** A free point dragged on the graph. The gesture is one undo step: `done` commits it. */
  /** True when dragging the point moves it: a free point, or one whose rule can be inverted (a point on a path). */
  draggable(name: string): boolean {
    const o = this.figure.get(name);
    if (o && (o.type === 'Body3' || o.typeText === 'List<Body3>')) return o.cell.defined;
    if (o && o.type === 'Cloth') return o.cell.defined;
    if (!o || (o.type !== 'Point' && o.type !== 'Point3') || !o.cell.defined) return false;
    return o.free || this.figure.dragPlan(name, o.cell.value).writes.length > 0;
  }

  dragPoint(name: string, x: number, y: number, done: boolean, z?: number): Outcome {
    const round = (v: number): number => Number(v.toPrecision(6));
    // a body: at the start of the film the drag moves where it starts; later it grabs it (physics ui.md 4)
    const base = name.replace(/\[\d+\]$/, '');
    const bt = this.figure.get(base);
    if (bt && (bt.type === 'Body' || bt.typeText === 'List<Body>') && z === undefined) {
      const r = physics.dragBody(this.figure, name, x, y, done);
      if (!r.ok) return { ok: false, error: { ok: false, kind: 'not_draggable', message: r.why } as never };
      this.figure.flush();
      return this.done(r.did === 'moved start' ? `moved where ${name} starts` : r.did === 'grabbed' ? `holding ${name}` : `let go of ${name}`, []);
    }
    if (bt && bt.type === 'Cloth') {
      const r = physics.dragCloth(this.figure, name, { x, y, z: z ?? 0 }, done);
      if (!r.ok) return { ok: false, error: { ok: false, kind: 'not_draggable', message: r.why } as never };
      this.figure.flush();
      return this.done(r.did === 'moved start' ? `moved where ${name} starts` : r.did === 'grabbed' ? `holding point ${(r.point ?? 0) + 1} of ${name}` : `let go of ${name}`, []);
    }
    if (bt && (bt.type === 'Body3' || bt.typeText === 'List<Body3>')) {
      const r = physics.dragBody3(this.figure, name, { x, y, z: z ?? 0 }, done);
      if (!r.ok) return { ok: false, error: { ok: false, kind: 'not_draggable', message: r.why } as never };
      this.figure.flush();
      return this.done(r.did === 'moved start' ? `moved where ${name} starts` : r.did === 'grabbed' ? `holding ${name}` : `let go of ${name}`, []);
    }
    if (!this.figure.get(name)?.free) {
      // a point on a path, or a midpoint of free points: move what it is built from (kernel design 7)
      const plan = this.figure.dragPlan(name, z === undefined ? { x, y } : { x, y, z });
      const r = this.figure.drag(plan);
      if (!r.ok) return { ok: false, error: { ok: false, kind: 'not_draggable', message: `${name} cannot be dragged: ${String(r.reason ?? plan.reason ?? 'its rule cannot be inverted').replace(/_/g, ' ')}.` } as never };
      if (done) this.figure.commitDrag();
      return this.done(`moved ${name}`, []);
    }
    // a point in space keeps its third coordinate
    const r = this.figure.setFree(name, z === undefined ? { x: round(x), y: round(y) } : { x: round(x), y: round(y), z: round(z) }, 'drag');
    if (!r.ok) return { ok: false, error: r };
    this.figure.flush();
    this.raise(name, 'change', this.figure.value(name));
    if (done) {
      this.figure.commitDrag();
      this.raise(name, 'dragend', this.figure.value(name));
    }
    return this.done(z === undefined ? `${name} = (${valueText(round(x))}, ${valueText(round(y))})` : `${name} = (${valueText(round(x))}, ${valueText(round(y))}, ${valueText(round(z))})`, []);
  }

  /* ------------------------------ controls (controls-scripting design 3.3) ------------------------------ */

  /** The last handler run a gesture caused, for the aborted-run badge. */
  lastRun: HandlerRun | undefined;

  /** True when `target` has a stored handler for `event`, so a gesture with none costs nothing. */
  hasHandler(target: string, event: HandlerEvent): boolean {
    return getStoredHandler(this.figure, target, event) !== undefined;
  }

  /** A learner gesture on `name`: runs its handler, and for `change` the figure's `on figure change`. */
  private raise(name: string, event: HandlerEvent, value?: unknown): void {
    if (this.hasHandler(name, event)) this.lastRun = runHandler(this.figure, name, event, { value, by: 'learner' }, 'learner');
    if (event === 'change' && this.hasHandler('figure', 'change')) runHandler(this.figure, 'figure', 'change', { changedName: name, by: 'learner' }, 'learner');
  }

  /** A button pressed, or a clickable object clicked. */
  click(name: string): Outcome {
    const r = clickButton(this.figure, name, { by: 'learner' });
    if (!r.ok) return { ok: false, error: r };
    this.lastRun = r.value;
    this.controlChanged();
    return r.value.ok ? this.done(`click ${name}`, []) : { ok: false, error: r.value.error as ErrorObject };
  }

  /** True when clicking the object on the graph does something: `clickable = true` and a click handler. */
  clickable(name: string): boolean {
    return isClickable(this.figure, name) && this.hasHandler(name, 'click');
  }

  /** A dropdown pick, 1-based. Raises `change` (the writer does). */
  choose(name: string, index: number): Outcome {
    const id = this.figure.get(name)?.id;
    if (id === undefined) return { ok: false, error: this.figure.apply(`${name}`) as ErrorObject };
    const r = setChoiceIndex(this.figure, id, index, { by: 'learner' });
    this.controlChanged();
    return r.ok ? this.done(`${name}: option ${index}`, r.notices) : { ok: false, error: r };
  }

  /** A checkbox toggled by the learner. Raises `change`. */
  toggle(name: string): Outcome {
    const r = toggleCheckbox(this.figure, name, { by: 'learner' });
    this.controlChanged();
    return r.ok ? this.done(r.value.summary, r.notices) : { ok: false, error: r };
  }

  /** Text typed into an input box: checked at once, never written; `input` handlers run after a pause (the caller's). */
  typeInput(name: string, text: string): { readonly valid: boolean; readonly error: ErrorObject | null } {
    return typeInputText(this.figure, name, text);
  }

  /** The text of the object an input box is linked to, as the box shows it when idle. */
  targetText(name: string): string {
    const v = this.figure.get(name);
    const t = v?.cell.defined ? (v.cell.value as { target?: number } | undefined)?.target : undefined;
    return typeof t === 'number' ? targetTextOf(this.figure, t as never) : '';
  }

  /** The pause after typing is over: the `input` handler sees the text. */
  inputPaused(name: string, text: string): void {
    if (this.hasHandler(name, 'input')) {
      this.lastRun = runHandler(this.figure, name, 'input', { value: text, by: 'learner' }, 'learner');
      this.controlChanged();
    }
  }

  /** Enter or blur in an input box. On an error the target keeps its value and the box shows the error. */
  commitInput(name: string, text: string): Outcome {
    const r = commitInputText(this.figure, name, text, { by: 'learner' });
    this.controlChanged();
    return r.ok ? this.done(r.value.summary, r.value.notices) : { ok: false, error: r };
  }

  /** Runs `on figure load` once, after an example or a file is in. */
  runLoad(): void {
    if (runLoadHandlers(this.figure, { by: 'host' })) this.controlChanged();
  }

  private handlerCache: { key: string; by: Map<string, ReturnType<KernelSession['handlers']>> } | undefined;

  /** The handlers on one target (`figure` for the figure's own), cached until the figure's structure changes. */
  handlersOn(target: string): ReturnType<KernelSession['handlers']> {
    const key = `${this.structureVersion}|${this.controlVersion}`;
    if (this.handlerCache?.key !== key) {
      const by = new Map<string, ReturnType<KernelSession['handlers']>>();
      for (const h of this.handlers()) by.set(h.target, [...(by.get(h.target) ?? []), h]);
      this.handlerCache = { key, by };
    }
    return this.handlerCache.by.get(target) ?? [];
  }

  /** Every handler with its steps and which steps are broken (ui.md 5). */
  handlers(): readonly { readonly target: string; readonly event: HandlerEvent; readonly steps: readonly { readonly text: string; readonly broken: boolean }[] }[] {
    return listHandlers(this.figure).map((h) => {
      const broken = new Set(brokenSteps(this.figure, h.target, h.event));
      return {
        target: h.target,
        event: h.event,
        steps: h.steps.map((s, i) => ({ text: `${s.loop ? `for ${s.loop.variable} in ${s.loop.from}..${s.loop.to} ` : ''}${s.guard ? `if ${s.guard}: ` : ''}${s.source}`, broken: broken.has(i + 1) })),
      };
    });
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
    this.needEngine(text);
    const { figure, report } = Figure.fromScript(text, { commands: this.commands, ...(this.gate ? { gate: this.gate } : {}) });
    const total = report.applied + report.skipped;
    const usable = report.ok || report.applied > 0;
    if (usable) {
      this.figure = figure;
      this.watch();
      this.emit();
      // a loaded figure runs its `on figure load` once (controls-scripting design 3.3)
      this.runLoad();
    }
    return { applied: report.applied, total, errors: report.errors, replaced: usable };
  }

  /* ------------------------------ clock ------------------------------ */

  /** The figure's player (animation-time design 3): play, pause, frames and seeks, so traces and animated sliders run. */
  player(): Player {
    return playerOf(this.figure);
  }

  /** True while the clock is playing. */
  playing(): boolean {
    return this.player().state.mode === 'playing';
  }

  play(): void {
    this.player().play();
  }

  pause(): void {
    this.player().pause();
  }

  /** One frame of the host's loop, with the reading in seconds. When an open film ends it starts again. */
  frame(nowSeconds: number): void {
    const p = this.player();
    const before = p.state.mode;
    p.frame(nowSeconds);
    if (before === 'playing' && p.state.mode === 'paused' && Number.isFinite(p.state.duration)) {
      p.seek(this.range().from);
      p.play();
    }
    this.physicsHost?.frame(this.time());
  }

  /**
   * True when the figure moves with time: an object reads `t`, a particle system or a trace exists, a slider is
   * animated, or the script sets a `@clock`.
   */
  hasClock(): boolean {
    if (tracedIds(this.figure).length > 0 || animatingIds(this.figure).length > 0) return true;
    // a camera that spins moves with the film (.kiro/specs/space-3d-surfaces R3.1)
    if (space.viewOf(this.figure).spin !== 0) return true;
    for (const v of this.figure.objects()) {
      if (v.type === 'Particles' || v.state) return true;
      // a body moves with the film (physics ui.md 2)
      if (v.type === 'Body' || v.typeText === 'List<Body>' || v.type === 'Body3' || v.typeText === 'List<Body3>') return true;
      // liquid flows with the film (physics design 9.1)
      if (v.type === 'Liquid') return true;
      // and smoke drifts with it (physics design 9.4)
      if (v.type === 'Smoke') return true;
      if (/\banimate\s*=/.test(v.definition)) return true;
    }
    if (/^@clock /m.test(this.figure.toScript())) return true;
    // a slider set going by Animate(h)
    if (/^\s*Animate\(/m.test(this.figure.toScript())) return true;
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
    const r = this.player().seek(t);
    this.physicsHost?.frame(this.time());
    return 'ok' in r && r.ok === false ? { ok: false, error: r as ErrorObject } : this.done(`t = ${valueText(this.time())}`, []);
  }
}

function isFunctionValue(v: unknown): boolean {
  return typeof v === 'object' && v !== null && typeof (v as { arity?: unknown }).arity === 'number';
}

/** A function option's caption: its definition when it is a named function, else `function`. */
function functionCaption(figure: Figure, v: unknown): string {
  for (const o of figure.objects()) if (o.type === 'Function' && o.cell.defined && o.cell.value === v) return rightSide(o.definition);
  return valueText(v);
}

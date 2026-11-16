/**
 * The app core (embed-files-export design 3; .kiro/specs/sdk R1): one figure behind a small typed API. Writing goes
 * through lines; reads return data; errors are data. No DOM: the screen (`createApp`) and the frame host sit on top.
 */
import { Figure, numberSource, playerOf, setSheetLocks } from '@incantly/kernel';
import type { CommandRegistry, ErrorObject, LineOrigin, ObjectView, TxResult } from '@incantly/kernel';
import { MODES, catalogueOf, compilePolicy, makeGate, switchMode } from '@incantly/modes';
import type { AppModeId, ModeChangeResult, ModeConfig } from '@incantly/modes';
import type { ApiError } from './errors';
import { apiError, destroyed, need, unknownName } from './errors';
import { EventHub } from './events';
import type { AppEvent, ChangedObject, EventOf, EventSource, EventType, ListenOpts, Scheduler, Unsubscribe } from './events';
import { sdkRegistry } from './registry';
import type { Value } from './values';
import { cellValue, toValue } from './values';

export const API_VERSION = 1 as const;
/** The most objects `list` returns (design 7). */
export const LIST_LIMIT = 5000;
/** The most text one `run` call takes (errors 1). */
export const RUN_LIMIT = 2 * 1024 * 1024;

/* ------------------------------ result types ------------------------------ */

export type KernelError = ErrorObject;

export interface LineOk {
  readonly ok: true;
  readonly line: number;
  /** The object the line defined (absent for actions and directives). */
  readonly name?: string;
  readonly type?: string;
  readonly summary?: string;
  /** Names the line created. */
  readonly created: readonly string[];
  /** Names whose value changed downstream. */
  readonly changed: readonly string[];
  readonly undefined: readonly { readonly name: string; readonly reason: string }[];
}

export type LineResult = LineOk | KernelError | ApiError;

export interface SdkBatchResult {
  readonly ok: boolean;
  readonly results: readonly LineResult[];
  readonly applied: number;
}

export interface ObjectSummary {
  readonly name: string;
  readonly id: number;
  readonly type: string;
  readonly visible: boolean;
  readonly free: boolean;
  readonly defined: boolean;
  readonly summary: string;
}

export interface ObjectDetail extends ObjectSummary {
  readonly definition: string;
  readonly value: Value;
  readonly undefinedReason?: string;
  readonly style: Readonly<Record<string, unknown>>;
  readonly dependsOn: readonly string[];
  readonly dependents: readonly string[];
}

export interface ObjectFilter {
  readonly type?: string | readonly string[];
  readonly free?: boolean;
  readonly visible?: boolean;
  /** A glob such as `P*`. */
  readonly namePattern?: string;
  /** Only objects that read this one (directly or not). */
  readonly dependsOn?: string;
}

export interface FigureSummary {
  readonly mode: AppModeId;
  readonly objects: number;
  readonly undefined: readonly { readonly name: string; readonly reason: string }[];
  readonly view: ViewState;
  readonly t: number;
  readonly sample: readonly ObjectSummary[];
}

export type DeleteResult = { readonly ok: true; readonly removed: readonly string[] } | KernelError | ApiError;

export type StylePatch = Readonly<Record<string, string | number | boolean>>;

export interface ViewState {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface ViewControl {
  get(): ViewState;
  set(x0: number, x1: number, y0: number, y1: number): LineResult;
  setAxes(show: boolean): LineResult;
  setGrid(show: boolean | 'major' | 'minor'): LineResult;
  keepRatio(on: boolean): void;
  readonly ratioKept: boolean;
  /** Zooms to show the visible points; `false` when there is nothing to show. */
  fit(): boolean;
  /** Repaints are merged anyway; the returned function resumes. */
  suspendRepaint(): () => void;
}

export interface ClockControl {
  readonly t: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  seek(t: number): void;
  setSpeed(multiplier: number): ApiError | undefined;
  setRange(from: number, to: number): LineResult;
}

/** What drives the clock while it plays: the screen gives animation frames, tests a manual one. */
export interface Ticker {
  request(cb: (nowMs: number) => void): unknown;
  cancel(handle: unknown): void;
}

export const defaultTicker: Ticker = {
  request: (cb) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame;
    if (typeof raf === 'function') return raf(cb);
    return setTimeout(() => cb(performance.now()), 16);
  },
  cancel: (h) => {
    const caf = (globalThis as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame;
    if (typeof caf === 'function' && typeof h === 'number') caf(h);
    else clearTimeout(h as ReturnType<typeof setTimeout>);
  },
};

export interface HeadlessOptions {
  readonly mode?: AppModeId;
  /** Lines to run at the start. */
  readonly script?: string;
  /** The learner cannot change the construction (writes from the screen are `read_only`). */
  readonly readOnly?: boolean;
  /** Locked cells stop learners (spreadsheet design 3.15); default on. */
  readonly enforceLocks?: boolean;
  readonly size?: { readonly width: number; readonly height: number };
  readonly registry?: CommandRegistry;
  readonly scheduler?: Scheduler;
  readonly ticker?: Ticker;
}

/* ------------------------------ helpers ------------------------------ */

const isKernelError = (r: unknown): r is KernelError => typeof r === 'object' && r !== null && (r as { ok?: unknown }).ok === false;

function globRegex(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

function textLiteral(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\n') + '"';
}

/** A style value as a line writes it: numbers and Bools as they are, colour words and hex as words, other texts quoted. */
function styleText(v: string | number | boolean): string {
  if (typeof v === 'number') return numberSource(v);
  if (typeof v === 'boolean') return String(v);
  return /^[A-Za-z]+$|^#[0-9a-fA-F]{3,8}$/.test(v) ? v : textLiteral(v);
}

/** The first line of a script: `# incantly 1 mode=graphing`. */
export const HEADER = /^\s*# incantly \d+[^\n]*(\n|$)/;

const DEFAULT_VIEW = { x0: -10, x1: 10, y0: -7, y1: 7 };

/** An event before the app stamps its source and time. */
type Draft = AppEvent extends infer E ? (E extends AppEvent ? Omit<E, 'source' | 't'> : never) : never;

/* ------------------------------ the app ------------------------------ */

export interface App {
  readonly apiVersion: typeof API_VERSION;
  readonly mode: AppModeId;
  readonly readOnly: boolean;
  /** The kernel figure, for hosts in the same page (the screen, the studio). */
  readonly figure: Figure;

  run(lines: string | readonly string[]): readonly LineResult[];
  runBatch(lines: readonly string[]): SdkBatchResult;

  list(filter?: ObjectFilter): readonly ObjectSummary[] & { readonly truncated?: boolean };
  get(name: string): ObjectDetail | undefined;
  exists(name: string): boolean;
  value(name: string): Value | undefined;
  definition(name: string): string | undefined;
  undefinedObjects(): readonly { readonly name: string; readonly reason: string }[];
  figureSummary(): FigureSummary;

  set(name: string, value: number | boolean | string | readonly [number, number]): LineResult;
  setStyle(name: string, style: StylePatch): LineResult;
  show(...names: string[]): readonly LineResult[];
  hide(...names: string[]): readonly LineResult[];
  remove(name: string): DeleteResult;
  rename(oldName: string, newName: string): LineResult;
  clear(): void;

  readonly view: ViewControl;
  readonly clock: ClockControl;

  undo(): boolean;
  redo(): boolean;
  markUndoPoint(label?: string): void;
  readonly saved: boolean;
  markSaved(): void;

  on<E extends EventType>(type: E, handler: (e: EventOf<E>) => void, opts?: ListenOpts): Unsubscribe;
  once<E extends EventType>(type: E, handler: (e: EventOf<E>) => void): Unsubscribe;

  toScript(): string;
  /** Replaces the figure with a script's (round 2 adds files): every line is tried, failures are listed. */
  loadScript(text: string): { readonly ok: boolean; readonly applied: number; readonly failed: readonly KernelError[] };

  setMode(mode: AppModeId, opts?: { readonly force?: boolean }): ModeChangeResult;
  resize(width: number, height: number): void;
  destroy(): void;
  readonly destroyed: boolean;

  /** For the screen: runs `fn` with this event source and writer (a learner's drag is `user`, origin `learner`). */
  as<T>(source: EventSource, fn: () => T): T;
}

class AppCore implements App {
  readonly apiVersion = API_VERSION;
  readonly readOnly: boolean;
  figure: Figure;
  mode: AppModeId;
  private readonly registry: CommandRegistry;
  private readonly hub: EventHub;
  private readonly ticker: Ticker;
  private source: EventSource = 'script';
  private offFigure: (() => void) | undefined;
  private offPlayer: (() => void) | undefined;
  private size: { width: number; height: number };
  private keep = true;
  private savedScript: string;
  private tick: unknown;
  private gone = false;
  /** Value changes seen during the current call, for `LineOk.changed`. */
  private seen: Set<string> | undefined;

  constructor(opts: HeadlessOptions) {
    need(typeof opts === 'object' && opts !== null, 'createApp', 'options must be an object');
    const mode = opts.mode ?? 'graphing';
    need(Object.hasOwn(MODES, mode), 'createApp', `mode must be one of ${Object.keys(MODES).join(', ')}`);
    this.mode = mode;
    this.readOnly = opts.readOnly === true;
    this.registry = opts.registry ?? sdkRegistry();
    this.hub = new EventHub(opts.scheduler);
    this.ticker = opts.ticker ?? defaultTicker;
    this.size = { width: opts.size?.width ?? 800, height: opts.size?.height ?? 600 };
    this.figure = this.newFigure();
    this.attach();
    if (opts.enforceLocks === false) setSheetLocks(this.figure, false);
    if (typeof opts.script === 'string' && opts.script.trim() !== '') this.as('file', () => this.figure.append((opts.script as string).replace(HEADER, '')));
    this.savedScript = this.figure.toScript();
    this.emit({ type: 'ready' });
  }

  /* ------------------------------ plumbing ------------------------------ */

  private modeConfig(m: AppModeId = this.mode): ModeConfig {
    return MODES[m] as ModeConfig;
  }

  private gate(): ReturnType<typeof makeGate> {
    return makeGate({ layers: [{ policy: compilePolicy(this.modeConfig()), reason: 'mode' }], catalogue: catalogueOf(this.registry.all()) });
  }

  private newFigure(): Figure {
    return new Figure({ commands: this.registry, gate: this.gate() });
  }

  private t(): number {
    return this.figure.clock().t;
  }

  private emit(e: Draft): void {
    this.hub.emit({ ...e, source: this.source, t: this.t() } as AppEvent);
  }

  /** Listens to the figure: its events become SDK events with the current source. */
  private attach(): void {
    this.offFigure?.();
    this.offPlayer?.();
    const f = this.figure;
    this.offFigure = f.on((ev) => {
      switch (ev.ev) {
        case 'add': {
          const o = f.get(ev.id);
          if (o) this.emit({ type: 'added', name: o.name, objectType: o.type });
          break;
        }
        case 'remove':
          this.emit({ type: 'removed', name: ev.name });
          break;
        case 'value': {
          const objects: ChangedObject[] = [];
          for (const id of ev.ids) {
            const o = f.get(id);
            if (!o) continue;
            this.seen?.add(o.name);
            objects.push({ name: o.name, type: o.type, value: cellValue(o.cell), defined: o.cell.defined });
          }
          if (objects.length > 0) this.emit({ type: 'changed', objects });
          break;
        }
        case 'style': {
          const names = ev.ids.map((id) => f.get(id)?.name).filter((n): n is string => n !== undefined);
          if (names.length > 0) this.emit({ type: 'restyled', names });
          break;
        }
        case 'rename':
          this.emit({ type: 'renamed', from: ev.from, to: ev.to });
          break;
        case 'undo':
          this.emit({ type: 'undone', label: ev.group });
          break;
        case 'redo':
          this.emit({ type: 'redone', label: ev.group });
          break;
        case 'directive':
          if (ev.name === 'view') this.emit({ type: 'viewChanged', view: this.viewWindow() });
          break;
        case 'clock':
          this.emit({ type: 'clockChanged' });
          break;
        default:
          break;
      }
    });
    this.offPlayer = playerOf(f).subscribe((e) => {
      if (e.kind === 'mode') this.emit({ type: e.mode === 'playing' ? 'play' : 'pause' });
    });
  }

  as<T>(source: EventSource, fn: () => T): T {
    const was = this.source;
    this.source = source;
    try {
      return fn();
    } finally {
      this.source = was;
    }
  }

  private origin(): LineOrigin {
    return this.source === 'user' ? 'learner' : 'host';
  }

  /** The error for a write the app refuses before the kernel sees it. */
  private refuse(): ApiError | undefined {
    if (this.gone) return destroyed();
    if (this.readOnly && this.source === 'user') return apiError('api', 'read_only', 'This figure is read-only.', { hint: 'Turn off readOnly, or work on a copy.' });
    return undefined;
  }

  /** One kernel result as a `LineResult`. */
  private result(r: TxResult, changed: ReadonlySet<string>): LineResult {
    if (!r.ok) return r;
    const created = [...r.changed.added];
    return {
      ok: true,
      line: r.line,
      ...(r.name !== undefined ? { name: r.name } : {}),
      ...(r.type !== undefined ? { type: r.type as string } : {}),
      summary: r.summary,
      created,
      changed: [...changed].filter((n) => !created.includes(n) && n !== r.name),
      undefined: r.changed.becameUndefined.map((u) => ({ name: u.name, reason: u.reason })),
    };
  }

  private apply(line: string, n: number): LineResult {
    this.seen = new Set();
    try {
      const r = this.figure.apply(line, { line: n, origin: this.origin() });
      if (r.ok && r.op === 'redefine' && r.name !== undefined) this.emit({ type: 'redefined', name: r.name, definition: this.figure.get(r.name)?.definition ?? line });
      if (!r.ok) this.emit({ type: 'error', error: r });
      return this.result(r, this.seen);
    } finally {
      this.seen = undefined;
    }
  }

  private viewOf(name: string): ObjectView | undefined {
    return this.gone ? undefined : this.figure.get(name);
  }

  private summaryOf(o: ObjectView): ObjectSummary {
    return { name: o.name, id: o.id as number, type: o.type, visible: o.style.shown, free: o.free, defined: o.cell.defined, summary: o.cell.defined ? `${o.name} = ${valueTextOf(o)}` : `${o.name} is undefined (${o.cell.reason})` };
  }

  /* ------------------------------ run ------------------------------ */

  run(lines: string | readonly string[]): readonly LineResult[] {
    need(typeof lines === 'string' || (Array.isArray(lines) && lines.every((l) => typeof l === 'string')), 'run', 'lines must be a string or an array of strings');
    const bad = this.refuse();
    if (bad) return [bad];
    const list = typeof lines === 'string' ? lines.split('\n') : [...lines];
    if (list.reduce((n, l) => n + l.length + 1, 0) > RUN_LIMIT) return [apiError('api', 'limit', 'That is more than 2 MB of lines in one call.', { detail: { limit: { name: 'run_bytes', max: RUN_LIMIT } } })];
    const out: LineResult[] = [];
    this.as(this.source === 'script' ? 'api' : this.source, () => {
      list.forEach((l, i) => {
        if (l.trim() === '') return;
        out.push(this.apply(l, i + 1));
      });
    });
    return out;
  }

  runBatch(lines: readonly string[]): SdkBatchResult {
    need(Array.isArray(lines) && lines.every((l) => typeof l === 'string'), 'runBatch', 'lines must be an array of strings');
    const bad = this.refuse();
    if (bad) return { ok: false, results: [bad], applied: 0 };
    return this.as(this.source === 'script' ? 'api' : this.source, () => {
      this.seen = new Set();
      try {
        const r = this.figure.applyBatch(lines, { group: 'batch', mode: 'atomic', origin: this.origin() });
        const results = r.results.map((x) => this.result(x, this.seen as Set<string>));
        if (!r.ok) {
          const first = r.results.find((x) => !x.ok);
          if (first && !first.ok) this.emit({ type: 'error', error: first });
        }
        return { ok: r.ok, results, applied: r.applied };
      } finally {
        this.seen = undefined;
      }
    });
  }

  /* ------------------------------ read ------------------------------ */

  list(filter: ObjectFilter = {}): readonly ObjectSummary[] & { readonly truncated?: boolean } {
    need(typeof filter === 'object' && filter !== null, 'list', 'filter must be an object');
    if (this.gone) return [];
    const types = filter.type === undefined ? undefined : new Set(Array.isArray(filter.type) ? filter.type : [filter.type as string]);
    const glob = filter.namePattern !== undefined ? globRegex(filter.namePattern) : undefined;
    const down = filter.dependsOn !== undefined ? new Set(this.figure.dependentsOf(filter.dependsOn)) : undefined;
    const out: ObjectSummary[] = [];
    let truncated = false;
    for (const o of this.figure.objects()) {
      if (types && !types.has(o.type)) continue;
      if (filter.free !== undefined && o.free !== filter.free) continue;
      if (filter.visible !== undefined && o.style.shown !== filter.visible) continue;
      if (glob && !glob.test(o.name)) continue;
      if (down && !down.has(o.id)) continue;
      if (out.length >= LIST_LIMIT) {
        truncated = true;
        break;
      }
      out.push(this.summaryOf(o));
    }
    return truncated ? Object.assign(out, { truncated: true as const }) : out;
  }

  get(name: string): ObjectDetail | undefined {
    need(typeof name === 'string', 'get', 'name must be a string');
    const o = this.viewOf(name);
    if (!o) return undefined;
    const names = (ids: readonly number[]): string[] => ids.map((id) => this.figure.get(id as never)?.name).filter((n): n is string => n !== undefined);
    const direct = this.figure.objects().filter((x) => x.inputs.includes(o.id)).map((x) => x.name);
    return {
      ...this.summaryOf(o),
      definition: o.definition,
      value: cellValue(o.cell),
      ...(o.cell.defined ? {} : { undefinedReason: o.cell.reason }),
      style: { ...(o.style as unknown as Record<string, unknown>) },
      dependsOn: names(o.inputs as unknown as number[]),
      dependents: direct,
    };
  }

  exists(name: string): boolean {
    need(typeof name === 'string', 'exists', 'name must be a string');
    return !this.gone && this.figure.has(name);
  }

  value(name: string): Value | undefined {
    need(typeof name === 'string', 'value', 'name must be a string');
    const o = this.viewOf(name);
    return o ? cellValue(o.cell) : undefined;
  }

  definition(name: string): string | undefined {
    need(typeof name === 'string', 'definition', 'name must be a string');
    return this.viewOf(name)?.definition;
  }

  undefinedObjects(): readonly { readonly name: string; readonly reason: string }[] {
    if (this.gone) return [];
    return this.figure.objects().filter((o) => !o.cell.defined).map((o) => ({ name: o.name, reason: o.cell.defined ? '' : o.cell.reason }));
  }

  figureSummary(): FigureSummary {
    const objs = this.gone ? [] : this.figure.objects();
    return { mode: this.mode, objects: objs.length, undefined: this.undefinedObjects(), view: { ...this.viewWindow(), widthPx: this.size.width, heightPx: this.size.height }, t: this.gone ? 0 : this.t(), sample: objs.slice(0, 50).map((o) => this.summaryOf(o)) };
  }

  /* ------------------------------ write ------------------------------ */

  /** The error data for a name that is missing, or `undefined`. */
  private missing(name: string): ApiError | undefined {
    return this.figure.has(name) ? undefined : unknownName(name, this.figure.objects().map((o) => o.name));
  }

  set(name: string, value: number | boolean | string | readonly [number, number]): LineResult {
    need(typeof name === 'string', 'set', 'name must be a string');
    const ok = typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' || (Array.isArray(value) && value.length === 2 && value.every((x) => typeof x === 'number'));
    need(ok, 'set', 'value must be a number, a Bool, a text or [x, y]');
    const bad = this.refuse() ?? this.missing(name);
    if (bad) return bad;
    const o = this.figure.get(name) as ObjectView;
    if (!o.free) {
      const inputs = o.inputs.map((id) => this.figure.get(id)?.name).filter((n): n is string => n !== undefined);
      return apiError('api', 'not_free', `${name} depends on ${inputs.join(' and ') || 'other objects'}, so it cannot be set directly.`, {
        hint: `Set ${inputs.join(' or ') || 'its inputs'}, or redefine it with run('${name} = …').`,
        detail: { name, dependsOn: inputs },
      });
    }
    let lit: string;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return apiError('api', 'bad_argument', 'value must be a finite number.', { detail: { argument: 'value' } });
      lit = numberSource(value);
    } else if (typeof value === 'boolean') lit = String(value);
    else if (typeof value === 'string') lit = textLiteral(value);
    else {
      const [x, y] = value as readonly [number, number];
      if (!Number.isFinite(x) || !Number.isFinite(y)) return apiError('api', 'bad_argument', 'the point must have finite coordinates.', { detail: { argument: 'value' } });
      lit = `(${numberSource(x)}, ${numberSource(y)})`;
    }
    return this.run(`${name} = ${lit}`)[0] as LineResult;
  }

  setStyle(name: string, style: StylePatch): LineResult {
    need(typeof name === 'string' && typeof style === 'object' && style !== null, 'setStyle', 'it needs a name and a style object');
    const bad = this.refuse() ?? this.missing(name);
    if (bad) return bad;
    const items = Object.entries(style);
    if (items.length === 0) return apiError('api', 'bad_argument', 'the style is empty.', { detail: { argument: 'style' } });
    for (const [k, v] of items) need(/^[A-Za-z]\w*$/.test(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'), 'setStyle', `bad style entry ${k}`);
    return this.run(`${name} with ${items.map(([k, v]) => `${k} = ${styleText(v)}`).join(', ')}`)[0] as LineResult;
  }

  private visibility(action: 'Show' | 'Hide', names: readonly string[]): readonly LineResult[] {
    need(names.every((n) => typeof n === 'string'), action.toLowerCase(), 'names must be strings');
    return names.map((n) => this.refuse() ?? this.missing(n) ?? (this.run(`${action}(${n})`)[0] as LineResult));
  }

  show(...names: string[]): readonly LineResult[] {
    return this.visibility('Show', names);
  }

  hide(...names: string[]): readonly LineResult[] {
    return this.visibility('Hide', names);
  }

  remove(name: string): DeleteResult {
    need(typeof name === 'string', 'remove', 'name must be a string');
    const bad = this.refuse() ?? this.missing(name);
    if (bad) return bad;
    const removed = this.figure.deletePlan(name);
    const r = this.as(this.source === 'script' ? 'api' : this.source, () => this.figure.delete(name, { origin: this.origin() }));
    return r.ok ? { ok: true, removed } : r;
  }

  rename(oldName: string, newName: string): LineResult {
    need(typeof oldName === 'string' && typeof newName === 'string', 'rename', 'names must be strings');
    const bad = this.refuse() ?? this.missing(oldName);
    if (bad) return bad;
    if (this.figure.has(newName)) return apiError('api', 'name_taken', `${newName} is already the name of an object.`, { hint: 'Pick a free name, or rename that object first.', detail: { name: newName } });
    const r = this.as(this.source === 'script' ? 'api' : this.source, () => this.figure.rename(oldName, newName, { origin: this.origin() }));
    return this.result(r, new Set());
  }

  clear(): void {
    if (this.refuse()) return;
    this.pauseTicker();
    this.figure = this.newFigure();
    this.attach();
    this.emit({ type: 'cleared' });
  }

  /* ------------------------------ view ------------------------------ */

  private viewWindow(): { x0: number; x1: number; y0: number; y1: number } {
    const w = this.gone ? undefined : this.figure.directive('view');
    const n = w?.map(Number) ?? [];
    return n.length === 4 && n.every(Number.isFinite) ? { x0: n[0] as number, x1: n[1] as number, y0: n[2] as number, y1: n[3] as number } : { ...DEFAULT_VIEW };
  }

  private host(line: string): LineResult {
    if (this.gone) return destroyed();
    return this.as('api', () => this.apply(line, 1));
  }

  readonly view: ViewControl = (() => {
    // the control objects have getters (`t`, `playing`), which need the app, not themselves, as their subject
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    return {
      get: (): ViewState => ({ ...app.viewWindow(), widthPx: app.size.width, heightPx: app.size.height }),
      set(x0: number, x1: number, y0: number, y1: number): LineResult {
        need([x0, x1, y0, y1].every((v) => typeof v === 'number'), 'view.set', 'the window needs four numbers');
        if (![x0, x1, y0, y1].every(Number.isFinite) || !(x0 < x1) || !(y0 < y1)) return apiError('api', 'bad_argument', 'The window needs x0 < x1 and y0 < y1, all finite.', { detail: { argument: 'window' } });
        let [a, b, c, d] = [x0, x1, y0, y1];
        if (app.keep) {
          // the same scale on both axes: the window grows on the short side
          const ppx = app.size.width / (b - a);
          const ppy = app.size.height / (d - c);
          if (ppx > ppy) {
            const half = app.size.width / ppy / 2;
            const mid = (a + b) / 2;
            [a, b] = [mid - half, mid + half];
          } else if (ppy > ppx) {
            const half = app.size.height / ppx / 2;
            const mid = (c + d) / 2;
            [c, d] = [mid - half, mid + half];
          }
        }
        const r6 = (v: number): string => numberSource(Number(v.toPrecision(6)));
        return app.host(`@view ${r6(a)} ${r6(b)} ${r6(c)} ${r6(d)}`);
      },
      setAxes: (show: boolean): LineResult => app.host(`@axes ${show ? 'on' : 'off'}`),
      setGrid: (show: boolean | 'major' | 'minor'): LineResult => app.host(`@grid ${show === true ? 'on' : show === false ? 'off' : show}`),
      keepRatio(on: boolean): void {
        app.keep = on === true;
      },
      get ratioKept(): boolean {
        return app.keep;
      },
      fit(): boolean {
        const xs: number[] = [];
        const ys: number[] = [];
        const take = (v: unknown, depth = 0): void => {
          if (depth > 3 || v === null || typeof v !== 'object') return;
          const p = v as { x?: unknown; y?: unknown };
          if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            xs.push(p.x);
            ys.push(p.y);
            return;
          }
          if (Array.isArray(v)) for (const x of v) take(x, depth + 1);
          const o = v as { pts?: unknown; points?: unknown };
          if (Array.isArray(o.pts)) take(o.pts, depth + 1);
          if (Array.isArray(o.points)) take(o.points, depth + 1);
        };
        for (const o of app.figure.objects()) if (o.style.shown && o.cell.defined) take(o.cell.value);
        if (xs.length === 0) return false;
        const pad = (lo: number, hi: number): [number, number] => {
          const span = hi - lo || 2;
          return [lo - span * 0.1, hi + span * 0.1];
        };
        const [a, b] = pad(Math.min(...xs), Math.max(...xs));
        const [c, d] = pad(Math.min(...ys), Math.max(...ys));
        return this.set(a, b, c, d).ok;
      },
      suspendRepaint: (): (() => void) => () => undefined,
    };
  })();

  /* ------------------------------ clock ------------------------------ */

  private loop = (nowMs: number): void => {
    this.tick = undefined;
    if (this.gone) return;
    const p = playerOf(this.figure);
    this.as('clock', () => p.frame(nowMs / 1000));
    if (p.needsFrame()) this.tick = this.ticker.request(this.loop);
  };

  private pauseTicker(): void {
    if (this.tick !== undefined) this.ticker.cancel(this.tick);
    this.tick = undefined;
  }

  readonly clock: ClockControl = (() => {
    // the control objects have getters (`t`, `playing`), which need the app, not themselves, as their subject
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const app = this;
    return {
      get t(): number {
        return app.gone ? 0 : app.t();
      },
      get playing(): boolean {
        return !app.gone && playerOf(app.figure).state.mode === 'playing';
      },
      play(): void {
        if (app.gone) return;
        const p = playerOf(app.figure);
        p.play();
        if (app.tick === undefined) app.tick = app.ticker.request(app.loop);
      },
      pause(): void {
        if (app.gone) return;
        playerOf(app.figure).pause();
        app.pauseTicker();
      },
      seek(t: number): void {
        need(typeof t === 'number', 'clock.seek', 't must be a number');
        if (app.gone || !Number.isFinite(t)) return;
        app.as('api', () => playerOf(app.figure).seek(t));
      },
      setSpeed(multiplier: number): ApiError | undefined {
        need(typeof multiplier === 'number', 'clock.setSpeed', 'the speed must be a number');
        if (app.gone) return destroyed();
        const r = playerOf(app.figure).setRate(multiplier);
        return 'ok' in r && r.ok === false ? apiError('api', 'bad_argument', r.message, { detail: { argument: 'multiplier' } }) : undefined;
      },
      setRange(from: number, to: number): LineResult {
        need(typeof from === 'number' && typeof to === 'number', 'clock.setRange', 'the range needs two numbers');
        if (!Number.isFinite(from) || !Number.isFinite(to) || !(from < to)) return apiError('api', 'bad_argument', 'The range needs from < to, both finite.', { detail: { argument: 'range' } });
        return app.host(`@clock ${numberSource(from)}..${numberSource(to)}`);
      },
    };
  })();

  /* ------------------------------ undo ------------------------------ */

  undo(): boolean {
    if (this.refuse()) return false;
    return this.as(this.source === 'script' ? 'api' : this.source, () => this.figure.undo().ok);
  }

  redo(): boolean {
    if (this.refuse()) return false;
    return this.as(this.source === 'script' ? 'api' : this.source, () => this.figure.redo().ok);
  }

  markUndoPoint(label = 'undo point'): void {
    need(typeof label === 'string', 'markUndoPoint', 'the label must be a text');
    if (!this.gone) this.emit({ type: 'undoPoint', label });
  }

  get saved(): boolean {
    return this.gone || this.figure.toScript() === this.savedScript;
  }

  markSaved(): void {
    if (!this.gone) this.savedScript = this.figure.toScript();
  }

  /* ------------------------------ events ------------------------------ */

  on<E extends EventType>(type: E, handler: (e: EventOf<E>) => void, opts?: ListenOpts): Unsubscribe {
    need(typeof type === 'string' && typeof handler === 'function', 'on', 'it needs an event type and a function');
    return this.hub.on(type, handler, opts);
  }

  once<E extends EventType>(type: E, handler: (e: EventOf<E>) => void): Unsubscribe {
    need(typeof type === 'string' && typeof handler === 'function', 'once', 'it needs an event type and a function');
    return this.hub.once(type, handler);
  }

  /** Delivers what waits now (for tests and hosts that do not want to wait for the microtask and the frame). */
  flushEvents(): void {
    this.hub.flush();
    this.hub.flushFrame();
  }

  /* ------------------------------ files ------------------------------ */

  toScript(): string {
    if (this.gone) return '';
    const body = this.figure.toScript({ header: false });
    return `# incantly 1 mode=${this.mode}\n${body}`;
  }

  loadScript(text: string): { readonly ok: boolean; readonly applied: number; readonly failed: readonly KernelError[] } {
    need(typeof text === 'string', 'loadScript', 'the script must be a text');
    if (this.gone) return { ok: false, applied: 0, failed: [] };
    // the `# incantly` header names the format, not a line of the figure
    const body = text.replace(HEADER, '');
    const { figure, report } = Figure.fromScript(body, { commands: this.registry, gate: this.gate() });
    const usable = report.ok || report.applied > 0;
    if (usable) {
      this.pauseTicker();
      this.figure = figure;
      this.attach();
      this.savedScript = this.figure.toScript();
      this.as('file', () => this.emit({ type: 'loaded', applied: report.applied, failed: report.errors.length }));
    }
    return { ok: report.ok, applied: report.applied, failed: report.errors };
  }

  /* ------------------------------ lifetime ------------------------------ */

  setMode(mode: AppModeId, opts: { readonly force?: boolean } = {}): ModeChangeResult {
    need(typeof mode === 'string', 'setMode', 'mode must be a text');
    if (this.gone) return { ok: false, kept: 0, dropped: [], viewsChanged: [], error: destroyed() as never };
    if (!Object.hasOwn(MODES, mode)) return { ok: false, kept: this.figure.count, dropped: [], viewsChanged: [], error: apiError('api', 'mode_unavailable', `There is no ${mode} mode.`) as never };
    const from = this.mode;
    const r = this.as('api', () => switchMode(this.figure, this.modeConfig(), this.modeConfig(mode), { catalogue: catalogueOf(this.registry.all()), ...(opts.force ? { force: true } : {}) }));
    if (r.ok) {
      this.mode = mode;
      this.figure.setGate(this.gate());
      this.emit({ type: 'modeChanged', mode, from });
    }
    return r;
  }

  resize(width: number, height: number): void {
    need(typeof width === 'number' && typeof height === 'number', 'resize', 'it needs a width and a height');
    if (width > 0 && height > 0) this.size = { width, height };
  }

  destroy(): void {
    if (this.gone) return;
    this.pauseTicker();
    this.hub.flush();
    this.gone = true;
    this.offFigure?.();
    this.offPlayer?.();
    this.hub.close();
  }

  get destroyed(): boolean {
    return this.gone;
  }
}

function valueTextOf(o: ObjectView): string {
  const v = toValue(o.cell.defined ? o.cell.value : undefined);
  if (typeof v === 'number') return numberSource(Number(v.toPrecision(10)));
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'object' && v !== null && 'x' in v && 'y' in v && !Array.isArray(v)) return `(${numberSource(Number((v.x as number).toPrecision(10)))}, ${numberSource(Number((v.y as number).toPrecision(10)))})`;
  if (Array.isArray(v)) return `list of ${v.length}`;
  return (v as { text?: string }).text ?? o.typeText;
}

/** An app with no screen: Node, a worker, a test, or the frame host before it mounts. */
export function createHeadlessApp(opts: HeadlessOptions = {}): App & { flushEvents(): void } {
  return new AppCore(opts);
}

export type { AppModeId, ModeChangeResult };
export { isKernelError };

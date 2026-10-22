import type {
  Biology,
  BiologyOptions,
  Chart,
  ChartOptions,
  Chemistry,
  ChemistryOptions,
  IdleOptions,
  DragInfo,
  Flow,
  FlowOptions,
  FormulaOptions,
  FrameInfo,
  Graph3D,
  Graph3DOptions,
  GraphOptions,
  Inc,
  Model,
  Param,
  ParamOptions,
  ParamValues,
  PathHelpers,
  Physics2DOptions,
  PredictOptions,
  Readable,
  SimulateOptions,
  Space3D,
  Space3DOptions,
  Stage,
  StageOptions,
  StateValue,
  Step,
  TableOptions,
  TimelineOptions,
  TweenOptions,
  Values,
  Vec2,
  World2D,
} from '../api/types';
import { ExpressionError } from '../expr';
import { DEFAULT_GRAPH_VIEWBOX, Graph2D, NUMBER_LINE_VIEWBOX, plotRect, validateGraphOptions } from '../graph2d/graph';
import type { RuntimeUpdate, ViewAction } from '../protocol/runtime-messages';
import type { StageMeasure } from '../protocol/scene-commands';
import { SPEEDS, type LoopMode } from '../protocol/runtime-messages';
import type { ActionView, ErrorPhase, ErrorView, LegendView, ParamView, PredictView, UiState } from '../protocol/ui';
import { EMPTY_UI } from '../protocol/ui';
import { bindMethods } from '../scene/bind';
import { SceneApiError } from '../scene/errors';
import { calculus } from '../helpers/calc';
import { motion } from '../helpers/motion';
import { shapes } from '../helpers/shapes';
import { chem, sym } from '../helpers/sym';
import { units } from '../helpers/units';
import { vectors } from '../helpers/vec';
import { geometry } from '../scene/geometry';
import { SceneGraph, type GraphServices, type VNode } from '../scene/graph';
import { PartRegistry, StageHandle, formatReadable } from '../scene/handles';
import { createPathHelpers } from '../scene/path';
import { choiceControl, colorControl, toggleControl } from './controls';
import { createFormula, type FormulaRecord } from './formula';
import { isErrorLike, isRunaway } from './fuel';
import { History } from './history';
import { AWAITING_MAP, type KitContext, type ParamInfo, type ViewController } from './kit';
import { KIT_OF, type KitCall, type KitRegistry } from './kits';
import { createParamState, snap, type ControlShape, type ParamState } from './params';
import { mulberry32 } from './random';
import { Timeline, isSettingName } from './timeline';
import type { HistoryValue } from './history';

/** A formula's key in the undo history. */
const formulaKey = (index: number) => `formula:${index}`;
const FORMULA_KEY = /^formula:(\d+)$/;
import { advanceTween, type TweenState } from './tween';

export type SceneFunction = (inc: Inc, math: Math) => void;

export interface RuntimeOptions {
  readonly seed?: number;
  /**
   * Largest time step in seconds; longer gaps (a backgrounded tab) are capped.
   * Default 0.1: above the longest frame of the slowest frame-rate cap (15 fps),
   * so a capped figure keeps time.
   */
  readonly maxDt?: number;
  /** Most adjustable controls a figure may have; the plan's size sets a tighter budget. */
  readonly maxParams?: number;
  /** Learner values to restore instead of the authored defaults; `$` names hold timing settings. */
  readonly values?: Readonly<Record<string, number>>;
  /** Formulas the learner edited, by index. */
  readonly formulas?: Readonly<Record<string, string>>;
  readonly reducedMotion?: boolean;
  /** Start playing after mount. Reduced motion always starts paused. */
  readonly autoplay?: boolean;
  /** Teaching-step position to restore, or null outside step mode. */
  readonly step?: number | null;
  /** Maps a thrown error to its line and column in the scene fragment, when the host can. */
  readonly locate?: (error: unknown) => { readonly line: number; readonly column: number } | null;
  /** Wall clock in milliseconds, for grouping changes into undo steps. */
  readonly now?: () => number;
  /** Kits the scene may call: 3D, physics, charts, flowcharts. Loaded by the host. */
  readonly kits?: KitRegistry;
  /** Records where the scene created each element (needs `locate`), so checks can point at the line. */
  readonly traceSites?: boolean;
}

/** Seconds a step takes to move parameters to its values. */
export const STEP_TRANSITION_SECONDS = 0.6;

/** Fixed steps a simulation may take in one frame before it drops the backlog. */
export const MAX_SUBSTEPS = 240;

export interface SceneErrorRecord {
  readonly phase: ErrorPhase;
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface RuntimeStats {
  ticks: number;
  framesExecuted: number;
  playingFrames: number;
  pausedRedraws: number;
  idleTicks: number;
}

interface ReadoutEntry {
  readonly label: string;
  readonly fn: () => Readable;
  text: string;
}

interface DragBinding {
  readonly node: VNode;
  readonly label: string;
  readonly map: (p: DragInfo) => Values | void;
  readonly toLocal: (x: number, y: number) => Vec2;
  readonly end?: () => void;
  start: Vec2 | null;
}

interface ActionRecord {
  readonly label: string;
  readonly kind: 'button' | 'preset';
  readonly run: () => Values | void;
  readonly values?: Values;
}

interface LegendRecord {
  readonly node: VNode;
  readonly label: string;
  readonly toggle: boolean;
}

interface TableRecord {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: () => ReadonlyArray<ReadonlyArray<Readable>>;
  cells: string[][];
}

interface PredictRecord {
  readonly options: PredictOptions;
  chosen: number | null;
  revealed: boolean;
  answer: number | null;
  explanation: string | null;
}

interface SimulationRecord {
  readonly fn: (dt: number) => void;
  readonly step: number;
  acc: number;
}

interface LinkRecord {
  readonly a: string;
  readonly b: string;
  readonly aToB: (a: number) => number;
  readonly bToA: (b: number) => number;
}

const MAX_READOUTS = 12;
const MAX_TEXT = 600;
const MAX_ACTIONS = 8;
const MAX_TABLE_ROWS = 30;
const MAX_TABLE_COLUMNS = 8;
const MAX_STATE_KEYS = 64;
/** Tones that set a part apart enough to earn a legend entry. */
const ACCENTS = new Set(['a', 'b', 'c', 'lit']);

type Lifecycle = 'idle' | 'mounting' | 'mounted' | 'failed' | 'destroyed';

/**
 * Runs one scene. It owns parameters, the single model, frame callbacks and
 * text, and turns them into drawing commands and UI state. It has no DOM and
 * no clock: the renderer drives it with ticks, so the same runtime works in a
 * Worker, in the page and in Node.
 */
/** A stage's measure, checked: finite, non-zero scales and a short unit name. */
function checkMeasure(measure: StageMeasure): StageMeasure {
  const [sx, sy] = measure.scale;
  const [ox, oy] = measure.origin;
  if (![sx, sy, ox, oy].every(Number.isFinite) || sx === 0 || sy === 0) throw new SceneApiError('A measure needs finite, non-zero scales');
  const unit = String(measure.unit ?? '').slice(0, 12);
  return Object.freeze({ scale: [sx, sy] as const, origin: [ox, oy] as const, unit });
}

export class SceneRuntime {
  graph = new SceneGraph();
  parts = new PartRegistry(this.graph);
  readonly inc: Inc;
  readonly path: PathHelpers;
  readonly stats: RuntimeStats = { ticks: 0, framesExecuted: 0, playingFrames: 0, pausedRedraws: 0, idleTicks: 0 };
  readonly errors: SceneErrorRecord[] = [];

  time = 0;
  playing = false;
  speed = 1;

  private lifecycle: Lifecycle = 'idle';
  private scene: SceneFunction | null = null;
  private params = new Map<string, ParamState>();
  private paramHandles = new Set<Param>();
  private paramVersion = 0;
  private model: { compute: (values: ParamValues) => object; version: number; value: object } | null = null;
  private frameCallbacks: Array<(frame: FrameInfo) => void> = [];
  private redraws: Array<() => void> = [];
  private readouts: ReadoutEntry[] = [];
  private idea: string | null = null;
  private stepList: readonly Step[] | null = null;
  private explainFn: (() => string) | null = null;
  private describeFn: (() => string) | null = null;
  private explanation: string | null = null;
  private description: string | null = null;
  private tweens: TweenState[] = [];
  private stepTransition: TweenState | null = null;
  private stepIndex: number | null = null;
  private stepSaved: { readonly values: Record<string, number>; readonly playing: boolean } | null = null;
  private learnerFocus: string | null = null;
  private pendingStep: number | null | undefined = undefined;
  private random: () => number;
  private dirty = true;
  private visible = true;
  /** A frame read the time, or a plot follows it. */
  private usesTime = false;
  private framesRun = 0;
  private reducedMotion: boolean;
  private error: ErrorView | null = null;
  private lastUi: UiState = EMPTY_UI;
  private pendingValues: Record<string, number> | null = null;
  private pendingFormulas: Record<string, string> | null = null;
  private resetPending = false;
  private readonly maxDt: number;
  private readonly maxParams: number;
  private readonly history: History;

  // Interaction
  private drags = new Map<number, DragBinding>();
  private hovers = new Map<number, (p: Vec2 | null) => void>();
  private views = new Map<number, ViewController>();
  private stageZoom = new Map<number, boolean>();
  /** How the measuring tool reads each stage that offers it (VI-5). */
  private measures = new Map<number, StageMeasure>();
  // Controls and teaching
  private actions: ActionRecord[] = [];
  private links: LinkRecord[] = [];
  private legend: LegendRecord[] = [];
  private tables: TableRecord[] = [];
  private formulas: FormulaRecord[] = [];
  private prediction: PredictRecord | null = null;
  private compare: { available: boolean; on: boolean; ghosts: Map<number, VNode> } = { available: false, on: false, ghosts: new Map() };
  /** How the scene's panels sit together (VI-7). */
  private panels: 'row' | 'column' | 'grid' | null = null;
  // Time
  private timeline: Timeline | null = null;
  private simulations: SimulationRecord[] = [];
  private flows = new Map<VNode, number>();
  /** What moves with scene time on its own, such as a fluid's particles. */
  private steppers: Array<(dt: number) => void> = [];
  // State and hooks
  private stateValues = new Map<string, StateValue>();
  private stateListeners = new Map<string, Array<(value: StateValue) => void>>();
  private changed = new Set<string>();
  private resetHooks: Array<() => void> = [];
  private paramHooks: Array<(name: string, value: number) => void> = [];
  private stepHooks: Array<(index: number | null) => void> = [];
  private stepHookPending: number | null | undefined = undefined;
  private reportedUnknown = new Set<string>();
  // The idle tour (MO-1): one parameter swept while nobody touches the figure.
  private idleTour: { readonly name: string; readonly after: number; readonly period: number; elapsed: number; phase: number | null; from: number } | null = null;
  /** The learner has touched the figure, so the tour never runs again, even after a reset. */
  private idleEnded = false;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.random = mulberry32(options.seed ?? 1);
    this.maxDt = options.maxDt ?? 0.1;
    this.maxParams = options.maxParams ?? 8;
    this.reducedMotion = options.reducedMotion ?? false;
    this.history = new History(options.now ?? (() => Date.now()));
    this.path = createPathHelpers((requested) => this.reportCap(requested));
    this.graph.services = this.services();
    this.graph.trace = this.siteTracer();
    this.inc = this.createInc();
  }

  /** The scene line creating an element now: the first frame of a fresh stack inside the scene. */
  private siteTracer(): SceneGraph['trace'] {
    if (!this.options.traceSites || !this.options.locate) return null;
    return () => {
      const limits = Error as unknown as { stackTraceLimit?: number };
      const limit = limits.stackTraceLimit;
      limits.stackTraceLimit = 50;
      const probe = new Error('site');
      limits.stackTraceLimit = limit;
      return this.locateError(probe);
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  mount(scene: SceneFunction, values: Readonly<Record<string, number>> | undefined = this.options.values): RuntimeUpdate {
    this.scene = scene;
    this.lifecycle = 'mounting';
    this.restoreValues = values;
    try {
      scene(this.inc, Math);
      this.checkTeaching();
      this.checkDrags();
      this.lifecycle = 'mounted';
    } catch (error) {
      this.lifecycle = 'failed';
      this.record('mount', error);
    }
    this.playing = this.lifecycle === 'mounted' && (this.options.autoplay ?? true) && !this.reducedMotion;
    this.dirty = true;
    if (this.lifecycle === 'mounted') {
      this.publishInteractions();
      for (const hook of this.resetHooks) this.guard('hook', hook);
      // What the scene set while starting is where it starts, not a change for listeners.
      this.changed.clear();
    }
    const restoreStep = this.options.step;
    if (this.lifecycle === 'mounted' && this.stepList && !this.restoredStep && isStepIndex(restoreStep, this.stepList.length)) {
      // A saved teaching position returns without animating; it is already persisted.
      this.restoredStep = true;
      this.enterSteps(restoreStep, true);
      this.pendingStep = undefined;
    }
    // A fresh renderer needs the complete UI, not a diff against defaults.
    return { ...this.flush(), ui: this.uiState() };
  }

  private restoreValues: Readonly<Record<string, number>> | undefined;
  private restoredStep = false;

  get isMounted(): boolean {
    return this.lifecycle === 'mounted';
  }

  get isDestroyed(): boolean {
    return this.lifecycle === 'destroyed';
  }

  destroy(): void {
    this.lifecycle = 'destroyed';
    this.frameCallbacks = [];
    this.redraws = [];
    this.tweens = [];
    this.stepTransition = null;
    this.readouts = [];
    this.simulations = [];
    this.playing = false;
  }

  /** True while there is drawing work to do: playing something that moves, dirty or animating a transition. */
  needsFrame(): boolean {
    if (this.lifecycle !== 'mounted' || !this.visible) return false;
    const moving = this.playing && this.animated !== false;
    return moving || this.dirty || this.tweens.length > 0 || this.stepTransition !== null || this.touring();
  }

  /** Whether the idle tour is waiting or sweeping. */
  private touring(): boolean {
    return this.idleTour !== null && !this.idleEnded && !this.reducedMotion && this.stepIndex === null;
  }

  /** The learner did something: the idle tour stops for good. */
  touched(): void {
    this.idleEnded = true;
  }

  /** Waits, then sweeps the tour's parameter across its range, starting from where it is. */
  private tour(dt: number): void {
    const tour = this.idleTour!;
    const state = this.params.get(tour.name);
    if (!state) return;
    tour.elapsed += dt;
    if (tour.elapsed < tour.after) return;
    const span = state.max - state.min;
    if (!(span > 0)) return;
    if (tour.phase === null) {
      // Start the cosine where it equals the current value, so nothing jumps.
      const k = Math.min(1, Math.max(0, (state.value - state.min) / span));
      tour.phase = Math.acos(1 - 2 * k) / (2 * Math.PI);
      tour.from = state.value;
    }
    const since = tour.elapsed - tour.after;
    const sweep = state.min + span * (0.5 - 0.5 * Math.cos(2 * Math.PI * (tour.phase + since / tour.period)));
    // Ease into the sweep over the first second and a half, so it starts calmly.
    const w = Math.min(1, since / 1.5);
    this.applyParam(tour.name, tour.from + (sweep - tour.from) * w * w * (3 - 2 * w), false);
    this.followPartners([tour.name], new Set([tour.name]));
  }

  /** Whether the scene follows time; null until a frame has run. */
  get animated(): boolean | null {
    if (this.usesTime) return true;
    return this.framesRun > 0 ? false : null;
  }

  /**
   * Advances the scene by `realDt` seconds of wall time. Draws only when
   * playing or dirty; a paused, clean scene does no work at all.
   */
  tick(realDt: number): RuntimeUpdate {
    this.stats.ticks++;
    if (!this.needsFrame()) {
      this.stats.idleTicks++;
      return this.flush();
    }
    const capped = Math.min(Math.max(Number.isFinite(realDt) ? realDt : 0, 0), this.maxDt);
    if (this.touring()) this.tour(capped);
    if (this.stepTransition) {
      const transition = this.stepTransition;
      const { k, done } = advanceTween(transition, capped);
      this.guard('tween', () => transition.options.apply(k));
      if (done) this.stepTransition = null;
      this.dirty = true;
    }
    if (this.tweens.length > 0) {
      this.stepTween(capped);
      this.dirty = true;
    }
    this.drainChanges();
    if (this.playing) this.advance(capped * this.speed);
    else {
      this.runFrame(0);
      this.stats.pausedRedraws++;
    }
    this.dirty = false;
    this.refreshText();
    return this.flush();
  }

  /** Moves scene time on by `dt`: fixed simulation steps, then one frame. */
  private advance(dt: number): void {
    this.simulate(dt);
    for (const step of this.steppers) if (!this.guard('frame', () => step(dt))) break;
    this.time += dt;
    this.runFrame(dt);
    this.stats.playingFrames++;
    if (this.timeline?.finished(this.time)) this.playing = false;
  }

  private simulate(dt: number): void {
    for (const sim of this.simulations) {
      sim.acc += dt;
      let steps = 0;
      while (sim.acc >= sim.step && steps < MAX_SUBSTEPS) {
        if (!this.guard('frame', () => sim.fn(sim.step))) {
          sim.acc = 0;
          break;
        }
        sim.acc -= sim.step;
        steps++;
      }
      // A long stall drops its backlog rather than spiralling.
      if (steps >= MAX_SUBSTEPS) sim.acc = 0;
    }
  }

  /** One frame forward while paused (the settings panel's frame step). */
  stepFrame(): void {
    if (this.lifecycle !== 'mounted' || this.playing) return;
    this.drainChanges();
    this.advance((1 / 60) * this.speed);
    this.dirty = false;
    this.refreshText();
  }

  /** A learner's change. Outside step mode it is persisted; inside, leaving steps undoes it. */
  setParam(name: string, value: number): void {
    if (isSettingName(name)) {
      this.setValues({ [name]: value });
      return;
    }
    this.learnerChange({ [name]: value }, 'control');
  }

  /**
   * Applies values the learner caused, by a control, a drag, a button or a
   * preset: lands any step transition first, keeps linked parameters in step,
   * and records one undo entry.
   */
  private learnerChange(values: Values, source: 'control' | 'drag' | 'action' | 'undo', close = false): void {
    if (this.lifecycle !== 'mounted') return;
    if (this.stepTransition) this.finishStepTransition();
    const persist = this.stepIndex === null;
    const before: Record<string, number> = {};
    const touched = new Set<string>();
    const apply = (name: string, value: number) => {
      const state = this.params.get(name);
      if (!state) return;
      if (!touched.has(name)) before[name] = state.value;
      touched.add(name);
      this.applyParam(name, value, persist);
    };
    for (const [name, value] of Object.entries(values)) {
      if (!this.params.has(name)) {
        this.unknownParam(name, source === 'drag' ? 'drag' : 'action');
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      apply(name, value);
      // A linked partner follows, unless these values set it themselves.
      for (const link of this.links) {
        const partner = link.a === name ? link.b : link.b === name ? link.a : null;
        if (!partner || partner in values) continue;
        const fn = link.a === name ? link.aToB : link.bToA;
        const current = this.params.get(name)!.value;
        let next = Number.NaN;
        this.guard('action', () => {
          next = fn(current);
        });
        if (Number.isFinite(next)) apply(partner, next);
      }
    }
    if (persist && source !== 'undo') {
      const after: Record<string, number> = {};
      for (const name of touched) after[name] = this.params.get(name)!.value;
      this.history.record(before, after, close);
    }
  }

  private unknownParam(name: string, phase: ErrorPhase): void {
    if (this.reportedUnknown.has(name)) return;
    this.reportedUnknown.add(name);
    this.record(phase, new SceneApiError(`"${name}" is not a parameter`));
  }

  private finishStepTransition(): void {
    const transition = this.stepTransition;
    if (!transition) return;
    this.stepTransition = null;
    this.guard('tween', () => transition.options.apply(1));
  }

  private applyParam(name: string, value: number, persist: boolean): void {
    const state = this.params.get(name);
    if (!state || this.lifecycle !== 'mounted') return;
    const next = snap(state, value);
    if (!Number.isFinite(next) || next === state.value) return;
    state.value = next;
    this.paramVersion++;
    this.dirty = true;
    this.changed.add(name);
    if (persist) (this.pendingValues ??= {})[name] = next;
  }

  /**
   * Moves the linked partner of each parameter moved (CT-8), as a learner's
   * change does: a step, a prediction's reveal, the idle tour and
   * inc.state.set keep a pair such as frequency and period in step. A
   * partner in `fixed`, set by the same move, keeps its own value.
   */
  private followPartners(moved: Iterable<string>, fixed: ReadonlySet<string>): void {
    for (const name of moved) {
      for (const link of this.links) {
        const partner = link.a === name ? link.b : link.b === name ? link.a : null;
        if (!partner || fixed.has(partner) || !this.params.has(partner)) continue;
        const fn = link.a === name ? link.aToB : link.bToA;
        const current = this.params.get(name)!.value;
        let next = Number.NaN;
        this.guard('action', () => {
          next = fn(current);
        });
        if (Number.isFinite(next)) this.applyParam(partner, next, false);
      }
    }
  }

  setValues(values: Readonly<Record<string, number>>): void {
    const settings: Record<string, number> = {};
    const params: Record<string, number> = {};
    for (const [name, value] of Object.entries(values)) (isSettingName(name) ? settings : params)[name] = value;
    if (Object.keys(settings).length > 0 && this.timeline) {
      if (this.timeline.apply(Timeline.decode(settings))) {
        this.dirty = true;
        this.pendingValues = { ...this.pendingValues, ...this.timeline.encode() };
      }
    }
    for (const [name, value] of Object.entries(params)) {
      if (this.params.has(name)) this.learnerChange({ [name]: value }, 'control');
    }
  }

  play(): void {
    if (this.lifecycle !== 'mounted') return;
    // A timeline that played once starts again from the beginning.
    if (this.timeline?.finished(this.time)) this.time = 0;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  setSpeed(value: number): void {
    const nearest = SPEEDS.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), 1);
    this.speed = nearest;
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) this.dirty = true;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.playing = false;
      this.dirty = true;
    }
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  /** The learner drags an element; x and y are stage coordinates. */
  drag(id: number, phase: 'start' | 'move' | 'end', x: number, y: number): void {
    const binding = this.drags.get(id);
    if (!binding || this.lifecycle !== 'mounted' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const point = binding.toLocal(x, y);
    if (phase === 'start' || !binding.start) {
      binding.start = point;
      this.history.close();
    }
    const start = binding.start;
    const info: DragInfo = Object.freeze({ x: point[0], y: point[1], startX: start[0], startY: start[1], dx: point[0] - start[0], dy: point[1] - start[1] });
    let values: unknown;
    this.guard('drag', () => {
      values = binding.map(info);
    });
    if (isValues(values)) this.learnerChange(values, 'drag', phase === 'end');
    if (phase === 'end') {
      binding.start = null;
      this.history.close();
      if (binding.end) this.guard('drag', binding.end);
    }
    this.dirty = true;
  }

  /** The pointer moved over a stage that listens, or left it. */
  hover(stage: number, x: number | null, y: number | null): void {
    const handler = this.hovers.get(stage);
    if (!handler || this.lifecycle !== 'mounted') return;
    const point: Vec2 | null = x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? null : [x, y];
    this.guard('drag', () => handler(point));
    this.dirty = true;
  }

  /** A zoom, pan, orbit or camera change on a stage whose view the kit owns. */
  view(stage: number, action: ViewAction): void {
    const controller = this.views.get(stage);
    if (!controller || this.lifecycle !== 'mounted') return;
    let redraw = false;
    this.guard('drag', () => {
      redraw = controller.apply(action);
    });
    if (redraw) this.dirty = true;
  }

  /** The stages whose kit owns their view, with their controllers: for offline checks (CH-2). */
  viewControllers(): Array<readonly [number, ViewController]> {
    return this.lifecycle === 'mounted' ? [...this.views] : [];
  }

  /** Tells the renderer how each stage answers the pointer. */
  private publishInteractions(): void {
    for (const stage of this.graph.stages) {
      const controller = this.views.get(stage.id);
      const zoomable = this.stageZoom.get(stage.id) !== false;
      this.graph.setInteraction(stage.id, {
        zoom: !zoomable ? 'none' : controller ? (controller.mode?.() ?? 'runtime') : 'viewbox',
        hover: this.hovers.has(stage.id),
        orbit: controller?.orbit ?? false,
        views: controller?.views ?? [],
        measure: this.measures.get(stage.id) ?? null,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Buttons, presets, legend, formulas, predictions, history, timing, compare
  // -------------------------------------------------------------------------

  action(index: number): void {
    const record = this.actions[index];
    if (!record || this.lifecycle !== 'mounted') return;
    if (record.kind === 'preset') {
      this.learnerChange(record.values!, 'action', true);
      return;
    }
    let values: unknown;
    this.guard('action', () => {
      values = record.run();
    });
    if (isValues(values)) this.learnerChange(values, 'action', true);
    this.dirty = true;
  }

  setLegend(id: number, visible: boolean): void {
    const record = this.legend.find((r) => r.node.id === id);
    if (!record || !record.toggle) return;
    if (record.node.hidden === !visible) return;
    this.graph.setFlags(record.node, { hidden: !visible });
    this.dirty = true;
  }

  editFormula(index: number, source: string): void {
    const record = this.formulas[index];
    if (!record || !record.editable) return;
    const before = record.source;
    record.edit(source);
    if (record.source !== before) {
      (this.pendingFormulas ??= {})[String(index)] = record.source;
      this.paramVersion++;
      this.history.record({ [formulaKey(index)]: before }, { [formulaKey(index)]: record.source }, true);
    }
    // The error, or its clearing, shows either way.
    this.dirty = true;
  }

  /** Puts a formula back to a source it had, as undo, redo and reset do; it is saved like an edit. */
  private restoreFormula(index: number, source: string): void {
    const record = this.formulas[index];
    if (!record || record.source === source) return;
    record.edit(source);
    (this.pendingFormulas ??= {})[String(index)] = record.source;
    this.paramVersion++;
    this.dirty = true;
  }

  /** Every formula's source, as history keys. */
  private formulaSources(): Record<string, string> {
    return Object.fromEntries(this.formulas.map((record, index) => [formulaKey(index), record.source] as const));
  }

  /** Applies an undo or redo: parameter values, timing settings and formula sources. */
  private applyHistory(values: Readonly<Record<string, HistoryValue>>): void {
    const params: Record<string, number> = {};
    const settings: Record<string, number> = {};
    for (const [key, value] of Object.entries(values)) {
      const formula = FORMULA_KEY.exec(key);
      if (formula) {
        if (typeof value === 'string') this.restoreFormula(Number(formula[1]), value);
      } else if (typeof value === 'number') (isSettingName(key) ? settings : params)[key] = value;
    }
    if (Object.keys(settings).length > 0 && this.timeline?.apply(Timeline.decode(settings))) {
      this.pendingValues = { ...this.pendingValues, ...this.timeline.encode() };
      this.dirty = true;
    }
    if (Object.keys(params).length > 0) this.learnerChange(params, 'undo');
  }

  predict(index: number, choice: number | null, reveal = false): void {
    const record = this.prediction;
    if (index !== 0 || !record || this.lifecycle !== 'mounted') return;
    if (!record.revealed && (choice === null || (Number.isInteger(choice) && choice >= 0 && choice < record.options.options.length))) {
      record.chosen = choice;
    }
    if (reveal && !record.revealed && record.chosen !== null) {
      record.revealed = true;
      const answer = record.options.answer;
      this.guard('action', () => {
        const value = typeof answer === 'function' ? answer() : answer;
        record.answer = Number.isInteger(value) && value >= 0 && value < record.options.options.length ? value : null;
      });
      if (record.options.reveal) {
        const target: Record<string, number> = { ...this.values() };
        for (const [name, value] of Object.entries(record.options.reveal)) if (this.params.has(name)) target[name] = value;
        this.moveTo(target, this.reducedMotion, Object.keys(record.options.reveal));
      }
      this.refreshPrediction();
    }
    this.dirty = true;
  }

  undo(): void {
    const values = this.history.undo();
    if (values) this.applyHistory(values);
  }

  redo(): void {
    const values = this.history.redo();
    if (values) this.applyHistory(values);
  }

  setTiming(settings: { readonly duration?: number; readonly loop?: LoopMode; readonly ease?: TimelineOptions['ease'] }): void {
    if (!this.timeline) return;
    const before = this.timeline.encode();
    if (!this.timeline.apply(settings)) return;
    const after = this.timeline.encode();
    this.pendingValues = { ...this.pendingValues, ...after };
    this.history.record(before, after, true);
    this.dirty = true;
  }

  setCompare(on: boolean): void {
    if (!this.compare.available || this.lifecycle !== 'mounted') return;
    this.compare.on = on;
    if (on) this.snapshotGhosts();
    for (const ghost of this.compare.ghosts.values()) {
      if (ghost.hidden === on) this.graph.setFlags(ghost, { hidden: !on });
    }
    this.dirty = true;
  }

  /** Faint copies of every curve now drawn, to compare against after a change (TE-5). */
  private snapshotGhosts(): void {
    for (const stage of this.graph.stages) {
      const stageNode = this.graph.nodes.get(stage.id)!;
      for (const node of [...this.graph.nodes.values()]) {
        if (node.stage !== stage.id || node.hidden || node.layer !== 'mid') continue;
        if (node.kind !== 'path' && node.kind !== 'polyline') continue;
        if (node.extra.includes('inc-ghost')) continue;
        let ghost = this.compare.ghosts.get(node.id);
        if (!ghost) {
          if (this.compare.ghosts.size >= 40) break;
          ghost = this.graph.create(node.kind, stageNode, 'back');
          this.graph.setExtra(ghost, 'inc-ghost');
          if (node.fill) this.graph.setFlags(ghost, { fill: true });
          this.compare.ghosts.set(node.id, ghost);
        }
        const attribute = node.kind === 'path' ? 'd' : 'points';
        this.graph.setAttribute(ghost, attribute, node.attrs.get(attribute) ?? null);
        this.graph.setAttribute(ghost, 'transform', node.attrs.get('transform') ?? null);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Teaching steps
  // -------------------------------------------------------------------------

  get currentStep(): number | null {
    return this.stepIndex;
  }

  step(action: 'enter' | 'next' | 'prev' | 'exit' | 'goto', index?: number): void {
    if (this.lifecycle !== 'mounted' || !this.stepList) return;
    const last = this.stepList.length - 1;
    const clamp = (i: number) => Math.max(0, Math.min(last, Math.floor(i)));
    switch (action) {
      case 'enter':
        this.enterSteps(clamp(index ?? 0), false);
        break;
      case 'next':
        if (this.stepIndex === null) this.enterSteps(0, false);
        else if (this.stepIndex < last) this.gotoStep(this.stepIndex + 1, false);
        break;
      case 'prev':
        if (this.stepIndex !== null && this.stepIndex > 0) this.gotoStep(this.stepIndex - 1, false);
        break;
      case 'goto':
        if (index === undefined || !Number.isFinite(index)) break;
        if (this.stepIndex === null) this.enterSteps(clamp(index), false);
        else this.gotoStep(clamp(index), false);
        break;
      case 'exit':
        this.exitSteps();
        break;
    }
  }

  /** Directs attention to a registered part, or clears the learner's focus. */
  focusPart(name: string | null): void {
    if (name !== null && !this.parts.parts.has(name)) return;
    this.learnerFocus = name;
  }

  private enterSteps(index: number, immediate: boolean): void {
    if (this.stepIndex === null) this.stepSaved = { values: this.values(), playing: this.playing };
    this.gotoStep(index, immediate);
  }

  private gotoStep(index: number, immediate: boolean): void {
    const steps = this.stepList;
    const saved = this.stepSaved;
    if (!steps || !saved) return;
    const step = steps[index];
    if (!step) return;
    this.stepIndex = index;
    // Each step's values build on the earlier steps, so going back is exact; linked partners follow the values the steps set.
    const target: Record<string, number> = { ...saved.values };
    const set = new Set<string>();
    for (let i = 0; i <= index; i++) {
      Object.assign(target, steps[i]?.set ?? {});
      for (const name of Object.keys(steps[i]?.set ?? {})) set.add(name);
    }
    this.moveTo(target, immediate || this.reducedMotion, set);
    this.playing = step.hold ? false : saved.playing && !this.reducedMotion;
    this.pendingStep = index;
    this.stepHookPending = index;
    this.dirty = true;
  }

  private exitSteps(): void {
    const saved = this.stepSaved;
    if (this.stepIndex === null || !saved) return;
    this.stepIndex = null;
    this.stepSaved = null;
    this.stepTransition = null;
    for (const [name, value] of Object.entries(saved.values)) this.applyParam(name, value, false);
    this.playing = saved.playing && !this.reducedMotion;
    this.pendingStep = null;
    this.stepHookPending = null;
    this.dirty = true;
  }

  /** Moves parameters to `target`, animated unless `immediate`. Never persisted. */
  /** Moves to `target`; `set` names the values the move sets itself, which their linked partners follow. */
  private moveTo(target: Readonly<Record<string, number>>, immediate: boolean, set: Iterable<string> = Object.keys(target)): void {
    const from = this.values();
    const names = Object.keys(target).filter((name) => this.params.has(name) && target[name] !== from[name]);
    // Linked partners follow the values moved, all the way; a partner the move sets itself keeps that value.
    const fixed = new Set(set);
    this.stepTransition = null;
    if (names.length === 0) return;
    if (immediate) {
      for (const name of names) this.applyParam(name, target[name]!, false);
      this.followPartners(names, fixed);
      return;
    }
    this.stepTransition = {
      elapsed: 0,
      options: {
        duration: STEP_TRANSITION_SECONDS,
        ease: 'inOut',
        apply: (k) => {
          for (const name of names) this.applyParam(name, from[name]! + (target[name]! - from[name]!) * k, false);
          this.followPartners(names, fixed);
        },
      },
    };
  }

  /** Rebuilds the scene at time zero, keeping the learner's values. */
  restart(): RuntimeUpdate {
    return this.rebuild(this.stepSaved ? { ...this.stepSaved.values } : this.values());
  }

  /**
   * Rebuilds the scene as the agent made it: its parameter defaults, its own
   * formulas and its timing, whatever the learner edited. Undoable.
   */
  reset(): RuntimeUpdate {
    const defaults: Record<string, number> = {};
    for (const p of this.params.values()) defaults[p.name] = p.defaultValue;
    const before: Record<string, HistoryValue> = { ...this.learnerValues(), ...this.timeline?.encode(), ...this.formulaSources() };
    const edited = this.formulaSources();
    const update = this.rebuild(defaults, true);
    const timing = this.timeline?.encode() ?? {};
    const formulas = this.formulaSources();
    // The note keeps the agent's formulas and timing again, as it keeps the defaults.
    for (const [key, source] of Object.entries(formulas)) if (edited[key] !== source) (this.pendingFormulas ??= {})[FORMULA_KEY.exec(key)![1]!] = source;
    if (this.timeline) this.pendingValues = { ...this.pendingValues, ...timing };
    this.history.record(before, { ...defaults, ...timing, ...formulas }, true);
    const flushed = this.flush();
    return {
      ...update,
      ...(flushed.formulas ? { formulas: flushed.formulas } : {}),
      values: { ...defaults, ...timing },
      ui: { ...update.ui, history: { undo: this.history.canUndo, redo: this.history.canRedo } },
    };
  }

  /** Current parameter values (what the drawing shows). */
  values(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.params.values()) out[p.name] = p.value;
    return out;
  }

  /** The learner's own values: during step mode, the values they will return to. */
  learnerValues(): Record<string, number> {
    return this.stepSaved ? { ...this.stepSaved.values } : this.values();
  }

  /** Remounts the scene with these values; `original` drops the learner's formula edits and timing, as reset does. */
  private rebuild(values: Record<string, number>, original = false): RuntimeUpdate {
    const scene = this.scene;
    if (!scene || this.lifecycle === 'destroyed') return this.flush();
    const wasPlaying = this.stepSaved ? this.stepSaved.playing : this.playing;
    const timing = original ? undefined : this.timeline?.encode();
    const formulas = original ? {} : Object.fromEntries(this.formulas.map((f, i) => [String(i), f.source] as const));
    this.originalFormulas = original;
    if (this.stepIndex !== null) this.pendingStep = null;
    this.stepIndex = null;
    this.stepSaved = null;
    this.stepTransition = null;
    this.learnerFocus = null;
    this.graph = new SceneGraph();
    this.graph.services = this.services();
    this.graph.trace = this.siteTracer();
    this.parts = new PartRegistry(this.graph);
    this.params = new Map();
    this.paramHandles = new Set();
    this.paramVersion++;
    this.model = null;
    this.frameCallbacks = [];
    this.redraws = [];
    this.readouts = [];
    this.idea = null;
    this.stepList = null;
    this.explainFn = null;
    this.describeFn = null;
    this.tweens = [];
    this.idleTour = null;
    this.error = null;
    this.usesTime = false;
    this.framesRun = 0;
    this.time = 0;
    this.random = mulberry32(this.options.seed ?? 1);
    this.drags = new Map();
    this.hovers = new Map();
    this.views = new Map();
    this.stageZoom = new Map();
    this.measures = new Map();
    this.actions = [];
    this.links = [];
    this.legend = [];
    this.tables = [];
    this.formulas = [];
    this.prediction = null;
    this.compare = { available: false, on: false, ghosts: new Map() };
    this.timeline = null;
    this.simulations = [];
    this.flows = new Map();
    this.steppers = [];
    this.stateValues = new Map();
    this.stateListeners = new Map();
    this.changed = new Set();
    this.resetHooks = [];
    this.paramHooks = [];
    this.stepHooks = [];
    this.reportedUnknown = new Set();
    this.resetPending = true;
    this.rebuildFormulas = formulas;
    const update = this.mount(scene, { ...values, ...timing });
    this.rebuildFormulas = null;
    this.originalFormulas = false;
    this.playing = this.lifecycle === 'mounted' && wasPlaying;
    return { ...update, needsFrame: this.needsFrame() };
  }

  private rebuildFormulas: Readonly<Record<string, string>> | null = null;
  /** A reset remounts with the agent's own formulas, not the edits a note saved. */
  private originalFormulas = false;

  // -------------------------------------------------------------------------
  // Frames and text
  // -------------------------------------------------------------------------

  /** Runs state and parameter listeners for changes since the last frame. */
  private drainChanges(): void {
    for (let round = 0; round < 8 && (this.changed.size > 0 || this.stepHookPending !== undefined); round++) {
      const keys = [...this.changed];
      this.changed.clear();
      for (const key of keys) {
        const listeners = this.stateListeners.get(key);
        const value = this.readState(key);
        if (listeners && value !== undefined) for (const listener of listeners) this.guard('hook', () => listener(value));
        const param = this.params.get(key);
        if (param) for (const hook of this.paramHooks) this.guard('hook', () => hook(key, param.value));
      }
      if (this.stepHookPending !== undefined) {
        const index = this.stepHookPending;
        this.stepHookPending = undefined;
        for (const hook of this.stepHooks) this.guard('hook', () => hook(index));
      }
    }
  }

  private runFrame(dt: number): void {
    const runtime = this;
    const time = this.time;
    const timeline = this.timeline;
    // Reading time or dt marks the scene as animated; a still scene stops asking for frames.
    const frame: FrameInfo = Object.freeze({
      get time() {
        runtime.usesTime = true;
        return time;
      },
      get dt() {
        runtime.usesTime = true;
        return dt;
      },
      get progress() {
        runtime.usesTime = true;
        return timeline ? timeline.progress(time) : 0;
      },
    });
    this.framesRun++;
    let ok = true;
    for (const callback of this.frameCallbacks) ok = this.guard('frame', () => callback(frame)) && ok;
    for (const redraw of this.redraws) ok = this.guard('plot', redraw) && ok;
    for (const [node, speed] of this.flows) {
      // Dashes move with scene time, so they stop when paused and under reduced motion.
      const offset = -((time * speed) % 14);
      this.graph.setAttribute(node, 'stroke-dashoffset', Math.round(offset * 100) / 100);
    }
    this.stats.framesExecuted++;
    if (ok && this.error && this.error.phase !== 'mount') this.error = null;
  }

  private refreshText(): void {
    for (const entry of this.readouts) {
      this.guard('readout', () => {
        const value = entry.fn();
        if (typeof value === 'number' && !Number.isFinite(value)) {
          this.graph.diagnostics.push({ kind: 'non-finite', message: `Readout "${entry.label}" is ${String(value)}` });
          entry.text = '—';
          return;
        }
        entry.text = clip(formatReadable(value));
      });
    }
    if (this.explainFn) {
      const fn = this.explainFn;
      this.guard('explain', () => {
        this.explanation = clip(String(fn()));
      });
    }
    if (this.describeFn) {
      const fn = this.describeFn;
      this.guard('describe', () => {
        this.description = clip(String(fn()));
      });
    }
    for (const table of this.tables) {
      this.guard('readout', () => {
        const rows = table.rows();
        if (!Array.isArray(rows)) throw new SceneApiError(`Table "${table.title}" rows must be a list`);
        table.cells = rows
          .slice(0, MAX_TABLE_ROWS)
          .map((row) => (Array.isArray(row) ? row : [row]).slice(0, table.columns.length).map((cell) => clip(formatReadable(cell as Readable), 40)));
      });
    }
    this.refreshPrediction();
  }

  private refreshPrediction(): void {
    const record = this.prediction;
    if (!record || !record.revealed) return;
    const explain = record.options.explain;
    if (explain === undefined) return;
    this.guard('explain', () => {
      record.explanation = clip(String(typeof explain === 'function' ? explain() : explain));
    });
  }

  private stepTween(dt: number): void {
    const tween = this.tweens[0];
    if (!tween) return;
    const { k, done } = advanceTween(tween, dt);
    this.guard('tween', () => tween.options.apply(k));
    if (done) {
      this.tweens.shift();
      const commit = tween.options.commit;
      if (commit) this.guard('tween', () => commit());
    }
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  /** Commands and changed UI since the last flush. */
  flush(): RuntimeUpdate {
    const commands = this.graph.flush();
    const ui = this.uiState();
    const changed: Partial<UiState> = {};
    for (const key of Object.keys(ui) as Array<keyof UiState>) {
      if (JSON.stringify(ui[key]) !== JSON.stringify(this.lastUi[key])) {
        (changed as Record<string, unknown>)[key] = ui[key];
      }
    }
    this.lastUi = ui;
    const update: { -readonly [K in keyof RuntimeUpdate]: RuntimeUpdate[K] } = {
      commands,
      ui: changed,
      needsFrame: this.needsFrame(),
    };
    if (this.resetPending) {
      update.reset = true;
      this.resetPending = false;
    }
    if (this.pendingValues) {
      update.values = this.pendingValues;
      this.pendingValues = null;
    }
    if (this.pendingStep !== undefined) {
      update.step = this.pendingStep;
      this.pendingStep = undefined;
    }
    if (this.pendingFormulas) {
      update.formulas = this.pendingFormulas;
      this.pendingFormulas = null;
    }
    return update;
  }

  /** The complete current UI state, for a fresh renderer. */
  uiState(): UiState {
    const params: ParamView[] = [...this.params.values()].map((p) => ({
      name: p.name,
      label: p.label,
      unit: p.unit,
      note: p.note,
      min: p.min,
      max: p.max,
      step: p.step,
      value: p.value,
      defaultValue: p.defaultValue,
      kind: p.kind,
      options: p.options,
      buttons: p.buttons,
      linked: p.linked,
    }));
    const values = this.values();
    const actions: ActionView[] = this.actions.map((a, index) => ({
      index,
      label: a.label,
      kind: a.kind,
      active: a.kind === 'preset' && Object.entries(a.values ?? {}).every(([name, value]) => values[name] === snapTo(this.params.get(name), value)),
    }));
    return {
      params,
      readouts: this.readouts.map((r) => ({ label: r.label, text: r.text })),
      parts: [...this.parts.parts.values()].map((p) => ({ name: p.name, label: p.label, info: p.info, id: p.node.id, tone: p.node.tone })),
      playing: this.playing,
      animated: this.animated,
      speed: this.speed,
      idea: this.idea,
      explanation: this.explanation,
      description: this.description,
      steps: this.stepsView(),
      focus: this.learnerFocus ?? this.stepFocus(),
      error: this.error,
      actions,
      legend: this.legendView(),
      formulas: this.formulas.map((f, index) => ({ index, label: f.label, source: f.source, editable: f.editable, input: f.input, error: f.error, draft: f.draft })),
      predict: this.predictView(),
      tables: this.tables.map((t) => ({ title: t.title, columns: t.columns, rows: t.cells })),
      timing: this.timeline?.view() ?? null,
      history: { undo: this.history.canUndo, redo: this.history.canRedo },
      card: { title: this.graph.stages[0]?.title ?? null, hint: this.hint() },
      views: [...this.views.entries()].map(([id, controller]) => ({ id, changed: controller.changed() })),
      compare: { available: this.compare.available, on: this.compare.on },
      panels: this.panels,
    };
  }

  private legendView(): LegendView[] {
    const out: LegendView[] = this.legend.map((r) => ({
      id: r.node.id,
      label: r.label,
      tone: r.node.tone,
      visible: !r.node.hidden,
      toggle: r.toggle,
      part: r.node.part,
      dashed: r.node.dashed,
    }));
    // Parts in accent tones name what each colour means, when there are two or more.
    const listed = new Set(out.map((entry) => entry.id));
    const accented = [...this.parts.parts.values()].filter((p) => p.legend && p.node.tone && ACCENTS.has(p.node.tone) && !listed.has(p.node.id));
    if (accented.length >= 2 && new Set(accented.map((p) => p.node.tone)).size >= 2) {
      for (const p of accented) {
        out.push({ id: p.node.id, label: p.label, tone: p.node.tone, visible: !p.node.hidden, toggle: false, part: p.name, dashed: p.node.dashed });
      }
    }
    return out;
  }

  private predictView(): PredictView | null {
    const record = this.prediction;
    if (!record) return null;
    return {
      index: 0,
      question: record.options.question,
      options: record.options.options,
      chosen: record.chosen,
      revealed: record.revealed,
      answer: record.revealed ? record.answer : null,
      explanation: record.revealed ? record.explanation : null,
    };
  }

  /** One line on how to use the figure, from what it offers (BR-7). */
  private hint(): string | null {
    const drags = [...new Set([...this.drags.values()].map((d) => d.label))];
    const controls = this.params.size > 0;
    if (drags.length > 0) {
      const what = drags.length === 1 ? drags[0]! : 'the highlighted parts';
      return controls ? `Drag ${what} or change the values below.` : `Drag ${what}.`;
    }
    if (controls) return 'Change the values below to see what happens.';
    if (this.stepList) return 'Walk through it step by step.';
    return null;
  }

  private stepFocus(): string | null {
    if (this.stepIndex === null) return null;
    return this.stepList?.[this.stepIndex]?.focus ?? null;
  }

  private stepsView(): UiState['steps'] {
    if (!this.stepList) return null;
    const step = this.stepIndex === null ? undefined : this.stepList[this.stepIndex];
    return {
      count: this.stepList.length,
      index: this.stepIndex,
      say: step?.say ?? null,
      focus: step?.focus ?? null,
    };
  }

  /** Commands that rebuild the whole scene, plus the full UI, for a fresh renderer. */
  fullState(): RuntimeUpdate {
    return { reset: true, commands: this.graph.snapshotCommands(), ui: this.uiState(), needsFrame: this.needsFrame() };
  }

  /** Current model value, recomputed when a parameter changed. */
  modelValue(): object {
    const model = this.model;
    if (!model) return {};
    if (model.version !== this.paramVersion) {
      model.version = this.paramVersion;
      const values = Object.freeze(this.values());
      this.guard('model', () => {
        const value = model.compute(values);
        if (typeof value !== 'object' || value === null) throw new SceneApiError('inc.model must return an object');
        model.value = value;
      });
    }
    return model.value;
  }

  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------

  private guard(phase: ErrorPhase, fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (error) {
      this.record(phase, error);
      return false;
    }
  }

  record(phase: ErrorPhase, error: unknown): void {
    // A runaway loop is reported as such, wherever it was caught.
    const where = isRunaway(error) ? 'runaway' : phase;
    // Errors thrown in another realm are not `instanceof Error` here.
    const name = isErrorLike(error) ? error.name : 'Error';
    const message = clip(isErrorLike(error) ? error.message : String(error));
    const stack = isErrorLike(error) && typeof error.stack === 'string' ? error.stack : undefined;
    const location = this.locateError(error);
    const at = location ? { line: location.line, column: location.column } : {};
    if (this.errors.length < 50) this.errors.push({ phase: where, message, name, ...(stack ? { stack } : {}), ...at });
    if (!this.error || this.error.phase !== 'mount') this.error = { phase: where, message, ...at };
    if (phase === 'frame' || phase === 'plot' || where === 'runaway') this.playing = false;
  }

  private locateError(error: unknown): { readonly line: number; readonly column: number } | null {
    try {
      return this.options.locate?.(error) ?? null;
    } catch {
      return null;
    }
  }

  private reportCap(requested: number): void {
    if (this.graph.diagnostics.length < 200) {
      this.graph.diagnostics.push({ kind: 'samples-capped', message: `Requested ${requested} samples; capped at 500` });
    }
  }

  // -------------------------------------------------------------------------
  // Services for handles and kits
  // -------------------------------------------------------------------------

  private services(): GraphServices {
    return {
      addDrag: (node, label, map, toLocal) => this.addDrag(node, label, map, toLocal),
      onRedraw: (fn) => {
        this.redraws.push(fn);
      },
      onStep: (fn) => {
        this.steppers.push(fn);
        this.usesTime = true;
      },
      random: () => this.random(),
      setFlow: (node, speed) => {
        const extra = node.extra.replace(/\binc-flow\b/, '').trim();
        if (speed === 0) {
          this.flows.delete(node);
          this.graph.setExtra(node, extra);
          return;
        }
        this.flows.set(node, speed);
        this.usesTime = true;
        this.graph.setExtra(node, `${extra} inc-flow`.trim());
      },
    };
  }

  private addDrag(node: VNode, label: string, map: (p: DragInfo) => Values | void, toLocal: (x: number, y: number) => Vec2 = (x, y) => [x, y], end?: () => void): void {
    // A second drag on the same element, such as graph.drag on a graph.handle, says how it drags now: the later one wins.
    if (!this.drags.has(node.id) && this.drags.size >= 24) throw new SceneApiError('At most 24 draggable elements');
    const text = String(label).slice(0, 60);
    this.drags.set(node.id, { node, label: text, map, toLocal, ...(end ? { end } : {}), start: null });
    this.graph.markDrag(node, text);
  }

  /** The services a drawing kit gets for one stage. */
  kitContext(stage: StageHandle, stageId: number): KitContext {
    const runtime = this;
    return {
      stage,
      path: this.path,
      time: () => runtime.time,
      markTimeUse: () => {
        runtime.usesTime = true;
      },
      onRedraw: (fn) => runtime.redraws.push(fn),
      reportCap: (n) => runtime.reportCap(n),
      isFormula: (value): value is ReturnType<Inc['formula']> => typeof value === 'function' && typeof (value as { source?: unknown }).source === 'string',
      addDrag: (node, label, map, toLocal, end) => runtime.addDrag(node, label, map, toLocal, end),
      addHover: (fn) => {
        runtime.hovers.set(stageId, fn);
      },
      setView: (controller) => {
        runtime.views.set(stageId, controller);
      },
      setMeasure: (measure) => {
        if (measure === null) runtime.measures.delete(stageId);
        else runtime.measures.set(stageId, checkMeasure(measure));
        // Once the scene is running, a changed view tells the renderer at once.
        if (runtime.lifecycle === 'mounted') runtime.publishInteractions();
      },
      addLegend: (node, label, toggle) => {
        if (runtime.legend.length < 12) runtime.legend.push({ node, label: String(label).slice(0, 60), toggle });
      },
      param: (name): ParamInfo | undefined => {
        const p = runtime.params.get(name);
        return p ? { value: p.value, min: p.min, max: p.max, step: p.step } : undefined;
      },
      simulate: (fn, step) => {
        runtime.simulations.push({ fn, step, acc: 0 });
        runtime.usesTime = true;
      },
      reducedMotion: () => runtime.reducedMotion,
      warn: (message) => {
        if (runtime.graph.diagnostics.length < 200) runtime.graph.diagnostics.push({ kind: 'budget', message });
      },
      restyle: (node, look) => {
        const flags: Parameters<SceneGraph['setFlags']>[1] = {};
        let changed = false;
        for (const key of ['tone', 'dashed', 'hidden', 'fill', 'shade', 'extra'] as const) {
          const value = look[key];
          if (value !== undefined && node[key] !== value) {
            (flags as Record<string, unknown>)[key] = value;
            changed = true;
          }
        }
        if (changed) runtime.graph.setFlags(node, flags);
      },
      setOwner: (node, part) => runtime.graph.setOwner(node, part),
      now: runtime.options.now ?? (() => Date.now()),
      paramVersion: () => runtime.paramVersion,
    };
  }

  /** A stage drawn by a kit: inc.space3d, inc.graph3d, inc.physics2d, inc.chart, inc.flow. */
  private kitStage(call: KitCall, selector: string, options: unknown): unknown {
    this.requireMounting(call);
    const name = KIT_OF[call];
    const entry = this.options.kits?.[name]?.calls[call];
    if (!entry) throw new SceneApiError(`inc.${call} needs the ${name} kit, which this page did not load`);
    if (typeof options !== 'object' || options === null) throw new SceneApiError(`inc.${call} needs an options object with a title`);
    const { title, description, zoom } = options as { title?: unknown; description?: unknown; zoom?: unknown };
    if (typeof title !== 'string' || title.trim() === '') throw new SceneApiError(`inc.${call} needs a title for its accessible name`);
    if (description !== undefined && typeof description !== 'string') throw new SceneApiError(`inc.${call}: description must be text`);
    const { viewBox, clip } = entry.layout(options);
    const node = this.graph.createStage(selector, viewBox, title, (description as string | undefined) ?? '', clip);
    this.stageZoom.set(node.id, zoom !== false);
    const stage = new StageHandle(this.graph, node, viewBox, this.parts);
    const made = entry.create(this.kitContext(stage, node.id), options);
    // A kit's methods, too, may be taken off it and called alone.
    return typeof made === 'object' && made !== null ? bindMethods(made) : made;
  }

  // -------------------------------------------------------------------------
  // The inc API
  // -------------------------------------------------------------------------

  private requireMounting(call: string): void {
    if (this.lifecycle !== 'mounting') {
      throw new SceneApiError(`inc.${call} must be called when the scene starts, not later`);
    }
  }

  /** Every drag has a map once the scene has mounted: a handle placed at numbers gets one from graph.drag. */
  private checkDrags(): void {
    for (const binding of this.drags.values()) {
      if (binding.map !== AWAITING_MAP) continue;
      throw new SceneApiError(
        `graph.handle at numbers sets no parameter, so "${binding.label}" needs a map: graph.drag(handle, (p) => ({ name: p.x })), or name parameters in quotes, such as { x: 'phase', y: 0 }`,
      );
    }
  }

  private checkTeaching(): void {
    if (!this.stepList) return;
    this.stepList.forEach((step, index) => {
      if (step.focus !== undefined && !this.parts.parts.has(step.focus)) {
        throw new SceneApiError(`Step ${index + 1} focuses on "${step.focus}", which is not a registered part`);
      }
      for (const name of Object.keys(step.set ?? {})) {
        if (!this.params.has(name)) throw new SceneApiError(`Step ${index + 1} sets "${name}", which is not a parameter`);
      }
    });
  }

  private addParam(name: string, options: ParamOptions, shape?: ControlShape): ParamState {
    if (this.params.has(name)) throw new SceneApiError(`Parameter "${name}" is declared twice`);
    if (this.params.size >= this.maxParams) throw new SceneApiError(`A figure has at most ${this.maxParams} adjustable parameters`);
    const state = createParamState(name, options ?? ({} as ParamOptions), this.restoreValues?.[name], shape);
    this.params.set(name, state);
    this.paramHandles.add(state.handle);
    this.paramVersion++;
    return state;
  }

  private readState(key: string): StateValue | undefined {
    const param = this.params.get(key);
    return param ? param.value : this.stateValues.get(key);
  }

  private createInc(): Inc {
    const runtime = this;
    const state = Object.freeze({
      get(key: string): StateValue | undefined {
        return runtime.readState(String(key));
      },
      set(key: string, value: StateValue): void {
        if (typeof key !== 'string' || key === '' || key.length > 40) throw new SceneApiError('A state key is a short name');
        if (runtime.params.has(key)) {
          if (typeof value !== 'number') throw new SceneApiError(`"${key}" is a parameter and holds a number`);
          runtime.applyParam(key, value, false);
          runtime.followPartners([key], new Set([key]));
          return;
        }
        const ok = (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 200);
        if (!ok) throw new SceneApiError(`State "${key}" must be a finite number, true or false, or short text`);
        if (runtime.stateValues.get(key) === value) return;
        if (!runtime.stateValues.has(key) && runtime.stateValues.size >= MAX_STATE_KEYS) throw new SceneApiError(`At most ${MAX_STATE_KEYS} state values`);
        runtime.stateValues.set(key, value);
        runtime.changed.add(key);
        runtime.dirty = true;
      },
      on(key: string, callback: (value: StateValue) => void): void {
        if (typeof callback !== 'function') throw new SceneApiError('inc.state.on needs a function');
        const list = runtime.stateListeners.get(key) ?? [];
        if (list.length >= 8) throw new SceneApiError(`At most 8 listeners for "${key}"`);
        list.push(callback);
        runtime.stateListeners.set(key, list);
      },
    });
    const inc: Inc = {
      param(name: string, options: ParamOptions): Param {
        runtime.requireMounting('param');
        return runtime.addParam(name, options).handle;
      },
      toggle(name, options) {
        runtime.requireMounting('toggle');
        const { param, shape } = toggleControl(name, options);
        return runtime.addParam(name, param, shape).handle as ReturnType<Inc['toggle']>;
      },
      choice(name, options) {
        runtime.requireMounting('choice');
        const { param, shape } = choiceControl(name, options);
        return runtime.addParam(name, param, shape).handle as ReturnType<Inc['choice']>;
      },
      color(name, options) {
        runtime.requireMounting('color');
        const { param, shape } = colorControl(name, options);
        return runtime.addParam(name, param, shape).handle as ReturnType<Inc['color']>;
      },
      button(label, action) {
        runtime.requireMounting('button');
        if (typeof label !== 'string' || label.trim() === '' || label.length > 40) throw new SceneApiError('A button needs a short label');
        if (typeof action !== 'function') throw new SceneApiError(`Button "${label}" needs a function`);
        if (runtime.actions.length >= MAX_ACTIONS) throw new SceneApiError(`At most ${MAX_ACTIONS} buttons and presets`);
        runtime.actions.push({ label, kind: 'button', run: action });
      },
      presets(presets) {
        runtime.requireMounting('presets');
        const entries = Object.entries(presets ?? {});
        if (entries.length === 0) throw new SceneApiError('inc.presets needs at least one named set of values');
        for (const [label, values] of entries) {
          if (label.trim() === '' || label.length > 40) throw new SceneApiError('A preset needs a short name');
          if (typeof values !== 'object' || values === null) throw new SceneApiError(`Preset "${label}" needs parameter values`);
          for (const [name, value] of Object.entries(values)) {
            if (!runtime.params.has(name)) throw new SceneApiError(`Preset "${label}" sets "${name}", which is not a parameter declared before it`);
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new SceneApiError(`Preset "${label}" sets ${name} to something that is not a number`);
          }
          if (runtime.actions.length >= MAX_ACTIONS) throw new SceneApiError(`At most ${MAX_ACTIONS} buttons and presets`);
          const frozen = Object.freeze({ ...values });
          runtime.actions.push({ label, kind: 'preset', run: () => frozen, values: frozen });
        }
      },
      link(a, b, aToB, bToA) {
        runtime.requireMounting('link');
        const first = runtime.params.get(a);
        const second = runtime.params.get(b);
        if (!first || !second) throw new SceneApiError('inc.link joins two parameters declared before it');
        if (a === b) throw new SceneApiError('inc.link needs two different parameters');
        if (typeof aToB !== 'function' || typeof bToA !== 'function') throw new SceneApiError('inc.link needs a function each way');
        if (first.linked || second.linked) throw new SceneApiError('A parameter can be linked to one other');
        first.linked = b;
        second.linked = a;
        runtime.links.push({ a, b, aToB, bToA });
      },
      model<T extends object>(compute: (values: ParamValues) => T): Model<T> {
        runtime.requireMounting('model');
        if (runtime.model) throw new SceneApiError('A scene has exactly one model (the one-model rule)');
        if (typeof compute !== 'function') throw new SceneApiError('inc.model needs a function');
        runtime.model = { compute, version: -1, value: {} };
        const current = () => runtime.modelValue();
        return new Proxy(Object.create(null) as T, {
          get: (_target, key) => (current() as Record<PropertyKey, unknown>)[key],
          has: (_target, key) => key in current(),
          ownKeys: () => Reflect.ownKeys(current()),
          getOwnPropertyDescriptor: (_target, key) => {
            const descriptor = Object.getOwnPropertyDescriptor(current(), key);
            return descriptor ? { ...descriptor, configurable: true } : undefined;
          },
          set: () => {
            throw new SceneApiError('The model is read-only; change parameters instead');
          },
          defineProperty: () => false,
          deleteProperty: () => false,
        });
      },
      onFrame(callback) {
        runtime.requireMounting('onFrame');
        if (typeof callback !== 'function') throw new SceneApiError('inc.onFrame needs a function');
        runtime.frameCallbacks.push(callback);
      },
      simulate(step, options: SimulateOptions = {}) {
        runtime.requireMounting('simulate');
        if (typeof step !== 'function') throw new SceneApiError('inc.simulate needs a function of dt');
        const dt = options.step ?? 1 / 120;
        if (!(Number.isFinite(dt) && dt >= 1 / 2000 && dt <= 0.1)) throw new SceneApiError('inc.simulate step must be from 1/2000 to 0.1 seconds');
        if (runtime.simulations.length >= 4) throw new SceneApiError('At most 4 simulations');
        runtime.simulations.push({ fn: step, step: dt, acc: 0 });
        runtime.usesTime = true;
      },
      timeline(options) {
        runtime.requireMounting('timeline');
        if (runtime.timeline) throw new SceneApiError('A figure has one timeline');
        runtime.timeline = new Timeline(options);
        runtime.timeline.apply(Timeline.decode(runtime.restoreValues));
        runtime.usesTime = true;
      },
      state,
      onReset(callback) {
        runtime.requireMounting('onReset');
        if (typeof callback !== 'function') throw new SceneApiError('inc.onReset needs a function');
        runtime.resetHooks.push(callback);
      },
      onParamChange(callback) {
        runtime.requireMounting('onParamChange');
        if (typeof callback !== 'function') throw new SceneApiError('inc.onParamChange needs a function');
        runtime.paramHooks.push(callback);
      },
      onStep(callback) {
        runtime.requireMounting('onStep');
        if (typeof callback !== 'function') throw new SceneApiError('inc.onStep needs a function');
        runtime.stepHooks.push(callback);
      },
      readout(entries) {
        runtime.requireMounting('readout');
        for (const [label, fn] of Object.entries(entries ?? {})) {
          if (typeof fn !== 'function') throw new SceneApiError(`Readout "${label}" needs a function`);
          if (runtime.readouts.length >= MAX_READOUTS) throw new SceneApiError(`At most ${MAX_READOUTS} readouts`);
          runtime.readouts.push({ label: clip(label, 60), fn, text: '' });
        }
      },
      table(options: TableOptions) {
        runtime.requireMounting('table');
        if (typeof options?.title !== 'string' || options.title.trim() === '') throw new SceneApiError('inc.table needs a title');
        if (!Array.isArray(options.columns) || options.columns.length === 0 || options.columns.length > MAX_TABLE_COLUMNS) {
          throw new SceneApiError(`inc.table needs from 1 to ${MAX_TABLE_COLUMNS} column names`);
        }
        if (typeof options.rows !== 'function') throw new SceneApiError('inc.table rows must be a function of the model');
        if (runtime.tables.length >= 2) throw new SceneApiError('At most 2 tables');
        runtime.tables.push({ title: clip(options.title, 80), columns: options.columns.map((c) => clip(String(c), 40)), rows: options.rows, cells: [] });
      },
      layout(kind) {
        runtime.requireMounting('layout');
        if (kind !== 'row' && kind !== 'column' && kind !== 'grid') throw new SceneApiError("inc.layout takes 'row', 'column' or 'grid'");
        runtime.panels = kind;
      },
      idea(sentence) {
        runtime.requireMounting('idea');
        if (typeof sentence !== 'string' || sentence.trim() === '') throw new SceneApiError('inc.idea needs a sentence');
        if (sentence.length > 240) throw new SceneApiError('The idea sentence must be 240 characters or fewer');
        runtime.idea = sentence;
      },
      steps(list) {
        runtime.requireMounting('steps');
        if (!Array.isArray(list) || list.length === 0) throw new SceneApiError('inc.steps needs a non-empty list');
        if (list.length > 8) throw new SceneApiError('A figure has at most 8 steps');
        for (const [i, step] of list.entries()) {
          if (typeof step?.say !== 'string' || step.say.trim() === '') {
            throw new SceneApiError(`Step ${i + 1} needs something to say`);
          }
        }
        runtime.stepList = Object.freeze(list.map((step) => Object.freeze({ ...step })));
      },
      explain(fn) {
        runtime.requireMounting('explain');
        if (typeof fn !== 'function') throw new SceneApiError('inc.explain needs a function');
        runtime.explainFn = fn;
      },
      describe(fn) {
        runtime.requireMounting('describe');
        if (typeof fn !== 'function') throw new SceneApiError('inc.describe needs a function');
        runtime.describeFn = fn;
      },
      predict(options: PredictOptions) {
        runtime.requireMounting('predict');
        if (runtime.prediction) throw new SceneApiError('A figure asks one prediction');
        if (typeof options?.question !== 'string' || options.question.trim() === '' || options.question.length > 200) {
          throw new SceneApiError('inc.predict needs a short question');
        }
        if (!Array.isArray(options.options) || options.options.length < 2 || options.options.length > 5) {
          throw new SceneApiError('inc.predict needs from 2 to 5 options');
        }
        if (typeof options.answer !== 'function' && !(Number.isInteger(options.answer) && options.answer >= 0 && options.answer < options.options.length)) {
          throw new SceneApiError('inc.predict answer is an option index or a function of the model');
        }
        for (const name of Object.keys(options.reveal ?? {})) {
          if (!runtime.params.has(name)) throw new SceneApiError(`inc.predict reveals "${name}", which is not a parameter declared before it`);
        }
        runtime.prediction = { options: Object.freeze({ ...options, options: [...options.options] }), chosen: null, revealed: false, answer: null, explanation: null };
      },
      compare() {
        runtime.requireMounting('compare');
        runtime.compare.available = true;
      },
      svg(selector: string, options: StageOptions): Stage {
        runtime.requireMounting('svg');
        if (typeof options?.title !== 'string' || options.title.trim() === '') {
          throw new SceneApiError('inc.svg needs a title for its accessible name');
        }
        const node = runtime.graph.createStage(selector, options.viewBox, options.title, options.description ?? '');
        runtime.stageZoom.set(node.id, options.zoom !== false);
        if (options.measure !== undefined) {
          const { unit, per } = options.measure as { unit?: unknown; per?: unknown };
          if (typeof per !== 'number' || !Number.isFinite(per) || per <= 0) throw new SceneApiError('inc.svg: measure.per is the stage units that make one unit, a positive number');
          runtime.measures.set(node.id, checkMeasure({ scale: [1 / per, 1 / per], origin: [0, 0], unit: typeof unit === 'string' ? unit : '' }));
        }
        return new StageHandle(runtime.graph, node, options.viewBox, runtime.parts);
      },
      graph2d(selector: string, options: GraphOptions) {
        runtime.requireMounting('graph2d');
        validateGraphOptions(options);
        const numberLine = options.axes === 'x';
        const viewBox = options.viewBox ?? (numberLine ? NUMBER_LINE_VIEWBOX : DEFAULT_GRAPH_VIEWBOX);
        const node = runtime.graph.createStage(selector, viewBox, options.title, options.description ?? '', plotRect(viewBox, numberLine));
        runtime.stageZoom.set(node.id, options.zoom !== false);
        const stage = new StageHandle(runtime.graph, node, viewBox, runtime.parts);
        return new Graph2D(runtime.kitContext(stage, node.id), options, viewBox);
      },
      space3d: (selector: string, options: Space3DOptions) => runtime.kitStage('space3d', selector, options) as Space3D,
      graph3d: (selector: string, options: Graph3DOptions) => runtime.kitStage('graph3d', selector, options) as Graph3D,
      physics2d: (selector: string, options: Physics2DOptions) => runtime.kitStage('physics2d', selector, options) as World2D,
      chart: (selector: string, options: ChartOptions) => runtime.kitStage('chart', selector, options) as Chart,
      flow: (selector: string, options: FlowOptions) => runtime.kitStage('flow', selector, options) as Flow,
      chemistry: (selector: string, options: ChemistryOptions) => runtime.kitStage('chemistry', selector, options) as Chemistry,
      biology: (selector: string, options: BiologyOptions) => runtime.kitStage('biology', selector, options) as Biology,
      formula(source: string, options?: FormulaOptions) {
        try {
          const index = runtime.formulas.length;
          const restored = runtime.originalFormulas ? undefined : (runtime.rebuildFormulas?.[String(index)] ?? runtime.options.formulas?.[String(index)]);
          return createFormula(
            source,
            options,
            runtime.paramHandles,
            () => runtime.time,
            (record) => {
              if (runtime.formulas.length >= 8) throw new SceneApiError('At most 8 formulas');
              runtime.formulas.push(record);
              if (restored !== undefined && record.editable) record.edit(restored);
            },
            () => new Map([...runtime.params.values()].map((p) => [p.name, p.handle] as const)),
          );
        } catch (error) {
          if (error instanceof ExpressionError) {
            const unknown = /^Unknown variable "(\w+)"$/.exec(error.message);
            const names = [...runtime.params.keys()].filter((name) => /^[A-Za-z_]\w*$/.test(name));
            // Say how to bind the name: a parameter's own name, or vars.
            // y or theta as the variable of the curve itself: x = f(y) for graph.plotX, r = f(theta) for graph.polar (G2-2).
            const own = unknown && (unknown[1] === 'y' || unknown[1] === 'theta') ? `, or make it the formula's own variable: { input: '${unknown[1]}' }` : '';
            const hint = unknown
              ? `. Use a parameter by its own name${names.length > 0 ? ` (${names.slice(0, 8).join(', ')})` : ''}, or bind it: { vars: { ${unknown[1]}: aParameter } }${own}`
              : '';
            throw new SceneApiError(`Formula "${source}": ${error.message} at position ${error.position}${hint}`);
          }
          throw error;
        }
      },
      random: () => runtime.random(),
      tween(options: TweenOptions) {
        if (typeof options?.apply !== 'function' || !Number.isFinite(options.duration)) {
          throw new SceneApiError('inc.tween needs a duration and an apply function');
        }
        if (runtime.tweens.length >= 16) throw new SceneApiError('Too many queued tweens');
        runtime.tweens.push({ options, elapsed: 0 });
      },
      idle(options: IdleOptions) {
        runtime.requireMounting('idle');
        if (runtime.idleTour) throw new SceneApiError('inc.idle is called once per figure');
        const name = options?.sweep;
        if (typeof name !== 'string' || !runtime.params.has(name)) throw new SceneApiError(`inc.idle sweeps "${String(name)}", which is not a parameter declared before it`);
        const after = options.after ?? 4;
        const period = options.period ?? 8;
        if (!(after >= 0 && after <= 120)) throw new SceneApiError('inc.idle: after is from 0 to 120 seconds');
        if (!(period >= 1 && period <= 120)) throw new SceneApiError('inc.idle: period is from 1 to 120 seconds');
        runtime.idleTour = { name, after, period, elapsed: 0, phase: null, from: 0 };
      },
      sym,
      chem,
      path: this.path,
      geom: geometry,
      calc: calculus,
      vec: vectors,
      units,
      motion,
      shapes,
    };
    return Object.freeze(inc);
  }
}

function isValues(value: unknown): value is Values {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapTo(state: ParamState | undefined, value: number): number {
  return state ? snap(state, value) : value;
}

function isStepIndex(value: unknown, count: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count;
}

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

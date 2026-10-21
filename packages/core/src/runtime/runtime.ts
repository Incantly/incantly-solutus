import type {
  FormulaOptions,
  FrameInfo,
  GraphOptions,
  Inc,
  Model,
  Param,
  ParamOptions,
  ParamValues,
  PathHelpers,
  Readable,
  Stage,
  StageOptions,
  Step,
  TweenOptions,
} from '../api/types';
import { ExpressionError } from '../expr';
import { DEFAULT_GRAPH_VIEWBOX, Graph2D, plotRect, validateGraphOptions } from '../graph2d/graph';
import type { RuntimeUpdate } from '../protocol/runtime-messages';
import { SPEEDS } from '../protocol/runtime-messages';
import type { ErrorPhase, ErrorView, ParamView, UiState } from '../protocol/ui';
import { EMPTY_UI } from '../protocol/ui';
import { SceneApiError } from '../scene/errors';
import { geometry } from '../scene/geometry';
import { SceneGraph } from '../scene/graph';
import { PartRegistry, StageHandle, formatReadable } from '../scene/handles';
import { createPathHelpers } from '../scene/path';
import { createParamState, snap, type ParamState } from './params';
import { isRunaway } from './fuel';
import { mulberry32 } from './random';
import { advanceTween, type TweenState } from './tween';
import { createFormula } from './formula';

export type SceneFunction = (inc: Inc, math: Math) => void;

export interface RuntimeOptions {
  readonly seed?: number;
  /** Largest time step in seconds; longer gaps (a backgrounded tab) are capped. */
  readonly maxDt?: number;
  /** v0.1 figures have at most three adjustable parameters. */
  readonly maxParams?: number;
  /** Learner values to restore instead of the authored defaults. */
  readonly values?: Readonly<Record<string, number>>;
  readonly reducedMotion?: boolean;
  /** Start playing after mount. Reduced motion always starts paused. */
  readonly autoplay?: boolean;
  /** Teaching-step position to restore, or null outside step mode. */
  readonly step?: number | null;
  /** Maps a thrown error to its line and column in the scene fragment, when the host can. */
  readonly locate?: (error: unknown) => { readonly line: number; readonly column: number } | null;
}

/** Seconds a step takes to move parameters to its values. */
export const STEP_TRANSITION_SECONDS = 0.6;

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

const MAX_READOUTS = 12;
const MAX_TEXT = 600;

type Lifecycle = 'idle' | 'mounting' | 'mounted' | 'failed' | 'destroyed';

/**
 * Runs one scene. It owns parameters, the single model, frame callbacks and
 * text, and turns them into drawing commands and UI state. It has no DOM and
 * no clock: the renderer drives it with ticks, so the same runtime works in a
 * Worker, in the page and in Node.
 */
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
  private reducedMotion: boolean;
  private error: ErrorView | null = null;
  private lastUi: UiState = EMPTY_UI;
  private pendingValues: Record<string, number> | null = null;
  private resetPending = false;
  private readonly maxDt: number;
  private readonly maxParams: number;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.random = mulberry32(options.seed ?? 1);
    this.maxDt = options.maxDt ?? 0.05;
    this.maxParams = options.maxParams ?? 3;
    this.reducedMotion = options.reducedMotion ?? false;
    this.path = createPathHelpers((requested) => this.reportCap(requested));
    this.inc = this.createInc();
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
      this.lifecycle = 'mounted';
    } catch (error) {
      this.lifecycle = 'failed';
      this.record('mount', error);
    }
    this.playing = this.lifecycle === 'mounted' && (this.options.autoplay ?? true) && !this.reducedMotion;
    this.dirty = true;
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
    this.playing = false;
  }

  /** True while there is drawing work to do: playing, dirty or animating a transition. */
  needsFrame(): boolean {
    if (this.lifecycle !== 'mounted' || !this.visible) return false;
    return this.playing || this.dirty || this.tweens.length > 0 || this.stepTransition !== null;
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
    if (this.playing) {
      const dt = capped * this.speed;
      this.time += dt;
      this.runFrame(dt);
      this.stats.playingFrames++;
    } else {
      this.runFrame(0);
      this.stats.pausedRedraws++;
    }
    this.dirty = false;
    this.refreshText();
    return this.flush();
  }

  /** A learner's change. Outside step mode it is persisted; inside, leaving steps undoes it. */
  setParam(name: string, value: number): void {
    // The learner takes over from a step transition: land it, then apply their value.
    if (this.stepTransition) this.finishStepTransition();
    this.applyParam(name, value, this.stepIndex === null);
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
    if (persist) (this.pendingValues ??= {})[name] = next;
  }

  setValues(values: Readonly<Record<string, number>>): void {
    for (const [name, value] of Object.entries(values)) this.setParam(name, value);
  }

  play(): void {
    if (this.lifecycle === 'mounted') this.playing = true;
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
    // Each step's values build on the earlier steps, so going back is exact.
    const target: Record<string, number> = { ...saved.values };
    for (let i = 0; i <= index; i++) Object.assign(target, steps[i]?.set ?? {});
    this.moveTo(target, immediate || this.reducedMotion);
    this.playing = step.hold ? false : saved.playing && !this.reducedMotion;
    this.pendingStep = index;
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
    this.dirty = true;
  }

  /** Moves parameters to `target`, animated unless `immediate`. Never persisted. */
  private moveTo(target: Readonly<Record<string, number>>, immediate: boolean): void {
    const from = this.values();
    const names = Object.keys(target).filter((name) => this.params.has(name) && target[name] !== from[name]);
    this.stepTransition = null;
    if (names.length === 0) return;
    if (immediate) {
      for (const name of names) this.applyParam(name, target[name]!, false);
      return;
    }
    this.stepTransition = {
      elapsed: 0,
      options: {
        duration: STEP_TRANSITION_SECONDS,
        ease: 'inOut',
        apply: (k) => {
          for (const name of names) this.applyParam(name, from[name]! + (target[name]! - from[name]!) * k, false);
        },
      },
    };
  }

  /** Rebuilds the scene at time zero, keeping the learner's values. */
  restart(): RuntimeUpdate {
    return this.rebuild(this.stepSaved ? { ...this.stepSaved.values } : this.values());
  }

  /** Rebuilds the scene with the authored defaults. */
  reset(): RuntimeUpdate {
    const defaults: Record<string, number> = {};
    for (const p of this.params.values()) defaults[p.name] = p.defaultValue;
    const update = this.rebuild(defaults);
    return { ...update, values: { ...defaults } };
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

  private rebuild(values: Record<string, number>): RuntimeUpdate {
    const scene = this.scene;
    if (!scene || this.lifecycle === 'destroyed') return this.flush();
    const wasPlaying = this.stepSaved ? this.stepSaved.playing : this.playing;
    if (this.stepIndex !== null) this.pendingStep = null;
    this.stepIndex = null;
    this.stepSaved = null;
    this.stepTransition = null;
    this.learnerFocus = null;
    this.graph = new SceneGraph();
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
    this.error = null;
    this.time = 0;
    this.random = mulberry32(this.options.seed ?? 1);
    this.resetPending = true;
    const update = this.mount(scene, values);
    this.playing = this.lifecycle === 'mounted' && wasPlaying;
    return { ...update, needsFrame: this.needsFrame() };
  }

  // -------------------------------------------------------------------------
  // Frames and text
  // -------------------------------------------------------------------------

  private runFrame(dt: number): void {
    const frame: FrameInfo = Object.freeze({ time: this.time, dt });
    let ok = true;
    for (const callback of this.frameCallbacks) ok = this.guard('frame', () => callback(frame)) && ok;
    for (const redraw of this.redraws) ok = this.guard('plot', redraw) && ok;
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
    }));
    return {
      params,
      readouts: this.readouts.map((r) => ({ label: r.label, text: r.text })),
      parts: [...this.parts.parts.values()].map((p) => ({ name: p.name, label: p.label, info: p.info, id: p.node.id })),
      playing: this.playing,
      speed: this.speed,
      idea: this.idea,
      explanation: this.explanation,
      description: this.description,
      steps: this.stepsView(),
      focus: this.learnerFocus ?? this.stepFocus(),
      error: this.error,
    };
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
    const name = error instanceof Error ? error.name : 'Error';
    const message = clip(error instanceof Error ? error.message : String(error));
    const stack = error instanceof Error ? error.stack : undefined;
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
  // The inc API
  // -------------------------------------------------------------------------

  private requireMounting(call: string): void {
    if (this.lifecycle !== 'mounting') {
      throw new SceneApiError(`inc.${call} must be called when the scene starts, not later`);
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

  private createInc(): Inc {
    const runtime = this;
    const inc: Inc = {
      param(name: string, options: ParamOptions): Param {
        runtime.requireMounting('param');
        if (runtime.params.has(name)) throw new SceneApiError(`Parameter "${name}" is declared twice`);
        if (runtime.params.size >= runtime.maxParams) {
          throw new SceneApiError(`A figure has at most ${runtime.maxParams} adjustable parameters`);
        }
        const state = createParamState(name, options ?? ({} as ParamOptions), runtime.restoreValues?.[name]);
        runtime.params.set(name, state);
        runtime.paramHandles.add(state.handle);
        runtime.paramVersion++;
        return state.handle;
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
      readout(entries) {
        runtime.requireMounting('readout');
        for (const [label, fn] of Object.entries(entries ?? {})) {
          if (typeof fn !== 'function') throw new SceneApiError(`Readout "${label}" needs a function`);
          if (runtime.readouts.length >= MAX_READOUTS) throw new SceneApiError(`At most ${MAX_READOUTS} readouts`);
          runtime.readouts.push({ label: clip(label, 60), fn, text: '' });
        }
      },
      idea(sentence) {
        runtime.requireMounting('idea');
        if (typeof sentence !== 'string' || sentence.trim() === '') throw new SceneApiError('inc.idea needs a sentence');
        if (sentence.length > 200) throw new SceneApiError('The idea sentence must be 200 characters or fewer');
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
      svg(selector: string, options: StageOptions): Stage {
        runtime.requireMounting('svg');
        if (typeof options?.title !== 'string' || options.title.trim() === '') {
          throw new SceneApiError('inc.svg needs a title for its accessible name');
        }
        const node = runtime.graph.createStage(selector, options.viewBox, options.title, options.description ?? '');
        return new StageHandle(runtime.graph, node, options.viewBox, runtime.parts);
      },
      graph2d(selector: string, options: GraphOptions) {
        runtime.requireMounting('graph2d');
        validateGraphOptions(options);
        const viewBox = options.viewBox ?? DEFAULT_GRAPH_VIEWBOX;
        const node = runtime.graph.createStage(selector, viewBox, options.title, options.description ?? '', plotRect(viewBox));
        const stage = new StageHandle(runtime.graph, node, viewBox, runtime.parts);
        return new Graph2D(
          {
            stage,
            path: runtime.path,
            time: () => runtime.time,
            onRedraw: (redraw) => runtime.redraws.push(redraw),
            reportCap: (n) => runtime.reportCap(n),
            isFormula: (value): value is ReturnType<Inc['formula']> =>
              typeof value === 'function' && typeof (value as { source?: unknown }).source === 'string',
          },
          options,
          viewBox,
        );
      },
      formula(source: string, options?: FormulaOptions) {
        try {
          return createFormula(source, options, runtime.paramHandles, () => runtime.time);
        } catch (error) {
          if (error instanceof ExpressionError) {
            throw new SceneApiError(`Formula "${source}": ${error.message} at position ${error.position}`);
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
      path: this.path,
      geom: geometry,
    };
    return Object.freeze(inc);
  }
}

function isStepIndex(value: unknown, count: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count;
}

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}


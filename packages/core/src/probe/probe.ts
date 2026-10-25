import type { ViewBox } from '../api/types';
import type { ParamView, UiState } from '../protocol/ui';
import { mulberry32 } from '../runtime/random';
import { SceneRuntime, type RuntimeOptions, type SceneErrorRecord, type SceneFunction } from '../runtime/runtime';
import { stageBounds } from '../scene/bounds';

/**
 * The probe: the in-app check that runs every generated scene, hidden, before
 * a learner sees it (PRD 17.7, 27.1). It is DOM-free, drives the runtime with
 * deterministic ticks, and fails the scene with a report precise enough for
 * one repair attempt: the check, the parameter values, the error and where.
 */

/** What the plan declares that the probe checks. Names and numbers only: no plan prose reaches the client. */
export interface ProbeSpec {
  readonly parts?: readonly string[];
  readonly steps?: number;
  /** Parameter states where the model is singular, such as an object at a lens's focal length. */
  readonly singularPoints?: ReadonlyArray<Readonly<Record<string, number>>>;
  /** Further states the scene must run in, such as where a live figure hit a problem (RP-7). */
  readonly states?: ReadonlyArray<Readonly<Record<string, number>>>;
  /** Drawn elements the plan's size allows. */
  readonly elements?: number;
}

export interface ProbeOptions {
  readonly spec?: ProbeSpec;
  /** Frames run at the default values. */
  readonly frames?: number;
  /** Frames run for each playing sweep configuration. */
  readonly sweepFrames?: number;
  /** Seeded random parameter states between the bounds. */
  readonly interiorPoints?: number;
  readonly seed?: number;
  readonly elementBudget?: number;
  /** Average frame cost allowed at the default values. */
  readonly frameBudgetMs?: number;
  /** The probe stops itself after this long; the host watchdog is the hard limit. */
  readonly timeBudgetMs?: number;
  /** How far outside the stage, as a fraction of its size, a drawing may reach. */
  readonly boundsMargin?: number;
  readonly now?: () => number;
  /** Called before every runtime step, so the Worker can refuel. */
  readonly beforeStep?: () => void;
  /** Passed to every runtime the probe creates. */
  readonly runtime?: Pick<RuntimeOptions, 'locate' | 'kits'>;
}

export type ProbeCheck =
  | 'mount'
  | 'runs'
  | 'numbers'
  | 'sweep'
  | 'paused-change'
  | 'singular'
  | 'interior'
  | 'bounds'
  | 'budget'
  | 'frame-cost'
  | 'parts'
  | 'steps'
  | 'idea'
  | 'description'
  | 'timeout';

export interface ProbeError {
  readonly phase: string;
  readonly name: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ProbeFailure {
  readonly check: ProbeCheck;
  readonly message: string;
  readonly values?: Readonly<Record<string, number>>;
  readonly playing?: boolean;
  /** Scene time when it failed. */
  readonly time?: number;
  readonly error?: ProbeError;
}

export interface ProbeStats {
  readonly configurations: number;
  readonly frames: number;
  readonly averageFrameMs: number;
  readonly elements: number;
  readonly durationMs: number;
}

export interface ProbeReport {
  readonly ok: boolean;
  readonly failures: readonly ProbeFailure[];
  readonly stats: ProbeStats;
  /** What passed but is close to failing, such as a drawing near its element budget (SV-12). */
  readonly warnings?: readonly string[];
}

/** Share of the element budget above which the probe warns (SV-12). */
export const ELEMENT_WARNING_SHARE = 0.8;

const FRAME = 1 / 60;
const MAX_FAILURES_PER_CHECK = 4;

class ProbeStop extends Error {}

export function probeScene(scene: SceneFunction, options: ProbeOptions = {}): ProbeReport {
  return new Probe(scene, options).run();
}

class Probe {
  private readonly failures: ProbeFailure[] = [];
  private readonly now: () => number;
  private readonly started: number;
  private configurations = 0;
  private readonly warnings: string[] = [];
  private frames = 0;
  private frameMs = 0;
  private measuredFrames = 0;
  private elements = 0;
  private params: readonly ParamView[] = [];
  private defaults: Record<string, number> = {};

  constructor(
    private readonly scene: SceneFunction,
    private readonly options: ProbeOptions,
  ) {
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.started = this.now();
  }

  run(): ProbeReport {
    try {
      if (this.defaultRun()) {
        this.pausedChange();
        this.sweep();
        this.singularPoints();
        this.givenStates();
        this.interiorPoints();
      }
    } catch (error) {
      if (!(error instanceof ProbeStop)) throw error;
    }
    return {
      ok: this.failures.length === 0,
      failures: this.failures,
      ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}),
      stats: {
        configurations: this.configurations,
        frames: this.frames,
        averageFrameMs: this.measuredFrames ? round(this.frameMs / this.measuredFrames) : 0,
        elements: this.elements,
        durationMs: round(this.now() - this.started),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private fail(failure: ProbeFailure): void {
    if (this.failures.filter((f) => f.check === failure.check).length < MAX_FAILURES_PER_CHECK) this.failures.push(failure);
  }

  private checkTime(): void {
    const budget = this.options.timeBudgetMs ?? 2500;
    if (this.now() - this.started > budget) {
      this.failures.push({ check: 'timeout', message: `The probe took longer than ${budget} ms; a loop may be far too slow` });
      throw new ProbeStop();
    }
  }

  private step<T>(fn: () => T): T {
    this.options.beforeStep?.();
    return fn();
  }

  private mount(values: Readonly<Record<string, number>> | undefined, autoplay: boolean, traceSites = false): { runtime: SceneRuntime; ui: UiState } {
    this.checkTime();
    this.configurations++;
    const runtime = new SceneRuntime({
      ...this.options.runtime,
      seed: this.options.seed ?? 1,
      autoplay,
      reducedMotion: false,
      ...(values ? { values } : {}),
      // At the defaults, each element remembers its line, so a failure can point at it.
      ...(traceSites ? { traceSites: true } : {}),
    });
    const update = this.step(() => runtime.mount(this.scene));
    return { runtime, ui: { ...runtime.uiState(), ...update.ui } as UiState };
  }

  /**
   * Lets a paused figure finish what it is already doing, such as a camera
   * turning to its first view, so a change is measured against where it
   * comes to rest: at most three seconds of frames.
   */
  private settle(runtime: SceneRuntime): void {
    for (let i = 0; i < 30 && runtime.needsFrame(); i++) this.tick(runtime, 0.1);
  }

  private tick(runtime: SceneRuntime, dt: number, measure = false): void {
    const start = this.now();
    this.step(() => runtime.tick(dt));
    if (measure) {
      this.frameMs += this.now() - start;
      this.measuredFrames++;
    }
    this.frames++;
  }

  private firstError(runtime: SceneRuntime): ProbeError | undefined {
    const record: SceneErrorRecord | undefined = runtime.errors[0];
    if (!record) return undefined;
    return {
      phase: record.phase,
      name: record.name,
      message: record.message,
      ...(record.line !== undefined ? { line: record.line } : {}),
      ...(record.column !== undefined ? { column: record.column } : {}),
    };
  }

  /** Non-finite values in rendered attributes, readouts or model outputs, as one message. */
  private nonFinite(runtime: SceneRuntime): string | null {
    const attribute = runtime.graph.diagnostics.find((d) => d.kind === 'non-finite');
    if (attribute) return attribute.message;
    const bad = findNonFinite(runtime.modelValue());
    return bad ? `Model output ${bad.path} is ${bad.value}` : null;
  }

  // -------------------------------------------------------------------------
  // Checks
  // -------------------------------------------------------------------------

  /** Mount, 60 frames, numbers, budget, bounds, frame cost and the teaching layer. Returns false when mounting failed. */
  private defaultRun(): boolean {
    const { runtime, ui } = this.mount(undefined, true, true);
    const mountError = this.firstError(runtime);
    if (!runtime.isMounted || mountError) {
      this.fail({ check: 'mount', message: 'The scene threw while mounting', ...(mountError ? { error: mountError } : {}) });
      return false;
    }
    this.params = ui.params;
    this.defaults = Object.fromEntries(ui.params.map((p) => [p.name, p.defaultValue]));

    const frames = this.options.frames ?? 60;
    let threw = false;
    for (let i = 0; i < frames; i++) {
      this.tick(runtime, FRAME, true);
      const error = this.firstError(runtime);
      if (error) {
        this.fail({ check: 'runs', message: `The scene threw on frame ${i + 1}`, values: this.defaults, playing: true, time: runtime.time, error });
        threw = true;
        break;
      }
    }
    const nonFinite = this.nonFinite(runtime);
    if (nonFinite) this.fail({ check: 'numbers', message: nonFinite, values: this.defaults, playing: true, time: runtime.time });

    this.elements = runtime.graph.size;
    const budget = this.options.elementBudget ?? this.options.spec?.elements ?? 300;
    if (runtime.graph.size > budget) {
      this.fail({ check: 'budget', message: `The scene draws ${runtime.graph.size} elements; the budget is ${budget}` });
    } else if (runtime.graph.size > budget * ELEMENT_WARNING_SHARE) {
      this.warnings.push(`The scene draws ${runtime.graph.size} of its ${budget} elements: draw many small dots with stage.dots and a curve as one path`);
    }
    const capped = runtime.graph.diagnostics.find((d) => d.kind === 'samples-capped');
    if (capped) this.fail({ check: 'budget', message: capped.message });

    this.bounds(runtime);

    // A frame that threw costs the error and its stack trace, not the drawing: its cost says nothing.
    const frameBudget = this.options.frameBudgetMs ?? 8;
    const average = this.measuredFrames ? this.frameMs / this.measuredFrames : 0;
    if (!threw && average > frameBudget) {
      this.fail({ check: 'frame-cost', message: `An average frame takes ${round(average)} ms; the budget is ${frameBudget} ms` });
    }

    this.teaching(runtime);
    return true;
  }

  /** Something is drawn, and nothing at the default values lies outside its stage. */
  private bounds(runtime: SceneRuntime): void {
    const margin = this.options.boundsMargin ?? 0.05;
    let visible = 0;
    for (const stage of runtime.graph.stages) {
      const bounds = stageBounds(runtime.graph, stage.id);
      visible += bounds.visibleElements;
      const [x, y, w, h] = stage.viewBox as ViewBox;
      const outside: Array<{ id: number; what: string }> = [];
      for (const [id, box] of bounds.boxes) {
        const node = runtime.graph.nodes.get(id);
        // A graph's plot layer is clipped to the plot area, so what crosses it is cut, not lost.
        if (stage.clip && node?.layer === 'mid') continue;
        const over = [
          box.minX < x - w * margin ? `x = ${round(box.minX)}, left of ${round(x)}` : null,
          box.maxX > x + w * (1 + margin) ? `x = ${round(box.maxX)}, right of ${round(x + w)}` : null,
          box.minY < y - h * margin ? `y = ${round(box.minY)}, above ${round(y)}` : null,
          box.maxY > y + h * (1 + margin) ? `y = ${round(box.maxY)}, below ${round(y + h)}` : null,
        ].filter((side): side is string => side !== null);
        if (over.length > 0) outside.push({ id, what: `the ${node?.kind ?? 'element'}${node?.part ? ` "${node.part}"` : ''} reaches ${over.join(' and ')}` });
      }
      if (outside.length > 0) {
        // Name the worst few, at the lines that made them, in stage units.
        const sited = outside.map((o) => ({ ...o, site: runtime.graph.sites.get(o.id) }));
        const shown = [...sited.filter((o) => o.site), ...sited.filter((o) => !o.site)].slice(0, 3);
        const first = shown[0]!;
        this.fail({
          check: 'bounds',
          message: `${outside.length} element${outside.length === 1 ? '' : 's'} of the stage ${stage.selector} ${outside.length === 1 ? 'lies' : 'lie'} outside its viewBox [${stage.viewBox.join(', ')}] at the default values: ${shown
            .map((o) => `${o.what}${o.site ? ` (made at line ${o.site.line})` : ''}`)
            .join('; ')}`,
          values: this.defaults,
          ...(first.site ? { error: { phase: 'bounds', name: 'Bounds', message: `${first.what}, in stage units`, line: first.site.line, column: first.site.column } } : {}),
        });
      }
    }
    if (visible === 0) this.fail({ check: 'bounds', message: 'Nothing is drawn at the default values' });
  }

  /** The idea, the text alternative, the declared parts and every step. */
  private teaching(runtime: SceneRuntime): void {
    const ui = runtime.uiState();
    const spec = this.options.spec ?? {};
    if (!ui.idea) this.fail({ check: 'idea', message: 'The scene has no idea sentence; call inc.idea once' });
    if (!ui.description || ui.description.trim() === '') {
      this.fail({ check: 'description', message: 'The scene has no text alternative; call inc.describe with a function of the model' });
    }
    const names = new Set(ui.parts.map((p) => p.name));
    const missing = (spec.parts ?? []).filter((name) => !names.has(name));
    if (missing.length > 0) {
      this.fail({ check: 'parts', message: `The plan names parts the scene never registers: ${missing.join(', ')}` });
    }
    if (!ui.steps) {
      this.fail({ check: 'steps', message: 'The scene has no teaching steps; call inc.steps' });
      return;
    }
    if (spec.steps !== undefined && ui.steps.count !== spec.steps) {
      this.fail({ check: 'steps', message: `The plan has ${spec.steps} steps but the scene has ${ui.steps.count}` });
    }
    runtime.setReducedMotion(true); // steps jump, so each is checked at its own values
    for (let i = 0; i < ui.steps.count; i++) {
      this.step(() => runtime.step('goto', i));
      this.tick(runtime, 0);
      const error = this.firstError(runtime);
      if (error) {
        this.fail({ check: 'steps', message: `The scene threw on step ${i + 1}`, values: runtime.values(), error });
        return;
      }
      const nonFinite = this.nonFinite(runtime);
      if (nonFinite) {
        this.fail({ check: 'numbers', message: `${nonFinite} on step ${i + 1}`, values: runtime.values() });
        return;
      }
    }
  }

  /** EN-4: moving any parameter while paused must change the drawing (the paused-slider bug, PRD 21.1). */
  private pausedChange(): void {
    const { runtime } = this.mount(undefined, false);
    this.settle(runtime);
    for (const param of this.params) {
      const target = param.defaultValue !== param.max ? param.max : param.min;
      const before = JSON.stringify(runtime.graph.snapshotCommands());
      this.step(() => runtime.setParam(param.name, target));
      this.tick(runtime, 0);
      const error = this.firstError(runtime);
      if (error) {
        this.fail({ check: 'paused-change', message: `The scene threw when ${param.name} moved while paused`, values: runtime.values(), playing: false, error });
        return;
      }
      // A view that eases to follow the control, such as a camera turning, changes over the next moments, not in this frame.
      this.settle(runtime);
      if (JSON.stringify(runtime.graph.snapshotCommands()) === before) {
        this.fail({
          check: 'paused-change',
          message: `Moving ${param.name} while paused does not change the drawing; redraw from the parameter, not only from time`,
          values: runtime.values(),
          playing: false,
        });
      }
      this.step(() => runtime.setParam(param.name, param.defaultValue));
      this.settle(runtime);
    }
  }

  /** Every parameter at its minimum, middle, maximum and default, playing and paused. */
  private sweep(): void {
    for (const param of this.params) {
      const values = unique([param.min, (param.min + param.max) / 2, param.max, param.defaultValue]);
      for (const value of values) this.configuration('sweep', { ...this.defaults, [param.name]: value });
    }
  }

  private singularPoints(): void {
    for (const point of this.options.spec?.singularPoints ?? []) {
      this.configuration('singular', { ...this.defaults, ...point });
    }
  }

  private givenStates(): void {
    for (const state of (this.options.spec?.states ?? []).slice(0, 4)) {
      const values: Record<string, number> = { ...this.defaults };
      for (const [name, value] of Object.entries(state)) if (name in values && Number.isFinite(value)) values[name] = value;
      this.configuration('interior', values);
    }
  }

  private interiorPoints(): void {
    const random = mulberry32((this.options.seed ?? 1) * 7919);
    const count = this.options.interiorPoints ?? 4;
    for (let i = 0; i < count; i++) {
      const values: Record<string, number> = {};
      for (const p of this.params) values[p.name] = p.min + (p.max - p.min) * random();
      this.configuration('interior', values, false);
    }
  }

  /** One parameter state, playing for a few frames and paused for one redraw. */
  private configuration(check: 'sweep' | 'singular' | 'interior', values: Record<string, number>, paused = true): void {
    for (const playing of paused ? [true, false] : [true]) {
      const { runtime } = this.mount(values, playing);
      let error = this.firstError(runtime);
      if (!error) {
        const frames = playing ? (this.options.sweepFrames ?? 12) : 1;
        for (let i = 0; i < frames && !error; i++) {
          this.tick(runtime, playing ? FRAME : 0);
          error = this.firstError(runtime);
        }
      }
      const actual = runtime.values();
      if (error) {
        this.fail({ check, message: `The scene threw ${describeState(actual, playing)}`, values: actual, playing, time: runtime.time, error });
        continue;
      }
      const nonFinite = this.nonFinite(runtime);
      if (nonFinite) {
        this.fail({ check: 'numbers', message: `${nonFinite} ${describeState(actual, playing)}`, values: actual, playing, time: runtime.time });
      }
    }
  }
}

function describeState(values: Readonly<Record<string, number>>, playing: boolean): string {
  const list = Object.entries(values)
    .map(([name, value]) => `${name} = ${round(value)}`)
    .join(', ');
  return `with ${list || 'no parameters'}, ${playing ? 'playing' : 'paused'}`;
}

function unique(values: number[]): number[] {
  return [...new Set(values.map((v) => round(v, 9)))];
}

function round(value: number, digits = 3): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

/** The first non-finite number among a model's outputs, depth-limited. */
export function findNonFinite(value: unknown, path = 'model', depth = 0): { path: string; value: string } | null {
  if (typeof value === 'number') return Number.isFinite(value) ? null : { path, value: String(value) };
  if (depth > 4 || value === null || typeof value !== 'object') return null;
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  for (const [key, inner] of entries.slice(0, 200)) {
    const found = findNonFinite(inner, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}

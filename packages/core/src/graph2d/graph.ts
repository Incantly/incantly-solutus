import type {
  CurveOptions,
  ElementOptions,
  Formula,
  Graph,
  GraphArrow,
  GraphCurve,
  GraphOptions,
  GraphPoint,
  GraphSegment,
  GraphTrail,
  Handle,
  PathHandle,
  PathHelpers,
  PlotFunction,
  PolylineHandle,
  Readable,
  Stage,
  TextHandle,
  Tone,
  Vec2,
  ViewBox,
} from '../api/types';
import { SceneApiError } from '../scene/errors';
import type { StageHandle } from '../scene/handles';
import { MAX_SAMPLES, polylinePath } from '../scene/path';

export const DEFAULT_GRAPH_VIEWBOX: ViewBox = [0, 0, 760, 380];
const MARGIN = { left: 52, right: 20, top: 20, bottom: 40 } as const;
const DEFAULT_SAMPLES = 300;

export interface GraphContext {
  readonly stage: StageHandle;
  readonly path: PathHelpers;
  /** Current scene time, for plots that move. */
  readonly time: () => number;
  /** Registers a redraw that runs after the scene's frame callbacks. */
  readonly onRedraw: (redraw: () => void) => void;
  readonly reportCap: (requested: number) => void;
  readonly isFormula: (value: unknown) => value is Formula;
}

/** Plot area inside a graph's view box. */
export function plotRect(viewBox: ViewBox): ViewBox {
  const [x, y, width, height] = viewBox;
  return [x + MARGIN.left, y + MARGIN.top, width - MARGIN.left - MARGIN.right, height - MARGIN.top - MARGIN.bottom];
}

/** A "nice" tick step (1, 2 or 5 times a power of ten) giving about `target` ticks. */
export function niceStep(span: number, target = 6): number {
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor = residual < 1.5 ? 1 : residual < 3 ? 2 : residual < 7 ? 5 : 10;
  return factor * magnitude;
}

/** Multiples of `step` within [min, max], computed by index so no error accumulates. */
export function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  const last = Math.floor(max / step + 1e-9);
  for (let k = first; k <= last && out.length < 50; k++) {
    const value = Number((k * step).toPrecision(12));
    out.push(Object.is(value, -0) ? 0 : value);
  }
  return out;
}

export function validateGraphOptions(options: GraphOptions): void {
  const [x0, x1] = options.x;
  const [y0, y1] = options.y;
  if (![x0, x1, y0, y1].every(Number.isFinite) || !(x0 < x1) || !(y0 < y1)) {
    throw new SceneApiError('graph2d needs finite x and y ranges with min < max');
  }
  if (typeof options.title !== 'string' || options.title.trim() === '') {
    throw new SceneApiError('graph2d needs a title for its accessible name');
  }
}

class Curve implements GraphCurve {
  constructor(readonly handle: PathHandle) {}
  show(visible = true): this {
    this.handle.show(visible);
    return this;
  }
  tone(name: Tone): this {
    this.handle.tone(name);
    return this;
  }
}

/**
 * A minimal Cartesian graph: the behaviour the sine-wave and projectile scenes
 * need, not a graphing calculator.
 */
export class Graph2D implements Graph {
  readonly stage: Stage;
  private readonly x0: number;
  private readonly x1: number;
  private readonly y0: number;
  private readonly y1: number;
  private readonly rect: ViewBox;
  private formulaLabels = 0;

  constructor(
    private readonly ctx: GraphContext,
    options: GraphOptions,
    viewBox: ViewBox,
  ) {
    this.stage = ctx.stage;
    [this.x0, this.x1] = options.x;
    [this.y0, this.y1] = options.y;
    this.rect = plotRect(viewBox);
    this.drawAxes(options);
  }

  toX(x: number): number {
    const [left, , width] = this.rect;
    return left + ((x - this.x0) / (this.x1 - this.x0)) * width;
  }

  toY(y: number): number {
    const [, top, , height] = this.rect;
    return top + ((this.y1 - y) / (this.y1 - this.y0)) * height;
  }

  plot(fn: PlotFunction, options: CurveOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('plot needs a function or a formula');
    const handle = this.stage.path(undefined, { tone: options.tone ?? 'lit', dashed: options.dashed ?? false });
    const samples = this.sampleCount(options.samples);
    if (this.ctx.isFormula(fn)) this.formulaLabel(fn.source);
    const evaluate = (x: number) => fn(x, this.ctx.time());
    const redraw = () => handle.d(this.sampleFunction(evaluate, samples));
    this.ctx.onRedraw(redraw);
    return new Curve(handle);
  }

  parametric(
    fx: (t: number) => number,
    fy: (t: number) => number,
    t0: number,
    t1: number,
    options: CurveOptions = {},
  ): GraphCurve {
    if (typeof fx !== 'function' || typeof fy !== 'function') throw new SceneApiError('parametric needs two functions');
    const handle = this.stage.path(undefined, { tone: options.tone ?? 'lit', dashed: options.dashed ?? false });
    const samples = this.sampleCount(options.samples);
    const redraw = () => {
      const points: Vec2[] = [];
      for (let i = 0; i <= samples; i++) {
        const t = t0 + ((t1 - t0) * i) / samples;
        points.push(this.map(fx(t), fy(t)));
      }
      handle.d(polylinePath(points));
    };
    this.ctx.onRedraw(redraw);
    return new Curve(handle);
  }

  point(x: number, y: number, options: { readonly tone?: Tone; readonly r?: number } = {}): GraphPoint {
    const handle = this.stage.circle(this.toX(x), this.toY(y), options.r ?? 6, { layer: 'front', tone: options.tone ?? 'hi' });
    const graph = this;
    return {
      handle,
      at(px: number, py: number) {
        handle.set({ cx: graph.toX(px), cy: graph.toY(py) });
        return this;
      },
      show(visible = true) {
        handle.show(visible);
        return this;
      },
      tone(name: Tone) {
        handle.tone(name);
        return this;
      },
    };
  }

  segment(x1: number, y1: number, x2: number, y2: number, options: CurveOptions = {}): GraphSegment {
    const handle: Handle = this.stage.line(this.toX(x1), this.toY(y1), this.toX(x2), this.toY(y2), {
      layer: 'front',
      tone: options.tone ?? 'mid',
      dashed: options.dashed ?? false,
    });
    const graph = this;
    return {
      handle,
      between(a: number, b: number, c: number, d: number) {
        handle.set({ x1: graph.toX(a), y1: graph.toY(b), x2: graph.toX(c), y2: graph.toY(d) });
        return this;
      },
      show(visible = true) {
        handle.show(visible);
        return this;
      },
      tone(name: Tone) {
        handle.tone(name);
        return this;
      },
    };
  }

  arrow(x: number, y: number, dx: number, dy: number, options: CurveOptions = {}): GraphArrow {
    const handle = this.stage.path(undefined, { layer: 'front', tone: options.tone ?? 'hi', dashed: options.dashed ?? false });
    const graph = this;
    const arrow: GraphArrow = {
      handle,
      from(px: number, py: number, pdx: number, pdy: number) {
        const sx = graph.toX(px);
        const sy = graph.toY(py);
        handle.d(graph.ctx.path.arrow(sx, sy, graph.toX(px + pdx) - sx, graph.toY(py + pdy) - sy));
        return this;
      },
      show(visible = true) {
        handle.show(visible);
        return this;
      },
      tone(name: Tone) {
        handle.tone(name);
        return this;
      },
    };
    return arrow.from(x, y, dx, dy);
  }

  trail(options: { readonly tone?: Tone; readonly max?: number } = {}): GraphTrail {
    const handle: PolylineHandle = this.stage.polyline([], { tone: options.tone ?? 'faint' });
    const max = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(options.max ?? 200)));
    const points: Vec2[] = [];
    const graph = this;
    return {
      handle,
      add(x: number, y: number) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return this;
        points.push([graph.toX(x), graph.toY(y)]);
        if (points.length > max) points.shift();
        handle.points(points);
        return this;
      },
      clear() {
        points.length = 0;
        handle.points(points);
        return this;
      },
    };
  }

  label(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle {
    return this.stage.text(this.toX(x), this.toY(y), value, { layer: 'labels', ...options });
  }

  private sampleCount(requested: number | undefined): number {
    const n = Math.floor(requested ?? DEFAULT_SAMPLES);
    if (!Number.isFinite(n) || n < 2) return 2;
    if (n > MAX_SAMPLES) {
      this.ctx.reportCap(n);
      return MAX_SAMPLES;
    }
    return n;
  }

  /** Data point to stage coordinates, with values far outside the range clamped. */
  private map(x: number, y: number): Vec2 {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [Number.NaN, Number.NaN];
    const spanY = this.y1 - this.y0;
    const spanX = this.x1 - this.x0;
    const cy = Math.min(this.y1 + 2 * spanY, Math.max(this.y0 - 2 * spanY, y));
    const cx = Math.min(this.x1 + 2 * spanX, Math.max(this.x0 - 2 * spanX, x));
    return [this.toX(cx), this.toY(cy)];
  }

  /** Samples y = f(x) across the x range, breaking the path at asymptotes. */
  private sampleFunction(fn: (x: number) => number, samples: number): string {
    const points: Vec2[] = [];
    const span = this.y1 - this.y0;
    let previous = Number.NaN;
    for (let i = 0; i <= samples; i++) {
      const x = this.x0 + ((this.x1 - this.x0) * i) / samples;
      const y = fn(x);
      if (!Number.isFinite(y)) {
        points.push([Number.NaN, Number.NaN]);
        previous = Number.NaN;
        continue;
      }
      const offscale = (v: number) => v > this.y1 + span || v < this.y0 - span;
      if (Number.isFinite(previous) && Math.sign(y) !== Math.sign(previous) && offscale(y) && offscale(previous)) {
        points.push([Number.NaN, Number.NaN]); // an asymptote between samples: do not bridge it
      }
      points.push(this.map(x, y));
      previous = y;
    }
    return polylinePath(points);
  }

  private formulaLabel(source: string): void {
    const [left, top] = this.rect;
    this.stage.text(left + 8, top + 16 + this.formulaLabels * 18, `y = ${source}`, { layer: 'labels' }).set({
      'font-size': 13,
    });
    this.formulaLabels++;
  }

  private drawAxes(options: GraphOptions): void {
    const [left, top, width, height] = this.rect;
    const right = left + width;
    const bottom = top + height;
    const xStep = niceStep(this.x1 - this.x0);
    const yStep = niceStep(this.y1 - this.y0, 5);
    const xTicks = ticks(this.x0, this.x1, xStep);
    const yTicks = ticks(this.y0, this.y1, yStep);
    const axisY = this.y0 <= 0 && this.y1 >= 0 ? this.toY(0) : bottom;
    const axisX = this.x0 <= 0 && this.x1 >= 0 ? this.toX(0) : left;

    if (options.grid !== false) {
      for (const t of xTicks) this.stage.line(this.toX(t), top, this.toX(t), bottom, { layer: 'back', tone: 'faint' });
      for (const t of yTicks) this.stage.line(left, this.toY(t), right, this.toY(t), { layer: 'back', tone: 'faint' });
    }
    if (options.axes !== false) {
      this.stage.line(left, axisY, right, axisY, { layer: 'back', tone: 'mid' });
      this.stage.line(axisX, top, axisX, bottom, { layer: 'back', tone: 'mid' });
      const label = (x: number, y: number, text: string, anchor: 'middle' | 'end') =>
        this.stage.text(x, y, text, { layer: 'labels' }).set({ 'font-size': 11, 'text-anchor': anchor });
      for (const t of xTicks) {
        if (t === 0 && axisX !== left) continue;
        label(this.toX(t), Math.min(bottom, axisY) + 16, String(t), 'middle');
      }
      for (const t of yTicks) {
        if (t === 0 && axisY !== bottom) continue;
        label(Math.max(left, axisX) - 6, this.toY(t) + 4, String(t), 'end');
      }
      if (axisX !== left && axisY !== bottom) label(axisX - 6, axisY + 16, '0', 'end');
      if (options.labels?.x) {
        this.stage.text(right, Math.min(bottom, axisY) - 8, options.labels.x, { layer: 'labels' }).set({
          'font-size': 13,
          'text-anchor': 'end',
        });
      }
      if (options.labels?.y) {
        this.stage.text(Math.max(left, axisX) + 8, top + 12, options.labels.y, { layer: 'labels' }).set({ 'font-size': 13 });
      }
    }
  }
}

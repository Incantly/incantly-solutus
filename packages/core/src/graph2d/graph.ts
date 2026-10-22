import type {
  BarOptions,
  Bound,
  CurveOptions,
  DragMap,
  ElementOptions,
  FieldOptions,
  Formula,
  Graph,
  GraphArrow,
  GraphCurve,
  GraphMark,
  GraphOptions,
  GraphPoint,
  GraphSegment,
  GraphTrail,
  Handle,
  HandleOptions,
  HistogramOptions,
  PartOptions,
  PathHandle,
  PlotFunction,
  PointsSource,
  PolylineHandle,
  Readable,
  SeriesOptions,
  Stage,
  TextHandle,
  Tone,
  ValuesSource,
  Vec2,
  ViewBox,
} from '../api/types';
import type { ViewAction } from '../protocol/runtime-messages';
import type { KitContext, ViewController } from '../runtime/kit';
import { SceneApiError } from '../scene/errors';
import { fmt } from '../scene/format';
import type { VNode } from '../scene/graph';
import { nodeOf, type StageHandle } from '../scene/handles';
import { MAX_SAMPLES, polylinePath } from '../scene/path';

export const DEFAULT_GRAPH_VIEWBOX: ViewBox = [0, 0, 760, 380];
/** A number line is a graph with only its x axis. */
export const NUMBER_LINE_VIEWBOX: ViewBox = [0, 0, 760, 130];
const MARGIN = { left: 52, right: 20, top: 20, bottom: 40 } as const;
const LINE_MARGIN = { left: 24, right: 24, top: 20, bottom: 50 } as const;
const DEFAULT_SAMPLES = 300;
/** Tick lines and labels per axis, made once and reused as the view changes. */
const TICK_POOL = 12;
/** How far a learner may zoom in or out of the starting view. */
const MAX_ZOOM_IN = 1000;
const MAX_ZOOM_OUT = 100;

/** What a graph needs from its scene: the kit context. */
export type GraphContext = KitContext;

/** Plot area inside a graph's view box. */
export function plotRect(viewBox: ViewBox, numberLine = false): ViewBox {
  const [x, y, width, height] = viewBox;
  const m = numberLine ? LINE_MARGIN : MARGIN;
  return [x + m.left, y + m.top, width - m.left - m.right, height - m.top - m.bottom];
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

/** Ticks on a log axis: powers of ten, with 2 and 5 between them when the range is short. */
export function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const multipliers = hi - lo <= 2 ? [1, 2, 5] : [1];
  for (let p = lo; p <= hi && out.length < 40; p++) {
    for (const m of multipliers) {
      const value = Number((m * 10 ** p).toPrecision(12));
      if (value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9)) out.push(value);
    }
  }
  return out;
}

/** A tick label: as few digits as the step needs. */
export function tickText(value: number, step: number): string {
  if (value === 0) return '0';
  const digits = Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9)));
  const text = value.toFixed(digits);
  return digits > 0 ? text.replace(/\.?0+$/, '') : text;
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
  if (options.scale?.x === 'log' && !(x0 > 0)) throw new SceneApiError('A log x axis needs a range above 0');
  if (options.scale?.y === 'log' && !(y0 > 0)) throw new SceneApiError('A log y axis needs a range above 0');
}

interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** What the kit knows of a plotted series, for tracing and marking it. */
interface CurveRecord {
  readonly node: VNode;
  /** y at x, for functions of x. */
  readonly at?: (x: number) => number;
  /** The last sampled points in data units, for curves that are not functions of x. */
  points: Vec2[];
}

const curves = new WeakMap<object, CurveRecord>();

class Curve implements GraphCurve {
  fraction = 1;
  constructor(readonly handle: PathHandle) {}
  show(visible = true): this {
    this.handle.show(visible);
    return this;
  }
  tone(name: Tone): this {
    this.handle.tone(name);
    return this;
  }
  reveal(fraction: number): this {
    if (!Number.isFinite(fraction)) throw new SceneApiError('reveal needs a fraction from 0 to 1');
    this.fraction = Math.min(1, Math.max(0, fraction));
    return this;
  }
}

/**
 * A stage that remembers when a scene draws on it in its own coordinates
 * (graph.toX and stage elements): such a graph keeps its axes fixed and
 * zooms its view box instead of re-ranging.
 */
class GraphStage implements Stage {
  constructor(
    private readonly inner: StageHandle,
    private readonly raw: () => void,
  ) {}
  get viewBox(): ViewBox {
    return this.inner.viewBox;
  }
  group(options?: ElementOptions) {
    this.raw();
    return this.inner.group(options);
  }
  path(d?: string, options?: ElementOptions) {
    this.raw();
    return this.inner.path(d, options);
  }
  line(x1: number, y1: number, x2: number, y2: number, options?: ElementOptions) {
    this.raw();
    return this.inner.line(x1, y1, x2, y2, options);
  }
  circle(cx: number, cy: number, r: number, options?: ElementOptions) {
    this.raw();
    return this.inner.circle(cx, cy, r, options);
  }
  rect(x: number, y: number, width: number, height: number, options?: ElementOptions) {
    this.raw();
    return this.inner.rect(x, y, width, height, options);
  }
  text(x: number, y: number, value: Readable, options?: ElementOptions) {
    this.raw();
    return this.inner.text(x, y, value, options);
  }
  polyline(points: ReadonlyArray<Vec2>, options?: ElementOptions) {
    this.raw();
    return this.inner.polyline(points, options);
  }
  part<H extends Handle>(name: string, handle: H, options?: { readonly label?: string; readonly info?: string }): H {
    return this.inner.part(name, handle, options);
  }
  drag<H extends Handle>(handle: H, map: DragMap, options?: { readonly label?: string }): H {
    return this.inner.drag(handle, map, options);
  }
  connector(a: Handle, b: Handle, options?: Parameters<StageHandle['connector']>[2]) {
    return this.inner.connector(a, b, options);
  }
  callout(target: Handle, text: Readable | (() => Readable), options?: Parameters<StageHandle['callout']>[2]) {
    return this.inner.callout(target, text, options);
  }
  repeat(handle: Handle, count: number) {
    this.raw();
    return this.inner.repeat(handle, count);
  }
  dots(options?: Parameters<StageHandle['dots']>[0]) {
    this.raw();
    return this.inner.dots(options);
  }
}

/**
 * A Cartesian graph (G2): axes that re-tick as the learner zooms and pans,
 * curves, polar and parametric plots, scatter, bars and histograms, areas
 * and regions, vector and slope fields, implicit curves, traces, draggable
 * handles, marks for roots, turning points and crossings, annotations, log
 * scales and number lines.
 */
/** The element behind a graph item; an element is its own. */
function handleOf(item: unknown): Handle {
  return typeof item === 'object' && item !== null && 'handle' in item ? (item as { handle: Handle }).handle : (item as Handle);
}

export class Graph2D implements Graph, ViewController {
  readonly stage: Stage;
  readonly orbit = false;
  readonly views: readonly string[] = [];
  private readonly inner: StageHandle;
  private readonly start: Range;
  private range: Range;
  private readonly rect: ViewBox;
  private readonly logX: boolean;
  private readonly logY: boolean;
  private readonly numberLine: boolean;
  private raw = false;
  private formulaLabels = 0;
  private readonly remaps: Array<() => void> = [];
  private readonly series: CurveRecord[] = [];
  private axes: {
    gridX: Handle[];
    gridY: Handle[];
    labelsX: TextHandle[];
    labelsY: TextHandle[];
    axisX: Handle | null;
    axisY: Handle | null;
    nameX: TextHandle | null;
    nameY: TextHandle | null;
  } = { gridX: [], gridY: [], labelsX: [], labelsY: [], axisX: null, axisY: null, nameX: null, nameY: null };

  constructor(
    private readonly ctx: GraphContext,
    private readonly options: GraphOptions,
    viewBox: ViewBox,
  ) {
    this.inner = ctx.stage;
    this.stage = new GraphStage(ctx.stage, () => {
      this.raw = true;
    });
    [this.range, this.start] = [
      { x0: options.x[0], x1: options.x[1], y0: options.y[0], y1: options.y[1] },
      { x0: options.x[0], x1: options.x[1], y0: options.y[0], y1: options.y[1] },
    ];
    this.numberLine = options.axes === 'x';
    this.logX = options.scale?.x === 'log';
    this.logY = options.scale?.y === 'log';
    this.rect = plotRect(viewBox, this.numberLine);
    this.buildAxes();
    this.drawAxes();
    if (options.zoom !== false) ctx.setView(this);
  }

  // -------------------------------------------------------------------------
  // Mapping
  // -------------------------------------------------------------------------

  private sx(x: number): number {
    const [left, , width] = this.rect;
    const { x0, x1 } = this.range;
    if (this.logX) return left + ((Math.log10(x) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * width;
    return left + ((x - x0) / (x1 - x0)) * width;
  }

  private sy(y: number): number {
    const [, top, , height] = this.rect;
    const { y0, y1 } = this.range;
    if (this.numberLine) return top + height / 2 - y * (height / 2);
    if (this.logY) return top + ((Math.log10(y1) - Math.log10(y)) / (Math.log10(y1) - Math.log10(y0))) * height;
    return top + ((y1 - y) / (y1 - y0)) * height;
  }

  private dataX(px: number): number {
    const [left, , width] = this.rect;
    const { x0, x1 } = this.range;
    const k = (px - left) / width;
    return this.logX ? 10 ** (Math.log10(x0) + k * (Math.log10(x1) - Math.log10(x0))) : x0 + k * (x1 - x0);
  }

  private dataY(py: number): number {
    const [, top, , height] = this.rect;
    const { y0, y1 } = this.range;
    if (this.numberLine) return (top + height / 2 - py) / (height / 2);
    const k = (py - top) / height;
    return this.logY ? 10 ** (Math.log10(y1) - k * (Math.log10(y1) - Math.log10(y0))) : y1 - k * (y1 - y0);
  }

  /** Stage to data coordinates, for drags. */
  private readonly toData = (px: number, py: number): Vec2 => [this.dataX(px), this.dataY(py)];

  toX(x: number): number {
    this.raw = true;
    return this.sx(x);
  }

  toY(y: number): number {
    this.raw = true;
    return this.sy(y);
  }

  /** Data point to stage coordinates, with values far outside the range clamped. */
  private map(x: number, y: number): Vec2 {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [Number.NaN, Number.NaN];
    if ((this.logX && x <= 0) || (this.logY && y <= 0)) return [Number.NaN, Number.NaN];
    const [left, top, width, height] = this.rect;
    const px = this.sx(x);
    const py = this.sy(y);
    return [Math.min(left + 3 * width, Math.max(left - 2 * width, px)), Math.min(top + 3 * height, Math.max(top - 2 * height, py))];
  }

  // -------------------------------------------------------------------------
  // The view (G2-6)
  // -------------------------------------------------------------------------

  /** The scene drew in its own coordinates, so only the view box can zoom. */
  mode(): 'runtime' | 'viewbox' {
    return this.raw ? 'viewbox' : 'runtime';
  }

  changed(): boolean {
    const a = this.range;
    const b = this.start;
    return a.x0 !== b.x0 || a.x1 !== b.x1 || a.y0 !== b.y0 || a.y1 !== b.y1;
  }

  apply(action: ViewAction): boolean {
    const r = { ...this.range };
    const toUnit = (v: number, log: boolean) => (log ? Math.log10(v) : v);
    const fromUnit = (v: number, log: boolean) => (log ? 10 ** v : v);
    const zoomAxis = (lo: number, hi: number, at: number, factor: number, log: boolean, startSpan: number): [number, number] => {
      const a = toUnit(lo, log);
      const b = toUnit(hi, log);
      const c = toUnit(at, log);
      const span = Math.min(startSpan * MAX_ZOOM_OUT, Math.max(startSpan / MAX_ZOOM_IN, (b - a) / factor));
      const k = (c - a) / (b - a);
      return [fromUnit(c - k * span, log), fromUnit(c - k * span + span, log)];
    };
    const span = (lo: number, hi: number, log: boolean) => toUnit(hi, log) - toUnit(lo, log);
    switch (action.kind) {
      case 'zoom': {
        if (!(Number.isFinite(action.factor) && action.factor > 0)) return false;
        const [x0, x1] = zoomAxis(r.x0, r.x1, this.dataX(action.x), action.factor, this.logX, span(this.start.x0, this.start.x1, this.logX));
        r.x0 = x0;
        r.x1 = x1;
        if (!this.numberLine) {
          const [y0, y1] = zoomAxis(r.y0, r.y1, this.dataY(action.y), action.factor, this.logY, span(this.start.y0, this.start.y1, this.logY));
          r.y0 = y0;
          r.y1 = y1;
        }
        break;
      }
      case 'pan': {
        const [, , width, height] = this.rect;
        const dx = (-action.dx / width) * span(r.x0, r.x1, this.logX);
        r.x0 = fromUnit(toUnit(r.x0, this.logX) + dx, this.logX);
        r.x1 = fromUnit(toUnit(r.x1, this.logX) + dx, this.logX);
        if (!this.numberLine) {
          const dy = (action.dy / height) * span(r.y0, r.y1, this.logY);
          r.y0 = fromUnit(toUnit(r.y0, this.logY) + dy, this.logY);
          r.y1 = fromUnit(toUnit(r.y1, this.logY) + dy, this.logY);
        }
        break;
      }
      case 'reset':
        Object.assign(r, this.start);
        break;
      case 'fit': {
        const fitted = this.fitY();
        if (!fitted) return false;
        r.y0 = fitted[0];
        r.y1 = fitted[1];
        break;
      }
      default:
        return false;
    }
    if (![r.x0, r.x1, r.y0, r.y1].every(Number.isFinite) || !(r.x0 < r.x1) || !(r.y0 < r.y1)) return false;
    if (this.logX && !(r.x0 > 0)) return false;
    if (this.logY && !(r.y0 > 0)) return false;
    this.range = r;
    this.drawAxes();
    for (const remap of this.remaps) remap();
    return true;
  }

  /** A y range that shows every function drawn across the current x range. */
  private fitY(): Vec2 | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (const series of this.series) {
      if (series.node.hidden) continue;
      const values: number[] = [];
      if (series.at) {
        for (let i = 0; i <= 200; i++) values.push(series.at(this.range.x0 + ((this.range.x1 - this.range.x0) * i) / 200));
      } else for (const [x, y] of series.points) if (x >= this.range.x0 && x <= this.range.x1) values.push(y);
      for (const v of values) {
        if (!Number.isFinite(v) || (this.logY && v <= 0)) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    if (this.logY) return [lo / 1.25, hi * 1.25];
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }

  // -------------------------------------------------------------------------
  // Axes
  // -------------------------------------------------------------------------

  private buildAxes(): void {
    const options = this.options;
    const stage = this.inner;
    const grid = options.grid !== false && !this.numberLine;
    if (grid) {
      for (let i = 0; i < TICK_POOL; i++) {
        this.axes.gridX.push(stage.line(0, 0, 0, 0, { layer: 'back', tone: 'faint' }).hide());
        this.axes.gridY.push(stage.line(0, 0, 0, 0, { layer: 'back', tone: 'faint' }).hide());
      }
    }
    if (options.axes !== false) {
      this.axes.axisX = stage.line(0, 0, 0, 0, { layer: 'back', tone: 'mid' });
      if (!this.numberLine) this.axes.axisY = stage.line(0, 0, 0, 0, { layer: 'back', tone: 'mid' });
      for (let i = 0; i < TICK_POOL; i++) {
        this.axes.labelsX.push(stage.text(0, 0, '', { layer: 'back' }).set({ 'font-size': 12, 'text-anchor': 'middle' }).hide());
        if (!this.numberLine) this.axes.labelsY.push(stage.text(0, 0, '', { layer: 'back' }).set({ 'font-size': 12, 'text-anchor': 'end' }).hide());
        // A number line marks each tick on its axis.
        if (this.numberLine) this.axes.gridX.push(stage.line(0, 0, 0, 0, { layer: 'back', tone: 'mid' }).hide());
      }
      if (options.labels?.x) this.axes.nameX = stage.text(0, 0, options.labels.x, { layer: 'back' }).set({ 'font-size': 13, 'text-anchor': 'end' });
      if (options.labels?.y && !this.numberLine) this.axes.nameY = stage.text(0, 0, options.labels.y, { layer: 'back' }).set({ 'font-size': 13 });
    }
  }

  private drawAxes(): void {
    const [left, top, width, height] = this.rect;
    const right = left + width;
    const bottom = top + height;
    const { x0, x1, y0, y1 } = this.range;
    const xStep = this.logX ? 0 : niceStep(x1 - x0);
    const yStep = this.logY ? 0 : niceStep(y1 - y0, 5);
    const xTicks = (this.logX ? logTicks(x0, x1) : ticks(x0, x1, xStep)).slice(0, TICK_POOL);
    const yTicks = this.numberLine ? [] : (this.logY ? logTicks(y0, y1) : ticks(y0, y1, yStep)).slice(0, TICK_POOL);
    const axisY = this.numberLine ? top + height / 2 : !this.logY && y0 <= 0 && y1 >= 0 ? this.sy(0) : bottom;
    const axisX = !this.logX && x0 <= 0 && x1 >= 0 ? this.sx(0) : left;
    const xText = (t: number) => (this.logX ? tickText(t, t / 10) : tickText(t, xStep));
    const yText = (t: number) => (this.logY ? tickText(t, t / 10) : tickText(t, yStep));

    if (this.numberLine) {
      this.axes.gridX.forEach((tick, i) => {
        const t = xTicks[i];
        if (t === undefined) tick.hide();
        else tick.set({ x1: this.sx(t), y1: axisY - 6, x2: this.sx(t), y2: axisY + 6 }).show();
      });
    } else {
      this.axes.gridX.forEach((line, i) => {
        const t = xTicks[i];
        if (t === undefined) line.hide();
        else line.set({ x1: this.sx(t), y1: top, x2: this.sx(t), y2: bottom }).show();
      });
      this.axes.gridY.forEach((line, i) => {
        const t = yTicks[i];
        if (t === undefined) line.hide();
        else line.set({ x1: left, y1: this.sy(t), x2: right, y2: this.sy(t) }).show();
      });
    }
    this.axes.axisX?.set({ x1: left, y1: axisY, x2: right, y2: axisY });
    this.axes.axisY?.set({ x1: axisX, y1: top, x2: axisX, y2: bottom });
    const labelY = this.numberLine ? axisY + 22 : Math.min(bottom, axisY) + 16;
    this.axes.labelsX.forEach((label, i) => {
      const t = xTicks[i];
      // Zero sits at the origin once, under the y axis; elsewhere every tick is labelled.
      if (t === undefined || (t === 0 && axisX !== left && !this.numberLine && yTicks.includes(0))) label.hide();
      else label.set({ x: this.sx(t), y: labelY }).text(xText(t)).show();
    });
    this.axes.labelsY.forEach((label, i) => {
      const t = yTicks[i];
      if (t === undefined) label.hide();
      else label.set({ x: Math.max(left, axisX) - 6, y: this.sy(t) + 4 }).text(t === 0 && axisX !== left ? '0' : yText(t)).show();
    });
    this.axes.nameX?.set({ x: right, y: this.numberLine ? axisY - 12 : Math.min(bottom, axisY) - 8 });
    this.axes.nameY?.set({ x: Math.max(left, axisX) + 8, y: top + 12 });
  }

  // -------------------------------------------------------------------------
  // Curves and series
  // -------------------------------------------------------------------------

  private sampleCount(requested: number | undefined): number {
    const n = Math.floor(requested ?? DEFAULT_SAMPLES);
    if (!Number.isFinite(n) || n < 2) return 2;
    if (n > MAX_SAMPLES) {
      this.ctx.reportCap(n);
      return MAX_SAMPLES;
    }
    return n;
  }

  private curve(options: CurveOptions, defaultTone: Tone = 'lit', layer: 'mid' | 'back' = 'mid'): { curve: Curve; handle: PathHandle; node: VNode } {
    const handle = this.inner.path(undefined, { layer, tone: options.tone ?? defaultTone, dashed: options.dashed ?? false, ...(options.fill ? { fill: true } : {}) });
    if (options.fill) handle.set({ 'fill-opacity': 0.25 });
    const node = nodeOf(handle);
    if (options.label !== undefined) {
      if (typeof options.label !== 'string' || options.label.trim() === '') throw new SceneApiError('A curve label is short text');
      this.ctx.addLegend(node, options.label, true);
    }
    return { curve: new Curve(handle), handle, node };
  }

  private record(curve: Curve, node: VNode, at?: (x: number) => number): CurveRecord {
    const record: CurveRecord = { node, points: [], ...(at ? { at } : {}) };
    curves.set(curve, record);
    this.series.push(record);
    return record;
  }

  private evaluate(fn: PlotFunction): (x: number) => number {
    return (x: number) => fn(x, this.ctx.time());
  }

  private watchTime(fn: PlotFunction | ((a: number, b: number) => number)): void {
    // A formula that names t, or a function that takes time, moves on its own.
    if (this.ctx.isFormula(fn) ? fn.variables.includes('t') : fn.length >= 2) this.ctx.markTimeUse();
  }

  plot(fn: PlotFunction, options: CurveOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('plot needs a function or a formula');
    const { curve, handle, node } = this.curve(options);
    const samples = this.sampleCount(options.samples);
    if (this.ctx.isFormula(fn)) this.formulaLabel(fn);
    this.watchTime(fn);
    const evaluate = this.evaluate(fn);
    const record = this.record(curve, node, evaluate);
    this.ctx.onRedraw(() => {
      const points = this.sampleFunction(evaluate, samples, curve.fraction);
      record.points = points.data;
      handle.d(options.fill ? this.closeToAxis(points.stage) : polylinePath(points.stage));
    });
    return curve;
  }

  plotX(fn: (y: number, time: number) => number, options: CurveOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('plotX needs a function of y');
    const { curve, handle, node } = this.curve(options);
    const samples = this.sampleCount(options.samples);
    this.watchTime(fn);
    const record = this.record(curve, node);
    this.ctx.onRedraw(() => {
      const data: Vec2[] = [];
      const last = Math.round(samples * curve.fraction);
      for (let i = 0; i <= last; i++) {
        const y = this.range.y0 + ((this.range.y1 - this.range.y0) * i) / samples;
        data.push([fn(y, this.ctx.time()), y]);
      }
      record.points = data;
      handle.d(polylinePath(data.map(([x, y]) => this.map(x, y))));
    });
    return curve;
  }

  polar(fn: (theta: number, time: number) => number, options: CurveOptions & { readonly from?: number; readonly to?: number } = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('polar needs a function of theta');
    const from = options.from ?? 0;
    const to = options.to ?? 2 * Math.PI;
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new SceneApiError('polar needs a finite theta range');
    return this.parametric(
      (t) => fn(t, this.ctx.time()) * Math.cos(t),
      (t) => fn(t, this.ctx.time()) * Math.sin(t),
      from,
      to,
      options,
      fn.length >= 2,
    );
  }

  parametric(
    fx: (t: number) => number,
    fy: (t: number) => number,
    t0: number,
    t1: number,
    options: CurveOptions = {},
    timed = false,
  ): GraphCurve {
    if (typeof fx !== 'function' || typeof fy !== 'function') throw new SceneApiError('parametric needs two functions');
    const { curve, handle, node } = this.curve(options);
    const samples = this.sampleCount(options.samples);
    if (timed) this.ctx.markTimeUse();
    const record = this.record(curve, node);
    this.ctx.onRedraw(() => {
      const data: Vec2[] = [];
      const last = Math.round(samples * curve.fraction);
      for (let i = 0; i <= last; i++) {
        const t = t0 + ((t1 - t0) * i) / samples;
        data.push([fx(t), fy(t)]);
      }
      record.points = data;
      const stage = data.map(([x, y]) => this.map(x, y));
      handle.d(options.fill ? `${polylinePath(stage)}Z` : polylinePath(stage));
    });
    return curve;
  }

  scatter(points: PointsSource, options: SeriesOptions = {}): GraphCurve {
    const { curve, handle, node } = this.curve({ ...options, fill: true }, options.tone ?? 'b');
    handle.set({ 'fill-opacity': 0.9 });
    const r = options.r ?? 4;
    if (!(Number.isFinite(r) && r > 0 && r <= 30)) throw new SceneApiError('scatter dots need a radius from 0 to 30');
    const record = this.record(curve, node);
    this.ctx.onRedraw(() => {
      const data = readPoints(points, 'scatter');
      record.points = data;
      let d = '';
      const shown = Math.round(data.length * curve.fraction);
      for (let i = 0; i < shown; i++) {
        const [px, py] = this.map(data[i]![0], data[i]![1]);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        d += `M${fmt(px + r)} ${fmt(py)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0`;
      }
      handle.d(d);
    });
    return curve;
  }

  bars(points: PointsSource, options: BarOptions = {}): GraphCurve {
    const { curve, handle, node } = this.curve({ ...options, fill: true }, options.tone ?? 'b');
    handle.set({ 'fill-opacity': 0.8 });
    const record = this.record(curve, node);
    this.ctx.onRedraw(() => {
      const data = readPoints(points, 'bars');
      record.points = data;
      handle.d(this.barPath(data, options.width, curve.fraction));
    });
    return curve;
  }

  histogram(values: ValuesSource, options: HistogramOptions): GraphCurve {
    const bins = options?.bins;
    if (!Number.isInteger(bins) || bins < 1 || bins > 200) throw new SceneApiError('histogram needs from 1 to 200 bins');
    const { curve, handle, node } = this.curve({ ...options, fill: true }, options.tone ?? 'b');
    handle.set({ 'fill-opacity': 0.8 });
    const record = this.record(curve, node);
    this.ctx.onRedraw(() => {
      const list = readValues(values, 'histogram');
      const [lo, hi] = options.range ?? [this.start.x0, this.start.x1];
      const width = (hi - lo) / bins;
      const counts = new Array<number>(bins).fill(0);
      let total = 0;
      for (const v of list) {
        if (!Number.isFinite(v) || v < lo || v > hi) continue;
        counts[Math.min(bins - 1, Math.floor((v - lo) / width))]!++;
        total++;
      }
      const data: Vec2[] = counts.map((c, i) => [lo + width * (i + 0.5), options.density ? c / Math.max(1, total) / width : c]);
      record.points = data;
      handle.d(this.barPath(data, width, curve.fraction));
    });
    return curve;
  }

  area(fn: PlotFunction, from: Bound, to: Bound, options: CurveOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('area needs a function or a formula');
    return this.region(this.evaluate(fn), () => 0, from, to, options, fn);
  }

  between(f: PlotFunction, g: PlotFunction, from: Bound, to: Bound, options: CurveOptions = {}): GraphCurve {
    if (typeof f !== 'function' || typeof g !== 'function') throw new SceneApiError('between needs two functions or formulas');
    return this.region(this.evaluate(f), this.evaluate(g), from, to, options, f, g);
  }

  private region(f: (x: number) => number, g: (x: number) => number, from: Bound, to: Bound, options: CurveOptions, ...sources: PlotFunction[]): GraphCurve {
    const { curve, handle, node } = this.curve({ ...options, fill: true }, options.tone ?? 'b');
    for (const source of sources) this.watchTime(source);
    const samples = this.sampleCount(options.samples ?? 160);
    this.record(curve, node);
    this.ctx.onRedraw(() => {
      const a = bound(from);
      const b = bound(to);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
        handle.d('');
        return;
      }
      const lo = Math.min(a, b);
      const hi = lo + (Math.max(a, b) - lo) * curve.fraction;
      const top: Vec2[] = [];
      const bottom: Vec2[] = [];
      for (let i = 0; i <= samples; i++) {
        const x = lo + ((hi - lo) * i) / samples;
        const fy = f(x);
        const gy = g(x);
        if (!Number.isFinite(fy) || !Number.isFinite(gy)) continue;
        top.push(this.map(x, fy));
        bottom.push(this.map(x, gy));
      }
      handle.d(top.length > 1 ? `${polylinePath([...top, ...bottom.reverse()])}Z` : '');
    });
    return curve;
  }

  field(fn: (x: number, y: number) => Vec2, options: FieldOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('field needs a function of x and y returning [vx, vy]');
    return this.grid(options, (x, y, cell) => {
      const v = fn(x, y);
      if (!Array.isArray(v)) return null;
      const [vx, vy] = v as unknown as Vec2;
      return [vx, vy, cell];
    });
  }

  slopes(fn: (x: number, y: number) => number, options: FieldOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('slopes needs a function dy/dx of x and y');
    return this.grid(options, (x, y, cell) => {
      const m = fn(x, y);
      if (!Number.isFinite(m)) return null;
      const length = Math.hypot(1, m);
      return [1 / length, m / length, cell, true];
    });
  }

  /** Arrows (or bare segments) on a grid; `vector` returns a direction and the cell size. */
  private grid(options: FieldOptions, vector: (x: number, y: number, cell: number) => [number, number, number, boolean?] | null): GraphCurve {
    const { curve, handle, node } = this.curve({ tone: options.tone ?? 'mid' }, 'mid');
    this.record(curve, node);
    this.ctx.onRedraw(() => {
      const { x0, x1, y0, y1 } = this.range;
      const step = options.step ?? niceStep(x1 - x0, 16);
      if (!(step > 0)) return;
      const cells: Array<[number, number, number, number, boolean]> = [];
      let largest = 0;
      for (let i = 0, x = Math.ceil(x0 / step) * step; x <= x1 && i < 40; i++, x += step) {
        for (let j = 0, y = Math.ceil(y0 / step) * step; y <= y1 && j < 40; j++, y += step) {
          const v = vector(x, y, step);
          if (!v || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) continue;
          largest = Math.max(largest, Math.hypot(v[0], v[1]));
          cells.push([x, y, v[0], v[1], v[3] === true]);
        }
      }
      const scale = options.scale ?? (largest > 0 ? (0.8 * step) / largest : 0);
      let d = '';
      for (const [x, y, vx, vy, bare] of cells) {
        const [ax, ay] = this.map(x - (bare ? (vx * step * 0.35) : 0), y - (bare ? (vy * step * 0.35) : 0));
        const [bx, by] = this.map(x + (bare ? vx * step * 0.35 : vx * scale), y + (bare ? vy * step * 0.35 : vy * scale));
        if (![ax, ay, bx, by].every(Number.isFinite) || Math.hypot(bx - ax, by - ay) < 0.5) continue;
        d += `M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`;
        if (!bare) {
          const length = Math.hypot(bx - ax, by - ay);
          const h = Math.min(6, length * 0.4);
          const ux = (bx - ax) / length;
          const uy = (by - ay) / length;
          d += `M${fmt(bx - ux * h - uy * h * 0.5)} ${fmt(by - uy * h + ux * h * 0.5)}L${fmt(bx)} ${fmt(by)}L${fmt(bx - ux * h + uy * h * 0.5)} ${fmt(by - uy * h - ux * h * 0.5)}`;
        }
      }
      handle.d(d);
    });
    return curve;
  }

  implicit(fn: (x: number, y: number) => number, options: CurveOptions = {}): GraphCurve {
    if (typeof fn !== 'function') throw new SceneApiError('implicit needs a function F(x, y)');
    const { curve, handle, node } = this.curve({ ...options, fill: false });
    const shade = options.fill ? this.inner.path(undefined, { layer: 'back', tone: options.tone ?? 'lit', fill: true }).set({ 'fill-opacity': 0.18 }) : null;
    this.record(curve, node);
    this.ctx.onRedraw(() => {
      const [cols, rows] = [72, 40];
      const { x0, x1, y0, y1 } = this.range;
      const value: number[] = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) value.push(fn(x0 + ((x1 - x0) * i) / cols, y0 + ((y1 - y0) * j) / rows));
      const at = (i: number, j: number) => value[j * (cols + 1) + i]!;
      const point = (i: number, j: number) => this.map(x0 + ((x1 - x0) * i) / cols, y0 + ((y1 - y0) * j) / rows);
      let d = '';
      let fill = '';
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
          if (!c.every(Number.isFinite)) continue;
          if (shade && c.every((v) => v < 0)) {
            const [ax, ay] = point(i, j);
            const [bx, by] = point(i + 1, j + 1);
            fill += `M${fmt(ax)} ${fmt(ay)}H${fmt(bx)}V${fmt(by)}H${fmt(ax)}Z`;
          }
          // Marching squares: where the sign changes along an edge, the curve crosses it.
          const crossings: Vec2[] = [];
          const edges: Array<[number, number, number, number, number, number]> = [
            [i, j, i + 1, j, c[0]!, c[1]!],
            [i + 1, j, i + 1, j + 1, c[1]!, c[2]!],
            [i + 1, j + 1, i, j + 1, c[2]!, c[3]!],
            [i, j + 1, i, j, c[3]!, c[0]!],
          ];
          for (const [ai, aj, bi, bj, va, vb] of edges) {
            if ((va < 0) === (vb < 0)) continue;
            const k = va / (va - vb);
            const [ax, ay] = point(ai, aj);
            const [bx, by] = point(bi, bj);
            crossings.push([ax + (bx - ax) * k, ay + (by - ay) * k]);
          }
          for (let k = 0; k + 1 < crossings.length; k += 2) {
            d += `M${fmt(crossings[k]![0])} ${fmt(crossings[k]![1])}L${fmt(crossings[k + 1]![0])} ${fmt(crossings[k + 1]![1])}`;
          }
        }
      }
      handle.d(d);
      shade?.d(fill);
    });
    return curve;
  }

  // -------------------------------------------------------------------------
  // Points, segments, arrows, trails, labels and marks
  // -------------------------------------------------------------------------

  point(x: number, y: number, options: { readonly tone?: Tone; readonly r?: number } = {}): GraphPoint {
    const handle = this.inner.circle(0, 0, options.r ?? 6, { layer: 'front', tone: options.tone ?? 'hi' });
    let px = x;
    let py = y;
    const place = () => {
      const [cx, cy] = this.map(px, py);
      handle.set({ cx, cy });
    };
    place();
    this.remaps.push(place);
    return {
      handle,
      at(nx: number, ny: number) {
        px = nx;
        py = ny;
        place();
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
    const handle: Handle = this.inner.line(0, 0, 0, 0, {
      layer: 'front',
      tone: options.tone ?? 'mid',
      dashed: options.dashed ?? false,
    });
    let coords: [number, number, number, number] = [x1, y1, x2, y2];
    const place = () => {
      const [ax, ay] = this.map(coords[0], coords[1]);
      const [bx, by] = this.map(coords[2], coords[3]);
      handle.set({ x1: ax, y1: ay, x2: bx, y2: by });
    };
    place();
    this.remaps.push(place);
    return {
      handle,
      between(a: number, b: number, c: number, d: number) {
        coords = [a, b, c, d];
        place();
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
    const handle = this.inner.path(undefined, { layer: 'front', tone: options.tone ?? 'hi', dashed: options.dashed ?? false });
    let coords: [number, number, number, number] = [x, y, dx, dy];
    const place = () => {
      const [px, py, pdx, pdy] = coords;
      const [sx, sy] = this.map(px, py);
      const [ex, ey] = this.map(px + pdx, py + pdy);
      handle.d(this.ctx.path.arrow(sx, sy, ex - sx, ey - sy));
    };
    place();
    this.remaps.push(place);
    return {
      handle,
      from(px: number, py: number, pdx: number, pdy: number) {
        coords = [px, py, pdx, pdy];
        place();
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

  trail(options: { readonly tone?: Tone; readonly max?: number } = {}): GraphTrail {
    const handle: PolylineHandle = this.inner.polyline([], { tone: options.tone ?? 'faint' });
    const max = Math.max(2, Math.min(MAX_SAMPLES, Math.floor(options.max ?? 200)));
    const points: Vec2[] = [];
    const place = () => handle.points(points.map(([x, y]) => this.map(x, y)));
    this.remaps.push(place);
    return {
      handle,
      add(x: number, y: number) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return this;
        points.push([x, y]);
        if (points.length > max) points.shift();
        place();
        return this;
      },
      clear() {
        points.length = 0;
        place();
        return this;
      },
    };
  }

  label(x: number, y: number, value: Readable, options?: ElementOptions): TextHandle {
    const handle = this.inner.text(0, 0, value, { layer: 'labels', ...options });
    const place = () => {
      const [px, py] = this.map(x, y);
      handle.set({ x: px, y: py });
    };
    place();
    this.remaps.push(place);
    return handle;
  }

  bracket(x1: number, y1: number, x2: number, y2: number, text: Readable = '', options: { readonly tone?: Tone } = {}): GraphMark {
    return this.mark('bracket', x1, y1, x2, y2, text, options.tone ?? 'mid');
  }

  dimension(x1: number, y1: number, x2: number, y2: number, text: Readable = '', options: { readonly tone?: Tone } = {}): GraphMark {
    return this.mark('dimension', x1, y1, x2, y2, text, options.tone ?? 'mid');
  }

  private mark(kind: 'bracket' | 'dimension', x1: number, y1: number, x2: number, y2: number, value: Readable, tone: Tone): GraphMark {
    const handle = this.inner.path(undefined, { layer: 'front', tone });
    const text = this.inner.text(0, 0, value, { layer: 'labels', tone }).set({ 'font-size': 12, 'text-anchor': 'middle' });
    let coords: [number, number, number, number] = [x1, y1, x2, y2];
    const place = () => {
      const [ax, ay] = this.map(coords[0], coords[1]);
      const [bx, by] = this.map(coords[2], coords[3]);
      const length = Math.hypot(bx - ax, by - ay);
      if (!(length > 0)) {
        handle.d('');
        return;
      }
      // The normal points to the left of a to b; text sits beyond the mark.
      const nx = -(by - ay) / length;
      const ny = (bx - ax) / length;
      const depth = 8;
      if (kind === 'bracket') {
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        handle.d(
          `M${fmt(ax)} ${fmt(ay)}Q${fmt(ax + nx * depth)} ${fmt(ay + ny * depth)} ${fmt((ax + mx) / 2 + nx * depth)} ${fmt((ay + my) / 2 + ny * depth)}` +
            `T${fmt(mx + nx * depth * 2)} ${fmt(my + ny * depth * 2)}` +
            `M${fmt(bx)} ${fmt(by)}Q${fmt(bx + nx * depth)} ${fmt(by + ny * depth)} ${fmt((bx + mx) / 2 + nx * depth)} ${fmt((by + my) / 2 + ny * depth)}` +
            `T${fmt(mx + nx * depth * 2)} ${fmt(my + ny * depth * 2)}`,
        );
        text.set({ x: mx + nx * depth * 4, y: my + ny * depth * 4 + 4 });
      } else {
        const ux = (bx - ax) / length;
        const uy = (by - ay) / length;
        const h = Math.min(7, length / 3);
        handle.d(
          `M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}` +
            `M${fmt(ax + ux * h + nx * h * 0.5)} ${fmt(ay + uy * h + ny * h * 0.5)}L${fmt(ax)} ${fmt(ay)}L${fmt(ax + ux * h - nx * h * 0.5)} ${fmt(ay + uy * h - ny * h * 0.5)}` +
            `M${fmt(bx - ux * h + nx * h * 0.5)} ${fmt(by - uy * h + ny * h * 0.5)}L${fmt(bx)} ${fmt(by)}L${fmt(bx - ux * h - nx * h * 0.5)} ${fmt(by - uy * h - ny * h * 0.5)}` +
            `M${fmt(ax + nx * 6)} ${fmt(ay + ny * 6)}L${fmt(ax - nx * 6)} ${fmt(ay - ny * 6)}M${fmt(bx + nx * 6)} ${fmt(by + ny * 6)}L${fmt(bx - nx * 6)} ${fmt(by - ny * 6)}`,
        );
        text.set({ x: (ax + bx) / 2 + nx * 14, y: (ay + by) / 2 + ny * 14 + 4 });
      }
    };
    place();
    this.remaps.push(place);
    return {
      handle,
      between(a: number, b: number, c: number, d: number) {
        coords = [a, b, c, d];
        place();
        return this;
      },
      text(next: Readable) {
        text.text(next);
        return this;
      },
      show(visible = true) {
        handle.show(visible);
        text.show(visible);
        return this;
      },
      tone(name: Tone) {
        handle.tone(name);
        text.tone(name);
        return this;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Direct manipulation: traces, handles and drags (G2-7, G2-10, VI-4)
  // -------------------------------------------------------------------------

  trace(target: GraphCurve, options: { readonly tone?: Tone; readonly digits?: number } = {}): GraphPoint {
    const record = curves.get(target);
    if (!record) throw new SceneApiError('trace needs a curve this graph drew');
    const tone = options.tone ?? 'hi';
    const digits = Math.min(6, Math.max(0, Math.floor(options.digits ?? 2)));
    const guide = this.inner.path(undefined, { layer: 'back', tone: 'mid', dashed: true });
    const dot = this.inner.circle(0, 0, 6, { layer: 'front', tone });
    const label = this.inner.text(0, 0, '', { layer: 'labels', tone }).set({ 'font-size': 12 });
    let x = (this.start.x0 + this.start.x1) / 2;
    let follow: Vec2 | null = null;
    const near = (px: number, py: number): Vec2 | null => {
      if (record.at) {
        const tx = this.dataX(px);
        const ty = record.at(tx);
        return Number.isFinite(ty) ? [tx, ty] : null;
      }
      let best: Vec2 | null = null;
      let distance = Infinity;
      for (const point of record.points) {
        const [sx, sy] = this.map(point[0], point[1]);
        const d = Math.hypot(sx - px, sy - py);
        if (d < distance) {
          distance = d;
          best = point;
        }
      }
      return best;
    };
    const place = () => {
      const p: Vec2 | null = follow ?? (record.at ? [x, record.at(x)] : (record.points[Math.floor(record.points.length / 2)] ?? null));
      const visible = !record.node.hidden && p !== null && Number.isFinite(p[0]) && Number.isFinite(p[1]) && this.inView(p[0], p[1]);
      dot.show(visible);
      label.show(visible);
      guide.show(visible);
      if (!visible || !p) return;
      const [sx, sy] = this.map(p[0], p[1]);
      dot.set({ cx: sx, cy: sy });
      const [left, top, width, height] = this.rect;
      const right = left + width;
      const flip = sx > right - 110;
      label.set({ x: sx + (flip ? -10 : 10), y: Math.max(top + 12, sy - 10), 'text-anchor': flip ? 'end' : 'start' });
      label.text(`(${round(p[0], digits)}, ${round(p[1], digits)})`);
      const axisY = !this.logY && this.range.y0 <= 0 && this.range.y1 >= 0 ? this.sy(0) : top + height;
      guide.d(`M${fmt(sx)} ${fmt(sy)}L${fmt(sx)} ${fmt(axisY)}`);
    };
    this.ctx.onRedraw(place);
    this.ctx.addHover((p) => {
      follow = p ? near(p[0], p[1]) : null;
    });
    this.ctx.addDrag(
      nodeOf(dot),
      'the point on the curve',
      (info) => {
        const p = near(this.sx(info.x), this.sy(info.y));
        if (p) {
          x = p[0];
          follow = record.at ? null : p;
        }
      },
      this.toData,
    );
    const graph = this;
    return {
      handle: dot,
      at(nx: number) {
        x = nx;
        follow = null;
        graph.ctx.markTimeUse();
        return this;
      },
      show(visible = true) {
        dot.show(visible);
        return this;
      },
      tone(name: Tone) {
        dot.tone(name);
        label.tone(name);
        return this;
      },
    };
  }

  handle(options: HandleOptions): GraphPoint {
    if (!options || (typeof options.x !== 'string' && typeof options.x !== 'number') || (typeof options.y !== 'string' && typeof options.y !== 'number')) {
      throw new SceneApiError('handle needs x and y, each a parameter name or a number');
    }
    for (const axis of [options.x, options.y]) {
      if (typeof axis === 'string' && !this.ctx.param(axis)) throw new SceneApiError(`handle: "${axis}" is not a parameter declared before it`);
      if (typeof axis === 'number' && !Number.isFinite(axis)) throw new SceneApiError('handle needs finite numbers');
    }
    if (typeof options.x === 'number' && typeof options.y === 'number') {
      throw new SceneApiError("graph.handle needs x or y to name a parameter, in quotes, such as { x: 'phase', y: 0 }; for a point that sets no parameter use graph.point, or graph.drag to map the pointer to parameters");
    }
    const value = (axis: string | number) => (typeof axis === 'string' ? (this.ctx.param(axis)?.value ?? Number.NaN) : axis);
    const point = this.point(value(options.x), value(options.y), { tone: options.tone ?? 'lit', r: options.r ?? 8 });
    this.ctx.onRedraw(() => point.at(value(options.x), value(options.y)));
    const names = [options.x, options.y].filter((a): a is string => typeof a === 'string');
    this.ctx.addDrag(
      nodeOf(point.handle),
      options.label ?? names.join(' and '),
      (info) => {
        const out: Record<string, number> = {};
        if (typeof options.x === 'string') out[options.x] = info.x;
        if (typeof options.y === 'string') out[options.y] = info.y;
        return out;
      },
      this.toData,
    );
    return point;
  }

  drag(item: GraphPoint | GraphSegment | GraphArrow | GraphCurve | Handle, map: DragMap, options: { readonly label?: string } = {}): void {
    if (typeof map !== 'function') throw new SceneApiError('drag needs a function that turns the pointer into parameter values');
    const node = nodeOf(handleOf(item));
    this.ctx.addDrag(node, options.label ?? node.part ?? 'the point', map, this.toData);
  }

  part<T extends GraphPoint | GraphSegment | GraphArrow | GraphCurve | GraphMark | GraphTrail | Handle>(name: string, item: T, options: PartOptions = {}): T {
    this.inner.part(name, handleOf(item), options);
    return item;
  }

  // -------------------------------------------------------------------------
  // Marks for special points (G2-8)
  // -------------------------------------------------------------------------

  marks(target: GraphCurve, options: { readonly roots?: boolean; readonly extrema?: boolean; readonly tone?: Tone } = {}): void {
    const record = curves.get(target);
    if (!record?.at) throw new SceneApiError('marks needs a curve of y = f(x) this graph drew');
    const at = record.at;
    const roots = options.roots ?? true;
    const extrema = options.extrema ?? true;
    this.markPoints(options.tone ?? 'hi', () => {
      const out: Array<[number, number, string]> = [];
      const { x0, x1 } = this.range;
      if (roots) for (const x of findRoots(at, x0, x1)) out.push([x, 0, `x = ${round(x, 2)}`]);
      if (extrema) {
        const h = (x1 - x0) * 1e-4;
        for (const x of findRoots((x) => (at(x + h) - at(x - h)) / (2 * h), x0, x1)) {
          const y = at(x);
          if (!Number.isFinite(y)) continue;
          const kind = at(x - 10 * h) > y ? 'min' : 'max';
          out.push([x, y, `${kind} (${round(x, 2)}, ${round(y, 2)})`]);
        }
      }
      return out;
    }, record.node);
  }

  crossings(a: GraphCurve, b: GraphCurve, options: { readonly tone?: Tone } = {}): void {
    const first = curves.get(a)?.at;
    const second = curves.get(b)?.at;
    if (!first || !second) throw new SceneApiError('crossings needs two curves of y = f(x) this graph drew');
    this.markPoints(options.tone ?? 'hi', () =>
      findRoots((x) => first(x) - second(x), this.range.x0, this.range.x1).map((x) => [x, first(x), `(${round(x, 2)}, ${round(first(x), 2)})`]),
    );
  }

  private markPoints(tone: Tone, find: () => Array<[number, number, string]>, owner?: VNode): void {
    const dots = this.inner.path(undefined, { layer: 'front', tone, fill: true });
    const labels: TextHandle[] = [];
    for (let i = 0; i < 6; i++) labels.push(this.inner.text(0, 0, '', { layer: 'labels', tone }).set({ 'font-size': 12, 'text-anchor': 'middle' }).hide());
    this.ctx.onRedraw(() => {
      const hidden = owner?.hidden ?? false;
      const points = hidden ? [] : find().filter(([x, y]) => this.inView(x, y)).slice(0, 6);
      let d = '';
      points.forEach(([x, y, text], i) => {
        const [px, py] = this.map(x, y);
        d += `M${fmt(px + 4)} ${fmt(py)}a4 4 0 1 0 -8 0a4 4 0 1 0 8 0`;
        labels[i]!.set({ x: px, y: py - 10 }).text(text).show();
      });
      for (let i = points.length; i < labels.length; i++) labels[i]!.hide();
      dots.d(d);
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private inView(x: number, y: number): boolean {
    const { x0, x1, y0, y1 } = this.range;
    return x >= x0 && x <= x1 && (this.numberLine || (y >= y0 && y <= y1));
  }

  private barPath(data: readonly Vec2[], width: number | undefined, fraction: number): string {
    const xs = data.map(([x]) => x).filter(Number.isFinite).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) if (xs[i]! - xs[i - 1]! > 1e-12) gap = Math.min(gap, xs[i]! - xs[i - 1]!);
    const w = width ?? (Number.isFinite(gap) ? gap * 0.8 : (this.range.x1 - this.range.x0) / 20);
    const base = this.logY ? this.range.y0 : Math.min(Math.max(0, this.range.y0), this.range.y1);
    let d = '';
    for (const [x, y] of data) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const [ax, ay] = this.map(x - w / 2, base);
      const [bx, by] = this.map(x + w / 2, base + (y - base) * fraction);
      if (![ax, ay, bx, by].every(Number.isFinite)) continue;
      d += `M${fmt(ax)} ${fmt(ay)}H${fmt(bx)}V${fmt(by)}H${fmt(ax)}Z`;
    }
    return d;
  }

  /** A curve closed down to the x axis, to fill under it. */
  private closeToAxis(points: Vec2[]): string {
    const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (finite.length < 2) return '';
    const base = this.sy(!this.logY && this.range.y0 <= 0 && this.range.y1 >= 0 ? 0 : this.range.y0);
    return `${polylinePath(finite)}L${fmt(finite.at(-1)![0])} ${fmt(base)}L${fmt(finite[0]![0])} ${fmt(base)}Z`;
  }

  /** Samples y = f(x) across the x range, breaking the path at asymptotes. */
  private sampleFunction(fn: (x: number) => number, samples: number, fraction = 1): { stage: Vec2[]; data: Vec2[] } {
    const stage: Vec2[] = [];
    const data: Vec2[] = [];
    const { x0, x1, y0, y1 } = this.range;
    const span = y1 - y0;
    let previous = Number.NaN;
    const last = Math.round(samples * fraction);
    for (let i = 0; i <= last; i++) {
      const x = this.logX ? 10 ** (Math.log10(x0) + ((Math.log10(x1) - Math.log10(x0)) * i) / samples) : x0 + ((x1 - x0) * i) / samples;
      const y = fn(x);
      if (!Number.isFinite(y)) {
        stage.push([Number.NaN, Number.NaN]);
        previous = Number.NaN;
        continue;
      }
      const offscale = (v: number) => v > y1 + span || v < y0 - span;
      if (Number.isFinite(previous) && Math.sign(y) !== Math.sign(previous) && offscale(y) && offscale(previous)) {
        stage.push([Number.NaN, Number.NaN]); // an asymptote between samples: do not bridge it
      }
      stage.push(this.map(x, y));
      data.push([x, y]);
      previous = y;
    }
    return { stage, data };
  }

  private formulaLabel(formula: Formula): void {
    const [left, top] = this.rect;
    const text = this.inner.text(left + 8, top + 16 + this.formulaLabels * 18, `y = ${formula.source}`, { layer: 'labels' }).set({ 'font-size': 13 });
    // An edited formula shows its new text.
    this.ctx.onRedraw(() => text.text(`y = ${formula.source}`));
    this.formulaLabels++;
  }
}

/** Where a function crosses zero in [a, b]: sign changes on a grid, refined by bisection. */
export function findRoots(fn: (x: number) => number, a: number, b: number, n = 400): number[] {
  const out: number[] = [];
  let px = a;
  let py = fn(a);
  for (let i = 1; i <= n && out.length < 12; i++) {
    const x = a + ((b - a) * i) / n;
    const y = fn(x);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (py === 0) out.push(px);
      else if (Math.sign(py) !== Math.sign(y) && y !== 0) {
        // Bisect, but not across a jump to infinity (an asymptote is not a root).
        let lo = px;
        let hi = x;
        let flo = py;
        for (let k = 0; k < 50; k++) {
          const mid = (lo + hi) / 2;
          const fm = fn(mid);
          if (!Number.isFinite(fm)) break;
          if (Math.sign(fm) === Math.sign(flo)) {
            lo = mid;
            flo = fm;
          } else hi = mid;
        }
        const root = (lo + hi) / 2;
        if (Math.abs(fn(root)) < 1e-3 * (1 + Math.abs(py) + Math.abs(y))) out.push(root);
      }
    }
    px = x;
    py = y;
  }
  return out;
}

function readPoints(source: PointsSource, call: string): Vec2[] {
  const list = typeof source === 'function' ? source() : source;
  if (!Array.isArray(list)) throw new SceneApiError(`${call} needs a list of [x, y] points`);
  if (list.length > 2000) throw new SceneApiError(`${call} draws at most 2000 points`);
  return list.filter((p): p is Vec2 => Array.isArray(p) && p.length >= 2);
}

function readValues(source: ValuesSource, call: string): readonly number[] {
  const list = typeof source === 'function' ? source() : source;
  if (!Array.isArray(list)) throw new SceneApiError(`${call} needs a list of numbers`);
  if (list.length > 20_000) throw new SceneApiError(`${call} takes at most 20000 values`);
  return list;
}

function bound(value: Bound): number {
  return typeof value === 'function' ? value() : value;
}

function round(value: number, digits: number): string {
  const k = 10 ** digits;
  const rounded = Math.round(value * k) / k;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

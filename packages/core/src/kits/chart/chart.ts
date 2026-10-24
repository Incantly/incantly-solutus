import type { Chart, ChartData, ChartKind, ChartOptions, ChartSeries, ChartSeriesOptions, Dots, Handle, PartOptions, PathHandle, TextHandle, Tone, Vec2, ViewBox } from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import { SceneApiError } from '../../scene/errors';
import { fmt } from '../../scene/format';
import type { VNode } from '../../scene/graph';
import { nodeOf, TONES, type StageHandle } from '../../scene/handles';
import { binCounts, boxStats, niceRange, niceStep, regression, tickText, ticks, valueText, type BoxStats, type NiceRange } from './scale';

export const CHART_KINDS: readonly ChartKind[] = ['bar', 'line', 'area', 'stacked', 'pie', 'histogram', 'box', 'scatter'];
export const DEFAULT_CHART_VIEWBOX: ViewBox = [0, 0, 600, 380];
/** Series and slices take these in turn: distinct in light and dark themes. */
export const SERIES_TONES: readonly Tone[] = ['b', 'lit', 'c', 'a', 'mid', 'hi', 'lo'];

const MAX_SERIES = 12;
const MAX_CATEGORIES = 60;
const MAX_BARS = 480;
const MAX_BINS = 100;
const MAX_SAMPLES = 20_000;
/** Scatter points drawn as SVG circles; more go to a canvas layer. */
const CIRCLE_POINTS = 400;
const MAX_POINTS = 2000;
const MAX_OUTLIERS = 40;
const MAX_RULES = 8;
const TICK_POOL = 12;
const DIM = 0.3;
/** Average width of a 12px label character, for spacing category names. */
const CHAR_WIDTH = 6.4;

type PointsData = ReadonlyArray<Vec2> | (() => ReadonlyArray<Vec2>);

interface SeriesRecord {
  readonly name: string;
  /** Made with points(): [x, y] pairs. */
  readonly points: boolean;
  data: ChartData | PointsData;
  readonly group: Handle;
  readonly node: VNode;
  readonly printValues: boolean;
  readonly trend: boolean;
  readonly bars: Handle[];
  readonly labels: TextHandle[];
  readonly marks: Handle[];
  line: PathHandle | null;
  area: PathHandle | null;
  box: { readonly rect: Handle; readonly median: Handle; readonly whiskers: PathHandle } | null;
  trendLine: PathHandle | null;
  ring: Handle | null;
  dots: Dots | null;
  readonly slices: PathHandle[];
  readonly sliceLabels: TextHandle[];
  readonly sliceNames: TextHandle[];
}

interface RuleRecord {
  readonly value: number | (() => number);
  readonly line: Handle;
  readonly text: TextHandle;
  readonly label: string | null;
}

/** Somewhere the pointer can rest to read a value. */
type Hit =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly text: string }
  | { readonly kind: 'point'; readonly x: number; readonly y: number; readonly text: string }
  | { readonly kind: 'slice'; readonly cx: number; readonly cy: number; readonly r: number; readonly a0: number; readonly a1: number; readonly text: string };

interface Axis {
  readonly grid: Handle[];
  readonly labels: TextHandle[];
  readonly baseline: Handle;
  readonly side: Handle;
  readonly xTicks: Handle[];
  readonly xLabels: TextHandle[];
  readonly yName: TextHandle | null;
  readonly xName: TextHandle | null;
}

function fail(message: string): never {
  throw new SceneApiError(message);
}

function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && TONES.has(value);
}

function checkRange(value: unknown, name: string): readonly [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === 'number' && Number.isFinite(v)) || !(value[0] < value[1])) {
    fail(`chart: ${name} must be [low, high] with low below high`);
  }
  return [value[0] as number, value[1] as number];
}

function checkText(value: unknown, name: string, max = 60): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) fail(`chart: ${name} must be text of at most ${max} characters`);
  return value;
}

/** Checks a chart's options and returns its view box (the kit's layout step). */
export function chartLayout(options: unknown): { readonly viewBox: ViewBox } {
  const o = options as ChartOptions;
  const kind = o.kind ?? 'bar';
  if (!CHART_KINDS.includes(kind)) fail(`Unknown chart kind "${String(kind)}"; use ${CHART_KINDS.join(', ')}`);
  const viewBox = o.viewBox ?? DEFAULT_CHART_VIEWBOX;
  if (!Array.isArray(viewBox) || viewBox.length !== 4 || !viewBox.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    fail('chart: viewBox must be four finite numbers');
  }
  if (!(viewBox[2] >= 160 && viewBox[3] >= 120)) fail('chart: the view box is too small for a chart; make it at least 160 by 120');
  if (o.categories !== undefined) {
    if (!Array.isArray(o.categories) || o.categories.length === 0 || o.categories.length > MAX_CATEGORIES) {
      fail(`chart: categories must be a list of 1 to ${MAX_CATEGORIES} names`);
    }
    for (const name of o.categories) {
      if (typeof name !== 'string' || name.trim() === '' || name.length > 40) fail('chart: each category is a name of 1 to 40 characters');
    }
    if (new Set(o.categories).size !== o.categories.length) fail('chart: two categories have the same name');
  }
  checkRange(o.range, 'range');
  checkRange(o.x, 'x');
  checkText(o.xLabel, 'xLabel');
  checkText(o.yLabel, 'yLabel');
  checkText(o.unit, 'unit', 12);
  if (o.bins !== undefined && !(Number.isInteger(o.bins) && o.bins >= 1 && o.bins <= MAX_BINS)) fail(`chart: bins must be a whole number from 1 to ${MAX_BINS}`);
  if (o.legend !== undefined && typeof o.legend !== 'boolean') fail('chart: legend must be true or false');
  return { viewBox: [viewBox[0], viewBox[1], viewBox[2], viewBox[3]] };
}

export class ChartKit implements Chart {
  readonly stage: StageHandle;
  private readonly kind: ChartKind;
  private readonly options: ChartOptions;
  private readonly categories: readonly string[] | null;
  private readonly list: SeriesRecord[] = [];
  private readonly rules: RuleRecord[] = [];
  private readonly axis: Axis | null;
  private readonly tooltip: TextHandle;
  private readonly warned = new Set<string>();
  private highlighted: number | null = null;
  private pointer: Vec2 | null = null;
  private hits: Hit[] = [];
  /** The plot area inside the view box, recomputed as category names change. */
  private rect: ViewBox;

  constructor(
    private readonly ctx: KitContext,
    options: ChartOptions,
  ) {
    this.stage = ctx.stage;
    this.options = options;
    this.kind = options.kind ?? 'bar';
    this.categories = options.categories ? [...options.categories] : null;
    this.rect = this.plotRect(this.categories ?? []);
    this.axis = this.kind === 'pie' ? null : this.makeAxis();
    this.tooltip = this.stage.text(0, 0, '', { layer: 'labels', tone: 'hi' }).set({ 'font-size': 12 }).hide();
    ctx.onRedraw(() => this.draw());
    ctx.addHover((p) => {
      this.pointer = p;
    });
  }

  /** Names an element or a kit object for highlighting, steps and descriptions, as stage.part does. */
  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T {
    this.stage.part(name, item as unknown as Handle, options);
    return item;
  }

  // -------------------------------------------------------------------------
  // The Chart API
  // -------------------------------------------------------------------------

  series(name: string, data: ChartData, options: ChartSeriesOptions = {}): ChartSeries {
    if (this.kind === 'scatter') fail('A scatter chart takes points: use chart.points(name, [[x, y], ...])');
    if (this.kind === 'pie' && this.list.length > 0) fail('A pie chart has one series; its categories are the slices');
    const record = this.addSeries(name, data, false, options);
    this.checkStatic(record);
    if (this.kind === 'pie') this.prepareSlices(record);
    else if (this.list.length === 1 && (this.kind === 'bar' || this.kind === 'line' || this.kind === 'area')) this.prepareCategoryParts(record);
    return this.handleFor(record);
  }

  points(name: string, data: PointsData, options: ChartSeriesOptions = {}): ChartSeries {
    if (this.kind !== 'scatter') fail(`chart.points is for scatter charts; a ${this.kind} chart takes chart.series(name, values)`);
    const record = this.addSeries(name, data, true, options);
    this.checkStatic(record);
    return this.handleFor(record);
  }

  rule(value: number | (() => number), options: { readonly label?: string; readonly tone?: Tone; readonly dashed?: boolean } = {}): Handle {
    if (this.kind === 'pie') fail('A pie chart has no value axis for a rule');
    if (typeof value !== 'function' && !(typeof value === 'number' && Number.isFinite(value))) fail('chart.rule needs a finite number or a function returning one');
    if (this.rules.length >= MAX_RULES) fail(`A chart has at most ${MAX_RULES} rules`);
    const tone = options.tone ?? 'hi';
    if (!isTone(tone)) fail(`Unknown tone "${String(tone)}"`);
    const label = checkText(options.label, 'rule label') ?? null;
    const line = this.stage.line(0, 0, 0, 0, { layer: 'front', tone, dashed: options.dashed ?? true });
    const text = this.stage.text(0, 0, '', { layer: 'labels', tone }).set({ 'font-size': 12, 'text-anchor': 'end' });
    this.rules.push({ value, line, text, label });
    return line;
  }

  highlight(index: number | null): void {
    if (index !== null && !(Number.isInteger(index) && index >= 0)) fail('chart.highlight needs a category index (0 is the first) or null');
    this.highlighted = index;
  }

  // -------------------------------------------------------------------------
  // Series
  // -------------------------------------------------------------------------

  private addSeries(name: string, data: ChartData | PointsData, points: boolean, options: ChartSeriesOptions): SeriesRecord {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 40) fail('A chart series needs a name of 1 to 40 characters');
    if (this.list.some((s) => s.name === name)) fail(`Chart series "${name}" is added twice`);
    if (this.list.length >= MAX_SERIES) fail(`A chart has at most ${MAX_SERIES} series`);
    const tone = options.tone ?? SERIES_TONES[this.list.length % SERIES_TONES.length]!;
    if (!isTone(tone)) fail(`Unknown tone "${String(tone)}"`);
    if (options.trend && !points) fail('trend is for scatter points');
    const group = this.stage.group({ layer: 'mid', tone });
    const node = nodeOf(group);
    const record: SeriesRecord = {
      name,
      points,
      data,
      group,
      node,
      printValues: options.values === true,
      trend: options.trend === true,
      bars: [],
      labels: [],
      marks: [],
      line: null,
      area: null,
      box: null,
      trendLine: null,
      ring: null,
      dots: null,
      slices: [],
      sliceLabels: [],
      sliceNames: [],
    };
    this.list.push(record);
    if (this.kind !== 'pie') {
      if (this.options.legend !== false) this.ctx.addLegend(node, name, true);
      // A series is a part a step or a description can name; a clash with another part keeps the first.
      this.tryPart(name, group);
    }
    return record;
  }

  private handleFor(record: SeriesRecord): ChartSeries {
    const check = () => this.checkStatic(record);
    const handle: ChartSeries = {
      name: record.name,
      set(data) {
        record.data = data as ChartData | PointsData;
        check();
        return handle;
      },
      tone(name) {
        if (!isTone(name)) fail(`Unknown tone "${String(name)}"`);
        record.group.tone(name);
        return handle;
      },
      show(visible = true) {
        record.group.show(visible);
        return handle;
      },
      hide() {
        record.group.hide();
        return handle;
      },
    };
    return handle;
  }

  /** Static data is checked when it is given, so mistakes show at the line that made them. */
  private checkStatic(record: SeriesRecord): void {
    if (typeof record.data === 'function') return;
    if (record.points) this.readPoints(record);
    else this.readValues(record);
  }

  private tryPart(name: string, handle: Handle): void {
    try {
      this.stage.part(name, handle);
    } catch {
      // The name is already a part; the chart still draws.
    }
  }

  private readValues(record: SeriesRecord): number[] {
    let data: unknown = record.data;
    if (typeof data === 'function') data = (data as () => unknown)();
    if (!Array.isArray(data)) fail(`Chart series "${record.name}" needs a list of numbers`);
    const samples = this.kind === 'histogram' || this.kind === 'box';
    const limit = samples ? MAX_SAMPLES : MAX_CATEGORIES;
    if (data.length > limit) fail(`Chart series "${record.name}" has ${data.length} values; at most ${limit}`);
    if (data.length === 0 && typeof record.data !== 'function') fail(`Chart series "${record.name}" has no values`);
    const out: number[] = [];
    for (const v of data) {
      if (typeof v !== 'number') fail(`Chart series "${record.name}" must hold numbers only`);
      if (!Number.isFinite(v)) this.warnOnce(`series-${record.name}`, `Chart series "${record.name}" has a value that is not a finite number; it is left out`);
      out.push(v);
    }
    if (!samples && this.categories && out.length !== this.categories.length) {
      fail(`Chart series "${record.name}" has ${out.length} values but the chart has ${this.categories.length} categories`);
    }
    if (this.kind === 'pie' && out.some((v) => v < 0)) fail(`Pie slices cannot be negative (series "${record.name}")`);
    return out;
  }

  private readPoints(record: SeriesRecord): Vec2[] {
    let data: unknown = record.data;
    if (typeof data === 'function') data = (data as () => unknown)();
    if (!Array.isArray(data)) fail(`Scatter series "${record.name}" needs a list of [x, y] points`);
    if (data.length > MAX_POINTS) fail(`Scatter series "${record.name}" has ${data.length} points; at most ${MAX_POINTS}`);
    if (data.length === 0 && typeof record.data !== 'function') fail(`Scatter series "${record.name}" has no points`);
    const out: Vec2[] = [];
    for (const p of data) {
      if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
        fail(`Scatter series "${record.name}" must hold [x, y] pairs of numbers`);
      }
      if (Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]);
      else this.warnOnce(`points-${record.name}`, `Scatter series "${record.name}" has a point that is not finite; it is left out`);
    }
    return out;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.ctx.warn(message);
  }

  /** Bars or dots for each category made up front, so steps can focus a category by name. */
  private prepareCategoryParts(record: SeriesRecord): void {
    const names = this.categories;
    if (!names || typeof record.data === 'function') return;
    for (let i = 0; i < names.length; i++) {
      const element = this.kind === 'bar' ? this.bar(record, i) : this.mark(record, i);
      this.tryPart(names[i]!, element);
    }
  }

  /** A pie's slices: each a part and a legend entry the learner can hide. */
  private prepareSlices(record: SeriesRecord): void {
    const count = this.categories?.length ?? (typeof record.data === 'function' ? 0 : (record.data as readonly number[]).length);
    for (let i = 0; i < count; i++) {
      const slice = this.slice(record, i, count);
      const name = this.categoryName(i);
      if (this.options.legend !== false) this.ctx.addLegend(nodeOf(slice), name, true);
      this.tryPart(name, slice);
    }
  }

  // -------------------------------------------------------------------------
  // Element pools: made once, then moved
  // -------------------------------------------------------------------------

  private bar(record: SeriesRecord, i: number): Handle {
    while (record.bars.length <= i) record.bars.push(this.stage.rect(0, 0, 0, 0, { parent: record.group }).hide());
    return record.bars[i]!;
  }

  private label(record: SeriesRecord, i: number): TextHandle {
    while (record.labels.length <= i) {
      record.labels.push(this.stage.text(0, 0, '', { parent: record.group }).set({ 'font-size': 12, 'text-anchor': 'middle' }).hide());
    }
    return record.labels[i]!;
  }

  private mark(record: SeriesRecord, i: number): Handle {
    while (record.marks.length <= i) record.marks.push(this.stage.circle(0, 0, 3.5, { parent: record.group }).hide());
    return record.marks[i]!;
  }

  private slice(record: SeriesRecord, i: number, count: number): PathHandle {
    while (record.slices.length <= i) {
      const index = record.slices.length;
      let tone = SERIES_TONES[index % SERIES_TONES.length]!;
      // The last slice touches the first: never give them one colour.
      if (index === count - 1 && index > 0 && tone === SERIES_TONES[0] && count % SERIES_TONES.length === 1) tone = SERIES_TONES[1]!;
      record.slices.push(this.stage.path('', { parent: record.group, tone, fill: true }));
      record.sliceLabels.push(this.stage.text(0, 0, '', { layer: 'labels' }).set({ 'font-size': 12, 'text-anchor': 'middle' }).hide());
      record.sliceNames.push(this.stage.text(0, 0, '', { layer: 'labels' }).set({ 'font-size': 12 }).hide());
    }
    return record.slices[i]!;
  }

  private makeAxis(): Axis {
    const stage = this.stage;
    const grid: Handle[] = [];
    const labels: TextHandle[] = [];
    const xTicks: Handle[] = [];
    for (let i = 0; i < TICK_POOL; i++) {
      grid.push(stage.line(0, 0, 0, 0, { layer: 'back', tone: 'faint' }).hide());
      labels.push(stage.text(0, 0, '', { layer: 'back' }).set({ 'font-size': 12, 'text-anchor': 'end' }).hide());
      xTicks.push(stage.line(0, 0, 0, 0, { layer: 'back', tone: 'mid' }).hide());
    }
    const yName = this.options.yLabel || this.options.unit ? stage.text(0, 0, '', { layer: 'back' }).set({ 'font-size': 12, 'text-anchor': 'middle' }) : null;
    const xName = this.options.xLabel ? stage.text(0, 0, this.options.xLabel, { layer: 'back' }).set({ 'font-size': 12, 'text-anchor': 'middle' }) : null;
    return {
      grid,
      labels,
      baseline: stage.line(0, 0, 0, 0, { layer: 'back', tone: 'mid' }),
      side: stage.line(0, 0, 0, 0, { layer: 'back', tone: 'mid' }),
      xTicks,
      xLabels: [],
      yName,
      xName,
    };
  }

  private xLabel(i: number): TextHandle {
    const axis = this.axis!;
    while (axis.xLabels.length <= i) axis.xLabels.push(this.stage.text(0, 0, '', { layer: 'back' }).set({ 'font-size': 12, 'text-anchor': 'middle' }).hide());
    return axis.xLabels[i]!;
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  private categoryName(i: number): string {
    return this.categories?.[i] ?? String(i + 1);
  }

  /** How category names fit under their columns: level, slanted, or every k-th. */
  private labelFit(names: readonly string[], width: number): { readonly slant: boolean; readonly every: number } {
    if (names.length === 0) return { slant: false, every: 1 };
    const band = width / names.length;
    const longest = Math.max(...names.map((n) => n.length)) * CHAR_WIDTH;
    if (longest <= band - 4) return { slant: false, every: 1 };
    // Slanted names need about one line height of room each.
    return { slant: true, every: Math.max(1, Math.ceil(15 / band)) };
  }

  private plotRect(names: readonly string[]): ViewBox {
    const [x, y, width, height] = this.stage.viewBox;
    if (this.kind === 'pie') return [x + 16, y + 16, width - 32, height - 32];
    const left = 54 + (this.options.yLabel || this.options.unit ? 18 : 0);
    const right = 18;
    const plotWidth = width - left - right;
    const slanted = names.length > 0 && this.labelFit(names, plotWidth).slant;
    const longest = slanted ? Math.min(90, Math.max(...names.map((n) => n.length)) * CHAR_WIDTH * 0.6 + 6) : 0;
    const bottom = 30 + longest + (this.options.xLabel ? 20 : 0);
    const top = 16;
    return [x + left, y + top, plotWidth, Math.max(40, height - top - bottom)];
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private visible(): SeriesRecord[] {
    return this.list.filter((s) => !s.node.hidden);
  }

  private draw(): void {
    this.hits = [];
    switch (this.kind) {
      case 'bar':
      case 'stacked':
      case 'line':
      case 'area':
        this.drawCategories();
        break;
      case 'pie':
        this.drawPie();
        break;
      case 'histogram':
        this.drawHistogram();
        break;
      case 'box':
        this.drawBoxes();
        break;
      case 'scatter':
        this.drawScatter();
        break;
    }
    this.drawTooltip();
  }

  private valueRange(min: number, max: number, fromZero: boolean): NiceRange {
    const fixed = this.options.range;
    if (fixed) return { lo: fixed[0], hi: fixed[1], step: niceStep(fixed[1] - fixed[0]) };
    return niceRange(min, max, fromZero);
  }

  /** Stage y of a value, kept inside the plot. */
  private yOf(range: NiceRange, value: number): number {
    const [, top, , height] = this.rect;
    const k = (range.hi - value) / (range.hi - range.lo);
    return top + Math.min(1, Math.max(0, k)) * height;
  }

  private xOf(range: NiceRange, value: number): number {
    const [left, , width] = this.rect;
    const k = (value - range.lo) / (range.hi - range.lo);
    return left + Math.min(1, Math.max(0, k)) * width;
  }

  private drawValueAxis(range: NiceRange, baseline: number): void {
    const axis = this.axis!;
    const [left, top, width, height] = this.rect;
    const values = ticks(range.lo, range.hi, range.step).slice(0, TICK_POOL);
    axis.grid.forEach((line, i) => {
      const t = values[i];
      if (t === undefined) line.hide();
      else line.set({ x1: left, y1: this.yOf(range, t), x2: left + width, y2: this.yOf(range, t) }).show();
    });
    axis.labels.forEach((label, i) => {
      const t = values[i];
      if (t === undefined) label.hide();
      else label.set({ x: left - 6, y: this.yOf(range, t) + 4 }).text(tickText(t, range.step)).show();
    });
    const y = this.yOf(range, baseline);
    axis.baseline.set({ x1: left, y1: y, x2: left + width, y2: y });
    axis.side.set({ x1: left, y1: top, x2: left, y2: top + height });
    if (axis.yName) {
      const name = [this.options.yLabel, this.options.unit ? `(${this.options.unit})` : ''].filter(Boolean).join(' ');
      const x = left - 44;
      axis.yName.text(name).set({ x, y: top + height / 2 }).rotate(-90, { about: [x, top + height / 2] });
    }
  }

  private drawCategoryAxis(names: readonly string[]): void {
    const axis = this.axis!;
    const [left, top, width, height] = this.rect;
    const bottom = top + height;
    const band = names.length > 0 ? width / names.length : width;
    const fit = this.labelFit(names, width);
    names.forEach((name, i) => {
      const label = this.xLabel(i);
      const x = left + band * (i + 0.5);
      if (i % fit.every !== 0) {
        label.hide();
        return;
      }
      label.text(name).show();
      if (fit.slant) label.set({ x, y: bottom + 14, 'text-anchor': 'end' }).rotate(-35, { about: [x, bottom + 14] });
      else label.set({ x, y: bottom + 18, 'text-anchor': 'middle' }).rotate(0);
      label.set({ opacity: this.dimmed(i) ? DIM : 1 });
    });
    for (let i = names.length; i < axis.xLabels.length; i++) axis.xLabels[i]!.hide();
    axis.xTicks.forEach((tick) => tick.hide());
    this.placeXName();
  }

  private drawNumericAxis(range: NiceRange): void {
    const axis = this.axis!;
    const [, top, , height] = this.rect;
    const bottom = top + height;
    const values = ticks(range.lo, range.hi, range.step).slice(0, TICK_POOL);
    for (let i = 0; i < Math.max(values.length, axis.xLabels.length); i++) {
      const t = values[i];
      const label = i < values.length ? this.xLabel(i) : axis.xLabels[i]!;
      if (t === undefined) label.hide();
      else label.set({ x: this.xOf(range, t), y: bottom + 18, 'text-anchor': 'middle', opacity: 1 }).rotate(0).text(tickText(t, range.step)).show();
    }
    axis.xTicks.forEach((tick, i) => {
      const t = values[i];
      if (t === undefined) tick.hide();
      else tick.set({ x1: this.xOf(range, t), y1: bottom, x2: this.xOf(range, t), y2: bottom + 5 }).show();
    });
    this.placeXName();
  }

  /** The x axis name sits along the bottom edge, below the category names. */
  private placeXName(): void {
    const axis = this.axis!;
    if (!axis.xName) return;
    const [left, , width] = this.rect;
    const [, vy, , vh] = this.stage.viewBox;
    axis.xName.set({ x: left + width / 2, y: vy + vh - 6 });
  }

  private dimmed(i: number): boolean {
    return this.highlighted !== null && this.highlighted !== i;
  }

  // Bars, stacks, lines and areas: one value per category.
  private drawCategories(): void {
    const visible = this.visible();
    const data = new Map<SeriesRecord, number[]>();
    for (const s of this.list) data.set(s, this.readValues(s));
    const count = this.categories?.length ?? Math.max(0, ...this.list.map((s) => data.get(s)!.length));
    const names = Array.from({ length: count }, (_, i) => this.categoryName(i));
    if (count * Math.max(1, this.list.length) > MAX_BARS && (this.kind === 'bar' || this.kind === 'stacked')) {
      fail(`A bar chart draws at most ${MAX_BARS} bars; this one has ${count * this.list.length}`);
    }
    this.rect = this.plotRect(names);
    // The value range covers what is shown: stacked sums, or every visible value.
    let min = Infinity;
    let max = -Infinity;
    if (this.kind === 'stacked') {
      for (let i = 0; i < count; i++) {
        let up = 0;
        let down = 0;
        for (const s of visible) {
          const v = data.get(s)![i];
          if (v === undefined || !Number.isFinite(v)) continue;
          if (v >= 0) up += v;
          else down += v;
        }
        min = Math.min(min, down);
        max = Math.max(max, up);
      }
    } else {
      for (const s of visible) {
        for (const v of data.get(s)!) {
          if (!Number.isFinite(v)) continue;
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 1;
    }
    const range = this.valueRange(min, max, this.kind !== 'line');
    const zero = Math.min(range.hi, Math.max(range.lo, 0));
    this.drawValueAxis(range, zero);
    this.drawCategoryAxis(names);
    const [left, top, width, height] = this.rect;
    const band = count > 0 ? width / count : width;

    if (this.kind === 'bar') {
      const group = band * 0.72;
      const each = visible.length > 0 ? group / visible.length : group;
      for (const s of this.list) {
        const values = data.get(s)!;
        const slot = visible.indexOf(s);
        for (let i = 0; i < Math.max(count, s.bars.length); i++) {
          const bar = this.bar(s, i);
          const v = values[i];
          if (slot < 0 || i >= count || v === undefined || !Number.isFinite(v)) {
            bar.hide();
            if (s.labels[i]) s.labels[i]!.hide();
            continue;
          }
          const x = left + band * i + (band - group) / 2 + slot * each + each * 0.06;
          const w = each * 0.88;
          const y0 = this.yOf(range, zero);
          const y1 = this.yOf(range, v);
          bar.set({ x, y: Math.min(y0, y1), width: w, height: Math.abs(y1 - y0), opacity: this.dimmed(i) ? DIM : 1 }).show();
          this.hits.push({ kind: 'rect', x, y: Math.min(y0, y1), w, h: Math.max(4, Math.abs(y1 - y0)), text: this.describe(names[i]!, s, v) });
          this.printValue(s, i, x + w / 2, v >= 0 ? y1 - 5 : y1 + 13, v);
        }
      }
    } else if (this.kind === 'stacked') {
      const w = band * 0.62;
      const up: number[] = new Array<number>(count).fill(0);
      const down: number[] = new Array<number>(count).fill(0);
      for (const s of this.list) {
        const values = data.get(s)!;
        const shown = visible.includes(s);
        for (let i = 0; i < Math.max(count, s.bars.length); i++) {
          const bar = this.bar(s, i);
          const v = values[i];
          if (!shown || i >= count || v === undefined || !Number.isFinite(v)) {
            bar.hide();
            if (s.labels[i]) s.labels[i]!.hide();
            continue;
          }
          const from = v >= 0 ? up[i]! : down[i]!;
          const to = from + v;
          if (v >= 0) up[i] = to;
          else down[i] = to;
          const x = left + band * i + (band - w) / 2;
          const y0 = this.yOf(range, from);
          const y1 = this.yOf(range, to);
          bar.set({ x, y: Math.min(y0, y1), width: w, height: Math.abs(y1 - y0), opacity: this.dimmed(i) ? DIM : 1 }).show();
          this.hits.push({ kind: 'rect', x, y: Math.min(y0, y1), w, h: Math.max(3, Math.abs(y1 - y0)), text: this.describe(names[i]!, s, v) });
          this.printValue(s, i, x + w / 2, (y0 + y1) / 2 + 4, v);
        }
      }
    } else {
      // Lines and areas pass through the middle of each category.
      const baseline = this.yOf(range, zero);
      for (const s of this.list) {
        const values = data.get(s)!;
        const shown = visible.includes(s);
        const points: Array<Vec2 | null> = [];
        for (let i = 0; i < Math.max(count, s.marks.length); i++) {
          const v = values[i];
          const dot = this.mark(s, i);
          if (!shown || i >= count || v === undefined || !Number.isFinite(v)) {
            dot.hide();
            if (s.labels[i]) s.labels[i]!.hide();
            if (i < count) points.push(null);
            continue;
          }
          const x = left + band * (i + 0.5);
          const y = this.yOf(range, v);
          points.push([x, y]);
          dot.set({ cx: x, cy: y, r: this.highlighted === i ? 5.5 : 3.5, opacity: this.dimmed(i) ? DIM : 1 }).show();
          this.printValue(s, i, x, y - 9, v);
        }
        s.line ??= this.stage.path('', { parent: s.group });
        s.line.d(linePath(points));
        if (this.kind === 'area') {
          s.area ??= this.stage.path('', { parent: s.group, fill: true }).set({ 'fill-opacity': 0.25 });
          s.area.d(areaPath(points, baseline));
        }
      }
      // Reading a line chart: every series' value in the column under the pointer.
      for (let i = 0; i < count; i++) {
        const parts = visible.map((s) => `${s.name} ${this.valueWithUnit(data.get(s)![i] ?? Number.NaN)}`);
        this.hits.push({ kind: 'rect', x: left + band * i, y: top, w: band, h: height, text: `${names[i]}: ${parts.join(', ')}` });
      }
    }
    this.drawRules(range);
  }

  private printValue(s: SeriesRecord, i: number, x: number, y: number, v: number): void {
    if (!s.printValues) return;
    this.label(s, i)
      .set({ x, y, opacity: this.dimmed(i) ? DIM : 1 })
      .text(valueText(v))
      .show();
  }

  private valueWithUnit(v: number): string {
    return `${valueText(v)}${this.options.unit ? ` ${this.options.unit}` : ''}`;
  }

  private describe(category: string, s: SeriesRecord, v: number): string {
    return this.list.length > 1 ? `${category} · ${s.name}: ${this.valueWithUnit(v)}` : `${category}: ${this.valueWithUnit(v)}`;
  }

  private drawRules(range: NiceRange): void {
    const [left, , width] = this.rect;
    for (const rule of this.rules) {
      const value = typeof rule.value === 'function' ? rule.value() : rule.value;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        rule.line.hide();
        rule.text.hide();
        continue;
      }
      const y = this.yOf(range, value);
      rule.line.set({ x1: left, y1: y, x2: left + width, y2: y }).show();
      rule.text
        .set({ x: left + width - 2, y: y - 5 })
        .text(rule.label ?? this.valueWithUnit(value))
        .show();
    }
  }

  private drawPie(): void {
    const s = this.list[0];
    if (!s) return;
    const values = this.readValues(s);
    const count = this.categories?.length ?? values.length;
    for (let i = s.slices.length; i < count; i++) {
      // Slices for data that grew after the start.
      const slice = this.slice(s, i, count);
      if (this.options.legend !== false) this.ctx.addLegend(nodeOf(slice), this.categoryName(i), true);
    }
    const [x, y, width, height] = this.rect;
    const cx = x + width / 2;
    const cy = y + height / 2;
    const r = Math.max(10, Math.min(width, height) / 2 - 26);
    const shown = (i: number) => i < count && !nodeOf(s.slices[i]!).hidden && Number.isFinite(values[i] ?? Number.NaN) && values[i]! > 0;
    let total = 0;
    for (let i = 0; i < count; i++) if (shown(i)) total += values[i]!;
    let angle = -Math.PI / 2;
    for (let i = 0; i < s.slices.length; i++) {
      const slice = s.slices[i]!;
      const inner = s.sliceLabels[i]!;
      const outer = s.sliceNames[i]!;
      if (!shown(i) || total <= 0) {
        slice.d('');
        inner.hide();
        outer.hide();
        continue;
      }
      const fraction = values[i]! / total;
      const a0 = angle;
      const a1 = angle + fraction * Math.PI * 2;
      angle = a1;
      slice.d(slicePath(cx, cy, r, a0, a1)).set({ opacity: this.dimmed(i) ? DIM : 1 });
      const mid = (a0 + a1) / 2;
      const percent = `${Math.round(fraction * 1000) / 10}%`;
      const name = this.categoryName(i);
      if (a1 - a0 > 0.3) {
        inner.set({ x: cx + Math.cos(mid) * r * 0.62, y: cy + Math.sin(mid) * r * 0.62 + 4 }).text(percent).show();
      } else inner.hide();
      if (a1 - a0 > 0.12) {
        const right = Math.cos(mid) >= 0;
        outer
          .set({ x: cx + Math.cos(mid) * (r + 10), y: cy + Math.sin(mid) * (r + 10) + 4, 'text-anchor': right ? 'start' : 'end', opacity: this.dimmed(i) ? DIM : 1 })
          .text(s.printValues ? `${name} (${valueText(values[i]!)})` : name)
          .show();
      } else outer.hide();
      this.hits.push({ kind: 'slice', cx, cy, r, a0, a1, text: `${name}: ${this.valueWithUnit(values[i]!)} (${percent})` });
    }
  }

  private drawHistogram(): void {
    const visible = this.visible();
    const data = new Map<SeriesRecord, number[]>();
    for (const s of this.list) data.set(s, this.readValues(s).filter(Number.isFinite));
    const bins = this.options.bins ?? 10;
    // The binned range: as given, or the data's own extent.
    let lo = this.options.x?.[0] ?? Infinity;
    let hi = this.options.x?.[1] ?? -Infinity;
    if (!this.options.x) {
      for (const s of visible) {
        for (const v of data.get(s)!) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      if (lo === Infinity) {
        lo = 0;
        hi = 1;
      } else if (lo === hi) {
        lo -= 0.5;
        hi += 0.5;
      }
    }
    const counts = new Map<SeriesRecord, number[]>();
    let most = 0;
    for (const s of this.list) {
      const c = binCounts(data.get(s)!, lo, hi, bins);
      counts.set(s, c);
      if (visible.includes(s)) most = Math.max(most, ...c);
    }
    this.rect = this.plotRect([]);
    const range = this.valueRange(0, Math.max(1, most), true);
    this.drawValueAxis(range, 0);
    const xRange: NiceRange = { lo, hi, step: niceStep(hi - lo, 6) };
    this.drawNumericAxis(xRange);
    const width = (hi - lo) / bins;
    const overlaid = visible.length > 1;
    for (const s of this.list) {
      const c = counts.get(s)!;
      const shown = visible.includes(s);
      for (let i = 0; i < Math.max(bins, s.bars.length); i++) {
        const bar = this.bar(s, i);
        if (!shown || i >= bins) {
          bar.hide();
          if (s.labels[i]) s.labels[i]!.hide();
          continue;
        }
        const a = lo + width * i;
        const x0 = this.xOf(xRange, a);
        const x1 = this.xOf(xRange, a + width);
        const y0 = this.yOf(range, 0);
        const y1 = this.yOf(range, c[i]!);
        bar
          .set({ x: x0 + 0.5, y: y1, width: Math.max(0, x1 - x0 - 1), height: y0 - y1, 'fill-opacity': overlaid ? 0.55 : 1, opacity: this.dimmed(i) ? DIM : 1 })
          .show();
        this.hits.push({
          kind: 'rect',
          x: x0,
          y: Math.min(y1, y0 - 4),
          w: x1 - x0,
          h: Math.max(4, y0 - y1),
          text: `${valueText(a)} to ${valueText(a + width)}${this.list.length > 1 ? ` · ${s.name}` : ''}: ${c[i]}`,
        });
        if (s.printValues && c[i]! > 0) this.printValue(s, i, (x0 + x1) / 2, y1 - 5, c[i]!);
        else if (s.labels[i]) s.labels[i]!.hide();
      }
    }
    this.drawRules(range);
  }

  private drawBoxes(): void {
    const visible = this.visible();
    const stats = new Map<SeriesRecord, BoxStats | null>();
    let min = Infinity;
    let max = -Infinity;
    for (const s of this.list) {
      const b = boxStats(this.readValues(s));
      stats.set(s, b);
      if (b && visible.includes(s)) {
        min = Math.min(min, b.low, ...b.outliers);
        max = Math.max(max, b.high, ...b.outliers);
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 1;
    }
    const names = this.list.map((s) => s.name);
    this.rect = this.plotRect(names);
    const range = this.valueRange(min, max, false);
    this.drawValueAxis(range, range.lo);
    this.drawCategoryAxis(names);
    const [left, , width] = this.rect;
    const band = names.length > 0 ? width / names.length : width;
    this.list.forEach((s, i) => {
      const b = stats.get(s);
      s.box ??= {
        rect: this.stage.rect(0, 0, 0, 0, { parent: s.group }).set({ 'fill-opacity': 0.3 }),
        median: this.stage.line(0, 0, 0, 0, { parent: s.group }).set({ 'stroke-width': 3 }),
        whiskers: this.stage.path('', { parent: s.group }),
      };
      const box = s.box;
      if (!b || !visible.includes(s)) {
        box.rect.hide();
        box.median.hide();
        box.whiskers.d('');
        s.marks.forEach((m) => m.hide());
        return;
      }
      const cx = left + band * (i + 0.5);
      const w = Math.min(80, band * 0.5);
      const yq1 = this.yOf(range, b.q1);
      const yq3 = this.yOf(range, b.q3);
      const ym = this.yOf(range, b.median);
      const opacity = this.dimmed(i) ? DIM : 1;
      box.rect.set({ x: cx - w / 2, y: yq3, width: w, height: Math.max(1, yq1 - yq3), opacity }).show();
      box.median.set({ x1: cx - w / 2, y1: ym, x2: cx + w / 2, y2: ym, opacity }).show();
      const cap = w / 4;
      const ylo = this.yOf(range, b.low);
      const yhi = this.yOf(range, b.high);
      box.whiskers
        .d(
          `M${fmt(cx)} ${fmt(yq3)}V${fmt(yhi)}M${fmt(cx - cap)} ${fmt(yhi)}H${fmt(cx + cap)}` +
            `M${fmt(cx)} ${fmt(yq1)}V${fmt(ylo)}M${fmt(cx - cap)} ${fmt(ylo)}H${fmt(cx + cap)}`,
        )
        .set({ opacity });
      const outliers = b.outliers.slice(0, MAX_OUTLIERS);
      if (b.outliers.length > MAX_OUTLIERS) this.warnOnce(`outliers-${s.name}`, `Box "${s.name}" has ${b.outliers.length} outliers; the first ${MAX_OUTLIERS} are drawn`);
      for (let k = 0; k < Math.max(outliers.length, s.marks.length); k++) {
        const v = outliers[k];
        const dot = this.mark(s, k);
        if (v === undefined) dot.hide();
        else dot.set({ cx, cy: this.yOf(range, v), r: 3, opacity }).show();
      }
      this.hits.push({
        kind: 'rect',
        x: cx - w / 2,
        y: yhi,
        w,
        h: Math.max(4, ylo - yhi),
        text: `${s.name}: median ${this.valueWithUnit(b.median)}, quartiles ${valueText(b.q1)} to ${valueText(b.q3)}, n = ${b.n}`,
      });
      if (s.printValues) this.printValue(s, 0, cx + w / 2 + 4, ym + 4, b.median);
      if (s.labels[0]) s.labels[0].set({ 'text-anchor': 'start' });
    });
    this.drawRules(range);
  }

  private drawScatter(): void {
    const visible = this.visible();
    const data = new Map<SeriesRecord, Vec2[]>();
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const s of this.list) {
      const points = this.readPoints(s);
      data.set(s, points);
      if (!visible.includes(s)) continue;
      for (const [x, y] of points) {
        xmin = Math.min(xmin, x);
        xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
      }
    }
    if (xmin === Infinity) {
      xmin = ymin = 0;
      xmax = ymax = 1;
    }
    this.rect = this.plotRect([]);
    const yRange = this.valueRange(ymin, ymax, false);
    const fixedX = this.options.x;
    const xRange: NiceRange = fixedX ? { lo: fixedX[0], hi: fixedX[1], step: niceStep(fixedX[1] - fixedX[0], 6) } : niceRange(xmin, xmax, false, 6);
    this.drawValueAxis(yRange, yRange.lo);
    this.drawNumericAxis(xRange);
    for (const s of this.list) {
      const points = data.get(s)!;
      const shown = visible.includes(s);
      const canvas = points.length > CIRCLE_POINTS;
      if (canvas) {
        s.dots ??= this.stage.dots({ tone: s.node.tone ?? 'b', r: 2.5, layer: 'front' });
        s.dots.tone(s.node.tone ?? 'b');
        s.dots.set(shown ? points.map(([x, y]) => [this.xOf(xRange, x), this.yOf(yRange, y)] as Vec2) : []);
      } else s.dots?.set([]);
      for (let i = 0; i < Math.max(canvas ? 0 : points.length, s.marks.length); i++) {
        const p = canvas ? undefined : points[i];
        const dot = this.mark(s, i);
        if (!shown || p === undefined) {
          dot.hide();
          if (s.labels[i]) s.labels[i]!.hide();
          continue;
        }
        const x = this.xOf(xRange, p[0]);
        const y = this.yOf(yRange, p[1]);
        dot.set({ cx: x, cy: y, r: 3.5, opacity: this.dimmed(i) ? DIM : 1 }).show();
        if (s.printValues && i < 30) this.printValue(s, i, x, y - 8, p[1]);
      }
      if (shown) {
        for (const [px, py] of points.slice(0, MAX_POINTS)) {
          this.hits.push({ kind: 'point', x: this.xOf(xRange, px), y: this.yOf(yRange, py), text: `${this.list.length > 1 ? `${s.name}: ` : ''}(${valueText(px)}, ${valueText(py)})` });
        }
      }
      // The highlighted point gets a ring, on canvas or not.
      const target = this.highlighted !== null ? points[this.highlighted] : undefined;
      if (target && shown) {
        s.ring ??= this.stage.circle(0, 0, 8, { parent: s.group }).set({ 'fill-opacity': 0.2 });
        s.ring.set({ cx: this.xOf(xRange, target[0]), cy: this.yOf(yRange, target[1]) }).show();
      } else s.ring?.hide();
      if (s.trend) {
        s.trendLine ??= this.stage.path('', { parent: s.group, dashed: true });
        const fit = shown ? regression(points) : null;
        if (fit) {
          const x0 = Math.max(xRange.lo, Math.min(...points.map((p) => p[0])));
          const x1 = Math.min(xRange.hi, Math.max(...points.map((p) => p[0])));
          s.trendLine.d(`M${fmt(this.xOf(xRange, x0))} ${fmt(this.yOf(yRange, fit.intercept + fit.slope * x0))}L${fmt(this.xOf(xRange, x1))} ${fmt(this.yOf(yRange, fit.intercept + fit.slope * x1))}`);
          this.hits.push({
            kind: 'point',
            x: this.xOf(xRange, (x0 + x1) / 2),
            y: this.yOf(yRange, fit.intercept + (fit.slope * (x0 + x1)) / 2),
            text: `${s.name} trend: y = ${valueText(fit.slope)}x ${fit.intercept < 0 ? '−' : '+'} ${valueText(Math.abs(fit.intercept))}, r = ${valueText(fit.r)}`,
          });
        } else s.trendLine.d('');
      }
    }
    this.drawRules(yRange);
  }

  /** The value under the pointer, beside it. */
  private drawTooltip(): void {
    const p = this.pointer;
    const hit = p ? this.hitAt(p[0], p[1]) : null;
    if (!p || !hit) {
      this.tooltip.hide();
      return;
    }
    const [vx, vy, vw] = this.stage.viewBox;
    const flip = p[0] > vx + vw - 170;
    this.tooltip
      .set({ x: p[0] + (flip ? -12 : 12), y: Math.max(vy + 14, p[1] - 12), 'text-anchor': flip ? 'end' : 'start' })
      .text(hit.text)
      .show();
  }

  private hitAt(x: number, y: number): Hit | null {
    let best: Hit | null = null;
    let nearest = 14;
    for (const hit of this.hits) {
      if (hit.kind === 'rect') {
        if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h) return hit;
      } else if (hit.kind === 'point') {
        const d = Math.hypot(x - hit.x, y - hit.y);
        if (d < nearest) {
          nearest = d;
          best = hit;
        }
      } else {
        const d = Math.hypot(x - hit.cx, y - hit.cy);
        if (d > hit.r) continue;
        // Angles measured like the slices: from 12 o'clock, clockwise.
        let a = Math.atan2(y - hit.cy, x - hit.cx);
        while (a < hit.a0) a += Math.PI * 2;
        if (a <= hit.a1) return hit;
      }
    }
    return best;
  }
}

/** A path through the points, broken where a value is missing. */
export function linePath(points: ReadonlyArray<Vec2 | null>): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${fmt(p[0])} ${fmt(p[1])}`;
    pen = true;
  }
  return d;
}

/** The region between the points and the baseline, one shape per unbroken run. */
export function areaPath(points: ReadonlyArray<Vec2 | null>, baseline: number): string {
  let d = '';
  let run: Vec2[] = [];
  const close = () => {
    if (run.length >= 2) {
      d += `M${fmt(run[0]![0])} ${fmt(baseline)}`;
      for (const [x, y] of run) d += `L${fmt(x)} ${fmt(y)}`;
      d += `L${fmt(run[run.length - 1]![0])} ${fmt(baseline)}Z`;
    }
    run = [];
  };
  for (const p of points) {
    if (p) run.push(p);
    else close();
  }
  close();
  return d;
}

/** A pie slice from angle a0 to a1 (radians, clockwise on screen from the right). */
export function slicePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-9) {
    // The whole pie: two half circles, since one arc cannot close on itself.
    return `M${fmt(cx + r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx - r)} ${fmt(cy)}A${fmt(r)} ${fmt(r)} 0 1 1 ${fmt(cx + r)} ${fmt(cy)}Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return (
    `M${fmt(cx)} ${fmt(cy)}L${fmt(cx + r * Math.cos(a0))} ${fmt(cy + r * Math.sin(a0))}` +
    `A${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(cx + r * Math.cos(a1))} ${fmt(cy + r * Math.sin(a1))}Z`
  );
}

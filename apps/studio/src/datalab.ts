/**
 * The data-analysis panel (statistics design 9, ui.md 4): one variable, two variables, several variables. The panel
 * holds no hidden state of its own: every control changes the lines it would write (`labLines`), the plot and the
 * tables are those lines run on a scratch copy of the figure, and **Add to figure** applies them with an `@datalab`
 * directive so opening the figure restores the panel.
 */
import { Figure, valueText } from '@incantly/kernel';
import type { CommandRegistry } from '@incantly/kernel';
import { colorAt, paintScene, sceneBounds } from '@incantly/sdk/screen';
import type { SceneItem } from '@incantly/sdk/screen';
import { Viewport } from '@incantly/sdk/screen';
import type { KernelSession } from './session';

export type Mode = 'one' | 'two' | 'several';
export type OnePlot = 'histogram' | 'boxplot' | 'dotplot' | 'nq' | 'stem' | 'bar';
export type Model = 'none' | 'line' | 'lineX' | 'poly' | 'pow' | 'exp' | 'growth' | 'log' | 'sin' | 'logistic';

export interface LabState {
  mode: Mode;
  /** One variable: the list. Two variables: a point list, or the x list (with `ySource`). */
  source: string;
  ySource: string;
  /** Several variables. */
  sources: string[];
  plot: OnePlot;
  classes: 'auto' | 'bins' | 'width';
  bins: number;
  width: number;
  start: string;
  scale: 'count' | 'relative' | 'density';
  polygon: boolean;
  cumulative: boolean;
  normal: boolean;
  sample: boolean;
  whisker: 'minmax' | 'tukey';
  model: Model;
  degree: number;
  space: 'data' | 'log';
  band: 'none' | 'mean' | 'prediction';
  level: number;
  residuals: boolean;
  squares: boolean;
  predict: string;
}

export const defaultState = (): LabState => ({
  mode: 'one', source: '', ySource: '', sources: [], plot: 'histogram', classes: 'auto', bins: 6, width: 5, start: '', scale: 'count',
  polygon: false, cumulative: false, normal: false, sample: false, whisker: 'minmax', model: 'line', degree: 2, space: 'data', band: 'none',
  level: 0.95, residuals: false, squares: false, predict: '',
});

const FIT: Readonly<Record<Exclude<Model, 'none'>, string>> = {
  line: 'FitLine', lineX: 'FitLineX', poly: 'FitPoly', pow: 'FitPow', exp: 'FitExp', growth: 'FitGrowth', log: 'FitLog', sin: 'FitSin', logistic: 'FitLogistic',
};

export const MODEL_LABELS: readonly [Model, string][] = [
  ['none', 'None'], ['line', 'Line'], ['lineX', 'Line (x on y)'], ['poly', 'Polynomial'], ['pow', 'Power'], ['exp', 'Exponential'],
  ['growth', 'Growth'], ['log', 'Logarithmic'], ['sin', 'Sine'], ['logistic', 'Logistic'],
];

/** The names the lines use; `n(k)` gives a free name in the figure for each part. */
export interface LabNames {
  readonly data: string;
  readonly plot: string;
  readonly stats: string;
  readonly fit: string;
  readonly extra: string;
  readonly band: string;
  readonly curve: string;
}

/** The lines the panel's state stands for, the `@datalab` directive first. Pure; tested. */
export function labLines(s: LabState, n: LabNames): string[] {
  const out: string[] = [];
  if (s.mode === 'one') {
    if (!s.source) return out;
    out.push(`@datalab one ${s.source} ${s.plot}`);
    const src = s.source;
    const scale = s.scale !== 'count' ? `, scale = "${s.scale}"` : '';
    switch (s.plot) {
      case 'histogram': {
        const body = s.classes === 'bins' ? `Histogram(${src}, ${s.bins}${scale})`
          : s.classes === 'width' ? `Histogram(ClassesByWidth(${src}, ${s.width}${s.start.trim() ? `, ${s.start.trim()}` : ''}), ${src}${scale})`
            : `Histogram(${src}${scale})`;
        out.push(`${n.plot} = ${body}`);
        if (s.polygon || s.cumulative) out.push(`${n.extra} = FrequencyPolygon(${n.plot}${s.cumulative ? ', cumulative = true' : ''})`);
        if (s.normal) {
          const factor = s.scale === 'density' ? '' : s.scale === 'relative' ? `${n.plot}.binWidth * ` : `Count(${src}) * ${n.plot}.binWidth * `;
          out.push(`${n.curve}(x) = ${factor}Pdf(Normal(Mean(${src}), StdDev(${src})), x)`);
        }
        break;
      }
      case 'boxplot':
        out.push(`${n.plot} = BoxPlot(1, 0.5, ${src}${s.whisker === 'tukey' ? ', whisker = "tukey"' : ''})`);
        break;
      case 'dotplot':
        out.push(`${n.plot} = DotPlot(${src})`);
        break;
      case 'nq':
        out.push(`${n.plot} = NormalQuantilePlot(${src})`);
        break;
      case 'stem':
        out.push(`${n.plot} = StemPlot(${src})`);
        break;
      case 'bar':
        out.push(`${n.plot} = BarChart(${src}, 1)`);
        break;
    }
    out.push(`${n.stats} = Describe(${src})`);
    return out;
  }
  if (s.mode === 'two') {
    if (!s.source) return out;
    const data = s.ySource ? `Points(${s.source}, ${s.ySource})` : s.source;
    out.push(`@datalab two ${s.source}${s.ySource ? ` ${s.ySource}` : ''} ${s.model}`);
    const pts = s.ySource ? n.data : s.source;
    if (s.ySource) out.push(`${n.data} = ${data}`);
    out.push(`${n.stats} = Describe(${pts})`);
    if (s.model !== 'none') {
      const extra = s.model === 'poly' ? `, ${s.degree}` : '';
      const space = (s.model === 'pow' || s.model === 'exp' || s.model === 'growth') && s.space === 'log' ? ', space = "log"' : '';
      out.push(`${n.fit} = ${FIT[s.model]}(${pts}${extra}${space})`);
      if (s.residuals) out.push(`${n.extra} = ResidualPlot(${pts}, ${n.fit}.f)`);
      if (s.squares) out.push(`${n.plot} = Squares(${pts}, ${n.fit}.f)`);
      if (s.band !== 'none') out.push(`${n.band} = FitBand(${n.fit}, ${s.level}, "${s.band}")`);
    }
    return out;
  }
  if (s.sources.length === 0) return out;
  out.push(`@datalab several ${s.sources.join(' ')}`);
  const list = `[${s.sources.join(', ')}]`;
  const labels = `[${s.sources.map((x) => `"${x}"`).join(', ')}]`;
  out.push(`${n.plot} = BoxPlots(${list}, ${labels}${s.whisker === 'tukey' ? ', whisker = "tukey"' : ''})`);
  if (s.sources.length >= 2) out.push(`${n.stats} = ANOVA(${list})`);
  return out;
}

/** Reads the panel's state back from an `@datalab` line. */
export function parseLab(line: string): Partial<LabState> | undefined {
  const w = line.trim().split(/\s+/);
  if (w[0] !== '@datalab') return undefined;
  if (w[1] === 'one' && w[2]) return { mode: 'one', source: w[2], plot: (w[3] as OnePlot | undefined) ?? 'histogram' };
  if (w[1] === 'two' && w[2]) {
    const last = w[w.length - 1] as Model;
    const isModel = MODEL_LABELS.some(([m]) => m === last);
    const ys = w.length === 5 || (w.length === 4 && !isModel) ? (w[3] as string) : '';
    return { mode: 'two', source: w[2], ySource: ys, ...(isModel ? { model: last } : {}) };
  }
  if (w[1] === 'several') return { mode: 'several', sources: w.slice(2) };
  return undefined;
}

/* ------------------------------ the panel ------------------------------ */

export interface DataLab {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: () => boolean;
  /** Re-reads the figure (after any change) when open. */
  refresh(): void;
  readonly state: LabState;
}

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

export const fmt = (x: unknown): string => (typeof x === 'number' ? (Number.isFinite(x) ? String(Number(x.toPrecision(4))) : String(x)) : x === undefined ? '—' : valueText(x));

export function select(label: string, options: readonly (readonly [string, string])[], value: string, on: (v: string) => void): HTMLLabelElement {
  const l = el('label', 'field');
  l.append(el('span', 'field-label', label));
  const s = el('select');
  for (const [v, t] of options) {
    const o = el('option', '', t);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => on(s.value));
  l.append(s);
  return l;
}

export function number(label: string, value: number | string, on: (v: string) => void, attrs: Record<string, string> = {}): HTMLLabelElement {
  const l = el('label', 'field small');
  l.append(el('span', 'field-label', label));
  const i = el('input');
  i.type = 'number';
  i.value = String(value);
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  i.addEventListener('change', () => on(i.value));
  l.append(i);
  return l;
}

export function check(label: string, value: boolean, on: (v: boolean) => void): HTMLLabelElement {
  const l = el('label', 'check');
  const i = el('input');
  i.type = 'checkbox';
  i.checked = value;
  i.addEventListener('change', () => on(i.checked));
  l.append(i, document.createTextNode(` ${label}`));
  return l;
}

export function segmented<T extends string>(options: readonly (readonly [T, string])[], value: T, on: (v: T) => void, label: string): HTMLElement {
  const g = el('div', 'seg');
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  for (const [v, t] of options) {
    const b = el('button', v === value ? 'on' : '', t);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v === value));
    b.addEventListener('click', () => on(v));
    g.append(b);
  }
  return g;
}

export function statsTable(rows: readonly (readonly [string, unknown])[]): HTMLElement {
  const t = el('dl', 'stats');
  for (const [k, v] of rows) t.append(el('dt', '', k), el('dd', '', fmt(v)));
  return t;
}

export function mountDataLab(session: KernelSession, registry: CommandRegistry, say: (t: string) => void): DataLab {
  const element = el('aside', 'datalab');
  element.setAttribute('aria-label', 'Data analysis');
  element.hidden = true;
  const state = defaultState();
  let restored = '';

  const head = el('header', 'lab-head');
  const title = el('h2', '', 'Data analysis');
  const closeBtn = el('button', 'icon-btn', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close data analysis');
  head.append(title, closeBtn);
  const body = el('div', 'lab-body');
  element.append(head, body);

  const lists = (pred: (type: string) => boolean): string[] => session.figure.objects().filter((o) => pred(o.typeText)).map((o) => o.name);
  const numberLists = (): string[] => lists((t) => t === 'List<Number>');
  const pointLists = (): string[] => lists((t) => t === 'List<Point>');

  const free = (base: string): string => {
    let k = 1;
    while (session.figure.get(`${base}${k}`)) k++;
    return `${base}${k}`;
  };
  const names = (): LabNames => ({ data: free('pts'), plot: free('chart'), stats: free('stats'), fit: free('fit'), extra: free('overlay'), band: free('band'), curve: free('nc') });

  /** Runs the lines on a scratch copy of the figure. */
  const run = (lines: readonly string[]): { fig: Figure; errors: string[] } => {
    const { figure } = Figure.fromScript(session.figure.toScript(), { commands: registry });
    const errors: string[] = [];
    for (const l of lines) {
      if (l.startsWith('@')) continue;
      const r = figure.apply(l);
      if (!r.ok) errors.push(`${l}: ${r.message}`);
    }
    return { fig: figure, errors };
  };

  const render = (): void => {
    body.replaceChildren();
    // restore from the figure's @datalab line once per new line
    const saved = session.figure.toScript().split('\n').reverse().find((l) => l.startsWith('@datalab'));
    if (saved && saved !== restored) {
      restored = saved;
      Object.assign(state, parseLab(saved) ?? {});
    }
    const set = (patch: Partial<LabState>): void => {
      Object.assign(state, patch);
      render();
    };
    body.append(segmented<Mode>([['one', 'One variable'], ['two', 'Two variables'], ['several', 'Several']], state.mode, (m) => set({ mode: m }), 'Mode'));

    // data pickers
    const pick = el('div', 'row');
    if (state.mode === 'one') {
      const opts = numberLists();
      if (!opts.includes(state.source)) state.source = opts[0] ?? '';
      pick.append(select('Data', opts.length ? opts.map((o) => [o, o] as const) : [['', 'no List<Number> yet']], state.source, (v) => set({ source: v })));
      pick.append(select('Plot', [['histogram', 'Histogram'], ['boxplot', 'Box plot'], ['dotplot', 'Dot plot'], ['nq', 'Normal quantile'], ['stem', 'Stem and leaf'], ['bar', 'Bar chart']], state.plot, (v) => set({ plot: v as OnePlot })));
    } else if (state.mode === 'two') {
      const pts = pointLists();
      const nl = numberLists();
      const all = [...pts.map((o) => [o, `${o} (points)`] as const), ...nl.map((o) => [o, `${o} as x`] as const)];
      if (!all.some(([o]) => o === state.source)) state.source = all[0]?.[0] ?? '';
      pick.append(select('Data', all.length ? all : [['', 'no points or lists yet']], state.source, (v) => set({ source: v, ySource: pts.includes(v) ? '' : state.ySource })));
      if (nl.includes(state.source)) {
        if (!nl.includes(state.ySource) || state.ySource === state.source) state.ySource = nl.find((o) => o !== state.source) ?? '';
        pick.append(select('y', nl.filter((o) => o !== state.source).map((o) => [o, o] as const), state.ySource, (v) => set({ ySource: v })));
      } else state.ySource = '';
    } else {
      const nl = numberLists();
      state.sources = state.sources.filter((s) => nl.includes(s));
      if (state.sources.length === 0) state.sources = nl.slice(0, 3);
      const box = el('div', 'checks');
      box.append(el('span', 'field-label', 'Data'));
      for (const o of nl) box.append(check(o, state.sources.includes(o), (on) => set({ sources: on ? [...state.sources, o] : state.sources.filter((s) => s !== o) })));
      if (nl.length === 0) box.append(el('span', 'muted', 'no List<Number> yet'));
      pick.append(box);
    }
    body.append(pick);

    const n = names();
    const lines = labLines(state, n);
    if (lines.length === 0) {
      body.append(el('p', 'muted', 'Make a list first, for example  data = [4, 7, 8, 8, 9, 10, 12, 15, 21]  or  P = [(1, 2), (2, 3.9), (3, 6.2)].'));
      return;
    }
    const { fig, errors } = run(lines);

    // the plot
    const plotBox = el('div', 'lab-plot');
    const canvas = el('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Plot of the data');
    plotBox.append(canvas);
    body.append(plotBox);
    const items: SceneItem[] = [];
    const add = (name: string, i: number): void => {
      const o = fig.get(name);
      if (!o || !o.cell.defined) return;
      items.push({ id: o.id, name, type: o.type, typeText: o.typeText, value: o.cell.value, color: colorAt(i), free: false, label: false });
    };
    if (state.mode === 'two') add(state.ySource ? n.data : state.source, 0);
    [n.plot, n.extra, n.fit, n.band, n.curve].forEach((x, i) => add(x, i + (state.mode === 'two' ? 1 : 0)));
    requestAnimationFrame(() => {
      const w = plotBox.clientWidth || 340;
      const h = 220;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vp = new Viewport();
      vp.resize(w, h);
      const b = sceneBounds(items);
      const square = items.some((i) => i.typeText === 'List<Polygon>');
      if (b) vp.fit({ x0: b.x0, x1: b.x1, y0: Math.min(b.y0, 0), y1: b.y1 }, 22, !square);
      paintScene(ctx, vp, items);
    });
    for (const e of errors) body.append(el('p', 'lab-error', e));

    // controls and tables per mode
    if (state.mode === 'one') {
      if (state.plot === 'histogram') {
        const cls = el('div', 'row');
        cls.append(segmented([['auto', 'Auto'], ['bins', 'Bins'], ['width', 'Width']] as const, state.classes, (v) => set({ classes: v }), 'Classes'));
        if (state.classes === 'bins') cls.append(number('Bins', state.bins, (v) => set({ bins: Math.max(1, Math.round(Number(v) || 1)) }), { min: '1', max: '200' }));
        if (state.classes === 'width') {
          cls.append(number('Width', state.width, (v) => set({ width: Math.max(1e-9, Number(v) || 1) }), { min: '0', step: 'any' }));
          cls.append(number('Start', state.start, (v) => set({ start: v }), { step: 'any' }));
        }
        body.append(cls);
        const ov = el('div', 'row');
        ov.append(select('Heights', [['count', 'Counts'], ['relative', 'Relative'], ['density', 'Density']], state.scale, (v) => set({ scale: v as LabState['scale'] })));
        ov.append(check('normal curve', state.normal, (v) => set({ normal: v })), check('polygon', state.polygon, (v) => set({ polygon: v })), check('cumulative', state.cumulative, (v) => set({ cumulative: v })));
        body.append(ov);
      }
      if (state.plot === 'boxplot') body.append(segmented([['minmax', 'Min–max whiskers'], ['tukey', 'Tukey (1.5 IQR)']] as const, state.whisker, (v) => set({ whisker: v }), 'Whiskers'));
      const d = fig.get(n.stats)?.cell;
      if (d?.defined) {
        const F = (d.value as { fields: Record<string, unknown> }).fields;
        const row = el('div', 'row spread');
        row.append(el('h3', '', 'Statistics'), segmented([['n', 'sd (n)'], ['n1', 's (n−1)']] as const, state.sample ? 'n1' : 'n', (v) => set({ sample: v === 'n1' }), 'Deviation'));
        body.append(row, statsTable([
          ['n', F['n']], ['mean', F['mean']], ['median', F['median']], ['min', F['min']], [`q1 (${String(F['method'])})`, F['q1']], ['q3', F['q3']], ['max', F['max']], ['iqr', F['iqr']],
          [state.sample ? 's (n−1)' : 'sd (n)', state.sample ? F['sampleSd'] : F['sd']], ['mode', F['mode']], ['skewness', F['skewness']], ['kurtosis', F['kurtosis']],
        ]));
      }
    } else if (state.mode === 'two') {
      const m = el('div', 'row');
      m.append(select('Model', MODEL_LABELS, state.model, (v) => set({ model: v as Model })));
      if (state.model === 'poly') m.append(number('Degree', state.degree, (v) => set({ degree: Math.min(12, Math.max(1, Math.round(Number(v) || 1))) }), { min: '1', max: '12' }));
      if (state.model === 'pow' || state.model === 'exp' || state.model === 'growth') m.append(check('log space', state.space === 'log', (v) => set({ space: v ? 'log' : 'data' })));
      body.append(m);
      if (state.model !== 'none') {
        const t = el('div', 'row');
        t.append(check('residual plot', state.residuals, (v) => set({ residuals: v })), check('squares', state.squares, (v) => set({ squares: v })));
        t.append(select('Band', [['none', 'No band'], ['mean', 'Mean band'], ['prediction', 'Prediction band']], state.band, (v) => set({ band: v as LabState['band'] })));
        if (state.band !== 'none') t.append(number('Level', state.level, (v) => set({ level: Math.min(0.999, Math.max(0.5, Number(v) || 0.95)) }), { min: '0.5', max: '0.999', step: '0.01' }));
        body.append(t);
      }
      const fit = fig.get(n.fit)?.cell;
      if (state.model !== 'none' && fit && !fit.defined) body.append(el('p', 'lab-error', `The fit is undefined: ${fit.reason.replace(/_/g, ' ')}${fit.detail ? ` — ${fit.detail}` : ''}`));
      if (fit?.defined) {
        const F = (fit.value as { fields: Record<string, unknown> }).fields;
        body.append(el('p', 'equation', String(F['equation'])));
        const names2 = (F['names'] as string[]) ?? [];
        const params = Array.from((F['params'] as Float64Array) ?? []);
        const se = F['stderr'] instanceof Float64Array ? Array.from(F['stderr']) : [];
        body.append(statsTable([
          ['R²', F['r2']], ['adjusted R²', F['adjR2']], ['SSE', F['sse']], ['rmse', F['rmse']], ['n', F['n']],
          ...params.map((p, i) => [`${names2[i] ?? `p${i + 1}`}${se[i] !== undefined ? ` ± ${fmt(se[i])}` : ''}`, p] as const),
        ]));
        // prediction box
        const pr = el('div', 'row');
        const inp = el('input', 'predict');
        inp.type = 'number';
        inp.step = 'any';
        inp.placeholder = 'x';
        inp.value = state.predict;
        inp.setAttribute('aria-label', 'Predict at x');
        const outp = el('output', 'predict-out');
        const f = F['f'] as { call: (x: number) => unknown } | undefined;
        const show = (): void => {
          state.predict = inp.value;
          const x = Number(inp.value);
          if (inp.value === '' || !Number.isFinite(x) || !f) {
            outp.textContent = '';
            return;
          }
          const y = f.call(x);
          const lo = F['from'] as number;
          const hi = F['to'] as number;
          outp.textContent = `ŷ = ${fmt(y)}${x < lo || x > hi ? '  ⚠ outside the data' : ''}`;
        };
        inp.addEventListener('input', show);
        show();
        pr.append(el('span', 'field-label', 'Predict at x ='), inp, outp);
        body.append(pr);
      }
      const d = fig.get(n.stats)?.cell;
      if (d?.defined) {
        const F = (d.value as { fields: Record<string, unknown> }).fields;
        const X = (F['x'] as { fields: Record<string, unknown> } | undefined)?.fields ?? {};
        const Y = (F['y'] as { fields: Record<string, unknown> } | undefined)?.fields ?? {};
        body.append(el('h3', '', 'Statistics'), statsTable([
          ['n', F['n']], ['mean x', X['mean']], ['mean y', Y['mean']], ['sd x', X['sd']], ['sd y', Y['sd']], ['r', F['r']], ['r²', F['r2']], ['Spearman', F['spearman']],
          ['covariance', F['cov']], ['Sxx', X['sxx']], ['Sxy', F['sxy']], ['Syy', Y['sxx']],
        ]));
      }
    } else {
      body.append(segmented([['minmax', 'Min–max whiskers'], ['tukey', 'Tukey (1.5 IQR)']] as const, state.whisker, (v) => set({ whisker: v }), 'Whiskers'));
      const table = el('table', 'summary');
      const head = el('tr');
      for (const h of ['', 'n', 'mean', 'sd', 'min', 'q1', 'median', 'q3', 'max']) head.append(el('th', '', h));
      table.append(head);
      for (const s of state.sources) {
        const r = run([`tmp = Describe(${s})`]).fig.get('tmp')?.cell;
        if (!r?.defined) continue;
        const F = (r.value as { fields: Record<string, unknown> }).fields;
        const tr = el('tr');
        tr.append(el('th', '', s), ...['n', 'mean', 'sd', 'min', 'q1', 'median', 'q3', 'max'].map((k) => el('td', '', fmt(F[k]))));
        table.append(tr);
      }
      const wrap = el('div', 'table-wrap');
      wrap.append(table);
      body.append(wrap);
      const a = fig.get(n.stats)?.cell;
      if (a?.defined) {
        const F = (a.value as { fields: Record<string, unknown> }).fields;
        body.append(el('h3', '', 'ANOVA'), statsTable([['F', F['F']], ['p', F['p']], ['df between', F['dfBetween']], ['df within', F['dfWithin']], ['SS between', F['ssBetween']], ['SS within', F['ssWithin']], ['grand mean', F['grandMean']]]));
      }
    }

    // actions
    const act = el('div', 'lab-actions');
    const addBtn = el('button', 'primary', 'Add to figure');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      const r = session.applyLines(lines, 'Data analysis');
      say(r.ok ? r.message : r.error.message);
    });
    const copyBtn = el('button', 'secondary', 'Copy as lines');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard?.writeText(lines.join('\n')).then(() => say('Lines copied.'), () => say('Could not copy.'));
    });
    act.append(addBtn, copyBtn);
    const pre = el('pre', 'lab-lines', lines.filter((l) => !l.startsWith('@')).join('\n'));
    body.append(act, el('h3', '', 'Lines'), pre);
  };

  let open = false;
  closeBtn.addEventListener('click', () => {
    api.close();
    element.dispatchEvent(new CustomEvent('lab-closed', { bubbles: true }));
  });
  const api: DataLab = {
    element,
    state,
    isOpen: () => open,
    open() {
      open = true;
      element.hidden = false;
      render();
    },
    close() {
      open = false;
      element.hidden = true;
    },
    refresh() {
      if (open) render();
    },
  };
  return api;
}

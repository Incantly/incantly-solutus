/**
 * The probability calculator (probability design 7, ui.md 2 to 6). Like the data-analysis panel it holds no engine of
 * its own: every control changes the lines it would write (`calcLines`, `statLines`), the plot and the numbers are those
 * lines run on a scratch copy of the figure, and **Add to figure** applies them.
 */
import { Figure } from '@incantly/kernel';
import type { CommandRegistry } from '@incantly/kernel';
import { check, el, fmt, number, segmented, select, statsTable } from './datalab';
import { colorAt, paintScene } from '@incantly/sdk/screen';
import type { SceneItem } from '@incantly/sdk/screen';
import { Viewport } from '@incantly/sdk/screen';
import { miniCurve } from './mini';
import type { KernelSession } from './session';

export type CalcMode = 'interval' | 'left' | 'right' | 'two';

export interface ParamInfo {
  readonly name: string;
  /** The symbol shown beside the field: μ, σ, ν, λ. */
  readonly symbol: string;
  readonly def: string;
}

export interface DistInfo {
  readonly kind: string;
  readonly label: string;
  readonly discrete: boolean;
  readonly params: readonly ParamInfo[];
}

const P = (name: string, symbol: string, def: number | string): ParamInfo => ({ name, symbol, def: String(def) });

/** The picker, in teaching order, with the defaults of design 7.3. */
export const DIST_MENU: readonly DistInfo[] = [
  { kind: 'Normal', label: 'Normal', discrete: false, params: [P('mu', 'μ', 0), P('sigma', 'σ', 1)] },
  { kind: 'StudentT', label: 'Student t', discrete: false, params: [P('df', 'ν', 5)] },
  { kind: 'ChiSquared', label: 'Chi-squared', discrete: false, params: [P('df', 'k', 3)] },
  { kind: 'FDist', label: 'F', discrete: false, params: [P('d1', 'd₁', 5), P('d2', 'd₂', 10)] },
  { kind: 'Exponential', label: 'Exponential', discrete: false, params: [P('rate', 'λ', 1)] },
  { kind: 'Uniform', label: 'Uniform', discrete: false, params: [P('min', 'a', 0), P('max', 'b', 1)] },
  { kind: 'Gamma', label: 'Gamma', discrete: false, params: [P('shape', 'α', 3), P('rate', 'β', 1)] },
  { kind: 'Beta', label: 'Beta', discrete: false, params: [P('a', 'α', 2), P('b', 'β', 5)] },
  { kind: 'Cauchy', label: 'Cauchy', discrete: false, params: [P('median', 'x₀', 0), P('scale', 'γ', 1)] },
  { kind: 'Weibull', label: 'Weibull', discrete: false, params: [P('shape', 'k', 2), P('scale', 'λ', 1)] },
  { kind: 'LogNormal', label: 'Log-normal', discrete: false, params: [P('mu', 'μ', 0), P('sigma', 'σ', 0.5)] },
  { kind: 'Logistic', label: 'Logistic', discrete: false, params: [P('mu', 'μ', 0), P('scale', 's', 1)] },
  { kind: 'Triangular', label: 'Triangular', discrete: false, params: [P('min', 'a', 0), P('mode', 'c', 1), P('max', 'b', 2)] },
  { kind: 'Erlang', label: 'Erlang', discrete: false, params: [P('k', 'k', 3), P('rate', 'λ', 1)] },
  { kind: 'Binomial', label: 'Binomial', discrete: true, params: [P('n', 'n', 10), P('p', 'p', 0.5)] },
  { kind: 'Poisson', label: 'Poisson', discrete: true, params: [P('mean', 'λ', 4)] },
  { kind: 'Geometric', label: 'Geometric', discrete: true, params: [P('p', 'p', 0.3)] },
  { kind: 'NegBinomial', label: 'Negative binomial', discrete: true, params: [P('r', 'r', 3), P('p', 'p', 0.5)] },
  { kind: 'HyperGeometric', label: 'Hypergeometric', discrete: true, params: [P('N', 'N', 50), P('K', 'K', 20), P('n', 'n', 10)] },
  { kind: 'Bernoulli', label: 'Bernoulli', discrete: true, params: [P('p', 'p', 0.5)] },
  { kind: 'DiscreteUniform', label: 'Discrete uniform', discrete: true, params: [P('lo', 'a', 1), P('hi', 'b', 6)] },
  { kind: 'Zipf', label: 'Zipf', discrete: true, params: [P('s', 's', 1), P('N', 'N', 10)] },
  { kind: 'Discrete', label: 'Custom', discrete: true, params: [P('values', 'x', '[1, 2, 3, 4, 5, 6]'), P('probs', 'p', '[1, 1, 1, 1, 1, 1] / 6')] },
];

export const infoOf = (kind: string): DistInfo => DIST_MENU.find((d) => d.kind === kind) ?? (DIST_MENU[0] as DistInfo);

export interface CalcState {
  tab: 'distribution' | 'statistics';
  kind: string;
  /** Parameter texts: numbers or formulas over the figure's objects. */
  params: string[];
  mode: CalcMode;
  lo: number;
  hi: number;
  /** Whether each bound is included: `[` and `]` include it, `(` and `)` leave it out. */
  loEnd: '[' | '(';
  hiEnd: ']' | ')';
  cumulative: boolean;
  overlay: boolean;
  table: boolean;
  /** Statistics tab. */
  test: string;
  inputs: Record<string, string>;
  tail: 'two' | 'left' | 'right';
  level: number;
  pooled: boolean;
  /** One-sample procedures: a list from the figure instead of summary numbers. */
  data: string;
  sampleN: number;
}

export const defaultCalc = (): CalcState => ({
  tab: 'distribution', kind: 'Normal', params: ['0', '1'], mode: 'interval', lo: -1, hi: 1, loEnd: '[', hiEnd: ']',
  cumulative: false, overlay: false, table: false, test: 'TTest', inputs: {}, tail: 'two', level: 0.95, pooled: false, data: '', sampleN: 100,
});

export interface CalcNames {
  readonly d: string;
  readonly lo: string;
  readonly hi: string;
  readonly curve: string;
  readonly area: string;
  readonly p: string;
  readonly nd: string;
  readonly nc: string;
}

export const MODE_LABELS: readonly (readonly [CalcMode, string])[] = [
  ['interval', 'P(a ≤ X ≤ b)'], ['left', 'P(X ≤ b)'], ['right', 'P(X ≥ a)'], ['two', 'two-tailed'],
];

const usesLo = (m: CalcMode): boolean => m !== 'left';
const usesHi = (m: CalcMode): boolean => m !== 'right';

/** A step for a bound slider: whole numbers for a discrete distribution, else about 1/200 of the window. */
export function boundStep(discrete: boolean, lo: number, hi: number): number {
  if (discrete) return 1;
  const raw = (hi - lo) / 200;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? p;
}

const num = (x: number): string => String(Number(x.toPrecision(10)));

/** The lines the Distribution tab stands for (design 7.1). Pure; tested. `range` is the bound sliders' range. */
export function calcLines(s: CalcState, n: CalcNames, range: { lo: number; hi: number } = { lo: -6, hi: 6 }): string[] {
  const info = infoOf(s.kind);
  const disc = info.discrete;
  const out: string[] = [`${n.d} = ${info.kind}(${s.params.map((x) => x.trim() || '0').join(', ')})`];
  const step = boundStep(disc, range.lo, range.hi);
  // the ends are whole steps, so the slider's grid holds round values such as -1 and 1
  const rlo = Number((Math.floor(range.lo / step) * step).toPrecision(10));
  const rhi = Number((Math.ceil(range.hi / step) * step).toPrecision(10));
  const slider = (name: string, v: number): string => `${name} = ${num(v)} in ${num(Math.min(rlo, v))}..${num(Math.max(rhi, v))} step ${num(step)}`;
  if (usesLo(s.mode)) out.push(slider(n.lo, s.lo));
  if (usesHi(s.mode)) out.push(slider(n.hi, s.hi));
  out.push(`${n.curve} = ${s.cumulative ? `Cdf(${n.d})` : disc ? `BarChart(${n.d})` : `Pdf(${n.d})`}`);
  const ends = disc ? `, "${s.loEnd}${s.hiEnd}"` : '';
  switch (s.mode) {
    case 'interval':
      out.push(`${n.area} = Shade(${n.d}, ${n.lo}, ${n.hi}${ends})`, `${n.p} = Prob(${n.d}, ${n.lo}, ${n.hi}${ends})`);
      break;
    case 'left':
      out.push(`${n.area} = Shade(${n.d}, -inf, ${n.hi}${disc ? `, "[${s.hiEnd}"` : ''})`, `${n.p} = Prob(${n.d}, -inf, ${n.hi}${disc ? `, "[${s.hiEnd}"` : ''})`);
      break;
    case 'right':
      out.push(`${n.area} = Shade(${n.d}, ${n.lo}, inf${disc ? `, "${s.loEnd}]"` : ''})`, `${n.p} = Prob(${n.d}, ${n.lo}, inf${disc ? `, "${s.loEnd}]"` : ''})`);
      break;
    case 'two':
      // for tails "[" puts a itself in the left tail and "]" puts b in the right one
      out.push(`${n.area} = ShadeTails(${n.d}, ${n.lo}, ${n.hi}${ends})`, `${n.p} = ${n.area}.mass`);
      break;
  }
  if (s.overlay) out.push(`${n.nd} = NormalApprox(${n.d})`, `${n.nc} = Pdf(${n.nd})`);
  return out;
}

/** The text of the probability asked: `P(3 ≤ X < 7)`. */
export function probLabel(s: CalcState, discrete: boolean): string {
  const a = num(s.lo);
  const b = num(s.hi);
  const le = (open: boolean): string => (discrete && open ? '<' : '≤');
  switch (s.mode) {
    case 'interval': return `P(${a} ${le(s.loEnd === '(')} X ${le(s.hiEnd === ')')} ${b})`;
    case 'left': return `P(X ${le(s.hiEnd === ')')} ${b})`;
    case 'right': return `P(X ${discrete && s.loEnd === '(' ? '>' : '≥'} ${a})`;
    case 'two': return `P(X ${le(s.loEnd === '(')} ${a}) + P(X ${discrete && s.hiEnd === ')' ? '>' : '≥'} ${b})`;
  }
}

/* ------------------------------ statistics tab ------------------------------ */

export interface TestInfo {
  readonly name: string;
  readonly label: string;
  readonly interval: boolean;
  /** Summary inputs in the command's order. */
  readonly inputs: readonly ParamInfo[];
  /** The one-sample forms that take a list instead: the inputs it replaces. */
  readonly list?: { readonly replaces: readonly string[]; readonly keep: readonly string[] };
  readonly pooled?: boolean;
}

const I = (name: string, def: number): ParamInfo => ({ name, symbol: name, def: String(def) });

export const TEST_MENU: readonly TestInfo[] = [
  { name: 'ZTest', label: 'z test, one mean', interval: false, inputs: [I('mean', 103), I('sigma', 15), I('n', 30), I('mu0', 100)], list: { replaces: ['mean', 'n'], keep: ['mu0', 'sigma'] } },
  { name: 'TTest', label: 't test, one mean', interval: false, inputs: [I('mean', 103), I('sd', 15), I('n', 30), I('mu0', 100)], list: { replaces: ['mean', 'sd', 'n'], keep: ['mu0'] } },
  { name: 'ZTest2', label: 'z test, two means', interval: false, inputs: [I('mean1', 52), I('sigma1', 8), I('n1', 40), I('mean2', 49), I('sigma2', 9), I('n2', 35)] },
  { name: 'TTest2', label: 't test, two means', interval: false, inputs: [I('mean1', 52), I('sd1', 8), I('n1', 40), I('mean2', 49), I('sd2', 9), I('n2', 35)], pooled: true },
  { name: 'ZPropTest', label: 'z test, one proportion', interval: false, inputs: [I('x', 58), I('n', 100), I('p0', 0.5)] },
  { name: 'ZPropTest2', label: 'z test, two proportions', interval: false, inputs: [I('x1', 58), I('n1', 100), I('x2', 45), I('n2', 100)] },
  { name: 'ZInterval', label: 'z interval, one mean', interval: true, inputs: [I('mean', 103), I('sigma', 15), I('n', 30)], list: { replaces: ['mean', 'n'], keep: ['sigma'] } },
  { name: 'TInterval', label: 't interval, one mean', interval: true, inputs: [I('mean', 103), I('sd', 15), I('n', 30)], list: { replaces: ['mean', 'sd', 'n'], keep: [] } },
  { name: 'ZInterval2', label: 'z interval, two means', interval: true, inputs: [I('mean1', 52), I('sigma1', 8), I('n1', 40), I('mean2', 49), I('sigma2', 9), I('n2', 35)] },
  { name: 'TInterval2', label: 't interval, two means', interval: true, inputs: [I('mean1', 52), I('sd1', 8), I('n1', 40), I('mean2', 49), I('sd2', 9), I('n2', 35)], pooled: true },
  { name: 'ZPropInterval', label: 'z interval, one proportion', interval: true, inputs: [I('x', 58), I('n', 100)] },
  { name: 'ZPropInterval2', label: 'z interval, two proportions', interval: true, inputs: [I('x1', 58), I('n1', 100), I('x2', 45), I('n2', 100)] },
];

export const testOf = (name: string): TestInfo => TEST_MENU.find((t) => t.name === name) ?? (TEST_MENU[1] as TestInfo);

/** The line of the Statistics tab: `r = TTest(103, 15, 30, 100, "right")`. Pure; tested. */
export function statLine(s: CalcState, name: string): string {
  const t = testOf(s.test);
  const v = (k: string, def: string): string => (s.inputs[k] ?? def).trim() || def;
  const args = s.data && t.list
    ? [s.data, ...t.list.keep.map((k) => v(k, t.inputs.find((i) => i.name === k)?.def ?? '0'))]
    : t.inputs.map((i) => v(i.name, i.def));
  if (t.interval) args.push(num(s.level));
  else args.push(`"${s.tail}"`);
  if (t.pooled && s.pooled) args.push('true');
  return `${name} = ${t.name}(${args.join(', ')})`;
}

/** "about 1 time in 56", from a p-value (ui.md 5.3). */
export function pSentence(p: number): string {
  if (!(p >= 0)) return '';
  if (p < 0.001) return 'less than 1 time in 1,000';
  if (p > 0.5) return `about ${Math.round(p * 100)} times in 100`;
  return `about 1 time in ${Math.round(1 / p).toLocaleString('en')}`;
}

/* ------------------------------ the panel ------------------------------ */

export interface ProbCalc {
  readonly element: HTMLElement;
  readonly state: CalcState;
  isOpen(): boolean;
  open(): void;
  close(): void;
  refresh(): void;
}

interface DistLike {
  readonly spec: {
    readonly discrete: boolean;
    pdf(p: readonly number[], x: number): number;
    cdf(p: readonly number[], x: number): number;
    quantile(p: readonly number[], q: number): number;
  };
  readonly params: readonly number[];
}

const isDistLike = (v: unknown): v is DistLike => typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'dist';

export function mountProbCalc(session: KernelSession, registry: CommandRegistry, say: (t: string) => void): ProbCalc {
  const element = el('aside', 'datalab probcalc');
  element.setAttribute('aria-label', 'Probability');
  element.hidden = true;
  const state = defaultCalc();

  const head = el('header', 'lab-head');
  const closeBtn = el('button', 'icon-btn', '×');
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close the probability calculator');
  head.append(el('h2', '', 'Probability'), closeBtn);
  const body = el('div', 'lab-body');
  const live = el('p', 'sr-only');
  live.setAttribute('aria-live', 'polite');
  element.append(head, body, live);

  const free = (base: string): string => {
    let k = 1;
    while (session.figure.get(`${base}${k}`)) k++;
    return `${base}${k}`;
  };
  const names = (): CalcNames => ({ d: free('d'), lo: free('a'), hi: free('b'), curve: free('curve'), area: free('area'), p: free('prob'), nd: free('nd'), nc: free('normal') });

  /** Runs lines on a scratch copy of the figure. */
  const run = (lines: readonly string[]): { fig: Figure; errors: string[] } => {
    const { figure } = Figure.fromScript(session.figure.toScript(), { commands: registry });
    const errors: string[] = [];
    for (const l of lines) {
      const r = figure.apply(l);
      if (!r.ok) errors.push(`${l}: ${r.message}`);
    }
    return { fig: figure, errors };
  };

  /** The distribution and its plot window, from the parameter texts alone. */
  const distNow = (n: CalcNames): { d?: DistLike; error?: string; range: { lo: number; hi: number; ymax: number } } => {
    const first = calcLines(state, n)[0] as string;
    const { fig, errors } = run([first, `calcRangeTmp = PlotRange(${n.d})`]);
    const cell = fig.get(n.d)?.cell;
    const pr = fig.get('calcRangeTmp')?.cell;
    const F = pr?.defined ? (pr.value as { fields: Record<string, number> }).fields : undefined;
    const range = F ? { lo: F['lo'] as number, hi: F['hi'] as number, ymax: F['ymax'] as number } : { lo: -4, hi: 4, ymax: 0.5 };
    if (cell?.defined && isDistLike(cell.value)) return { d: cell.value, range };
    const why = errors[0] ?? (cell && !cell.defined ? `${cell.reason.replace(/_/g, ' ')}${cell.detail ? `: ${cell.detail}` : ''}` : 'the distribution is undefined');
    return { error: why, range };
  };

  let open = false;
  /** The last valid distribution: an invalid parameter keeps the curve as it was (design 7.3). */
  let lastGood: CalcState | undefined;

  const render = (): void => {
    body.replaceChildren();
    body.append(segmented([['distribution', 'Distribution'], ['statistics', 'Statistics']] as const, state.tab, (v) => set({ tab: v }), 'Tab'));
    if (state.tab === 'distribution') renderDistribution();
    else renderStatistics();
  };
  const set = (patch: Partial<CalcState>): void => {
    Object.assign(state, patch);
    render();
  };

  /* ------------------------------ distribution tab ------------------------------ */

  function renderDistribution(): void {
    const info = infoOf(state.kind);
    const n = names();
    const now = distNow(n);
    if (now.d) lastGood = { ...state, params: state.params.slice() };

    // picker and parameters
    const pick = el('div', 'row');
    const groups: [string, string][] = [];
    for (const d of DIST_MENU) groups.push([d.kind, `${d.discrete ? 'Discrete' : 'Continuous'}: ${d.label}`]);
    pick.append(select('Distribution', groups, state.kind, (v) => {
      const next = infoOf(v);
      const p = defaultBounds(next);
      set({ kind: v, params: next.params.map((x) => x.def), lo: p.lo, hi: p.hi, loEnd: '[', hiEnd: ']' });
    }));
    body.append(pick);
    const pr = el('div', 'row');
    info.params.forEach((x, i) => {
      const l = el('label', `field ${info.kind === 'Discrete' ? '' : 'small'}`);
      l.append(el('span', 'field-label', `${x.symbol} (${x.name})`));
      const inp = el('input', now.error && state.params[i] !== undefined ? 'bad' : '');
      inp.value = state.params[i] ?? x.def;
      inp.setAttribute('aria-label', `${x.name} of the ${info.label} distribution`);
      inp.addEventListener('change', () => {
        state.params[i] = inp.value;
        render();
      });
      l.append(inp);
      pr.append(l);
    });
    body.append(pr);
    if (now.error) body.append(el('p', 'lab-error', `${now.error}. The picture shows the last valid distribution.`));

    // modes and options
    body.append(segmented(MODE_LABELS, state.mode, (m) => set(switchMode(state, m)), 'Probability'));
    const opts = el('div', 'row');
    opts.append(check('cumulative', state.cumulative, (v) => set({ cumulative: v })), check('normal overlay', state.overlay, (v) => set({ overlay: v })));
    if (info.discrete) opts.append(check('table', state.table, (v) => set({ table: v })));
    body.append(opts);

    // the plot
    const plotBox = el('div', 'lab-plot calc-plot');
    const canvas = el('canvas');
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    plotBox.append(canvas);
    body.append(plotBox);

    // bounds and result
    const bounds = el('div', 'row bounds');
    const boundField = (which: 'lo' | 'hi'): HTMLElement => {
      const wrap = el('div', 'bound');
      if (info.discrete) {
        const end = which === 'lo' ? state.loEnd : state.hiEnd;
        const t = el('button', 'end-toggle', end);
        t.type = 'button';
        t.title = end === '[' || end === ']' ? 'Included; click to leave it out' : 'Left out; click to include it';
        t.setAttribute('aria-label', `${which === 'lo' ? 'Lower' : 'Upper'} bound ${end === '[' || end === ']' ? 'included' : 'left out'}`);
        t.addEventListener('click', () => set(which === 'lo' ? { loEnd: state.loEnd === '[' ? '(' : '[' } : { hiEnd: state.hiEnd === ']' ? ')' : ']' }));
        wrap.append(t);
      }
      wrap.append(number(which === 'lo' ? 'a' : 'b', state[which], (v) => {
        const x = Number(v);
        if (!Number.isFinite(x)) return;
        const y = info.discrete ? Math.round(x) : x;
        set(which === 'lo' ? { lo: y } : { hi: y });
      }, { step: info.discrete ? '1' : 'any' }));
      return wrap;
    };
    if (usesLo(state.mode)) bounds.append(boundField('lo'));
    if (usesHi(state.mode)) bounds.append(boundField('hi'));
    const resultLabel = el('span', 'field-label');
    const result = el('input', 'result');
    result.setAttribute('aria-label', 'Probability');
    result.readOnly = state.mode === 'interval';
    result.title = state.mode === 'interval' ? 'The probability' : 'Type a probability to move the bound';
    const rl = el('label', 'field result-field');
    rl.append(resultLabel, result);
    bounds.append(rl);
    body.append(bounds);
    const approx = el('dl', 'stats approx');
    body.append(approx);
    const tableBox = el('div', 'table-wrap calc-table');
    body.append(tableBox);
    const note = el('p', 'muted');
    body.append(note);

    /** Recomputes the lines on the scratch figure and repaints; called on every drag step too. */
    const update = (): void => {
      const lines = calcLines(state, n, now.range);
      const { fig, errors } = run(now.d || !lastGood ? lines : calcLines(lastGood, n, now.range));
      const items: SceneItem[] = [];
      const add = (name: string, i: number): void => {
        const o = fig.get(name);
        if (o?.cell.defined) items.push({ id: o.id, name, type: o.type, typeText: o.typeText, value: o.cell.value, color: colorAt(i), free: false, label: false });
      };
      if (!state.cumulative) add(n.area, 0);
      add(n.curve, 0);
      if (state.overlay && !state.cumulative) add(n.nc, 2);
      const pc = fig.get(n.p)?.cell;
      const p = pc?.defined && typeof pc.value === 'number' ? pc.value : undefined;
      resultLabel.textContent = `${probLabel(state, info.discrete)} =`;
      if (document.activeElement !== result) result.value = p === undefined ? '—' : String(Number(p.toPrecision(6)));
      live.textContent = `${info.label}. ${probLabel(state, info.discrete).replace('P', 'Probability')} is ${p === undefined ? 'undefined' : fmt(p)}.`;
      canvas.setAttribute('aria-label', live.textContent);
      note.textContent = errors.length > 0 && now.d ? errors[0] ?? '' : '';
      // normal approximation, with continuity correction for a discrete distribution (ui.md 3.3)
      approx.replaceChildren();
      const nd = fig.get(n.nd)?.cell;
      if (state.overlay && nd?.defined && isDistLike(nd.value) && p !== undefined) {
        const N = nd.value;
        const F = (x: number): number => N.spec.cdf(N.params, x);
        const cc = info.discrete ? 0.5 : 0;
        const a = state.loEnd === '[' ? state.lo - cc : state.lo + cc;
        const b = state.hiEnd === ']' ? state.hi + cc : state.hi - cc;
        const pn = state.mode === 'interval' ? F(b) - F(a) : state.mode === 'left' ? F(b) : state.mode === 'right' ? 1 - F(a) : F(state.loEnd === '[' ? state.lo + cc : state.lo - cc) + 1 - F(state.hiEnd === ']' ? state.hi - cc : state.hi + cc);
        approx.append(el('dt', '', 'exact'), el('dd', '', fmt(p)), el('dt', '', info.discrete ? 'normal (continuity correction)' : 'normal'), el('dd', '', fmt(pn)), el('dt', '', 'difference'), el('dd', '', fmt(Math.abs(pn - p))));
      }
      // table of values (ui.md 3.4)
      tableBox.replaceChildren();
      if (info.discrete && state.table && now.d) {
        const from = Math.ceil(now.range.lo);
        const to = Math.floor(now.range.hi);
        const t = run([...lines.slice(0, 1), `calcTableTmp = PdfTable(${n.d}, ${from}, ${to})`]).fig.get('calcTableTmp')?.cell;
        if (t?.defined) {
          const F = (t.value as { fields: Record<string, unknown> }).fields;
          const cols = F['columns'] as Float64Array[];
          const titles = F['titles'] as string[];
          const table = el('table', 'summary');
          const hr = el('tr');
          for (const h of titles) hr.append(el('th', '', h));
          table.append(hr);
          const area = fig.get(n.area)?.cell;
          const inside = area?.defined ? ((area.value as { fields?: Record<string, unknown> }).fields?.['inside'] as Float64Array | undefined) : undefined;
          const xs = area?.defined ? ((area.value as { fields?: Record<string, unknown> }).fields?.['xs'] as Float64Array | undefined) : undefined;
          for (let r = 0; r < (cols[0]?.length ?? 0); r++) {
            const k = (cols[0] as Float64Array)[r] as number;
            const tr = el('tr', '');
            const at = xs ? Array.from(xs).indexOf(k) : -1;
            if (inside && at >= 0 && inside[at]) tr.className = 'in';
            tr.title = 'Click to set both bounds to this value';
            tr.addEventListener('click', () => set({ lo: k, hi: k, mode: 'interval' }));
            tr.append(el('td', '', String(k)), ...cols.slice(1).map((c) => el('td', '', fmt(c[r]))));
            table.append(tr);
          }
          tableBox.append(table);
        }
      }
      paint(items);
    };

    // the plot, with markers that can be dragged (ui.md 4.4)
    const vp = new Viewport();
    const paint = (items: SceneItem[]): void => {
      const w = plotBox.clientWidth || 340;
      const h = 230;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vp.resize(w, h);
      const r = now.range;
      const top = state.cumulative ? 1.05 : r.ymax * 1.12 || 1;
      const pad = (r.hi - r.lo) * 0.04;
      vp.fit({ x0: r.lo - pad, x1: r.hi + pad, y0: 0, y1: top }, 24, true);
      ctx.clearRect(0, 0, w, h);
      paintScene(ctx, vp, items);
      // markers: a guide line and a triangle on the x axis, with the value
      const mark = (x: number, which: string): void => {
        const px = vp.px(x);
        ctx.strokeStyle = '#111827';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, 8);
        ctx.lineTo(px, vp.py(0));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#111827';
        ctx.beginPath();
        ctx.moveTo(px, vp.py(0) - 1);
        ctx.lineTo(px - 7, vp.py(0) + 11);
        ctx.lineTo(px + 7, vp.py(0) + 11);
        ctx.closePath();
        ctx.fill();
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(`${which} = ${fmt(x)}`, px, 2);
        if (state.cumulative && now.d) {
          const y = now.d.spec.cdf(now.d.params, x);
          ctx.strokeStyle = '#6b7280';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(vp.px(r.lo - pad), vp.py(y));
          ctx.lineTo(px, vp.py(y));
          ctx.stroke();
          ctx.setLineDash([]);
        }
      };
      if (usesLo(state.mode)) mark(state.lo, 'a');
      if (usesHi(state.mode)) mark(state.hi, 'b');
    };
    let dragging: 'lo' | 'hi' | undefined;
    const snap = (x: number): number => (info.discrete ? Math.round(x) : Number(x.toPrecision(4)));
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const dl = usesLo(state.mode) ? Math.abs(vp.px(state.lo) - x) : Infinity;
      const dh = usesHi(state.mode) ? Math.abs(vp.px(state.hi) - x) : Infinity;
      if (Math.min(dl, dh) > 22) return;
      dragging = dl <= dh ? 'lo' : 'hi';
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      const x = snap(vp.x(e.clientX - rect.left));
      if (dragging === 'lo') state.lo = x;
      else state.hi = x;
      // dragging past the other marker swaps their roles (ui.md 4.4)
      if (usesLo(state.mode) && usesHi(state.mode) && state.lo > state.hi) {
        [state.lo, state.hi] = [state.hi, state.lo];
        dragging = dragging === 'lo' ? 'hi' : 'lo';
      }
      update();
    });
    const endDrag = (): void => {
      if (!dragging) return;
      dragging = undefined;
      render();
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    // keyboard: Left and Right move the focused marker, Shift for ten steps, Tab-free switch with M for the mode
    let focus: 'lo' | 'hi' = usesLo(state.mode) ? 'lo' : 'hi';
    canvas.addEventListener('keydown', (e) => {
      const step = (info.discrete ? 1 : boundStep(false, now.range.lo, now.range.hi) * 5) * (e.shiftKey ? 10 : 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : step;
        if (focus === 'lo') state.lo = snap(state.lo + dx);
        else state.hi = snap(state.hi + dx);
        update();
      } else if (e.key === 'Tab' && usesLo(state.mode) && usesHi(state.mode) && !e.shiftKey && focus === 'lo') {
        e.preventDefault();
        focus = 'hi';
      } else if (e.key.toLowerCase() === 'm') {
        const order: CalcMode[] = ['interval', 'left', 'right', 'two'];
        set(switchMode(state, order[(order.indexOf(state.mode) + 1) % 4] as CalcMode));
      } else if (e.key.toLowerCase() === 'c') set({ cumulative: !state.cumulative });
      else if (e.key.toLowerCase() === 't' && info.discrete) set({ table: !state.table });
    });
    canvas.addEventListener('blur', () => render());

    // typing a probability moves the bound (design 7.2)
    result.addEventListener('change', () => {
      const q = Number(result.value);
      if (!(q >= 0 && q <= 1) || state.mode === 'interval') {
        render();
        return;
      }
      const base = calcLines(state, n, now.range)[0] as string;
      const ask = state.mode === 'left' ? [`calcLowTmp = Quantile(${n.d}, ${q})`] : state.mode === 'right' ? [`calcLowTmp = Quantile(${n.d}, ${q}, "right")`] : [`calcLowTmp = Quantile(${n.d}, ${q / 2})`, `calcHighTmp = Quantile(${n.d}, ${q / 2}, "right")`];
      const { fig } = run([base, ...ask]);
      const v1 = fig.get('calcLowTmp')?.cell;
      const v2 = fig.get('calcHighTmp')?.cell;
      if (!v1?.defined || typeof v1.value !== 'number') return;
      if (state.mode === 'left') state.hi = v1.value;
      else if (state.mode === 'right') state.lo = v1.value;
      else if (v2?.defined && typeof v2.value === 'number') {
        state.lo = v1.value;
        state.hi = v2.value;
      }
      if (!info.discrete) {
        state.lo = Number(state.lo.toPrecision(6));
        state.hi = Number(state.hi.toPrecision(6));
      }
      render();
      if (info.discrete) say(`Asked ${q}; for a discrete distribution the nearest it reaches is shown.`);
    });

    // simulate (ui.md 6): the figure seed and a sample of the distribution
    const sim = el('div', 'row sim');
    const seedNow = Number(/^@seed (\d+)/m.exec(session.figure.toScript())?.[1] ?? '1');
    sim.append(number('Seed', seedNow, (v) => {
      const s = Math.max(0, Math.round(Number(v) || 0));
      const r = session.applyLines([`@seed ${s}`], 'Seed');
      say(r.ok ? `Seed ${s}.` : r.error.message);
    }, { min: '0', step: '1' }));
    const reroll = el('button', 'secondary', '↻ Reroll');
    reroll.type = 'button';
    reroll.title = 'Add one to the figure seed: every random object draws new numbers';
    reroll.addEventListener('click', () => {
      const r = session.applyLines([`@seed ${seedNow + 1}`], 'Reroll');
      say(r.ok ? `Seed ${seedNow + 1}: new random numbers.` : r.error.message);
      render();
    });
    sim.append(reroll, number('n', state.sampleN, (v) => set({ sampleN: Math.min(100000, Math.max(1, Math.round(Number(v) || 1))) }), { min: '1', max: '100000' }));
    const sampleBtn = el('button', 'secondary', 'Add a sample');
    sampleBtn.type = 'button';
    sampleBtn.title = 'Add the distribution, a sample of n draws and its chart to the figure';
    sampleBtn.addEventListener('click', () => {
      const xs = free('xs');
      const chart = free('tally');
      const lines = [calcLines(state, n, now.range)[0] as string, `${xs} = Sample(${n.d}, ${state.sampleN})`, info.discrete ? `${chart} = BarChart(${xs}, 1)` : `${chart} = Histogram(${xs}, scale = "density")`];
      const r = session.applyLines(lines, 'Sample');
      say(r.ok ? r.message : r.error.message);
    });
    const stripBtn = el('button', 'secondary', 'Simulation strip');
    stripBtn.type = 'button';
    stripBtn.title = 'Show the simulation strip under the graph: seed, sample sizes, Run and the tally';
    stripBtn.addEventListener('click', () => element.dispatchEvent(new CustomEvent('open-simulation', { bubbles: true })));
    sim.append(sampleBtn, stripBtn);
    body.append(el('h3', '', 'Simulate'), sim);

    actions(calcLines(state, n, now.range));
    requestAnimationFrame(update);
  }

  /* ------------------------------ statistics tab ------------------------------ */

  function renderStatistics(): void {
    const t = testOf(state.test);
    const top = el('div', 'row');
    top.append(select('Procedure', TEST_MENU.map((x) => [x.name, x.label] as const), t.name, (v) => set({ test: v, data: '' })));
    body.append(top);
    if (t.list) {
      const lists = session.figure.objects().filter((o) => o.typeText === 'List<Number>').map((o) => o.name);
      const src = el('div', 'row');
      src.append(select('Data', [['', 'Summary numbers'], ...lists.map((x) => [x, `list ${x}`] as const)], state.data, (v) => set({ data: v })));
      body.append(src);
    }
    const inputs = el('div', 'row');
    for (const i of t.inputs) {
      if (state.data && t.list?.replaces.includes(i.name)) continue;
      inputs.append(number(i.name, state.inputs[i.name] ?? i.def, (v) => {
        state.inputs[i.name] = v;
        render();
      }, { step: 'any' }));
    }
    body.append(inputs);
    const opts = el('div', 'row');
    if (t.interval) opts.append(number('Level', state.level, (v) => set({ level: Math.min(0.999, Math.max(0.5, Number(v) || 0.95)) }), { min: '0.5', max: '0.999', step: '0.01' }));
    else opts.append(segmented([['two', 'H₁: ≠'], ['left', 'H₁: <'], ['right', 'H₁: >']] as const, state.tail, (v) => set({ tail: v }), 'Alternative'));
    if (t.pooled) opts.append(check('pooled', state.pooled, (v) => set({ pooled: v })));
    body.append(opts);

    const name = free('r');
    const line = statLine(state, name);
    const { fig, errors } = run([line]);
    const cell = fig.get(name)?.cell;
    for (const e of errors) body.append(el('p', 'lab-error', e));
    if (cell && !cell.defined) body.append(el('p', 'lab-error', `Undefined: ${cell.reason.replace(/_/g, ' ')}${cell.detail ? ` — ${cell.detail}` : ''}`));
    if (cell?.defined) {
      const F = (cell.value as { fields: Record<string, unknown> }).fields;
      if (t.interval) {
        body.append(statsTable([['low', F['lo']], ['high', F['hi']], ['estimate', F['estimate']], ['margin', F['margin']], ['standard error', F['se']], ['level', F['level']]]));
      } else {
        const p = F['p'] as number;
        body.append(statsTable([['statistic', F['statistic']], ['p', p], ['df', F['df']], ['estimate', F['estimate']], ['standard error', F['se']]]));
        const d = F['dist'];
        if (isDistLike(d) && typeof F['statistic'] === 'number') body.append(miniCurve(d as never, F['statistic'], String(F['tail'] ?? state.tail), colorAt(0)));
        body.append(el('p', 'sentence', `If H₀ were true, a result at least this extreme would happen ${pSentence(p)} (p = ${fmt(p)}).`));
      }
    }
    actions([line]);
  }

  function actions(lines: readonly string[]): void {
    const act = el('div', 'lab-actions');
    const addBtn = el('button', 'primary', 'Add to figure');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
      const r = session.applyLines(lines, 'Probability');
      say(r.ok ? r.message : r.error.message);
    });
    const copyBtn = el('button', 'secondary', 'Copy as lines');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard?.writeText(lines.join('\n')).then(() => say('Lines copied.'), () => say('Could not copy.'));
    });
    act.append(addBtn, copyBtn);
    body.append(act, el('h3', '', 'Lines'), el('pre', 'lab-lines', lines.join('\n')));
  }

  closeBtn.addEventListener('click', () => {
    api.close();
    element.dispatchEvent(new CustomEvent('lab-closed', { bubbles: true }));
  });
  const api: ProbCalc = {
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
      // the statistics tab reads the figure's lists; the distribution tab only its own lines
      if (open && state.tab === 'statistics') render();
    },
  };
  return api;
}

/** Bounds that make sense for a newly picked distribution: about one standard deviation each side of the centre. */
function defaultBounds(d: DistInfo): { lo: number; hi: number } {
  switch (d.kind) {
    case 'Normal': case 'StudentT': case 'Cauchy': case 'Logistic': return { lo: -1, hi: 1 };
    case 'ChiSquared': return { lo: 1, hi: 5 };
    case 'FDist': return { lo: 0.5, hi: 2 };
    case 'Exponential': return { lo: 0.5, hi: 2 };
    case 'Uniform': return { lo: 0.25, hi: 0.75 };
    case 'Gamma': case 'Erlang': return { lo: 2, hi: 4 };
    case 'Beta': return { lo: 0.2, hi: 0.4 };
    case 'Weibull': return { lo: 0.5, hi: 1.2 };
    case 'LogNormal': return { lo: 0.7, hi: 1.5 };
    case 'Triangular': return { lo: 0.5, hi: 1.5 };
    case 'Binomial': return { lo: 3, hi: 7 };
    case 'Poisson': return { lo: 2, hi: 6 };
    case 'Geometric': return { lo: 0, hi: 3 };
    case 'NegBinomial': return { lo: 1, hi: 4 };
    case 'HyperGeometric': return { lo: 3, hi: 5 };
    case 'Bernoulli': return { lo: 1, hi: 1 };
    case 'DiscreteUniform': return { lo: 2, hi: 5 };
    case 'Zipf': return { lo: 1, hi: 3 };
    default: return { lo: 2, hi: 5 };
  }
}

/** Keeps the bounds that still make sense when the mode changes (design 7.2). */
export function switchMode(s: CalcState, m: CalcMode): Partial<CalcState> {
  if (s.mode === 'left' && m === 'right') return { mode: m, lo: s.hi };
  if (s.mode === 'right' && m === 'left') return { mode: m, hi: s.lo };
  if (m === 'two' && s.lo > s.hi) return { mode: m, lo: s.hi, hi: s.lo };
  return { mode: m };
}

/** The probability calculator (probability design 7, ui.md): its lines, and the panel in the mounted page. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DIST_MENU, calcLines, defaultCalc, pSentence, probLabel, statLine, switchMode } from '../src/probcalc';
import type { CalcNames } from '../src/probcalc';
import { KernelSession } from '../src/session';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

const N: CalcNames = { d: 'd', lo: 'a', hi: 'b', curve: 'curve', area: 'area', p: 'p', nd: 'nd', nc: 'nc' };

describe('calculator lines (design 7.1, 7.2)', () => {
  it('a normal in interval mode', () => {
    expect(calcLines(defaultCalc(), N, { lo: -4, hi: 4 })).toEqual([
      'd = Normal(0, 1)',
      'a = -1 in -4..4 step 0.05',
      'b = 1 in -4..4 step 0.05',
      'curve = Pdf(d)',
      'area = Shade(d, a, b)',
      'p = Prob(d, a, b)',
    ]);
  });

  it('a binomial with ends, each mode, the cumulative curve and the overlay', () => {
    const s = { ...defaultCalc(), kind: 'Binomial', params: ['10', '0.5'], lo: 3, hi: 7, loEnd: '(' as const };
    expect(calcLines(s, N, { lo: -0.5, hi: 10.5 })).toEqual([
      'd = Binomial(10, 0.5)',
      'a = 3 in -1..11 step 1',
      'b = 7 in -1..11 step 1',
      'curve = BarChart(d)',
      'area = Shade(d, a, b, "(]")',
      'p = Prob(d, a, b, "(]")',
    ]);
    expect(calcLines({ ...s, mode: 'left' }, N).slice(-2)).toEqual(['area = Shade(d, -inf, b, "[]")', 'p = Prob(d, -inf, b, "[]")']);
    expect(calcLines({ ...s, mode: 'right' }, N).slice(-2)).toEqual(['area = Shade(d, a, inf, "(]")', 'p = Prob(d, a, inf, "(]")']);
    expect(calcLines({ ...s, mode: 'two' }, N).slice(-2)).toEqual(['area = ShadeTails(d, a, b, "(]")', 'p = area.mass']);
    expect(calcLines({ ...s, cumulative: true, overlay: true }, N)).toContain('curve = Cdf(d)');
    expect(calcLines({ ...s, overlay: true }, N).slice(-2)).toEqual(['nd = NormalApprox(d)', 'nc = Pdf(nd)']);
  });

  it('every distribution in the picker runs with its default parameters, in every mode', () => {
    for (const info of DIST_MENU) {
      for (const mode of ['interval', 'left', 'right', 'two'] as const) {
        const s = new KernelSession();
        const lines = calcLines({ ...defaultCalc(), kind: info.kind, params: info.params.map((p) => p.def), mode, lo: 1, hi: 2, overlay: true }, N);
        const r = s.applyLines(lines, 'test');
        expect(r.ok, `${info.kind} ${mode}`).toBe(true);
        // a heavy-tailed distribution has no normal approximation: that overlay is undefined, rightly
        const bad = s.figure.objects().filter((o) => !o.cell.defined).map((o) => `${o.name}: ${o.cell.defined ? '' : o.cell.reason}`)
          .filter((x) => !/^n[dc]: (undefined_moment|input_undefined)$/.test(x));
        expect(bad, `${info.kind} ${mode}`).toEqual([]);
        const p = s.figure.value('p');
        expect(typeof p === 'number' && p >= 0 && p <= 1, `${info.kind} ${mode}`).toBe(true);
      }
    }
  });

  it('labels, mode switches and the p-value sentence', () => {
    const s = { ...defaultCalc(), lo: 3, hi: 7, loEnd: '(' as const };
    expect(probLabel(s, true)).toBe('P(3 < X ≤ 7)');
    expect(probLabel({ ...s, mode: 'right' }, true)).toBe('P(X > 3)');
    expect(switchMode({ ...s, mode: 'left' }, 'right')).toEqual({ mode: 'right', lo: 7 });
    expect(pSentence(0.0179)).toBe('about 1 time in 56');
    expect(pSentence(0.0001)).toBe('less than 1 time in 1,000');
  });

  it('statistics tab lines, from summary numbers or a list', () => {
    expect(statLine({ ...defaultCalc(), test: 'TTest', tail: 'right' }, 'r')).toBe('r = TTest(103, 15, 30, 100, "right")');
    expect(statLine({ ...defaultCalc(), test: 'TTest', data: 's', inputs: { mu0: '5' } }, 'r')).toBe('r = TTest(s, 5, "two")');
    expect(statLine({ ...defaultCalc(), test: 'ZInterval', level: 0.9 }, 'r')).toBe('r = ZInterval(103, 15, 30, 0.9)');
    expect(statLine({ ...defaultCalc(), test: 'TTest2', pooled: true }, 'r')).toBe('r = TTest2(52, 8, 40, 49, 9, 35, "two", true)');
    const s = new KernelSession();
    expect(s.applyLines([statLine({ ...defaultCalc(), test: 'ZPropTest2' }, 'r')], 't').ok).toBe(true);
    expect(s.figure.get('r')?.cell.defined).toBe(true);
  });
});

describe('the calculator panel', () => {
  let root: HTMLElement;
  let m: Mounted;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('opens with a normal and its lines, and adds them to the figure', () => {
    m.calc.open();
    expect(root.querySelector('.probcalc .lab-lines')?.textContent).toContain('Normal(0, 1)');
    const add = [...root.querySelectorAll<HTMLButtonElement>('.probcalc .lab-actions button')].find((b) => b.textContent === 'Add to figure') as HTMLButtonElement;
    add.click();
    expect(m.session.figure.get('d1')?.type).toBe('ContinuousDistribution');
    expect(m.session.figure.value('prob1')).toBeCloseTo(0.6826894921, 9);
  });

  it('the statistics tab shows a test with the p-value sentence', () => {
    m.calc.open();
    m.calc.state.tab = 'statistics';
    m.calc.state.tail = 'right';
    m.calc.refresh();
    expect(root.querySelector('.probcalc .sentence')?.textContent).toMatch(/If H₀ were true/);
  });
});

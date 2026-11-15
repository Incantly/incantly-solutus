/** Algebra in the studio (cas ui.md 1 and 5; .kiro/specs/cas R2.7 and R3). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { casEngineReady } from '@incantly/kernel';
import { loadCasEngine } from '../src/registry';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

describe('algebra in the studio', () => {
  let root: HTMLElement;
  let m: Mounted;
  const row = (n: string): HTMLElement => root.querySelector(`.expr[data-name="${n}"]`) as HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('a line made before the engine arrived is computed once it is in (R2.7)', async () => {
    if (!casEngineReady()) {
      m.session.applyLines(['p = Expr(x^2 - 1)'], 'test');
      expect(m.session.figure.get('p')?.cell.defined).toBe(false);
    }
    await loadCasEngine();
    if (!m.session.figure.get('p')) m.session.applyLines(['p = Expr(x^2 - 1)'], 'test');
    expect(m.session.figure.get('p')?.cell.defined).toBe(true);
    expect(m.session.hasPending()).toBe(false);
  });

  it('an Expr row is typeset maths; an exact value has =, a decimal one ≈ (R3.1)', async () => {
    await loadCasEngine();
    m.session.applyLines(['p = Expr(x^2 - 5x + 6)', 'n = Numeric(pi, 6)', 'fp = Factor(p)'], 'test');
    const v = row('p').querySelector('.value.typeset') as HTMLElement;
    expect(v.querySelector('svg')).not.toBeNull();
    expect(v.textContent?.startsWith('= ')).toBe(true);
    expect(row('n').querySelector('.value')?.textContent?.startsWith('≈ ')).toBe(true);
    expect(row('fp').querySelector('svg')).not.toBeNull();
  });

  it('the CAS example applies every line and draws its curve and roots (R3.2)', async () => {
    await loadCasEngine();
    m.loadExample('cas');
    const objs = m.session.figure.objects();
    expect(objs.every((o) => o.cell.defined)).toBe(true);
    expect(m.session.figure.value('R1')).toEqual({ x: 2, y: 0 });
    expect(m.session.figure.value('R2')).toEqual({ x: 3, y: 0 });
    expect(m.session.figure.value('ok')).toBe(true);
    expect(String(m.session.figure.value('label'))).toMatch(/^\$.*\$$/);
    // round 8 rows: an integral through a pole, trig solving, cyclotomic factors
    expect(Number(m.session.figure.value('Ik'))).toBeCloseTo(4, 6);
    expect(row('f12').querySelector('svg')).not.toBeNull();
    expect(row('tr').querySelector('svg')).not.toBeNull();
  });

  it('an unknown letter offers to make it a Symbol', async () => {
    await loadCasEngine();
    const r = m.session.submit('s = Solve(k*x == 1, x)');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.suggest).toContain('k = Symbol()');
  });
});

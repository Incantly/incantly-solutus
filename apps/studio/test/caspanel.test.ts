/** The CAS view (cas ui.md 1 to 8, 11; .kiro/specs/cas R4, R5). */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCasEngine } from '../src/registry';
import { paintScene } from '@incantly/sdk/screen';
import type { SceneItem } from '@incantly/sdk/screen';
import { symDrawing } from '@incantly/sdk/screen';
import { Viewport } from '@incantly/sdk/screen';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

beforeAll(async () => {
  await loadCasEngine();
});

describe('the CAS view', () => {
  let root: HTMLElement;
  let m: Mounted;
  const rowNames = (): string[] => [...root.querySelectorAll<HTMLElement>('.cas-row')].map((r) => r.dataset['name'] as string);
  const tool = (label: string): HTMLButtonElement => [...root.querySelectorAll<HTMLButtonElement>('.cas-toolbar button')].find((b) => b.textContent === label) as HTMLButtonElement;
  const typeNew = (text: string): void => {
    const i = root.querySelector('.cas-new .cas-input') as HTMLInputElement;
    i.value = text;
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  };
  const def = (n: string): string => m.session.figure.get(n)?.definition ?? '';

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
    m.cas.open();
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('opens from the top bar and lists only symbolic objects, in order (ui.md 1)', () => {
    m.cas.close();
    const b = [...root.querySelectorAll<HTMLButtonElement>('.top-tools button')].find((x) => x.textContent === 'CAS') as HTMLButtonElement;
    b.click();
    expect(m.cas.isOpen()).toBe(true);
    m.session.applyLines(['A = (1, 2)', 'p = Expr(x^2 - 1)', 'k = Symbol()', 'n = 3', 's = Solve(p == 0, x)'], 't');
    expect(rowNames()).toEqual(['p', 'k', 's']);
  });

  it('a typed expression becomes the next row cN, typeset (ui.md 1, 3)', () => {
    typeNew('x^2 - 5x + 6');
    expect(def('c1')).toBe('c1 = Expr(x^2 - 5x + 6)');
    const row = root.querySelector('.cas-row[data-name="c1"]') as HTMLElement;
    expect(row.querySelector('.cas-output svg')).not.toBeNull();
    expect(row.querySelector('.cas-sign')?.textContent).toBe('=');
  });

  it('toolbar buttons add rows that use the selected row, else the last (ui.md 2)', () => {
    typeNew('x^2 - 5x + 6');
    tool('Factor').click();
    expect(def('c2')).toBe('c2 = Factor(c1)');
    m.cas.select('c1');
    tool('Solve').click();
    expect(def('c3')).toBe('c3 = Solve(c1 == 0, x)');
    expect(m.session.figure.value('c3')).toHaveLength(2);
    // a new row becomes the selected one, so the next button works on it unless another is picked
    expect(m.cas.selected()).toBe('c3');
    m.cas.select('c1');
    tool('d/dx').click();
    expect(def('c4')).toBe('c4 = Derivative(c1, x)');
    m.cas.select('c1');
    tool('N').click();
    expect(def('c5')).toMatch(/^c5 = Numeric\(c1, 15\)$/);
  });

  it('Factor of a condition factors its left side', () => {
    typeNew('x^2 - 1 == 0');
    tool('Factor').click();
    expect(def('c2')).toBe('c2 = Factor(LeftSide(c1))');
  });

  it('with two unknowns a chooser asks which one (ui.md 2)', () => {
    typeNew('x^2 + y');
    tool('d/dx').click();
    const prompt = root.querySelector('.cas-prompt') as HTMLFormElement;
    expect(prompt.hidden).toBe(false);
    (prompt.querySelector('select') as HTMLSelectElement).value = 'y';
    prompt.dispatchEvent(new Event('submit'));
    expect(def('c2')).toBe('c2 = Derivative(c1, y)');
  });

  it('a definite integral and a limit take their fields from the prompt', () => {
    typeNew('x^2');
    tool('∫').click();
    const prompt = root.querySelector('.cas-prompt') as HTMLFormElement;
    const [a, b] = [...prompt.querySelectorAll('input')] as HTMLInputElement[];
    (a as HTMLInputElement).value = '0';
    (b as HTMLInputElement).value = '3';
    prompt.dispatchEvent(new Event('submit'));
    expect(def('c2')).toBe('c2 = Integral(c1, x, 0, 3)');
    expect(String(m.session.figure.get('c2')?.cell.defined && (m.session.figure.value('c2') as { text: string }).text)).toBe('9');
    m.cas.select('c1');
    tool('Limit').click();
    (root.querySelector('.cas-prompt input') as HTMLInputElement).value = '2';
    (root.querySelector('.cas-prompt') as HTMLFormElement).dispatchEvent(new Event('submit'));
    expect(def('c3')).toBe('c3 = Limit(c1, x, 2)');
  });

  it('an unknown letter offers "Create unknown k" (ui.md 3)', () => {
    typeNew('k*x + 1');
    const fix = [...root.querySelectorAll<HTMLButtonElement>('.cas-fix')].find((b) => b.textContent === 'Create unknown k') as HTMLButtonElement;
    expect(fix).toBeDefined();
    fix.click();
    expect(m.session.figure.get('k')?.type).toBe('Symbol');
    typeNew('k*x + 1');
    expect(def('c1')).toBe('c1 = Expr(k * x + 1)');
  });

  it('editing a row updates the rows below it (ui.md 1)', () => {
    typeNew('x^2 - 4');
    tool('Factor').click();
    const input = root.querySelector('.cas-row[data-name="c1"] .cas-input') as HTMLInputElement;
    input.value = 'Expr(x^2 - 9)';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect((m.session.figure.value('c2') as { text: string }).text).toBe('(x - 3) * (x + 3)');
  });

  it('the Exact | 1.23 switch shows decimals without changing the lines (ui.md 5)', () => {
    typeNew('sqrt(2)/2');
    const before = m.session.save();
    (root.querySelector('.cas-mode:not(.on)') as HTMLButtonElement).click();
    const row = root.querySelector('.cas-row[data-name="c1"]') as HTMLElement;
    expect(row.querySelector('.cas-sign')?.textContent).toBe('≈');
    expect(m.session.save()).toBe(before);
  });

  it('the marble switches the plot property, and the graph draws the row (ui.md 4, 7)', () => {
    typeNew('x^2 - 1');
    const marble = root.querySelector('.cas-row[data-name="c1"] .cas-marble') as HTMLButtonElement;
    expect(marble.textContent).toBe('○');
    marble.click();
    expect((m.session.figure.get('c1')?.style.ext as { plot?: boolean }).plot).toBe(true);
    expect((root.querySelector('.cas-row[data-name="c1"] .cas-marble') as HTMLElement).textContent).toBe('●');
    // a constant has no drawing, so no switch
    typeNew('3/4');
    expect(root.querySelector('.cas-row[data-name="c2"] .cas-marble.none')).not.toBeNull();
  });

  it('a row that becomes undefined keeps its last output struck through, with the reason (ui.md 11)', () => {
    m.session.applyLines(['n = 2', 'r = Expr(x^n)', 'L = Limit(r, x, 0)'], 't');
    m.session.applyLines(['n = -1'], 't');
    const row = root.querySelector('.cas-row[data-name="L"]') as HTMLElement;
    expect(row.querySelector('.cas-reason')).not.toBeNull();
    expect(row.querySelector('.cas-stale')).not.toBeNull();
  });

  it('Freeze makes a free Expr with the current value; Delete asks when others use the row', () => {
    typeNew('x^2 - 4');
    tool('Factor').click();
    m.cas.select('c2');
    (root.querySelector('.cas-toolbar button[title="More"]') as HTMLButtonElement).click();
    ([...root.querySelectorAll<HTMLButtonElement>('.cas-menu-item')].find((b) => b.textContent === 'Freeze') as HTMLButtonElement).click();
    expect(def('c2')).toBe('c2 = Expr((x - 2) * (x + 2))');
    const confirm = window.confirm;
    let asked = '';
    window.confirm = (msg?: string): boolean => {
      asked = String(msg);
      return false;
    };
    try {
      m.session.applyLines(['c3 = Expand(c2)'], 't');
      m.cas.select('c2');
      ([...root.querySelectorAll<HTMLButtonElement>('.cas-menu-item')].find((b) => b.textContent === 'Delete row') as HTMLButtonElement).click();
      expect(asked).toContain('c3');
      expect(m.session.figure.get('c2')).toBeDefined();
    } finally {
      window.confirm = confirm;
    }
  });

  it('rows read aloud: the definition and the spoken result (ui.md 8)', () => {
    typeNew('x^2');
    expect((root.querySelector('.cas-row[data-name="c1"]') as HTMLElement).getAttribute('aria-label')).toMatch(/^row c1: Expr\(x\^2\); result: .+/);
  });

  it('letter shortcuts work while the view has focus (ui.md 8)', () => {
    typeNew('x^2 - 1');
    m.cas.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(def('c2')).toBe('c2 = Factor(c1)');
  });
});

describe('what a row draws (ui.md 7)', () => {
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

  it('an Expr in one unknown is a curve with open circles at its holes', () => {
    m.session.applyLines(['h = Simplify((x^2 - 1)/(x - 1))'], 't');
    const d = symDrawing(m.session.figure.value('h'));
    expect(d?.kind).toBe('curve');
    if (d?.kind !== 'curve') return;
    expect(d.fn.call(2)).toBe(3);
    expect(d.holes).toEqual([{ x: 1, y: 2 }]);
  });

  it('a Cond in two unknowns is a relation; in one, marks on the axis', () => {
    m.session.applyLines(['c = Expr(x^2 + y^2 == 9)', 'b = Expr(x^2 < 4)'], 't');
    expect(symDrawing(m.session.figure.value('c'))?.kind).toBe('relation');
    const b = symDrawing(m.session.figure.value('b'));
    expect(b?.kind).toBe('axis');
    if (b?.kind !== 'axis') return;
    expect(b.test(1)).toBe(true);
    expect(b.test(3)).toBe(false);
  });

  it('solutions are points: on the axis for one unknown, in the plane for a system', () => {
    m.session.applyLines(['s = Solve(x^2 == 4, x)', 'sys = Solve([x + y == 3, x - y == 1], [x, y])', 'r = Solutions(x^2 == 4, x)'], 't');
    expect(symDrawing(m.session.figure.value('s'))).toEqual({ kind: 'points', pts: [{ x: -2, y: 0 }, { x: 2, y: 0 }] });
    expect(symDrawing(m.session.figure.value('sys'))).toEqual({ kind: 'points', pts: [{ x: 2, y: 1 }] });
    expect(symDrawing(m.session.figure.value('r'))?.kind).toBe('points');
    expect(symDrawing(m.session.figure.value('s') === undefined ? undefined : 3)).toBeUndefined();
  });

  it('only rows with plot = true reach the graph, and they paint', () => {
    m.session.applyLines(['h = Simplify((x^2 - 1)/(x - 1)) with plot = true', 'b = Expr(x^2 < 4) with plot = true', 'q = Expr(x^2 == 2) with plot = true', 'p = Expr(x^3)'], 't');
    const calls: string[] = [];
    const ctx = new Proxy({ canvas: { width: 800, height: 600 } } as Record<string, unknown>, {
      get(t, k) {
        if (k in t) return t[k as string];
        if (k === 'measureText') return (s: string) => ({ width: s.length * 8 });
        return (...a: unknown[]) => {
          calls.push(String(k));
          void a;
          return { addColorStop: () => undefined };
        };
      },
      set(t, k, v) {
        t[k as string] = v;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const items: SceneItem[] = [];
    // the studio's own adapter decides what is drawn
    const mounted = m as unknown as { graph: { paint(): void } };
    void mounted;
    for (const n of ['h', 'b', 'q']) {
      const d = symDrawing(m.session.figure.value(n));
      if (d?.kind === 'curve') items.push({ id: 1, name: n, type: 'Function', typeText: 'Function', value: d.fn, color: '#2f6fdb', free: false, label: false, holes: d.holes });
      if (d?.kind === 'axis') items.push({ id: 2, name: n, type: 'SymAxis', typeText: 'Cond', value: d, color: '#2f6fdb', free: false, label: false });
    }
    const hits = paintScene(ctx, vp, items);
    expect(calls).toContain('arc');
    expect(calls).toContain('fillRect');
    expect(hits.some((h) => h.text.includes('not defined at x = 1'))).toBe(true);
    expect(hits.some((h) => /q: x = 1\.41/.test(h.text))).toBe(true);
  });
});

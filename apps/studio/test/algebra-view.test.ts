/** The algebra view in the studio (algebra-view design 3, ui.md; .kiro/specs/algebra-view R1 to R6). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

describe('the algebra view in the studio', () => {
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
  const typeLine = (text: string): void => {
    const input = root.querySelector<HTMLInputElement>('.expr-new .expr-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };
  const row = (name: string): HTMLElement => root.querySelector(`.expr[data-name="${name}"]`) as HTMLElement;

  it('shows the maths text and the value only when it adds something', () => {
    typeLine('A = (1, 2)');
    typeLine('B = (5, 2)');
    typeLine('M = Midpoint(A, B)');
    typeLine('f(x) = x^2 - 2*x');
    expect(row('A').querySelector('.expr-display')?.textContent).toBe('A = (1, 2)');
    expect(row('M').querySelector('.value')?.textContent).toBe('= (3, 2)');
    expect(row('f').querySelector('.expr-display')?.textContent).toBe('f(x) = x² − 2x');
  });

  it('the marble writes a visible line that undo takes back', () => {
    typeLine('A = (1, 2)');
    (row('A').querySelector('.swatch') as HTMLButtonElement).click();
    expect(m.session.figure.get('A')?.style.visible).toBe(false);
    expect(m.session.save()).toMatch(/A with visible = false|visible = false/);
    m.undo();
    expect(m.session.figure.get('A')?.style.visible).toBe(true);
  });

  it('expands a row: made from, used by, description, and the undefined chain', () => {
    typeLine('A = (1, 2)');
    typeLine('B = (5, 2)');
    typeLine('M = Midpoint(A, B)');
    typeLine('s = Segment(M, A)');
    (row('M').querySelector('.expr-toggle') as HTMLButtonElement).click();
    const deps = row('M').querySelector('.expr-deps') as HTMLElement;
    expect(deps.hidden).toBe(false);
    expect(deps.textContent).toMatch(/made fromAB/);
    expect(deps.textContent).toMatch(/used bys/);
    expect(deps.textContent).toMatch(/Midpoint of A and B/);
  });

  it('settings: display mode, sort with groups, filter', () => {
    typeLine('a = 3');
    typeLine('A = (1, 2)');
    m.expressions.setPrefs({ mode: 'description' });
    expect(row('A').querySelector('.expr-display')?.textContent).toBe('A: Point');
    m.expressions.setPrefs({ mode: 'definitionAndValue', sort: 'type' });
    expect([...root.querySelectorAll('.expr-group')].filter((g) => !(g as HTMLElement).hidden).map((g) => g.textContent)).toEqual(['▾ Numbers and sliders · 1', '▾ Points and vectors · 1']);
    m.expressions.setPrefs({ sort: 'creation', filter: { text: 'A', onlyUndefined: false, onlyHidden: false } });
    expect(row('a').hidden).toBe(false);
    m.expressions.setPrefs({ filter: { text: '(1', onlyUndefined: false, onlyHidden: false } });
    // a filtered-out row leaves the page (the list keeps only rows it shows, design 3.16)
    expect(row('a')).toBeNull();
    expect(row('A').hidden).toBe(false);
  });

  it('a missing name is one click from a slider, then the line runs', () => {
    typeLine('y1 = k * 2');
    const chip = [...root.querySelectorAll<HTMLButtonElement>('.expr-new .err-fix')].find((b) => b.textContent === 'Make slider k') as HTMLButtonElement;
    expect(chip).toBeTruthy();
    chip.click();
    expect(m.session.figure.get('k')?.range).toEqual({ min: -5, max: 5, step: 0.1 });
    expect(m.session.figure.value('y1')).toBe(2);
    m.undo();
    expect(m.session.figure.objects().length).toBe(0);
  });

  it('@algebra input restricts the commands; off hides the new line', () => {
    m.session.applyLines(['@algebra input Midpoint'], 'lesson');
    m.expressions.update();
    typeLine('A = (0, 0)');
    typeLine('B = (2, 0)');
    typeLine('s = Segment(A, B)');
    expect(root.querySelector('.expr-new .err-msg')?.textContent).toBe('This activity allows Midpoint.');
    typeLine('M = Midpoint(A, B)');
    expect(m.session.figure.get('M')).toBeTruthy();
    m.session.applyLines(['@algebra input off'], 'lesson');
    m.expressions.update();
    expect((root.querySelector('.expr-new') as HTMLElement).hidden).toBe(true);
  });

  it('history with Alt+Up, and a next-step card after a function', () => {
    typeLine('f(x) = x^2 - 1');
    const card = row('f').querySelector('.expr-card') as HTMLElement;
    expect(card.hidden).toBe(false);
    expect(card.textContent).toMatch(/Mark where f crosses the x-axis/);
    (card.querySelector('.card-add') as HTMLButtonElement).click();
    expect(m.session.figure.objects().some((o) => /Roots\(f/.test(o.definition))).toBe(true);
    const input = root.querySelector<HTMLInputElement>('.expr-new .expr-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    expect(input.value).toBe('f(x) = x^2 - 1');
  });

  it('signature help bolds the parameter being typed and cycles forms', () => {
    typeLine('A = (0, 0)');
    const input = root.querySelector<HTMLInputElement>('.expr-new .expr-input') as HTMLInputElement;
    input.value = 'c = Circle(A, ';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input'));
    const sig = root.querySelector('.signature') as HTMLElement;
    expect(sig.hidden).toBe(false);
    expect(sig.querySelector('.sig-param.on')?.textContent).toBe('radius: Number');
    expect(sig.querySelector('.sig-summary')?.textContent).toBe('circle by centre and radius');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    expect(sig.querySelector('.sig-more')?.textContent).toMatch(/^2 of 5 forms · 4 fit so far/);
  });
});

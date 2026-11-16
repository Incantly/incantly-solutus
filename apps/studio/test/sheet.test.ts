/** The spreadsheet view (spreadsheet ui; .kiro/specs/spreadsheet R8). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cellNumber, cellShows, editText } from '../src/sheet/grid';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

describe('the sheet view', () => {
  let root: HTMLElement;
  let m: Mounted;
  const cell = (n: string): HTMLElement | null => root.querySelector<HTMLElement>(`.sheetpanel [data-cell="${n}"]`);
  const val = (n: string): unknown => m.session.figure.value(n);
  const key = (k: string, extra: KeyboardEventInit = {}): void => {
    root.querySelector('.sheet-scroll')?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
  };
  const at = (c0: number, r0: number, c1 = c0, r1 = r0): void => m.sheet.select({ c0, r0, c1, r1 });

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
    m.sheet.open();
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('opens from the top bar and shows headers and visible cells only (ui 1, 9)', () => {
    m.sheet.close();
    const b = [...root.querySelectorAll<HTMLButtonElement>('.top-tools button')].find((x) => x.textContent === 'Sheet') as HTMLButtonElement;
    b.click();
    expect(m.sheet.isOpen()).toBe(true);
    expect(root.querySelector('.sheet-scroll')?.getAttribute('role')).toBe('grid');
    expect(root.querySelectorAll('.colhead').length).toBeGreaterThan(3);
    expect(cell('A1')).not.toBeNull();
    expect(cell('A100')).toBeNull();
  });

  it('typing in a cell writes a line; the first edit adds the sheet', () => {
    at(1, 1);
    expect(m.sheet.commit('3')).toBe(true);
    expect(m.session.figure.directive('sheet')).toEqual(['26', '100']);
    expect(val('A1')).toBe(3);
    at(2, 1);
    expect(m.sheet.commit('=A1^2')).toBe(true);
    expect(m.session.figure.get('B1')?.definition).toBe('B1 = A1^2');
    expect(cell('B1')?.textContent).toBe('9');
    expect(cell('B1')?.classList.contains('formula')).toBe(true);
    expect(cell('A1')?.classList.contains('num')).toBe(true);
    // Enter moves down
    expect(m.sheet.selection()).toEqual({ c0: 2, r0: 2, c1: 2, r1: 2 });
  });

  it('a lone word is stored as text; a bad entry stays in edit with the error (ui 3)', () => {
    at(1, 1);
    m.sheet.commit('height');
    expect(val('A1')).toBe('height');
    at(1, 2);
    expect(m.sheet.commit('=1 +')).toBe(false);
    expect(root.querySelector<HTMLElement>('.sheet-error')?.hidden).toBe(false);
    expect(m.session.figure.get('A2')).toBeUndefined();
  });

  it('a cell can change its type by retyping', () => {
    at(1, 1);
    m.sheet.commit('5');
    at(1, 1);
    m.sheet.commit('hello');
    expect(val('A1')).toBe('hello');
  });

  it('an empty entry clears the cell', () => {
    at(1, 1);
    m.sheet.commit('5');
    at(1, 1);
    m.sheet.commit('');
    expect(m.session.figure.get('A1')).toBeUndefined();
  });

  it('the fill handle continues a series and the toast offers Undo (ui 5)', () => {
    at(1, 1);
    m.sheet.commit('1');
    m.sheet.commit('2');
    at(1, 1, 1, 2);
    m.sheet.fillTo({ c0: 1, r0: 1, c1: 1, r1: 6 });
    expect(val('A6')).toBe(6);
    const toast = root.querySelector<HTMLElement>('.sheet-toast') as HTMLElement;
    expect(toast.hidden).toBe(false);
    expect(toast.textContent).toContain('Filled 4 cells in A3:A6');
    (toast.querySelector('button') as HTMLButtonElement).click();
    expect(m.session.figure.get('A3')).toBeUndefined();
  });

  it('Ctrl+D writes a FillDown line; Delete writes ClearCells', () => {
    at(1, 1);
    m.sheet.commit('2');
    at(2, 1);
    m.sheet.commit('=A1*10');
    at(1, 2);
    m.sheet.commit('3');
    at(2, 1, 2, 2);
    key('d', { ctrlKey: true });
    expect(m.session.figure.get('B2')?.definition).toBe('B2 = A2 * 10');
    at(1, 1, 2, 2);
    key('Delete');
    expect(m.session.figure.objects().filter((o) => /^[A-Z]\d/.test(o.name))).toHaveLength(0);
  });

  it('copy and paste: tab-separated text in, references moved for internal copies', () => {
    at(1, 1);
    m.sheet.paste('x\ty\n1\t2\n3\t4');
    expect([val('A1'), val('B3')]).toEqual(['x', 4]);
    at(3, 2);
    m.sheet.commit('=A2+B2');
    at(3, 2);
    const text = m.sheet.copy();
    expect(text).toBe('3');
    at(3, 3);
    m.sheet.paste(text);
    expect(m.session.figure.get('C3')?.definition).toBe('C3 = A3 + B3');
  });

  it('the selection bar shows each tool line and makes the object; the summary adds up (ui 1, 4)', () => {
    at(1, 1);
    m.sheet.paste('1\t1\n2\t4\n3\t9');
    at(1, 1, 2, 3);
    const tools = [...root.querySelectorAll<HTMLButtonElement>('.sheet-tools button')];
    const pts = tools.find((b) => b.textContent === 'Points') as HTMLButtonElement;
    expect(pts.title).toBe('pts1 = PointsFrom(A1:B3)');
    pts.click();
    expect(val('pts1')).toEqual([{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 9 }]);
    expect(root.querySelector('.sheet-summary')?.textContent).toBe('Count 6 · Sum 20 · Mean 3.333333333');
    at(1, 1, 1, 3);
    expect((tools.find((b) => b.textContent === 'Points') as HTMLButtonElement).isConnected).toBe(false);
    const again = [...root.querySelectorAll<HTMLButtonElement>('.sheet-tools button')].find((b) => b.textContent === 'Points') as HTMLButtonElement;
    expect(again.disabled).toBe(true);
  });

  it('undefined cells show a short code with the reason; locked and input cells are marked (ui 2)', () => {
    m.session.applyLines(['@sheet 4 10', 'A1 = 0', 'A2 = 1 / A1', '@cell A1 input', '@cell B1 locked', 'B1 = 2'], 'setup', 'atomic');
    m.sheet.refresh();
    expect(cell('A2')?.textContent).toBe('#DIV');
    expect(cell('A2')?.title).toBeTruthy();
    expect(cell('A1')?.classList.contains('input')).toBe(true);
    expect(cell('B1')?.classList.contains('locked')).toBe(true);
    at(2, 1);
    expect(m.sheet.commit('5')).toBe(false);
    expect(val('B1')).toBe(2);
  });

  it('display helpers', () => {
    expect(cellNumber(1 / 3)).toBe('0.3333333333');
    expect(cellNumber(2e16)).toBe('2.0000e16');
    expect(cellNumber(1e-7)).toBe('1.0000e-7');
    expect(cellShows(undefined).kind).toBe('blank');
    m.session.applyLines(['@sheet 4 10', 'A1 = (1, 2)', 'A2 = "a\\nb"', 'A3 = true', 'B1 = A1'], 's', 'atomic');
    const o = (n: string) => m.session.figure.get(n);
    expect(cellShows(o('A1')).text).toBe('(1, 2)');
    expect(cellShows(o('A2')).text).toBe('a…');
    expect(cellShows(o('A3')).text).toBe('✓');
    expect(editText(o('A2'))).toBe('a\nb');
    expect(editText(o('B1'))).toBe('=A1');
  });
});

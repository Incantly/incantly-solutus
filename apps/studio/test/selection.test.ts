/**
 * Selection between the list and the canvas (algebra-view design 3.9), preselection for tools (tools-2d design 5.4)
 * and rerolling only the selected random object (probability ui.md 6).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSelection } from '../src/selection';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

describe('the selection model', () => {
  it('set, toggle, keep and hover, in pick order', () => {
    const s = createSelection();
    const seen: string[] = [];
    s.onChange((src) => seen.push(src));
    s.set('A');
    s.toggle('B');
    s.toggle('C');
    expect(s.names()).toEqual(['A', 'B', 'C']);
    s.toggle('B');
    expect(s.names()).toEqual(['A', 'C']);
    s.keep((n) => n !== 'A');
    expect(s.names()).toEqual(['C']);
    s.setHover('C');
    expect(s.hover()).toBe('C');
    s.set('C');
    s.clear();
    expect(s.names()).toEqual([]);
    // set, 3 toggles, keep, hover, clear; `set('C')` when only C is selected changes nothing
    expect(seen.length).toBe(7);
  });
});

describe('the selection in the studio', () => {
  let root: HTMLElement;
  let m: Mounted;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
    m.loadExample('selection');
  });
  afterEach(() => {
    m.dispose();
    root.remove();
  });
  const row = (name: string): HTMLElement => root.querySelector(`.expr[data-name="${name}"]`) as HTMLElement;
  const press = (el: HTMLElement, opts: PointerEventInit = {}): void => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...opts }));
  };

  it('a row click selects its object and marks the row', () => {
    press(row('A').querySelector('.expr-index') as HTMLElement);
    expect(m.selection.names()).toEqual(['A']);
    expect(row('A').classList.contains('selected')).toBe(true);
    press(row('B').querySelector('.expr-index') as HTMLElement);
    expect(m.selection.names()).toEqual(['B']);
    expect(row('A').classList.contains('selected')).toBe(false);
  });

  it('Shift and Ctrl/Cmd clicks add to the selection', () => {
    press(row('A').querySelector('.expr-index') as HTMLElement);
    press(row('B').querySelector('.expr-index') as HTMLElement, { shiftKey: true });
    press(row('C').querySelector('.expr-index') as HTMLElement, { metaKey: true });
    expect(m.selection.names()).toEqual(['A', 'B', 'C']);
    press(row('B').querySelector('.expr-index') as HTMLElement, { ctrlKey: true });
    expect(m.selection.names()).toEqual(['A', 'C']);
  });

  it('the marble still hides the object and does not select', () => {
    press(row('A').querySelector('.swatch') as HTMLElement);
    expect(m.selection.names()).toEqual([]);
  });

  it('hovering a row marks the object for the canvas', () => {
    row('c').dispatchEvent(new PointerEvent('pointerenter'));
    expect(m.selection.hover()).toBe('c');
    row('c').dispatchEvent(new PointerEvent('pointerleave'));
    expect(m.selection.hover()).toBeUndefined();
  });

  it('a pick on the canvas marks the row; Escape clears', () => {
    m.selection.set('C');
    expect(row('C').classList.contains('selected')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(m.selection.names()).toEqual([]);
    expect(row('C').classList.contains('selected')).toBe(false);
  });

  it('a deleted object leaves the selection', () => {
    m.selection.set('c');
    m.session.delete('c');
    expect(m.selection.names()).toEqual([]);
  });

  it('selected points are the first picks of a tool (tools-2d 5.4)', () => {
    m.selection.set('A');
    m.selection.toggle('B');
    m.tools.select('segment');
    const seg = m.session.figure.objects().find((o) => o.type === 'Segment');
    expect(seg?.definition).toMatch(/Segment\(A, B\)/);
  });

  it('with a random object selected, Reroll rerolls only it', () => {
    m.selection.set('xs');
    const reroll = [...root.querySelectorAll<HTMLButtonElement>('.sim-strip button')].find((b) => b.textContent?.startsWith('↻ Reroll')) as HTMLButtonElement;
    expect(reroll.textContent).toBe('↻ Reroll xs');
    const before = Array.from(m.session.figure.value('xs') as ArrayLike<number>);
    reroll.click();
    expect(Array.from(m.session.figure.value('xs') as ArrayLike<number>)).not.toEqual(before);
    expect(m.session.save()).toMatch(/xs .*reroll = 1/);
    expect(m.session.save()).not.toMatch(/^@seed/m);
  });
});

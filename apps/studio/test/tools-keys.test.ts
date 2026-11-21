/**
 * Tools by keyboard, Alt alternatives, the degenerate refusal and moving pending points
 * (tools-2d ui.md 2 Keyboard, design 6 angle and rotate, design 7.2 and 7.5, errors.md 2 degenerate).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolSession, toolById } from '@incantly/ui';
import type { ToolDone, ToolSpec } from '@incantly/ui';
import { Figure } from '@incantly/kernel';
import { studioRegistry } from '../src/registry';
import { figureHost } from '../src/tools-host';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

const registry = studioRegistry();
const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) if (!f.apply(l).ok) throw new Error(l);
  return f;
};
const session = (id: string, f: Figure): ToolSession => new ToolSession(toolById(id) as ToolSpec, figureHost(f, registry, 0.1));
const pt = (name: string) => [{ name, type: 'Point', dist: 0 }];

describe('Alt alternatives in the engine', () => {
  const f = fig(['A = (1, 0)', 'B = (0, 0)', 'C = (0, 1)']);
  it('Angle: Alt takes the reflex angle (the arms the other way round)', () => {
    const s = session('angle', f);
    s.click({ x: 1, y: 0 }, pt('A'));
    s.click({ x: 0, y: 0 }, pt('B'));
    const plain = session('angle', f);
    plain.click({ x: 1, y: 0 }, pt('A'));
    plain.click({ x: 0, y: 0 }, pt('B'));
    expect((plain.click({ x: 0, y: 1 }, pt('C')) as ToolDone).lines).toEqual(['α = Angle(A, B, C)']);
    const r = s.click({ x: 0, y: 1 }, pt('C'), { alt: true }) as ToolDone;
    expect(r.lines).toEqual(['α = Angle(C, B, A)']);
    expect(r.alt).toBe(true);
  });
  it('Rotate: Alt turns clockwise', () => {
    const s = session('rotate-angle', fig(['A = (1, 0)', 'B = (0, 0)', 'p = Polygon(A, B, (1, 1))']));
    s.click({ x: 0, y: 0 }, [{ name: 'p', type: 'Polygon', dist: 0 }]);
    s.click({ x: 0, y: 0 }, pt('B'));
    const r = s.entry('45°', { alt: true }) as ToolDone;
    expect(r.lines.some((l) => /Rotate\(p, -\(45deg\), B\)/.test(l))).toBe(true);
  });
  it('a typed literal with Alt becomes a slider, used by name (design 7.5)', () => {
    const s = session('circle-center-radius', f);
    s.click({ x: 0, y: 0 }, pt('B'));
    const r = s.entry('3', { alt: true }) as ToolDone;
    expect(r.lines[0]).toMatch(/^(\w+) = 3 in 0\.\.6 step 0\.1$/);
    const name = /^(\w+)/.exec(r.lines[0] as string)?.[1];
    expect(r.lines[1]).toBe(`c = Circle(B, ${name})`);
    const g = fig(['A = (1, 0)', 'B = (0, 0)', 'C = (0, 1)']);
    expect(g.applyBatch(r.lines, { mode: 'atomic' }).ok).toBe(true);
  });
  it('a pending free point moves before the next click (design 7.2), snapped to the grid', () => {
    const s = session('segment', f);
    s.view = { x0: -10, x1: 10, y0: -10, y1: 10 };
    s.click({ x: 3.01, y: 3.01 }, []);
    const tag = s.pending()[0]?.tag as string;
    expect(s.movePending(tag, { x: 5.003, y: -2.004 })).toBe(true);
    const r = s.click({ x: 0, y: 0 }, pt('B')) as ToolDone;
    expect(r.lines[0]).toMatch(/= \(5, -2\)$/);
  });
});

describe('tools in the studio by keyboard', () => {
  let root: HTMLElement;
  let m: Mounted;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined });
    const vp = m.graph.viewport;
    vp.resize(800, 600);
    vp.home();
  });
  afterEach(() => {
    m.tools.select('move');
    m.dispose();
    root.remove();
  });
  const key = (k: string, o: KeyboardEventInit = {}): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  };

  it('Ctrl+2 picks the second group\'s tool', () => {
    key('2', { ctrlKey: true });
    expect(m.tools.current()).toBe('point');
  });

  it('arrows move the virtual cursor and Enter clicks there: two points make a segment', () => {
    m.tools.select('segment');
    key('ArrowRight');
    const first = m.tools.cursor();
    expect(first).toBeDefined();
    key('Enter');
    key('ArrowUp', { shiftKey: true });
    const second = m.tools.cursor();
    expect((second?.py ?? 0) < (first?.py ?? 0)).toBe(true);
    key(' ');
    const seg = m.session.figure.objects().find((o) => o.type === 'Segment');
    expect(seg).toBeDefined();
    const pts = m.session.figure.objects().filter((o) => o.type === 'Point');
    expect(pts.length).toBe(2);
  });

  it('Tab cycles the hit list under the cursor', () => {
    m.session.applyLines(['A = (0, 0)', 'c = Circle(A, 2)'], 'setup');
    m.tools.select('segment');
    key('ArrowRight');
    key('ArrowLeft');
    key('Tab');
    expect(m.status.textContent).toMatch(/of \d+:/);
  });

  it('three points in a line are refused for a circle, and Alt places it anyway', () => {
    m.session.applyLines(['A = (0, 0)', 'B = (1, 0)', 'C = (2, 0)'], 'setup');
    const vp = m.graph.viewport;
    m.tools.select('circle-three-points');
    m.tools.graphTool.click(vp.px(0), vp.py(0), vp);
    m.tools.graphTool.click(vp.px(1), vp.py(0), vp);
    m.tools.graphTool.click(vp.px(2), vp.py(0), vp);
    expect(m.session.figure.objects().some((o) => o.type === 'Circle')).toBe(false);
    expect(m.status.textContent).toMatch(/in a line.*Alt/);
    m.tools.graphTool.click(vp.px(2), vp.py(0), vp, true);
    const c = m.session.figure.objects().find((o) => o.type === 'Circle');
    expect(c?.cell.defined).toBe(false);
  });

  it('a pending point is dragged in the strip, then the tool finishes', () => {
    const vp = m.graph.viewport;
    m.tools.select('segment');
    m.tools.graphTool.click(vp.px(1), vp.py(1), vp);
    expect(m.tools.graphTool.grab?.(vp.px(1), vp.py(1), vp)).toBe(true);
    m.tools.graphTool.dragTo?.(vp.px(-2), vp.py(3), vp);
    m.tools.graphTool.release?.();
    m.tools.graphTool.click(vp.px(4), vp.py(0), vp);
    const a = m.session.figure.get('A')?.cell.value as { x: number; y: number };
    expect(a.x).toBeCloseTo(-2, 1);
    expect(a.y).toBeCloseTo(3, 1);
  });
});

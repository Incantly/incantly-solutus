/**
 * An object's own colour shows on the 2D board and its list swatch: `p with color = red` draws red, smoke draws grey
 * with a grey swatch, and objects with no colour of their own keep the palette (graphics-view ui.md 3, physics ui.md 7).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PALETTE, ownColorOf, paintScene, sceneOf } from '@incantly/sdk/screen';
import type { Viewport } from '@incantly/sdk/screen';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';
import { KernelSession } from '../src/session';

const load = (lines: readonly string[]): KernelSession => {
  const s = new KernelSession();
  const r = s.applyLines([...lines], 'test', 'independent', 'host');
  if (!r.ok) throw new Error(r.error.message);
  return s;
};

describe('the kernel marks a colour the line set', () => {
  it('ownColor is set by `with color`, a rule included, and absent otherwise', () => {
    const s = load(['p = (1, 2)', 'q = (2, 2)', 'p with color = red', 'a = 0 in 0..1', 'q with color = rgb(255 a, 0, 0)', 'r = (3, 3)']);
    expect(s.figure.get('p')?.style.ownColor).toBe(true);
    expect(s.figure.get('q')?.style.ownColor).toBe(true);
    expect(s.figure.get('r')?.style.ownColor).toBeUndefined();
  });
});

describe('the scene honours an own colour', () => {
  it('a shape with a colour of its own draws it; others keep the palette in order', () => {
    const s = load(['p = (1, 2)', 'c = Circle((0, 0), 1)', 'c with color = rgb(255, 0, 0)', 'b = Body(Box((0, 3), 1, 1))', 'b with color = "#2a9d6f"', 'g = Segment((0, 0), (1, 1))']);
    const items = sceneOf(s.figure);
    const col = (n: string): string | undefined => items.find((i) => i.name === n)?.color;
    expect(col('c')).toBe('#ff0000');
    expect(col('b')).toBe('#2a9d6f');
    expect(col('p')).toBe(PALETTE[0]);
    expect(col('g')).toBe(PALETTE[3]);
  });

  it('smoke, liquid, water and waves draw in their own look, and a set colour wins', () => {
    const s = load(['sm = Smoke(Box((0, 0), 4, 4), 16)', 'sea = Water(0)', 'sm2 = Smoke(Box((9, 0), 4, 4), 16)', 'sm2 with color = rgb(255, 0, 0)']);
    expect(ownColorOf(s.figure.get('sm') as never)).toBe('#5f6670');
    expect(ownColorOf(s.figure.get('sea') as never)).toBe('#2f7fc1');
    expect(ownColorOf(s.figure.get('sm2') as never)).toBe('#ff0000');
    expect(ownColorOf(s.figure.get('sm') as never)).not.toBeUndefined();
  });

  it('smoke with a colour of its own paints in that colour', () => {
    const s = load(['sm = Smoke(Box((0, 0), 4, 4), 16, source = Circle((0, -1.5), 0.3))', 'sm with color = rgb(255, 0, 0)']);
    s.setTime(0.5);
    const fills: string[] = [];
    const ctx = new Proxy({}, {
      get: (_t, p) => (p === 'measureText' ? () => ({ width: 10 }) : typeof p === 'string' && /^[a-z]/.test(p) && !['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap', 'imageSmoothingEnabled', 'drawImage'].includes(p) ? () => undefined : undefined),
      set: (_t, p, v) => {
        if (p === 'fillStyle') fills.push(String(v));
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const vp = { w: 400, h: 400, ppu: 100, px: (x: number) => 200 + x * 100, py: (y: number) => 200 - y * 100, box: () => ({ x0: -2, x1: 2, y0: -2, y1: 2 }) } as unknown as Viewport;
    paintScene(ctx, vp, sceneOf(s.figure));
    expect(fills.some((f) => f.startsWith('rgba(255, 0, 0,'))).toBe(true);
    expect(fills.some((f) => f.startsWith('rgba(95, 102, 112,'))).toBe(false);
  });
});

describe('the studio list and board', () => {
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
  const swatch = (name: string): string => (root.querySelector(`.expr[data-name="${name}"] .swatch`) as HTMLElement).style.getPropertyValue('--c');

  it('the swatch and the board colour are the object\'s own colour, and follow a change', () => {
    m.session.applyLines(['p = (1, 2)', 'q = (2, 2)', 'q with color = rgb(255, 0, 0)', 'sm = Smoke(Box((0, 0), 4, 4), 16)'], 'test', 'independent', 'host');
    m.expressions.update();
    expect(swatch('q')).toBe('#ff0000');
    expect(swatch('sm')).toBe('#5f6670');
    expect(swatch('p')).toMatch(/^#[0-9a-f]{6}$/);
    expect(swatch('p')).not.toBe('#ff0000');
    const q = m.session.figure.get('q');
    expect(m.expressions.colorOf(q?.id as number, q)).toBe('#ff0000');
    m.session.applyLines(['q with color = rgb(0, 0, 255)'], 'test', 'independent', 'host');
    m.expressions.update();
    expect(swatch('q')).toBe('#0000ff');
  });
});

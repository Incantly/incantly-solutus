/** Typeset texts in the studio (text-logic design 6 and 7): maths in list rows, placed texts on the graph. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { paintScene, verticalParts } from '@incantly/sdk/screen';
import type { SceneItem } from '@incantly/sdk/screen';
import { Viewport } from '@incantly/sdk/screen';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

function countingCtx(): CanvasRenderingContext2D & { calls: Record<string, number>; texts: string[] } {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  return new Proxy({ calls, texts, canvas: { width: 800, height: 600 } } as Record<string, unknown>, {
    get(t, k) {
      if (k in t) return t[k as string];
      if (k === 'measureText') return (s: string) => ({ width: s.length * 8 });
      return (...a: unknown[]) => {
        calls[String(k)] = (calls[String(k)] ?? 0) + 1;
        if (k === 'fillText') texts.push(String(a[0]));
        return { addColorStop: () => undefined };
      };
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D & { calls: Record<string, number>; texts: string[] };
}

describe('typeset texts in the studio', () => {
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

  it('a text with $…$ shows as SVG in its row; a plain text stays plain', () => {
    m.session.applyLines(['half = FractionText(0.5)', 'word = "plain"'], 'test');
    const row = (n: string): HTMLElement => root.querySelector(`.expr[data-name="${n}"]`) as HTMLElement;
    expect(row('half').querySelector('.value.typeset svg')).not.toBeNull();
    expect(row('half').querySelector('svg')?.innerHTML).toContain('<rect');
    expect(row('word').querySelector('svg')).toBeNull();
  });

  it('a text with `at` is drawn on the graph, maths and all; one without stays off the graph', () => {
    m.loadExample('text-logic');
    const items = m.session.figure.objects().filter((o) => o.type === 'Text');
    expect(items.some((o) => (o.style.ext as { at?: unknown }).at)).toBe(true);
    const o = m.session.figure.get('label');
    const ext = o?.style.ext as { at: { x: number; y: number }; size: number };
    const item: SceneItem = { id: 1, name: 'label', type: 'Text', typeText: 'Text', value: o?.cell.defined ? o.cell.value : '', color: '#000', free: false, label: false, text: { at: ext.at, size: ext.size, anchor: 'sw', rotate: 0 } };
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const ctx = countingCtx();
    paintScene(ctx, vp, [item]);
    expect(ctx.texts).toEqual(expect.arrayContaining(['f', 'x', '2']));
    expect(ctx.calls['fillRect'] ?? 0).toBeGreaterThan(1);
  });

  it('a placed text follows the point it is placed at', () => {
    m.session.applyLines(['P = (1, 1)', 'memo = "here" with at = P'], 'test');
    m.session.dragPoint('P', 3, 2, true);
    expect((m.session.figure.get('memo')?.style.ext as { at: { x: number; y: number } }).at).toEqual({ x: 3, y: 2 });
  });

  it('a vertical text draws its letters one under another', () => {
    expect(verticalParts('ab $x^2$ c')).toEqual(['a', 'b', ' ', '$x^2$', ' ', 'c']);
    const item: SceneItem = { id: 1, name: 'v', type: 'Text', typeText: 'Text', value: 'abc', color: '#000', free: false, label: false, text: { at: { x: 0, y: 0 }, size: 16, anchor: 'nw', rotate: 0, vertical: true } };
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const ys: number[] = [];
    const ctx = countingCtx();
    (ctx as unknown as { fillText: (s: string, x: number, y: number) => void }).fillText = (s, _x, y) => void (/^[abc]$/.test(s) && ys.push(y));
    const hits = paintScene(ctx, vp, [item]);
    expect(ys).toHaveLength(3);
    expect(ys[0]).toBeLessThan(ys[1] as number);
    expect(ys[1]).toBeLessThan(ys[2] as number);
    const h = hits.find((x) => x.k === 'rect') as { y0: number; y1: number; x0: number; x1: number };
    expect(h.y1 - h.y0).toBeGreaterThan(h.x1 - h.x0);
  });

  it('the example has a vertical, a turned and a full-LaTeX text', () => {
    m.loadExample('text-logic');
    const ext = (n: string): Record<string, unknown> => m.session.figure.get(n)?.style.ext as Record<string, unknown>;
    expect(ext('side')['vertical']).toBe(true);
    expect(ext('spin')['rotate']).toBeCloseTo(Number(m.session.figure.value('a')), 12);
    expect(ext('stokes')['latex']).toBe('full');
  });

  it('a full-LaTeX text is left to the overlay, not painted on the canvas', async () => {
    m.session.applyLines(['k = "$\\\\iint_S x$" with at = (1, 1), latex = full'], 'test');
    const item: SceneItem = { id: 1, name: 'k', type: 'Text', typeText: 'Text', value: '$\\iint_S x$', color: '#000', free: false, label: false, text: { at: { x: 1, y: 1 }, size: 16, anchor: 'sw', rotate: 0, full: true } };
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.home();
    const ctx = countingCtx();
    paintScene(ctx, vp, [item]);
    expect(ctx.texts.filter((t) => /[Sx∬]/.test(t))).toEqual([]);
    const row = root.querySelector('.expr[data-name="k"] .latex-full');
    expect(row).not.toBeNull();
  });
});

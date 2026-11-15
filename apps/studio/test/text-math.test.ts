/** Typeset texts in the studio (text-logic design 6 and 7): maths in list rows, placed texts on the graph. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { paintScene } from '../src/graph/paint';
import type { SceneItem } from '../src/graph/paint';
import { Viewport } from '../src/graph/viewport';
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
    m.session.applyLines(['P = (1, 1)', 'note = "here" with at = P'], 'test');
    m.session.dragPoint('P', 3, 2, true);
    expect((m.session.figure.get('note')?.style.ext as { at: { x: number; y: number } }).at).toEqual({ x: 3, y: 2 });
  });
});

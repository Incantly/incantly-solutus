// @vitest-environment node
/**
 * Text with maths is not cut off at its box (design 7.1; round 3, BR-31): a text shape with no fixed width is as wide
 * as the laid-out maths boxes reach, not as the sum of the advances of the source characters.
 */
import { math } from '@incantly/view';
import { afterEach, describe, expect, it } from 'vitest';
import { layoutText, setFontMeasure, shapeGeometry } from '../../src/index';
import type { FontMeasure, TextLayout } from '../../src/index';
import { add, boxOf, shapeRig } from './shape-helpers';

afterEach(() => setFontMeasure(null));

/** The furthest right any glyph, rule or path of the layout reaches, by the measure the layout was made with. */
function reach(layout: TextLayout, measure: FontMeasure): number {
  let far = 0;
  for (const line of layout.lines) {
    for (const it of line.items) {
      if (it.k === 'glyph') {
        const m = measure(it.s, it.font, it.px, 'sans');
        far = Math.max(far, line.x + it.x + Math.max(m.w, m.right ?? 0));
      } else if (it.k === 'rule') far = Math.max(far, line.x + it.x + it.w);
      else for (const [x] of it.pts) far = Math.max(far, line.x + x);
    }
  }
  return far;
}

/** A canvas-like measure: letters of the maths font lean, so their ink reaches 4 units past their advance. */
const leaning: FontMeasure = (s, font, px) => {
  const m = math.roughMeasure(s, font, px);
  return { ...m, right: font === 'text' ? m.w : m.w + 4 };
};

describe('an auto-width text with maths (BR-31)', () => {
  it('its box is at least as wide as the layout reaches', () => {
    setFontMeasure(leaning);
    const rig = shapeRig();
    const t = add(rig, 'text', 100, 100, { text: 'Area = $\\frac{1}{2}bh$', size: 24 });
    const layout = layoutText('Area = $\\frac{1}{2}bh$', 24, 'sans', '#1f2430', null, 'start');
    const box = boxOf(rig, t.id);
    expect(box.maxX - box.minX).toBeGreaterThanOrEqual(reach(layout, leaning) - 1e-9);
    expect(box.maxX - box.minX).toBeGreaterThan(layout.lines.reduce((m, l) => Math.max(m, l.w), 0));
  });

  it('with the fixed table of widths the box is the layout, as before', () => {
    const rig = shapeRig();
    const t = add(rig, 'text', 100, 100, { text: '$\\frac{1}{2}bh$', size: 24 });
    const layout = layoutText('$\\frac{1}{2}bh$', 24, 'sans', '#1f2430', null, 'start');
    const box = boxOf(rig, t.id);
    expect(box.maxX - box.minX).toBeCloseTo(layout.w, 6);
    expect(box.maxX - box.minX).toBeGreaterThanOrEqual(reach(layout, math.roughMeasure as unknown as FontMeasure) - 1e-9);
  });

  it('a text of plain words is no wider than the advance of its longest line', () => {
    setFontMeasure(leaning);
    const rig = shapeRig();
    const t = add(rig, 'text', 0, 0, { text: 'plain words', size: 24 });
    const g = shapeGeometry(t, rig.core.store.kinds);
    const layout = layoutText('plain words', 24, 'sans', '#1f2430', null, 'start');
    expect((g?.box.maxX ?? 0) - (g?.box.minX ?? 0)).toBeCloseTo(layout.w, 6);
  });

  it('a text with a fixed width keeps it', () => {
    setFontMeasure(leaning);
    const rig = shapeRig();
    const t = add(rig, 'text', 0, 0, { text: '$\\frac{1}{2}bh$', size: 24, w: 300 });
    const box = boxOf(rig, t.id);
    expect(box.maxX - box.minX).toBeCloseTo(300, 6);
  });
});

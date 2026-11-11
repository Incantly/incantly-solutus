/**
 * graphics-view/design.md 9.7 (labels and captions): placement, offsets,
 * auto-placement with hysteresis, leaders, and the per-frame cost bound.
 */
import { describe, expect, it } from 'vitest';
import {
  LABEL_HYSTERESIS,
  LEADER_LINE_PX,
  MAX_AUTO_LABELS_PER_FRAME,
  placeLabels,
} from '@incantly/view';
import type { LabelInput } from '@incantly/view';
import { oid } from './helpers';

function label(id: number, over: Partial<LabelInput> = {}): LabelInput {
  return {
    id: oid(id), anchorX: 450, anchorY: 200, widthPx: 20, heightPx: 14,
    userDx: null, userDy: null, prevDx: null, prevDy: null, prevScore: null, ...over,
  };
}

describe('design 9.7 label layout', () => {
  it('9.7 layout constants: 200 labels/frame, 25% hysteresis, 20 px leaders', () => {
    expect(MAX_AUTO_LABELS_PER_FRAME).toBe(200);
    expect(LABEL_HYSTERESIS).toBe(0.25);
    expect(LEADER_LINE_PX).toBe(20);
  });

  it('9.7 a lone label takes the up-right preferred offset (dx 6)', () => {
    const [p] = placeLabels([label(1)], []);
    expect(p?.dx).toBe(6);
    expect(p?.dy).toBeLessThan(0);
    expect(p?.leader).toBe(false);
  });

  it('9.7 user-dragged offsets win over auto-placement and survive', () => {
    const [p] = placeLabels([label(1, { userDx: 30, userDy: 10 })], []);
    expect(p?.dx).toBe(30);
    expect(p?.dy).toBe(10);
  });

  it('9.7 a leader line appears past 20 px from the object', () => {
    const [near] = placeLabels([label(1, { userDx: 10, userDy: 5 })], []);
    expect(near?.leader).toBe(false);
    const [far] = placeLabels([label(1, { userDx: 30, userDy: 0 })], []);
    expect(far?.leader).toBe(true);
  });

  it('9.7 overlapping labels separate (8 candidates, lowest overlap wins)', () => {
    const [a, b] = placeLabels([label(1), label(2)], []);
    expect(a).not.toBeUndefined();
    expect(b).not.toBeUndefined();
    if (a === undefined || b === undefined) return;
    expect(a.dx !== b.dx || a.dy !== b.dy).toBe(true);
    const ra = { x: 450 + a.dx, y: 200 + a.dy, w: 20, h: 14 };
    const rb = { x: 450 + b.dx, y: 200 + b.dy, w: 20, h: 14 };
    const overlapX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
    const overlapY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });

  it('9.7 labels avoid point markers within 6 px', () => {
    const [dflt] = placeLabels([label(1)], []);
    // Park a marker on the default spot: the label must move away.
    const [moved] = placeLabels([label(1)], dflt === undefined ? [] : [{
      x: 450 + dflt.dx + 10,
      y: 200 + dflt.dy + 7,
      r: 4,
    }]);
    expect(moved).not.toBeUndefined();
    if (moved === undefined || dflt === undefined) return;
    expect(moved.dx !== dflt.dx || moved.dy !== dflt.dy).toBe(true);
  });

  it('9.7 a label that fit keeps its spot (hysteresis against flicker)', () => {
    const [first] = placeLabels([label(1)], []);
    expect(first).not.toBeUndefined();
    if (first === undefined) return;
    const [second] = placeLabels([label(1, { prevDx: first.dx, prevDy: first.dy, prevScore: first.score })], []);
    expect(second?.dx).toBe(first.dx);
    expect(second?.dy).toBe(first.dy);
  });

  it('9.7 beyond 200 labels, the rest keep their previous offset', () => {
    const labels: LabelInput[] = [];
    for (let i = 0; i < 205; i += 1) {
      labels.push(label(i, { anchorX: (i % 20) * 40, anchorY: Math.floor(i / 20) * 40, prevDx: 1, prevDy: 2, prevScore: 0 }));
    }
    const out = placeLabels(labels, []);
    expect(out).toHaveLength(205);
    for (let i = 200; i < 205; i += 1) {
      expect(out[i]?.dx).toBe(1);
      expect(out[i]?.dy).toBe(2);
    }
  });

  it('9.7 new labels past the bound take the default candidate', () => {
    const labels: LabelInput[] = [];
    for (let i = 0; i < 201; i += 1) labels.push(label(i));
    const out = placeLabels(labels, []);
    expect(out[200]?.dx).toBe(6);
  });

  it('9.7 placing nothing places nothing', () => {
    expect(placeLabels([], [])).toEqual([]);
  });

  it('9.7 200 labels place within the frame budget', { timeout: 15000 }, () => {
    const labels: LabelInput[] = [];
    for (let i = 0; i < 200; i += 1) {
      labels.push(label(i, { anchorX: (i % 20) * 40, anchorY: Math.floor(i / 20) * 30 }));
    }
    const t0 = performance.now();
    const out = placeLabels(labels, []);
    expect(out).toHaveLength(200);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

/**
 * graphics-view/design.md 10 (hit testing) and 11 (selection).
 * Slack, the grid index, ranking, cycling, filters, selection ops.
 */
import { describe, expect, it } from 'vitest';
import {
  HIT_CELL_PX,
  HitIndex,
  clickSelect,
  createCycleState,
  cyclePick,
  cycleTooltip,
  emptySelection,
  filterCandidates,
  px,
  rankCandidates,
  rubberBandSelect,
  selectAll,
  slackFor,
} from '@incantly/view';
import type { HitCandidate } from '@incantly/view';
import { oid } from './helpers';

function cand(id: number, priority: number, distance: number, part: HitCandidate['part'] = 'body'): HitCandidate {
  return { id: oid(id), part, distance, priority };
}

describe('design 10.2 slack', () => {
  it('10.2 mouse and pen slack follow the table', () => {
    expect(slackFor('mouse', 'point', 4)).toBe(7);
    expect(slackFor('mouse', 'point', 10)).toBe(13);
    expect(slackFor('mouse', 'edge', 4)).toBe(3);
    expect(slackFor('pen', 'point', 4)).toBe(9);
    expect(slackFor('pen', 'edge', 4)).toBe(5);
  });

  it('10.2 touch pads points to max(radius, 12) and lines to 12', () => {
    expect(slackFor('touch', 'point', 4)).toBe(16);
    expect(slackFor('touch', 'point', 20)).toBe(24);
    expect(slackFor('touch', 'edge', 4)).toBe(12);
  });

  it('10.2 fills need no slack (inside test)', () => {
    expect(slackFor('mouse', 'fill', 4)).toBe(0);
    expect(slackFor('touch', 'fill', 4)).toBe(0);
  });
});

describe('design 10.3 hit index', () => {
  it('10.3 cells are 64 px', () => {
    expect(HIT_CELL_PX).toBe(64);
  });

  it('10.3 queries return only the drawables in reach', () => {
    const idx = new HitIndex();
    idx.insert(oid(1), { x0: px(0), x1: px(10), y0: px(0), y1: px(10) });
    idx.insert(oid(2), { x0: px(500), x1: px(510), y0: px(500), y1: px(510) });
    expect(idx.query({ x: px(5), y: px(5) }, 0).map(Number)).toEqual([1]);
    expect(idx.query({ x: px(505), y: px(505) }, 0).map(Number)).toEqual([2]);
    expect(idx.query({ x: px(400), y: px(400) }, 0)).toEqual([]);
    expect(idx.size).toBe(2);
  });

  it('10.3 slack reaches into neighbour cells', () => {
    const idx = new HitIndex();
    idx.insert(oid(1), { x0: px(60), x1: px(70), y0: px(60), y1: px(70) });
    expect(idx.query({ x: px(66), y: px(66) }, 10).map(Number)).toEqual([1]);
  });

  it('10.3 null boxes are skipped; remove/update/rebuild maintain the index', () => {
    const idx = new HitIndex();
    idx.insert(oid(1), null);
    idx.insert(oid(2), { x0: px(0), x1: px(10), y0: px(0), y1: px(10) });
    expect(idx.query({ x: px(5), y: px(5) }, 0).map(Number)).toEqual([2]);
    idx.update(oid(2), { x0: px(500), x1: px(510), y0: px(500), y1: px(510) });
    expect(idx.query({ x: px(5), y: px(5) }, 0)).toEqual([]);
    idx.remove(oid(2));
    expect(idx.size).toBe(0);
    idx.rebuild([{ id: oid(3), box: { x0: px(0), x1: px(10), y0: px(0), y1: px(10) } }]);
    expect(idx.query({ x: px(5), y: px(5) }, 0).map(Number)).toEqual([3]);
  });

  it('10.3 a 5,000-object query answers in under 0.2 ms', { timeout: 15000 }, () => {
    const idx = new HitIndex();
    for (let i = 0; i < 5000; i += 1) {
      const x = (i % 100) * 64;
      const y = Math.floor(i / 100) * 64;
      idx.insert(oid(i), { x0: px(x), x1: px(x + 10), y0: px(y), y1: px(y + 10) });
    }
    const t0 = performance.now();
    const n = 200;
    for (let q = 0; q < n; q += 1) {
      const found = idx.query({ x: px((q * 37) % 6400), y: px((q * 53) % 3200) }, 3);
      expect(found.length).toBeLessThan(20);
    }
    expect((performance.now() - t0) / n).toBeLessThan(0.2);
  });
});

describe('design 10.4 ranking and 10.6 tool filtering', () => {
  it('10.4 lower priority wins, then smaller distance, then later draw order', () => {
    const cs = [cand(1, 3, 1), cand(2, 1, 50), cand(3, 3, 0.5)];
    const ranked = rankCandidates(cs, () => 0);
    expect(ranked.map((c) => c.id as number)).toEqual([2, 3, 1]);
  });

  it('10.4 equal priority and distance: the topmost (later) drawable wins', () => {
    const cs = [cand(1, 3, 1), cand(2, 3, 1)];
    const ranked = rankCandidates(cs, (id) => (id as number === 1 ? 5 : 9));
    expect(ranked.map((c) => c.id as number)).toEqual([2, 1]);
  });

  it('10.4 a point on a line beats the line; an edge beats a fill', () => {
    const cs = [cand(1, 4, 0), cand(2, 3, 0), cand(3, 1, 0), cand(4, 0, 10)];
    expect(rankCandidates(cs, () => 0).map((c) => c.id as number)).toEqual([4, 3, 2, 1]);
  });

  it('10.6 tools filter by type before ranking', () => {
    const cs = [cand(1, 1, 0), cand(2, 3, 0)];
    const typeOf = (id: unknown): 'Point' | 'Line' => ((id as number) === 1 ? 'Point' : 'Line');
    const out = filterCandidates(cs, { types: ['Point'] }, typeOf as never);
    expect(out.map((c) => c.id as number)).toEqual([1]);
  });

  it('10.6 tools filter by part and exclusion list', () => {
    const cs = [cand(1, 0, 0, 'label'), cand(2, 1, 0, 'body')];
    const typeOf = (): 'Point' => 'Point';
    expect(filterCandidates(cs, { types: ['Point'], parts: ['body'] }, typeOf as never).map((c) => c.id as number)).toEqual([2]);
    expect(filterCandidates(cs, { types: ['Point'], exclude: [oid(2)] }, typeOf as never).map((c) => c.id as number)).toEqual([1]);
  });
});

describe('design 10.5 cycling through overlaps', () => {
  const three = [cand(1, 1, 0), cand(2, 3, 0), cand(3, 4, 0)];

  it('10.5 a repeat click within 3 px and 800 ms steps to the next candidate', () => {
    let st = createCycleState();
    const p1 = cyclePick(st, three, 100, 100, 1000);
    expect(p1?.position).toBe(1);
    expect(p1?.total).toBe(3);
    if (p1 === null) return;
    st = p1.state;
    const p2 = cyclePick(st, three, 102, 101, 1700);
    expect(p2?.position).toBe(2);
    expect(p2?.candidate.id as number).toBe(2);
    if (p2 === null) return;
    const p3 = cyclePick(p2.state, three, 100, 100, 2000);
    expect(p3?.position).toBe(3);
    if (p3 === null) return;
    const p4 = cyclePick(p3.state, three, 100, 100, 2100);
    expect(p4?.position).toBe(1);
  });

  it('10.5 a click elsewhere or later restarts at the top candidate', () => {
    let st = createCycleState();
    const p1 = cyclePick(st, three, 100, 100, 1000);
    if (p1 === null) return;
    const p2 = cyclePick(p1.state, three, 100, 100, 1100);
    if (p2 === null) return;
    expect(p2.position).toBe(2);
    const p3 = cyclePick(p2.state, three, 200, 200, 1200);
    expect(p3?.position).toBe(1);
    if (p3 === null) return;
    const p4 = cyclePick(p3.state, three, 100, 100, 1300);
    if (p4 === null) return;
    expect(cyclePick(p4.state, three, 100, 100, 2300)?.position).toBe(1);
  });

  it('10.5 cycling an empty list picks nothing', () => {
    expect(cyclePick(createCycleState(), [], 0, 0, 0)).toBeNull();
  });

  it('10.5 the tooltip names the position and the candidates', () => {
    const p1 = cyclePick(createCycleState(), three, 100, 100, 1000);
    expect(p1).not.toBeNull();
    if (p1 === null) return;
    const p2 = cyclePick(p1.state, three, 100, 100, 1100);
    expect(p2).not.toBeNull();
    if (p2 !== null) expect(cycleTooltip(p2, ['A', 'a', 'c'])).toBe('2 of 3: A, a, c');
  });
});

describe('design 11 selection', () => {
  const all = (): boolean => true;

  it('11 selection starts empty and is view state, not figure state', () => {
    const s = emptySelection();
    expect([...s.ids]).toEqual([]);
    expect(s.anchor).toBeNull();
    expect(s.focus).toBeNull();
  });

  it('11 click selects; click on empty space clears', () => {
    const s1 = clickSelect(emptySelection(), oid(1), false, all);
    expect([...s1.ids].map(Number)).toEqual([1]);
    const s2 = clickSelect(s1, oid(2), false, all);
    expect([...s2.ids].map(Number)).toEqual([2]);
    expect([...clickSelect(s2, null, false, all).ids]).toEqual([]);
  });

  it('11 shift/ctrl toggles membership; shift-click on empty keeps the set', () => {
    const s1 = clickSelect(emptySelection(), oid(1), true, all);
    expect([...s1.ids].map(Number)).toEqual([1]);
    const s2 = clickSelect(s1, oid(2), true, all);
    expect([...s2.ids].map(Number).sort()).toEqual([1, 2]);
    const s3 = clickSelect(s2, oid(1), true, all);
    expect([...s3.ids].map(Number)).toEqual([2]);
    expect([...clickSelect(s3, null, true, all).ids].map(Number)).toEqual([2]);
  });

  it('11 locked (unselectable) objects are skipped everywhere', () => {
    const locked = (id: unknown): boolean => (id as number) !== 9;
    expect([...clickSelect(emptySelection(), oid(9), false, locked).ids]).toEqual([]);
    expect([...clickSelect(emptySelection(), oid(9), true, locked).ids]).toEqual([]);
    expect([...selectAll([oid(9), oid(1)], locked).ids].map(Number)).toEqual([1]);
  });

  it('11 Ctrl+A selects all visible selectable objects', () => {
    const s = selectAll([oid(1), oid(2), oid(3)], all);
    expect([...s.ids].map(Number).sort()).toEqual([1, 2, 3]);
    expect([...selectAll([], all).ids]).toEqual([]);
  });

  it('11 rubber band includes intersecting shapes', () => {
    const band = { x0: px(0), x1: px(100), y0: px(0), y1: px(100) };
    const shapes = [
      { id: oid(1), strokes: [new Float32Array([-10, 50, 50, 50])], fills: [] },
      { id: oid(2), strokes: [new Float32Array([200, 200, 300, 300])], fills: [] },
      { id: oid(3), strokes: [new Float32Array([10, 10, 20, 20])], fills: [] },
    ];
    expect(rubberBandSelect(shapes, band, all).map(Number).sort()).toEqual([1, 3]);
  });

  it('11 a band strictly inside a big fill does not select it', () => {
    const band = { x0: px(40), x1: px(60), y0: px(40), y1: px(60) };
    const big = { id: oid(1), strokes: [], fills: [new Float32Array([0, 0, 100, 0, 100, 100, 0, 100])] };
    expect(rubberBandSelect([big], band, all)).toEqual([]);
    const crossing = { x0: px(90), x1: px(110), y0: px(90), y1: px(110) };
    expect(rubberBandSelect([big], crossing, all).map(Number)).toEqual([1]);
  });

  it('11 rubber band skips locked objects', () => {
    const band = { x0: px(0), x1: px(100), y0: px(0), y1: px(100) };
    const shapes = [{ id: oid(9), strokes: [new Float32Array([10, 10, 20, 20])], fills: [] }];
    expect(rubberBandSelect(shapes, band, () => false)).toEqual([]);
  });
});

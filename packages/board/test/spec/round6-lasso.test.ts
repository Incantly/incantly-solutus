// @vitest-environment node
/**
 * Round 6: the lasso gives the same result as before the allocation changes (docs/features/board/design.md 7.4 and 13;
 * handoff/board/bench.md item 6; BR-15, BR-69). A stroke is in when more than half of its points are inside the loop, a
 * shape of a group brings the whole group, and a shape that is no group and has no parent stands alone. With 2,000 strokes
 * the result must still be what counting every point says, with the groups expanded.
 */
import { describe, expect, it } from 'vitest';
import { expandGroups, groupShapes, pointsInside, selectionFor } from '../../src/index';
import type { ShapeRecord } from '../../src/index';
import { drawPath, makeRig } from './ink-helpers';
import { keys } from './helpers';

const COLUMNS = 50;
const ROWS = 40;

/** A stroke of five points across `[x, x + 20]` at height `y`, a record of kind `ink` as the pen makes it. */
function strokeAt(id: string, index: string, page: string, x: number, y: number): ShapeRecord {
  const points = new Float32Array(15);
  for (let i = 0; i < 5; i++) {
    points[i * 3] = x + i * 5;
    points[i * 3 + 1] = y + (i % 2);
    points[i * 3 + 2] = 0.5;
  }
  return {
    id, page, kind: 'ink', x: 0, y: 0, rotation: 0, parent: null, index, locked: false, opacity: 1, meta: {},
    props: { points, stride: 3, nib: 'pen', size: 2, color: '#000000', opacity: 1 },
  } as unknown as ShapeRecord;
}

/** A board with 2,000 strokes in a grid of 50 columns and 40 rows, 30 units apart. */
function bigBoard(): { rig: ReturnType<typeof makeRig>; ids: string[]; page: string } {
  const rig = makeRig({ tool: 'lasso' });
  const page = rig.core.pages.current as string;
  const order = keys(COLUMNS * ROWS);
  const ids: string[] = [];
  const written = rig.core.store.change('user', (tx) => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLUMNS; c++) {
        const n = r * COLUMNS + c;
        const id = `shape:s${n}`;
        ids.push(id);
        tx.put(strokeAt(id, order[n] as string, page, c * 30, r * 30));
      }
    }
  });
  if (!written.ok) throw new Error(written.message);
  return { rig, ids, page };
}

/** A loop of eight corners, so the lasso tool keeps every one, closing back at the first. */
const LOOP = [[190, 170], [620, 110], [980, 260], [1020, 700], [760, 1000], [350, 940], [140, 620], [190, 172]] as const;

describe('the lasso of 2,000 strokes with the groups expanded (design 7.4, 13, BR-69)', () => {
  it('selects what counting every point of every stroke says, and brings the whole of each group a stroke belongs to', () => {
    const { rig, ids, page } = bigBoard();
    expect(rig.core.store.shapesOn(page)).toHaveLength(COLUMNS * ROWS);
    // pair strokes that are side by side across the edge of the loop and strokes far from it, so some groups are half in
    const pairs: [string, string][] = [];
    for (let r = 4; r < 30; r += 2) pairs.push([ids[r * COLUMNS + 6] as string, ids[r * COLUMNS + 7] as string]);
    for (let r = 2; r < 38; r += 6) pairs.push([ids[r * COLUMNS + 20] as string, ids[r * COLUMNS + 45] as string]);
    for (const pair of pairs) expect(groupShapes(rig.core, pair).ok).toBe(true);
    const grouped = rig.core.store.shapesOn(page).filter((s) => s.kind === 'group');
    expect(grouped).toHaveLength(pairs.length);

    rig.host.setTool('lasso');
    drawPath(rig, LOOP, {}, 1_000_000);

    const polygon = LOOP.flatMap(([x, y]) => [x, y]);
    const strokes = rig.core.store.shapesOn(page).filter((s) => s.kind === 'ink');
    expect(strokes).toHaveLength(COLUMNS * ROWS);
    const inside = new Set(strokes.filter((s) => pointsInside(s as never, polygon) * 2 > (s.props as { points: Float32Array }).points.length / 3).map((s) => s.id));
    // a shape of a group brings the whole group
    const wanted = new Set<string>(inside);
    for (const id of inside) {
      const parent = rig.core.store.get(id) as ShapeRecord;
      if (parent.parent !== null) for (const s of strokes) if (s.parent === parent.parent) wanted.add(s.id);
    }
    expect(inside.size).toBeGreaterThan(400);
    expect(inside.size).toBeLessThan(1600);
    expect(wanted.size).toBeGreaterThan(inside.size);
    expect(new Set(rig.core.selection.ids)).toEqual(wanted);
    expect(rig.core.selection.ids).toHaveLength(wanted.size);
  });

  it('a loop that holds nothing selects nothing, and one of fewer than 3 points clears the selection', () => {
    const { rig } = bigBoard();
    rig.host.setTool('lasso');
    drawPath(rig, [[5000, 5000], [5400, 5000], [5400, 5400], [5000, 5400], [5000, 5002]], {}, 1_000_000);
    expect(rig.core.selection.ids).toEqual([]);
  });
});

describe('expandGroups gives what it gave before (core/shapes.ts, design 7.4: grouping)', () => {
  /** What the function was defined as: every id replaced by the selection it stands for, once each, in order. */
  function before(store: Parameters<typeof expandGroups>[0], ids: readonly string[]): string[] {
    const out = new Set<string>();
    for (const id of ids) for (const s of selectionFor(store, id)) out.add(s);
    return [...out];
  }

  it('ids of loose shapes come back as they are, in order, each once', () => {
    const { rig, ids } = bigBoard();
    const pick = [ids[10], ids[3], ids[999], ids[3], ids[1500]] as string[];
    expect(expandGroups(rig.core.store, pick)).toEqual([ids[10], ids[3], ids[999], ids[1500]]);
    expect(expandGroups(rig.core.store, pick)).toEqual(before(rig.core.store, pick));
  });

  it('one stroke of a group brings the whole group; the group itself stands for its leaves', () => {
    const { rig, ids, page } = bigBoard();
    const a = ids[100] as string;
    const b = ids[101] as string;
    const c = ids[102] as string;
    expect(groupShapes(rig.core, [a, b]).ok).toBe(true);
    expect(new Set(expandGroups(rig.core.store, [a]))).toEqual(new Set([a, b]));
    const group = rig.core.store.shapesOn(page).find((s) => s.kind === 'group') as ShapeRecord;
    expect(new Set(expandGroups(rig.core.store, [group.id]))).toEqual(new Set([a, b]));
    expect(new Set(expandGroups(rig.core.store, [c, b]))).toEqual(new Set([a, b, c]));
  });

  it('a group inside a group expands to every leaf of the outer one', () => {
    const { rig, ids } = bigBoard();
    const [a, b, c] = [ids[200], ids[201], ids[202]] as [string, string, string];
    groupShapes(rig.core, [a, b]);
    groupShapes(rig.core, [a, c]);
    expect(new Set(expandGroups(rig.core.store, [c]))).toEqual(new Set([a, b, c]));
    expect(new Set(expandGroups(rig.core.store, [b]))).toEqual(new Set([a, b, c]));
  });

  it('matches the old definition over 2,000 strokes, with groups, repeats and an id that is not on the board', () => {
    const { rig, ids } = bigBoard();
    for (let i = 0; i < 300; i += 3) groupShapes(rig.core, [ids[i] as string, ids[i + 1] as string]);
    const pick: string[] = [];
    for (let i = 0; i < ids.length; i += 2) pick.push(ids[i] as string);
    pick.push('shape:nothing', ids[0] as string, ids[1] as string);
    const got = expandGroups(rig.core.store, pick);
    expect(got).toEqual(before(rig.core.store, pick));
    expect(new Set(got).size).toBe(got.length);
  });

  it('a locked or parentless shape is not changed by being expanded', () => {
    const { rig, ids } = bigBoard();
    rig.core.store.change('user', (tx) => {
      tx.update(ids[5] as string, { locked: true });
    });
    expect(expandGroups(rig.core.store, [ids[5] as string])).toEqual([ids[5]]);
    expect(expandGroups(rig.core.store, [])).toEqual([]);
  });
});

// @vitest-environment node
/**
 * R2.3 (design 4, B2): a transaction is one undo step; a stroke or a drag is one step; history:false writes are not
 * steps; undo and redo are one store transaction each.
 */
import { describe, expect, it } from 'vitest';
import { History, cameraIdOf } from '../../src/index';
import type { BoardError, Diff } from '../../src/index';
import { addRects, dump, makeBoard, must, shape } from './helpers';

const xOf = (b: ReturnType<typeof makeBoard>, id: string): number => (b.store.get(id) as unknown as { x: number }).x;

describe('undo and redo steps', () => {
  it('starts with nothing to undo or redo', () => {
    const b = makeBoard();
    expect(b.history.canUndo).toBe(false);
    expect(b.history.canRedo).toBe(false);
    expect(b.history.undoSteps).toBe(0);
    expect(b.history.redoSteps).toBe(0);
  });

  it('makes each transaction one step, however many records it writes', () => {
    const b = makeBoard();
    addRects(b, 25);
    expect(b.history.undoSteps).toBe(1);
    must(b.store.change('user', (tx) => {
      for (let i = 1; i <= 25; i++) must(tx.update(`shape:${i}`, { x: i * 3 }));
    }));
    expect(b.history.undoSteps).toBe(2);
  });

  it('undo restores every record of the last step, and redo puts them back', () => {
    const b = makeBoard();
    addRects(b, 3);
    const afterAdd = dump(b.store);
    must(b.store.change('user', (tx) => {
      must(tx.update('shape:1', { x: 500 }));
      must(tx.remove('shape:2'));
      must(tx.put(shape('shape:10', b.page, { index: 'a' })));
    }));
    const afterEdit = dump(b.store);
    expect(b.history.canUndo).toBe(true);
    must(b.history.undo());
    expect(dump(b.store)).toBe(afterAdd);
    expect(b.history.canRedo).toBe(true);
    must(b.history.redo());
    expect(dump(b.store)).toBe(afterEdit);
    must(b.history.undo());
    must(b.history.undo());
    expect(b.store.shapeCount(b.page)).toBe(0);
    expect(b.history.canUndo).toBe(false);
  });

  it('gives undo and redo as one diff to listeners, one call each', () => {
    const b = makeBoard();
    addRects(b, 10);
    const diffs: Diff[] = [];
    b.store.on((d) => diffs.push(d));
    must(b.history.undo());
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.removed).toHaveLength(10);
    must(b.history.redo());
    expect(diffs).toHaveLength(2);
    expect(diffs[1]?.added).toHaveLength(10);
  });

  it('writes the replay with the origin it is given', () => {
    const b = makeBoard();
    addRects(b, 1);
    const d = must(b.history.undo('host'));
    expect(d.origin).toBe('host');
    const r = must(b.history.redo('remote'));
    expect(r.origin).toBe('remote');
  });

  it('returns nothing_to_undo on an empty stack and changes nothing', () => {
    const b = makeBoard();
    const before = dump(b.store);
    const u = b.history.undo();
    const r = b.history.redo();
    expect(u.ok).toBe(false);
    expect((u as BoardError).kind).toBe('nothing_to_undo');
    expect((r as BoardError).kind).toBe('nothing_to_undo');
    expect(dump(b.store)).toBe(before);
  });

  it('empties the redo stack when a new step is recorded', () => {
    const b = makeBoard();
    addRects(b, 1);
    addRects(b, 1);
    must(b.history.undo());
    expect(b.history.redoSteps).toBe(1);
    addRects(b, 1);
    expect(b.history.redoSteps).toBe(0);
    expect(b.history.canRedo).toBe(false);
  });

  it('counts steps as they move between the two stacks', () => {
    const b = makeBoard();
    for (let i = 0; i < 4; i++) addRects(b, 1);
    expect(b.history.undoSteps).toBe(4);
    must(b.history.undo());
    must(b.history.undo());
    expect([b.history.undoSteps, b.history.redoSteps]).toEqual([2, 2]);
    must(b.history.redo());
    expect([b.history.undoSteps, b.history.redoSteps]).toEqual([3, 1]);
  });

  it('records an agent’s transaction (origin model) as a step a learner can undo', () => {
    const b = makeBoard();
    must(b.store.change('model', (tx) => void must(tx.put(shape('shape:1', b.page)))));
    expect(b.history.undoSteps).toBe(1);
    must(b.history.undo());
    expect(b.store.has('shape:1')).toBe(false);
  });

  it('keeps at most maxSteps undo steps and drops the oldest first', () => {
    const b = makeBoard({}, false);
    const h = new History(b.store, { maxSteps: 3 });
    for (let i = 0; i < 6; i++) addRects(b, 1);
    expect(h.undoSteps).toBe(3);
    for (let i = 0; i < 3; i++) must(h.undo());
    expect(b.store.shapeCount(b.page)).toBe(3);
    expect(h.canUndo).toBe(false);
  });

  it('forgets every step on clear', () => {
    const b = makeBoard();
    addRects(b, 2);
    must(b.history.undo());
    b.history.clear();
    expect([b.history.undoSteps, b.history.redoSteps]).toEqual([0, 0]);
  });

  it('stops recording after dispose', () => {
    const b = makeBoard();
    b.history.dispose();
    addRects(b, 1);
    expect(b.history.undoSteps).toBe(0);
  });

  it('calls its listener after changes to the stacks, until the returned function is called', () => {
    const b = makeBoard();
    let n = 0;
    const off = b.history.on(() => void n++);
    addRects(b, 1);
    expect(n).toBeGreaterThan(0);
    const seen = n;
    must(b.history.undo());
    expect(n).toBeGreaterThan(seen);
    off();
    const frozen = n;
    addRects(b, 1);
    expect(n).toBe(frozen);
  });

  it('leaves both stacks as they were when a replay is refused', () => {
    const b = makeBoard({ shapesPerPage: 2 });
    addRects(b, 1);
    must(b.store.change('user', (tx) => void must(tx.remove('shape:1'))));
    // fill the page with writes that are not steps, so the undo of the remove has no room
    must(b.store.change('host', (tx) => {
      must(tx.put(shape('shape:5', b.page, { index: 'b' })));
      must(tx.put(shape('shape:6', b.page, { index: 'c' })));
    }, { history: false }));
    const before = dump(b.store);
    const steps = [b.history.undoSteps, b.history.redoSteps];
    const r = b.history.undo();
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('limit');
    expect(dump(b.store)).toBe(before);
    expect([b.history.undoSteps, b.history.redoSteps]).toEqual(steps);
  });
});

describe('a stroke or a drag is one step (merge key)', () => {
  it('joins writes with the same merge key into one step, with the first before and the last after', () => {
    const b = makeBoard();
    addRects(b, 1);
    b.history.seal();
    for (let i = 1; i <= 50; i++) {
      must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x: i })), { mergeKey: 'drag:1' }));
    }
    expect(b.history.undoSteps).toBe(2);
    expect(xOf(b, 'shape:1')).toBe(50);
    must(b.history.undo());
    expect(xOf(b, 'shape:1')).toBe(0);
    expect(b.history.undoSteps).toBe(1);
    must(b.history.redo());
    expect(xOf(b, 'shape:1')).toBe(50);
  });

  it('makes a stroke one step even when its first write adds the shape: undo removes it, redo gives the last samples', () => {
    const b = makeBoard();
    const ink = (n: number) => shape('shape:1', b.page, { kind: 'ink', props: { points: new Float32Array(n * 3), size: 4 } });
    must(b.store.change('user', (tx) => void must(tx.put(ink(1))), { mergeKey: 'stroke:1' }));
    for (let n = 2; n <= 40; n++) {
      must(b.store.change('user', (tx) => void must(tx.put(ink(n))), { mergeKey: 'stroke:1' }));
    }
    expect(b.history.undoSteps).toBe(1);
    must(b.history.undo());
    expect(b.store.has('shape:1')).toBe(false);
    must(b.history.redo());
    const s = b.store.get('shape:1') as unknown as { props: { points: Float32Array } };
    expect(s.props.points.length).toBe(40 * 3);
  });

  it('starts a new step for a different merge key, for no key, and after seal()', () => {
    const b = makeBoard();
    addRects(b, 1);
    const move = (x: number, key?: string) => must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x })), key === undefined ? {} : { mergeKey: key }));
    const base = b.history.undoSteps;
    move(1, 'a');
    move(2, 'a');
    expect(b.history.undoSteps).toBe(base + 1);
    move(3, 'b');
    expect(b.history.undoSteps).toBe(base + 2);
    move(4);
    expect(b.history.undoSteps).toBe(base + 3);
    move(5, 'b');
    expect(b.history.undoSteps).toBe(base + 4);
    b.history.seal();
    move(6, 'b');
    expect(b.history.undoSteps).toBe(base + 5);
  });

  it('ends merging on undo and redo', () => {
    const b = makeBoard();
    addRects(b, 1);
    const move = (x: number) => must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x })), { mergeKey: 'k' }));
    move(1);
    must(b.history.undo());
    must(b.history.redo());
    const steps = b.history.undoSteps;
    move(2);
    expect(b.history.undoSteps).toBe(steps + 1);
  });

  it('merges records the later writes touch for the first time, keeping each record’s first before', () => {
    const b = makeBoard();
    addRects(b, 2);
    b.history.seal();
    must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x: 10 })), { mergeKey: 'multi' }));
    must(b.store.change('user', (tx) => void must(tx.update('shape:2', { x: 20 })), { mergeKey: 'multi' }));
    must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x: 11 })), { mergeKey: 'multi' }));
    expect(b.history.undoSteps).toBe(2);
    must(b.history.undo());
    expect(xOf(b, 'shape:1')).toBe(0);
    expect(xOf(b, 'shape:2')).toBe(20);
  });
});

describe('history:false writes are not steps', () => {
  it('leaves the stacks alone for a write with history:false', () => {
    const b = makeBoard();
    addRects(b, 1);
    const steps = b.history.undoSteps;
    must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x: 40 })), { history: false }));
    expect(b.history.undoSteps).toBe(steps);
    expect(b.history.redoSteps).toBe(0);
    expect(b.history.canRedo).toBe(false);
  });

  it('does not clear the redo stack for a write with history:false', () => {
    const b = makeBoard();
    addRects(b, 1);
    must(b.history.undo());
    must(b.store.change('user', (tx) => void must(tx.put({ id: `camera:${b.page}`, page: b.page, x: 1, y: 2, zoom: 2 })), { history: false }));
    expect(b.history.redoSteps).toBe(1);
  });

  it('puts history:false on the diff, and history:true on a normal one', () => {
    const b = makeBoard();
    const seen: boolean[] = [];
    b.store.on((d) => seen.push(d.history));
    addRects(b, 1);
    must(b.store.change('user', (tx) => void must(tx.update('shape:1', { x: 1 })), { history: false }));
    expect(seen).toEqual([true, false]);
  });

  it('keeps a camera save out of the steps', () => {
    const b = makeBoard();
    const cam = must(b.cameras.forPage(b.page));
    cam.panBy(-100, -50);
    must(b.cameras.save(b.page));
    expect(b.history.undoSteps).toBe(0);
    expect(b.store.has(cameraIdOf(b.page))).toBe(true);
  });

  it('does not record the history’s own replay as a step again', () => {
    const b = makeBoard();
    addRects(b, 2);
    must(b.history.undo());
    expect(b.history.undoSteps).toBe(0);
    expect(b.history.redoSteps).toBe(1);
    must(b.history.redo());
    expect(b.history.undoSteps).toBe(1);
    expect(b.history.redoSteps).toBe(0);
  });
});

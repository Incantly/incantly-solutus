/**
 * Undo, redo and undo units.
 * Docs: kernel/design.md 11; kernel/errors.md 1 (nothing_to_undo); kernel/agent.md 5.4; README decision 8.
 */
import { describe, expect, it } from 'vitest';
import { bad, expectUnchanged, figure, idOf, must, newFigure, ok, recordEvents, snap, timed } from './helpers';

const BASE = ['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'a = 3 in 0..10 step 0.5', 'h = a * 2'];

/** Every kind of accepted line, with the line to apply on top of BASE. */
const OPS: [string, string][] = [
  ['add a free Point', 'P = (5, 5)'],
  ['add a free Number', 'n = 7'],
  ['add a free Bool', 'flag = true'],
  ['add a free Text', 's = "hi"'],
  ['add a dependent Point', 'N = Midpoint(A, M)'],
  ['add a dependent Number', 'd = Distance(A, B)'],
  ['add a Line', 'l = Line(A, B)'],
  ['add a Circle', 'c = Circle(A, 2)'],
  ['add a slider', 'k = 1 in 0..5'],
  ['redefine a free Point', 'A = (2, 2)'],
  ['redefine a dependent Point', 'M = Midpoint(A, A)'],
  ['redefine with a reorder', 'A = Midpoint(M2, B)'],
  ['redefine to a new range', 'a = 4 in 0..20'],
  ['free to dependent', 'B = Midpoint(A, A)'],
  ['self assignment', 'a = a + 1'],
  ['restyle', 'A with color = red, layer = 3'],
  ['rename', 'Rename(M, "K")'],
  ['delete with a cascade', 'Delete(A)'],
  ['hide', 'Hide(A)'],
  ['make undefined', 'A = B'],
];

function withReorderBase(): ReturnType<typeof figure> {
  return figure([...BASE, 'M2 = (1, 1)']);
}

describe('undo and redo of every accepted line', () => {
  it.each(OPS)('%s', (_name, line) => {
    const f = withReorderBase();
    const before = snap(f);
    const r = f.apply(line);
    if (!r.ok) throw new Error(`setup failed ${line}: ${r.message}`);
    const after = snap(f);
    const u = ok(f.undo(), `undo ${line}`);
    expect(u.op).toBe('undo');
    expect(f.toScript()).toBe(before.script);
    expect(f.names()).toEqual(before.names);
    expect(snap(f).ids).toEqual(before.ids);
    expect(snap(f).values).toBe(before.values);
    const rr = ok(f.redo(), `redo ${line}`);
    expect(rr.op).toBe('redo');
    expect(f.toScript()).toBe(after.script);
    expect(f.names()).toEqual(after.names);
    expect(snap(f).values).toBe(after.values);
  });

  it('ids stay stable across undo and redo of a delete', () => {
    const f = withReorderBase();
    const ids = new Map(f.objects().map((o) => [o.name, o.id]));
    ok(f.apply('Delete(A)'));
    ok(f.undo());
    for (const [n, id] of ids) expect(idOf(f, n)).toBe(id);
    ok(f.redo());
    ok(f.undo());
    for (const [n, id] of ids) expect(idOf(f, n)).toBe(id);
  });

  it('undo of a remove restores each object at its saved position, with its props', () => {
    const f = figure(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'C = (9, 9)', 'N = Midpoint(M, C)']);
    ok(f.apply('M with color = red, layer = 4'));
    const names = f.names();
    ok(f.apply('Delete(M)'));
    ok(f.undo());
    expect(f.names()).toEqual(names);
    expect(must(f.get('M')).style.layer).toBe(4);
  });

  it('undo reports what it did (agent.md 5.4): removed after undoing an add, added after redo', () => {
    const f = figure(BASE);
    ok(f.apply('M2 = Midpoint(A, B)'));
    const u = ok(f.apply('Undo()'));
    expect(u.op).toBe('undo');
    expect(u.changed.removed).toEqual(['M2']);
    const r = ok(f.apply('Redo()'));
    expect(r.op).toBe('redo');
    expect(r.changed.added).toEqual(['M2']);
  });

  it('undo that makes things defined again says so', () => {
    const f = figure(['O = (0, 0)', 'Q = (4, 1)', 'P = (0, 2)', 'l1 = Line(O, Q)', 'l2 = Line(P, Q)', 'I = Intersect(l1, l2)']);
    ok(f.apply('l2 = Parallel(P, l1)'));
    expect(f.cellOf('I')?.defined).toBe(false);
    const u = ok(f.undo());
    expect(u.changed.becameDefined).toContain('I');
    expect(f.cellOf('I')?.defined).toBe(true);
  });

  it('undo does not touch t', () => {
    const f = figure([...BASE, 'x1 = 2 * t']);
    f.setClock(4);
    ok(f.apply('b = 1'));
    ok(f.undo());
    expect(f.clock().t).toBe(4);
    expect(f.value('x1')).toBe(8);
  });
});

describe('nothing_to_undo', () => {
  it('undo() and redo() on an empty history', () => {
    const f = newFigure();
    const u = bad(f.undo(), 'nothing_to_undo');
    expect(u.code).toBe('K030');
    expect(u.recovery).toBe('skip');
    expect(u.message).toBe('There is nothing to undo.');
    const r = bad(f.redo(), 'nothing_to_undo');
    expect(r.recovery).toBe('skip');
    expect(r.message).toBe('There is nothing to redo.');
  });

  it('the lines Undo() and Redo() give the same error with the line as the token', () => {
    const f = newFigure();
    const e = bad(f.apply('Undo()'), 'nothing_to_undo');
    expect(e.token).toBe('Undo()');
    expect(e.col).toBe(1);
    const e2 = bad(f.apply('Redo()'), 'nothing_to_undo');
    expect(e2.token).toBe('Redo()');
  });

  it('redo with nothing undone', () => {
    const f = figure(BASE);
    bad(f.redo(), 'nothing_to_undo');
  });

  it('after undoing everything, one more undo fails and nothing changes', () => {
    const f = figure(BASE);
    while (f.undoInfo().depth > 0) ok(f.undo());
    expect(f.count).toBe(0);
    const before = snap(f);
    bad(f.undo(), 'nothing_to_undo');
    expectUnchanged(f, before);
  });
});

describe('the redo stack', () => {
  it('is cleared by any new accepted line', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    expect(f.undoInfo().redoDepth).toBe(1);
    ok(f.apply('Y = (2, 2)'));
    expect(f.undoInfo().redoDepth).toBe(0);
    bad(f.redo(), 'nothing_to_undo');
  });

  it('is not cleared by a rejected line', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    bad(f.apply('Y = Midpoint(A, Nope)'));
    bad(f.apply('A = Midpoint(M, B)'));
    expect(f.undoInfo().redoDepth).toBe(1);
    ok(f.redo());
    expect(f.get('Z')).toBeDefined();
  });

  it('is not cleared by a dry run, a query or a clock move', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    f.apply('Y = (2, 2)', { dryRun: true });
    f.apply('Describe(A)');
    f.setClock(3);
    expect(f.undoInfo().redoDepth).toBe(1);
  });

  it('is not cleared by a failed atomic batch', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    f.applyBatch(['Y = (2, 2)', 'X = Midpoint(Y, Nope)'], { group: 'g' });
    expect(f.undoInfo().redoDepth).toBe(1);
  });

  it('undo, redo, undo, redo walk back and forth through many steps', () => {
    const f = figure(BASE);
    const lines = ['P1 = (1, 1)', 'P2 = (2, 2)', 'P3 = Midpoint(P1, P2)', 'P1 = (5, 5)', 'Delete(P2)'];
    const snaps = [snap(f)];
    for (const l of lines) {
      ok(f.apply(l), l);
      snaps.push(snap(f));
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      ok(f.undo());
      expect(f.toScript()).toBe((snaps[i] as { script: string }).script);
    }
    for (let i = 1; i <= lines.length; i++) {
      ok(f.redo());
      expect(f.toScript()).toBe((snaps[i] as { script: string }).script);
    }
  });
});

describe('undo units: group and line', () => {
  it('a batch is one group; undo({unit:"group"}) takes back all of it', () => {
    const f = figure(BASE);
    ok({ ...f.applyBatch(['P1 = (1, 1)', 'P2 = (2, 2)', 'P3 = Midpoint(P1, P2)'], { group: 'utterance' }).results[0] } as never);
    expect(f.names()).toContain('P3');
    ok(f.undo({ unit: 'group' }));
    for (const n of ['P1', 'P2', 'P3']) expect(f.get(n)).toBeUndefined();
  });

  it('undo({unit:"line"}) takes back only the last line of the group', () => {
    const f = figure(BASE);
    f.applyBatch(['P1 = (1, 1)', 'P2 = (2, 2)', 'P3 = Midpoint(P1, P2)'], { group: 'utterance' });
    ok(f.undo({ unit: 'line' }));
    expect(f.get('P3')).toBeUndefined();
    expect(f.get('P1')).toBeDefined();
    expect(f.get('P2')).toBeDefined();
    ok(f.undo({ unit: 'line' }));
    expect(f.get('P2')).toBeUndefined();
    expect(f.get('P1')).toBeDefined();
  });

  it('the Undo() action takes back one line, not the group (agent.md: the teacher fixes a single mistake)', () => {
    const f = figure(BASE);
    f.applyBatch(['P1 = (1, 1)', 'P2 = (2, 2)'], { group: 'utterance' });
    ok(f.apply('Undo()'));
    expect(f.get('P2')).toBeUndefined();
    expect(f.get('P1')).toBeDefined();
  });

  it('the default for undo() is the group (the learner button)', () => {
    const f = figure(BASE);
    f.applyBatch(['P1 = (1, 1)', 'P2 = (2, 2)'], { group: 'utterance' });
    ok(f.undo());
    expect(f.get('P1')).toBeUndefined();
    expect(f.get('P2')).toBeUndefined();
  });

  it('one line outside any group is the same in both units', () => {
    const f1 = figure(BASE);
    const f2 = figure(BASE);
    ok(f1.apply('P1 = (1, 1)'));
    ok(f2.apply('P1 = (1, 1)'));
    ok(f1.undo({ unit: 'group' }));
    ok(f2.undo({ unit: 'line' }));
    expect(f1.toScript()).toBe(f2.toScript());
  });

  it('redo after a line undo brings back that line', () => {
    const f = figure(BASE);
    f.applyBatch(['P1 = (1, 1)', 'P2 = (2, 2)'], { group: 'utterance' });
    ok(f.undo({ unit: 'line' }));
    ok(f.redo());
    expect(f.get('P2')).toBeDefined();
  });
});

describe('gestures: a drag is one undo step', () => {
  it('many drag writes and one commit make one entry from the first value to the last', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    for (let i = 1; i <= 30; i++) f.setFree('A', { x: i, y: i }, 'drag');
    f.flush();
    expect(f.undoInfo().depth).toBe(depth); // nothing journalled until the release
    expect(f.commitDrag().committed).toBe(1);
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
    ok(f.redo());
    expect(f.value('A')).toEqual({ x: 30, y: 30 });
  });

  it('no entry when the end equals the start', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    f.setFree('A', { x: 9, y: 9 }, 'drag');
    f.setFree('A', { x: 0, y: 0 }, 'drag');
    f.flush();
    expect(f.commitDrag().committed).toBe(0);
    expect(f.undoInfo().depth).toBe(depth);
  });

  it('a slider gesture is the same', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    for (const v of [4, 5, 6, 7]) f.setFree('a', v, 'slider');
    f.flush();
    f.commitDrag();
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('a')).toBe(3);
    expect(f.value('h')).toBe(6);
  });

  it('a gesture over two objects commits as one step', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    f.setFree('A', { x: 1, y: 1 }, 'drag');
    f.setFree('B', { x: 8, y: 8 }, 'drag');
    f.flush();
    f.commitDrag();
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('A')).toEqual({ x: 0, y: 0 });
    expect(f.value('B')).toEqual({ x: 4, y: 0 });
  });

  it('show_me and api writes are journalled at once and can be undone', () => {
    const f = figure(BASE);
    const depth = f.undoInfo().depth;
    f.setFree('a', 8, 'show_me');
    f.flush();
    expect(f.undoInfo().depth).toBe(depth + 1);
    ok(f.undo());
    expect(f.value('a')).toBe(3);
    f.setFree('a', 9, 'api');
    f.flush();
    expect(f.undoInfo().depth).toBe(depth + 1);
  });

  it('solver writes, the clock and slider animation are never journalled', () => {
    const f = figure([...BASE, 'th = state(0.6)', "th' = 1"]);
    const depth = f.undoInfo().depth;
    for (let i = 0; i < 20; i++) f.setClock(i / 4);
    f.setFree('a', 5, 'solver');
    f.flush();
    expect(f.undoInfo().depth).toBe(depth);
  });
});

describe('undoInfo and capacity', () => {
  it('reports depth, redo depth, capacity and the label of the next undo', () => {
    const f = newFigure();
    expect(f.undoInfo()).toEqual(expect.objectContaining({ depth: 0, redoDepth: 0, dropped: 0, capacity: 500 }));
    ok(f.apply('A = (0, 0)'));
    ok(f.apply('B = (1, 1)'));
    const i = f.undoInfo();
    expect(i.depth).toBe(2);
    expect(typeof i.next).toBe('string');
    ok(f.undo());
    expect(f.undoInfo().redoDepth).toBe(1);
  });

  it('drops the oldest entries past the capacity and says so honestly', () => {
    const f = newFigure({ limits: { journalEntries: 5 } });
    for (let i = 0; i < 8; i++) ok(f.apply(`p${i} = ${i}`));
    const info = f.undoInfo();
    expect(info.capacity).toBe(5);
    expect(info.depth).toBe(5);
    expect(info.dropped).toBe(3);
    for (let i = 0; i < 5; i++) ok(f.undo());
    bad(f.undo(), 'nothing_to_undo');
    expect(f.names()).toEqual(['p0', 'p1', 'p2']);
  });

  it('an undone entry is not counted as dropped', () => {
    const f = newFigure({ limits: { journalEntries: 5 } });
    for (let i = 0; i < 4; i++) ok(f.apply(`p${i} = ${i}`));
    ok(f.undo());
    ok(f.undo());
    expect(f.undoInfo().dropped).toBe(0);
  });

  it('the default capacity is 500 entries', () => {
    const f = newFigure();
    for (let i = 0; i < 520; i++) ok(f.apply(`p${i} = ${i}`));
    const info = f.undoInfo();
    expect(info.depth).toBe(500);
    expect(info.dropped).toBe(20);
  });
});

describe('events and cost', () => {
  it('undo and redo send an undo / redo event, then the usual structure events', () => {
    const f = figure(BASE);
    ok(f.apply('Z = (1, 1)'));
    const rec = recordEvents(f);
    ok(f.undo());
    ok(f.redo());
    const kinds = rec.events.map((e) => e.ev);
    expect(kinds).toContain('undo');
    expect(kinds).toContain('redo');
    expect(kinds).toContain('remove');
    expect(kinds).toContain('add');
  });

  it('undo of one line in a 500-object figure is fast (target 1 ms; limit 50 ms)', { retry: 2 }, () => {
    const lines: string[] = ['A = (0, 0)', 'B = (10, 0)'];
    for (let i = 0; i < 498; i++) lines.push(`P${i} = Midpoint(${i === 0 ? 'A' : `P${i - 1}`}, B)`);
    const f = figure(lines);
    ok(f.apply('A = (1, 1)'));
    const { ms } = timed(() => ok(f.undo()));
    expect(ms).toBeLessThan(50);
  });
});

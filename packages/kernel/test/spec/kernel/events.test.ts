/**
 * Figure events (on): add, remove, value, style, rename, reorder, step, undo/redo, directive, clock.
 * Docs: kernel/design.md 4.5 (FigureEvent), 9.2 (style edges), 6.3 (batched per pass); kernel/errors.md 5 rule 4
 * (listener faults); errors/errors.md 4 (listener_failed K108).
 */
import { describe, expect, it } from 'vitest';
import { bad, figure, idOf, newFigure, ok, recordEvents, resetRuns, runs } from './helpers';

const BASE = ['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)', 'a = 3 in 0..10 step 0.5'];

describe('on(listener)', () => {
  it('returns a function that unsubscribes', () => {
    const f = figure(BASE);
    const seen: unknown[] = [];
    const off = f.on((e) => seen.push(e));
    ok(f.apply('Z = (1, 1)'));
    const n = seen.length;
    expect(n).toBeGreaterThan(0);
    off();
    ok(f.apply('Y = (2, 2)'));
    expect(seen.length).toBe(n);
  });

  it('several listeners all get every event, in subscription order', () => {
    const f = figure(BASE);
    const order: string[] = [];
    f.on((e) => order.push(`1:${e.ev}`));
    f.on((e) => order.push(`2:${e.ev}`));
    ok(f.apply('Z = (1, 1)'));
    expect(order[0]?.startsWith('1:')).toBe(true);
    expect(order.filter((x) => x.startsWith('1:')).map((x) => x.slice(2))).toEqual(order.filter((x) => x.startsWith('2:')).map((x) => x.slice(2)));
  });

  it('unsubscribing twice is harmless', () => {
    const f = figure(BASE);
    const off = f.on(() => undefined);
    off();
    expect(() => off()).not.toThrow();
  });

  it('subscribing or unsubscribing inside a listener is safe', () => {
    const f = figure(BASE);
    const seen: string[] = [];
    const off = f.on((e) => {
      seen.push(e.ev);
      off();
      f.on(() => undefined);
    });
    expect(() => ok(f.apply('Z = (1, 1)'))).not.toThrow();
    ok(f.apply('Y = (1, 1)'));
    expect(seen.length).toBe(seen.filter((x) => x).length);
  });
});

describe('structure events', () => {
  it('add: one event with the id of each new object', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    ok(f.apply('Z = Midpoint(A, B)'));
    expect(rec.events.filter((e) => e.ev === 'add')).toEqual([{ ev: 'add', id: idOf(f, 'Z') }]);
  });

  it('remove: the id and the name, since the object is gone', () => {
    const f = figure(BASE);
    const id = idOf(f, 'M');
    const rec = recordEvents(f);
    ok(f.apply('Delete(M)'));
    expect(rec.events.filter((e) => e.ev === 'remove')).toEqual([{ ev: 'remove', id, name: 'M' }]);
  });

  it('rename: the id and both names', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    ok(f.apply('Rename(M, "K")'));
    expect(rec.events.filter((e) => e.ev === 'rename')).toEqual([{ ev: 'rename', id: idOf(f, 'K'), from: 'M', to: 'K' }]);
  });

  it('reorder: the ids that moved, after a redefinition with a move', () => {
    const f = figure(['Q = (2, 0)', 'P = (0, 0)', 'X = Midpoint(P, Q)', 'R = (8, 0)']);
    const rec = recordEvents(f);
    ok(f.apply('P = Midpoint(R, Q)'));
    const ev = rec.events.find((e) => e.ev === 'reorder');
    expect(ev).toBeDefined();
    if (ev?.ev === 'reorder') expect(ev.ids).toContain(idOf(f, 'R'));
  });

  it('a redefinition without a move sends no reorder event', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    ok(f.apply('M = Midpoint(A, A)'));
    expect(rec.events.some((e) => e.ev === 'reorder')).toBe(false);
  });

  it('step: one event with n', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    f.stepTo(2);
    expect(rec.events).toEqual([{ ev: 'step', n: 2 }]);
  });

  it('clock: one event per seek', () => {
    const f = figure(['x1 = t']);
    const rec = recordEvents(f);
    f.setClock(1);
    f.setClock(2);
    expect(rec.events.filter((e) => e.ev === 'clock')).toEqual([{ ev: 'clock', t: 1 }, { ev: 'clock', t: 2 }]);
  });

  it('directive: the name of the directive line', () => {
    const f = newFigure();
    const rec = recordEvents(f);
    ok(f.apply('@clock 0..10'));
    const d = rec.events.find((e) => e.ev === 'directive');
    expect(d).toBeDefined();
    if (d?.ev === 'directive') expect(d.name.replace('@', '')).toBe('clock');
  });

  it('undo / redo: an informational event with the group label', () => {
    const f = figure(BASE);
    f.applyBatch(['Z = (1, 1)', 'Y = (2, 2)'], { group: 'the utterance' });
    const rec = recordEvents(f);
    ok(f.undo());
    ok(f.redo());
    const u = rec.events.find((e) => e.ev === 'undo');
    const r = rec.events.find((e) => e.ev === 'redo');
    expect(u && u.ev === 'undo' && u.group).toContain('the utterance');
    expect(r && r.ev === 'redo' && r.group).toContain('the utterance');
  });

  it('a rejected line sends no event at all', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    bad(f.apply('Q = Midpoint(A, Nope)'));
    bad(f.apply('A = Midpoint(M, B)'));
    bad(f.apply('a = Circle(A, 2)'));
    expect(rec.events).toEqual([]);
  });

  it('a dry run sends no event', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    f.apply('Z = (1, 1)', { dryRun: true });
    expect(rec.events).toEqual([]);
  });
});

describe('value and style events are batched, one per pass', () => {
  it('a drag of 200 writes then one flush gives one value event listing each changed id once', () => {
    const f = figure([...BASE, 'N = Midpoint(M, B)']);
    const rec = recordEvents(f);
    for (let i = 0; i < 200; i++) f.setFree('A', { x: i, y: i }, 'drag');
    f.flush();
    const vals = rec.events.filter((e) => e.ev === 'value');
    expect(vals.length).toBe(1);
    const ev = vals[0];
    if (ev?.ev === 'value') {
      expect(new Set(ev.ids).size).toBe(ev.ids.length);
      expect(ev.ids).toEqual(expect.arrayContaining([idOf(f, 'A'), idOf(f, 'M'), idOf(f, 'N')]));
      expect(ev.ids).not.toContain(idOf(f, 'B'));
    }
  });

  it('a pass in which nothing changed in value sends no value event (early cut-off)', () => {
    const f = figure(['a = 3.2', 'g = floor(a)', 'r = Reciprocal(g)']);
    const rec = recordEvents(f);
    f.setFree('a', 3.7, 'slider');
    f.flush();
    const vals = rec.events.filter((e) => e.ev === 'value');
    expect(vals.length).toBe(1);
    const ev = vals[0];
    if (ev?.ev === 'value') {
      expect(ev.ids).toEqual([idOf(f, 'a')]);
    }
  });

  it('nothing is sent when nothing changed', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    f.flush();
    expect(rec.events).toEqual([]);
  });

  it('a seek sends one value event for the t-dependent objects', () => {
    const f = figure(['x1 = 2 * t', 'x2 = x1 + 1', 'P = (1, 1)']);
    const rec = recordEvents(f);
    f.setClock(3);
    const vals = rec.events.filter((e) => e.ev === 'value');
    expect(vals.length).toBe(1);
    const ev = vals[0];
    if (ev?.ev === 'value') expect([...ev.ids].sort()).toEqual([idOf(f, 'x1'), idOf(f, 'x2')].sort());
  });

  it('a style rule that reads a changed object gives a style event, and no value event for the owner', () => {
    const f = figure([...BASE, 'P = (1, 1)', 'P with showIf = (a < 5)']);
    const rec = recordEvents(f);
    f.setFree('a', 8, 'slider');
    f.flush();
    const style = rec.events.filter((e) => e.ev === 'style');
    expect(style.length).toBe(1);
    const s = style[0];
    if (s?.ev === 'style') expect(s.ids).toEqual([idOf(f, 'P')]);
    const vals = rec.events.filter((e) => e.ev === 'value');
    for (const v of vals) if (v.ev === 'value') expect(v.ids).not.toContain(idOf(f, 'P'));
  });

  it('a style edge marks the owner for restyle, not for a maths recompute: its rule does not run', () => {
    const f = figure(['a = 3 in 0..10', 'A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)']);
    ok(f.apply('M with color = rgb(25 * a, 0, 128)'));
    resetRuns();
    f.setFree('a', 8, 'slider');
    f.flush();
    expect(runs.get('Midpoint') ?? 0).toBe(0);
    expect(f.value('M')).toEqual({ x: 2, y: 0 });
    expect(f.styleOf(idOf(f, 'M') as never)?.color.r).toBe(200);
  });

  it('a restyle line sends a style event, with no value event', () => {
    const f = figure(BASE);
    const rec = recordEvents(f);
    ok(f.apply('A with color = red'));
    expect(rec.events.filter((e) => e.ev === 'style').length).toBe(1);
    expect(rec.events.filter((e) => e.ev === 'value').length).toBe(0);
  });

  it('a redefinition sends the value event for the object and what follows', () => {
    const f = figure([...BASE, 'N = Midpoint(M, B)']);
    const rec = recordEvents(f);
    ok(f.apply('A = (2, 2)'));
    const vals = rec.events.filter((e) => e.ev === 'value');
    expect(vals.length).toBe(1);
    const ev = vals[0];
    if (ev?.ev === 'value') expect(ev.ids).toEqual(expect.arrayContaining([idOf(f, 'A'), idOf(f, 'M'), idOf(f, 'N')]));
  });
});

describe('listener faults never break the figure (kernel errors.md 5 rule 4)', () => {
  it('a listener that throws does not stop the line from committing', () => {
    const f = figure(BASE);
    f.on(() => {
      throw new Error('view crashed');
    });
    const r = ok(f.apply('Z = (1, 1)'));
    expect(r.ok).toBe(true);
    expect(f.get('Z')).toBeDefined();
    expect(f.value('Z')).toEqual({ x: 1, y: 1 });
  });

  it('the other listeners still get their events', () => {
    const f = figure(BASE);
    const seen: string[] = [];
    f.on(() => {
      throw new Error('first listener crashed');
    });
    f.on((e) => seen.push(e.ev));
    ok(f.apply('Z = (1, 1)'));
    expect(seen).toContain('add');
  });

  it('is reported as a listener_failed warning, not an error', () => {
    const f = figure(BASE);
    f.on(() => {
      throw new Error('view crashed');
    });
    const r = ok(f.apply('Z = (1, 1)'));
    const kinds = [...r.notices.map((n) => n.kind), ...f.takeWarnings().map((n) => n.kind)];
    expect(kinds).toContain('listener_failed');
    const n = r.notices.find((x) => x.kind === 'listener_failed');
    if (n) {
      expect(n.severity).toBe('warning');
      expect(n.code).toBe('K108');
    }
  });

  it('does not break the undo history', () => {
    const f = figure(BASE);
    f.on(() => {
      throw new Error('view crashed');
    });
    ok(f.apply('Z = (1, 1)'));
    ok(f.undo());
    expect(f.get('Z')).toBeUndefined();
    ok(f.redo());
    expect(f.get('Z')).toBeDefined();
  });

  it('a throwing listener during a flush does not stop the pass', () => {
    const f = figure(BASE);
    f.on(() => {
      throw new Error('view crashed');
    });
    f.setFree('A', { x: 2, y: 2 }, 'drag');
    expect(() => f.flush()).not.toThrow();
    expect(f.value('M')).toEqual({ x: 3, y: 1 });
  });
});

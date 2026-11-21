// @vitest-environment node
/**
 * R2 and R10 (design 4, errors.md): transactions apply all or nothing and send one diff with its origin; every record
 * is checked against its kind on write; limits refuse and change nothing.
 */
import { describe, expect, it } from 'vitest';
import { Store } from '../../src/index';
import type { BoardError, BoardRecord, Diff, Limits } from '../../src/index';
import { addRects, dump, keys, makeBoard, makeKinds, must, rectKind, shape } from './helpers';

const kindOf = (r: { readonly ok: boolean }): string => (r.ok ? 'ok' : (r as BoardError).kind);

describe('a transaction applies all of its writes together (design 4)', () => {
  it('applies every write and sends one diff with the origin', () => {
    const b = makeBoard();
    const diffs: Diff[] = [];
    b.store.on((d) => diffs.push(d));
    const r = must(b.store.change('model', (tx) => {
      must(tx.put(shape('shape:1', b.page)));
      must(tx.put(shape('shape:2', b.page, { x: 5 })));
      must(tx.put(shape('shape:3', b.page, { x: 9 })));
      return 'fn result';
    }));
    expect(r.value).toBe('fn result');
    expect(diffs).toHaveLength(1);
    const d = diffs[0] as Diff;
    expect(d.origin).toBe('model');
    expect(d.added.map((x) => x.id).sort()).toEqual(['shape:1', 'shape:2', 'shape:3']);
    expect(d.updated).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(r.diff.origin).toBe('model');
  });

  it('keeps the four origins as they were given', () => {
    const b = makeBoard();
    const seen: string[] = [];
    b.store.on((d) => seen.push(d.origin));
    let n = 0;
    for (const origin of ['user', 'model', 'host', 'remote'] as const) {
      must(b.store.change(origin, (tx) => void must(tx.put(shape(`shape:${++n}`, b.page)))));
    }
    expect(seen).toEqual(['user', 'model', 'host', 'remote']);
  });

  it('shows listeners the records already in their new state', () => {
    const b = makeBoard();
    let seen: BoardRecord | undefined;
    b.store.on((d) => {
      seen = b.store.get((d.added[0] as BoardRecord).id);
    });
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { x: 7 })))));
    expect(seen?.id).toBe('shape:1');
  });

  it('puts update and remove in the same diff, with before and after for the update', () => {
    const b = makeBoard();
    addRects(b, 3);
    const diffs: Diff[] = [];
    b.store.on((d) => diffs.push(d));
    must(b.store.change('user', (tx) => {
      must(tx.update('shape:1', { x: 99 }));
      must(tx.remove('shape:2'));
      must(tx.put(shape('shape:9', b.page, { index: 'a' })));
    }));
    expect(diffs).toHaveLength(1);
    const d = diffs[0] as Diff;
    expect(d.added.map((r) => r.id)).toEqual(['shape:9']);
    expect(d.removed.map((r) => r.id)).toEqual(['shape:2']);
    expect(d.updated).toHaveLength(1);
    const u = d.updated[0];
    expect((u?.before as { x: number }).x).toBe(0);
    expect((u?.after as { x: number }).x).toBe(99);
  });

  it('gives each id once with its net effect: add then remove is nothing, two updates are one', () => {
    const b = makeBoard();
    addRects(b, 1);
    const diffs: Diff[] = [];
    b.store.on((d) => diffs.push(d));
    must(b.store.change('user', (tx) => {
      must(tx.put(shape('shape:50', b.page)));
      must(tx.remove('shape:50'));
      must(tx.update('shape:1', { x: 1 }));
      must(tx.update('shape:1', { x: 2 }));
    }));
    const d = diffs[0] as Diff;
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.updated).toHaveLength(1);
    expect((d.updated[0]?.before as { x: number }).x).toBe(0);
    expect((d.updated[0]?.after as { x: number }).x).toBe(2);
    expect(b.store.has('shape:50')).toBe(false);
  });

  it('lets the callback read its own writes through tx.get while the store is unchanged', () => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => {
      must(tx.put(shape('shape:1', b.page, { x: 3 })));
      expect(tx.get('shape:1')?.id).toBe('shape:1');
      expect(b.store.has('shape:1')).toBe(false);
    }));
    expect(b.store.has('shape:1')).toBe(true);
  });

  it('sends no diff and calls no listener for a transaction that changes nothing', () => {
    const b = makeBoard();
    let calls = 0;
    b.store.on(() => void calls++);
    const r = must(b.store.change('user', () => 5));
    expect(r.value).toBe(5);
    expect(calls).toBe(0);
    expect(r.diff.added).toEqual([]);
    expect(r.diff.updated).toEqual([]);
    expect(r.diff.removed).toEqual([]);
  });

  it('applies the whole transaction or nothing: one bad record among good ones changes no record and sends no diff', () => {
    const b = makeBoard();
    addRects(b, 2);
    const before = dump(b.store);
    const sizeBefore = b.store.size;
    let calls = 0;
    b.store.on(() => void calls++);
    const r = b.store.change('user', (tx) => {
      must(tx.put(shape('shape:20', b.page)));
      must(tx.update('shape:1', { x: 500 }));
      must(tx.remove('shape:2'));
      return tx.put(shape('shape:21', b.page, { props: { w: -5, h: 1 } }));
    });
    expect(kindOf(r)).toBe('record_invalid');
    expect(dump(b.store)).toBe(before);
    expect(b.store.size).toBe(sizeBefore);
    expect(calls).toBe(0);
  });

  it('fails the whole transaction when the callback ignores a failed write and returns', () => {
    const b = makeBoard();
    const before = dump(b.store);
    const r = b.store.change('user', (tx) => {
      must(tx.put(shape('shape:1', b.page)));
      tx.put(shape('shape:2', b.page, { props: { w: 'wide' } }));
    });
    expect(r.ok).toBe(false);
    expect(dump(b.store)).toBe(before);
  });

  it('applies nothing when the callback throws, and returns an error instead of throwing', () => {
    const b = makeBoard();
    const before = dump(b.store);
    let calls = 0;
    b.store.on(() => void calls++);
    const r = b.store.change('user', (tx) => {
      must(tx.put(shape('shape:1', b.page)));
      throw new Error('boom');
    });
    expect(r.ok).toBe(false);
    expect(dump(b.store)).toBe(before);
    expect(calls).toBe(0);
    expect(b.store.change('user', () => 1).ok).toBe(true);
  });

  it('sends diffs to every listener in commit order, and a listener that throws stops no other and goes to onError', () => {
    const errors: BoardError[] = [];
    const store = new Store({ kinds: makeKinds(), onError: (e) => errors.push(e) });
    const order: string[] = [];
    store.on(() => {
      order.push('a');
      throw new Error('listener failed');
    });
    store.on(() => void order.push('b'));
    const r = store.change('user', (tx) => void must(tx.put({ id: 'page:1', name: 'P', index: 'V', background: 'none' })));
    expect(r.ok).toBe(true);
    expect(order).toEqual(['a', 'b']);
    expect(errors).toHaveLength(1);
    expect(store.has('page:1')).toBe(true);
  });

  it('stops sending after the function from on() is called', () => {
    const b = makeBoard();
    let n = 0;
    const off = b.store.on(() => void n++);
    addRects(b, 1);
    off();
    addRects(b, 1);
    expect(n).toBe(1);
  });

  it('gives ids nobody uses yet, the same ones for the same steps', () => {
    const run = (): string[] => {
      const b = makeBoard();
      const ids: string[] = [];
      must(b.store.change('user', (tx) => {
        ids.push(tx.newId('shape'), tx.newId('shape'), tx.newId('binding'));
      }));
      return ids;
    };
    const first = run();
    expect(first[0]).toMatch(/^shape:/);
    expect(first[2]).toMatch(/^binding:/);
    expect(new Set(first).size).toBe(3);
    expect(run()).toEqual(first);
  });

  it('mints an id that does not collide with an existing record', () => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => void must(tx.put(shape(tx.newId('shape'), b.page)))));
    const next = b.store.mintId('shape');
    expect(b.store.has(next)).toBe(false);
    expect(next).toMatch(/^shape:/);
  });

  it('keeps patch merging one level deep for props and meta, replaces other fields, and never changes the id', () => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { props: { w: 10, h: 20 }, meta: { a: 1, b: 2 } })))));
    must(b.store.change('user', (tx) => void must(tx.update('shape:1', { props: { w: 30 }, meta: { b: 3 }, x: 4 }))));
    const s = b.store.get('shape:1') as unknown as { props: { w: number; h: number }; meta: Record<string, number>; x: number; id: string };
    expect(s.props).toEqual({ w: 30, h: 20 });
    expect(s.meta).toEqual({ a: 1, b: 3 });
    expect(s.x).toBe(4);
    b.store.change('user', (tx) => {
      const u = tx.update('shape:1', { id: 'shape:77' });
      return u.ok ? u.value.id : 'refused';
    });
    expect(b.store.has('shape:77')).toBe(false);
    expect(b.store.has('shape:1')).toBe(true);
  });

  it('refuses to update or remove a record that does not exist, without throwing', () => {
    const b = makeBoard();
    let u: unknown;
    let rm: unknown;
    const r = b.store.change('user', (tx) => {
      u = tx.update('shape:404', { x: 1 });
      rm = tx.remove('shape:404');
    });
    expect((u as { ok: boolean }).ok).toBe(false);
    expect((rm as { ok: boolean }).ok).toBe(false);
    // a write that fails fails the whole transaction (the Tx contract)
    expect(r.ok).toBe(false);
  });
});

describe('records are plain JSON and checked on every write (R2.1)', () => {
  it('stores records that survive a JSON round trip unchanged', () => {
    const b = makeBoard();
    addRects(b, 2);
    for (const r of b.store.all()) expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('refuses a shape whose props its kind refuses, with record_invalid naming the record and the field', () => {
    const b = makeBoard();
    const r = b.store.change('user', (tx) => {
      const w = tx.put(shape('shape:1', b.page, { props: { w: 'x', h: 1 } }));
      expect(w.ok).toBe(false);
      if (!w.ok) {
        expect(w.kind).toBe('record_invalid');
        expect(w.detail?.['field']).toBe('props.w');
        expect(JSON.stringify(w.detail)).toContain('shape:1');
      }
      return w;
    });
    expect(r.ok).toBe(false);
    expect(b.store.has('shape:1')).toBe(false);
  });

  it('fills the kind’s defaults into the stored props', () => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { props: {} })))));
    expect((b.store.get('shape:1') as unknown as { props: unknown }).props).toEqual(rectKind.defaults);
  });

  it('refuses a shape of a kind that is not registered (kind_unknown) and leaves the store as it was', () => {
    const b = makeBoard();
    const before = dump(b.store);
    const r = b.store.change('user', (tx) => {
      const w = tx.put(shape('shape:1', b.page, { kind: 'hologram', props: { x: 1 } }));
      expect(!w.ok && w.kind).toBe('kind_unknown');
      return w;
    });
    expect(r.ok).toBe(false);
    expect(dump(b.store)).toBe(before);
  });

  it('keeps a shape of an unregistered kind unchanged when the change allows unknown kinds', () => {
    const b = makeBoard();
    must(b.store.change('host', (tx) => void must(tx.put(shape('shape:1', b.page, { kind: 'hologram', props: { nested: { a: [1, 2] } } }))), { allowUnknownKinds: true }));
    expect((b.store.get('shape:1') as unknown as { props: unknown }).props).toEqual({ nested: { a: [1, 2] } });
  });

  it('refuses a record with an id that is not of one of the five types', () => {
    const b = makeBoard();
    const r = b.store.change('user', (tx) => void must(tx.put({ ...shape('thing:1', b.page) })));
    expect(r.ok).toBe(false);
  });

  it('refuses a shape on a page that does not exist', () => {
    const b = makeBoard();
    const r = b.store.change('user', (tx) => void must(tx.put(shape('shape:1', 'page:nope'))));
    expect(r.ok).toBe(false);
    expect(b.store.has('shape:1')).toBe(false);
  });

  it('refuses a shape with opacity outside 0 to 1, or a non-finite position', () => {
    const b = makeBoard();
    for (const over of [{ opacity: 2 }, { opacity: -0.1 }, { x: Number.NaN }, { y: Number.POSITIVE_INFINITY }, { rotation: Number.NaN }]) {
      const r = b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, over))));
      expect(r.ok, JSON.stringify(over)).toBe(false);
    }
    expect(b.store.has('shape:1')).toBe(false);
  });

  it('refuses a page record with a bad background, and a camera with a zoom outside 0.05 to 20', () => {
    const b = makeBoard();
    const p = b.store.change('user', (tx) => void must(tx.put({ id: 'page:9', name: 'x', index: 'a', background: 'checks' as never })));
    expect(p.ok).toBe(false);
    for (const zoom of [0.01, 21, 0, -1, Number.NaN]) {
      const r = b.store.change('user', (tx) => void must(tx.put({ id: `camera:${b.page}`, page: b.page, x: 0, y: 0, zoom })), { history: false });
      expect(r.ok, `zoom ${zoom}`).toBe(false);
    }
  });

  it('accepts camera zoom at exactly the two limits', () => {
    const b = makeBoard();
    for (const [i, zoom] of [0.05, 20].entries()) {
      const r = b.store.change('user', (tx) => void must(tx.put({ id: `camera:c${i}`, page: b.page, x: 0, y: 0, zoom })), { history: false });
      expect(r.ok, `zoom ${zoom}`).toBe(true);
    }
  });

  it('reads the record with get, has, all, all(kind), shapesOn and shapeCount', () => {
    const b = makeBoard();
    addRects(b, 4);
    expect(b.store.has('shape:1')).toBe(true);
    expect(b.store.get('shape:1')?.id).toBe('shape:1');
    expect(b.store.all('shape')).toHaveLength(4);
    expect(b.store.all('rect')).toHaveLength(4);
    expect(b.store.all('page')).toHaveLength(1);
    expect(b.store.shapesOn(b.page)).toHaveLength(4);
    expect(b.store.shapeCount(b.page)).toBe(4);
    expect(b.store.get('shape:404')).toBeUndefined();
    expect(b.store.size).toBe(b.store.all().length);
  });
});

describe('over a limit the transaction is refused with limit and changes nothing (R2.4)', () => {
  const refused = (r: { readonly ok: boolean }): BoardError => {
    expect(r.ok).toBe(false);
    return r as BoardError;
  };

  it('refuses the shape past shapesPerPage, names the limit, hints at a page, and applies none of the transaction', () => {
    const b = makeBoard({ shapesPerPage: 5 });
    addRects(b, 4);
    const before = dump(b.store);
    const idx = keys(3);
    let calls = 0;
    b.store.on(() => void calls++);
    const r = b.store.change('user', (tx) => {
      for (let i = 0; i < 3; i++) must(tx.put(shape(`shape:${100 + i}`, b.page, { index: idx[i] as string })));
    });
    const e = refused(r);
    expect(e.kind).toBe('limit');
    expect(e.detail?.['limit']).toBe(5);
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.hint?.length ?? 0).toBeGreaterThan(0);
    expect(dump(b.store)).toBe(before);
    expect(b.store.shapeCount(b.page)).toBe(4);
    expect(calls).toBe(0);
  });

  it('allows exactly the limit', () => {
    const b = makeBoard({ shapesPerPage: 5 });
    addRects(b, 5);
    expect(b.store.shapeCount(b.page)).toBe(5);
    const r = b.store.change('user', (tx) => void must(tx.put(shape('shape:99', b.page, { index: 'z' }))));
    expect(refused(r).kind).toBe('limit');
  });

  it('counts the limit per page, so a second page has its own room', () => {
    const b = makeBoard({ shapesPerPage: 2 });
    addRects(b, 2);
    const p2 = must(b.pages.addPage());
    expect(() => addRects(b, 2, p2.id)).not.toThrow();
    expect(b.store.shapeCount(p2.id)).toBe(2);
  });

  it('counts a remove and an add in one transaction as net, so swapping a shape at the limit works', () => {
    const b = makeBoard({ shapesPerPage: 3 });
    addRects(b, 3);
    const r = b.store.change('user', (tx) => {
      must(tx.remove('shape:1'));
      must(tx.put(shape('shape:50', b.page, { index: 'zz' })));
    });
    expect(r.ok).toBe(true);
    expect(b.store.shapeCount(b.page)).toBe(3);
  });

  it('refuses ink past inkPointsPerPage (2 million by default) and leaves the count as it was', () => {
    const b = makeBoard({ inkPointsPerPage: 100 });
    const stroke = (id: string, n: number, index: string) => shape(id, b.page, { kind: 'ink', index, props: { points: new Float32Array(n * 3), size: 4 } });
    must(b.store.change('user', (tx) => void must(tx.put(stroke('shape:1', 60, 'a')))));
    expect(b.store.inkPoints(b.page)).toBe(60);
    const before = dump(b.store);
    const r = b.store.change('user', (tx) => void must(tx.put(stroke('shape:2', 41, 'b'))));
    const e = refused(r);
    expect(e.kind).toBe('limit');
    expect(e.detail?.['limit']).toBe(100);
    expect(b.store.inkPoints(b.page)).toBe(60);
    expect(dump(b.store)).toBe(before);
    const fits = b.store.change('user', (tx) => void must(tx.put(stroke('shape:3', 40, 'c'))));
    expect(fits.ok).toBe(true);
    expect(b.store.inkPoints(b.page)).toBe(100);
  });

  it('has the default limits of the design', () => {
    const b = makeBoard();
    const l: Limits = b.store.limits;
    expect(l.shapesPerPage).toBe(10_000);
    expect(l.pages).toBe(100);
    expect(l.inkPointsPerPage).toBe(2_000_000);
    expect(l.assetBytes).toBe(50 * 1024 * 1024);
  });

  it('refuses an asset past the asset bytes limit, and keeps the earlier ones', () => {
    const b = makeBoard({ assetBytes: 20 });
    const png = 'iVBORw0KGgo=';
    const asset = (id: string, size: number) => ({ id, mime: 'image/png', size, data: png });
    const first = b.store.change('user', (tx) => void must(tx.put(asset('asset:1', 8))));
    expect(first.ok).toBe(true);
    const before = dump(b.store);
    const r = b.store.change('user', (tx) => {
      must(tx.put(asset('asset:2', 8)));
      must(tx.put(asset('asset:3', 8)));
    });
    expect(refused(r).kind).toBe('limit');
    expect(dump(b.store)).toBe(before);
    expect(b.store.assetBytes).toBe(8);
  });

  it('refuses a transaction that mixes a shape past the limit with other valid writes, and applies none', () => {
    const b = makeBoard({ shapesPerPage: 1 });
    addRects(b, 1);
    const before = dump(b.store);
    const r = b.store.change('user', (tx) => {
      must(tx.update('shape:1', { x: 77 }));
      must(tx.put({ id: 'page:extra', name: 'extra', index: 'zzz', background: 'none' }));
      must(tx.put(shape('shape:2', b.page, { index: 'zz' })));
    });
    expect(refused(r).kind).toBe('limit');
    expect(dump(b.store)).toBe(before);
  });
});

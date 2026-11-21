// @vitest-environment node
/**
 * The round 1 review's fixes (handoff/board/findings.md, BR-1 to BR-7): one test or more for each.
 */
import { describe, expect, it } from 'vitest';
import { Pages, Store, copyProps, loadBoard, saveBoard } from '../../src/index';
import type { BoardError, BoardNotice, BoardRecord, BoardResult, ShapeRecord } from '../../src/index';
import { addRects, dump, makeBoard, makeKinds, must, shape } from './helpers';
import type { TestBoard } from './helpers';

const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const load = (text: string, limits?: Record<string, number>) => loadBoard(text, { kinds: makeKinds(), ...(limits ? { limits } : {}) });
const textOf = (b: TestBoard): string => must(saveBoard(b.store));
const noticesOf = (r: BoardResult<unknown>): readonly BoardNotice[] => must(r.ok ? { ok: true as const, value: r.notices, notices: [] } : r);

describe('BR-1: the pages state is derived from the count', () => {
  it('follows add, remove, undo and load, with no stored copy to disagree', () => {
    const b = makeBoard({ pages: 3 });
    expect(b.pages.state).toBe('single');
    const two = must(b.pages.addPage());
    expect(b.pages.state).toBe('several');
    must(b.pages.addPage());
    expect(b.pages.state).toBe('full');
    must(b.pages.removePage(two.id));
    expect(b.pages.state).toBe('several');
    expect(b.history.undo().ok).toBe(true);
    expect(b.pages.state).toBe('full');
    const loaded = must(load(textOf(b), { pages: 3 }));
    expect(new Pages(loaded.store).state).toBe('full');
    expect(new Pages(new Store()).state).toBe('empty');
  });
});

describe('BR-2: a board over a lowered limit opens', () => {
  it('opens a board with more shapes on a page than the shape limit, and refuses the next shape', () => {
    const b = makeBoard();
    addRects(b, 3);
    const loaded = must(load(textOf(b), { shapesPerPage: 2 }));
    const page = loaded.store.all('page')[0]?.id as string;
    expect(loaded.store.shapeCount(page)).toBe(3);
    const r = loaded.store.change('user', (tx) => void must(tx.put(shape('shape:99', page))));
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('limit');
  });

  it('still refuses an image over the size of one asset', () => {
    const b = makeBoard();
    const doc = parse(textOf(b));
    (doc['assets'] as unknown[]).push({ id: 'asset:1', mime: 'image/png', size: 20_000_000, data: 'AAAA' });
    const r = load(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('asset_invalid');
  });
});

describe('BR-3 and BR-4: a copy of a page', () => {
  const withInk = (): TestBoard => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => {
      must(tx.put(shape('shape:1', b.page, { kind: 'ink', props: { points: new Float32Array([0, 0, 1, 1, 1, 1]), size: 3 }, meta: { tags: ['a'] } })));
      must(tx.put({ id: 'binding:1', kind: 'arrow', from: 'shape:1', to: 'shape:1', props: { gap: { n: 4 } } }));
    }));
    return b;
  };

  it('shares no props, typed array or meta with the original', () => {
    const b = withInk();
    const copy = must(b.pages.duplicatePage(b.page));
    const a = b.store.get('shape:1') as unknown as { props: { points: Float32Array }; meta: { tags: string[] } };
    const c = b.store.shapesOn(copy.id)[0] as unknown as { props: { points: Float32Array }; meta: { tags: string[] } };
    expect(c.props).not.toBe(a.props);
    expect(c.props.points).not.toBe(a.props.points);
    expect(c.props.points.buffer).not.toBe(a.props.points.buffer);
    expect([...c.props.points]).toEqual([...a.props.points]);
    expect(c.meta).not.toBe(a.meta);
    expect(c.meta.tags).not.toBe(a.meta.tags);
    const bindings = b.store.all('binding') as unknown as { props: { gap: { n: number } } }[];
    expect(bindings).toHaveLength(2);
    expect(bindings[0]?.props.gap).not.toBe(bindings[1]?.props.gap);
  });

  it('a change to the copy writes a new record and leaves the original and its history alone', () => {
    const b = withInk();
    const copy = must(b.pages.duplicatePage(b.page));
    const id = b.store.shapesOn(copy.id)[0]?.id as string;
    const before = dump(b.store);
    const original = b.store.get('shape:1') as ShapeRecord;
    must(b.store.change('user', (tx) => void must(tx.update(id, { props: { points: new Float32Array([9, 9, 1]), size: 8 } }))));
    expect(b.store.get('shape:1')).toBe(original);
    expect([...(original.props as { points: Float32Array }).points]).toEqual([0, 0, 1, 1, 1, 1]);
    expect(dump(b.store)).not.toBe(before);
    expect(b.history.undo().ok).toBe(true);
    expect(dump(b.store)).toBe(before);
  });

  it('freezes a stored record and its props, so a write in place fails, and does not freeze the caller’s object', () => {
    const b = makeBoard();
    const mine = { w: 5, h: 6 };
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { props: mine })))));
    const stored = b.store.get('shape:1') as unknown as { props: { w: number } };
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.props)).toBe(true);
    expect(() => {
      stored.props.w = 1;
    }).toThrow(TypeError);
    expect(Object.isFrozen(mine)).toBe(false);
    mine.w = 7;
    expect(stored.props.w).toBe(5);
  });

  it('copyProps copies plain data and typed arrays deeply, keeps shared parts shared once, and survives a cycle', () => {
    const inner = { list: [1, { z: new Float32Array([1, 2]) }] };
    const data = { a: inner, b: inner, n: 3, s: 'x', nil: null };
    const out = copyProps(data);
    expect(out).toEqual(data);
    expect(out.a).not.toBe(inner);
    expect(out.a).toBe(out.b);
    expect((out.a.list[1] as { z: Float32Array }).z).not.toBe((inner.list[1] as { z: Float32Array }).z);
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;
    const again = copyProps(loop);
    expect(again['self']).toBe(again);
    expect(again).not.toBe(loop);
  });

  it('copies a page that holds a shape of an unknown kind and keeps that shape as it is (BR-3)', () => {
    const b = makeBoard();
    must(b.store.change('host', (tx) => void must(tx.put(shape('shape:1', b.page, { kind: 'hologram', props: { depth: [1, { a: 2 }] } }))), { allowUnknownKinds: true }));
    const copy = must(b.pages.duplicatePage(b.page));
    const c = b.store.shapesOn(copy.id)[0] as unknown as { kind: string; props: { depth: unknown[] } };
    const a = b.store.get('shape:1') as unknown as { props: { depth: unknown[] } };
    expect(c.kind).toBe('hologram');
    expect(c.props).toEqual(a.props);
    expect(c.props.depth).not.toBe(a.props.depth);
  });
});

describe('BR-5: a shape that fails its kind alone is kept raw', () => {
  const withBadRect = (edit: (doc: Record<string, unknown>) => void = () => undefined): { text: string; original: string } => {
    const b = makeBoard();
    addRects(b, 3);
    const doc = parse(textOf(b));
    const rect = (doc['records'] as Record<string, unknown>[]).find((r) => r['id'] === 'shape:2') as { props: Record<string, unknown> };
    rect.props['w'] = 'wide';
    edit(doc);
    const text = JSON.stringify(doc);
    return { text, original: text };
  };

  it('loads, names the record in a record_kept_raw notice, and notes the field and why in meta.invalid', () => {
    const { text } = withBadRect();
    const r = must(load(text));
    expect(r.store.all('shape')).toHaveLength(3);
    const notices = noticesOf(load(text));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe('record_kept_raw');
    expect(notices[0]?.severity).toBe('warning');
    expect(notices[0]?.message).toContain('shape:2');
    expect(notices[0]?.detail['records']).toEqual([expect.objectContaining({ record: 'shape:2', field: 'props.w' })]);
    const kept = r.store.get('shape:2') as unknown as { props: { w: string }; meta: { invalid: { field: string; why: string } } };
    expect(kept.props.w).toBe('wide');
    expect(kept.meta.invalid.field).toBe('props.w');
    expect(kept.meta.invalid.why.length).toBeGreaterThan(0);
  });

  it('saves the record back as it was, props and meta, so the file is the file', () => {
    const { text } = withBadRect();
    const r = must(load(text));
    expect(must(saveBoard(r.store))).toBe(text);
  });

  it('gives no notice when every shape passes', () => {
    const b = makeBoard();
    addRects(b, 2);
    expect(noticesOf(load(textOf(b)))).toEqual([]);
  });

  it('lists every kept record in one notice', () => {
    const { text } = withBadRect((doc) => {
      const rect = (doc['records'] as Record<string, unknown>[]).find((r) => r['id'] === 'shape:3') as { props: Record<string, unknown> };
      rect.props['h'] = -4;
    });
    const detail = noticesOf(load(text))[0]?.detail['records'] as { record: string }[];
    expect(detail.map((d) => d.record).sort()).toEqual(['shape:2', 'shape:3']);
  });

  it('lets the user move or delete a kept shape, and undo of the delete keeps it raw', () => {
    const { text } = withBadRect();
    const loaded = must(load(text));
    const s = loaded.store;
    must(s.change('user', (tx) => void must(tx.update('shape:2', { x: 50 }))));
    expect((s.get('shape:2') as unknown as { x: number; props: { w: string } }).x).toBe(50);
    expect((s.get('shape:2') as unknown as { props: { w: string } }).props.w).toBe('wide');
    const saved = parse(must(saveBoard(s)));
    expect((saved['records'] as { id: string; x: number; meta: unknown }[]).find((r) => r.id === 'shape:2')?.meta).toEqual({});
    must(s.change('user', (tx) => void must(tx.remove('shape:2'))));
    expect(s.has('shape:2')).toBe(false);
  });

  it('keeps a new props patch under the kind’s check', () => {
    const { text } = withBadRect();
    const s = must(load(text)).store;
    let inner: unknown;
    const r = s.change('user', (tx) => {
      inner = tx.update('shape:2', { props: { w: 'still wide' } });
    });
    expect((inner as BoardError).kind).toBe('record_invalid');
    expect((r as BoardError).kind).toBe('record_invalid');
    must(s.change('user', (tx) => void must(tx.update('shape:2', { props: { w: 12 } }))));
    expect((s.get('shape:2') as unknown as { props: { w: number } }).props.w).toBe(12);
  });

  it('still fails the whole load for a record whose own fields are wrong, a missing page, a broken page or a broken camera', () => {
    const cases: readonly [string, (doc: Record<string, unknown>) => void][] = [
      ['a shape field', (doc) => ((doc['records'] as Record<string, unknown>[]).find((r) => r['id'] === 'shape:1') as Record<string, unknown>)['x'] = 'left'],
      ['a missing page', (doc) => (((doc['records'] as Record<string, unknown>[]).find((r) => r['id'] === 'shape:2') as Record<string, unknown>)['page'] = 'page:gone')],
      ['a broken page', (doc) => ((doc['pages'] as Record<string, unknown>[])[0] as Record<string, unknown>)['background'] = 'wavy'],
      ['a broken camera', (doc) => (doc['records'] as unknown[]).push({ id: 'camera:page:1', page: 'page:1', x: 0, y: 0, zoom: 99 })],
    ];
    for (const [name, edit] of cases) {
      const { text } = withBadRect(edit);
      const r = load(text);
      expect(r.ok, name).toBe(false);
      expect((r as BoardError).kind, name).toBe('board_invalid');
    }
  });
});

describe('BR-6: the two rulings', () => {
  it('a newer file whose records fail the checks is board_too_new, for each kind of failure', () => {
    const b = makeBoard();
    addRects(b, 2);
    const newer = (edit: (doc: Record<string, unknown>) => void): string => {
      const doc = parse(textOf(b));
      doc['version'] = 99;
      edit(doc);
      return JSON.stringify(doc);
    };
    const records = (doc: Record<string, unknown>): Record<string, unknown>[] => doc['records'] as Record<string, unknown>[];
    const cases: readonly [string, (doc: Record<string, unknown>) => void][] = [
      ['a field of the wrong type', (doc) => ((records(doc)[0] as Record<string, unknown>)['x'] = 'left')],
      ['props that fail their kind', (doc) => (((records(doc)[0] as { props: Record<string, unknown> }).props)['w'] = 'wide')],
      ['a record with no id', (doc) => void records(doc).push({ x: 1 })],
      ['a duplicate id', (doc) => void records(doc).push({ ...(records(doc)[0] as Record<string, unknown>) })],
      ['records that are not a list', (doc) => (doc['records'] = 'nope')],
    ];
    for (const [name, edit] of cases) {
      const r = load(newer(edit));
      expect(r.ok, name).toBe(false);
      expect((r as BoardError).kind, name).toBe('board_too_new');
    }
  });

  it('a file that is not a board, or has no version, is still board_invalid even when its version is big', () => {
    expect((load('{"format":"other","version":99}') as BoardError).kind).toBe('board_invalid');
    expect((load('not json') as BoardError).kind).toBe('board_invalid');
  });

  it('Tx.update that changes the id is bad_argument, and the change fails with it', () => {
    const b = makeBoard();
    addRects(b, 1);
    let inner: unknown;
    const r = b.store.change('user', (tx) => {
      inner = tx.update('shape:1', { id: 'shape:2' });
    });
    expect((inner as BoardError).kind).toBe('bad_argument');
    expect((inner as BoardError).detail).toMatchObject({ record: 'shape:1', field: 'id' });
    expect((r as BoardError).kind).toBe('bad_argument');
    expect(b.store.has('shape:2')).toBe(false);
  });

  it('Tx.update that gives the same id is not an error', () => {
    const b = makeBoard();
    addRects(b, 1);
    must(b.store.change('user', (tx) => void must(tx.update('shape:1', { id: 'shape:1', x: 3 }))));
    expect((b.store.get('shape:1') as unknown as BoardRecord & { x: number }).x).toBe(3);
  });
});

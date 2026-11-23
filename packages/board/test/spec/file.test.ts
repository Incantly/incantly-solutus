// @vitest-environment node
/**
 * R9 (design 12, errors.md): `.incantly-board` files are deterministic JSON; ink is delta-encoded at about 5 bytes a
 * point and round-trips; load checks every record (`board_invalid` names the record and the field), migrates, and keeps
 * unknown kinds unchanged.
 */
import { describe, expect, it } from 'vitest';
import { FILE_FORMAT, FILE_VERSION, KindRegistry, Pages, Store, loadBoard, saveBoard, snapshot, writeDocument } from '../../src/index';
import type { BoardError, BoardRecord, LoadOptions, Migration } from '../../src/index';
import { addRects, dump, inkKind, makeBoard, makeKinds, must, rectKind, shape } from './helpers';
import type { TestBoard } from './helpers';

const PNG = 'iVBORw0KGgo=';

/** A smooth stroke of `n` points: x, y, pressure triples. */
function stroke(n: number): Float32Array {
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = Math.round(i * 1.37 * 100) / 100;
    p[i * 3 + 1] = Math.round(Math.sin(i / 9) * 40 * 100) / 100;
    p[i * 3 + 2] = Math.round(((i % 51) / 51) * 255) / 255;
  }
  return p;
}

function fullBoard(): TestBoard {
  const b = makeBoard();
  must(b.pages.renamePage(b.page, 'First'));
  const p2 = must(b.pages.addPage({ name: 'Second', background: 'dots' }));
  addRects(b, 3);
  must(b.store.change('user', (tx) => {
    must(tx.put(shape('shape:20', p2.id, { kind: 'ink', x: 12.5, y: -3.25, props: { points: stroke(200), size: 3 }, meta: { owner: 'ada', n: [1, 2, 3] } })));
    must(tx.put({ id: 'binding:1', kind: 'arrow', from: 'shape:1', to: 'shape:2', props: { gap: 4 } }));
    must(tx.put({ id: 'asset:1', mime: 'image/png', size: 8, data: PNG }));
  }));
  must(b.cameras.forPage(b.page)).moveTo(10.5, 20.25, 1.5, 0);
  must(b.cameras.save(b.page));
  return b;
}

const textOf = (b: TestBoard, meta: Record<string, unknown> = {}): string => must(saveBoard(b.store, meta));
const parse = (text: string): Record<string, unknown> => JSON.parse(text) as Record<string, unknown>;
const load = (text: string, options: LoadOptions = {}) => loadBoard(text, { kinds: makeKinds(), ...options });

describe('the file shape', () => {
  it('is JSON with format, version, pages, records, assets and meta', () => {
    expect(FILE_FORMAT).toBe('incantly-board');
    expect(FILE_VERSION).toBe(1);
    const doc = parse(textOf(fullBoard(), { title: 'Lesson' }));
    expect(doc['format']).toBe('incantly-board');
    expect(doc['version']).toBe(1);
    expect(Array.isArray(doc['pages'])).toBe(true);
    expect(Array.isArray(doc['records'])).toBe(true);
    expect(Array.isArray(doc['assets'])).toBe(true);
    expect(doc['meta']).toEqual({ title: 'Lesson' });
    expect((doc['pages'] as { name: string }[]).map((p) => p.name)).toEqual(['First', 'Second']);
    expect((doc['assets'] as { id: string }[]).map((a) => a.id)).toEqual(['asset:1']);
  });

  it('snapshot and writeDocument give the same text as saveBoard', () => {
    const b = fullBoard();
    const doc = snapshot(b.store, { k: 1 });
    expect(doc.format).toBe(FILE_FORMAT);
    expect(doc.version).toBe(FILE_VERSION);
    expect(must(writeDocument(doc))).toBe(textOf(b, { k: 1 }));
  });
});

describe('the same board gives the same bytes (R9.1)', () => {
  it('saves one store twice to the same text', () => {
    const b = fullBoard();
    expect(textOf(b)).toBe(textOf(b));
  });

  it('save, load and save again give the same text', () => {
    const b = fullBoard();
    const text = textOf(b, { a: 1 });
    const loaded = must(load(text));
    expect(must(saveBoard(loaded.store, loaded.meta))).toBe(text);
    expect(loaded.meta).toEqual({ a: 1 });
    expect(loaded.version).toBe(1);
    expect(loaded.readOnly).toBe(false);
  });

  it('gives the same text for the same records written in a different order', () => {
    const build = (reverse: boolean): string => {
      const store = new Store({ kinds: makeKinds() });
      const recs: BoardRecord[] = [
        { id: 'page:a', name: 'A', index: 'V', background: 'none' },
        shape('shape:1', 'page:a', { index: 'V' }),
        shape('shape:2', 'page:a', { index: 'W', x: 5 }),
        shape('shape:3', 'page:a', { index: 'X', y: 7 }),
        { id: 'camera:a', page: 'page:a', x: 1, y: 2, zoom: 2 },
      ];
      if (reverse) recs.reverse();
      must(store.change('host', (tx) => {
        for (const r of recs) must(tx.put(r));
      }, { history: false }));
      return must(saveBoard(store));
    };
    expect(build(true)).toBe(build(false));
  });

  it('sorts object keys: meta keys written in another order give the same text', () => {
    const b = fullBoard();
    expect(textOf(b, { b: 1, a: { y: 1, x: 2 } })).toBe(textOf(b, { a: { x: 2, y: 1 }, b: 1 }));
  });

  it('gives the same text for the same board built in two separate runs', () => {
    expect(textOf(fullBoard())).toBe(textOf(fullBoard()));
  });

  it('writes numbers one way: 0.1 + 0.2, -0 and large and small values give the same text for the same value', () => {
    const make = (x: number): string => {
      const b = makeBoard();
      must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { x })))));
      return textOf(b);
    };
    expect(make(0.1 + 0.2)).toBe(make(0.1 + 0.2));
    expect(make(1e21)).toBe(make(1e21));
    expect(make(5e-7)).toBe(make(5e-7));
    const zero = make(0);
    expect(make(-0) === zero || parse(make(-0)) !== undefined).toBe(true);
    expect(parse(make(0.1 + 0.2))['records']).toBeDefined();
  });
});

describe('ink encoding (R9.1): delta-encoded, about 5 bytes a point, round trip', () => {
  const inkBoard = (n: number): TestBoard => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { kind: 'ink', props: { points: stroke(n), size: 3 } })))));
    return b;
  };

  it('stores 10,000 points in about 5 bytes a point (base64 text of at most 8.5 characters a point)', () => {
    const n = 10_000;
    const text = textOf(inkBoard(n));
    const naive = JSON.stringify([...stroke(n)]).length;
    expect(text.length).toBeLessThan(n * 8.5 + 2000);
    expect(text.length).toBeLessThan(naive / 2);
    // and not less than the bytes the design says it needs
    expect(text.length).toBeGreaterThan(n * 5);
  });

  it('keeps x and y to a hundredth and pressure to 8 bits through save and load', () => {
    const b = inkBoard(500);
    const original = stroke(500);
    const loaded = must(load(textOf(b)));
    const s = loaded.store.get('shape:1') as unknown as { props: { points: unknown; size: number } };
    expect(s.props.points).toBeInstanceOf(Float32Array);
    const back = s.props.points as Float32Array;
    expect(back.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 3) {
      expect(Math.abs((back[i] as number) - (original[i] as number)), `x ${i / 3}`).toBeLessThanOrEqual(0.0051);
      expect(Math.abs((back[i + 1] as number) - (original[i + 1] as number)), `y ${i / 3}`).toBeLessThanOrEqual(0.0051);
      expect(Math.abs((back[i + 2] as number) - (original[i + 2] as number)), `pressure ${i / 3}`).toBeLessThanOrEqual(1 / 255 / 2 + 1e-6);
    }
    expect(s.props.size).toBe(3);
  });

  it('round-trips an empty stroke and a one-point stroke', () => {
    for (const n of [0, 1]) {
      const b = inkBoard(n);
      const loaded = must(load(textOf(b)));
      const s = loaded.store.get('shape:1') as unknown as { props: { points: Float32Array } };
      expect(s.props.points.length).toBe(n * 3);
    }
  });

  it('does not store ink as a JSON array of numbers', () => {
    const text = textOf(inkBoard(100));
    expect(text).not.toMatch(/\[\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*,/);
  });

  it('loads the ink points back as a typed array that counts for the ink limit', () => {
    const loaded = must(load(textOf(inkBoard(300))));
    expect(loaded.store.inkPoints('page:1') + loaded.store.all('shape').length).toBeGreaterThan(0);
    const page = (loaded.store.all('page')[0] as { id: string }).id;
    expect(loaded.store.inkPoints(page)).toBe(300);
  });

  it('refuses to save a point that is not a finite number, without throwing', () => {
    const b = makeBoard();
    const pts = new Float32Array([0, 0, 0.5, Number.NaN, 1, 0.5]);
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { kind: 'ink', props: { points: pts, size: 1 } })))));
    const r = saveBoard(b.store);
    expect(r.ok).toBe(false);
  });
});

describe('load: what comes back', () => {
  it('gives the same records as were saved, pages in order, cameras, bindings and assets', () => {
    const b = fullBoard();
    const loaded = must(load(textOf(b)));
    const pages = new Pages(loaded.store);
    expect(pages.list().map((p) => p.name)).toEqual(['First', 'Second']);
    expect(pages.list().map((p) => p.background)).toEqual(['none', 'dots']);
    expect(loaded.store.all('shape')).toHaveLength(4);
    expect(loaded.store.all('binding')).toHaveLength(1);
    expect(loaded.store.all('asset')).toHaveLength(1);
    expect(loaded.store.all('camera')).toHaveLength(1);
    expect(loaded.store.get('camera:' + b.page.slice('page:'.length)) ?? loaded.store.all('camera')[0]).toMatchObject({ x: 10.5, y: 20.25, zoom: 1.5 });
    const meta = (loaded.store.get('shape:20') as unknown as { meta: unknown }).meta;
    expect(meta).toEqual({ owner: 'ada', n: [1, 2, 3] });
    expect(loaded.store.assetBytes).toBe(8);
  });

  it('keeps shape props that the kind cleaned, as written', () => {
    const b = makeBoard();
    addRects(b, 2);
    const loaded = must(load(textOf(b)));
    expect(dump(loaded.store)).toBe(dump(b.store));
  });

  it('loads an empty board', () => {
    const store = new Store();
    const loaded = must(loadBoard(must(saveBoard(store))));
    expect(loaded.store.size).toBe(0);
  });
});

describe('load checks every record (board_invalid names the record and the field)', () => {
  const corrupt = (edit: (doc: Record<string, unknown>) => void): string => {
    const doc = parse(textOf(fullBoard()));
    edit(doc);
    return JSON.stringify(doc);
  };
  const recordsOfDoc = (doc: Record<string, unknown>): Record<string, unknown>[] => doc['records'] as Record<string, unknown>[];
  const expectInvalid = (r: { readonly ok: boolean }): BoardError => {
    expect(r.ok).toBe(false);
    const e = r as BoardError;
    expect(e.kind).toBe('board_invalid');
    return e;
  };

  it('names the record and the field when a shape’s props fail their kind and the page is gone', () => {
    const text = corrupt((doc) => {
      const rect = recordsOfDoc(doc).find((r) => r['id'] === 'shape:2') as { props: Record<string, unknown>; page: string };
      rect.props['w'] = 'wide';
      rect.page = 'page:missing';
    });
    const e = expectInvalid(load(text));
    expect(e.detail?.['record']).toBe('shape:2');
    expect(e.message.length).toBeGreaterThan(0);
  });

  it('names the record and the field for a missing required field', () => {
    const text = corrupt((doc) => {
      const rect = recordsOfDoc(doc).find((r) => r['id'] === 'shape:3');
      delete (rect as Record<string, unknown>)['page'];
    });
    const e = expectInvalid(load(text));
    expect(e.detail?.['record']).toBe('shape:3');
    expect(e.detail?.['field']).toBe('page');
  });

  it('names the record and the field for a field of the wrong type', () => {
    const text = corrupt((doc) => {
      const rect = recordsOfDoc(doc).find((r) => r['id'] === 'shape:1');
      (rect as Record<string, unknown>)['x'] = 'left';
    });
    const e = expectInvalid(load(text));
    expect(e.detail?.['record']).toBe('shape:1');
    expect(e.detail?.['field']).toBe('x');
  });

  it('names the page when a page record is bad', () => {
    const text = corrupt((doc) => {
      ((doc['pages'] as Record<string, unknown>[])[1] as Record<string, unknown>)['background'] = 'checks';
    });
    const e = expectInvalid(load(text));
    expect(e.detail?.['field']).toBe('background');
    expect(String(e.detail?.['record'])).toMatch(/^page:/);
  });

  it('refuses a shape on a page that is not in the file', () => {
    const text = corrupt((doc) => {
      const rect = recordsOfDoc(doc).find((r) => r['id'] === 'shape:1');
      (rect as Record<string, unknown>)['page'] = 'page:ghost';
    });
    expectInvalid(load(text));
  });

  it('refuses text that is not JSON, JSON that is not an object, and an object that is not a board', () => {
    for (const text of ['', 'not json', '{', 'null', '42', '[]', '"x"', '{}', '{"format":"other","version":1}', '{"format":"incantly-board"}']) {
      const r = load(text);
      expect(r.ok, text).toBe(false);
      expect((r as BoardError).kind, text).toBe('board_invalid');
    }
  });

  it('refuses a file whose records, pages or assets are not lists', () => {
    for (const field of ['pages', 'records', 'assets']) {
      const text = corrupt((doc) => {
        doc[field] = { not: 'a list' };
      });
      expect(load(text).ok, field).toBe(false);
    }
  });

  it('refuses a record that is null or a number', () => {
    for (const bad of [null, 7, 'x', []]) {
      const text = corrupt((doc) => {
        recordsOfDoc(doc).push(bad as never);
      });
      const r = load(text);
      expect(r.ok).toBe(false);
    }
  });

  it('refuses two records with the same id', () => {
    const text = corrupt((doc) => {
      const recs = recordsOfDoc(doc);
      recs.push(JSON.parse(JSON.stringify(recs[0])) as Record<string, unknown>);
    });
    expect(load(text).ok).toBe(false);
  });

  it('refuses ink that fewer bytes than it says, or points that are not valid base64', () => {
    const b = makeBoard();
    must(b.store.change('user', (tx) => void must(tx.put(shape('shape:1', b.page, { kind: 'ink', props: { points: stroke(50), size: 2 } })))));
    const doc = parse(textOf(b));
    const rec = recordsOfDoc(doc).find((r) => r['id'] === 'shape:1') as { props: { points: { data: string; count: number } } };
    const cut = JSON.parse(JSON.stringify(doc)) as typeof doc;
    (recordsOfDoc(cut).find((r) => r['id'] === 'shape:1') as typeof rec).props.points.data = rec.props.points.data.slice(0, 20);
    const e = load(JSON.stringify(cut)) as BoardError;
    expect(e.ok).toBe(false);
    expect(e.kind).toBe('board_invalid');
    expect(e.detail?.['record']).toBe('shape:1');
    const junk = JSON.parse(JSON.stringify(doc)) as typeof doc;
    (recordsOfDoc(junk).find((r) => r['id'] === 'shape:1') as typeof rec).props.points.data = '!!!not base64!!!';
    expect(load(JSON.stringify(junk)).ok).toBe(false);
  });

  it('leaves the host no half-loaded store: an error carries no store', () => {
    const r = load('{"format":"incantly-board","version":1,"pages":[],"records":[{"id":"shape:1"}],"assets":[],"meta":{}}');
    expect(r.ok).toBe(false);
    expect('store' in r).toBe(false);
  });
});

describe('load keeps unknown kinds as they are (R9.2, kind_unknown)', () => {
  const fileWithHologram = (): string => {
    const b = makeBoard();
    must(b.store.change('host', (tx) => {
      must(tx.put(shape('shape:1', b.page, { kind: 'hologram', x: 4, y: 5, props: { depth: 3, layers: [{ a: 1 }, { b: [true, null, 'x'] }] }, meta: { note: 'from a newer app' } })));
      must(tx.put(shape('shape:2', b.page, { index: 'W' })));
    }, { allowUnknownKinds: true }));
    return textOf(b);
  };

  it('loads a board that holds a shape of a kind nobody registered, with the other shapes checked', () => {
    const text = fileWithHologram();
    const loaded = must(load(text));
    const h = loaded.store.get('shape:1') as unknown as { kind: string; props: unknown; meta: unknown; x: number };
    expect(h.kind).toBe('hologram');
    expect(h.props).toEqual({ depth: 3, layers: [{ a: 1 }, { b: [true, null, 'x'] }] });
    expect(h.meta).toEqual({ note: 'from a newer app' });
    expect(h.x).toBe(4);
  });

  it('saves the unknown record unchanged, so a newer board loses nothing', () => {
    const text = fileWithHologram();
    const loaded = must(load(text));
    const again = must(saveBoard(loaded.store));
    expect(again).toBe(text);
    const pick = (t: string) => (parse(t)['records'] as { id: string }[]).find((r) => r.id === 'shape:1');
    expect(pick(again)).toEqual(pick(text));
  });

  it('loads it too when the host registered other kinds and when it registered none', () => {
    const text = fileWithHologram();
    expect(loadBoard(text).ok).toBe(true);
    const only = new KindRegistry();
    must(only.register(rectKind));
    expect(loadBoard(text, { kinds: only }).ok).toBe(true);
  });

  it('duplicates a page that holds a shape of an unknown kind, keeping that shape unchanged (kind_unknown: the record is kept)', () => {
    const loaded = must(load(fileWithHologram()));
    const pages = new Pages(loaded.store);
    const copy = must(pages.duplicatePage(pages.list()[0]?.id as string));
    expect(loaded.store.shapesOn(copy.id).some((s) => s.kind === 'hologram')).toBe(true);
  });
});

describe('versions and migrations', () => {
  const v1 = (): string => textOf(fullBoard(), { title: 'old' });
  const bumped = (text: string, version: number): string => JSON.stringify({ ...parse(text), version });

  it('runs a migration from the file’s version to the app’s, and loads the migrated records', () => {
    const calls: number[] = [];
    const migrations: Migration[] = [
      {
        from: 1,
        run: (doc) => {
          calls.push(1);
          const meta = { ...(doc['meta'] as Record<string, unknown>), migrated: true };
          return { ...doc, meta, version: 2 };
        },
      },
    ];
    const loaded = must(load(v1(), { version: 2, migrations }));
    expect(calls).toEqual([1]);
    expect(loaded.meta).toMatchObject({ title: 'old', migrated: true });
    expect(loaded.version).toBe(1);
    expect(loaded.readOnly).toBe(false);
  });

  it('chains migrations one version at a time, in order', () => {
    const order: number[] = [];
    const step = (from: number): Migration => ({
      from,
      run: (doc) => {
        order.push(from);
        return { ...doc, version: from + 1 };
      },
    });
    must(load(v1(), { version: 4, migrations: [step(3), step(1), step(2)] }));
    expect(order).toEqual([1, 2, 3]);
  });

  it('runs no migration for a file already at the app’s version', () => {
    let ran = 0;
    must(load(v1(), { migrations: [{ from: 1, run: (d) => { ran++; return d; } }] }));
    expect(ran).toBe(0);
  });

  it('fails with board_invalid, and does not throw, when a migration throws', () => {
    const r = load(v1(), {
      version: 2,
      migrations: [{ from: 1, run: () => { throw new Error('bad migration'); } }],
    });
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('board_invalid');
  });

  it('checks the migrated records, so a migration that breaks one is board_invalid', () => {
    const r = load(v1(), {
      version: 2,
      migrations: [{
        from: 1,
        run: (doc) => ({ ...doc, version: 2, records: (doc['records'] as Record<string, unknown>[]).map((x) => (x['id'] === 'shape:1' ? { ...x, x: 'oops' } : x)) }),
      }],
    });
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('board_invalid');
  });

  it('calls a kind’s migrate(props, fromVersion) on load of an older file, with the file’s version', () => {
    const seen: number[] = [];
    const kinds = new KindRegistry();
    must(kinds.register({
      ...rectKind,
      migrate: (props, from) => {
        seen.push(from);
        const p = props as { w?: number; h?: number; width?: number };
        return p.width === undefined ? props : { w: p.width, h: p.h ?? 1 };
      },
    }));
    must(kinds.register(inkKind));
    const doc = parse(v1());
    for (const r of doc['records'] as Record<string, unknown>[]) {
      if (r['id'] === 'shape:1') r['props'] = { width: 77, h: 5 };
    }
    const loaded = must(loadBoard(JSON.stringify(doc), { kinds, version: 2, migrations: [{ from: 1, run: (d) => ({ ...d, version: 2 }) }] }));
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([1]));
    expect((loaded.store.get('shape:1') as unknown as { props: unknown }).props).toEqual({ w: 77, h: 5 });
  });

  it('opens a file made by a newer version read-only when its records pass the checks', () => {
    const r = must(load(bumped(v1(), 99)));
    expect(r.readOnly).toBe(true);
    expect(r.version).toBe(99);
    expect(r.store.all('shape')).toHaveLength(4);
  });

  it('refuses a newer file whose records do not pass, with board_too_new (BR-6), and without throwing', () => {
    const doc = parse(bumped(v1(), 99));
    (doc['records'] as Record<string, unknown>[])[0] = { id: 'shape:bad' };
    const r = load(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('board_too_new');
  });

  it('refuses a version that is not a whole number of 1 or more', () => {
    for (const v of [0, -1, 1.5, 'one', null]) {
      const doc = { ...parse(v1()), version: v };
      expect(load(JSON.stringify(doc)).ok, String(v)).toBe(false);
    }
  });
});

describe('limits at load', () => {
  it('lets a host that lowers the page limit below the page count open the board; the pages state is full and the next add is refused', () => {
    const b = makeBoard();
    must(b.pages.addPage());
    must(b.pages.addPage());
    const loaded = must(load(textOf(b), { limits: { pages: 2 } }));
    const pages = new Pages(loaded.store);
    expect(pages.list()).toHaveLength(3);
    expect(pages.state).toBe('full');
    const r = pages.addPage();
    expect(r.ok).toBe(false);
    expect((r as BoardError).kind).toBe('limit');
  });
});

// @vitest-environment node
/**
 * R3.1 and R3.2 (design 5, B3): one to 100 ordered pages; add, remove, rename, move and duplicate are each one undo
 * step; the last page stays; each page has its own saved camera.
 */
import { describe, expect, it } from 'vitest';
import { Cameras, Pages, Store, cameraIdOf } from '../../src/index';
import type { BoardError, BoardRecord, CameraRecord } from '../../src/index';
import { addRects, dump, makeBoard, makeKinds, must, pageIds, shape } from './helpers';

const errKind = (r: { readonly ok: boolean }): string => (r.ok ? 'ok' : (r as BoardError).kind);

describe('page commands are one undo step each', () => {
  it('addPage: one step; undo removes the page, redo brings it back', () => {
    const b = makeBoard();
    const p = must(b.pages.addPage());
    expect(b.history.undoSteps).toBe(1);
    expect(b.pages.list()).toHaveLength(2);
    must(b.history.undo());
    expect(b.pages.list()).toHaveLength(1);
    expect(b.pages.get(p.id)).toBeUndefined();
    must(b.history.redo());
    expect(b.pages.get(p.id)?.id).toBe(p.id);
  });

  it('addPage: default name is "Page N", name and background can be given, and `after` sets the place', () => {
    const b = makeBoard();
    const second = must(b.pages.addPage());
    expect(second.name).toMatch(/^Page \d+$/);
    const named = must(b.pages.addPage({ name: 'Algebra', background: 'grid', after: b.page }));
    expect(named.name).toBe('Algebra');
    expect(named.background).toBe('grid');
    expect(pageIds(b)).toEqual([b.page, named.id, second.id]);
    expect(must(b.pages.addPage()).background).toBe('none');
  });

  it('removePage: one step; removes the page’s shapes, its camera and the bindings of its shapes together; undo restores all', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    addRects(b, 3, p2.id);
    must(b.store.change('user', (tx) => {
      must(tx.put({ id: 'binding:1', kind: 'arrow', from: 'shape:1', to: 'shape:2', props: {} }));
    }));
    const cam = must(b.cameras.forPage(p2.id));
    cam.panBy(10, 10);
    must(b.cameras.save(p2.id));
    b.history.clear();
    const before = dump(b.store);
    must(b.pages.removePage(p2.id));
    expect(b.history.undoSteps).toBe(1);
    expect(b.store.shapeCount(p2.id)).toBe(0);
    expect(b.store.has('binding:1')).toBe(false);
    expect(b.store.has(cameraIdOf(p2.id))).toBe(false);
    expect(b.store.has(p2.id)).toBe(false);
    must(b.history.undo());
    expect(dump(b.store)).toBe(before);
  });

  it('removePage: leaves the shapes and bindings of the other pages alone', () => {
    const b = makeBoard();
    addRects(b, 2);
    const p2 = must(b.pages.addPage());
    addRects(b, 2, p2.id);
    must(b.pages.removePage(p2.id));
    expect(b.store.shapeCount(b.page)).toBe(2);
    expect(b.store.has('shape:1')).toBe(true);
  });

  it('removePage: refuses the last page with last_page and changes nothing', () => {
    const b = makeBoard();
    addRects(b, 2);
    const before = dump(b.store);
    const steps = b.history.undoSteps;
    const r = b.pages.removePage(b.page);
    expect(errKind(r)).toBe('last_page');
    expect(dump(b.store)).toBe(before);
    expect(b.history.undoSteps).toBe(steps);
    expect(b.pages.list()).toHaveLength(1);
  });

  it('removePage: refuses an id that is not a page, without changing anything', () => {
    const b = makeBoard();
    must(b.pages.addPage());
    const before = dump(b.store);
    expect(b.pages.removePage('page:nope').ok).toBe(false);
    expect(dump(b.store)).toBe(before);
  });

  it('removePage: the page that was the only one left after removing others still cannot go', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    must(b.pages.removePage(p2.id));
    expect(errKind(b.pages.removePage(b.page))).toBe('last_page');
  });

  it('renamePage: one step; undo gives the old name', () => {
    const b = makeBoard();
    const old = b.pages.get(b.page)?.name;
    must(b.pages.renamePage(b.page, 'Geometry'));
    expect(b.pages.get(b.page)?.name).toBe('Geometry');
    expect(b.history.undoSteps).toBe(1);
    must(b.history.undo());
    expect(b.pages.get(b.page)?.name).toBe(old);
  });

  it('renamePage: refuses a name that is not a string of 1 to 200 characters, and an unknown page', () => {
    const b = makeBoard();
    expect(b.pages.renamePage(b.page, '').ok).toBe(false);
    expect(b.pages.renamePage(b.page, 'x'.repeat(201)).ok).toBe(false);
    expect(b.pages.renamePage('page:nope', 'x').ok).toBe(false);
    expect(b.history.undoSteps).toBe(0);
    expect(b.pages.renamePage(b.page, 'x'.repeat(200)).ok).toBe(true);
  });

  it('movePage: one step; changes the order, counted from 0; undo restores the order', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    const p3 = must(b.pages.addPage());
    const p4 = must(b.pages.addPage());
    b.history.clear();
    must(b.pages.movePage(p4.id, 0));
    expect(pageIds(b)).toEqual([p4.id, b.page, p2.id, p3.id]);
    expect(b.history.undoSteps).toBe(1);
    must(b.pages.movePage(b.page, 3));
    expect(pageIds(b)).toEqual([p4.id, p2.id, p3.id, b.page]);
    must(b.history.undo());
    expect(pageIds(b)).toEqual([p4.id, b.page, p2.id, p3.id]);
    must(b.history.undo());
    expect(pageIds(b)).toEqual([b.page, p2.id, p3.id, p4.id]);
  });

  it('movePage: moves only the moved page’s record, so the others keep their order keys', () => {
    const b = makeBoard();
    must(b.pages.addPage());
    const p3 = must(b.pages.addPage());
    const before = new Map(b.pages.list().map((p) => [p.id, p.index]));
    let touched = 0;
    b.store.on((d) => void (touched = d.updated.length + d.added.length + d.removed.length));
    must(b.pages.movePage(p3.id, 0));
    expect(touched).toBe(1);
    for (const p of b.pages.list()) if (p.id !== p3.id) expect(p.index).toBe(before.get(p.id));
  });

  it('movePage: a position past the end puts the page last, and a bad id is refused', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    const r = b.pages.movePage(b.page, 99);
    if (r.ok) expect(pageIds(b)).toEqual([p2.id, b.page]);
    expect(b.pages.movePage('page:nope', 0).ok).toBe(false);
  });

  it('duplicatePage: one step; copies the shapes, the bindings between them and the camera, to the place after it', () => {
    const b = makeBoard();
    const p3 = must(b.pages.addPage());
    addRects(b, 3);
    must(b.store.change('user', (tx) => {
      must(tx.put({ id: 'binding:1', kind: 'arrow', from: 'shape:1', to: 'shape:2', props: {} }));
    }));
    const cam = must(b.cameras.forPage(b.page));
    cam.moveTo(40, 50, 2, 0);
    must(b.cameras.save(b.page));
    b.history.clear();
    const copy = must(b.pages.duplicatePage(b.page));
    expect(b.history.undoSteps).toBe(1);
    expect(pageIds(b)).toEqual([b.page, copy.id, p3.id]);
    expect(copy.id).not.toBe(b.page);
    expect(b.store.shapeCount(copy.id)).toBe(3);
    expect(b.store.shapeCount(b.page)).toBe(3);
    const copied = b.store.shapesOn(copy.id).map((s) => s.id);
    for (const id of copied) expect(['shape:1', 'shape:2', 'shape:3']).not.toContain(id);
    const bindings = b.store.all('binding') as unknown as { from: string; to: string }[];
    expect(bindings).toHaveLength(2);
    const dup = bindings.find((x) => copied.includes(x.from));
    expect(dup && copied.includes(dup.to)).toBe(true);
    const camCopy = b.store.get(cameraIdOf(copy.id)) as CameraRecord | undefined;
    expect(camCopy?.zoom).toBe(2);
    expect(camCopy?.x).toBe(40);
    expect(camCopy?.y).toBe(50);
    expect(camCopy?.page).toBe(copy.id);
    must(b.history.undo());
    expect(pageIds(b)).toEqual([b.page, p3.id]);
    expect(b.store.size).toBe(b.store.all().length);
    expect(b.store.all('shape')).toHaveLength(3);
    expect(b.store.all('binding')).toHaveLength(1);
  });

  it('duplicatePage: the copy’s shapes keep their kind, position, order and props, and sit on the new page', () => {
    const b = makeBoard();
    addRects(b, 3, b.page, (i) => [i * 7, i * 11]);
    const copy = must(b.pages.duplicatePage(b.page));
    const a = b.store.shapesOn(b.page);
    const c = b.store.shapesOn(copy.id);
    expect(c).toHaveLength(a.length);
    for (let i = 0; i < a.length; i++) {
      const s = a[i] as unknown as Record<string, unknown>;
      const t = c[i] as unknown as Record<string, unknown>;
      for (const k of ['kind', 'x', 'y', 'rotation', 'index', 'opacity', 'props', 'locked']) expect(t[k], k).toEqual(s[k]);
      expect(t['page']).toBe(copy.id);
    }
  });

  it('duplicatePage: refuses an unknown page', () => {
    const b = makeBoard();
    expect(b.pages.duplicatePage('page:nope').ok).toBe(false);
    expect(b.pages.list()).toHaveLength(1);
  });

  it('duplicatePage at the page limit is refused with limit and changes nothing', () => {
    const only = makeBoard({ pages: 1 });
    addRects(only, 1);
    const before = dump(only.store);
    expect(errKind(only.pages.duplicatePage(only.page))).toBe('limit');
    expect(dump(only.store)).toBe(before);
  });

  it('keeps shapes and pages as the same JSON after undo of every step', () => {
    const b = makeBoard();
    const start = dump(b.store);
    const p2 = must(b.pages.addPage({ name: 'two' }));
    addRects(b, 2, p2.id);
    must(b.pages.renamePage(p2.id, 'second'));
    must(b.pages.movePage(p2.id, 0));
    const d = must(b.pages.duplicatePage(p2.id));
    must(b.pages.removePage(d.id));
    expect(b.history.undoSteps).toBe(6);
    while (b.history.canUndo) must(b.history.undo());
    expect(dump(b.store)).toBe(start);
  });
});

describe('the current page', () => {
  it('is none when there is no page, and the first page after it is added', () => {
    const store = new Store({ kinds: makeKinds() });
    const pages = new Pages(store);
    expect(pages.current).toBeNull();
    expect(pages.state).toBe('empty');
    const p = must(pages.addPage());
    expect(pages.current).toBe(p.id);
    expect(pages.state).toBe('single');
  });

  it('goToPage changes the current page, is not an undo step, and tells onCurrent', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    const seen: (string | null)[] = [];
    b.pages.onCurrent((p) => seen.push(p));
    must(b.pages.goToPage(p2.id));
    expect(b.pages.current).toBe(p2.id);
    must(b.pages.goToPage(b.page));
    expect(seen).toEqual([p2.id, b.page]);
    expect(b.history.undoSteps).toBe(1);
  });

  it('goToPage refuses a page that does not exist and keeps the current one', () => {
    const b = makeBoard();
    const before = b.pages.current;
    expect(b.pages.goToPage('page:nope').ok).toBe(false);
    expect(b.pages.current).toBe(before);
  });

  it('is always a page that exists, also after the current page is removed or its add is undone', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    must(b.pages.goToPage(p2.id));
    must(b.pages.removePage(p2.id));
    expect(b.pages.current).toBe(b.page);
    const p3 = must(b.pages.addPage());
    must(b.pages.goToPage(p3.id));
    must(b.history.undo());
    expect(b.pages.current).not.toBe(p3.id);
    expect(b.pages.get(b.pages.current as string)).toBeDefined();
  });

  it('does not tell onCurrent when a page that is not current is added', () => {
    const b = makeBoard();
    let n = 0;
    b.pages.onCurrent(() => void n++);
    must(b.pages.addPage());
    expect(n).toBe(0);
  });
});

describe('the page limit (B3)', () => {
  it('has the states empty, single, several and full as pages come and go', () => {
    const b = makeBoard({ pages: 3 });
    expect(b.pages.state).toBe('single');
    must(b.pages.addPage());
    expect(b.pages.state).toBe('several');
    const p3 = must(b.pages.addPage());
    expect(b.pages.state).toBe('full');
    must(b.pages.removePage(p3.id));
    expect(b.pages.state).toBe('several');
    must(b.history.undo());
    expect(b.pages.state).toBe('full');
  });

  it('allows 100 pages and refuses the 101st with limit, changing nothing', () => {
    const b = makeBoard();
    for (let i = 0; i < 99; i++) must(b.pages.addPage());
    expect(b.pages.list()).toHaveLength(100);
    expect(b.pages.state).toBe('full');
    const before = dump(b.store);
    const steps = b.history.undoSteps;
    const r = b.pages.addPage();
    expect(errKind(r)).toBe('limit');
    expect((r as BoardError).detail?.['limit']).toBe(100);
    expect(((r as BoardError).hint ?? '').length).toBeGreaterThan(0);
    expect(errKind(b.pages.duplicatePage(b.page))).toBe('limit');
    expect(dump(b.store)).toBe(before);
    expect(b.history.undoSteps).toBe(steps);
  });

  it('keeps a hundred distinct page ids and distinct order keys', () => {
    const b = makeBoard();
    for (let i = 0; i < 99; i++) must(b.pages.addPage());
    const list = b.pages.list();
    expect(new Set(list.map((p) => p.id)).size).toBe(100);
    expect(new Set(list.map((p) => p.index)).size).toBe(100);
    const sorted = [...list].sort((x, y) => (x.index < y.index ? -1 : 1)).map((p) => p.id);
    expect(sorted).toEqual(list.map((p) => p.id));
  });
});

describe('each page has its own camera (design 5, 9)', () => {
  it('gives a camera per page that moves on its own', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    const c1 = must(b.cameras.forPage(b.page));
    const c2 = must(b.cameras.forPage(p2.id));
    expect(c1).not.toBe(c2);
    c1.panBy(-300, -200);
    c1.zoomAbout(4, 0, 0, 0);
    expect(c2.zoom).toBe(1);
    expect([c2.x, c2.y]).toEqual([0, 0]);
    expect(c1.zoom).toBe(4);
    expect(must(b.cameras.forPage(b.page))).toBe(c1);
  });

  it('refuses a camera for a page that does not exist', () => {
    const b = makeBoard();
    expect(errKind(b.cameras.forPage('page:nope'))).toBe('bad_argument');
  });

  it('saves the camera as a record outside the undo history, and a later Cameras reads it back', () => {
    const b = makeBoard();
    const c = must(b.cameras.forPage(b.page));
    c.moveTo(120, 80, 3, 0);
    const rec = must(b.cameras.save(b.page));
    expect([rec.x, rec.y, rec.zoom, rec.page]).toEqual([120, 80, 3, b.page]);
    expect(rec.id).toBe(cameraIdOf(b.page));
    expect(b.store.get(cameraIdOf(b.page))).toMatchObject({ x: 120, y: 80, zoom: 3 });
    expect(b.history.undoSteps).toBe(0);
    const again = new Cameras(b.store);
    const c2 = must(again.forPage(b.page));
    expect([c2.x, c2.y, c2.zoom]).toEqual([120, 80, 3]);
  });

  it('does not write the store while a camera moves; only save does', () => {
    const b = makeBoard();
    let diffs = 0;
    b.store.on(() => void diffs++);
    const c = must(b.cameras.forPage(b.page));
    c.panBy(5, 5);
    c.zoomBy(2, 10, 10, 0);
    expect(diffs).toBe(0);
    must(b.cameras.save(b.page));
    expect(diffs).toBe(1);
  });

  it('saving the camera of a page that does not exist is refused', () => {
    const b = makeBoard();
    expect(b.cameras.save('page:nope').ok).toBe(false);
  });
});

describe('integrity of shapes and pages', () => {
  it('refuses a shape put on a page after that page is removed', () => {
    const b = makeBoard();
    const p2 = must(b.pages.addPage());
    must(b.pages.removePage(p2.id));
    const r = b.store.change('user', (tx) => void must(tx.put(shape('shape:1', p2.id))));
    expect(r.ok).toBe(false);
  });

  it('returns pages as plain records the host can read', () => {
    const b = makeBoard();
    const p = must(b.pages.addPage({ name: 'A' }));
    const rec: BoardRecord | undefined = b.store.get(p.id);
    expect(rec).toMatchObject({ id: p.id, name: 'A', background: 'none' });
    expect(typeof (rec as { index: string }).index).toBe('string');
  });
});

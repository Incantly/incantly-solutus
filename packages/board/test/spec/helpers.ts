/**
 * Shared set-up for the board spec tests: two kinds a host might register (`rect`, `ink`), a board made of the
 * public pieces, and builders for records. Only the public API of `packages/board` is used.
 */
import {
  boardError, keysBetween, ok, History, KindRegistry, Pages, Cameras, Store,
} from '../../src/index';
import type { BoardError, BoardRecord, BoardResult, KindDef, Limits, PageRecord, ShapeRecord } from '../../src/index';

/** A kind does not know the id of the record it checks, so it names only the field. */
const bad = (field: string, message: string): BoardError => boardError('record_invalid', message, { detail: { field } });

export interface RectProps {
  readonly w: number;
  readonly h: number;
}

export const rectKind: KindDef<RectProps> = {
  kind: 'rect',
  defaults: { w: 100, h: 100 },
  check(props: unknown): BoardResult<RectProps> {
    if (typeof props !== 'object' || props === null) return bad('props', 'A rect needs props.');
    const p = props as Record<string, unknown>;
    const w = p['w'] ?? 100;
    const h = p['h'] ?? 100;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return bad('props.w', 'w must be a number from 0 up.');
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return bad('props.h', 'h must be a number from 0 up.');
    return ok({ w, h });
  },
};

export interface InkProps {
  readonly points: Float32Array;
  readonly size: number;
}

export const inkKind: KindDef<InkProps> = {
  kind: 'ink',
  defaults: { points: new Float32Array(0), size: 4 },
  check(props: unknown): BoardResult<InkProps> {
    if (typeof props !== 'object' || props === null) return bad('props', 'Ink needs props.');
    const p = props as Record<string, unknown>;
    if (!(p['points'] instanceof Float32Array) || p['points'].length % 3 !== 0) {
      return bad('props.points', 'points must be a Float32Array of x, y, pressure triples.');
    }
    const size = p['size'] ?? 4;
    if (typeof size !== 'number' || !(size > 0)) return bad('props.size', 'size must be above 0.');
    return ok({ points: p['points'], size });
  },
  points: (props) => props.points.length / 3,
};

export function makeKinds(): KindRegistry {
  const kinds = new KindRegistry();
  const a = kinds.register(rectKind);
  const b = kinds.register(inkKind);
  if (!a.ok || !b.ok) throw new Error('could not register the test kinds');
  return kinds;
}

export interface TestBoard {
  readonly store: Store;
  readonly history: History;
  readonly pages: Pages;
  readonly cameras: Cameras;
  /** The id of the first page. */
  readonly page: string;
}

/** A board with one page, an empty undo history, and the `rect` and `ink` kinds. */
export function makeBoard(limits: Partial<Limits> = {}, history = true): TestBoard {
  const store = new Store({ kinds: makeKinds(), limits });
  const pages = new Pages(store);
  const cameras = new Cameras(store);
  const first = pages.addPage();
  if (!first.ok) throw new Error(`could not add the first page: ${first.message}`);
  const h = new History(store);
  if (!history) h.dispose();
  return { store, history: h, pages, cameras, page: first.value.id };
}

/** Unwraps a `Result`; a test that expected success fails with the error's message. */
export function must<T>(r: BoardResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.message}`);
  return r.value;
}

/** A shape record with defaults; `over` replaces fields. */
export function shape(id: string, page: string, over: Partial<ShapeRecord> = {}): ShapeRecord {
  return {
    id, page, kind: 'rect', x: 0, y: 0, rotation: 0, parent: null, index: 'V', locked: false, opacity: 1, props: { w: 10, h: 10 }, meta: {}, ...over,
  };
}

/** `n` distinct fractional keys in order. */
export function keys(n: number): readonly string[] {
  return must(keysBetween(null, null, n));
}

/** Adds `n` rects to a page in one transaction, with ids `shape:1`, `shape:2`, … after the shapes already there; returns the records as written. */
export function addRects(b: TestBoard, n: number, page = b.page, at = (i: number): [number, number] => [i * 20, 0]): readonly ShapeRecord[] {
  const idx = keys(n);
  const made: ShapeRecord[] = [];
  const first = b.store.all('shape').length + 1;
  must(b.store.change('user', (tx) => {
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i);
      const s = shape(`shape:${first + i}`, page, { x, y, index: idx[i] as string });
      made.push(s);
      must(tx.put(s));
    }
  }));
  return made;
}

/** Page records in order. */
export const pageIds = (b: TestBoard): readonly string[] => b.pages.list().map((p: PageRecord) => p.id);

/** Every record of the store as one JSON string, records and keys sorted, for equality checks that ignore order. */
export function dump(store: Store): string {
  const all = [...store.all()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(all, (_k, v: unknown) => {
    if (v instanceof Float32Array) return { f32: [...v] };
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

export const recordsOf = (store: Store): readonly BoardRecord[] => store.all();

/** A seeded generator (mulberry32), so a failing case can be replayed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

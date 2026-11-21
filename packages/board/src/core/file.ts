/**
 * Saving and loading (design 12): `.incantly-board` is JSON `{ format, version, pages, records, assets, meta }`, written
 * deterministically (sorted keys, sorted records, one number format) so the same board gives the same bytes. Ink points
 * are stored as base64 of delta-encoded 16-bit integers in hundredths of a unit, with pressure in 8 bits (about 5 bytes
 * a point). Load checks every record against its type and kind (`board_invalid` names the record and the field), runs
 * migrations, and keeps shapes of kinds that are not registered exactly as they were. A shape whose props fail its
 * kind's check, on a page that exists, is kept raw with a `meta.invalid` note and a `record_kept_raw` notice, and is
 * saved with its props as they were. No DOM, no timers.
 */
import { fromBase64, toBase64 } from './base64';
import { isKeptRaw, markKeptRaw } from './check';
import { boardError, describeThrown, ok, okWith } from './errors';
import type { BoardError, BoardNotice, BoardResult } from './errors';
import { KindRegistry } from './kinds/def';
import { Store } from './store';
import { isAsset, isPage, isShape, recordTypeOf } from './types';
import type { AssetRecord, BoardRecord, Limits, PageRecord, ShapeRecord } from './types';

export const FILE_FORMAT = 'incantly-board';
/** The version this code writes and reads. */
export const FILE_VERSION = 1;

export interface BoardDocument {
  readonly format: typeof FILE_FORMAT;
  readonly version: number;
  /** Page records, in page order. */
  readonly pages: readonly PageRecord[];
  /** Shape, camera and binding records, by id. */
  readonly records: readonly BoardRecord[];
  /** Asset records, by id. */
  readonly assets: readonly AssetRecord[];
  /** The host's own data about the document. */
  readonly meta: Readonly<Record<string, unknown>>;
}

/** Brings a document from version `from` to `from + 1`. It must not throw; if it does, the load fails with `board_invalid`. */
export interface Migration {
  readonly from: number;
  run(doc: Record<string, unknown>): Record<string, unknown>;
}

export interface LoadOptions {
  /** The kinds to check shapes against; default none, so every shape is kept as it is. */
  readonly kinds?: KindRegistry;
  readonly limits?: Partial<Limits>;
  /** Document migrations, each from one version to the next. */
  readonly migrations?: readonly Migration[];
  /** The version this app reads; default `FILE_VERSION`. A newer file opens read-only when its records pass. */
  readonly version?: number;
}

export interface LoadedBoard {
  readonly store: Store;
  readonly meta: Readonly<Record<string, unknown>>;
  /** The version the file had. */
  readonly version: number;
  /** True for a file made by a newer version whose records still pass the checks. */
  readonly readOnly: boolean;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------------------------------------------
// ink

/** The stored form of an ink shape's `points`. */
interface EncodedInk {
  readonly $ink: 1;
  /** Numbers per point: 3 (x, y, pressure) or 5 (and tiltX, tiltY). */
  readonly stride: 3 | 5;
  readonly count: number;
  readonly data: string;
}

const ESCAPE = -32768;
const INT32_MAX = 2147483647;

class ByteWriter {
  bytes = new Uint8Array(1024);
  length = 0;

  #room(n: number): void {
    if (this.length + n <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n));
    grown.set(this.bytes);
    this.bytes = grown;
  }

  i16(v: number): void {
    this.#room(2);
    this.bytes[this.length++] = v & 255;
    this.bytes[this.length++] = (v >> 8) & 255;
  }

  i32(v: number): void {
    this.#room(4);
    this.bytes[this.length++] = v & 255;
    this.bytes[this.length++] = (v >> 8) & 255;
    this.bytes[this.length++] = (v >> 16) & 255;
    this.bytes[this.length++] = (v >>> 24) & 255;
  }

  u8(v: number): void {
    this.#room(1);
    this.bytes[this.length++] = v & 255;
  }

  done(): Uint8Array {
    return this.bytes.subarray(0, this.length);
  }
}

/** Encodes `x, y, pressure[, tiltX, tiltY]` points. Fails on a number that is not finite or too large. */
function encodeInk(points: ArrayLike<number>, stride: 3 | 5, record: string): BoardResult<EncodedInk> {
  const n = points.length;
  if (n % stride !== 0) {
    return boardError('record_invalid', `The ink points of "${record}" are not a multiple of ${stride} numbers.`, { detail: { record, field: 'props.points' } });
  }
  const w = new ByteWriter();
  let px = 0;
  let py = 0;
  for (let i = 0; i < n; i += stride) {
    for (let k = 0; k < stride; k++) {
      if (!Number.isFinite(points[i + k] as number)) {
        return boardError('record_invalid', `An ink point of "${record}" is not a finite number.`, { detail: { record, field: 'props.points' } });
      }
    }
    const qx = Math.round((points[i] as number) * 100);
    const qy = Math.round((points[i + 1] as number) * 100);
    if (Math.abs(qx) > INT32_MAX || Math.abs(qy) > INT32_MAX) {
      return boardError('record_invalid', `An ink point of "${record}" is too far from the shape's origin to save.`, { detail: { record, field: 'props.points' } });
    }
    for (const [q, prev] of [[qx, px], [qy, py]] as const) {
      const d = q - prev;
      if (d > ESCAPE && d <= 32767) {
        w.i16(d);
      } else {
        w.i16(ESCAPE);
        w.i32(q);
      }
    }
    px = qx;
    py = qy;
    w.u8(Math.round(Math.min(1, Math.max(0, points[i + 2] as number)) * 255));
    if (stride === 5) {
      w.u8(Math.round(Math.min(90, Math.max(-90, points[i + 3] as number))));
      w.u8(Math.round(Math.min(90, Math.max(-90, points[i + 4] as number))));
    }
  }
  return ok({ $ink: 1, stride, count: n / stride, data: toBase64(w.done()) });
}

/** Decodes an `EncodedInk` into a `Float32Array` of its points. */
function decodeInk(enc: Record<string, unknown>, record: string): BoardResult<Float32Array> {
  const bad = (why: string): BoardError => boardError('board_invalid', `The ink of "${record}" could not be read: ${why}.`, { detail: { record, field: 'props.points' } });
  const stride = enc['stride'];
  const count = enc['count'];
  const data = enc['data'];
  if ((stride !== 3 && stride !== 5) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || typeof data !== 'string') {
    return bad('its fields are wrong');
  }
  const bytes = fromBase64(data);
  if (bytes === undefined) return bad('its data is not base64');
  if (count > bytes.length) return bad('it holds fewer points than it says');
  const out = new Float32Array(count * stride);
  let at = 0;
  const i16 = (): number | undefined => {
    if (at + 2 > bytes.length) return undefined;
    const v = ((bytes[at] as number) | ((bytes[at + 1] as number) << 8)) << 16 >> 16;
    at += 2;
    return v;
  };
  const i32 = (): number | undefined => {
    if (at + 4 > bytes.length) return undefined;
    const v = (bytes[at] as number) | ((bytes[at + 1] as number) << 8) | ((bytes[at + 2] as number) << 16) | ((bytes[at + 3] as number) << 24);
    at += 4;
    return v;
  };
  let px = 0;
  let py = 0;
  for (let p = 0; p < count; p++) {
    for (let axis = 0; axis < 2; axis++) {
      const d = i16();
      if (d === undefined) return bad('its data ends early');
      let q: number;
      if (d === ESCAPE) {
        const abs = i32();
        if (abs === undefined) return bad('its data ends early');
        q = abs;
      } else {
        q = (axis === 0 ? px : py) + d;
      }
      if (axis === 0) px = q;
      else py = q;
    }
    const o = p * stride;
    out[o] = px / 100;
    out[o + 1] = py / 100;
    if (at >= bytes.length) return bad('its data ends early');
    out[o + 2] = (bytes[at++] as number) / 255;
    if (stride === 5) {
      if (at + 2 > bytes.length) return bad('its data ends early');
      out[o + 3] = ((bytes[at++] as number) << 24) >> 24;
      out[o + 4] = ((bytes[at++] as number) << 24) >> 24;
    }
  }
  if (at !== bytes.length) return bad('it has bytes left over');
  return ok(out);
}

/** A shape the load kept raw, without the `meta.invalid` note the load put on it, so the file keeps what it had. */
function withoutNote(shape: ShapeRecord): ShapeRecord {
  if (!isKeptRaw(shape) || !('invalid' in shape.meta)) return shape;
  const { invalid: _note, ...meta } = shape.meta;
  return { ...shape, meta };
}

/** The shape with its ink points in stored form, or the shape itself when it has none to encode. */
function encodeShape(saved: ShapeRecord): BoardResult<ShapeRecord> {
  const shape = withoutNote(saved);
  if (shape.kind !== 'ink' || !isPlain(shape.props)) return ok(shape);
  const props = shape.props;
  const points = props['points'];
  if (!ArrayBuffer.isView(points) || !(points instanceof Float32Array)) return ok(shape);
  const encoded = encodeInk(points, props['stride'] === 5 ? 5 : 3, shape.id);
  if (!encoded.ok) return encoded;
  return ok({ ...shape, props: { ...props, points: encoded.value } });
}

// ---------------------------------------------------------------------------------------------------------------
// the writer

const MAX_DEPTH = 64;

/** JSON with sorted keys and no spaces; numbers in the shortest form that reads back the same, and no `-0`. */
function writeJson(value: unknown, path: string, out: string[], depth: number): BoardError | undefined {
  if (depth > MAX_DEPTH) return boardError('record_invalid', `${path} is nested more than ${MAX_DEPTH} levels deep.`, { detail: { field: path } });
  if (value === null) {
    out.push('null');
  } else if (typeof value === 'boolean') {
    out.push(value ? 'true' : 'false');
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) return boardError('record_invalid', `${path} is not a finite number.`, { detail: { field: path } });
    out.push(Object.is(value, -0) ? '0' : String(value));
  } else if (typeof value === 'string') {
    out.push(JSON.stringify(value));
  } else if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      const item: unknown = value[i];
      if (item === undefined) out.push('null');
      else {
        const failed = writeJson(item, `${path}[${i}]`, out, depth + 1);
        if (failed) return failed;
      }
    }
    out.push(']');
  } else if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      return boardError('record_invalid', `${path} holds something that is not plain data.`, { detail: { field: path } });
    }
    const obj = value as Record<string, unknown>;
    out.push('{');
    let first = true;
    for (const key of Object.keys(obj).sort()) {
      const item = obj[key];
      if (item === undefined) continue;
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(key), ':');
      const failed = writeJson(item, `${path}.${key}`, out, depth + 1);
      if (failed) return failed;
    }
    out.push('}');
  } else {
    return boardError('record_invalid', `${path} holds something that is not plain data.`, { detail: { field: path } });
  }
  return undefined;
}

/** Every record of the store as one document, sorted; ink points are still typed arrays. */
export function snapshot(store: Store, meta: Readonly<Record<string, unknown>> = {}): BoardDocument {
  const pages = store.all('page').filter(isPage).sort((a, b) => compareText(a.index, b.index) || compareText(a.id, b.id));
  const records = [...store.all('shape'), ...store.all('camera'), ...store.all('binding')].sort((a, b) => compareText(a.id, b.id));
  const assets = store.all('asset').filter(isAsset).sort((a, b) => compareText(a.id, b.id));
  return { format: FILE_FORMAT, version: FILE_VERSION, pages, records, assets, meta };
}

/** A document as `.incantly-board` text. The same document always gives the same text. */
export function writeDocument(doc: BoardDocument): BoardResult<string> {
  try {
    const records: BoardRecord[] = [];
    for (const r of doc.records) {
      if (!isShape(r)) {
        records.push(r);
        continue;
      }
      const encoded = encodeShape(r);
      if (!encoded.ok) return encoded;
      records.push(encoded.value);
    }
    const out: string[] = [];
    const failed = writeJson({ format: doc.format, version: doc.version, pages: doc.pages, records, assets: doc.assets, meta: doc.meta }, '$', out, 0);
    return failed ?? ok(out.join(''));
  } catch (e) {
    return boardError('internal', `The board could not be written: ${describeThrown(e)}`);
  }
}

/** Saves a store as `.incantly-board` text. */
export function saveBoard(store: Store, meta: Readonly<Record<string, unknown>> = {}): BoardResult<string> {
  return writeDocument(snapshot(store, meta));
}

// ---------------------------------------------------------------------------------------------------------------
// the reader

const invalid = (message: string, detail: Readonly<Record<string, unknown>>): BoardError => boardError('board_invalid', `This board could not be opened: ${message}`, { detail });

/** An error from a record check, said as a board error. */
function asBoardInvalid(e: BoardError): BoardError {
  if (e.kind !== 'record_invalid') return e;
  return boardError('board_invalid', `This board could not be opened: ${e.message}`, { ...(e.hint !== undefined ? { hint: e.hint } : {}), ...(e.detail !== undefined ? { detail: e.detail } : {}) });
}

/** Replaces stored ink points by typed arrays, in a copy of the list. */
function decodeShapes(list: readonly unknown[]): BoardResult<readonly unknown[]> {
  const out: unknown[] = [];
  for (const r of list) {
    if (isPlain(r) && r['kind'] === 'ink' && isPlain(r['props']) && isPlain(r['props']['points']) && r['props']['points']['$ink'] === 1) {
      const decoded = decodeInk(r['props']['points'], typeof r['id'] === 'string' ? r['id'] : '?');
      if (!decoded.ok) return decoded;
      out.push({ ...r, props: { ...r['props'], points: decoded.value } });
    } else {
      out.push(r);
    }
  }
  return ok(out);
}

/** Reads `.incantly-board` text into a new store. */
export function loadBoard(text: string, options: LoadOptions = {}): BoardResult<LoadedBoard> {
  try {
    return load(text, options);
  } catch (e) {
    return boardError('internal', `The board could not be read: ${describeThrown(e)}`);
  }
}

function load(text: string, options: LoadOptions): BoardResult<LoadedBoard> {
  if (typeof text !== 'string') return invalid('the file is not text.', { field: 'file' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return invalid(`it is not valid JSON (${describeThrown(e)}).`, { field: 'file' });
  }
  if (!isPlain(parsed)) return invalid('the file is not a board.', { field: 'file' });
  if (parsed['format'] !== FILE_FORMAT) return invalid(`the file's format is not "${FILE_FORMAT}".`, { field: 'format' });
  const fileVersion = parsed['version'];
  if (typeof fileVersion !== 'number' || !Number.isInteger(fileVersion) || fileVersion < 1) {
    return invalid('the file has no version number.', { field: 'version' });
  }
  const target = options.version ?? FILE_VERSION;
  const newer = fileVersion > target;

  // document migrations, one version at a time
  let doc: Record<string, unknown> = parsed;
  if (!newer) {
    for (let v = fileVersion; v < target; v++) {
      const step = options.migrations?.find((m) => m.from === v);
      if (step === undefined) return invalid(`no migration from version ${v} to ${v + 1}.`, { field: 'version', version: v });
      try {
        doc = step.run(doc);
      } catch (e) {
        return invalid(`the migration from version ${v} failed (${describeThrown(e)}).`, { field: 'version', version: v });
      }
      if (!isPlain(doc)) return invalid(`the migration from version ${v} gave no document.`, { field: 'version', version: v });
    }
  }

  // a newer file that fails any check says "too new": the version is the reason the reader can act on
  const fail = (error: BoardError): BoardError =>
    newer
      ? boardError('board_too_new', 'This board was made with a newer version of Incantly.', {
          hint: 'Update the app to open it.',
          detail: { version: fileVersion, supported: target, cause: error.detail },
        })
      : error;

  const meta = doc['meta'] ?? {};
  if (!isPlain(meta)) return fail(invalid('"meta" is not an object.', { field: 'meta' }));
  for (const section of ['pages', 'records', 'assets']) {
    if (!Array.isArray(doc[section])) return fail(invalid(`"${section}" is not a list.`, { field: section }));
  }
  const shaped = decodeShapes(doc['records'] as unknown[]);
  if (!shaped.ok) return fail(shaped);

  const kinds = options.kinds ?? new KindRegistry();
  const store = new Store({ kinds, ...(options.limits !== undefined ? { limits: options.limits } : {}) });
  const sections: readonly (readonly [string, readonly unknown[], (id: string) => boolean])[] = [
    ['pages', doc['pages'] as unknown[], (id) => recordTypeOf(id) === 'page'],
    ['records', shaped.value, (id) => ['shape', 'camera', 'binding'].includes(recordTypeOf(id) ?? '')],
    ['assets', doc['assets'] as unknown[], (id) => recordTypeOf(id) === 'asset'],
  ];
  const seen = new Set<string>();
  for (const [name, list, belongs] of sections) {
    for (const r of list) {
      const id = isPlain(r) ? r['id'] : undefined;
      if (typeof id !== 'string') return fail(invalid(`a record in "${name}" has no id.`, { field: name }));
      if (!belongs(id)) return fail(invalid(`"${id}" does not belong in "${name}".`, { record: id, field: 'id' }));
      if (seen.has(id)) return fail(invalid(`the id "${id}" is used twice.`, { record: id, field: 'id' }));
      seen.add(id);
    }
  }

  // bring each record to this version; a shape that fails its kind's check alone is kept raw (not for a newer file)
  const kept: KeptRaw[] = [];
  const prepared = sections.map(([, list]) =>
    list.map((r) => {
      const migrated = !newer && fileVersion < target && isPlain(r) && isPlain(r['props']) ? migrateProps(r, kinds, fileVersion) : r;
      if (newer) return migrated;
      const raw = keepRaw(migrated, kinds);
      if (raw === undefined) return migrated;
      kept.push(raw);
      return raw.record;
    }),
  );

  const written = store.change(
    'host',
    (tx) => {
      for (const list of prepared) for (const r of list) tx.put(r as unknown as BoardRecord);
    },
    { history: false, allowUnknownKinds: true, skipLimits: true },
  );
  if (!written.ok) return fail(asBoardInvalid(written));
  return okWith({ store, meta, version: fileVersion, readOnly: newer }, kept.length === 0 ? [] : [keptNotice(kept)]);
}

/** A shape kept raw: the record to store, and why its props fail. */
interface KeptRaw {
  readonly record: Record<string, unknown>;
  readonly id: string;
  readonly field: string;
  readonly why: string;
}

/**
 * The shape with a `meta.invalid` note and marked as kept raw, when its kind is registered and its props fail the
 * kind's check; undefined for any other record (a record that fails for another reason fails the load).
 */
function keepRaw(r: unknown, kinds: KindRegistry): KeptRaw | undefined {
  if (!isPlain(r) || typeof r['id'] !== 'string' || !r['id'].startsWith('shape:') || typeof r['kind'] !== 'string') return undefined;
  const def = kinds.get(r['kind']);
  if (def === undefined || r['props'] === undefined || !isPlain(r['meta'])) return undefined;
  let field = 'props';
  let why: string;
  try {
    const checked = def.check(r['props']);
    if (checked.ok) return undefined;
    const named = checked.detail?.['field'];
    if (typeof named === 'string') field = named;
    why = checked.message;
  } catch (e) {
    why = `the check threw: ${describeThrown(e)}`;
  }
  const record = { ...r, meta: { ...r['meta'], invalid: { field, why } } };
  markKeptRaw(record);
  return { record, id: r['id'], field, why };
}

function keptNotice(kept: readonly KeptRaw[]): BoardNotice {
  const ids = kept.map((k) => k.id);
  return {
    severity: 'warning',
    kind: 'record_kept_raw',
    message: `${kept.length === 1 ? '1 shape' : `${kept.length} shapes`} did not pass the check of ${kept.length === 1 ? 'its' : 'their'} kind and ${kept.length === 1 ? 'was' : 'were'} kept as ${kept.length === 1 ? 'it was' : 'they were'}: ${ids.join(', ')}.`,
    detail: { records: kept.map((k) => ({ record: k.id, field: k.field, why: k.why })) },
  };
}

/** The record with its props brought to the current version by its kind's `migrate`, when it has one. */
function migrateProps(r: Record<string, unknown>, kinds: KindRegistry, from: number): Record<string, unknown> {
  if (typeof r['kind'] !== 'string' || !isPlain(r['props']) || typeof r['id'] !== 'string' || !r['id'].startsWith('shape:')) return r;
  const def = kinds.get(r['kind']);
  if (def?.migrate === undefined) return r;
  return { ...r, props: def.migrate(r['props'], from) };
}

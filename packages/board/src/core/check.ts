/**
 * The check of one record, on every write and every load (R2.1). A record is plain data: the type comes from the id's
 * prefix, the fields are checked here, and a shape's props are checked by its kind (`KindDef.check`).
 */
import { isKey } from './fractional';
import { boardError, ok, recordInvalid, withDetail } from './errors';
import type { BoardResult } from './errors';
import type { KindRegistry } from './kinds/def';
import { ASSET_BYTES_MAX, PAGE_BACKGROUNDS, recordTypeOf } from './types';
import type { BoardRecord, RecordType } from './types';

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 20;
export const PAGE_NAME_MAX = 200;

export interface CheckOptions {
  /** Keep a shape whose kind is not registered, with its props as they are (load, undo of a delete). */
  readonly allowUnknownKinds?: boolean;
}

const FIELDS: Readonly<Record<RecordType, readonly string[]>> = {
  shape: ['id', 'page', 'kind', 'x', 'y', 'rotation', 'parent', 'index', 'locked', 'opacity', 'props', 'meta'],
  page: ['id', 'name', 'index', 'background'],
  camera: ['id', 'page', 'x', 'y', 'zoom'],
  binding: ['id', 'kind', 'from', 'to', 'props'],
  asset: ['id', 'mime', 'size', 'data'],
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The page record's id of a shape or camera, so callers can test the link. */
export const hasPrefix = (v: unknown, prefix: string): v is string => typeof v === 'string' && v.length > prefix.length && v.startsWith(prefix);

/** Checks one record. Returns the record to store: a frozen copy, with the kind's cleaned props for a shape. */
export function checkRecord(record: unknown, kinds: KindRegistry, options: CheckOptions = {}): BoardResult<BoardRecord> {
  if (!isPlainObject(record)) return recordInvalid('?', 'record', 'A record must be an object.');
  const id = record['id'];
  if (typeof id !== 'string') return recordInvalid('?', 'id', 'A record needs an id that is text.');
  const type = recordTypeOf(id);
  if (type === undefined) {
    return recordInvalid(id, 'id', `"${id}" does not start with shape:, page:, camera:, binding: or asset:.`);
  }
  for (const key of Object.keys(record)) {
    if (!FIELDS[type].includes(key)) return recordInvalid(id, key, `A ${type} record has no field "${key}".`);
  }
  const missing = FIELDS[type].find((f) => !(f in record) || (record[f] === undefined && f !== 'props'));
  if (missing !== undefined) return recordInvalid(id, missing, `The ${type} "${id}" is missing "${missing}".`);
  switch (type) {
    case 'shape':
      return checkShape(id, record, kinds, options);
    case 'page':
      return checkPage(id, record);
    case 'camera':
      return checkCamera(id, record);
    case 'binding':
      return checkBinding(id, record);
    case 'asset':
      return checkAsset(id, record);
  }
}

function checkShape(id: string, r: Record<string, unknown>, kinds: KindRegistry, options: CheckOptions): BoardResult<BoardRecord> {
  if (!hasPrefix(r['page'], 'page:')) return recordInvalid(id, 'page', `The shape "${id}" needs a page id that starts with page:.`);
  if (typeof r['kind'] !== 'string' || r['kind'] === '') return recordInvalid(id, 'kind', `The shape "${id}" needs a kind.`);
  for (const f of ['x', 'y', 'rotation']) {
    if (!finite(r[f])) return recordInvalid(id, f, `"${f}" of "${id}" must be a finite number.`);
  }
  const parent = r['parent'];
  if (parent !== null && !hasPrefix(parent, 'shape:')) return recordInvalid(id, 'parent', `"parent" of "${id}" must be null or a shape id.`);
  if (!isKey(r['index'])) return recordInvalid(id, 'index', `"index" of "${id}" must be an order key (digits and letters, not ending in 0).`);
  if (typeof r['locked'] !== 'boolean') return recordInvalid(id, 'locked', `"locked" of "${id}" must be true or false.`);
  const opacity = r['opacity'];
  if (!finite(opacity) || opacity < 0 || opacity > 1) return recordInvalid(id, 'opacity', `"opacity" of "${id}" must be a number from 0 to 1.`);
  if (!isPlainObject(r['meta'])) return recordInvalid(id, 'meta', `"meta" of "${id}" must be an object.`);
  if (r['props'] === undefined) return recordInvalid(id, 'props', `The shape "${id}" is missing "props".`);

  const kind = r['kind'];
  const def = kinds.get(kind);
  if (def === undefined) {
    if (options.allowUnknownKinds !== true) {
      return boardError('kind_unknown', `The kind "${kind}" is not registered.`, {
        hint: 'Register the kind with kinds.register before writing shapes of it.',
        detail: { record: id, kind },
      });
    }
    return ok(Object.freeze({ ...r }) as unknown as BoardRecord);
  }
  const props = def.check(r['props']);
  if (!props.ok) return withDetail(props, { record: id, field: 'props', kind });
  return ok(Object.freeze({ ...r, props: props.value }) as unknown as BoardRecord);
}

function checkPage(id: string, r: Record<string, unknown>): BoardResult<BoardRecord> {
  const name = r['name'];
  if (typeof name !== 'string' || name === '' || name.length > PAGE_NAME_MAX) {
    return recordInvalid(id, 'name', `"name" of "${id}" must be text of 1 to ${PAGE_NAME_MAX} characters.`);
  }
  if (!isKey(r['index'])) return recordInvalid(id, 'index', `"index" of "${id}" must be an order key (digits and letters, not ending in 0).`);
  if (!(PAGE_BACKGROUNDS as readonly unknown[]).includes(r['background'])) {
    return recordInvalid(id, 'background', `"background" of "${id}" must be one of ${PAGE_BACKGROUNDS.join(', ')}.`);
  }
  return ok(Object.freeze({ ...r }) as unknown as BoardRecord);
}

function checkCamera(id: string, r: Record<string, unknown>): BoardResult<BoardRecord> {
  if (!hasPrefix(r['page'], 'page:')) return recordInvalid(id, 'page', `The camera "${id}" needs a page id that starts with page:.`);
  for (const f of ['x', 'y']) {
    if (!finite(r[f])) return recordInvalid(id, f, `"${f}" of "${id}" must be a finite number.`);
  }
  const zoom = r['zoom'];
  if (!finite(zoom) || zoom < ZOOM_MIN || zoom > ZOOM_MAX) {
    return recordInvalid(id, 'zoom', `"zoom" of "${id}" must be a number from ${ZOOM_MIN} to ${ZOOM_MAX}.`);
  }
  return ok(Object.freeze({ ...r }) as unknown as BoardRecord);
}

function checkBinding(id: string, r: Record<string, unknown>): BoardResult<BoardRecord> {
  if (r['kind'] !== 'arrow') return recordInvalid(id, 'kind', `"kind" of "${id}" must be "arrow".`);
  for (const f of ['from', 'to']) {
    if (!hasPrefix(r[f], 'shape:')) return recordInvalid(id, f, `"${f}" of "${id}" must be a shape id.`);
  }
  if (r['props'] === undefined) return recordInvalid(id, 'props', `The binding "${id}" is missing "props".`);
  return ok(Object.freeze({ ...r }) as unknown as BoardRecord);
}

function checkAsset(id: string, r: Record<string, unknown>): BoardResult<BoardRecord> {
  if (typeof r['mime'] !== 'string' || r['mime'] === '') return recordInvalid(id, 'mime', `"mime" of "${id}" must be text.`);
  const size = r['size'];
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    return recordInvalid(id, 'size', `"size" of "${id}" must be a whole number of bytes.`);
  }
  if (size > ASSET_BYTES_MAX) {
    return boardError('asset_invalid', 'This image could not be added: it is over 10 MB.', { detail: { record: id, field: 'size', limit: ASSET_BYTES_MAX } });
  }
  if (typeof r['data'] !== 'string') return recordInvalid(id, 'data', `"data" of "${id}" must be base64 text.`);
  return ok(Object.freeze({ ...r }) as unknown as BoardRecord);
}

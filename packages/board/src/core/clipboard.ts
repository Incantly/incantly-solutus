/**
 * Copy and paste (design 7.4, R5.5). A copy is board JSON with a type tag inside, so it travels as text from one board
 * to another; a paste of plain text makes a text shape, a paste of an Incantly script (header `# incantly 1`) makes a
 * figure card record (the live card is round 4), and a paste of image bytes makes an image shape. Every copy of a
 * record gives the copy its own props and meta through `copyProps` (BR-4), so it shares nothing with the original or
 * with the undo history. No DOM, no timers: the web view reads and writes the system clipboard and calls these.
 */
import type { BoardCore } from './board';
import type { BoardResult } from './errors';
import { boardError, ok } from './errors';
import { copyProps } from './copy';
import { FILE_FORMAT, FILE_VERSION, loadBoard, writeDocument } from './file';
import { keyBetween } from './fractional';
import { shapeGeometry } from './geometry';
import { FIGURE_HEADER } from './kinds/media';
import { boxCx, boxCy } from './math2d';
import { allBindings, bindingProps } from './bindings';
import { descendantsOf, expandGroups, putNewShape, shapeOf, stackOf, topKey } from './shapes';
import { isAsset, isBinding, isShape } from './types';
import type { AssetRecord, BindingRecord, Bounds, ShapeRecord } from './types';

/** The type tag written inside a copy. */
export const CLIPBOARD_TYPE = 'incantly-board-clipboard';

/** What a copy holds: the shapes (in stacking order), the bindings between them, and the assets they use. */
export interface ClipboardData {
  readonly shapes: readonly ShapeRecord[];
  readonly bindings: readonly BindingRecord[];
  readonly assets: readonly AssetRecord[];
}

/** The offset of a pasted copy from the original when no place is given, and of a duplicate. */
export const PASTE_OFFSET = 16;

/** The shapes to copy for a selection: the shapes, what frames hold, and the groups they belong to. */
export function copySelection(core: BoardCore, ids: readonly string[]): BoardResult<ClipboardData> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  const { store } = core;
  const picked = new Set(expandGroups(store, ids).filter((id) => shapeOf(store, id) !== undefined));
  for (const id of descendantsOf(store, page, [...picked])) picked.add(id);
  // the groups the picked shapes belong to come along (a group with no member left would be empty)
  for (const id of [...picked]) {
    let s = shapeOf(store, id);
    for (let depth = 0; s !== undefined && s.parent !== null && depth < 32; depth++) {
      const parent = shapeOf(store, s.parent);
      if (parent === undefined || parent.kind !== 'group') break;
      picked.add(parent.id);
      s = parent;
    }
  }
  if (picked.size === 0) return boardError('bad_argument', 'There is nothing selected to copy.', { detail: { field: 'ids' } });
  const shapes = stackOf(store, page)
    .filter((s) => picked.has(s.id))
    .map((s) => ({ ...s, parent: s.parent !== null && picked.has(s.parent) ? s.parent : null, props: copyProps(s.props), meta: copyProps(s.meta) }));
  const bindings = allBindings(store)
    .filter((b) => picked.has(b.from) && picked.has(b.to))
    .map((b) => ({ ...b, props: copyProps(b.props) }));
  const used = new Set<string>();
  for (const s of shapes) {
    const asset = (s.props as { asset?: unknown } | null)?.asset;
    if (s.kind === 'image' && typeof asset === 'string') used.add(asset);
  }
  const assets: AssetRecord[] = [];
  for (const id of used) {
    const r = store.get(id);
    if (r !== undefined && isAsset(r)) assets.push({ ...r });
  }
  return ok({ shapes, bindings, assets });
}

/** The text of a copy: `{ type, version, board }`, where `board` is a board document of the copied records. */
export function clipboardText(core: BoardCore, data: ClipboardData): BoardResult<string> {
  const pageId = core.pages.current;
  const page = pageId === null ? undefined : core.pages.get(pageId);
  if (page === undefined) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  const written = writeDocument({
    format: FILE_FORMAT,
    version: FILE_VERSION,
    pages: [page],
    records: [...data.shapes, ...data.bindings],
    assets: data.assets,
    meta: {},
  });
  if (!written.ok) return written;
  return ok(JSON.stringify({ type: CLIPBOARD_TYPE, version: 1, board: written.value }));
}

/** True when the text is a board copy (it parses and carries the type tag). */
export function isBoardClipboard(text: string): boolean {
  if (!text.startsWith('{')) return false;
  try {
    const v = JSON.parse(text) as { type?: unknown };
    return v.type === CLIPBOARD_TYPE;
  } catch {
    return false;
  }
}

/** Reads the text of a copy. `board_invalid` when the text is not a copy or its records fail their checks. */
export function readClipboardText(core: BoardCore, text: string): BoardResult<ClipboardData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return boardError('board_invalid', 'This is not a copy of board shapes.', { detail: { field: 'clipboard' } });
  }
  const p = parsed as { type?: unknown; version?: unknown; board?: unknown } | null;
  if (p === null || typeof p !== 'object' || p.type !== CLIPBOARD_TYPE) return boardError('board_invalid', 'This is not a copy of board shapes.', { detail: { field: 'type' } });
  if (typeof p.version !== 'number' || p.version > 1) return boardError('board_too_new', 'This copy was made with a newer version of Incantly.', { detail: { version: p.version } });
  if (typeof p.board !== 'string') return boardError('board_invalid', 'This copy holds no shapes.', { detail: { field: 'board' } });
  const loaded = loadBoard(p.board, { kinds: core.store.kinds, limits: { shapesPerPage: 1_000_000, inkPointsPerPage: 1_000_000_000, assetBytes: 1_000_000_000 } });
  if (!loaded.ok) return loaded;
  const records = loaded.value.store.all();
  return ok({
    shapes: records.filter(isShape),
    bindings: records.filter(isBinding),
    assets: records.filter(isAsset),
  });
}

/** The box of the copied shapes on the page (their own boxes, without the pad of a line). */
function dataBounds(core: BoardCore, data: ClipboardData): Bounds | undefined {
  let b: Bounds | undefined;
  for (const s of data.shapes) {
    const g = shapeGeometry(s, core.store.kinds);
    if (g === undefined) continue;
    const xs = [g.corners[0], g.corners[2], g.corners[4], g.corners[6]] as number[];
    const ys = [g.corners[1], g.corners[3], g.corners[5], g.corners[7]] as number[];
    const o = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    b = b === undefined ? o : { minX: Math.min(b.minX, o.minX), minY: Math.min(b.minY, o.minY), maxX: Math.max(b.maxX, o.maxX), maxY: Math.max(b.maxY, o.maxY) };
  }
  return b;
}

/**
 * Puts the copied shapes on the current page, on top, as one undo step. With `at` their middle goes there; without it
 * they sit `PASTE_OFFSET` from where they were. Returns the new ids (what the selection should hold, without groups).
 */
export function pasteData(core: BoardCore, data: ClipboardData, at?: { readonly x: number; readonly y: number }, options: { readonly mergeKey?: string } = {}): BoardResult<string[]> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  if (data.shapes.length === 0) return ok([]);
  const { store } = core;
  const box = dataBounds(core, data);
  const dx = at !== undefined && box !== undefined ? at.x - boxCx(box) : PASTE_OFFSET;
  const dy = at !== undefined && box !== undefined ? at.y - boxCy(box) : PASTE_OFFSET;
  const created: string[] = [];
  const written = store.change(
    'user',
    (tx) => {
      const ids = new Map<string, string>();
      for (const s of data.shapes) ids.set(s.id, tx.newId('shape'));
      const assets = new Map<string, string>();
      for (const a of data.assets) {
        const have = store.get(a.id);
        if (have !== undefined && isAsset(have) && have.data === a.data) {
          assets.set(a.id, a.id);
          continue;
        }
        const id = tx.newId('asset');
        assets.set(a.id, id);
        tx.put({ ...a, id });
      }
      let previous = topKey(store, page);
      for (const s of data.shapes) {
        const key = keyBetween(previous, null);
        if (!key.ok) return;
        previous = key.value;
        const props = copyProps(s.props) as Record<string, unknown>;
        if (s.kind === 'image' && typeof props['asset'] === 'string') props['asset'] = assets.get(props['asset']) ?? props['asset'];
        const id = ids.get(s.id) as string;
        tx.put({
          ...s,
          id,
          page,
          x: s.x + dx,
          y: s.y + dy,
          parent: s.parent !== null ? (ids.get(s.parent) ?? null) : null,
          index: key.value,
          props,
          meta: copyProps(s.meta),
        });
        if (s.kind !== 'group') created.push(id);
      }
      for (const b of data.bindings) {
        const from = ids.get(b.from);
        const to = ids.get(b.to);
        if (from === undefined || to === undefined || bindingProps(b) === undefined) continue;
        tx.put({ id: tx.newId('binding'), kind: 'arrow', from, to, props: copyProps(b.props) });
      }
    },
    options.mergeKey !== undefined ? { mergeKey: options.mergeKey } : {},
  );
  return written.ok ? ok(created) : written;
}

/** Copies the shapes and puts the copies on the page, offset a little; returns the new ids. One undo step. */
export function duplicateShapes(core: BoardCore, ids: readonly string[], options: { readonly mergeKey?: string } = {}): BoardResult<string[]> {
  const data = copySelection(core, ids);
  if (!data.ok) return data;
  return pasteData(core, data.value, undefined, options);
}

/** A text shape with the text at the page point; long text gets a fixed width so it wraps. */
export function pasteText(core: BoardCore, text: string, at: { readonly x: number; readonly y: number }): BoardResult<string[]> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  const wide = text.length > 36 || text.includes('\n');
  let id = '';
  const written = core.store.change('user', (tx) => {
    const made = putNewShape(tx, core.store, { kind: 'text', page, x: at.x, y: at.y, props: { text, w: wide ? 480 : null } });
    if (made.ok) id = made.value.id;
  });
  return written.ok ? ok(id === '' ? [] : [id]) : written;
}

/** True when the text is an Incantly script: its first line is the header. */
export const isScript = (text: string): boolean => text.trimStart().startsWith(FIGURE_HEADER);

/** A figure card record holding the script, with its middle at the page point. The live card is round 4. */
export function pasteScript(core: BoardCore, script: string, at: { readonly x: number; readonly y: number }): BoardResult<string[]> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  let id = '';
  const written = core.store.change('user', (tx) => {
    const made = putNewShape(tx, core.store, { kind: 'figure', page, x: at.x - 180, y: at.y - 130, props: { script: script.trimStart() } });
    if (made.ok) id = made.value.id;
  });
  return written.ok ? ok(id === '' ? [] : [id]) : written;
}

/** Pastes text from the clipboard: a board copy, an Incantly script, or plain text, whichever it is. */
export function pasteAny(core: BoardCore, text: string, at: { readonly x: number; readonly y: number }): BoardResult<string[]> {
  if (isBoardClipboard(text)) {
    const data = readClipboardText(core, text);
    return data.ok ? pasteData(core, data.value, at) : data;
  }
  if (isScript(text)) return pasteScript(core, text, at);
  if (text.trim() === '') return ok([]);
  return pasteText(core, text, at);
}

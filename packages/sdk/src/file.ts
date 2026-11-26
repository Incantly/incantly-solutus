/**
 * The file format (embed-files-export design 4; errors 3; .kiro/specs/sdk R2): the script is the meaning; the JSON file
 * adds settings, clock, layout, assets, metadata and a thumbnail. A file is data: loading it replays its script and
 * never runs host code.
 */
import { MODES, sha256 } from '@incantly/modes';
import type { AppModeId } from '@incantly/modes';
import type { KernelError } from './app';
import type { ApiError } from './errors';
import { apiError, isApiError } from './errors';
import type { Value } from './values';

export const FORMAT_VERSION = 1;
export const FILE_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, assets: 200, assetBytes: 5 * 1024 * 1024, thumbnailBytes: 40 * 1024, linkBytes: 8 * 1024 });

export type AssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

export interface Asset {
  readonly mime: AssetMime;
  readonly encoding: 'base64';
  readonly data: string;
  readonly width?: number;
  readonly height?: number;
  /** SHA-256 of `data` (the base64 text). */
  readonly sha256: string;
}

export interface FileSettings {
  readonly view: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly keepRatio: boolean };
  readonly axes: { readonly x: boolean; readonly y: boolean };
  readonly grid: 'none' | 'major' | 'minor';
  readonly angleUnit: 'radian' | 'degree';
  readonly rounding: { readonly mode: 'decimals' | 'sig'; readonly digits: number };
  readonly coordinatesStyle: 'cartesian' | 'polar';
  readonly language: string;
  readonly keyboard?: 'auto' | 'on' | 'off';
}

export interface Meta {
  readonly title?: string;
  readonly author?: string;
  readonly description?: string;
  readonly created?: string;
  readonly modified?: string;
  readonly tags?: readonly string[];
  readonly license?: string;
}

export interface IncantlyFile {
  readonly format: 'incantly';
  readonly formatVersion: number;
  readonly appVersion: string;
  readonly mode: AppModeId;
  readonly script: string;
  readonly settings: FileSettings;
  readonly clock?: { readonly range: readonly [number, number]; readonly t: number; readonly speed: number; readonly playing: boolean };
  readonly views: { readonly panes: readonly string[] };
  readonly assets: Readonly<Record<string, Asset>>;
  readonly meta: Meta;
  readonly thumbnail?: string;
  readonly cache?: { readonly checksum: string; readonly values: Readonly<Record<string, Value>> };
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export interface FileWarning {
  readonly kind: string;
  readonly message: string;
  readonly id?: string;
}

export interface LoadResult {
  readonly ok: boolean;
  readonly migrated: boolean;
  readonly applied: number;
  readonly failed: readonly KernelError[];
  readonly warnings: readonly FileWarning[];
  readonly modeAdjusted?: { readonly from: string; readonly to: AppModeId; readonly reason: string };
}

export const APP_VERSION = '0.1.0';

const KNOWN_KEYS: ReadonlySet<string> = new Set(['format', 'formatVersion', 'appVersion', 'mode', 'script', 'settings', 'clock', 'views', 'assets', 'meta', 'thumbnail', 'cache', 'extensions']);

/* ------------------------------ checking the shape ------------------------------ */

class Bad extends Error {
  constructor(readonly path: string, readonly why: string) {
    super(`${path} ${why}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const got = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'a list' : typeof v === 'string' ? `"${v.slice(0, 20)}"` : typeof v === 'object' ? 'an object' : String(v));

function num(o: Record<string, unknown>, k: string, path: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Bad(`${path}.${k}`, `must be a finite number, got ${got(v)}`);
  return v;
}
function bool(o: Record<string, unknown>, k: string, path: string): boolean {
  const v = o[k];
  if (typeof v !== 'boolean') throw new Bad(`${path}.${k}`, `must be true or false, got ${got(v)}`);
  return v;
}
function str(o: Record<string, unknown>, k: string, path: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new Bad(`${path}.${k}`, `must be a text, got ${got(v)}`);
  return v;
}
function oneOf<T extends string>(o: Record<string, unknown>, k: string, path: string, allowed: readonly T[]): T {
  const v = o[k];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new Bad(`${path}.${k}`, `must be ${allowed.join(', ')}, got ${got(v)}`);
  return v as T;
}
function obj(o: Record<string, unknown>, k: string, path: string): Record<string, unknown> {
  const v = o[k];
  if (!isObj(v)) throw new Bad(`${path}.${k}`, `must be an object, got ${got(v)}`);
  return v;
}

function checkSettings(s: Record<string, unknown>): FileSettings {
  const p = 'settings';
  const view = obj(s, 'view', p);
  const axes = obj(s, 'axes', p);
  const rounding = obj(s, 'rounding', p);
  const out: FileSettings = {
    view: { x0: num(view, 'x0', `${p}.view`), x1: num(view, 'x1', `${p}.view`), y0: num(view, 'y0', `${p}.view`), y1: num(view, 'y1', `${p}.view`), keepRatio: bool(view, 'keepRatio', `${p}.view`) },
    axes: { x: bool(axes, 'x', `${p}.axes`), y: bool(axes, 'y', `${p}.axes`) },
    grid: oneOf(s, 'grid', p, ['none', 'major', 'minor'] as const),
    angleUnit: oneOf(s, 'angleUnit', p, ['radian', 'degree'] as const),
    rounding: { mode: oneOf(rounding, 'mode', `${p}.rounding`, ['decimals', 'sig'] as const), digits: num(rounding, 'digits', `${p}.rounding`) },
    coordinatesStyle: oneOf(s, 'coordinatesStyle', p, ['cartesian', 'polar'] as const),
    language: str(s, 'language', p),
    ...(s['keyboard'] !== undefined ? { keyboard: oneOf(s, 'keyboard', p, ['auto', 'on', 'off'] as const) } : {}),
  };
  if (!(out.view.x0 < out.view.x1) || !(out.view.y0 < out.view.y1)) throw new Bad(`${p}.view`, 'must have x0 < x1 and y0 < y1');
  return out;
}

/** The file's shape, checked field by field: the first bad field is named with its path (errors 3). */
export function checkFile(v: unknown): IncantlyFile | ApiError {
  try {
    if (!isObj(v)) throw new Bad('file', `must be an object, got ${got(v)}`);
    if (v['format'] !== 'incantly') throw new Bad('format', `must be "incantly", got ${got(v['format'])}`);
    const formatVersion = num(v, 'formatVersion', 'file');
    if (formatVersion > FORMAT_VERSION) {
      return apiError('file', 'file_too_new', `This file uses format ${formatVersion}; this app reads up to format ${FORMAT_VERSION}.`, {
        hint: `Update the app, or ask the author to export for format ${FORMAT_VERSION}.`,
        detail: { fileVersion: formatVersion, supported: FORMAT_VERSION },
      });
    }
    const script = str(v, 'script', 'file');
    const settings = checkSettings(obj(v, 'settings', 'file'));
    const meta = v['meta'] === undefined ? {} : obj(v, 'meta', 'file');
    const assets = v['assets'] === undefined ? {} : obj(v, 'assets', 'file');
    const views = v['views'] === undefined ? { panes: [] } : obj(v, 'views', 'file');
    let clock: IncantlyFile['clock'];
    if (v['clock'] !== undefined) {
      const c = obj(v, 'clock', 'file');
      const range = c['range'];
      if (!Array.isArray(range) || range.length !== 2 || !range.every((x) => typeof x === 'number' && Number.isFinite(x)) || !((range[0] as number) < (range[1] as number))) throw new Bad('clock.range', `must be two finite numbers, the first smaller, got ${got(range)}`);
      clock = { range: [range[0] as number, range[1] as number], t: num(c, 't', 'clock'), speed: num(c, 'speed', 'clock'), playing: bool(c, 'playing', 'clock') };
    }
    if (v['thumbnail'] !== undefined) str(v, 'thumbnail', 'file');
    return {
      ...v,
      format: 'incantly',
      formatVersion,
      appVersion: typeof v['appVersion'] === 'string' ? v['appVersion'] : 'unknown',
      mode: (typeof v['mode'] === 'string' ? v['mode'] : 'graphing') as AppModeId,
      script,
      settings,
      ...(clock ? { clock } : {}),
      views: { panes: Array.isArray(views['panes']) ? (views['panes'] as unknown[]).filter((x): x is string => typeof x === 'string') : [] },
      assets: assets as Record<string, Asset>,
      meta: meta as Meta,
    };
  } catch (e) {
    if (e instanceof Bad) return apiError('file', 'file_invalid', `${e.path} ${e.why}.`, { hint: 'Re-export the figure or fix the field.', detail: { path: e.path } });
    // a fault in the checks themselves: the file is refused, never half-read
    return apiError('file', 'file_invalid', 'The file could not be checked.', { hint: 'Re-export the figure.' });
  }
}

/* ------------------------------ migrations ------------------------------ */

/** Pure steps from one format to the next: `MIGRATIONS[n]` turns format n into n + 1. */
export const MIGRATIONS: Readonly<Record<number, (f: Record<string, unknown>) => Record<string, unknown>>> = {
  // format 0 (the early studio's script-only JSON) had no settings: the defaults stand in
  0: (f) => ({ ...f, formatVersion: 1, settings: f['settings'] ?? defaultSettings(), views: f['views'] ?? { panes: [] }, assets: f['assets'] ?? {}, meta: f['meta'] ?? {} }),
};

export function migrate(raw: Record<string, unknown>): { file: Record<string, unknown>; migrated: boolean } | ApiError {
  let f = raw;
  let migrated = false;
  let v = typeof f['formatVersion'] === 'number' ? (f['formatVersion'] as number) : 0;
  while (v < FORMAT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return apiError('file', 'migration_failed', `There is no way from format ${v} to ${v + 1}.`, { detail: { step: v } });
    try {
      f = step(f);
    } catch (e) {
      return apiError('file', 'migration_failed', `Moving the file from format ${v} to ${v + 1} failed: ${e instanceof Error ? e.message : String(e)}.`, { detail: { step: v } });
    }
    migrated = true;
    v++;
  }
  return { file: f, migrated };
}

export function defaultSettings(): FileSettings {
  return {
    view: { x0: -10, x1: 10, y0: -7, y1: 7, keepRatio: true },
    axes: { x: true, y: true },
    grid: 'major',
    angleUnit: 'radian',
    rounding: { mode: 'decimals', digits: 2 },
    coordinatesStyle: 'cartesian',
    language: 'en',
  };
}

/** Modes whose graphics are not the graphing frame. A new app of one of these uses that mode's axes, grid, and window until a line sets them. */
const MODE_FRAME: ReadonlySet<AppModeId> = new Set(['geometry', 'scientific', 'figure']);

/** Settings a new app starts from. Graphing keeps `defaultSettings`; geometry, the calculator, and a figure take the mode's frame. */
export function settingsForMode(mode: AppModeId): FileSettings {
  const base = defaultSettings();
  if (!MODE_FRAME.has(mode)) return base;
  const d = MODES[mode].defaults;
  return {
    ...base,
    view: { x0: d.view.x0, x1: d.view.x1, y0: d.view.y0, y1: d.view.y1, keepRatio: d.view.keepRatio },
    axes: { x: d.axes, y: d.axes },
    grid: d.grid,
    angleUnit: d.angleUnit,
    rounding: { mode: d.rounding.mode, digits: d.rounding.digits },
    coordinatesStyle: d.coordinates === 'polar' ? 'polar' : 'cartesian',
  };
}

/* ------------------------------ assets ------------------------------ */

function bytesOf(b64: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return undefined;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}

const starts = (b: Uint8Array, sig: readonly number[], at = 0): boolean => sig.every((x, i) => b[at + i] === x);

/** Why an asset cannot be used, or `undefined` (errors 3: magic number, MIME, SVG scripts and outside links). */
export function assetProblem(a: unknown): string | undefined {
  if (!isObj(a)) return 'it is not an object';
  const mime = a['mime'];
  if (a['encoding'] !== 'base64' || typeof a['data'] !== 'string') return 'it must hold base64 data';
  const data = a['data'] as string;
  if (data.length * 0.75 > FILE_LIMITS.assetBytes) return 'it is over 5 MB';
  const bytes = bytesOf(data);
  if (!bytes) return 'its data is not base64';
  if (typeof a['sha256'] === 'string' && a['sha256'] !== sha256(data)) return 'its checksum does not match its data';
  switch (mime) {
    case 'image/png':
      return starts(bytes, [0x89, 0x50, 0x4e, 0x47]) ? undefined : 'it is not a PNG';
    case 'image/jpeg':
      return starts(bytes, [0xff, 0xd8, 0xff]) ? undefined : 'it is not a JPEG';
    case 'image/webp':
      return starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8) ? undefined : 'it is not a WebP image';
    case 'image/svg+xml': {
      const text = new TextDecoder().decode(bytes);
      if (!/<svg[\s>]/i.test(text)) return 'it is not an SVG';
      if (/<script|\son\w+\s*=|javascript:/i.test(text)) return 'the SVG holds a script';
      if (/(?:href|src)\s*=\s*["'](?!#|data:)/i.test(text)) return 'the SVG links to something outside the file';
      return undefined;
    }
    default:
      return `the type ${String(mime)} is not an image the app reads`;
  }
}

/** The assets that can be used, and a warning for each dropped one. */
export function checkAssets(assets: Readonly<Record<string, unknown>>): { assets: Record<string, Asset>; warnings: FileWarning[] } | ApiError {
  const ids = Object.keys(assets);
  if (ids.length > FILE_LIMITS.assets) return apiError('file', 'file_too_large', `The file has ${ids.length} assets; the limit is ${FILE_LIMITS.assets}.`, { detail: { limit: 'assets', max: FILE_LIMITS.assets, actual: ids.length } });
  const out: Record<string, Asset> = {};
  const warnings: FileWarning[] = [];
  for (const id of ids) {
    const why = assetProblem(assets[id]);
    if (why === undefined) out[id] = assets[id] as Asset;
    else warnings.push({ kind: 'asset_invalid', id, message: `${id} was dropped: ${why}.` });
  }
  return { assets: out, warnings };
}

/* ------------------------------ reading text ------------------------------ */

/** What a text is: a JSON file, or a script. Binary data that is neither is `file_not_text`. */
export function sniff(text: string): { kind: 'json'; value: unknown } | { kind: 'script'; text: string } | ApiError {
  if (text.length > FILE_LIMITS.bytes) return apiError('file', 'file_too_large', `The file is ${Math.round(text.length / 1024 / 1024)} MB; the limit is 10 MB.`, { detail: { limit: 'bytes', max: FILE_LIMITS.bytes, actual: text.length } });
  const head = text.slice(0, 512);
  if (head.includes('\u0000') || [...head].filter((c) => c.charCodeAt(0) < 32 && !'\t\n\r'.includes(c)).length > 4) {
    const shown = [...head.slice(0, 8)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    return apiError('file', 'file_not_text', `This is not a figure: the first bytes are ${shown}.`, { hint: 'Open a .incantly, .inc or .json file.', detail: { bytes: shown } });
  }
  const body = text.replace(/^\uFEFF/, '');
  if (/^\s*\{/.test(body)) {
    try {
      return { kind: 'json', value: JSON.parse(body) as unknown };
    } catch (e) {
      return apiError('file', 'file_invalid', `The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}.`, { hint: 'Re-export the figure.', detail: { path: 'file' } });
    }
  }
  return { kind: 'script', text: body };
}

/** The file of a JSON value: migrated, checked, its assets checked. */
export function readFile(value: unknown): { file: IncantlyFile; migrated: boolean; warnings: FileWarning[] } | ApiError {
  if (!isObj(value)) return checkFile(value) as ApiError;
  if (value['format'] === 'incantly' && typeof value['formatVersion'] === 'number' && value['formatVersion'] > FORMAT_VERSION) return checkFile(value) as ApiError;
  if (value['format'] !== undefined && value['format'] !== 'incantly') return checkFile(value) as ApiError;
  const m = migrate(value);
  if ('ok' in m) return m;
  const f = checkFile(m.file);
  if (isApiError(f)) return f;
  const a = checkAssets(f.assets);
  if ('ok' in a) return a;
  const warnings = [...a.warnings];
  if (f.cache && f.cache.checksum !== sha256(f.script)) warnings.push({ kind: 'checksum_mismatch', message: 'The saved values do not match the script; they were computed again.' });
  if (f.thumbnail !== undefined && f.thumbnail.length > FILE_LIMITS.thumbnailBytes * 1.4) warnings.push({ kind: 'thumbnail_dropped', message: 'The thumbnail is over 40 KB; it was left out.' });
  return { file: { ...f, assets: a.assets }, migrated: m.migrated, warnings };
}

/** The mode a file opens in: its own, or graphing when this build has no such mode (errors 3, `mode_unavailable`). */
export function modeFor(mode: string): { mode: AppModeId; adjusted?: { from: string; to: AppModeId; reason: string } } {
  const m = (MODES as Record<string, { available?: boolean } | undefined>)[mode];
  if (m && m.available !== false) return { mode: mode as AppModeId };
  return { mode: 'graphing', adjusted: { from: mode, to: 'graphing', reason: m ? `The ${mode} mode is not part of this app yet.` : `There is no ${mode} mode.` } };
}

/** Top-level keys this version does not know, kept for the next save (design 4.5). */
export function unknownKeys(f: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (!KNOWN_KEYS.has(k)) out[k] = v;
  return out;
}

/* ------------------------------ links ------------------------------ */

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return undefined;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return bytesOf(b64);
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The file as a URL fragment (`f=…`): no thumbnail, no cache, deflated, base64url (design 6). */
export async function toFragment(file: IncantlyFile): Promise<string> {
  const { thumbnail: _t, cache: _c, ...rest } = file;
  void _t;
  void _c;
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(rest)), new CompressionStream('deflate-raw'));
  return `f=${base64url(bytes)}`;
}

/** A fragment back to its file (`#f=…` or `f=…`). */
export async function fromFragment(fragment: string): Promise<IncantlyFile | ApiError> {
  const m = /^#?f=([A-Za-z0-9_-]+)$/.exec(fragment.trim());
  const bytes = m ? fromBase64url(m[1] as string) : undefined;
  if (!bytes) return apiError('file', 'file_invalid', 'The link does not hold a figure.', { detail: { path: 'fragment' } });
  let text: string;
  try {
    text = new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
  } catch {
    return apiError('file', 'file_invalid', 'The link is damaged: it could not be unpacked.', { detail: { path: 'fragment' } });
  }
  const s = sniff(text);
  if ('ok' in s) return s;
  if (s.kind !== 'json') return apiError('file', 'file_invalid', 'The link does not hold a figure file.', { detail: { path: 'fragment' } });
  const r = readFile(s.value);
  return 'ok' in r ? r : r.file;
}

/** A gzipped file's bytes as text; other bytes are decoded as UTF-8. */
export async function textOfBytes(bytes: Uint8Array): Promise<string | ApiError> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('gzip')));
    } catch {
      return apiError('file', 'file_not_text', 'The file looks compressed but could not be unpacked.', { detail: { bytes: '1f 8b' } });
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Gzipped bytes of a text (`.incantly.gz`). */
export async function gzip(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream('gzip'));
}

/** The records of the board and the diff a transaction sends (docs/features/board/design.md, section 4). */

/** Who made a change, as for kernel lines. */
export type Origin = 'user' | 'model' | 'host' | 'remote';
export const ORIGINS: readonly Origin[] = ['user', 'model', 'host', 'remote'];

export type RecordType = 'shape' | 'page' | 'camera' | 'binding' | 'asset';
export const RECORD_TYPES: readonly RecordType[] = ['shape', 'page', 'camera', 'binding', 'asset'];

export interface ShapeRecord<K extends string = string, P = unknown> {
  /** `shape:…` */
  readonly id: string;
  /** `page:…` */
  readonly page: string;
  readonly kind: K;
  /** Page units, the shape's origin. */
  readonly x: number;
  readonly y: number;
  /** Radians. */
  readonly rotation: number;
  /** A frame or group id, or null. */
  readonly parent: string | null;
  /** Fractional order key within the parent (`core/fractional.ts`). */
  readonly index: string;
  readonly locked: boolean;
  /** 0 to 1. */
  readonly opacity: number;
  /** The kind's own data. */
  readonly props: P;
  /** The host's own data: kept and saved, never read by the board. */
  readonly meta: Readonly<Record<string, unknown>>;
}

export type PageBackground = 'none' | 'grid' | 'dots' | 'lines';
export const PAGE_BACKGROUNDS: readonly PageBackground[] = ['none', 'grid', 'dots', 'lines'];

export interface PageRecord {
  /** `page:…` */
  readonly id: string;
  readonly name: string;
  /** Fractional order key among the pages. */
  readonly index: string;
  readonly background: PageBackground;
}

/** The saved camera of a page: the page point at the top-left of the screen, and the zoom. */
export interface CameraRecord {
  /** `camera:…` */
  readonly id: string;
  readonly page: string;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface BindingRecord {
  /** `binding:…` */
  readonly id: string;
  readonly kind: 'arrow';
  /** `shape:…` */
  readonly from: string;
  readonly to: string;
  readonly props: unknown;
}

export interface AssetRecord {
  /** `asset:…` */
  readonly id: string;
  readonly mime: string;
  /** Size of the bytes, for the document limit. */
  readonly size: number;
  /** The bytes as base64. */
  readonly data: string;
}

export type BoardRecord = ShapeRecord | PageRecord | CameraRecord | BindingRecord | AssetRecord;

/** The type of a record from its id prefix, or undefined when the prefix is not one of ours. */
export function recordTypeOf(id: string): RecordType | undefined {
  const colon = id.indexOf(':');
  if (colon <= 0 || colon === id.length - 1) return undefined;
  const head = id.slice(0, colon);
  return head === 'shape' || head === 'page' || head === 'camera' || head === 'binding' || head === 'asset' ? head : undefined;
}

export const isShape = (r: BoardRecord): r is ShapeRecord => r.id.startsWith('shape:');
export const isPage = (r: BoardRecord): r is PageRecord => r.id.startsWith('page:');
export const isCamera = (r: BoardRecord): r is CameraRecord => r.id.startsWith('camera:');
export const isBinding = (r: BoardRecord): r is BindingRecord => r.id.startsWith('binding:');
export const isAsset = (r: BoardRecord): r is AssetRecord => r.id.startsWith('asset:');

/** One record that a transaction changed. */
export interface Update {
  readonly before: BoardRecord;
  readonly after: BoardRecord;
}

/** What one transaction changed, with its net effect per id. */
export interface Diff {
  readonly origin: Origin;
  readonly added: readonly BoardRecord[];
  readonly updated: readonly Update[];
  readonly removed: readonly BoardRecord[];
  /** False for a change that is not an undo step (camera, selection, pictures). */
  readonly history: boolean;
  /** Writes with the same key, one after the other, are one undo step; null for none. */
  readonly mergeKey: string | null;
}

export interface Limits {
  readonly shapesPerPage: number;
  readonly pages: number;
  readonly inkPointsPerPage: number;
  readonly assetBytes: number;
}

export const DEFAULT_LIMITS: Limits = Object.freeze({
  shapesPerPage: 10_000,
  pages: 100,
  inkPointsPerPage: 2_000_000,
  assetBytes: 50 * 1024 * 1024,
});

/** One image may not be larger than this (errors.md, `asset_invalid`). */
export const ASSET_BYTES_MAX = 10 * 1024 * 1024;

/** An axis-aligned box in page units. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Images (design 7.1, 12; errors.md `asset_invalid`): PNG, JPEG, WebP and SVG, told apart by their magic number as the
 * SDK's files are, never by a name or a type a caller says. An SVG with a script, an event attribute or a link to
 * something outside is refused. The size of the picture is read from the bytes so a new image shape has its own
 * proportions without a decoder. No DOM, no timers.
 */
import type { BoardCore } from './board';
import type { BoardResult } from './errors';
import { boardError, ok } from './errors';
import { toBase64 } from './base64';
import { putNewShape } from './shapes';
import { ASSET_BYTES_MAX } from './types';
import type { AssetRecord, ShapeRecord } from './types';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

const starts = (b: Uint8Array, sig: readonly number[], at = 0): boolean => sig.every((x, i) => b[at + i] === x);

/** The type of an image by its magic number, or undefined when the bytes are not an image the board takes. */
export function sniffImage(bytes: Uint8Array): ImageMime | undefined {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return /<svg[\s>]/i.test(head) ? 'image/svg+xml' : undefined;
}

/** Why bytes cannot be an image on the board, or undefined. */
export function imageProblem(bytes: Uint8Array): string | undefined {
  if (bytes.length === 0) return 'it is empty';
  if (bytes.length > ASSET_BYTES_MAX) return 'it is over 10 MB';
  const mime = sniffImage(bytes);
  if (mime === undefined) return 'it is not a PNG, JPEG, WebP or SVG image';
  if (mime === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    if (/<script|\son\w+\s*=|javascript:/i.test(text)) return 'the SVG holds a script';
    if (/(?:href|src)\s*=\s*["'](?!#|data:)/i.test(text)) return 'the SVG links to something outside the file';
    if (/<foreignObject|<!ENTITY/i.test(text)) return 'the SVG holds content the board does not take';
  }
  return undefined;
}

const be32 = (b: Uint8Array, at: number): number => (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;

/** The width and height of the picture in the bytes, or undefined when they cannot be read. */
export function imageSize(bytes: Uint8Array, mime: ImageMime): { readonly w: number; readonly h: number } | undefined {
  if (mime === 'image/png') return bytes.length >= 24 ? { w: be32(bytes, 16), h: be32(bytes, 20) } : undefined;
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1] as number;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: ((bytes[i + 5] as number) << 8) | (bytes[i + 6] as number), w: ((bytes[i + 7] as number) << 8) | (bytes[i + 8] as number) };
      }
      i += 2 + (((bytes[i + 2] as number) << 8) | (bytes[i + 3] as number));
    }
    return undefined;
  }
  if (mime === 'image/webp') {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === 'VP8X' && bytes.length >= 30) {
      return { w: 1 + ((bytes[24] as number) | ((bytes[25] as number) << 8) | ((bytes[26] as number) << 16)), h: 1 + ((bytes[27] as number) | ((bytes[28] as number) << 8) | ((bytes[29] as number) << 16)) };
    }
    if (kind === 'VP8 ' && bytes.length >= 30) return { w: ((bytes[26] as number) | ((bytes[27] as number) << 8)) & 0x3fff, h: ((bytes[28] as number) | ((bytes[29] as number) << 8)) & 0x3fff };
    if (kind === 'VP8L' && bytes.length >= 25) {
      const bits = (bytes[21] as number) | ((bytes[22] as number) << 8) | ((bytes[23] as number) << 16) | ((bytes[24] as number) << 24);
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >>> 14) & 0x3fff) };
    }
    return undefined;
  }
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const box = /viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(text);
  if (box !== null) return { w: Number(box[1]), h: Number(box[2]) };
  const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(text);
  const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(text);
  return w !== null && h !== null ? { w: Number(w[1]), h: Number(h[1]) } : undefined;
}

/** The longest side of a new image shape, in page units. */
export const IMAGE_SIDE = 400;

export interface AddImageOptions {
  /** The page point the image's middle goes to; default the middle of the camera's view is the caller's choice. */
  readonly at: { readonly x: number; readonly y: number };
  readonly mergeKey?: string;
}

/** Stores the bytes as an asset and puts an image shape on the current page, one undo step. `asset_invalid` when the bytes are not an image the board takes. */
export function addImage(core: BoardCore, bytes: Uint8Array, options: AddImageOptions): BoardResult<ShapeRecord> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page to put an image on.', { detail: { field: 'page' } });
  const problem = imageProblem(bytes);
  const mime = problem === undefined ? sniffImage(bytes) : undefined;
  if (problem !== undefined || mime === undefined) {
    return boardError('asset_invalid', 'This image could not be added.', { hint: 'Use a PNG, JPEG, WebP or SVG image under 10 MB.', detail: { why: problem ?? 'unknown type' } });
  }
  const natural = imageSize(bytes, mime);
  const nw = natural !== undefined && natural.w > 0 && natural.h > 0 ? natural : { w: 4, h: 3 };
  const scale = Math.min(1, IMAGE_SIDE / Math.max(nw.w, nw.h));
  const w = Math.max(8, Math.round(nw.w * scale));
  const h = Math.max(8, Math.round(nw.h * scale));
  let made: ShapeRecord | undefined;
  const written = core.store.change(
    'user',
    (tx) => {
      const asset: AssetRecord = { id: tx.newId('asset'), mime, size: bytes.length, data: toBase64(bytes) };
      const a = tx.put(asset);
      if (!a.ok) return;
      const s = putNewShape(tx, core.store, { kind: 'image', page, x: options.at.x - w / 2, y: options.at.y - h / 2, props: { asset: asset.id, w, h, crop: null } });
      if (s.ok) made = s.value;
    },
    options.mergeKey !== undefined ? { mergeKey: options.mergeKey } : {},
  );
  if (!written.ok) return written;
  return made === undefined ? boardError('internal', 'The image could not be added.') : ok(made);
}

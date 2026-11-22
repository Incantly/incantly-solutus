/**
 * Reading a request body with limits (docs/features/server/design.md 7): the size is checked from `content-length` and
 * again while reading, JSON is parsed into an object, and a picture is checked by its magic number and its size.
 */
import type { IncomingMessage } from 'node:http';
import { badRequest, serverError, tooLarge } from '../errors';
import type { ServerError } from '../errors';

/** The most bytes of a request body without a picture. */
export const BODY_LIMIT = 256 * 1024;
/** The most bytes of a request body with a picture. */
export const BODY_LIMIT_PICTURE = 2 * 1024 * 1024;
/** The most bytes of a picture. */
export const PICTURE_BYTES = 1.5 * 1024 * 1024;
/** The most pixels along a side of a picture. */
export const PICTURE_SIDE = 2048;

/** Reads the whole body, or `payload_too_large` as soon as it passes `limit` bytes (reading stops there). */
export function readBody(req: IncomingMessage, limit: number): Promise<{ readonly ok: true; readonly bytes: Buffer } | ServerError> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.resolve(tooLarge('The request', limit));
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (result: { readonly ok: true; readonly bytes: Buffer } | ServerError): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      resolve(result);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > limit) {
        finish(tooLarge('The request', limit));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish({ ok: true, bytes: Buffer.concat(chunks, size) });
    const onError = (): void => finish(badRequest('The request could not be read.'));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/** Parses the body as one JSON object. Not JSON, or JSON that is not an object, is `bad_request`. */
export function parseJsonObject(bytes: Uint8Array): { readonly ok: true; readonly value: Record<string, unknown> } | ServerError {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return badRequest('The body is not JSON.', 'Send one JSON object.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return badRequest('The body must be one JSON object.');
  return { ok: true, value: value as Record<string, unknown> };
}

export interface Picture {
  readonly mime: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const picture = (why: string): ServerError => serverError('picture_invalid', why, { hint: 'Send a PNG or JPEG of at most 2,048 pixels a side and 1.5 MB.' });

/** The size of a JPEG from its first start-of-frame marker, or undefined. */
function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1] as number;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = ((b[i + 2] as number) << 8) | (b[i + 3] as number);
    // start of frame: C0 to CF, except the table markers C4, C8 and CC
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: ((b[i + 5] as number) << 8) | (b[i + 6] as number), width: ((b[i + 7] as number) << 8) | (b[i + 8] as number) };
    }
    if (length < 2) return undefined;
    i += 2 + length;
  }
  return undefined;
}

/** Checks a picture by its magic number, its byte size and its pixel size. */
export function checkPicture(bytes: Uint8Array): Picture | ServerError {
  if (bytes.length > PICTURE_BYTES) return picture(`The picture is over ${PICTURE_BYTES} bytes.`);
  let found: Picture | undefined;
  if (bytes.length >= 24 && PNG.every((v, i) => bytes[i] === v)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    found = { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const size = jpegSize(bytes);
    if (size !== undefined) found = { mime: 'image/jpeg', ...size };
  }
  if (found === undefined) return picture('The picture is not a PNG or a JPEG.');
  if (found.width < 1 || found.height < 1 || found.width > PICTURE_SIDE || found.height > PICTURE_SIDE) {
    return picture(`The picture is ${found.width} by ${found.height} pixels; at most ${PICTURE_SIDE} a side.`);
  }
  return found;
}

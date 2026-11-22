/**
 * Body, picture and text limits (server design 7, errors.md `payload_too_large`, `picture_invalid`, `bad_request`;
 * requirements R5.1): the limits are the documented numbers; a request over them gets the documented status and error.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { BODY_LIMIT, BODY_LIMIT_PICTURE, PICTURE_BYTES, PICTURE_SIDE, STATUS, checkPicture, isServerError, parseJsonObject } from '../../src/index';
import { ask, errorBody, postJson, start } from './helpers';
import type { Running } from './helpers';

/* ----------------------------- picture builders ---------------------------- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function chunk(type: string, data: number[]): number[] {
  const body = [...ascii(type), ...data];
  return [...u32(data.length), ...body, ...u32(crc32(Uint8Array.from(body)))];
}

/** A PNG of `width` x `height` as the header says it, with a tiny valid IDAT and IEND, padded to `size` bytes when given. */
function png(width: number, height: number, size?: number): Uint8Array {
  const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = chunk('IHDR', [...u32(width), ...u32(height), 8, 6, 0, 0, 0]);
  const idat = chunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const iend = chunk('IEND', []);
  const bytes = [...head, ...ihdr, ...idat, ...iend];
  if (size === undefined || size <= bytes.length) return Uint8Array.from(bytes);
  const pad = new Uint8Array(size);
  pad.set(bytes.slice(0, 33));
  return pad;
}

/** A JPEG whose start-of-frame says `width` x `height`. */
function jpeg(width: number, height: number, size?: number): Uint8Array {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const eoi = [0xff, 0xd9];
  const bytes = [...soi, ...app0, ...sof0, ...eoi];
  if (size === undefined || size <= bytes.length) return Uint8Array.from(bytes);
  const pad = new Uint8Array(size);
  pad.set(bytes.slice(0, bytes.length - 2));
  return pad;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('the documented numbers (design 7 table)', () => {
  it('request body: 256 KB without a picture, 2 MB with one', () => {
    expect(BODY_LIMIT).toBe(256 * 1024);
    expect(BODY_LIMIT_PICTURE).toBe(2 * 1024 * 1024);
  });

  it('picture: at most 1.5 MB and 2,048 px a side', () => {
    expect(PICTURE_BYTES).toBe(1.5 * 1024 * 1024);
    expect(PICTURE_SIDE).toBe(2048);
  });

  it('the statuses of errors.md', () => {
    expect(STATUS.bad_request).toBe(400);
    expect(STATUS.payload_too_large).toBe(413);
    expect(STATUS.picture_invalid).toBe(400);
    expect(STATUS.origin_blocked).toBe(403);
    expect(STATUS.rate_limited).toBe(429);
    expect(STATUS.daily_budget).toBe(429);
    expect(STATUS.model_unavailable).toBe(503);
    expect(STATUS.model_busy).toBe(503);
    expect(STATUS.not_found).toBe(404);
    expect(STATUS.internal).toBe(500);
  });
});

describe('a picture is PNG or JPEG by its magic number (design 7)', () => {
  it('reads a PNG and its size', () => {
    expect(checkPicture(png(100, 50))).toEqual({ mime: 'image/png', width: 100, height: 50 });
  });

  it('reads a JPEG and its size', () => {
    expect(checkPicture(jpeg(640, 480))).toEqual({ mime: 'image/jpeg', width: 640, height: 480 });
  });

  it('2,048 px a side is allowed, 2,049 is not (PNG, both sides)', () => {
    expect(isServerError(checkPicture(png(2048, 2048)))).toBe(false);
    for (const [w, h] of [[2049, 10], [10, 2049], [5000, 5000]] as const) {
      const e = checkPicture(png(w, h));
      expect(isServerError(e), `${w}x${h}`).toBe(true);
      expect(e).toMatchObject({ ok: false, kind: 'picture_invalid' });
    }
  });

  it('2,048 px a side is allowed, 2,049 is not (JPEG, both sides)', () => {
    expect(isServerError(checkPicture(jpeg(2048, 2048)))).toBe(false);
    for (const [w, h] of [[2049, 10], [10, 2049]] as const) {
      expect(checkPicture(jpeg(w, h)), `${w}x${h}`).toMatchObject({ ok: false, kind: 'picture_invalid' });
    }
  });

  const notPictures: readonly [string, Uint8Array][] = [
    ['a GIF', text('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;'.padEnd(40, ' '))],
    ['a WebP', Uint8Array.from([...text('RIFF'), 0, 0, 0, 0, ...text('WEBPVP8 '), ...new Array(30).fill(0)])],
    ['a BMP', Uint8Array.from([0x42, 0x4d, ...new Array(60).fill(0)])],
    ['a PDF', text('%PDF-1.7\n'.padEnd(60, ' '))],
    ['text', text('this is not a picture at all, it is a sentence of text')],
    ['an SVG', text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')],
    ['an HTML page', text('<html><script>alert(1)</script></html>')],
    ['no bytes', new Uint8Array(0)],
    ['one byte', Uint8Array.from([0x89])],
    ['a PNG signature and nothing more', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['a JPEG start marker and nothing more', Uint8Array.from([0xff, 0xd8, 0xff])],
    ['a wrong PNG signature (one byte off)', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b, ...new Array(30).fill(0)])],
  ];
  for (const [name, bytes] of notPictures) {
    it(`${name} is picture_invalid`, () => {
      const r = checkPicture(bytes);
      expect(isServerError(r)).toBe(true);
      expect(r).toMatchObject({ ok: false, kind: 'picture_invalid' });
      expect((r as { message: string }).message.length).toBeGreaterThan(5);
    });
  }

  it('the name of the file or a claimed type does not matter: bytes decide (a PNG sent as anything is a PNG)', () => {
    expect(checkPicture(png(8, 8))).toMatchObject({ mime: 'image/png' });
  });

  it('exactly 1.5 MB is allowed', () => {
    expect(isServerError(checkPicture(png(100, 100, PICTURE_BYTES)))).toBe(false);
  });

  it('one byte over 1.5 MB is payload_too_large (errors.md: "Over the body, picture or text limits")', () => {
    const e = checkPicture(png(100, 100, PICTURE_BYTES + 1));
    expect(e).toMatchObject({ ok: false, kind: 'payload_too_large' });
  });

  it('a picture too large in pixels is picture_invalid, not payload_too_large (errors.md)', () => {
    expect(checkPicture(jpeg(4000, 3000))).toMatchObject({ kind: 'picture_invalid' });
  });

  it('never throws on bytes of any shape', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).fill(n);
      expect(() => checkPicture(bytes)).not.toThrow();
      expect(() => checkPicture(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...bytes]))).not.toThrow();
      expect(() => checkPicture(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...bytes]))).not.toThrow();
    }
  });
});

describe('JSON bodies (errors.md `bad_request`)', () => {
  it('a JSON object parses', () => {
    const r = parseJsonObject(text('{"lines":["a = 1"]}'));
    expect(r).toEqual({ ok: true, value: { lines: ['a = 1'] } });
  });

  const bad: readonly [string, string][] = [
    ['not JSON', 'this is not json'],
    ['empty', ''],
    ['cut off', '{"lines": ["a = 1"'],
    ['a list', '["a = 1"]'],
    ['a string', '"a = 1"'],
    ['a number', '42'],
    ['null', 'null'],
    ['a trailing comma', '{"a":1,}'],
  ];
  for (const [name, body] of bad) {
    it(`${name}: bad_request`, () => {
      const r = parseJsonObject(text(body));
      expect(r).toMatchObject({ ok: false, kind: 'bad_request' });
    });
  }
});

describe('over HTTP: 413 and 400 (R5.1)', () => {
  const pad = (bytes: number): string => JSON.stringify({ lines: ['a = 1'], pad: 'x'.repeat(bytes) });
  const holder: { run?: Running } = {};

  const server = async (): Promise<Running> => (holder.run ??= await start({}));

  it('a body over 256 KB is 413 payload_too_large, and the message names the limit', async () => {
    const run = await server();
    const r = await ask(run.port, { method: 'POST', path: '/v1/check', body: pad(BODY_LIMIT + 10), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(413);
    const e = errorBody(r);
    expect(e.kind).toBe('payload_too_large');
    expect(e.message).toMatch(/256|limit|large/i);
  });

  it('an oversized body sent in chunks with no content-length is 413 too', async () => {
    const run = await server();
    const r = await ask(run.port, { method: 'POST', path: '/v1/check', body: pad(BODY_LIMIT + 50_000), chunked: true, headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(413);
    expect(errorBody(r).kind).toBe('payload_too_large');
  });

  it('a body of 200 KB is not too large', async () => {
    const run = await server();
    const r = await ask(run.port, { method: 'POST', path: '/v1/check', body: pad(200 * 1024), headers: { 'content-type': 'application/json' } });
    expect(r.status).not.toBe(413);
  });

  it('a very large body (10 MB) is refused and the server keeps serving', async () => {
    const run = await server();
    const r = await ask(run.port, { method: 'POST', path: '/v1/check', body: pad(10 * 1024 * 1024), chunked: true, headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(413);
    const after = await ask(run.port, { path: '/v1/health' });
    expect(after.status).toBe(200);
  });

  it('a body that is not JSON is 400 bad_request', async () => {
    const run = await server();
    const r = await ask(run.port, { method: 'POST', path: '/v1/check', body: 'not json', headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(400);
    expect(errorBody(r).kind).toBe('bad_request');
  });

  it('a JSON body that is not an object is 400 bad_request', async () => {
    const run = await server();
    const r = await postJson(run.port, '/v1/check', ['a = 1']);
    expect(r.status).toBe(400);
    expect(errorBody(r).kind).toBe('bad_request');
  });

  it('an error body is JSON in the SDK shape: ok false, kind, message', async () => {
    const run = await server();
    const r = await ask(run.port, { method: 'POST', path: '/v1/check', body: 'x' });
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(errorBody(r)).every((k) => ['ok', 'kind', 'message', 'hint', 'detail'].includes(k))).toBe(true);
  });

  afterAll(async () => {
    await holder.run?.close();
  });
});

describe('text and picture limits that need a model route (design 7)', () => {
  it('typed text over 4,000 characters on /v1/figure/draw is 413 payload_too_large (design 7; errors.md: 413 over the text limit)', async () => {
    const run = await start({});
    try {
      const r = await postJson(run.port, '/v1/figure/draw', { request: 'x'.repeat(4001), mode: 'geometry', script: '', figure: null, before: '', after: '' });
      expect(r.status).toBe(413);
      expect(errorBody(r).kind).toBe('payload_too_large');
    } finally {
      await run.close();
    }
  });

  it.todo('a request with a picture may be 2 MB, one without 256 KB (the picture routes come in round 3)');
  it.todo('a picture field that is not PNG or JPEG is 400 picture_invalid (the picture routes come in round 3)');
  it('a script over the script limit on /v1/figure/draw is refused (400 bad_request or 413 payload_too_large: the docs name no status)', async () => {
    const run = await start({});
    try {
      const r = await postJson(run.port, '/v1/figure/draw', { request: 'a circle', mode: 'geometry', script: 'a = 1\n'.repeat(12_000), figure: null, before: '', after: '' });
      expect([400, 413]).toContain(r.status);
      expect(['bad_request', 'payload_too_large']).toContain(errorBody(r).kind);
    } finally {
      await run.close();
    }
  });

});

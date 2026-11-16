/** Frames (.kiro/specs/sdk R3; embed-files-export design 3.7, errors 2). */
import { describe, expect, it } from 'vitest';
import { FRAME_LIMITS, connectApp, createHeadlessApp, serveApp } from '../../src/index';
import type { ApiError, AppEvent, MessageHost, MessageLike, MessageTarget } from '../../src/index';

const PAGE = 'https://school.example';
const FRAME = 'https://figures.example';

/** A page and a frame that talk by `postMessage`, with structured copies and their own origins. */
function windows(): { page: MessageHost; frame: MessageHost; pageWin: MessageTarget; frameWin: MessageTarget; inject(e: MessageLike): void; injectPage(e: MessageLike): void } {
  const pageL = new Set<(e: MessageLike) => void>();
  const frameL = new Set<(e: MessageLike) => void>();
  const host = (set: Set<(e: MessageLike) => void>): MessageHost => ({ addEventListener: (_t, fn) => void set.add(fn), removeEventListener: (_t, fn) => void set.delete(fn) });
  const pageWin: MessageTarget = {
    postMessage: (msg, origin) => {
      if (origin !== PAGE && origin !== '*') return;
      queueMicrotask(() => pageL.forEach((f) => f({ data: structuredClone(msg), origin: FRAME, source: frameWin })));
    },
  };
  const frameWin: MessageTarget = {
    postMessage: (msg, origin) => {
      if (origin !== FRAME && origin !== '*') return;
      queueMicrotask(() => frameL.forEach((f) => f({ data: structuredClone(msg), origin: PAGE, source: pageWin })));
    },
  };
  return { page: host(pageL), frame: host(frameL), pageWin, frameWin, inject: (e) => frameL.forEach((f) => f(e)), injectPage: (e) => pageL.forEach((f) => f(e)) };
}

function setup(script = 'a = 1') {
  const w = windows();
  const app = createHeadlessApp({ script });
  const served = serveApp(app, { host: w.frame, selfOrigin: FRAME, allowOrigins: [PAGE] });
  const client = connectApp(w.frameWin, { origin: FRAME, host: w.page, timeoutMs: 200 });
  return { w, app, served, client };
}

describe('the embed API across a frame (R3.1)', () => {
  it('every method is a promise with the same answer', async () => {
    const { client } = setup('a = 1\nb = a * 3');
    expect(await client.value('b')).toBe(3);
    const [r] = await client.run('c = b + 1');
    expect(r).toMatchObject({ ok: true, name: 'c', created: ['c'] });
    expect(await client.set('a', 2)).toMatchObject({ ok: true });
    expect(await client.value('c')).toBe(7);
    expect(await client.exists('nope')).toBe(false);
    expect((await client.list()).map((o) => o.name)).toEqual(['a', 'b', 'c']);
    expect(await client.toScript()).toContain('c = b + 1');
    expect(await client.view.get()).toMatchObject({ widthPx: 800 });
    expect(await client.set('b', 1)).toMatchObject({ ok: false, area: 'api', kind: 'not_free' });
  });

  it('events reach the page per subscription, and stop on unsubscribe', async () => {
    const { client, app } = setup('a = 1');
    const got: AppEvent[] = [];
    const off = await client.on('added', (e) => got.push(e));
    await client.run('k = 5');
    app.flushEvents();
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toMatchObject([{ type: 'added', name: 'k', source: 'api' }]);
    off();
    await new Promise((r) => setTimeout(r, 5));
    await client.run('m = 6');
    app.flushEvents();
    await new Promise((r) => setTimeout(r, 5));
    expect(got).toHaveLength(1);
  });

  it('a file goes across as plain data', async () => {
    const { client } = setup('A = (1, 2)');
    const f = await client.save();
    expect(f.script).toContain('A = (1, 2)');
    const r = await client.load({ ...f, script: '# incantly 1 mode=graphing\nB = (5, 6)' });
    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(await client.value('B')).toEqual({ x: 5, y: 6 });
  });
});

describe('safety (R3.2)', () => {
  it('a message from another origin is dropped and reported once', async () => {
    const { w, app } = setup();
    const errors: string[] = [];
    app.on('error', (e) => errors.push(e.error.kind));
    let answered = false;
    const evil: MessageTarget = { postMessage: () => void (answered = true) };
    for (let i = 0; i < 3; i++) w.inject({ data: { v: 1, id: i, method: 'run', params: ['x9 = 1'] }, origin: 'https://evil.example', source: evil });
    app.flushEvents();
    await new Promise((r) => setTimeout(r, 5));
    expect(answered).toBe(false);
    expect(app.exists('x9')).toBe(false);
    expect(errors).toEqual(['origin_blocked']);
  });

  it('unknown methods, versions and big messages are refused; nothing runs', async () => {
    const { client, app } = setup();
    await expect(client.call('eval', 'alert(1)')).rejects.toMatchObject({ area: 'frame', kind: 'unknown_method' });
    await expect(client.call('constructor')).rejects.toMatchObject({ kind: 'unknown_method' });
    await expect(client.call('run', 'x'.repeat(FRAME_LIMITS.bytes + 10))).rejects.toMatchObject({ kind: 'payload_too_large' });
    const w = windows();
    serveApp(app, { host: w.frame, selfOrigin: FRAME, allowOrigins: [PAGE] });
    const answers: unknown[] = [];
    w.page.addEventListener('message', (e) => answers.push(e.data));
    w.frameWin.postMessage({ v: 9, id: 1, method: 'run', params: ['q = 1'] }, FRAME);
    await new Promise((r) => setTimeout(r, 5));
    expect(answers).toMatchObject([{ id: 1, error: { kind: 'protocol_version', detail: { supported: [1] } } }]);
    expect(app.exists('q')).toBe(false);
  });

  it('more than 200 calls a second are rate_limited with retryAfterMs', async () => {
    const w = windows();
    const app = createHeadlessApp();
    let now = 0;
    serveApp(app, { host: w.frame, selfOrigin: FRAME, allowOrigins: [PAGE], now: () => now });
    const client = connectApp(w.frameWin, { origin: FRAME, host: w.page, timeoutMs: 500 });
    const calls = Array.from({ length: 201 }, () => client.call('exists', 'a').then(() => 'ok', (e: ApiError) => e.kind));
    const out = await Promise.all(calls);
    expect(out.filter((x) => x === 'ok')).toHaveLength(200);
    expect(out.at(-1)).toBe('rate_limited');
    now = 1500;
    expect(await client.call('exists', 'a')).toBe(false);
  });

  it('the page ignores answers from anywhere but the frame', async () => {
    const w = windows();
    const client = connectApp(w.frameWin, { origin: FRAME, host: w.page, timeoutMs: 50 });
    const p = client.call('exists', 'a');
    // forged answers: the right origin from another window, and the frame's window with another origin
    w.injectPage({ data: { v: 1, id: 1, result: true }, origin: FRAME, source: {} });
    w.injectPage({ data: { v: 1, id: 1, result: true }, origin: 'https://evil.example', source: w.frameWin });
    await expect(p).rejects.toMatchObject({ kind: 'timeout', detail: { method: 'exists', timeoutMs: 50 } });
  });

  it('a removed frame is frame_gone, also for waiting calls', async () => {
    const w = windows();
    const element = { isConnected: true };
    const client = connectApp(w.frameWin, { origin: FRAME, host: w.page, element, timeoutMs: 1000 });
    const waiting = client.call('exists', 'a');
    client.close();
    await expect(waiting).rejects.toMatchObject({ kind: 'frame_gone' });
    const c2 = connectApp(w.frameWin, { origin: FRAME, host: w.page, element });
    element.isConnected = false;
    await expect(c2.call('exists', 'a')).rejects.toMatchObject({ kind: 'frame_gone' });
  });

  it('connectApp needs the exact origin', () => {
    const w = windows();
    expect(() => connectApp(w.frameWin, { origin: '*' })).toThrow(TypeError);
  });
});

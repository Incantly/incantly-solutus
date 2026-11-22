/**
 * The routes of round 1 over real HTTP on 127.0.0.1 (server design 1, 6, 7; errors.md; requirements R1.4, R2.4, R5.2, R6):
 * `/v1/health`, `/v1/check`, 404, CORS and origins, `internal`, and the bind address. No model endpoint exists in round 1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MODE_IDS } from '@incantly/modes';
import { createHeadlessApp } from '@incantly/sdk';
import { drawTool, figureTarget } from '@incantly/teacher';
import { ROUTES, createServer } from '../../src/index';
import { SECRET_KEY, addRoutes, ask, errorBody, getJson, postJson, settingsOf, start } from './helpers';
import type { Running } from './helpers';

const ORIGIN = 'http://127.0.0.1:5173';

describe('GET /v1/health (design 3, R2.4)', () => {
  const runs: Running[] = [];
  afterAll(async () => {
    for (const r of runs) await r.close();
  });
  const up = async (env: Record<string, string> = {}): Promise<Running> => {
    const r = await start(env);
    runs.push(r);
    return r;
  };

  it('answers 200 with JSON', async () => {
    const run = await up();
    const r = await getJson(run.port, '/v1/health');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(typeof r.json).toBe('object');
  });

  it('lists the provider', async () => {
    const run = await up();
    expect(JSON.stringify((await getJson(run.port, '/v1/health')).json)).toContain('openrouter');
    const muse = await up({ MODEL_PROVIDER: 'muse' });
    expect(JSON.stringify((await getJson(muse.port, '/v1/health')).json)).toContain('muse');
  });

  it('lists the model ids: text, vision and speech', async () => {
    const run = await up({ OPENROUTER_TEXT_MODELS: 'aa/one:free,bb/two:free', OPENROUTER_VISION_MODELS: 'cc/three:free', OPENROUTER_SPEECH_MODELS: 'dd/four:free' });
    const text = (await getJson(run.port, '/v1/health')).text;
    for (const id of ['aa/one:free', 'bb/two:free', 'cc/three:free', 'dd/four:free']) expect(text, id).toContain(id);
  });

  it('says whether a key is set as true or false, and nothing else about it', async () => {
    const none = await up();
    const keyed = await up({ OPENROUTER_API_KEY: SECRET_KEY });
    const a = (await getJson(none.port, '/v1/health')).json;
    const b = (await getJson(keyed.port, '/v1/health')).json;
    const flat = (v: unknown, path = ''): [string, unknown][] =>
      typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => flat(x, `${path}.${k}`)) : [[path, v]];
    const fa = new Map(flat(a));
    const diffs = flat(b).filter(([k, v]) => fa.get(k) !== v);
    expect(diffs.length).toBeGreaterThan(0);
    for (const [path, value] of diffs) expect(typeof value, path).toBe('boolean');
    expect(diffs.some(([, v]) => v === true)).toBe(true);
  });

  it('never shows a key: not in the body, not in a header, not with a key in either provider slot', async () => {
    const run = await up({ OPENROUTER_API_KEY: SECRET_KEY, MUSE_API_KEY: SECRET_KEY });
    const r = await getJson(run.port, '/v1/health');
    expect(r.text).not.toContain('TESTONLY');
    expect(JSON.stringify(r.headers)).not.toContain('TESTONLY');
    expect(r.text).not.toMatch(/sk-or/i);
  });

  it('does not change anything: two answers are equal', async () => {
    const run = await up();
    const a = (await getJson(run.port, '/v1/health')).text;
    const b = (await getJson(run.port, '/v1/health')).text;
    expect(b).toBe(a);
  });

  it('works with no key (a missing key does not stop the server, R1.4)', async () => {
    const run = await up();
    expect((await getJson(run.port, '/v1/health')).status).toBe(200);
  });
});

describe('POST /v1/check (R2.4, R1.4)', () => {
  const holder: { run?: Running } = {};
  beforeAll(async () => {
    holder.run = await start({});
  });
  afterAll(async () => {
    await holder.run?.close();
  });
  const port = (): number => (holder.run as Running).port;

  const linesOf = (r: { json: unknown }): Record<string, unknown>[] => {
    const j = r.json as { lines?: Record<string, unknown>[] };
    if (!Array.isArray(j.lines)) throw new Error('no "lines" in the answer');
    return j.lines;
  };

  it('works with no key and no model: the per-line results of the kernel', async () => {
    const r = await postJson(port(), '/v1/check', { lines: ['a = 1', 'b = (', 'c = a + 1'], mode: 'graphing' });
    expect(r.status).toBe(200);
    const rows = linesOf(r);
    expect(rows.map((x) => x['ok'])).toEqual([true, false, true]);
    expect(rows[0]).toMatchObject({ name: 'a' });
    expect(rows[1]).toMatchObject({ ok: false, committed: false, kind: expect.any(String), code: expect.any(String), line: 2 });
  });

  it('gives the lines as `draw` gives them: the same objects for the same lines', async () => {
    const lines = ['a = 1', 'b = (', 'c = a + 1', 'd = zzz + 1'];
    const r = await postJson(port(), '/v1/check', { lines, mode: 'graphing' });
    const app = createHeadlessApp({ mode: 'graphing' });
    const target = figureTarget(app);
    const out = drawTool.run(target, { lines });
    if (!out.ok) throw new Error('draw failed');
    const drawRows = (out.value as { lines: unknown[] }).lines;
    expect(linesOf(r)).toEqual(JSON.parse(JSON.stringify(drawRows)));
  });

  it('a failed line is the kernel error object unchanged', async () => {
    const r = await postJson(port(), '/v1/check', { lines: ['b = ('], mode: 'graphing' });
    const reference = createHeadlessApp({ mode: 'graphing' }).run(['b = (']);
    expect(linesOf(r)[0]).toEqual(JSON.parse(JSON.stringify(reference[0])));
  });

  it('each line runs on its own: a bad line does not stop or undo the others', async () => {
    const r = await postJson(port(), '/v1/check', { lines: ['a = 1', 'a = (', 'b = a + 1'] });
    expect(linesOf(r).map((x) => x['ok'])).toEqual([true, false, true]);
  });

  it('the figure is a headless copy: a second request starts from nothing', async () => {
    await postJson(port(), '/v1/check', { lines: ['a = 1'] });
    const r = await postJson(port(), '/v1/check', { lines: ['b = a + 1'] });
    expect(linesOf(r)[0]).toMatchObject({ ok: false });
  });

  it('a script gives the figure to check against', async () => {
    const r = await postJson(port(), '/v1/check', { lines: ['b = a + 1'], script: 'a = 2' });
    expect(linesOf(r)[0]).toMatchObject({ ok: true, name: 'b' });
  });

  it('the mode decides what the gate allows (a different mode, a different answer for the same line)', async () => {
    const line = 'c = Circle((0, 0), 1)';
    const results = new Map<string, unknown>();
    for (const mode of MODE_IDS) results.set(mode, linesOf(await postJson(port(), '/v1/check', { lines: [line], mode }))[0]?.['ok']);
    expect([...results.values()].every((x) => typeof x === 'boolean')).toBe(true);
    expect(results.get('geometry')).toBe(true);
    expect(new Set(results.values()).size).toBe(2);
  });

  it('an unknown mode is 400 bad_request and names the field', async () => {
    const r = await postJson(port(), '/v1/check', { lines: ['a = 1'], mode: 'no_such_mode' });
    expect(r.status).toBe(400);
    const e = errorBody(r);
    expect(e.kind).toBe('bad_request');
    expect(e.message).toMatch(/mode/i);
  });

  const missing: readonly [string, unknown][] = [
    ['no lines', {}],
    ['lines not a list', { lines: 'a = 1' }],
    ['an empty list', { lines: [] }],
    ['a line that is not text', { lines: ['a = 1', 5] }],
    ['a null line', { lines: [null] }],
  ];
  for (const [name, body] of missing) {
    it(`${name}: 400 bad_request that names the field "lines"`, async () => {
      const r = await postJson(port(), '/v1/check', body);
      expect(r.status).toBe(400);
      const e = errorBody(r);
      expect(e.kind).toBe('bad_request');
      expect(e.message).toContain('lines');
    });
  }

  it('100 lines are checked (server design 9: /v1/check of 100 lines)', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `v${i} = ${i}`);
    const r = await postJson(port(), '/v1/check', { lines, mode: 'graphing' });
    expect(r.status).toBe(200);
    expect(linesOf(r)).toHaveLength(100);
    expect(linesOf(r).every((x) => x['ok'] === true)).toBe(true);
  });

  it('the answer holds no key and no request text it was not asked to echo', async () => {
    const run = await start({ OPENROUTER_API_KEY: SECRET_KEY });
    try {
      const r = await postJson(run.port, '/v1/check', { lines: ['a = 1'] });
      expect(r.text).not.toContain('TESTONLY');
    } finally {
      await run.close();
    }
  });

  it('only POST: a GET is not found, and the error says so in the SDK shape', async () => {
    const r = await getJson(port(), '/v1/check');
    expect([404, 405]).toContain(r.status);
    expect(errorBody(r).ok).toBe(false);
  });
});

describe('not_found (errors.md)', () => {
  const holder: { run?: Running } = {};
  beforeAll(async () => {
    holder.run = await start({});
  });
  afterAll(async () => {
    await holder.run?.close();
  });

  it('an unknown route is 404 not_found and lists the routes', async () => {
    const r = await getJson((holder.run as Running).port, '/v1/nope');
    expect(r.status).toBe(404);
    const e = errorBody(r);
    expect(e.kind).toBe('not_found');
    expect(e.message).toContain('/v1/health');
    expect(e.message).toContain('/v1/check');
  });

  it('the root and odd paths are 404 too, and never throw', async () => {
    for (const path of ['/', '/v1', '/v1/', '/%00', '/..%2f..%2fetc%2fpasswd', '/v1/health/extra', `/${'a'.repeat(5000)}`]) {
      const r = await getJson((holder.run as Running).port, path);
      expect(r.status, path.slice(0, 40)).toBe(404);
    }
  });

  it('a path with a query string still finds the route', async () => {
    const r = await getJson((holder.run as Running).port, '/v1/health?x=1');
    expect(r.status).toBe(200);
  });

  it('the model endpoints of rounds 2 to 5 are not there yet, so they are 404 (a gap, listed in the report)', async () => {
    for (const path of ['/v1/figure/draw', '/v1/board/ask', '/v1/teach', '/v1/speech', '/v1/export/svg']) {
      const r = await postJson((holder.run as Running).port, path, {});
      expect(r.status, path).toBe(404);
    }
  });
});

describe('model endpoints with no key answer model_unavailable (R1.4)', () => {
  it.todo('POST /v1/figure/draw with no key is 503 model_unavailable "The AI is not set up." (round 2 builds the route)');
  it.todo('POST /v1/board/ask with no key is 503 model_unavailable (round 3)');
  it.todo('POST /v1/teach with no key is 503 model_unavailable (round 4)');
  it.todo('POST /v1/speech with no key is 503 model_unavailable (round 4)');
  it.todo('POST /v1/export/svg works with no key (round 5)');
});

describe('origins and CORS (R5.2, errors.md `origin_blocked`)', () => {
  const holder: { run?: Running } = {};
  beforeAll(async () => {
    holder.run = await start({ ALLOWED_ORIGINS: `${ORIGIN},https://studio.example` });
  });
  afterAll(async () => {
    await holder.run?.close();
  });
  const port = (): number => (holder.run as Running).port;

  it('a request from an origin that is not allowed is 403 origin_blocked with the documented message', async () => {
    const r = await getJson(port(), '/v1/health', { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    const e = errorBody(r);
    expect(e.kind).toBe('origin_blocked');
    expect(e.message).toBe('This site may not use the server.');
  });

  it('every route checks it, also a POST and an unknown path', async () => {
    for (const [method, path] of [['GET', '/v1/health'], ['POST', '/v1/check'], ['GET', '/v1/nope']] as const) {
      const r = await ask(port(), { method, path, headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{"lines":["a = 1"]}' } : {}) });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  it('a blocked request is not run: nothing in its body is checked', async () => {
    const r = await postJson(port(), '/v1/check', { lines: ['a = 1'] }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.text).not.toContain('"lines"');
  });

  it('look-alike origins are blocked: another port, another scheme, a suffix, a prefix, null', async () => {
    for (const origin of ['http://127.0.0.1:5174', 'https://127.0.0.1:5173', `${ORIGIN}.evil.example`, 'http://evil.example/127.0.0.1:5173', 'null', 'https://studio.example.evil.com', `${ORIGIN}/`]) {
      expect((await getJson(port(), '/v1/health', { origin })).status, origin).toBe(403);
    }
  });

  it('each allowed origin is let in and is told so in access-control-allow-origin', async () => {
    for (const origin of [ORIGIN, 'https://studio.example']) {
      const r = await getJson(port(), '/v1/health', { origin });
      expect(r.status, origin).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('a request with no Origin header is not a browser and is let in', async () => {
    const r = await getJson(port(), '/v1/health');
    expect(r.status).toBe(200);
  });

  it('the allowed answer does not open the server to every site (no wildcard)', async () => {
    const r = await getJson(port(), '/v1/health', { origin: ORIGIN });
    expect(r.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('a blocked answer carries no allow-origin header', async () => {
    const r = await getJson(port(), '/v1/health', { origin: 'https://evil.example' });
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a preflight from an allowed origin is answered without a body and names the methods and headers', async () => {
    const r = await ask(port(), {
      method: 'OPTIONS',
      path: '/v1/check',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(300);
    expect(r.text).toBe('');
    expect(r.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(String(r.headers['access-control-allow-methods'])).toMatch(/POST/);
    expect(String(r.headers['access-control-allow-headers'] ?? '').toLowerCase()).toContain('content-type');
  });

  it('a preflight from a blocked origin is 403', async () => {
    const r = await ask(port(), { method: 'OPTIONS', path: '/v1/check', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    expect(r.status).toBe(403);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('the default origins are the studio on 127.0.0.1:5173 and localhost:5173', async () => {
    const run = await start({});
    try {
      for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) expect((await getJson(run.port, '/v1/health', { origin })).status, origin).toBe(200);
      expect((await getJson(run.port, '/v1/health', { origin: 'http://localhost:3000' })).status).toBe(403);
    } finally {
      await run.close();
    }
  });
});

describe('internal (errors.md, R6) and the bind address (R5.2)', () => {
  const holder: { run?: Running; undo?: () => void } = {};
  beforeAll(async () => {
    holder.undo = addRoutes([
      {
        method: 'GET',
        path: '/v1/test/throw',
        bodyLimit: 0,
        handle: () => {
          throw new Error('secret detail sk-or-leak and C:\\private\\path');
        },
      },
      {
        method: 'POST',
        path: '/v1/test/reject',
        bodyLimit: 1024,
        handle: async () => {
          await Promise.resolve();
          throw new TypeError('async boom');
        },
      },
    ]);
    const lines: string[] = [];
    holder.run = await start({}, { log: (event, fields) => lines.push(JSON.stringify({ event, ...fields })) });
    (holder.run as unknown as { lines: string[] }).lines = lines;
  });
  afterAll(async () => {
    holder.undo?.();
    await holder.run?.close();
  });
  const port = (): number => (holder.run as Running).port;

  it('a handler that throws is 500 internal with the documented message, and the server goes on', async () => {
    const r = await getJson(port(), '/v1/test/throw');
    expect(r.status).toBe(500);
    const e = errorBody(r);
    expect(e.kind).toBe('internal');
    expect(e.message).toBe('Something went wrong in the server; nothing was changed.');
    expect((await getJson(port(), '/v1/health')).status).toBe(200);
  });

  it('an async handler that rejects is also 500 internal, not an unhandled rejection', async () => {
    const r = await postJson(port(), '/v1/test/reject', {});
    expect(r.status).toBe(500);
    expect(errorBody(r).kind).toBe('internal');
  });

  it('the answer leaks nothing of the fault: no message, no path, no stack', async () => {
    const r = await getJson(port(), '/v1/test/throw');
    expect(r.text).not.toMatch(/secret detail|sk-or|private|\bat \w+.*:\d+/);
  });

  it('the log has the fingerprint, and the answer lets the user match it', async () => {
    const r = await getJson(port(), '/v1/test/throw');
    const e = errorBody(r);
    const fp = JSON.stringify(e.detail ?? {}) + JSON.stringify(e);
    const logged = (holder.run as unknown as { lines: string[] }).lines.filter((l) => l.includes('"internal"') || l.includes('fingerprint'));
    expect(logged.length).toBeGreaterThan(0);
    const fingerprint = /"fingerprint":"([^"]+)"/.exec(logged.at(-1) ?? '')?.[1];
    expect(fingerprint).toBeDefined();
    expect(fp).toContain(fingerprint as string);
  });

  it('binds to 127.0.0.1 by default', async () => {
    const server = createServer({ settings: settingsOf({}) });
    const listening = await server.listen(0);
    try {
      expect(listening).toMatchObject({ ok: true, host: '127.0.0.1' });
    } finally {
      await server.close();
    }
  });

  it('the port may be 0 for a random port; two servers get two ports', async () => {
    const a = createServer({ settings: settingsOf({}) });
    const b = createServer({ settings: settingsOf({}) });
    const la = await a.listen(0, '127.0.0.1');
    const lb = await b.listen(0, '127.0.0.1');
    try {
      expect(la.ok && lb.ok && la.port !== lb.port).toBe(true);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('a port that is taken is config_invalid as a result, not a throw', async () => {
    const a = createServer({ settings: settingsOf({}) });
    const la = await a.listen(0, '127.0.0.1');
    if (!la.ok) throw new Error('listen');
    const b = createServer({ settings: settingsOf({}) });
    try {
      const lb = await b.listen(la.port, '127.0.0.1');
      expect(lb).toMatchObject({ ok: false, kind: 'config_invalid' });
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('close() is safe to call twice', async () => {
    const a = createServer({ settings: settingsOf({}) });
    await a.listen(0, '127.0.0.1');
    await a.close();
    await expect(a.close()).resolves.toBeUndefined();
  });

  it('the route table lists method and path of each route', () => {
    const server = createServer({ settings: settingsOf({}) });
    expect(server.routes).toEqual(expect.arrayContaining(['GET /v1/health', 'POST /v1/check']));
    expect(ROUTES.length).toBeGreaterThanOrEqual(2);
  });
});

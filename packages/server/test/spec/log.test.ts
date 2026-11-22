/**
 * The log (server design 7 "Keys", "Data"; requirements R1.3, R5.4): one JSON line per event; `authorization` and every
 * field whose name holds `key` or `token` are dropped; request bodies are not logged; a key is never in a log.
 */
import { describe, expect, it } from 'vitest';
import { createLog, scrub, silentLog } from '../../src/index';
import { SECRET_KEY, getJson, postJson, start } from './helpers';

const capture = (): { write: (s: string) => void; chunks: string[]; lines: () => Record<string, unknown>[] } => {
  const chunks: string[] = [];
  return {
    chunks,
    write: (s) => {
      chunks.push(s);
    },
    lines: () => chunks.join('').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>),
  };
};

describe('one JSON line per event (design 7)', () => {
  it('writes one line, ending in a newline, that is JSON with the event name and a time', () => {
    const out = capture();
    createLog(out, () => 1234)('request', { id: 1, method: 'GET', path: '/v1/health' });
    expect(out.chunks).toHaveLength(1);
    expect(out.chunks[0]?.endsWith('\n')).toBe(true);
    expect(out.chunks[0]?.trimEnd().includes('\n')).toBe(false);
    expect(out.lines()[0]).toMatchObject({ event: 'request', id: 1, method: 'GET', path: '/v1/health', t: 1234 });
  });

  it('time comes from the clock the caller passes', () => {
    const out = capture();
    const log = createLog(out, () => 42);
    log('a');
    log('b');
    expect(out.lines().map((l) => l['t'])).toEqual([42, 42]);
  });

  it('a log that cannot be written does not stop the request (never throws)', () => {
    const log = createLog({ write: () => { throw new Error('disk full'); } }, () => 0);
    expect(() => log('request', { id: 1 })).not.toThrow();
  });

  it('a field it cannot turn into JSON (a cycle) does not throw', () => {
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    const out = capture();
    expect(() => createLog(out, () => 0)('x', { cyc })).not.toThrow();
  });

  it('silentLog writes nothing', () => {
    expect(silentLog('anything', { a: 1 })).toBeUndefined();
  });
});

describe('fields that are dropped (R5.4, design 7)', () => {
  const dropped: readonly string[] = [
    'authorization', 'Authorization', 'AUTHORIZATION', 'key', 'apiKey', 'api_key', 'API_KEY', 'openrouterKey', 'keyId', 'token', 'accessToken', 'access_token', 'tokenCount', 'refreshToken', 'x-api-key',
  ];
  for (const name of dropped) {
    it(`"${name}" is never written`, () => {
      const out = capture();
      createLog(out, () => 0)('request', { [name]: 'VALUE-THAT-MUST-NOT-APPEAR', ok: 'kept' });
      const text = out.chunks.join('');
      expect(text).not.toContain('VALUE-THAT-MUST-NOT-APPEAR');
      expect(text).not.toContain(`"${name}"`);
      expect(text).toContain('kept');
    });
  }

  it('also inside nested objects and lists', () => {
    const out = capture();
    createLog(out, () => 0)('request', { headers: { Authorization: 'Bearer SECRET-A', host: 'x' }, list: [{ apiKey: 'SECRET-B' }, { fine: 1 }], deep: { a: { token: 'SECRET-C' } } });
    const text = out.chunks.join('');
    expect(text).not.toMatch(/SECRET-[ABC]/);
    expect(text).toContain('"host":"x"');
    expect(text).toContain('"fine":1');
  });

  it('scrub drops them the same way', () => {
    expect(scrub({ authorization: 'a', apiKey: 'b', token: 'c', n: 1 })).toEqual({ n: 1 });
  });

  it('fields that are not secrets are kept', () => {
    const out = capture();
    createLog(out, () => 0)('done', { id: 7, status: 200, ms: 12, model: 'x/y:free', kind: 'rate_limited', fingerprint: 'internal:abc' });
    expect(out.lines()[0]).toMatchObject({ id: 7, status: 200, ms: 12, model: 'x/y:free', kind: 'rate_limited', fingerprint: 'internal:abc' });
  });
});

describe('request bodies are not logged (R5.4)', () => {
  it('a field that holds a body or what a person wrote is not written', () => {
    const out = capture();
    createLog(out, () => 0)('request', { body: 'STUDENT-WORDS', text: 'STUDENT-WORDS', script: 'STUDENT-WORDS', messages: ['STUDENT-WORDS'], prompt: 'STUDENT-WORDS', lines: ['STUDENT-WORDS'], history: [{ text: 'STUDENT-WORDS' }] });
    expect(out.chunks.join('')).not.toContain('STUDENT-WORDS');
  });

  it('long text is cut, so one line cannot swallow a document', () => {
    const out = capture();
    createLog(out, () => 0)('request', { note: 'x'.repeat(10_000) });
    expect((out.chunks.join('').length)).toBeLessThan(1000);
  });
});

describe('a whole server never logs a key, a token, a header secret or a body (R1.3, R5.4)', () => {
  it('after requests of every kind, none of the secrets is in the log', async () => {
    const out = capture();
    let t = 0;
    const log = createLog(out, () => (t += 1));
    const run = await start({ OPENROUTER_API_KEY: SECRET_KEY, MUSE_API_KEY: `${SECRET_KEY}-muse` }, { log });
    try {
      const secrets = { authorization: 'Bearer BEARER-SECRET-VALUE', 'x-api-key': 'XAPIKEY-SECRET-VALUE', cookie: 'sid=COOKIE-SECRET-VALUE' };
      await getJson(run.port, '/v1/health', secrets);
      await postJson(run.port, '/v1/check', { lines: ['marker_student_line = 1', 'b = ('], script: 'marker_student_script = 2', token: 'BODYTOKEN-SECRET-VALUE', key: 'BODYKEY-SECRET-VALUE' }, secrets);
      await postJson(run.port, '/v1/check', { lines: 'bad' }, secrets);
      await getJson(run.port, '/v1/nope?token=QUERYTOKEN-SECRET-VALUE', secrets);
      await getJson(run.port, '/v1/health', { ...secrets, origin: 'https://evil.example' });
      await getJson(run.port, '/v1/check', secrets);
    } finally {
      await run.close();
    }
    const text = out.chunks.join('');
    expect(text.length).toBeGreaterThan(0);
    for (const secret of ['TESTONLY', 'BEARER-SECRET-VALUE', 'XAPIKEY-SECRET-VALUE', 'COOKIE-SECRET-VALUE', 'BODYTOKEN-SECRET-VALUE', 'BODYKEY-SECRET-VALUE', 'marker_student_line', 'marker_student_script']) {
      expect(text, secret).not.toContain(secret);
    }
    for (const line of out.lines()) {
      for (const k of Object.keys(line)) expect(k).not.toMatch(/authorization|key|token/i);
    }
  });

  it('the log of a request says what happened: an event per request with the method and the path', async () => {
    const out = capture();
    const run = await start({}, { log: createLog(out, () => 0) });
    try {
      await getJson(run.port, '/v1/health');
    } finally {
      await run.close();
    }
    expect(out.lines().some((l) => l['method'] === 'GET' && l['path'] === '/v1/health')).toBe(true);
  });

  it('a fault is logged with its fingerprint, and the log line holds no body', async () => {
    const { addRoutes } = await import('./helpers');
    const undo = addRoutes([{ method: 'POST', path: '/v1/test/log-throw', bodyLimit: 1024, handle: () => { throw new Error('boom'); } }]);
    const out = capture();
    const run = await start({}, { log: createLog(out, () => 0) });
    try {
      await postJson(run.port, '/v1/test/log-throw', { text: 'STUDENT-WORDS-IN-A-BODY' });
    } finally {
      undo();
      await run.close();
    }
    const fault = out.lines().find((l) => typeof l['fingerprint'] === 'string');
    expect(fault).toBeDefined();
    expect(String(fault?.['fingerprint'])).toMatch(/^internal/);
    expect(out.chunks.join('')).not.toContain('STUDENT-WORDS-IN-A-BODY');
  });
});

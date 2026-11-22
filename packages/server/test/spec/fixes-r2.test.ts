/**
 * Fixes of the round 2 review (handoff/teacher/review-r2.md): TR-14 a model route answers `200` NDJSON once its checks
 * pass, so a model error is the stream's last event; TR-15 the notices of a cut or repaired answer reach the writer in
 * `done`; TR-16 a request replaced by a newer one ends with `superseded`; TR-17 Tiptap shows the server's own kind and
 * message for an HTTP error; the daily budget is still a check (429) before the stream opens.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { httpTransport } from '@incantly/tiptap';
import type { AiEvent, AiRequest } from '@incantly/tiptap';
import { RateLimiter, clientFor, createLog } from '../../src/index';
import type { EnvLike, LogFn } from '../../src/index';
import { SECRET_KEY, ask, makeClock, postJson, settingsOf, start, until } from './helpers';
import type { Running } from './helpers';
import type { Answer, Call } from './r2-helpers';
import { FakeFetch, collect, controlled, hang, ok, sseOf, status, textChunk, textSse, wait } from './r2-helpers';

const running: Running[] = [];
afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

interface Boot {
  readonly run: Running;
  readonly fake: FakeFetch;
  readonly url: string;
}

async function boot(options: { env?: EnvLike; answers: (call: Call, index: number) => Answer | Promise<Answer> }): Promise<Boot> {
  const env: EnvLike = { OPENROUTER_API_KEY: SECRET_KEY, ...(options.env ?? {}) };
  const settings = settingsOf(env);
  const fake = new FakeFetch(options.answers);
  const clock = makeClock();
  const client = clientFor(settings, { fetch: fake.fetch, now: clock.now });
  const log: LogFn = createLog({ write: () => undefined }, clock.now);
  const run = await start(env, { ...(client !== undefined ? { client } : {}), log, now: clock.now });
  running.push(run);
  return { run, fake, url: `http://127.0.0.1:${run.port}` };
}

const script = (text: string): Answer => ok(textSse([text]));
const NEW_FIGURE: AiRequest = { request: 'a circle', mode: 'geometry', script: '', figure: null, before: '', after: '' };
const EDIT: AiRequest = { ...NEW_FIGURE, script: 'a = 1', figure: createHeadlessApp({ mode: 'geometry', script: 'a = 1' }).figureSummary() };
const post = (b: Boot, body: unknown) => ask(b.run.port, { method: 'POST', path: '/v1/figure/draw', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const events = (text: string): Record<string, unknown>[] =>
  text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('TR-12: text over the limit is 413', () => {
  it('a request of 4,001 characters is 413 payload_too_large, 4,000 is let through', async () => {
    const b = await boot({ answers: () => script('c = a + 1\n') });
    const big = await postJson(b.run.port, '/v1/figure/draw', { ...EDIT, request: 'x'.repeat(4001) });
    expect(big.status).toBe(413);
    expect((big.json as { kind: string }).kind).toBe('payload_too_large');
    expect((await postJson(b.run.port, '/v1/figure/draw', { ...EDIT, request: 'x'.repeat(4000) })).status).toBe(200);
  });
});

describe('TR-14: once the checks pass the answer is a stream', () => {
  it('every model busy: 200 NDJSON, the error is the only event, and Tiptap reads its kind and message', async () => {
    const b = await boot({ env: { OPENROUTER_TEXT_MODELS: 'one/first:free,two/second:free' }, answers: () => status(429, { 'retry-after': '20' }) });
    const r = await post(b, EDIT);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('application/x-ndjson');
    const all = events(r.text);
    expect(all).toHaveLength(1);
    expect((all[0]?.['error'] as { kind: string }).kind).toBe('model_busy');
    const seen = await collect(httpTransport(b.url)(EDIT, new AbortController().signal));
    expect(seen).toEqual([{ error: { kind: 'model_busy', message: expect.stringMatching(/^The AI is busy; try again in \d+ s\.$/) as string } }]);
  });

  it('the checks still answer with an HTTP status: 400 for a bad body and 429 over the minute', async () => {
    const b = await boot({ env: { RATE_PER_MINUTE: '1' }, answers: () => script('c = a + 1\n') });
    expect((await postJson(b.run.port, '/v1/figure/draw', { nope: 1 })).status).toBe(400);
    expect((await post(b, EDIT)).status).toBe(200);
    expect((await post(b, EDIT)).status).toBe(429);
  });

  it('the daily budget is a check: 429 before any stream, and no model call', async () => {
    const b = await boot({ env: { DAILY_MODEL_CALLS: '1', RATE_PER_MINUTE: '100' }, answers: () => script('c = a + 1\n') });
    expect((await post(b, EDIT)).status).toBe(200);
    const second = await post(b, EDIT);
    expect(second.status).toBe(429);
    expect((second.json as { kind: string }).kind).toBe('daily_budget');
    expect(b.fake.calls).toHaveLength(1);
  });

  it('RateLimiter.checkDailyBudget looks without taking a call', () => {
    const l = new RateLimiter({ ratePerMinute: 10, dailyModelCalls: 1 }, () => Date.UTC(2026, 10, 22, 12));
    expect(l.checkDailyBudget().ok).toBe(true);
    expect(l.checkDailyBudget().ok).toBe(true);
    expect(l.callsToday).toBe(0);
    l.takeModelCall();
    expect(l.checkDailyBudget()).toMatchObject({ ok: false, kind: 'daily_budget' });
  });
});

describe('TR-15: the notices reach the writer', () => {
  it('a cut answer ends with done and a stream_cut notice', async () => {
    const c = controlled();
    c.push(`data: ${JSON.stringify(textChunk('c = a + 1\nd = c +'))}\n\n`);
    c.end();
    const b = await boot({ answers: () => ({ kind: 'stream', body: c.body }) });
    const r = await post(b, EDIT);
    const all = events(r.text);
    const last = all[all.length - 1] as { done?: boolean; notices?: { kind: string }[] };
    expect(last.done).toBe(true);
    expect(last.notices?.map((n) => n.kind)).toEqual(['stream_cut']);
    expect(r.text).not.toContain('d = c +');
  });

  it('a whole answer with no line left out ends with a plain done', async () => {
    const b = await boot({ answers: () => script('c = a + 1\n') });
    const all = events((await post(b, EDIT)).text);
    expect(all[all.length - 1]).toEqual({ done: true });
  });

  it('Tiptap still reads the done event with notices as done', async () => {
    const b = await boot({ answers: (_c, i) => script(i === 0 ? 'c = a + 1\nbad = Nope(\n' : 'bad = Nope2(\n') });
    const seen: AiEvent[] = await collect(httpTransport(b.url)(EDIT, new AbortController().signal));
    expect(seen[seen.length - 1]).toEqual({ done: true });
  });
});

describe('TR-16: a replaced request ends with superseded', () => {
  it('the older request gets { error: { kind: "superseded" } } and no done', async () => {
    const b = await boot({ answers: (_c, i) => (i === 0 ? hang() : script('c = a + 1\n')) });
    const older = post(b, EDIT);
    expect(await until(() => b.fake.calls.length === 1)).toBe(true);
    const newer = await post(b, EDIT);
    expect(newer.status).toBe(200);
    const r = await Promise.race([older, wait(2000).then(() => 'stuck' as const)]);
    expect(r).not.toBe('stuck');
    if (typeof r === 'string') return;
    const all = events(r.text);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ error: { kind: 'superseded', message: 'A newer request replaced this one.' } });
    expect(r.text).not.toContain('"done"');
  });

  it('lines that went out before the newer request stay, and the stream then ends with superseded', async () => {
    const c = controlled();
    c.push(`data: ${JSON.stringify(textChunk('c = a + 1\n'))}\n\n`);
    const b = await boot({ answers: (_c, i) => (i === 0 ? { kind: 'stream', body: c.body } : script('d = a + 2\n')) });
    const older = post(b, EDIT);
    await wait(80);
    await post(b, EDIT);
    c.push(`data: ${JSON.stringify(textChunk('e = a + 3\n'))}\n\n`);
    const r = await Promise.race([older, wait(2000).then(() => 'stuck' as const)]);
    expect(r).not.toBe('stuck');
    if (typeof r === 'string') return;
    const all = events(r.text);
    expect(all[0]).toEqual({ lines: ['c = a + 1'] });
    expect(all[all.length - 1]).toMatchObject({ error: { kind: 'superseded' } });
    expect(r.text).not.toContain('e = a + 3');
  });
});

describe('TR-13: the finish_reason ends the reply', () => {
  it('a reply with finish_reason and usage but no [DONE] draws its lines and ends with done', async () => {
    const b = await boot({ answers: () => ok(sseOf([textChunk('c = a + 1\n')], 'none') + `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`) });
    const all = events((await post(b, EDIT)).text);
    expect(all[0]).toEqual({ lines: ['c = a + 1'] });
    expect(all[all.length - 1]).toEqual({ done: true });
  });
});

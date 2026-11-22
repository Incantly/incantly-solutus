/**
 * Lesson round 1, the three routes end to end (docs/features/lesson/design.md 7, errors.md; requirements R5; plan round 1
 * item 7; the stream rulings of handoff/teacher/review-r2.md and review-r3.md). A real server on a random port of
 * 127.0.0.1, the OpenRouter client in front of an injected fake `fetch`: nothing reaches the network.
 */
import { describe, expect, it } from 'vitest';
import { bootVoice, rawRequest, teachBody, textAndCalls } from './r4-helpers';
import type { Boot4 } from './r4-helpers';
import { calls, says, sequence } from './board-helpers';
import { finishChunk, hang, ok, sseOf, status, textChunk, usageChunk } from './r2-helpers';
import type { Answer } from './r2-helpers';
import { openStream, until } from './helpers';

const JSON_HEADERS = { 'content-type': 'application/json' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PLAN = ['Vectors', 'Adding vectors', 'Scaling', 'Matrices as moves', 'Solving systems'];
const BOARD = { items: [], more: 0, page: 'page:1' };

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly text: string;
  readonly json: Record<string, unknown> | undefined;
  /** The NDJSON lines, parsed (empty when the body is one JSON value). */
  readonly events: Record<string, unknown>[];
}

async function post(b: Pick<Boot4, 'run'>, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const raw = await rawRequest(b.run.port, path, typeof body === 'string' ? body : JSON.stringify(body), { ...JSON_HEADERS, ...headers });
  const text = Buffer.concat(raw.chunks).toString('utf8');
  const events = text.split('\n').filter((l) => l !== '').flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { status: raw.status, headers: raw.headers, text, json, events };
}

const start = (b: Boot4, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => post(b, '/v1/lesson/start', { topic: 'Linear algebra', mode: 'graphing', board: BOARD, ...over }, headers);
const turn = (b: Boot4, lessonId: string, text: string, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => post(b, '/v1/lesson/turn', { lessonId, text, board: BOARD, ...over }, headers);
const end = (b: Boot4, lessonId: string, headers: Record<string, string> = {}) => post(b, '/v1/lesson/end', { lessonId }, headers);
const begin = async (b: Boot4): Promise<string> => {
  const r = await start(b);
  expect(r.status).toBe(200);
  return (r.json as { lessonId: string }).lessonId;
};

const planAndWrite = () =>
  textAndCalls('We will learn it in five steps: vectors, adding, scaling, matrices and systems. ', [
    { name: 'lesson_plan', args: { steps: PLAN } },
    { name: 'board', args: { actions: [{ op: 'page', to: 'new', name: 'Vectors' }, { op: 'write', text: 'Vector = size + direction', at: { x: 40, y: 40 }, style: 'typed' }] } },
  ]);

/** The whole text of every model call, to look for words in. */
const bodyOfCall = (b: Boot4, i: number): string => JSON.stringify(b.fake.calls[i]?.json['messages'] ?? []);

const sayHello = { kind: 'hang' as const, text: `data: ${JSON.stringify({ id: 'g', model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello there. And more' }, finish_reason: null }] })}\n\n` };

describe('POST /v1/lesson/start (design 7)', () => {
  it('answers 200 JSON { lessonId } with a random UUID, and makes no model call', async () => {
    const b = await bootVoice();
    const r = await start(b);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(r.json ?? {})).toEqual(['lessonId']);
    expect((r.json as { lessonId: string }).lessonId).toMatch(UUID);
    expect(b.fake.calls).toHaveLength(0);
  });

  it('two lessons, two different ids', async () => {
    const b = await bootVoice();
    expect(await begin(b)).not.toBe(await begin(b));
  });

  it('topic and mode are optional', async () => {
    const b = await bootVoice();
    expect((await post(b, '/v1/lesson/start', { board: BOARD })).status).toBe(200);
  });

  it('a mode that is not a mode of the app is 400 bad_request', async () => {
    const b = await bootVoice();
    const r = await start(b, { mode: 'astrology' });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, kind: 'bad_request' });
  });

  it('a board that is not { items, more, page } is 400 bad_request', async () => {
    const b = await bootVoice();
    const r = await start(b, { board: { items: 'many' } });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, kind: 'bad_request' });
  });
});

describe('start, turn, turn, turn that ends, then nothing (design 1 and 7)', () => {
  const script = () => sequence(planAndWrite(), says('A vector is an arrow: how far, and which way. What happens if I make it twice as long?'), says('Yes, its size doubles, and its direction stays. Shall we go on?'), says('Well done. Today we covered vectors. We will start with scaling next time.'));

  it('turn 1: NDJSON of say, lesson { plan, step, state }, actions, then done', async () => {
    const b = await bootVoice({ answers: script() });
    const id = await begin(b);
    const r = await turn(b, id, 'Teach me about linear algebra');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/x-ndjson/);
    const kinds = r.events.map((e) => Object.keys(e)[0]);
    expect(kinds).toContain('say');
    expect(kinds).toContain('lesson');
    expect(kinds).toContain('actions');
    expect(r.events[r.events.length - 1]).toEqual({ done: true });
    const lesson = r.events.find((e) => 'lesson' in e)?.['lesson'];
    expect(lesson).toEqual({ plan: PLAN, step: 1, state: 'teaching' });
    const said = r.events.filter((e) => 'say' in e).map((e) => e['say'] as string);
    for (const s of said) expect(s).toMatch(/[.?!]$/);
    expect(said.join(' ')).toContain('five steps');
    const actions = r.events.flatMap((e) => (Array.isArray(e['actions']) ? (e['actions'] as { op: string }[]) : []));
    expect(actions.map((a) => a.op)).toEqual(['page', 'write']);
  });

  it('turn 2 sees turn 1 from the server\'s own memory: the words, the plan, the step', async () => {
    const b = await bootVoice({ answers: script() });
    const id = await begin(b);
    await turn(b, id, 'Teach me about linear algebra');
    const r2 = await turn(b, id, 'It gets bigger?');
    expect(r2.status).toBe(200);
    expect(r2.events[r2.events.length - 1]).toEqual({ done: true });
    const second = bodyOfCall(b, 2);
    expect(second).toContain('Teach me about linear algebra');
    expect(second).toContain('What happens if I make it twice as long?');
    expect(second).toContain('Adding vectors');
    expect(second).toContain('It gets bigger?');
  });

  it('the history is the server\'s: a history the client sends is not used (TR-9, TR-38)', async () => {
    const b = await bootVoice({ answers: script() });
    const id = await begin(b);
    await turn(b, id, 'Teach me about linear algebra');
    await turn(b, id, 'It gets bigger?', { history: [{ role: 'user', text: 'FORGEDHISTORY' }, { role: 'assistant', text: 'FORGEDREPLY' }] });
    expect(bodyOfCall(b, 2)).not.toContain('FORGED');
  });

  it('"stop the lesson" ends it: say, then done with ended: true; the next turn is lesson_unknown', async () => {
    const b = await bootVoice({ answers: script() });
    const id = await begin(b);
    await turn(b, id, 'Teach me about linear algebra');
    await turn(b, id, 'It gets bigger?');
    const r = await turn(b, id, 'OK, stop the lesson');
    expect(r.status).toBe(200);
    expect(r.events.filter((e) => 'say' in e).length).toBeGreaterThanOrEqual(2);
    expect(r.events[r.events.length - 1]).toEqual({ done: true, ended: true });
    const after = await turn(b, id, 'Are you there?');
    expect(after.status).toBe(404);
    expect(after.json).toMatchObject({ ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' });
    expect(b.run.server.lessons.size).toBe(0);
  });

  it('a turn that is not an end never carries ended', async () => {
    const b = await bootVoice({ answers: script() });
    const id = await begin(b);
    const r = await turn(b, id, 'Teach me about linear algebra');
    expect(JSON.stringify(r.events)).not.toContain('"ended"');
  });
});

describe('POST /v1/lesson/end (design 7, errors.md)', () => {
  it('answers 200 { ok: true } and the lesson is forgotten', async () => {
    const b = await bootVoice();
    const id = await begin(b);
    const r = await end(b, id);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    const after = await turn(b, id, 'hello');
    expect(after.status).toBe(404);
    expect(after.json).toMatchObject({ kind: 'lesson_unknown' });
  });

  it('a second end is 404 lesson_unknown', async () => {
    const b = await bootVoice();
    const id = await begin(b);
    await end(b, id);
    const again = await end(b, id);
    expect(again.status).toBe(404);
    expect(again.json).toMatchObject({ ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' });
  });

  it('an id the server never made is 404 lesson_unknown, for a turn and for an end', async () => {
    const b = await bootVoice();
    const ghost = '11111111-2222-4333-8444-555555555555';
    expect((await turn(b, ghost, 'hello')).status).toBe(404);
    expect((await end(b, ghost)).status).toBe(404);
    expect(b.fake.calls).toHaveLength(0);
  });

  it('a missing or empty lessonId is 400 bad_request', async () => {
    const b = await bootVoice();
    expect((await post(b, '/v1/lesson/end', {})).status).toBe(400);
    expect((await post(b, '/v1/lesson/turn', { text: 'hi', board: BOARD })).status).toBe(400);
    expect((await post(b, '/v1/lesson/turn', { lessonId: '', text: 'hi', board: BOARD })).status).toBe(400);
  });

  it('ending a lesson while its turn runs stops the model call and closes the stream', async () => {
    const b = await bootVoice({ answers: () => sayHello });
    const id = await begin(b);
    const s = await openStream(b.run.port, { method: 'POST', path: '/v1/lesson/turn', body: JSON.stringify({ lessonId: id, text: 'Teach me', board: BOARD }), headers: JSON_HEADERS });
    expect(await s.next(1500)).toBe(JSON.stringify({ say: 'Hello there.' }));
    expect((await end(b, id)).status).toBe(200);
    expect(await until(() => b.fake.calls[0]?.signal?.aborted === true, 2000)).toBe(true);
    const lines: string[] = [];
    for (let line = await s.next(2000); line !== undefined; line = await s.next(2000)) lines.push(line);
    expect(s.ended()).toBe(true);
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>).some((e) => 'done' in e)).toBe(false);
  });
});

describe('checks answer with an HTTP status; after the stream opens every error is its last event (errors.md, review-r2 TR-14)', () => {
  it('no key: /start is model_unavailable, 503, "The AI is not set up.", no lesson made and no model call (LR-5)', async () => {
    const b = await bootVoice({ key: false });
    const s = await start(b);
    expect(s.status).toBe(503);
    expect(s.json).toMatchObject({ ok: false, kind: 'model_unavailable', message: 'The AI is not set up.' });
    expect(b.run.server.lessons.size).toBe(0);
    const r = await turn(b, '11111111-2222-4333-8444-555555555555', 'Teach me');
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ ok: false, kind: 'model_unavailable', message: 'The AI is not set up.' });
    expect(b.fake.calls).toHaveLength(0);
  });

  it('no key: a bad /start body is still the 400 that names the field (the fields are read first)', async () => {
    const b = await bootVoice({ key: false });
    const s = await post(b, '/v1/lesson/start', { topic: 7, board: BOARD });
    expect(s.status).toBe(400);
  });

  it('a model that fails after the checks passed: 200, and the error is the last event of the stream', async () => {
    const b = await bootVoice({ answers: () => status(500, {}, 'upstream broke') });
    const id = await begin(b);
    const r = await turn(b, id, 'Teach me');
    expect(r.status).toBe(200);
    const last = r.events[r.events.length - 1] as { error?: { kind?: string; message?: string } };
    expect(typeof last.error?.kind).toBe('string');
    expect(typeof last.error?.message).toBe('string');
    expect(r.events.some((e) => 'done' in e)).toBe(false);
  });

  it('after a failed turn the lesson is still there and can be asked again', async () => {
    const b = await bootVoice({ answers: sequence(status(500, {}, 'upstream broke'), says('Back again. Ready?')) });
    const id = await begin(b);
    await turn(b, id, 'Teach me');
    const r = await turn(b, id, 'Teach me again');
    expect(r.status).toBe(200);
    expect(r.events[r.events.length - 1]).toEqual({ done: true });
  });

  it('a reply with finish_reason and usage but no [DONE] is a whole reply (TR-13)', async () => {
    const answer: Answer = ok(sseOf([textChunk('A vector is an arrow. Ready?'), finishChunk('stop'), usageChunk(10, 5)], 'none'));
    const b = await bootVoice({ answers: () => answer });
    const id = await begin(b);
    const r = await turn(b, id, 'Teach me');
    expect(r.events[r.events.length - 1]).toEqual({ done: true });
  });

  it('a reply cut with neither finish_reason nor [DONE] ends with done and a stream_cut notice (TR-15)', async () => {
    const cutReply: Answer = ok(sseOf([textChunk('A whole sentence. And half of an answ')], 'none'));
    const b = await bootVoice({ answers: () => cutReply });
    const id = await begin(b);
    const r = await turn(b, id, 'Teach me');
    const last = r.events[r.events.length - 1] as { done?: boolean; notices?: { kind: string }[] };
    expect(last.done).toBe(true);
    expect(last.notices?.map((n) => n.kind)).toContain('stream_cut');
  });

  it('a model that answers with words only is a valid turn (TR-28)', async () => {
    const b = await bootVoice({ answers: () => says('Yes, that is right. Shall we go on?') });
    const id = await begin(b);
    const r = await turn(b, id, 'Is it right?');
    expect(r.events).toEqual([{ say: 'Yes, that is right.' }, { say: 'Shall we go on?' }, { done: true }]);
  });

  it('a board action the board refuses is not streamed and does not end the turn', async () => {
    const b = await bootVoice({ answers: sequence(calls('board', { actions: [{ op: 'write', text: 'ok note', at: { x: 1, y: 1 } }, { op: 'banana' }] }), says('Done. Ready?')) });
    const id = await begin(b);
    const r = await turn(b, id, 'Write something');
    const sent = r.events.flatMap((e) => (Array.isArray(e['actions']) ? (e['actions'] as { op: string }[]) : []));
    expect(sent.map((a) => a.op)).toEqual(['write']);
    expect(r.events[r.events.length - 1]).toEqual({ done: true });
  });

  it('the same board action twice in an answer reaches the client once (TR-49)', async () => {
    const note = { op: 'write', text: 'Same note', at: { x: 5, y: 5 }, style: 'typed' };
    const b = await bootVoice({ answers: sequence(calls('board', { actions: [note] }), calls('board', { actions: [note] }), says('Done. Ready?')) });
    const id = await begin(b);
    const r = await turn(b, id, 'Write something');
    const sent = r.events.flatMap((e) => (Array.isArray(e['actions']) ? (e['actions'] as { text?: string }[]) : []));
    expect(sent.filter((a) => a.text === 'Same note')).toHaveLength(1);
  });
});

describe('limits of /v1/teach apply (design 7: limits and errors are those of /v1/teach)', () => {
  it('text of 4,000 characters passes; 4,001 is 413 payload_too_large before any model call', async () => {
    const b = await bootVoice({ answers: () => says('Hi. Ready?') });
    const id = await begin(b);
    expect((await turn(b, id, 'a'.repeat(4000))).status).toBe(200);
    const calls0 = b.fake.calls.length;
    const big = await turn(b, id, 'a'.repeat(4001));
    expect(big.status).toBe(413);
    expect(big.json).toMatchObject({ ok: false, kind: 'payload_too_large' });
    expect(b.fake.calls).toHaveLength(calls0);
  });

  it.each([
    ['/v1/lesson/start', () => ({ topic: 'x', board: { items: [], more: 0, page: 'page:1', pad: 'p'.repeat(300 * 1024) } })],
    ['/v1/lesson/turn', () => ({ lessonId: 'x', text: 'hi', board: { items: [], more: 0, page: 'page:1', pad: 'p'.repeat(300 * 1024) } })],
    ['/v1/lesson/end', () => ({ lessonId: 'x', pad: 'p'.repeat(300 * 1024) })],
  ])('a body over 256 KB on %s is 413 payload_too_large', async (path, make) => {
    const b = await bootVoice();
    const r = await post(b, path, make());
    expect(r.status).toBe(413);
    expect(r.json).toMatchObject({ ok: false, kind: 'payload_too_large' });
  });

  it.each([
    ['not JSON', '{nope'],
    ['an array', '[1,2]'],
  ])('%s is 400 bad_request on the three routes', async (_name, body) => {
    const b = await bootVoice();
    for (const path of ['/v1/lesson/start', '/v1/lesson/turn', '/v1/lesson/end']) {
      const r = await post(b, path, body);
      expect(r.status, path).toBe(400);
      expect(r.json, path).toMatchObject({ ok: false, kind: 'bad_request' });
    }
  });

  it.each([
    ['no text', { board: BOARD }],
    ['blank text', { text: '   ', board: BOARD }],
    ['text is a number', { text: 7, board: BOARD }],
  ])('a turn with %s is 400 bad_request and makes no model call', async (_name, extra) => {
    const b = await bootVoice();
    const id = await begin(b);
    const r = await post(b, '/v1/lesson/turn', { lessonId: id, ...extra });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, kind: 'bad_request' });
    expect(b.fake.calls).toHaveLength(0);
  });

  it('RATE_PER_MINUTE=2: requests past the minute are 429 rate_limited with retry-after and retryAfterMs, and no model call is made for them', async () => {
    const b = await bootVoice({ env: { RATE_PER_MINUTE: '2' }, answers: () => says('Hi. Ready?') });
    const id = await begin(b);
    const replies: Reply[] = [];
    for (let i = 0; i < 4; i++) replies.push(await turn(b, id, `turn ${i}`));
    const limited = replies.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThanOrEqual(1);
    const first = limited[0] as Reply;
    expect(first.json).toMatchObject({ ok: false, kind: 'rate_limited', detail: { retryAfterMs: expect.any(Number) } });
    expect(Number(first.headers['retry-after'])).toBeGreaterThan(0);
    expect(b.fake.calls.length).toBe(replies.filter((r) => r.status === 200).length);
  });

  it('DAILY_MODEL_CALLS=1: a turn of one model call uses it up and the next turn is 429 daily_budget', async () => {
    const b = await bootVoice({ env: { DAILY_MODEL_CALLS: '1' }, answers: () => says('Hi. Ready?') });
    const id = await begin(b);
    expect((await turn(b, id, 'one')).status).toBe(200);
    const next = await turn(b, id, 'two');
    expect(next.status).toBe(429);
    expect(next.json).toMatchObject({ kind: 'daily_budget', message: 'The AI has done its work for today.' });
  });

  it('a lesson has one slot: the client\'s lesson turn and its /v1/teach request do not run together', async () => {
    const b = await bootVoice({ answers: (_c, i) => (i === 0 ? sayHello : says('Newer answer.')) });
    const id = await begin(b);
    const s = await openStream(b.run.port, { method: 'POST', path: '/v1/lesson/turn', body: JSON.stringify({ lessonId: id, text: 'Teach me', board: BOARD }), headers: JSON_HEADERS });
    expect(await s.next(1500)).toBe(JSON.stringify({ say: 'Hello there.' }));
    const teach = await post(b, '/v1/teach', teachBody({ text: 'A circle.' }));
    expect(teach.status).toBe(200);
    const lines: string[] = [];
    for (let line = await s.next(2000); line !== undefined; line = await s.next(2000)) lines.push(line);
    const last = JSON.parse(lines[lines.length - 1] ?? '{}') as { error?: { kind?: string } };
    expect(last.error?.kind).toBe('superseded');
  });
});

describe('one turn at a time (errors.md lesson_busy; review-r2 TR-16 superseded)', () => {
  it('another client\'s turn while one runs is 409 lesson_busy, "The teacher is still answering.", and the running turn is untouched', async () => {
    const b = await bootVoice({ env: { TRUST_PROXY: '1' }, answers: () => sayHello });
    const id = await begin(b);
    const s = await openStream(b.run.port, { method: 'POST', path: '/v1/lesson/turn', body: JSON.stringify({ lessonId: id, text: 'Teach me', board: BOARD }), headers: JSON_HEADERS });
    expect(await s.next(1500)).toBe(JSON.stringify({ say: 'Hello there.' }));
    const other = await turn(b, id, 'I am somebody else', {}, { 'x-forwarded-for': '10.0.0.2' });
    expect(other.status).toBe(409);
    expect(other.json).toMatchObject({ ok: false, kind: 'lesson_busy', message: 'The teacher is still answering.' });
    expect(b.fake.calls).toHaveLength(1);
    expect(b.fake.calls[0]?.signal?.aborted).toBe(false);
    s.destroy();
  });

  it('the same client\'s newer turn replaces the older: the older ends with { error: { kind: "superseded" } } and no done; the newer is answered', async () => {
    const b = await bootVoice({ answers: (_c, i) => (i === 0 ? sayHello : says('Newer answer. Ready?')) });
    const id = await begin(b);
    const first = await openStream(b.run.port, { method: 'POST', path: '/v1/lesson/turn', body: JSON.stringify({ lessonId: id, text: 'Teach me', board: BOARD }), headers: JSON_HEADERS });
    expect(await first.next(1500)).toBe(JSON.stringify({ say: 'Hello there.' }));
    const newer = await turn(b, id, 'A new question');
    expect(newer.status).toBe(200);
    expect(newer.events).toEqual([{ say: 'Newer answer.' }, { say: 'Ready?' }, { done: true }]);
    const lines: string[] = [];
    for (let line = await first.next(2000); line !== undefined; line = await first.next(2000)) lines.push(line);
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[parsed.length - 1]).toMatchObject({ error: { kind: 'superseded', message: 'A newer request replaced this one.' } });
    expect(parsed.some((l) => 'done' in l)).toBe(false);
    expect(b.fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('a closed connection aborts the model call, and the learner may speak again at once', async () => {
    const b = await bootVoice({ answers: (_c, i) => (i === 0 ? hang() : says('Back. Ready?')) });
    const id = await begin(b);
    const s = await openStream(b.run.port, { method: 'POST', path: '/v1/lesson/turn', body: JSON.stringify({ lessonId: id, text: 'Teach me', board: BOARD }), headers: JSON_HEADERS });
    expect(await until(() => b.fake.calls.length === 1)).toBe(true);
    s.destroy();
    expect(await until(() => b.fake.calls[0]?.signal?.aborted === true, 2000)).toBe(true);
    const r = await turn(b, id, 'Teach me again');
    expect(r.status).toBe(200);
    expect(r.events[r.events.length - 1]).toEqual({ done: true });
  });

  it('while a turn runs, the lesson counts as one: /start of another lesson is not blocked', async () => {
    const b = await bootVoice({ answers: () => sayHello });
    const id = await begin(b);
    const s = await openStream(b.run.port, { method: 'POST', path: '/v1/lesson/turn', body: JSON.stringify({ lessonId: id, text: 'Teach me', board: BOARD }), headers: JSON_HEADERS });
    expect(await s.next(1500)).toBe(JSON.stringify({ say: 'Hello there.' }));
    expect((await start(b)).status).toBe(200);
    expect(b.run.server.lessons.size).toBe(2);
    s.destroy();
  });
});

describe('lessons the server holds (design 4, R3.3), through the routes', () => {
  it('an idle lesson (15 minutes on the server\'s clock) is lesson_unknown', async () => {
    const b = await bootVoice({ answers: () => says('Hi. Ready?') });
    const id = await begin(b);
    b.clock.advance(15 * 60_000 + 1000);
    const r = await turn(b, id, 'hello');
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ kind: 'lesson_unknown' });
  });

  it('the lesson is alive 14 minutes after its last turn', async () => {
    const b = await bootVoice({ answers: () => says('Hi. Ready?') });
    const id = await begin(b);
    b.clock.advance(14 * 60_000);
    expect((await turn(b, id, 'hello')).status).toBe(200);
    b.clock.advance(14 * 60_000);
    expect((await turn(b, id, 'hello again')).status).toBe(200);
  });
});

describe('what /start holds, what the log keeps, the numbers over many calls', () => {
  it('the topic and the mode of /start reach the lesson\'s first model call', async () => {
    const b = await bootVoice({ answers: () => says('Hi. Ready?') });
    const id = ((await start(b, { topic: 'Quokka calculus', mode: 'geometry' })).json as { lessonId: string }).lessonId;
    await turn(b, id, 'Begin');
    const body = JSON.stringify(b.fake.calls[0]?.json['messages'] ?? []);
    expect(body).toContain('Quokka calculus');
    expect(body.toLowerCase()).toContain('geometry');
  });

  it('a turn with no board, or with more than 60 items, is 400 bad_request', async () => {
    const b = await bootVoice();
    const id = await begin(b);
    expect((await post(b, '/v1/lesson/turn', { lessonId: id, text: 'hi' })).status).toBe(400);
    const items = Array.from({ length: 61 }, (_v, i) => ({ id: `shape:${i}`, kind: 'rect', box: [0, 0, 1, 1] }));
    const r = await turn(b, id, 'hi', { board: { page: 'page:1', more: 0, items } });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, kind: 'bad_request' });
    expect(b.fake.calls).toHaveLength(0);
  });

  it('the key never reaches a response or the log, and the bodies are not logged (server design 10)', async () => {
    const b = await bootVoice({ answers: sequence(planAndWrite(), says('A vector is an arrow. Ready?')) });
    const id = await begin(b);
    const r = await turn(b, id, 'LEARNERSECRETWORDS about vectors');
    await end(b, id);
    expect(b.logs.length).toBeGreaterThan(0);
    const all = `${r.text}\n${b.logs.join('\n')}`;
    expect(all).not.toContain('sk-or-v1');
    expect(b.logs.join('\n')).not.toContain('LEARNERSECRETWORDS');
    expect(b.logs.join('\n')).not.toContain('Linear algebra');
  });

  it('101 starts: 100 lessons are held and the oldest idle one is gone, over HTTP', async () => {
    const b = await bootVoice({ env: { RATE_PER_MINUTE: '100000' }, answers: () => says('Hi. Ready?') });
    const ids: string[] = [];
    for (let i = 0; i < 101; i++) {
      b.clock.advance(1000);
      ids.push(await begin(b));
    }
    expect(b.run.server.lessons.size).toBe(100);
    const first = await turn(b, ids[0] as string, 'hello');
    expect(first.status).toBe(404);
    expect(first.json).toMatchObject({ kind: 'lesson_unknown' });
    expect((await turn(b, ids[1] as string, 'hello')).status).toBe(200);
  });

  it('200 turns end the lesson: the 200th done carries ended: true, the 201st is lesson_unknown, and the memory stays small', async () => {
    const b = await bootVoice({ env: { RATE_PER_MINUTE: '100000', DAILY_MODEL_CALLS: '100000' }, answers: () => says('Next idea. Ready?') });
    const id = await begin(b);
    let last: Reply | undefined;
    let says199 = '';
    for (let i = 1; i <= 200; i++) {
      last = await turn(b, id, `turn number ${i}`);
      expect(last.status, `turn ${i}`).toBe(200);
      if (i === 199) {
        says199 = last.text;
        const held = b.run.server.lessons.check(id, 'x');
        expect('memory' in held && held.memory.turns.length).toBe(6);
        expect(Buffer.byteLength(JSON.stringify('memory' in held ? held.memory : {}))).toBeLessThan(64 * 1024);
      }
    }
    const tail = last?.events.slice(-3);
    // the server says one closing sentence before the `done` of the 200th turn, which carries ended: true (LR-4)
    expect(tail?.[tail.length - 1]).toEqual({ done: true, ended: true });
    expect(tail?.[tail.length - 2]).toEqual({ say: "That's the end of this lesson. Start a new one to go on." });
    expect(last?.events.filter((e) => 'ended' in e)).toHaveLength(1);
    // turn 199 did not end the lesson and had no such sentence
    expect(says199).not.toContain("That's the end of this lesson. Start a new one to go on.");
    const after = await turn(b, id, 'one more');
    expect(after.status).toBe(404);
    expect(after.json).toMatchObject({ kind: 'lesson_unknown' });
  }, 60_000);
});

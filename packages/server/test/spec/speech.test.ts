/**
 * `POST /v1/speech` end to end (server design 1, 3, 6, 7, errors.md; teacher design 8; requirements server R7.4 and R7.5;
 * docs/state-machines.md SV3): a real server on 127.0.0.1 (random port) with the OpenRouter voices in front of a fake
 * `fetch`. One sentence in, the audio out as it comes. No network, no real key.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SPEECH_MODELS, SKIP_MS, readSettings } from '../../src/index';
import { SECRET_KEY, ask, getJson, makeClock, postJson, until } from './helpers';
import { MP3, PCM, audio, bootVoice, openLive, rawRequest, vEmpty, vHang, vNetwork, vSilent, vStatus } from './r4-helpers';
import type { Boot4 } from './r4-helpers';
import { controlled } from './r2-helpers';
import { says } from './board-helpers';

const FISH = 'fish-audio/s2.1-pro-free:free';
const HEYGEN = 'heygen/heygen-voice-1-turbo:free';
const JSON_HEADERS = { 'content-type': 'application/json' };

const speak = (b: Pick<Boot4, 'run'>, body: unknown, headers: Record<string, string> = {}) => postJson(b.run.port, '/v1/speech', body, headers);

/** The raw bytes of a speech answer. */
async function bytes(b: Pick<Boot4, 'run'>, body: unknown): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; data: Buffer }> {
  const raw = await rawRequest(b.run.port, '/v1/speech', JSON.stringify(body), JSON_HEADERS);
  return { status: raw.status, headers: raw.headers, data: Buffer.concat(raw.chunks) };
}

describe('the routes (design 1)', () => {
  it('the server lists POST /v1/teach and POST /v1/speech', async () => {
    const b = await bootVoice();
    expect(b.run.server.routes).toEqual(expect.arrayContaining(['POST /v1/teach', 'POST /v1/speech']));
  });
});

describe('the voices and their formats (design 6, teacher design 8)', () => {
  it('the default voices are Fish first, HeyGen second, and both are free ids', () => {
    expect(DEFAULT_SPEECH_MODELS).toEqual([FISH, HEYGEN]);
    for (const id of DEFAULT_SPEECH_MODELS) expect(id.endsWith(':free')).toBe(true);
  });

  it('Fish answers MP3: the same bytes reach the client as audio/mpeg, with no x-sample-rate', async () => {
    const b = await bootVoice({ voices: () => audio(MP3) });
    const r = await bytes(b, { text: 'Take a circle of radius two.' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('audio/mpeg');
    expect(r.headers['x-sample-rate']).toBeUndefined();
    expect([...r.data]).toEqual([...MP3]);
  });

  it('what is asked of Fish: POST to the audio/speech route, the key only in the Authorization header, mp3, the sentence as input', async () => {
    const b = await bootVoice();
    await bytes(b, { text: 'Take a circle of radius two.' });
    expect(b.voice.calls).toHaveLength(1);
    const call = b.voice.calls[0];
    expect(call?.method).toBe('POST');
    expect(call?.url).toMatch(/^https:\/\/openrouter\.ai\/api\/v1\/audio\/speech$/);
    expect(call?.headers['authorization']).toBe(`Bearer ${SECRET_KEY}`);
    expect(call?.json).toMatchObject({ model: FISH, input: 'Take a circle of radius two.', response_format: 'mp3' });
    expect(call?.bodyText).not.toContain(SECRET_KEY);
    expect(call?.json['voice']).toBeUndefined();
  });

  it('delivery instructions go to Fish and only to Fish', async () => {
    const b = await bootVoice({ voices: (_c, i) => (i === 0 ? vStatus(429) : audio(PCM, { type: 'audio/pcm', headers: { 'x-sample-rate': '24000' } })) });
    await bytes(b, { text: 'Hello there.', instructions: 'Speak slowly and warmly.' });
    expect(b.voice.calls[0]?.json).toMatchObject({ model: FISH, instructions: 'Speak slowly and warmly.' });
    expect(b.voice.calls[1]?.model).toBe(HEYGEN);
    expect(b.voice.calls[1]?.json['instructions']).toBeUndefined();
  });

  it('HeyGen is asked for PCM with a named voice (OPENROUTER_SPEECH_VOICE, default bram)', async () => {
    const b = await bootVoice({ voices: (c) => (c.model === FISH ? vStatus(500) : audio(PCM, { type: 'audio/pcm' })) });
    await bytes(b, { text: 'Hello there.' });
    expect(b.voice.calls[1]?.json).toMatchObject({ model: HEYGEN, input: 'Hello there.', response_format: 'pcm', voice: 'bram' });
    const other = await bootVoice({ env: { OPENROUTER_SPEECH_VOICE: 'nadine' }, voices: (c) => (c.model === FISH ? vStatus(500) : audio(PCM, { type: 'audio/pcm' })) });
    await bytes(other, { text: 'Hello there.' });
    expect(other.voice.calls[1]?.json['voice']).toBe('nadine');
  });

  it('HeyGen answers audio/pcm and the client gets audio/pcm with x-sample-rate from the provider, and the header is exposed to the browser', async () => {
    const b = await bootVoice({ voices: (c) => (c.model === FISH ? vStatus(429) : audio(PCM, { type: 'audio/pcm', headers: { 'x-sample-rate': '16000' } })) });
    const r = await bytes(b, { text: 'Hello there.' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('audio/pcm');
    expect(r.headers['x-sample-rate']).toBe('16000');
    expect(String(r.headers['access-control-expose-headers']).toLowerCase()).toContain('x-sample-rate');
    expect([...r.data]).toEqual([...PCM]);
  });

  it('the sample rate is the provider\'s header, else the rate= of its content type, else 24,000', async () => {
    const rate = async (type: string, headers: Record<string, string>): Promise<string | string[] | undefined> => {
      const b = await bootVoice({ voices: (c) => (c.model === FISH ? vStatus(429) : audio(PCM, { type, headers })) });
      return (await bytes(b, { text: 'Hello.' })).headers['x-sample-rate'];
    };
    expect(await rate('audio/pcm', { 'x-sample-rate': '22050' })).toBe('22050');
    expect(await rate('audio/pcm;rate=16000', {})).toBe('16000');
    expect(await rate('audio/pcm', {})).toBe('24000');
  });

  it('the audio is not changed: an MP3 of 20,000 bytes in many pieces arrives whole and in order', async () => {
    const big = Uint8Array.from({ length: 20_000 }, (_v, i) => (i * 7) % 251);
    const b = await bootVoice({ voices: () => audio(big, { pieces: 9 }) });
    const r = await bytes(b, { text: 'A long sentence.' });
    expect(r.data.length).toBe(20_000);
    expect(Buffer.compare(r.data, Buffer.from(big))).toBe(0);
  });
});

describe('the audio is streamed as it comes (SV3 invariant)', () => {
  it('the first bytes are on the wire while the provider still holds the rest', async () => {
    const c = controlled();
    const b = await bootVoice({ voices: () => ({ kind: 'live', body: c.body, type: 'audio/mpeg' }) });
    c.push('\u0001\u0002\u0003');
    const live = await openLive(b.run.port, '/v1/speech', JSON.stringify({ text: 'Stream me.' }));
    expect(live.status).toBe(200);
    expect(live.headers['content-type']).toBe('audio/mpeg');
    expect(await live.waitFor(3)).toBe(true);
    expect(live.ended()).toBe(false);
    c.push('\u0004\u0005');
    expect(await live.waitFor(5)).toBe(true);
    expect(live.ended()).toBe(false);
    c.end();
    expect(await live.waitEnd()).toBe(true);
    expect([...live.received()]).toEqual([1, 2, 3, 4, 5]);
  });

  it('the head goes out with the first byte of audio, not before: while no voice has sent a byte the client has no answer at all', async () => {
    const b = await bootVoice({ voices: () => vSilent(), firstByteMs: 400 });
    let answered = false;
    const pending = openLive(b.run.port, '/v1/speech', JSON.stringify({ text: 'Wait for it.' })).then((l) => {
      answered = true;
      return l;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(answered).toBe(false);
    const live = await pending;
    // the first voice timed out and every voice was silent: the answer is an HTTP error, never a 200 with no audio
    expect(live.status).toBe(504);
  });

  it('an error after the first byte ends the response where it is: no error line is added to the audio, and the connection ends', async () => {
    const c = controlled();
    const b = await bootVoice({ voices: () => ({ kind: 'live', body: c.body }) });
    c.push('\u0001\u0002');
    const live = await openLive(b.run.port, '/v1/speech', JSON.stringify({ text: 'Cut me.' }));
    expect(await live.waitFor(2)).toBe(true);
    c.fail(new Error('the provider broke'));
    expect(await live.waitEnd(2000)).toBe(true);
    expect(live.status).toBe(200);
    expect([...live.received()]).toEqual([1, 2]);
    expect(live.received().toString('utf8')).not.toContain('error');
  });

  it('the voice stays: after its first byte the other voices are not asked, even when the stream breaks', async () => {
    const c = controlled();
    const b = await bootVoice({ voices: () => ({ kind: 'live', body: c.body }) });
    c.push('\u0009');
    const live = await openLive(b.run.port, '/v1/speech', JSON.stringify({ text: 'Stay.' }));
    expect(await live.waitFor(1)).toBe(true);
    c.fail(new Error('broke'));
    await live.waitEnd(2000);
    expect(b.voice.calls).toHaveLength(1);
  });
});

describe('fallback across the voices (design 4 and 6: 429, 5xx, a network error, no first byte)', () => {
  const heygen = audio(PCM, { type: 'audio/pcm', headers: { 'x-sample-rate': '24000' } });

  it.each([
    ['429', () => vStatus(429, { 'retry-after': '5' })],
    ['500', () => vStatus(500, {}, 'RAWPROVIDERTEXT')],
    ['503', () => vStatus(503)],
    ['a network error', () => vNetwork()],
    ['no first byte in time', () => vHang()],
    ['a body that ends with no byte', () => vEmpty()],
    ['a 200 that sends the head and then nothing', () => vSilent()],
  ])('Fish fails with %s: HeyGen answers, and the client gets its PCM', async (_name, fish) => {
    const b = await bootVoice({ voices: (c) => (c.model === FISH ? fish() : heygen), firstByteMs: 120 });
    const r = await bytes(b, { text: 'Hello there.' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('audio/pcm');
    expect([...r.data]).toEqual([...PCM]);
    expect(b.voice.models).toEqual([FISH, HEYGEN]);
    expect(r.data.toString('utf8')).not.toContain('RAWPROVIDERTEXT');
  });

  it('the first voice that answers wins: Fish answering means HeyGen is never asked', async () => {
    const b = await bootVoice();
    await bytes(b, { text: 'Hello there.' });
    expect(b.voice.models).toEqual([FISH]);
  });

  it('a voice that gave 429 is skipped for 60 s, then tried again', async () => {
    const clock = makeClock();
    const b = await bootVoice({ clock, voices: (c, i) => (c.model === FISH && i === 0 ? vStatus(429) : c.model === FISH ? audio(MP3) : heygen) });
    await bytes(b, { text: 'One.' });
    expect(b.voice.models).toEqual([FISH, HEYGEN]);
    await bytes(b, { text: 'Two.' });
    expect(b.voice.models).toEqual([FISH, HEYGEN, HEYGEN]);
    clock.advance(SKIP_MS - 1000);
    await bytes(b, { text: 'Three.' });
    expect(b.voice.models.slice(3)).toEqual([HEYGEN]);
    clock.advance(2000);
    const last = await bytes(b, { text: 'Four.' });
    expect(b.voice.models.slice(4)).toEqual([FISH]);
    expect(last.headers['content-type']).toBe('audio/mpeg');
  });

  it('the skip after a 429 is 60 s (SKIP_MS)', () => {
    expect(SKIP_MS).toBe(60_000);
  });

  it('a 500 is not skipped: the next request asks Fish again', async () => {
    const b = await bootVoice({ voices: (c, i) => (c.model === FISH && i === 0 ? vStatus(500) : c.model === FISH ? audio(MP3) : heygen) });
    await bytes(b, { text: 'One.' });
    await bytes(b, { text: 'Two.' });
    expect(b.voice.models).toEqual([FISH, HEYGEN, FISH]);
  });

  it('every voice busy (429): HTTP 503 model_busy with retry-after and retryAfterMs, and nothing was streamed', async () => {
    const b = await bootVoice({ voices: () => vStatus(429, { 'retry-after': '7' }) });
    const r = await speak(b, { text: 'Hello.' });
    expect(r.status).toBe(503);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.json).toMatchObject({ ok: false, kind: 'model_busy', detail: { retryAfterMs: expect.any(Number) } });
    expect((r.json as { message: string }).message).toMatch(/^The AI is busy; try again in \d+ s\.$/);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('no first byte from any voice: HTTP 504 model_timeout "The AI took too long."', async () => {
    const b = await bootVoice({ voices: () => vHang(), firstByteMs: 60 });
    const r = await speak(b, { text: 'Hello.' });
    expect(r.status).toBe(504);
    expect(r.json).toMatchObject({ ok: false, kind: 'model_timeout', message: 'The AI took too long.' });
  });

  it('a mix of failures (500 and a network error) is HTTP 503 model_unavailable', async () => {
    const b = await bootVoice({ voices: (c) => (c.model === FISH ? vStatus(500) : vNetwork()) });
    const r = await speak(b, { text: 'Hello.' });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ ok: false, kind: 'model_unavailable' });
  });

  it('no key: HTTP 503 model_unavailable "The AI is not set up." and no call is made', async () => {
    const b = await bootVoice({ key: false });
    const r = await speak(b, { text: 'Hello.' });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ ok: false, kind: 'model_unavailable', message: 'The AI is not set up.' });
    expect(b.voice.calls).toHaveLength(0);
  });

  it('no provider text and no key in any error answer, and none in the log', async () => {
    const b = await bootVoice({ voices: () => vStatus(500, {}, `RAWPROVIDERTEXT ${SECRET_KEY}`) });
    const r = await speak(b, { text: 'PRIVATESENTENCE-55 is said.' });
    for (const text of [r.text, b.logs.join('')]) {
      expect(text).not.toContain('RAWPROVIDERTEXT');
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain('PRIVATESENTENCE-55');
    }
  });

  it('a voice that answers with JSON (a provider error with status 200) is a failure that passes on', async () => {
    const b = await bootVoice({ voices: (c) => (c.model === FISH ? audio(new TextEncoder().encode('{"error":"nope"}'), { type: 'application/json' }) : heygen) });
    const r = await bytes(b, { text: 'Hello.' });
    expect(r.headers['content-type']).toBe('audio/pcm');
    expect(b.voice.models).toEqual([FISH, HEYGEN]);
  });
});

describe('what a request may hold (design 6 and 7: one sentence of at most 500 characters)', () => {
  it('500 characters are spoken; 501 are 413 payload_too_large and no voice is asked', async () => {
    const b = await bootVoice();
    expect((await speak(b, { text: 'a'.repeat(500) })).status).toBe(200);
    const calls = b.voice.calls.length;
    const big = await speak(b, { text: 'a'.repeat(501) });
    expect(big.status).toBe(413);
    expect(big.json).toMatchObject({ ok: false, kind: 'payload_too_large' });
    expect((big.json as { message: string }).message).toContain('500');
    expect(b.voice.calls).toHaveLength(calls);
  });

  it('instructions: 200 characters pass, 201 are 413, and a non-text value is 400', async () => {
    const b = await bootVoice();
    expect((await speak(b, { text: 'Hi.', instructions: 'x'.repeat(200) })).status).toBe(200);
    expect((await speak(b, { text: 'Hi.', instructions: 'x'.repeat(201) })).status).toBe(413);
    expect((await speak(b, { text: 'Hi.', instructions: 5 })).status).toBe(400);
  });

  it.each([
    ['no text', {}],
    ['text that is a number', { text: 5 }],
    ['text that is blank', { text: '   ' }],
    ['text that is empty', { text: '' }],
    ['text as a list', { text: ['a'] }],
  ])('%s: 400 bad_request that names the field, and no voice is asked', async (_name, body) => {
    const b = await bootVoice();
    const r = await speak(b, body);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ ok: false, kind: 'bad_request' });
    expect((r.json as { message: string }).message).toContain('text');
    expect(b.voice.calls).toHaveLength(0);
  });

  it('a body that is not JSON is 400, and a body over 16 KB is 413', async () => {
    const b = await bootVoice();
    const bad = await ask(b.run.port, { method: 'POST', path: '/v1/speech', body: '{"text": ', headers: JSON_HEADERS });
    expect(bad.status).toBe(400);
    expect(bad.json).toMatchObject({ kind: 'bad_request' });
    const huge = await ask(b.run.port, { method: 'POST', path: '/v1/speech', body: JSON.stringify({ text: 'Hi.', instructions: 'x'.repeat(200), pad: 'y'.repeat(17 * 1024) }), headers: JSON_HEADERS });
    expect(huge.status).toBe(413);
  });

  it('a GET is refused, and a browser origin that is not allowed is 403 origin_blocked', async () => {
    const b = await bootVoice();
    expect((await ask(b.run.port, { path: '/v1/speech' })).status).toBeGreaterThanOrEqual(400);
    const blocked = await speak(b, { text: 'Hi.' }, { origin: 'https://evil.example' });
    expect(blocked.status).toBe(403);
    expect(blocked.json).toMatchObject({ kind: 'origin_blocked' });
    expect(b.voice.calls).toHaveLength(0);
    const allowed = await speak(b, { text: 'Hi.' }, { origin: 'http://localhost:5173' });
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('the sentence reaches the voice as it was sent (no text of ours added)', async () => {
    const b = await bootVoice();
    await speak(b, { text: 'Is x = 2.5 here, e.g. now?' });
    expect(b.voice.calls[0]?.json['input']).toBe('Is x = 2.5 here, e.g. now?');
  });
});

describe('limits: a speech request counts one tenth, takes no model slot, uses no model call of the day (design 6)', () => {
  it('RATE_PER_MINUTE=1: ten sentences fit in the minute, the eleventh is 429 rate_limited with retry-after and retryAfterMs', async () => {
    const b = await bootVoice({ env: { RATE_PER_MINUTE: '1' } });
    for (let i = 0; i < 10; i++) expect((await speak(b, { text: `Sentence ${i}.` })).status, `request ${i + 1}`).toBe(200);
    const calls = b.voice.calls.length;
    const over = await speak(b, { text: 'One too many.' });
    expect(over.status).toBe(429);
    expect(over.json).toMatchObject({ ok: false, kind: 'rate_limited', detail: { retryAfterMs: expect.any(Number) } });
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect(b.voice.calls).toHaveLength(calls);
  });

  it('after the minute the client may ask again', async () => {
    const b = await bootVoice({ env: { RATE_PER_MINUTE: '1' } });
    for (let i = 0; i < 10; i++) await speak(b, { text: `S ${i}.` });
    expect((await speak(b, { text: 'More.' })).status).toBe(429);
    b.clock.advance(61_000);
    expect((await speak(b, { text: 'More.' })).status).toBe(200);
  });

  it('sentences count with the model requests of the same client at their weights (1 and 0.1 of the minute)', async () => {
    const b = await bootVoice({ env: { RATE_PER_MINUTE: '2' }, answers: () => says('Hello there.') });
    // one model request (1.0) and ten sentences (1.0) fill the minute
    expect((await ask(b.run.port, { method: 'POST', path: '/v1/teach', body: JSON.stringify({ text: 'Hi' }), headers: JSON_HEADERS })).status).toBe(200);
    for (let i = 0; i < 10; i++) expect((await speak(b, { text: `S ${i}.` })).status).toBe(200);
    expect((await speak(b, { text: 'No more.' })).status).toBe(429);
  });

  it('several sentences at once from one client are all answered: none aborts another (no model slot)', async () => {
    const gates = [controlled(), controlled(), controlled()];
    const b = await bootVoice({ voices: (_c, i) => ({ kind: 'live', body: (gates[i] ?? gates[0]!).body }) });
    const lives = await Promise.all(
      gates.map((_g, i) => {
        gates[i]?.push(`${i}`);
        return openLive(b.run.port, '/v1/speech', JSON.stringify({ text: `Sentence ${i}.` }));
      }),
    );
    for (const live of lives) expect(await live.waitFor(1)).toBe(true);
    for (const g of gates) g.end();
    for (const [i, live] of lives.entries()) {
      expect(await live.waitEnd()).toBe(true);
      expect(live.status).toBe(200);
      expect(live.received().toString()).toBe(`${i}`);
    }
  });

  it('a speech request does not replace the same client\'s lesson turn (a newer model request would)', async () => {
    const b = await bootVoice({
      answers: (_c, i) => (i === 0 ? { kind: 'hang', text: 'data: {"id":"g","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello there. "},"finish_reason":null}]}\n\n' } : says('x')),
    });
    const lesson = await openLive(b.run.port, '/v1/teach', JSON.stringify({ text: 'Hi' }));
    expect(await until(() => b.fake.calls.length === 1)).toBe(true);
    expect((await speak(b, { text: 'Hello there.' })).status).toBe(200);
    expect(b.fake.calls[0]?.signal?.aborted).toBe(false);
    expect(await lesson.waitFor(1, 500)).toBe(true);
    expect(lesson.received().toString()).not.toContain('superseded');
    lesson.destroy();
  });

  it('DAILY_MODEL_CALLS=1: speech uses none of it, so a lesson turn still gets its one call after many sentences', async () => {
    const b = await bootVoice({ env: { DAILY_MODEL_CALLS: '1' }, answers: () => says('Fine.') });
    for (let i = 0; i < 5; i++) expect((await speak(b, { text: `S ${i}.` })).status).toBe(200);
    const turn = await ask(b.run.port, { method: 'POST', path: '/v1/teach', body: JSON.stringify({ text: 'Hi' }), headers: JSON_HEADERS });
    expect(turn.status).toBe(200);
    expect(turn.text).toContain('"done":true');
    // and the one call is spent: the next lesson is the budget error, not the next sentence
    expect((await ask(b.run.port, { method: 'POST', path: '/v1/teach', body: JSON.stringify({ text: 'Again' }), headers: JSON_HEADERS })).status).toBe(429);
    expect((await speak(b, { text: 'Still fine.' })).status).toBe(200);
  });
});

describe('a client that leaves stops the provider request at once (SV3, R7.5)', () => {
  it('closing the connection while audio streams aborts the provider call', async () => {
    const c = controlled();
    const b = await bootVoice({ voices: () => ({ kind: 'live', body: c.body }) });
    c.push('\u0001');
    const live = await openLive(b.run.port, '/v1/speech', JSON.stringify({ text: 'Leave me.' }));
    expect(await live.waitFor(1)).toBe(true);
    expect(b.voice.calls[0]?.signal?.aborted).toBe(false);
    live.destroy();
    expect(await until(() => b.voice.calls[0]?.signal?.aborted === true, 2000)).toBe(true);
  });

  it('the client closing before the first byte: the provider call ends and no other voice is tried', async () => {
    const { request } = await import('node:http');
    const b = await bootVoice({ voices: () => vHang(), firstByteMs: 5000 });
    const body = JSON.stringify({ text: 'Leave me.' });
    const req = request({ host: '127.0.0.1', port: b.run.port, method: 'POST', path: '/v1/speech', headers: { ...JSON_HEADERS, 'content-length': String(Buffer.byteLength(body)) }, agent: false });
    req.on('error', () => undefined);
    req.end(body);
    expect(await until(() => b.voice.calls.length === 1)).toBe(true);
    req.destroy();
    expect(await until(() => b.voice.calls[0]?.signal?.aborted === true, 2000)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(b.voice.calls).toHaveLength(1);
  });

  it('after a closed client the server answers the next request as usual', async () => {
    const c = controlled();
    const b = await bootVoice({ voices: (_c, i) => (i === 0 ? { kind: 'live', body: c.body } : audio(MP3)) });
    c.push('\u0001');
    const live = await openLive(b.run.port, '/v1/speech', JSON.stringify({ text: 'Leave me.' }));
    await live.waitFor(1);
    live.destroy();
    expect(await until(() => b.voice.calls[0]?.signal?.aborted === true, 2000)).toBe(true);
    const next = await bytes(b, { text: 'Again.' });
    expect(next.status).toBe(200);
    expect([...next.data]).toEqual([...MP3]);
  });
});

describe('settings: free ids only, and what /v1/health says about the voice (design 3)', () => {
  it('a speech model id that does not end in :free stops the server from starting (config_invalid), naming the setting', () => {
    const r = readSettings({ OPENROUTER_API_KEY: SECRET_KEY, OPENROUTER_SPEECH_MODELS: `${FISH},acme/tts-1` });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('config_invalid');
      expect(r.message).toContain('OPENROUTER_SPEECH_MODELS');
    }
  });

  it('a list of free speech ids is taken in order, and the voice setting is read', () => {
    const r = readSettings({ OPENROUTER_SPEECH_MODELS: `${HEYGEN},${FISH}`, OPENROUTER_SPEECH_VOICE: 'noelle' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.speechModels).toEqual([HEYGEN, FISH]);
      expect(r.value.speechVoice).toBe('noelle');
    }
  });

  it('the default voice is bram', () => {
    const r = readSettings({});
    expect(r.ok && r.value.speechVoice).toBe('bram');
  });

  it('the models are tried in the order of the setting: HeyGen first when the list says so', async () => {
    const b = await bootVoice({ env: { OPENROUTER_SPEECH_MODELS: `${HEYGEN},${FISH}` }, voices: (c) => (c.model === HEYGEN ? audio(PCM, { type: 'audio/pcm' }) : audio(MP3)) });
    const r = await bytes(b, { text: 'Hello.' });
    expect(r.headers['content-type']).toBe('audio/pcm');
    expect(b.voice.models).toEqual([HEYGEN]);
  });

  it('/v1/health: voice is true with a key and a voice, false without, and the speech models are listed; never the key', async () => {
    const yes = await bootVoice();
    const r = await getJson(yes.run.port, '/v1/health');
    expect(r.json).toMatchObject({ ok: true, ready: true, voice: true, models: { speech: [FISH, HEYGEN] } });
    expect(r.text).not.toContain(SECRET_KEY);
    const no = await bootVoice({ key: false });
    const n = await getJson(no.run.port, '/v1/health');
    expect(n.json).toMatchObject({ ok: true, ready: false, voice: false });
  });
});

describe('the log keeps no sentence and no key (design 7)', () => {
  it('a whole successful request leaves neither the spoken text, the instructions, nor the key in the log', async () => {
    const b = await bootVoice();
    await speak(b, { text: 'SPOKENWORDS-31 are private.', instructions: 'INSTRUCTIONWORDS-31' });
    const log = b.logs.join('');
    for (const secret of [SECRET_KEY, 'SPOKENWORDS-31', 'INSTRUCTIONWORDS-31', 'Bearer']) expect(log, secret).not.toContain(secret);
  });
});

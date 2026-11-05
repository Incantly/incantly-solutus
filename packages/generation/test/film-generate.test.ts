import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FILM_FIXTURES, THIRTY_SECOND_FILM } from '@incantly/core';
import { hmacAuthenticator, mintToken } from '../src/auth';
import { formatFilmTimings, generateFilmStream, resolveFilmSource, storedAsFixture, type StoredFilm } from '../src/client/film-client';
import { filmReferenceModel } from '../src/film-reference';
import { generateFilm } from '../src/film';
import { ScriptedModel } from '../src/models';
import { GenerationService } from '../src/service';
import { StubNarrator } from '../src/tts';

const SECRET = 'film-generate-test-secret-0000000000000000';

async function start(options: { model?: ScriptedModel; limits?: ConstructorParameters<typeof GenerationService>[0]['limits']; enabled?: () => boolean } = {}) {
  const model = options.model ?? filmReferenceModel();
  const service = new GenerationService({
    model,
    authenticate: hmacAuthenticator(SECRET),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.enabled ? { enabled: options.enabled } : {}),
  });
  const server: Server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const token = mintToken(SECRET, 'learner-1', 3600);
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${base}${path.slice(3)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  servers.push(server);
  return { base, service, token, post, model };
}

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function sseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('film generate box: request shape and progress states', () => {
  it('POSTs prompt plus length preset to the session films endpoint', async () => {
    let url = '';
    let body: unknown = null;
    const mockFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      url = String(input);
      body = JSON.parse(String(init?.body ?? '{}'));
      return sseResponse([{ event: 'skeleton', data: { lengthTarget: 30, scenes: 1, deadlineMs: 25000 } }]);
    }) as typeof fetch;
    const events = [];
    for await (const event of generateFilmStream({ baseUrl: '/api/session/abc/v1', token: () => 't', fetch: mockFetch }, { prompt: 'How dots shift', lengthTarget: 30 })) {
      events.push(event);
    }
    expect(url).toBe('/api/session/abc/v1/films');
    expect(body).toEqual({ prompt: 'How dots shift', lengthTarget: 30 });
    expect(events[0]).toMatchObject({ type: 'skeleton', lengthTarget: 30, scenes: 1 });
  });

  it('streams skeleton, plan, scenes, then film or fallback in order', async () => {
    const mockFetch = (async (): Promise<Response> =>
      sseResponse([
        { event: 'skeleton', data: { lengthTarget: 60, scenes: 1, deadlineMs: 45000 } },
        { event: 'plan', data: { scenes: [{ scene: 's1', title: 'Dots', beats: ['s1b1'] }] } },
        { event: 'scene', data: { scene: 's1', fragments: { html: '<div></div>', css: '', js: 'inc.steps([]);' } } },
        { event: 'film', data: { generationId: 'g1', storyboard: { film: { title: 'T' }, scenes: [] }, scenes: [], timings: { skeletonMs: 1, planMs: 2, firstSceneMs: 3, scenesMs: {}, speechMs: 4, checkMs: 5, probeMs: 6, totalMs: 7 }, speechChars: 10, partial: false } },
      ])) as typeof fetch;
    const types: string[] = [];
    for await (const event of generateFilmStream({ baseUrl: '/api/v1', token: () => 't', fetch: mockFetch }, { prompt: 'Dots' })) {
      types.push(event.type);
    }
    expect(types).toEqual(['skeleton', 'plan', 'scene', 'film']);
  });

  it('surfaces fallback reasons with kept scenes like a figure', async () => {
    const mockFetch = (async (): Promise<Response> =>
      sseResponse([
        { event: 'skeleton', data: { lengthTarget: 60, scenes: 1, deadlineMs: 45000 } },
        { event: 'fallback', data: { generationId: 'g1', reason: 'scene', standard: null, keptScenes: [{ sceneId: 's1', fragments: { html: '', css: '', js: '' } }] } },
      ])) as typeof fetch;
    const events = [];
    for await (const event of generateFilmStream({ baseUrl: '/api/v1', token: () => 't', fetch: mockFetch }, { prompt: 'Dots' })) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ type: 'fallback', reason: 'scene', keptScenes: [{ sceneId: 's1' }] });
  });
});

describe('film timing report: plan, scene, speech, check and probe', () => {
  it('formats every timing on one line', () => {
    const line = formatFilmTimings({ skeletonMs: 5, planMs: 1200, firstSceneMs: 8300, scenesMs: { s1: 8000 }, speechMs: 400, checkMs: 120, probeMs: 900, totalMs: 10200 });
    expect(line).toContain('plan 1.2s');
    expect(line).toContain('first scene 8.3s');
    expect(line).toContain('speech 0.4s');
    expect(line).toContain('check 0.1s');
    expect(line).toContain('probe 0.9s');
    expect(line).toContain('total 10.2s');
  });

  it('shows a dash where the first scene never played', () => {
    const line = formatFilmTimings({ skeletonMs: 5, planMs: 1200, firstSceneMs: null, scenesMs: {}, speechMs: 400, checkMs: 120, probeMs: 900, totalMs: 10200 });
    expect(line).toContain('first scene —');
  });
});

describe('film playback: the dev store first, fixtures second', () => {
  const stored: StoredFilm = {
    id: 'gen-1',
    storyboard: { film: { title: 'Generated dots', lengthTarget: 30 }, scenes: [{ id: 's1', kit: 'svg', beats: [{ id: 's1b1', say: 'Dots.' }] }] },
    scenes: [{ id: 's1', html: "<div id='stage'></div>", css: '', js: "inc.steps([{ say: 'Dots.' }]);" }],
  };

  it('resolves a stored film before fixtures', async () => {
    const resolved = await resolveFilmSource('gen-1', {
      loadStored: async (id) => (id === 'gen-1' ? stored : null),
      fixtures: FILM_FIXTURES,
    });
    expect(resolved?.source).toBe('store');
    expect((resolved?.film as StoredFilm).id).toBe('gen-1');
  });

  it('falls back to fixtures for thirty and sixty', async () => {
    for (const id of ['thirty', 'sixty']) {
      const resolved = await resolveFilmSource(id, { loadStored: async () => null, fixtures: FILM_FIXTURES });
      expect(resolved?.source).toBe('fixture');
    }
  });

  it('returns null for unknown ids', async () => {
    const resolved = await resolveFilmSource('nope', { loadStored: async () => null, fixtures: FILM_FIXTURES });
    expect(resolved).toBeNull();
  });

  it('treats prototype names as unknown ids, not fixtures', async () => {
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const resolved = await resolveFilmSource(id, { loadStored: async () => null, fixtures: FILM_FIXTURES });
      expect(resolved).toBeNull();
    }
  });

  it('shapes a stored film like a fixture for the player', () => {
    const fixture = storedAsFixture(stored);
    expect(fixture.storyboard).toBe(stored.storyboard);
    expect(fixture.scenes).toHaveLength(1);
    expect(fixture.scenes[0]).toMatchObject({ id: 's1', html: stored.scenes[0]!.html });
    expect(THIRTY_SECOND_FILM.scenes[0]).toHaveProperty('probe');
    expect(storedAsFixture(THIRTY_SECOND_FILM)).toBe(THIRTY_SECOND_FILM);
  });
});

describe('film service: the session model serves films with the service gates', () => {
  it('streams a film through the given session model, not a mock', async () => {
    const session = filmReferenceModel({ models: { plan: 'session-plan', scene: 'session-scene', repair: 'session-repair' } });
    const { post } = await start({ model: session });
    const answer = await post('/v1/films', { prompt: 'How dots shift', lengthTarget: 30 });
    expect(answer.status).toBe(200);
    const text = await answer.text();
    expect(text).toContain('event: skeleton');
    expect(text).toContain('event: film');
    expect(session.calls.length).toBeGreaterThan(0);
    expect(session.calls[0]?.purpose).toBe('plan');
  });

  it('applies limits, spend and the switch exactly as figures do', async () => {
    const { post, service } = await start({ model: filmReferenceModel() });
    await (await post('/v1/films', { prompt: 'How dots shift', lengthTarget: 30 })).text();
    expect(service.usage('learner-1').today).toBe(1);
    const limited = await start({ model: filmReferenceModel(), limits: { perMinute: 10, perDay: 10, concurrent: 4, learnerDailyUsd: 0.000001, serviceDailyUsd: 100 } });
    await (await limited.post('/v1/films', { prompt: 'How dots shift', lengthTarget: 30 })).text();
    const refused = await limited.post('/v1/films', { prompt: 'How dots shift', lengthTarget: 30 });
    expect(refused.status).toBe(429);
    let on = true;
    const switched = await start({ model: filmReferenceModel(), enabled: () => on });
    on = false;
    expect((await switched.post('/v1/films', { prompt: 'Dots', lengthTarget: 30 })).status).toBe(503);
  });

  it('narrates through the stub with zero real TTS', async () => {
    const narrator = new StubNarrator();
    expect(narrator.name).toBe('stub');
    const reply = await narrator.speak({ text: 'A dot appears.', voice: 'stub' });
    expect(reply.audio.length).toBeGreaterThan(0);
    expect(reply.words.length).toBeGreaterThan(0);
  });

  it('quotes the prompt bound the code enforces, for figures and films', async () => {
    const { post } = await start({ model: filmReferenceModel() });
    for (const path of ['/v1/generations', '/v1/films']) {
      const over = await post(path, { prompt: 'x'.repeat(1001), ...(path === '/v1/films' ? { lengthTarget: 30 } : {}) });
      expect(over.status).toBe(400);
      expect(((await over.json()) as { message: string }).message).toBe('prompt must be at most 1000 characters');
    }
    // A 1000-character prompt passes validation and streams a film.
    expect((await post('/v1/films', { prompt: 'x'.repeat(1000), lengthTarget: 30 })).status).toBe(200);
  });

  it('ends a film aborted mid-scene with spend and a terminal failure, not a truncation', async () => {
    const plan =
      'Here is the storyboard.\n```json\n' +
      JSON.stringify({
        film: { title: 'Test film', lengthTarget: 30 },
        scenes: [
          {
            id: 's1',
            idea: 'A dot appears and shifts aside',
            kit: 'svg',
            beats: [
              { id: 's1b1', say: 'A dot appears at the center of the stage.', focus: 'Dot' },
              { id: 's1b2', say: 'Move the shift control and watch the dot glide aside.', focus: 'Dot' },
            ],
            durationShare: 1,
          },
        ],
      }) +
      '\n```\n';
    // The plan answers at once; the scene call hangs until the deadline aborts it.
    const model = new ScriptedModel(async (call) => {
      if (call.purpose === 'plan') return plan;
      await new Promise<never>((_resolve, reject) => {
        call.signal?.addEventListener('abort', () => reject(new Error('The call was cancelled')), { once: true });
      });
      throw new Error('unreachable');
    });
    const seen: Array<{ ok: boolean; failure: string | null }> = [];
    const state = await generateFilm({ prompt: 'How dots shift', lengthTarget: 30 }, { model, deadlineMs: 150 }, { onScene: (result) => seen.push({ ok: result.ok, failure: result.failure }) });
    expect(state.fallback?.reason).toBe('timeout');
    expect(state.failure).toBe('timeout');
    // The plan call ran and is accounted, so the service's finally-spend keeps it.
    expect(state.usage.inputTokens + state.usage.outputTokens).toBeGreaterThan(0);
    expect(state.scenes).toHaveLength(1);
    expect(state.scenes[0]).toMatchObject({ ok: false, failure: 'timeout' });
    expect(seen).toEqual([{ ok: false, failure: 'timeout' }]);
  });
});

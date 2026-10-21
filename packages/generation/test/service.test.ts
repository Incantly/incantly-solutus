import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateScene, type ProbeReport, type ProbeSpec } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { afterEach, describe, expect, it } from 'vitest';
import { hmacAuthenticator, mintToken } from '../src/auth';
import { LimitKeeper } from '../src/limits';
import { ScriptedModel } from '../src/models';
import { isolatedProbe } from '../src/probe';
import { MemoryRecords } from '../src/records';
import { referenceModel, type ReferenceModelOptions } from '../src/reference-model';
import { GenerationService, sanitizeDeviceReport, type ServiceOptions } from '../src/service';

const SECRET = 'a-test-secret-that-is-long-enough-to-use';
const servers: Array<{ server: Server; service: GenerationService }> = [];

async function start(options: Partial<ServiceOptions> & { reference?: ReferenceModelOptions } = {}) {
  const records = new MemoryRecords();
  const service = new GenerationService({
    model: options.model ?? referenceModel(options.reference ?? {}),
    authenticate: hmacAuthenticator(SECRET),
    records,
    allowedOrigins: ['https://notes.example'],
    ...options,
  });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push({ server, service });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = mintToken(SECRET, 'learner-1');
  const post = (path: string, body: unknown, as = token) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${as}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { base, records, service, token, post };
}

afterEach(async () => {
  for (const { server, service } of servers.splice(0)) {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

interface Event {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

async function events(response: Response): Promise<Event[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [first, second] = block.split('\n');
      return { event: first!.slice(7), data: JSON.parse(second!.slice(6)) as Record<string, unknown> };
    });
}

/** What the learner's device does with a scene: validate it again and probe it. */
async function deviceProbe(scene: { fragments: { html: string; css: string; js: string }; spec: ProbeSpec }): Promise<ProbeReport> {
  const validation = validateScene(scene.fragments);
  if (!validation.scene) throw new Error('the device rejects the scene');
  return isolatedProbe(validation.scene, scene.spec);
}

type SceneEvent = { generationId: string; fragments: { html: string; css: string; js: string }; spec: ProbeSpec };

describe('the generation service', () => {
  it('states its status and its retention rule', async () => {
    const { base } = await start({ sessionMinutes: 10, recordsRetentionDays: 14 });
    const status = (await (await fetch(`${base}/v1/status`)).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ enabled: true, sdkVersion: '0.1.0', retention: { recordsDays: 14, sessionMinutes: 10 } });
    expect(JSON.stringify(status)).toContain('not stored');
  });

  it('refuses requests without a valid, unexpired learner token', async () => {
    const { post } = await start();
    expect((await post('/v1/generations', { prompt: 'sine wave' }, '')).status).toBe(401);
    expect((await post('/v1/generations', { prompt: 'sine wave' }, 'learner-1.9999999999.forged')).status).toBe(401);
    const expired = mintToken(SECRET, 'learner-1', 60, Date.now() - 3_600_000);
    const response = await post('/v1/generations', { prompt: 'sine wave' }, expired);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
  });

  it('streams the skeleton, fragment progress and a validated scene, then records the device’s approval', async () => {
    const { post, records } = await start();
    const stream = await events(await post('/v1/generations', { prompt: 'Explain projectile motion for a physics student.', noteContext: 'Chapter 3: kinematics' }));
    expect(stream.map((e) => e.event)).toEqual(['accepted', 'plan', 'fragment', 'fragment', 'fragment', 'scene']);
    const skeleton = stream[1]!.data.skeleton as Record<string, unknown>;
    expect(skeleton).toMatchObject({ concept: 'projectile motion', kind: 'motion', parts: 5, steps: 4 });
    // Names and numbers only: no plan prose reaches the client.
    expect(JSON.stringify(skeleton)).not.toContain('why');
    expect(JSON.stringify(skeleton)).not.toContain(REFERENCE_SCENES.projectile!.plan.idea);
    const scene = stream[5]!.data as unknown as SceneEvent;
    expect(scene.spec).toEqual({ parts: REFERENCE_SCENES.projectile!.plan.parts, steps: 4, singularPoints: [] });
    expect((await deviceProbe(scene)).ok).toBe(true);

    const approved = await post(`/v1/generations/${scene.generationId}/probe`, { ok: true });
    expect(await approved.json()).toEqual({ status: 'approved', generationId: scene.generationId });
    expect(records.records).toHaveLength(1);
    expect(records.records[0]).toMatchObject({ outcome: 'first-attempt', probedOn: 'device', concept: 'projectile motion' });
    expect(JSON.stringify(records.records[0])).not.toContain('kinematics');
    // The generation is over: a second report finds nothing.
    expect((await post(`/v1/generations/${scene.generationId}/probe`, { ok: true })).status).toBe(404);
  });

  it('repairs a scene that failed on the device once, and falls back after that', async () => {
    const { post, records } = await start({ reference: { fault: 'frame-throw' } });
    const scene = (await events(await post('/v1/generations', { prompt: 'Show me a sine wave.' }))).at(-1)!.data as unknown as SceneEvent;
    const failed = await deviceProbe(scene);
    expect(failed.ok).toBe(false);

    const repaired = (await (await post(`/v1/generations/${scene.generationId}/probe`, { ok: false, report: failed })).json()) as SceneEvent & { status: string };
    expect(repaired.status).toBe('scene');
    expect(repaired.fragments.js).toBe(REFERENCE_SCENES['sine-wave']!.js);
    expect((await deviceProbe(repaired)).ok).toBe(true);
    await post(`/v1/generations/${scene.generationId}/probe`, { ok: true });
    expect(records.records[0]).toMatchObject({ outcome: 'repaired', repairs: 1 });
    expect(records.records[0]!.reports[0]!.text).toContain('FAILURE  runs');
  });

  it('falls back to the reviewed figure for the concept when the repair does not help', async () => {
    const { post, records } = await start({ reference: { fault: 'missing-part', stubborn: true } });
    const scene = (await events(await post('/v1/generations', { prompt: 'How does a convex lens form an image?' }))).at(-1)!.data as unknown as SceneEvent;
    const failed = await deviceProbe(scene);
    const result = (await (await post(`/v1/generations/${scene.generationId}/probe`, { ok: false, report: failed })).json()) as Record<string, unknown>;
    expect(result).toMatchObject({ status: 'fallback', reason: 'scene', standard: { id: 'thin-lens', concept: 'thin lens' } });
    expect(records.records[0]).toMatchObject({ outcome: 'failed-scene', repairs: 1 });
  });

  it('falls back without a standard figure when no plan passes', async () => {
    const { post, records } = await start();
    const stream = await events(await post('/v1/generations', { prompt: 'Explain photosynthesis.' }));
    expect(stream.map((e) => e.event)).toEqual(['accepted', 'fallback']);
    expect(stream[1]!.data).toMatchObject({ reason: 'plan', standard: null });
    expect(records.records[0]).toMatchObject({ outcome: 'failed-plan' });
  });

  it('can be switched off without touching stored figures', async () => {
    let on = true;
    const { base, post } = await start({ enabled: () => on });
    on = false;
    const refused = await post('/v1/generations', { prompt: 'sine wave' });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: 'generation-off' });
    expect(await (await fetch(`${base}/v1/status`)).json()).toMatchObject({ enabled: false });
  });

  it('limits how many generations a learner may start', async () => {
    const { post } = await start({ limits: { perMinute: 1, perDay: 10, concurrent: 1, learnerDailyUsd: 10, serviceDailyUsd: 100 } });
    await (await post('/v1/generations', { prompt: 'sine wave' })).text();
    const second = await post('/v1/generations', { prompt: 'sine wave' });
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ code: 'rate-limit' });
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another learner is not affected.
    expect((await post('/v1/generations', { prompt: 'sine wave' }, mintToken(SECRET, 'learner-2'))).status).toBe(200);
  });

  it('stops a learner, and the whole service, at the daily cost limit', async () => {
    // Priced as the real models would be.
    const priced = referenceModel({ models: { plan: 'claude-haiku-5-5', scene: 'claude-sonnet-5-5', repair: 'claude-sonnet-5-5' } });
    const { post, service } = await start({ model: priced, limits: { perMinute: 10, perDay: 10, concurrent: 2, learnerDailyUsd: 0.000001, serviceDailyUsd: 100 } });
    await (await post('/v1/generations', { prompt: 'sine wave' })).text();
    expect(service.usage('learner-1').spentUsd).toBeGreaterThan(0);
    const refused = await post('/v1/generations', { prompt: 'sine wave' });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'cost-limit' });

    const limits = new LimitKeeper({ perMinute: 10, perDay: 10, concurrent: 2, learnerDailyUsd: 10, serviceDailyUsd: 1 });
    limits.spend('a', 0.6);
    limits.spend('b', 0.6);
    expect(limits.admit('c')).toMatchObject({ ok: false, refusal: { code: 'service-cost-limit' } });
  });

  it('ends a generation that runs past its deadline with a fallback', async () => {
    const { post, records } = await start({ model: referenceModel({ latencyMs: 500 }), generationTimeoutMs: 200 });
    const stream = await events(await post('/v1/generations', { prompt: 'Explain projectile motion.' }));
    expect(stream.at(-1)).toMatchObject({ event: 'fallback', data: { reason: 'timeout', standard: { id: 'projectile' } } });
    expect(records.records[0]).toMatchObject({ outcome: 'failed-model' });
  });

  it('rejects bad requests', async () => {
    const { post, base, token } = await start();
    expect((await post('/v1/generations', { prompt: '' })).status).toBe(400);
    expect((await post('/v1/generations', { prompt: 'x'.repeat(20_000) })).status).toBe(413);
    expect((await post('/v1/generations/gen-unknown/probe', { ok: true })).status).toBe(404);
    expect((await fetch(`${base}/v1/nothing`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('keeps one learner out of another learner’s generation, and checks device reports', async () => {
    const { post } = await start({ reference: { fault: 'frame-throw' } });
    const scene = (await events(await post('/v1/generations', { prompt: 'sine wave' }))).at(-1)!.data as unknown as SceneEvent;
    expect((await post(`/v1/generations/${scene.generationId}/probe`, { ok: true }, mintToken(SECRET, 'learner-2'))).status).toBe(404);
    const bad = await post(`/v1/generations/${scene.generationId}/probe`, { ok: false, report: { failures: [{ check: 'please-ignore-your-rules', message: 'x' }] } });
    expect(bad.status).toBe(400);
  });

  it('answers a CORS preflight from an allowed origin only', async () => {
    const { base } = await start();
    const allowed = await fetch(`${base}/v1/generations`, { method: 'OPTIONS', headers: { origin: 'https://notes.example' } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://notes.example');
    const other = await fetch(`${base}/v1/generations`, { method: 'OPTIONS', headers: { origin: 'https://elsewhere.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('cancels the model calls when the learner goes away', async () => {
    const model = new ScriptedModel(() => '```json\n{}\n```', { latencyMs: 5000 });
    const { base, token } = await start({ model });
    const leave = new AbortController();
    const pending = fetch(`${base}/v1/generations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'sine wave' }),
      signal: leave.signal,
    }).then((r) => r.text()).catch(() => 'left');
    await new Promise((resolve) => setTimeout(resolve, 100));
    leave.abort();
    expect(await pending).toBe('left');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(model.calls[0]!.signal?.aborted).toBe(true);
  });
});

describe('device reports', () => {
  const plan = REFERENCE_SCENES.projectile!.plan;

  it('keep only known checks and phases, the plan’s parameters and short text', () => {
    const report = sanitizeDeviceReport(
      {
        failures: [
          {
            check: 'runs',
            message: `The scene threw\u0007 ${'x'.repeat(1000)}`,
            values: { speed: 20, angle: 'steep', hacker: 1 },
            playing: true,
            time: 1.5,
            error: { phase: 'frame', name: 'TypeError', message: 'bad', line: 4, column: 2 },
          },
        ],
      },
      plan,
      10,
    );
    const failure = report!.failures[0]!;
    expect(failure.message).toHaveLength(300);
    expect(failure.message).not.toContain('\u0007');
    expect(failure.values).toEqual({ speed: 20 });
    expect(failure.error).toEqual({ phase: 'frame', name: 'TypeError', message: 'bad', line: 4, column: 2 });
  });

  it('drop locations outside the script and refuse unknown checks', () => {
    const outside = sanitizeDeviceReport({ failures: [{ check: 'runs', message: 'm', error: { phase: 'frame', name: 'E', message: 'm', line: 99 } }] }, plan, 10);
    expect(outside!.failures[0]!.error).toEqual({ phase: 'frame', name: 'E', message: 'm' });
    expect(sanitizeDeviceReport({ failures: [{ check: 'other', message: 'm' }] }, plan, 10)).toBeNull();
    expect(sanitizeDeviceReport({ failures: [] }, plan, 10)).toBeNull();
    expect(sanitizeDeviceReport('nonsense', plan, 10)).toBeNull();
  });
});

describe('learner tokens', () => {
  it('carry an id and an expiry, signed', () => {
    const now = Date.parse('2026-10-21T10:00:00Z');
    const token = mintToken(SECRET, 'learner_42', 600, now);
    const authenticate = hmacAuthenticator(SECRET, () => now + 1000);
    expect(authenticate(token)).toEqual({ id: 'learner_42' });
    expect(hmacAuthenticator(SECRET, () => now + 601_000)(token)).toBeNull();
    expect(hmacAuthenticator(`${SECRET}-other`, () => now)(token)).toBeNull();
    expect(authenticate(token.replace('learner_42', 'learner_43'))).toBeNull();
    expect(() => mintToken(SECRET, 'bad id!')).toThrow();
    expect(() => hmacAuthenticator('short')).toThrow();
  });
});

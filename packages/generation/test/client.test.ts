import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { validateScene } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hmacAuthenticator, mintToken } from '../src/auth';
import { GenerationClient, ServiceError } from '../src/client/service-client';
import { runGeneration, type DeviceProbe, type GenerationStage } from '../src/client/flow';
import { Telemetry, cleanSignal, type ProductSignal } from '../src/client/telemetry';
import { isolatedProbe } from '../src/probe';
import { MemoryRecords } from '../src/records';
import { referenceModel, type ReferenceModelOptions } from '../src/reference-model';
import { GenerationService } from '../src/service';

const SECRET = 'a-test-secret-that-is-long-enough-to-use';
const running: Array<{ server: Server; service: GenerationService }> = [];

afterEach(async () => {
  for (const { server, service } of running.splice(0)) {
    await service.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function serve(reference: ReferenceModelOptions = {}, enabled = true) {
  const records = new MemoryRecords();
  const service = new GenerationService({ model: referenceModel(reference), authenticate: hmacAuthenticator(SECRET), records, enabled: () => enabled });
  const server = createServer((req, res) => void service.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running.push({ server, service });
  const client = new GenerationClient({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    token: () => mintToken(SECRET, 'learner-1'),
  });
  return { client, records };
}

/** The device: validate again, then probe; in a browser this is the sandbox. */
const device: DeviceProbe = async (fragments, spec) => {
  const validation = validateScene(fragments);
  if (!validation.scene) return { ok: false, report: null };
  const report = await isolatedProbe(validation.scene, spec);
  return { ok: report.ok, report };
};

describe('generating a figure from the learner’s device', () => {
  it('shows the skeleton, probes the scene on the device and approves it', async () => {
    const { client, records } = await serve();
    const stages: GenerationStage[] = [];
    const skeletons: string[] = [];
    const signals: ProductSignal[] = [];
    const outcome = await runGeneration({
      client,
      request: { prompt: 'Show me how amplitude changes a sine wave.' },
      probe: device,
      onSkeleton: (s) => skeletons.push(s.concept),
      onStage: (s) => stages.push(s),
      signals: (s) => signals.push(s),
    });
    expect(outcome).toMatchObject({ kind: 'approved', repaired: false, figure: { concept: 'sine wave', standard: false } });
    if (outcome.kind !== 'approved') throw new Error('expected approval');
    expect(outcome.figure.fragments.js).toBe(REFERENCE_SCENES['sine-wave']!.js);
    expect(outcome.figure.generationId).toMatch(/^gen-/);
    expect(skeletons).toEqual(['sine wave']);
    expect(stages).toEqual(['planning', 'building', 'checking']);
    expect(signals.map((s) => s.type)).toEqual(['time-to-skeleton', 'generation']);
    expect(signals.every((s) => cleanSignal(s) !== null)).toBe(true);
    await vi.waitFor(() => expect(records.records[0]).toMatchObject({ outcome: 'first-attempt', probedOn: 'device' }));
  });

  it('sends a failed device probe back for its one repair, and approves the repaired scene', async () => {
    const { client, records } = await serve({ fault: 'non-finite' });
    const stages: GenerationStage[] = [];
    const outcome = await runGeneration({ client, request: { prompt: 'Explain projectile motion.' }, probe: device, onStage: (s) => stages.push(s) });
    expect(outcome).toMatchObject({ kind: 'approved', repaired: true });
    expect(stages).toEqual(['planning', 'building', 'checking', 'repairing', 'checking']);
    await vi.waitFor(() => expect(records.records[0]).toMatchObject({ outcome: 'repaired' }));
  });

  it('falls back to the reviewed figure, checked on the device too, when the repair fails', async () => {
    const { client } = await serve({ fault: 'frame-throw', stubborn: true });
    const probe = vi.fn(device);
    const outcome = await runGeneration({ client, request: { prompt: 'How does a convex lens form an image?' }, probe });
    expect(outcome).toMatchObject({ kind: 'fallback', level: 'standard', reason: 'scene', figure: { concept: 'thin lens', standard: true, generationId: null } });
    // The repair changed nothing, so the service fell back without a second candidate: the device probed the first and the standard figure.
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('keeps an existing figure, or its snapshot, rather than showing a standard one', async () => {
    const { client } = await serve({ fault: 'frame-throw', stubborn: true });
    const kept = await runGeneration({ client, request: { prompt: 'thin lens' }, probe: device, existing: { hasFragments: true, hasSnapshot: true } });
    expect(kept).toMatchObject({ kind: 'fallback', level: 'last-approved' });
    const photo = await runGeneration({ client, request: { prompt: 'Explain photosynthesis' }, probe: device, existing: { hasFragments: false, hasSnapshot: true } });
    expect(photo).toMatchObject({ kind: 'fallback', level: 'snapshot', reason: 'plan' });
  });

  it('ends with one plain line when nothing else is available', async () => {
    const { client } = await serve();
    const outcome = await runGeneration({ client, request: { prompt: 'Explain photosynthesis' }, probe: device });
    expect(outcome).toEqual({ kind: 'fallback', level: 'text', reason: 'plan', figure: null, message: 'This figure could not be built.' });
  });

  it('says so when generation is switched off, and carries on', async () => {
    const { client } = await serve({}, false);
    const signals: ProductSignal[] = [];
    const outcome = await runGeneration({ client, request: { prompt: 'sine wave' }, probe: device, signals: (s) => signals.push(s) });
    expect(outcome).toMatchObject({ kind: 'fallback', level: 'text', reason: 'off', message: 'This figure could not be built. Making new figures is switched off for now.' });
    expect(signals).toEqual([expect.objectContaining({ type: 'generation', outcome: 'fallback', fallback: 'text', reason: 'off' })]);
  });

  it('reads the event stream however it is chunked, and reports refusals as service errors', async () => {
    const body =
      'event: accepted\ndata: {"generationId":"gen-1"}\n\n: keep-alive\n\nevent: plan\ndata: {"generationId":"gen-1","skeleton":{"concept":"x","kind":"graph","parameters":[],"parts":1,"steps":0}}\n\nevent: unknown\ndata: {}\n\n';
    const fakeFetch = (async () => {
      const bytes = new TextEncoder().encode(body);
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
            controller.close();
          },
        }),
      );
    }) as typeof fetch;
    const client = new GenerationClient({ baseUrl: 'https://service.example/v1', token: () => 't', fetch: fakeFetch });
    const events: string[] = [];
    for await (const event of client.generate({ prompt: 'x' })) events.push(event.type);
    expect(events).toEqual(['accepted', 'plan']);

    const refusing = new GenerationClient({
      baseUrl: 'https://service.example/v1',
      token: () => 't',
      fetch: (async () => new Response('{"code":"rate-limit","message":"Wait"}', { status: 429, headers: { 'retry-after': '12' } })) as typeof fetch,
    });
    const error = await refusing.generate({ prompt: 'x' }).next().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 429, code: 'rate-limit', retryAfterSeconds: 12 });
  });
});

describe('product signals', () => {
  it('pass only ids, names, numbers and fixed words', () => {
    expect(cleanSignal({ type: 'parameter-changed', figureId: 'fig-1', parameter: 'launchSpeed' })).toEqual({
      type: 'parameter-changed',
      figureId: 'fig-1',
      parameter: 'launchSpeed',
    });
    // Free text, unknown fields and unknown types never pass.
    expect(cleanSignal({ type: 'parameter-changed', figureId: 'fig-1', parameter: 'my notes about speed' })).toBeNull();
    expect(cleanSignal({ type: 'figure-shown', figureId: 'fig-1', note: 'secret' })).toEqual({ type: 'figure-shown', figureId: 'fig-1' });
    expect(cleanSignal({ type: 'note-text', text: 'hello' })).toBeNull();
    expect(cleanSignal({ type: 'figure-failure', figureId: 'f', kind: 'runs', fatal: false, values: { speed: 20, 'the note': 1 } })).toBeNull();
    expect(cleanSignal({ type: 'generation', ms: 1200.7, outcome: 'approved', repaired: false })).toEqual({ type: 'generation', ms: 1201, outcome: 'approved', repaired: false });
  });

  it('are batched to the host’s sink, and the rejects are counted', async () => {
    const batches: number[] = [];
    const telemetry = new Telemetry({ sink: (events) => void batches.push(events.length), batchSize: 2, session: 's-1', now: () => 42 });
    telemetry.emit({ type: 'time-to-skeleton', ms: 300 });
    telemetry.emit({ type: 'figure-shown', figureId: 'fig 1' } as ProductSignal);
    expect(telemetry.dropped).toBe(1);
    telemetry.emit({ type: 'steps-completed', figureId: 'fig-1', count: 3 });
    expect(batches).toEqual([2]);
    telemetry.emit({ type: 'figure-shown', figureId: 'fig-2' });
    await telemetry.flush();
    expect(batches).toEqual([2, 1]);
  });
});

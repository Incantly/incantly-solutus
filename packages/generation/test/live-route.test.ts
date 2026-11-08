/**
 * POST /v1/live/token through the service handler directly: off without a
 * minter, authenticated, and mint-shaped with one. The handler is driven
 * with in-process request/response doubles, so no socket is bound.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { hmacAuthenticator, mintToken } from '../src/auth';
import { GenerationService, type ServiceOptions } from '../src/service';

const SECRET = 'a-test-secret-that-is-long-enough-to-use';
const services: GenerationService[] = [];

function start(options: Partial<ServiceOptions> = {}): GenerationService {
  const service = new GenerationService({
    // The token route makes no model call, so the model never runs here.
    model: {
      name: 'unused',
      modelFor: () => 'unused',
      complete: async () => ({ text: '', model: 'unused', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, stopReason: null, ms: 0 }),
    },
    authenticate: hmacAuthenticator(SECRET),
    ...options,
  });
  services.push(service);
  return service;
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
});

/** Drives the handler without binding a socket, like a POST with no body. */
async function post(service: GenerationService, path: string, token?: string): Promise<{ status: number; body: unknown }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = 'POST';
  req.url = path;
  req.headers = token ? { authorization: `Bearer ${token}` } : {};
  let status = 0;
  const chunks: Buffer[] = [];
  const res = new EventEmitter() as unknown as ServerResponse;
  let ended: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    ended = resolve;
  });
  res.writeHead = ((code: number) => {
    status = code;
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((chunk?: unknown) => {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
    else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    ended();
    return res;
  }) as ServerResponse['end'];
  res.setHeader = (() => {}) as unknown as ServerResponse['setHeader'];
  await service.handle(req, res);
  await done;
  return { status, body: JSON.parse(Buffer.concat(chunks).toString('utf8') as string) as unknown };
}

describe('POST /v1/live/token', () => {
  it('answers 404 when no minter is supplied, like other disabled features', async () => {
    const service = start();
    const answer = await post(service, '/v1/live/token', mintToken(SECRET, 'learner-1'));
    expect(answer.status).toBe(404);
    expect((answer.body as { code: string }).code).toBe('not-found');
  });

  it('requires a learner token', async () => {
    const service = start({ live: { mint: async () => ({ token: 't', model: 'm', expiresAt: 0 }) } });
    const answer = await post(service, '/v1/live/token', 'bogus');
    expect(answer.status).toBe(401);
  });

  it('returns the minted token, model and expiry', async () => {
    let calls = 0;
    const service = start({
      live: {
        mint: async () => {
          calls += 1;
          return { token: 'short-lived-1', model: 'gemini-live-x', expiresAt: 1_700_000_000_000 };
        },
      },
    });
    const answer = await post(service, '/v1/live/token', mintToken(SECRET, 'learner-1'));
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ token: 'short-lived-1', model: 'gemini-live-x', expiresAt: 1_700_000_000_000 });
    expect(calls).toBe(1);
  });
});

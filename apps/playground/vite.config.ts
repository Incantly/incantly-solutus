import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

/**
 * The generation service, mounted in the dev server for the playground and its
 * browser tests: /api/v1 runs the reference model, and /api/fault/<fault>/v1
 * a reference model that injects that fault, or /api/fault/<fault>-stubborn/v1
 * one whose repairs change nothing. The interactive playground creates an
 * ephemeral Anthropic session at /api/dev/session. Its API key stays only in
 * this process's memory and is addressed from the browser by an opaque id.
 */
const DEV_SECRET = 'playground-only-secret-never-used-in-production';

type Generation = typeof import('@incantly/generation');

function generationService(): Plugin {
  let enabled = true;
  const services = new Map<
    string,
    { handle(req: IncomingMessage, res: ServerResponse): Promise<void>; close(): Promise<void>; records: { records: unknown[] } }
  >();
  const sessions = new Map<string, { apiKey: string; planModel: string; sceneModel: string }>();
  const models = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);

  async function body(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > 16_384) throw new Error('Request body is too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  async function serviceFor(server: ViteDevServer, prefix: string, fault: string | null) {
    const existing = services.get(prefix);
    if (existing) return existing;
    const g = (await server.ssrLoadModule('@incantly/generation')) as Generation;
    const sessionId = /^\/api\/session\/([\w-]+)\/v1$/.exec(prefix)?.[1];
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && !session) throw new Error('That Anthropic session has ended');
    const stubborn = fault?.endsWith('-stubborn') ?? false;
    const name = (fault ?? 'none').replace(/-stubborn$/, '') as import('@incantly/generation').Fault;
    const model = session
      ? new g.AnthropicClient({
          apiKey: session.apiKey,
          models: { plan: session.planModel, scene: session.sceneModel, repair: session.sceneModel },
        })
      : g.referenceModel({ fault: name, stubborn, latencyMs: 250, chunk: 48 });
    const records = new g.MemoryRecords();
    const service = new g.GenerationService({
      model,
      authenticate: g.hmacAuthenticator(DEV_SECRET),
      records,
      prefix,
      enabled: () => enabled,
      limits: { ...g.DEFAULT_LIMITS, perMinute: 60, perDay: 1000, concurrent: 6 },
    });
    const entry = { handle: service.handle, close: () => service.close(), records };
    services.set(prefix, entry);
    return entry;
  }

  return {
    name: 'incantly-generation-service',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        if (!path.startsWith('/api/')) return next();
        void (async () => {
          const g = (await server.ssrLoadModule('@incantly/generation')) as Generation;
          const json = (status: number, body: unknown) => {
            res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify(body));
          };
          if (path === '/api/dev/session' && req.method === 'POST') {
            const input = (await body(req)) as { apiKey?: unknown; planModel?: unknown; sceneModel?: unknown };
            if (typeof input.apiKey !== 'string' || input.apiKey.trim().length < 20) return json(400, { message: 'Enter a valid Anthropic API key.' });
            if (typeof input.planModel !== 'string' || !models.has(input.planModel)) return json(400, { message: 'Choose a supported planning model.' });
            if (typeof input.sceneModel !== 'string' || !models.has(input.sceneModel)) return json(400, { message: 'Choose a supported scene model.' });
            const id = randomUUID();
            sessions.set(id, { apiKey: input.apiKey.trim(), planModel: input.planModel, sceneModel: input.sceneModel });
            return json(201, { id, baseUrl: `/api/session/${id}/v1` });
          }
          const removeSession = /^\/api\/dev\/session\/([\w-]+)$/.exec(path);
          if (removeSession && req.method === 'DELETE') {
            const id = removeSession[1]!;
            sessions.delete(id);
            const prefix = `/api/session/${id}/v1`;
            const service = services.get(prefix);
            services.delete(prefix);
            await service?.close();
            res.writeHead(204).end();
            return;
          }
          if (path === '/api/dev/token') return json(200, { token: g.mintToken(DEV_SECRET, 'playground-learner', 3600) });
          if (path === '/api/dev/switch') {
            enabled = new URL(req.url ?? '', 'http://x').searchParams.get('on') !== '0';
            return json(200, { enabled });
          }
          if (path === '/api/dev/records') return json(200, [...services.values()].flatMap((s) => s.records.records));
          const session = /^(\/api\/session\/([\w-]+)\/v1)\//.exec(path);
          const faulty = /^(\/api\/fault\/([a-z-]+)\/v1)\//.exec(path);
          const prefix = session ? session[1]! : faulty ? faulty[1]! : '/api/v1';
          const service = await serviceFor(server, prefix, faulty ? faulty[2]! : null);
          await service.handle(req, res);
        })().catch((error: unknown) => {
          res.writeHead(500, { 'content-type': 'text/plain' });
          res.end(String(error));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [generationService()],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  preview: { port: 4173, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
});

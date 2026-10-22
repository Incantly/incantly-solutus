import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/**
 * The generation service, mounted in the dev server for the playground and its
 * browser tests: /api/v1 runs the reference model, and /api/fault/<fault>/v1
 * a reference model that injects that fault, or /api/fault/<fault>-stubborn/v1
 * one whose repairs change nothing. Dev only: /api/dev/token mints a token
 * for a test learner, /api/dev/switch turns generation off and on,
 * /api/dev/records lists the failure records, oldest first,
 * /api/dev/reset?fault=<fault> starts that fault's service afresh, /api/dev/gallery/review
 * accepts or turns down a published figure, as the gallery command does, and
 * /api/dev/gallery/clear empties the gallery.
 *
 * The interactive playground creates an
 * ephemeral Anthropic session at /api/dev/session. Its API key stays only in
 * this process's memory and is addressed from the browser by an opaque id.
 *
 * The dev server also serves a key check at /api/dev/models: it calls
 * Anthropic's models endpoint with the key given in the body, or with the
 * server's ANTHROPIC_API_KEY env var when no key is given, and reports
 * whether it works. Shell env vars win over .env files.
 */
const DEV_SECRET = 'playground-only-secret-never-used-in-production';
const DEV_TICKET_SECRET = 'playground-only-ticket-secret-never-used-in-production';

function anthropicEnv(): { key: string | null; source: string } {
  const env = loadEnv('development', process.cwd(), 'ANTHROPIC_');
  const fromShell = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  const key = fromShell ?? env.ANTHROPIC_API_KEY ?? env.ANTHROPIC_AUTH_TOKEN ?? null;
  return { key, source: fromShell ? 'shell' : key ? '.env' : 'none' };
}

async function keyProbe(key: string): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const answer = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key.trim(), 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!answer.ok) {
      return { ok: false, message: `Anthropic answered ${answer.status} (${answer.statusText || 'request failed'}) for that key.` };
    }
    const payload = (await answer.json()) as { data?: Array<{ id?: string }> };
    const models = (payload.data ?? []).map((m) => m.id ?? '').filter(Boolean).sort();
    return { ok: true, message: `Key works: ${models.length} models visible.`, models };
  } catch (error) {
    return { ok: false, message: `Could not reach Anthropic: ${error instanceof Error ? error.message : String(error)}` };
  }
}

type Generation = typeof import('@incantly/generation');

function generationService(): Plugin {
  let enabled = true;
  // One gallery for every service the dev server mounts, kept in memory.
  let gallery: import('@incantly/generation').MemoryGalleryStore | null = null;
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
    gallery ??= new g.MemoryGalleryStore();
    const service = new g.GenerationService({
      model,
      authenticate: g.hmacAuthenticator(DEV_SECRET),
      records,
      prefix,
      enabled: () => enabled,
      // A real playground call includes planning plus a streamed scene, and a
      // rich scene can stream for minutes. The model-side cap guards silence;
      // the wall here has to be generous enough for a healthy stream.
      generationTimeoutMs: session ? 300_000 : 45_000,
      limits: { ...g.DEFAULT_LIMITS, perMinute: 60, perDay: 1000, concurrent: 6 },
      // Figures that hit a problem while live are repaired in the background (RP-7).
      ticketSecret: DEV_TICKET_SECRET,
      gallery,
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
            const givenKey = typeof input.apiKey === 'string' && input.apiKey.trim().length >= 20 ? input.apiKey.trim() : null;
            const effective = givenKey ?? anthropicEnv().key;
            if (!effective) {
              return json(400, { message: 'Enter a valid Anthropic API key, or set ANTHROPIC_API_KEY in the dev server environment.' });
            }
            if (typeof input.planModel !== 'string' || !models.has(input.planModel)) return json(400, { message: 'Choose a supported planning model.' });
            if (typeof input.sceneModel !== 'string' || !models.has(input.sceneModel)) return json(400, { message: 'Choose a supported scene model.' });
            const id = randomUUID();
            sessions.set(id, { apiKey: effective, planModel: input.planModel, sceneModel: input.sceneModel });
            return json(201, { id, baseUrl: `/api/session/${id}/v1`, keySource: givenKey !== null ? 'entered' : 'env' });
          }
          if (path === '/api/dev/models' && req.method === 'POST') {
            const input = (await body(req)) as { apiKey?: unknown };
            const givenKey = typeof input.apiKey === 'string' && input.apiKey !== '' ? input.apiKey.trim() : null;
            const effective = givenKey ?? anthropicEnv().key;
            if (!effective) {
              return json(400, { ok: false, message: 'No key to check: pass an apiKey in the body or set ANTHROPIC_API_KEY on the dev server.' });
            }
            const probe = await keyProbe(effective);
            return json(probe.ok ? 200 : 401, { ...probe, source: givenKey !== null ? 'entered' : anthropicEnv().source });
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
          if (path === '/api/dev/reset') {
            // A fresh service for one fault, as a new dev server would have: a figure an earlier run approved is not cached.
            const fault = new URL(req.url ?? '', 'http://x').searchParams.get('fault') ?? '';
            return json(200, { reset: /^[a-z-]+$/.test(fault) && services.delete(`/api/fault/${fault}/v1`) });
          }
          if (path === '/api/dev/records') {
            // Every service's records in the order they were made, so the last is the latest whichever service made it.
            const records = [...services.values()].flatMap((s) => s.records.records as Array<{ at?: string }>);
            return json(200, records.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? ''))));
          }
          if (path === '/api/dev/gallery/clear') {
            gallery?.entries.clear();
            return json(200, { cleared: true });
          }
          if (path === '/api/dev/gallery/review') {
            const params = new URL(req.url ?? '', 'http://x').searchParams;
            const entry = gallery ? await gallery.get(params.get('id') ?? '') : null;
            const status = params.get('status');
            if (!entry || !gallery || (status !== 'accepted' && status !== 'rejected')) return json(404, { reviewed: false });
            await gallery.put({ ...entry, status, reviewedAt: new Date().toISOString() });
            return json(200, { reviewed: true });
          }
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

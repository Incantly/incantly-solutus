import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

/**
 * The generation service, mounted in the dev server for the playground and its
 * browser tests: /api/v1 runs the reference model (or Anthropic with
 * INCANTLY_MODEL=anthropic and ANTHROPIC_API_KEY), and /api/fault/<fault>/v1
 * a reference model that injects that fault, or /api/fault/<fault>-stubborn/v1
 * one whose repairs change nothing. Dev only: /api/dev/token mints a token
 * for a test learner, /api/dev/switch turns generation off and on,
 * /api/dev/records lists the failure records, oldest first,
 * /api/dev/reset?fault=<fault> starts that fault's service afresh, /api/dev/gallery/review
 * accepts or turns down a published figure, as the gallery command does, and
 * /api/dev/gallery/clear empties the gallery.
 */
const DEV_SECRET = 'playground-only-secret-never-used-in-production';
const DEV_TICKET_SECRET = 'playground-only-ticket-secret-never-used-in-production';

type Generation = typeof import('@incantly/generation');

function generationService(): Plugin {
  let enabled = true;
  // One gallery for every service the dev server mounts, kept in memory.
  let gallery: import('@incantly/generation').MemoryGalleryStore | null = null;
  const services = new Map<string, { handle(req: IncomingMessage, res: ServerResponse): Promise<void>; records: { records: unknown[] } }>();

  async function serviceFor(server: ViteDevServer, prefix: string, fault: string | null) {
    const existing = services.get(prefix);
    if (existing) return existing;
    const g = (await server.ssrLoadModule('@incantly/generation')) as Generation;
    const stubborn = fault?.endsWith('-stubborn') ?? false;
    const name = (fault ?? 'none').replace(/-stubborn$/, '') as import('@incantly/generation').Fault;
    const model =
      fault === null && process.env.INCANTLY_MODEL === 'anthropic'
        ? new g.AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' })
        : g.referenceModel({ fault: name, stubborn, latencyMs: 250, chunk: 48 });
    const records = new g.MemoryRecords();
    gallery ??= new g.MemoryGalleryStore();
    const service = new g.GenerationService({
      model,
      authenticate: g.hmacAuthenticator(DEV_SECRET),
      records,
      prefix,
      enabled: () => enabled,
      limits: { ...g.DEFAULT_LIMITS, perMinute: 60, perDay: 1000, concurrent: 6 },
      // Figures that hit a problem while live are repaired in the background (RP-7).
      ticketSecret: DEV_TICKET_SECRET,
      gallery,
    });
    const entry = { handle: service.handle, records };
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
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
          };
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
          const faulty = /^(\/api\/fault\/([a-z-]+)\/v1)\//.exec(path);
          const prefix = faulty ? faulty[1]! : '/api/v1';
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

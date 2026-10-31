import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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
 * /api/dev/figures keeps the figures the chat approved, by prompt, in a
 * git-ignored file beside this config: GET lists them, POST keeps one, the
 * latest for a prompt replacing the one before. The gallery draws a prompt
 * card from it in any browser, and it survives a restart of this server.
 *
 * The interactive playground creates an ephemeral model session at
 * /api/dev/session, with Anthropic, Gemini or Amazon Bedrock (open-weight
 * GLM, DeepSeek, Qwen, Kimi and MiniMax models) as its provider. Its API key
 * stays only in this process's memory and is addressed from the browser by an
 * opaque id.
 *
 * The dev server also serves a key check at /api/dev/models: it calls the
 * provider's models endpoint with the key given in the body, or with the
 * server's ANTHROPIC_API_KEY, GEMINI_API_KEY or AWS_BEARER_TOKEN_BEDROCK env
 * var when no key is given, and reports whether it works and, for Gemini and
 * Bedrock, which models the key can reach. Bedrock uses AWS_REGION, default
 * us-east-1. Shell env vars win over .env files.
 */
const DEV_SECRET = 'playground-only-secret-never-used-in-production';
const FIGURES_FILE = fileURLToPath(new URL('./.generated/figures.json', import.meta.url));

interface KeptFigure {
  readonly prompt: string;
  readonly concept: string;
  readonly fragments: { readonly html: string; readonly css: string; readonly js: string };
  readonly approvedAt: string;
}

async function keptFigures(): Promise<KeptFigure[]> {
  try {
    const figures = JSON.parse(await readFile(FIGURES_FILE, 'utf8')) as unknown;
    return Array.isArray(figures) ? (figures as KeptFigure[]) : [];
  } catch {
    return [];
  }
}

/** A figure as the chat sends it, or null: strings only, and no bigger than a scene may be. */
function readFigure(input: unknown): KeptFigure | null {
  if (typeof input !== 'object' || input === null) return null;
  const { prompt, concept, fragments } = input as { prompt?: unknown; concept?: unknown; fragments?: unknown };
  if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > 2000 || typeof concept !== 'string' || concept.length > 200) return null;
  if (typeof fragments !== 'object' || fragments === null) return null;
  const { html, css, js } = fragments as { html?: unknown; css?: unknown; js?: unknown };
  if (typeof html !== 'string' || typeof css !== 'string' || typeof js !== 'string' || html.length + css.length + js.length > 200_000) return null;
  return { prompt: prompt.trim(), concept, fragments: { html, css, js }, approvedAt: new Date().toISOString() };
}
const DEV_TICKET_SECRET = 'playground-only-ticket-secret-never-used-in-production';

type Provider = 'anthropic' | 'gemini' | 'bedrock';

/** The env vars each provider's key may come from, first match winning. */
const KEY_VARS: Readonly<Record<Provider, readonly string[]>> = {
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  bedrock: ['AWS_BEARER_TOKEN_BEDROCK', 'BEDROCK_API_KEY'],
};

const isProvider = (value: unknown): value is Provider => value === 'anthropic' || value === 'gemini' || value === 'bedrock';

/** The dev server's model settings from the .env files beside this config and the shell, the shell winning. */
function devEnv(): Record<string, string> {
  // .env files live beside this config; a dev server started from another directory must still find them.
  const prefixes = ['ANTHROPIC_', 'GEMINI_', 'GOOGLE_', 'AWS_', 'BEDROCK_'];
  return {
    ...loadEnv('development', process.cwd(), prefixes),
    ...loadEnv('development', fileURLToPath(new URL('.', import.meta.url)), prefixes),
  };
}

/** The AWS Region Bedrock calls go to. */
function bedrockRegion(): string {
  const env = devEnv();
  const region = process.env.AWS_REGION ?? process.env.BEDROCK_REGION ?? env.AWS_REGION ?? env.BEDROCK_REGION ?? 'us-east-1';
  return /^[a-z]{2}(-[a-z]+)+-\d$/.test(region) ? region : 'us-east-1';
}

function providerEnv(provider: Provider): { key: string | null; source: string } {
  // .env files live beside this config; a dev server started from another
  // directory must still find them. Shell env vars win over both files.
  const env = devEnv();
  const names = KEY_VARS[provider];
  const fromShell = names.map((name) => process.env[name]).find((value) => value) ?? null;
  const key = fromShell ?? names.map((name) => env[name]).find((value) => value) ?? null;
  return { key, source: fromShell ? 'shell' : key ? '.env' : 'none' };
}

/** Lists the Gemini models a key can reach that write text, newest names first. */
async function geminiProbe(key: string): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const answer = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': key.trim() },
      signal: AbortSignal.timeout(15_000),
    });
    if (!answer.ok) {
      return { ok: false, message: `Google answered ${answer.status} (${answer.statusText || 'request failed'}) for that key.` };
    }
    const payload = (await answer.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    const models = (payload.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => (m.name ?? '').replace(/^models\//, ''))
      .filter((name) => /^gemini-/.test(name) && !/(embedding|image|tts|audio|live|robotics|banana|transcribe|omni|computer-use|customtools)/.test(name))
      .sort()
      .reverse();
    return { ok: true, message: `Key works: ${models.length} Gemini models visible.`, models };
  } catch (error) {
    return { ok: false, message: `Could not reach Google: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Lists the open-weight text models a Bedrock key can reach in the Region:
 * GLM, DeepSeek, Qwen, Kimi and MiniMax, never Anthropic, OpenAI or xAI.
 */
async function bedrockProbe(g: Generation, key: string, region: string): Promise<{ ok: boolean; message: string; models?: string[] }> {
  try {
    const answer = await fetch(`https://bedrock.${region}.amazonaws.com/foundation-models?byOutputModality=TEXT`, {
      headers: { authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!answer.ok) {
      return { ok: false, message: `Bedrock in ${region} answered ${answer.status} (${answer.statusText || 'request failed'}) for that key.` };
    }
    const payload = (await answer.json()) as { modelSummaries?: Array<{ modelId?: string; inferenceTypesSupported?: string[] }> };
    const geo = g.bedrockGeo(region);
    const models = (payload.modelSummaries ?? [])
      .filter((m) => /^(deepseek|qwen|zai|moonshot|moonshotai|minimax)\./.test(m.modelId ?? ''))
      // DeepSeek-R1 and Kimi K2 Thinking have no Chat Completions API on Bedrock.
      .filter((m) => !/^deepseek\.r1|kimi-k2-thinking/.test(m.modelId ?? ''))
      // A model that runs only through a cross-Region profile, such as GLM 5.3 or Kimi K3, is listed by the profile's name.
      .map((m) => (m.inferenceTypesSupported && !m.inferenceTypesSupported.includes('ON_DEMAND') ? `${geo}.${m.modelId}` : m.modelId!))
      .sort();
    return { ok: true, message: `Key works in ${region}: ${models.length} GLM, DeepSeek, Qwen, Kimi and MiniMax models visible.`, models };
  } catch (error) {
    return { ok: false, message: `Could not reach Bedrock: ${error instanceof Error ? error.message : String(error)}` };
  }
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
  const sessions = new Map<string, { provider: Provider; apiKey: string; planModel: string; sceneModel: string }>();
  const anthropicModels = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  // Gemini's and Bedrock's names change often, so any name of the right family is taken; the key check lists the real ones.
  // Bedrock takes only open-weight GLM, DeepSeek, Qwen, Kimi and MiniMax models.
  const supported = (g: Generation, provider: Provider, model: unknown): model is string =>
    typeof model === 'string' &&
    (provider === 'gemini' ? /^gemini-[\w.-]{1,60}$/.test(model) : provider === 'bedrock' ? g.BEDROCK_MODEL.test(model) : anthropicModels.has(model));

  async function body(req: IncomingMessage, limit = 16_384): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) throw new Error('Request body is too large');
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
    if (sessionId && !session) throw new Error('That model session has ended');
    const stubborn = fault?.endsWith('-stubborn') ?? false;
    const name = (fault ?? 'none').replace(/-stubborn$/, '') as import('@incantly/generation').Fault;
    const chosen = session ? { plan: session.planModel, scene: session.sceneModel, repair: session.sceneModel } : null;
    const model =
      session && chosen
        ? session.provider === 'gemini'
          ? new g.GeminiClient({ apiKey: session.apiKey, models: chosen })
          : session.provider === 'bedrock'
            ? new g.BedrockClient({ apiKey: session.apiKey, region: bedrockRegion(), models: chosen })
            : new g.AnthropicClient({ apiKey: session.apiKey, models: chosen })
        : g.referenceModel({ fault: name, stubborn, latencyMs: 250, chunk: 48 });
    const records = new g.MemoryRecords();
    gallery ??= new g.MemoryGalleryStore();
    const service = new g.GenerationService({
      model,
      authenticate: g.hmacAuthenticator(DEV_SECRET),
      records,
      prefix,
      enabled: () => enabled,
      // A real playground call plans (its own two-minute budget) and then
      // streams a scene for up to five minutes, and a repair may join it.
      // The model-side cap guards silence; the wall has room for all three.
      generationTimeoutMs: session ? 420_000 : 45_000,
      // A developer runs many figures a day on their own key: a learner's $1 a day would stop them within the hour.
      limits: { ...g.DEFAULT_LIMITS, perMinute: 60, perDay: 1000, concurrent: 6, learnerDailyUsd: 50 },
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
            const input = (await body(req)) as { provider?: unknown; apiKey?: unknown; planModel?: unknown; sceneModel?: unknown };
            const provider: Provider = isProvider(input.provider) ? input.provider : 'anthropic';
            const givenKey = typeof input.apiKey === 'string' && input.apiKey.trim().length >= 20 ? input.apiKey.trim() : null;
            const effective = givenKey ?? providerEnv(provider).key;
            if (!effective) {
              return json(400, {
                message:
                  provider === 'anthropic'
                    ? 'Enter a valid Anthropic API key, or set ANTHROPIC_API_KEY in the dev server environment.'
                    : `Set ${KEY_VARS[provider][0]} in apps/playground/.env (or the dev server environment) to generate with ${provider === 'gemini' ? 'Gemini' : 'Bedrock'}.`,
              });
            }
            if (!supported(g, provider, input.planModel)) return json(400, { message: 'Choose a supported planning model.' });
            if (!supported(g, provider, input.sceneModel)) return json(400, { message: 'Choose a supported scene model.' });
            const id = randomUUID();
            sessions.set(id, { provider, apiKey: effective, planModel: input.planModel, sceneModel: input.sceneModel });
            return json(201, { id, baseUrl: `/api/session/${id}/v1`, keySource: givenKey !== null ? 'entered' : 'env' });
          }
          if (path === '/api/dev/models' && req.method === 'POST') {
            const input = (await body(req)) as { provider?: unknown; apiKey?: unknown };
            const provider: Provider = isProvider(input.provider) ? input.provider : 'anthropic';
            const givenKey = typeof input.apiKey === 'string' && input.apiKey !== '' ? input.apiKey.trim() : null;
            const effective = givenKey ?? providerEnv(provider).key;
            if (!effective) {
              return json(400, { ok: false, message: `No key to check: pass an apiKey in the body or set ${KEY_VARS[provider][0]} on the dev server.` });
            }
            const probe = provider === 'gemini' ? await geminiProbe(effective) : provider === 'bedrock' ? await bedrockProbe(g, effective, bedrockRegion()) : await keyProbe(effective);
            return json(probe.ok ? 200 : 401, { ...probe, provider, source: givenKey !== null ? 'entered' : providerEnv(provider).source });
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
          if (path === '/api/dev/figures' && req.method === 'GET') return json(200, await keptFigures());
          if (path === '/api/dev/figures' && req.method === 'POST') {
            const figure = readFigure(await body(req, 256_000));
            if (!figure) return json(400, { kept: false });
            const figures = [figure, ...(await keptFigures()).filter((f) => f.prompt !== figure.prompt)].slice(0, 200);
            await mkdir(fileURLToPath(new URL('./.generated/', import.meta.url)), { recursive: true });
            // Written whole, then moved into place, so a reader never sees half a file.
            await writeFile(`${FIGURES_FILE}.tmp`, JSON.stringify(figures, null, 1));
            await rename(`${FIGURES_FILE}.tmp`, FIGURES_FILE);
            return json(200, { kept: true });
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

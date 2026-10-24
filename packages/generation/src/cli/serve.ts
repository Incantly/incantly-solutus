import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { hmacAuthenticator } from '../auth';
import { FileGalleryStore } from '../gallery';
import { DEFAULT_LIMITS, type Limits } from '../limits';
import { AnthropicClient, type ModelClient } from '../models';
import { JsonlRecords } from '../records';
import { referenceModel } from '../reference-model';
import { GenerationService } from '../service';

/**
 * Runs the generation service.
 *
 *   ANTHROPIC_API_KEY            the model provider's key (not needed with INCANTLY_MODEL=reference)
 *   INCANTLY_TOKEN_SECRET        at least 32 characters, shared with the host backend that mints learner tokens
 *   INCANTLY_TICKET_SECRET       at least 32 characters, kept by this service only: signs scenes so figures can be repaired in the background
 *   INCANTLY_MODEL               anthropic (default) or reference, a stand-in that serves the reviewed scenes
 *   INCANTLY_PLAN_MODEL, INCANTLY_SCENE_MODEL   model ids
 *   INCANTLY_MODEL_TIMEOUT_MS    per model call (default 30000)
 *   INCANTLY_GENERATION_TIMEOUT_MS per generation request (default 45000)
 *   INCANTLY_GENERATION=off      starts with generation switched off
 *   INCANTLY_KILL_SWITCH_FILE    generation is off while this file exists
 *   INCANTLY_RECORDS_DIR, INCANTLY_RECORDS_DAYS   failure records and their retention (default 30 days)
 *   INCANTLY_LIMITS              JSON overriding perMinute, perDay, concurrent, learnerDailyUsd, serviceDailyUsd
 *   INCANTLY_ALLOWED_ORIGINS     comma-separated browser origins
 *   INCANTLY_GALLERY_DIR         keeps the community gallery there (needs INCANTLY_TICKET_SECRET); review it with npm run gallery
 *   PORT                         default 8787
 */

const env = process.env;

function model(): ModelClient {
  if (env.INCANTLY_MODEL === 'reference') return referenceModel();
  const plan = env.INCANTLY_PLAN_MODEL;
  const scene = env.INCANTLY_SCENE_MODEL;
  return new AnthropicClient({
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    timeoutMs: Number(env.INCANTLY_MODEL_TIMEOUT_MS ?? 30_000),
    models: { ...(plan ? { plan } : {}), ...(scene ? { scene, repair: scene } : {}) },
  });
}

function limits(): Limits {
  if (!env.INCANTLY_LIMITS) return DEFAULT_LIMITS;
  return { ...DEFAULT_LIMITS, ...(JSON.parse(env.INCANTLY_LIMITS) as Partial<Limits>) };
}

const secret = env.INCANTLY_TOKEN_SECRET ?? '';
const killFile = env.INCANTLY_KILL_SWITCH_FILE;
const recordsDays = Number(env.INCANTLY_RECORDS_DAYS ?? 30);
const records = env.INCANTLY_RECORDS_DIR ? new JsonlRecords(env.INCANTLY_RECORDS_DIR, recordsDays) : null;

const service = new GenerationService({
  model: model(),
  authenticate: hmacAuthenticator(secret),
  limits: limits(),
  enabled: () => env.INCANTLY_GENERATION !== 'off' && !(killFile && existsSync(killFile)),
  records,
  recordsRetentionDays: recordsDays,
  generationTimeoutMs: Number(env.INCANTLY_GENERATION_TIMEOUT_MS ?? 45_000),
  allowedOrigins: (env.INCANTLY_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
  ...(env.INCANTLY_TICKET_SECRET ? { ticketSecret: env.INCANTLY_TICKET_SECRET } : {}),
  ...(env.INCANTLY_GALLERY_DIR ? { gallery: new FileGalleryStore(env.INCANTLY_GALLERY_DIR) } : {}),
});

const purge = () => void records?.purge();
purge();
setInterval(purge, 6 * 3_600_000).unref();

const server = createServer((req, res) => void service.handle(req, res));
const port = Number(env.PORT ?? 8787);
server.listen(port, () => {
  process.stdout.write(`Incantly generation service on :${port}${env.INCANTLY_MODEL === 'reference' ? ' (reference model)' : ''}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void service.close().then(() => server.close(() => process.exit(0)));
  });
}

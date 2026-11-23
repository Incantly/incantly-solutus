/**
 * `GET /v1/health`: the provider, the model ids, and whether a key is set. Never the key. The studio probes it at start
 * to decide whether to use the server.
 */
import type { Context } from './context';

export function health(ctx: Context): void {
  if (!ctx.job.checked()) return;
  const s = ctx.settings;
  ctx.job.json(200, {
    ok: true,
    provider: s.provider,
    keySet: s.keySet,
    // a model endpoint can answer: a client was given, or the provider has a key
    ready: ctx.client !== undefined,
    // `/v1/speech` has a voice to use; otherwise the studio speaks with the browser's voice
    voice: ctx.speech !== undefined,
    models: { text: s.textModels, vision: s.visionModels, speech: s.speechModels },
    limits: { ratePerMinute: s.ratePerMinute, dailyModelCalls: s.dailyModelCalls },
  });
}

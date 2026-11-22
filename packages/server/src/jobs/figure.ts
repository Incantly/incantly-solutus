/**
 * `POST /v1/figure/draw` (docs/features/server/design.md 1, 5, 6; R2.1, R4.1): Tiptap's `AiRequest` in, NDJSON out:
 * `{ lines }` events, then `{ done: true }`, or `{ error }`. The teacher's `streamFigure` runs the plan, script and repair
 * calls against a headless copy of the figure, so every line is checked before it leaves and a failed line never
 * reaches the client. Request: `{ request, mode, script, figure, before, after }`.
 */
import { MODES, MODE_IDS } from '@incantly/modes';
import { createHeadlessApp } from '@incantly/sdk';
import { figureTarget, streamFigure } from '@incantly/teacher';
import { badRequest, fromStreamError, modelUnavailable } from '../errors';
import type { Context } from './context';
import { TURN_MS, jobSignal, meteredClient } from './model';

/** The most characters of what the person asked (design 7: 4,000). */
export const REQUEST_CHARS = 4000;
/** The most characters of a figure's script (the same 64 KB the Tiptap extension holds a figure to). */
export const SCRIPT_CHARS = 64 * 1024;
/** The most characters of document text sent round the figure; the client sends 500 on each side. */
export const AROUND_CHARS = 500;

export async function figureDraw(ctx: Context): Promise<void> {
  const { job, body } = ctx;
  const request = body['request'];
  if (typeof request !== 'string' || request.trim() === '') return job.refuse(badRequest('"request" must be the text of what the figure should show.'));
  if (request.length > REQUEST_CHARS) return job.refuse(badRequest(`"request" has ${request.length} characters; at most ${REQUEST_CHARS}.`));
  const mode = body['mode'];
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) return job.refuse(badRequest('"mode" is not a mode of the app.', `The modes are: ${MODE_IDS.join(', ')}.`));
  const script = body['script'] ?? '';
  if (typeof script !== 'string') return job.refuse(badRequest('"script" must be text.'));
  if (script.length > SCRIPT_CHARS) return job.refuse(badRequest(`"script" has ${script.length} characters; at most ${SCRIPT_CHARS}.`));
  const figure = body['figure'];
  if (figure !== undefined && figure !== null && (typeof figure !== 'object' || Array.isArray(figure))) return job.refuse(badRequest('"figure" must be the figure summary or null.'));
  const material: string[] = [];
  for (const [field, label] of [['before', 'The text before the figure'], ['after', 'The text after the figure']] as const) {
    const text = body[field] ?? '';
    if (typeof text !== 'string') return job.refuse(badRequest(`"${field}" must be text.`));
    const clipped = field === 'before' ? text.slice(-AROUND_CHARS) : text.slice(0, AROUND_CHARS);
    if (clipped.trim() !== '') material.push(`${label}:\n${clipped}`);
  }
  const client = ctx.client;
  if (client === undefined) return job.refuse(modelUnavailable());
  const superseded = new AbortController();
  const slot = ctx.limiter.acquire(ctx.clientId, { exclusive: true, controller: superseded });
  if (!slot.ok) return job.refuse(slot);
  try {
    if (!job.checked()) return;
    const signal = jobSignal(job.abort.signal, superseded.signal);
    const app = createHeadlessApp({ mode: mode as keyof typeof MODES, ...(script !== '' ? { script } : {}) });
    try {
      const target = figureTarget(app, { onFault: (e) => ctx.log('internal', { fingerprint: e.fingerprint, message: e.message }) });
      const events = streamFigure({
        client: meteredClient(client, ctx.limiter),
        target,
        request: { text: request, ...(material.length > 0 ? { material } : {}) },
        signal,
        now: ctx.now,
        limits: { ms: TURN_MS, scriptChars: Math.max(0, SCRIPT_CHARS - script.length) },
      });
      for await (const ev of events) {
        if ('lines' in ev) {
          job.event({ lines: ev.lines });
        } else if ('done' in ev) {
          job.event({ done: true });
          job.end();
        } else if ('error' in ev) {
          const error = fromStreamError(ev.error);
          ctx.log('figure.error', { kind: error.kind });
          job.fail(error);
        }
      }
    } finally {
      app.destroy();
    }
  } finally {
    slot.release();
  }
}

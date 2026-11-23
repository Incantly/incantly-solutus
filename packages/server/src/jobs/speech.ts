/**
 * `POST /v1/speech` (docs/features/server/design.md 1, 6; R7.5): `{ text, model?, instructions? }` in, audio out, as it
 * comes from the provider: `audio/mpeg` from Fish, or `audio/pcm` with `x-sample-rate` from HeyGen. One sentence of at
 * most 500 characters. The voices are tried in order (`providers/speech.ts`), a held `model` first when the caller names
 * one; the answer carries `x-voice`, the voice that spoke, so the studio can hold it for the whole conversation. When none
 * is free the answer is an HTTP error (`model_busy` or `model_unavailable`, nothing was streamed yet) and the studio speaks
 * with the browser's voice. A request counts one tenth in the client's minute, takes no model slot (the studio fetches the
 * next sentences ahead, several at a time) and no model call of the day. The client closing the connection aborts the
 * provider request.
 */
import { badRequest, modelUnavailable, tooLarge } from '../errors';
import type { Context } from './context';

/** The most characters of one sentence (design 6). */
export const SPEECH_CHARS = 500;
/** The most characters of the delivery instructions. */
export const INSTRUCTION_CHARS = 200;
/** The most characters of a held voice model id. */
export const MODEL_CHARS = 200;
/** What a speech request counts in the client's minute: one tenth of a model request (design 6). */
export const SPEECH_WEIGHT = 0.1;
/** The most time one sentence of audio may take, from the request to its last byte. */
export const SPEECH_MS = 30_000;

export async function speech(ctx: Context): Promise<void> {
  const { job, body } = ctx;
  const text = body['text'];
  if (typeof text !== 'string' || text.trim() === '') return job.refuse(badRequest('"text" must be the sentence to say.'));
  if (text.length > SPEECH_CHARS) return job.refuse(tooLarge('"text"', SPEECH_CHARS));
  const instructions = body['instructions'];
  if (instructions !== undefined && typeof instructions !== 'string') return job.refuse(badRequest('"instructions" must be text.'));
  if (typeof instructions === 'string' && instructions.length > INSTRUCTION_CHARS) return job.refuse(tooLarge('"instructions"', INSTRUCTION_CHARS));
  const model = body['model'];
  if (model !== undefined && typeof model !== 'string') return job.refuse(badRequest('"model" must be the voice model id.'));
  if (typeof model === 'string' && model.length > MODEL_CHARS) return job.refuse(tooLarge('"model"', MODEL_CHARS));
  const voices = ctx.speech;
  if (voices === undefined) return job.refuse(modelUnavailable());
  const slot = ctx.limiter.acquire(ctx.clientId, { weight: SPEECH_WEIGHT });
  if (!slot.ok) return job.refuse(slot);
  try {
    if (!job.checked()) return;
    const signal = AbortSignal.any([job.abort.signal, AbortSignal.timeout(SPEECH_MS)]);
    const answer = await voices.speak(
      {
        text,
        ...(typeof model === 'string' && model !== '' ? { preferred: model } : {}),
        ...(typeof instructions === 'string' && instructions.trim() !== '' ? { instructions } : {}),
      },
      signal,
    );
    if (!answer.ok) {
      ctx.log('speech.error', { kind: answer.kind });
      job.fail(answer);
      return;
    }
    // the voice that answered goes back to the caller, so the studio can hold it for the rest of the conversation
    const headers: Record<string, string> = {
      'x-voice': answer.model,
      'access-control-expose-headers': answer.sampleRate !== undefined ? 'x-voice, x-sample-rate' : 'x-voice',
      ...(answer.sampleRate !== undefined ? { 'x-sample-rate': String(answer.sampleRate) } : {}),
    };
    if (!(await job.audio(answer.contentType, headers, answer.first))) {
      // the client left while the voice was starting: the generator is closed so the provider request ends
      await answer.rest.return('cut');
      return;
    }
    ctx.log('speech.start', { model: answer.model, format: answer.contentType });
    for (;;) {
      const step = await answer.rest.next();
      if (step.done === true) {
        if (step.value === 'cut') {
          ctx.log('speech.cut', { model: answer.model });
          job.cut();
        } else {
          job.end();
        }
        return;
      }
      await job.chunk(step.value);
    }
  } finally {
    slot.release();
  }
}

/**
 * `POST /v1/check`: runs lines on a headless copy of the figure and answers the per-line results, as `draw` gives
 * them, with no model. Request: `{ lines: string[], mode?: string, script?: string }`. The lines run in order on a
 * figure that holds the script; a good line commits, a bad one changes nothing.
 */
import { DEFAULT_LIMITS } from '@incantly/kernel';
import { MODES, MODE_IDS } from '@incantly/modes';
import { createHeadlessApp } from '@incantly/sdk';
import { figureTarget, lineResultOf } from '@incantly/teacher';
import { badRequest } from '../errors';
import type { Context } from './context';

/** The most lines one check takes. */
export const CHECK_MAX_LINES = 200;
const UNDEFINED_MAX = 20;

export function check(ctx: Context): void {
  const { job, body } = ctx;
  const lines = body['lines'];
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > CHECK_MAX_LINES) {
    job.refuse(badRequest(`"lines" must be a list of 1 to ${CHECK_MAX_LINES} lines.`));
    return;
  }
  for (let i = 0; i < lines.length; i++) {
    const line: unknown = lines[i];
    if (typeof line !== 'string') return job.refuse(badRequest(`"lines" item ${i + 1} must be text.`));
    if (line.length > DEFAULT_LIMITS.lineLength) return job.refuse(badRequest(`"lines" item ${i + 1} has ${line.length} characters; at most ${DEFAULT_LIMITS.lineLength}.`));
    if (/[\r\n]/.test(line)) return job.refuse(badRequest(`"lines" item ${i + 1} holds more than one line; send one line per item.`));
  }
  const mode = body['mode'] ?? 'graphing';
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) {
    return job.refuse(badRequest('"mode" is not a mode of the app.', `The modes are: ${MODE_IDS.join(', ')}.`));
  }
  const script = body['script'];
  if (script !== undefined && typeof script !== 'string') return job.refuse(badRequest('"script" must be text.'));
  if (!job.checked()) return;
  const app = createHeadlessApp({ mode: mode as keyof typeof MODES, ...(typeof script === 'string' && script !== '' ? { script } : {}) });
  try {
    const target = figureTarget(app);
    const results = target.run(lines as string[]);
    const undef = target.undefinedObjects();
    job.json(200, {
      ok: true,
      mode,
      lines: results.map(lineResultOf),
      applied: results.filter((r) => r.ok).length,
      undefined: undef.slice(0, UNDEFINED_MAX),
      ...(undef.length > UNDEFINED_MAX ? { undefinedOmitted: undef.length - UNDEFINED_MAX } : {}),
    });
  } finally {
    app.destroy();
  }
}

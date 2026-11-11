/**
 * The compact form of an error for a model (docs/features/errors/design.md section 3.5): at most about 800 characters
 * of JSON (no `params`, `messageKey`, `fingerprint`, `committed` or `phase`: errors/agent.md 1), with `forms` capped at 4 and `formsOmitted` counting the rest, `expected` at 8 and `suggest` at 3.
 */
import type { ErrorObject } from '../contracts/errors';

export const COMPACT_LIMIT = 800;

export type CompactError = Partial<Omit<ErrorObject, 'cause'>> & Pick<ErrorObject, 'ok' | 'kind' | 'code' | 'message' | 'line' | 'col' | 'recovery'> & { cause?: CompactError };

/** The compact object. `sentSource` is true when the caller sent the line itself, so `source` is dropped. */
export function compactError(e: ErrorObject, opts: { sentSource?: boolean; limit?: number } = {}): CompactError {
  const limit = opts.limit ?? COMPACT_LIMIT;
  const forms = e.forms.slice(0, 4);
  const omitted = (e.formsOmitted ?? 0) + (e.forms.length - forms.length);
  const out: Record<string, unknown> = {
    ok: false,
    kind: e.kind,
    code: e.code,
    message: e.message,
    line: e.line,
    col: e.col,
    endCol: e.endCol,
    token: e.token,
    recovery: e.recovery,
  };
  if (e.expected.length > 0) out['expected'] = e.expected.slice(0, 8);
  if (forms.length > 0) out['forms'] = forms;
  if (omitted > 0) out['formsOmitted'] = omitted;
  if (e.hint) out['hint'] = e.hint;
  if (e.suggest.length > 0) out['suggest'] = e.suggest.slice(0, 3);
  if (e.path) out['path'] = e.path;
  if (e.related && e.related.length > 0) out['related'] = e.related.slice(0, 4);
  if (e.blockedBy) out['blockedBy'] = e.blockedBy;
  if (e.source !== undefined && !opts.sentSource) out['source'] = e.source;
  if (e.cause) out['cause'] = { kind: e.cause.kind, code: e.cause.code, message: e.cause.message, token: e.cause.token };
  // trim the least useful parts until the size fits
  const size = (): number => JSON.stringify(out).length;
  for (const drop of ['source', 'cause', 'related', 'forms', 'expected', 'endCol']) {
    if (size() <= limit) break;
    delete out[drop];
  }
  if (size() > limit && typeof out['hint'] === 'string') {
    const over = size() - limit;
    const hint = out['hint'];
    out['hint'] = hint.length > over + 1 ? hint.slice(0, hint.length - over - 1) + '…' : '';
    if (out['hint'] === '') delete out['hint'];
  }
  return out as unknown as CompactError;
}

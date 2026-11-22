/**
 * Structured log lines (docs/features/server/design.md 7): one JSON line per event, written to a stream the caller
 * passes. The writer drops `authorization` and every field whose name holds `key` or `token`, never writes a request
 * body, and cuts long texts, so a key or a student's words cannot reach a log by accident. It never throws.
 */

export interface LogStream {
  write(chunk: string): unknown;
}

export type LogFn = (event: string, fields?: Readonly<Record<string, unknown>>) => void;

/** Names whose value is never logged. */
const SECRET = /authorization|key|token|secret|password|cookie/i;
/** Names that hold what a person sent: never logged. */
const BODY = /^(body|bodyText|text|script|messages|prompt|history|material|lines)$/i;
const MAX_TEXT = 200;
const MAX_DEPTH = 3;

/** The value of a field made safe to log. */
export function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (typeof value !== 'object' || value === null) return typeof value === 'function' ? undefined : value;
  if (depth >= MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET.test(k) || BODY.test(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** A log function writing one JSON line per event to `stream`, stamped by `now()`. */
export function createLog(stream: LogStream, now: () => number): LogFn {
  return (event, fields = {}) => {
    try {
      const safe = scrub(fields) as Record<string, unknown>;
      stream.write(`${JSON.stringify({ ...safe, t: now(), event })}\n`);
    } catch {
      // a log that cannot be written must not stop a request
    }
  };
}

/** A log function that writes nothing. */
export const silentLog: LogFn = () => undefined;

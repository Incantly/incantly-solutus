/**
 * The default agent transport (design 11.3): `POST {server}/v1/board/ask` with the request as JSON; the answer is NDJSON,
 * one event a line: `{ say: "…" }`, `{ actions: [...] }`, then `{ done: true }`, or `{ error: { kind, message } }`. It follows Tiptap's
 * `httpTransport` (packages/tiptap/src/ai.ts). A network failure throws; the job turns it into `agent_unavailable` (or
 * `agent_partial` when something was made already). An aborted request ends quietly: the caller aborted it on purpose.
 */
import type { BoardAgentEvent, BoardAgentTransport } from '../core/agent-service';

/** One line of the server's answer as an event, or undefined when it is not one. */
export function parseAgentEvent(line: string): BoardAgentEvent | undefined {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o['say'] === 'string') return { say: o['say'] };
  if (Array.isArray(o['actions'])) return { actions: o['actions'] };
  if (o['done'] === true) return { done: true };
  const e = o['error'];
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    const kind = (e as { kind?: unknown }).kind;
    return { error: { kind: typeof kind === 'string' ? kind : 'error', message: (e as { message: string }).message } };
  }
  return undefined;
}

const badStream = (): BoardAgentEvent => ({ error: { kind: 'bad_stream', message: 'The server sent an answer that is not board actions.' } });

/**
 * The error of an answer that is not `200`: the server's own `kind` and `message` when the body is the SDK error shape
 * (`{ ok: false, kind, message }`), else `http_<status>`. Reading the body never throws.
 */
export async function failedAnswer(res: Response): Promise<{ readonly kind: string; readonly message: string }> {
  try {
    const body: unknown = JSON.parse(await res.text());
    if (typeof body === 'object' && body !== null) {
      const { ok, kind, message } = body as { ok?: unknown; kind?: unknown; message?: unknown };
      if (ok === false && typeof kind === 'string' && kind !== '' && typeof message === 'string' && message !== '') return { kind, message };
    }
  } catch {
    // not JSON, or the body could not be read: the status says it
  }
  return { kind: `http_${res.status}`, message: `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.` };
}

/** The HTTP client for `POST {server}/v1/board/ask`. */
export function httpAgentTransport(server: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): BoardAgentTransport {
  return async function* (request, signal) {
    const url = `${server.trim().replace(/\/+$/, '')}/v1/board/ask`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) {
      yield { error: await failedAnswer(res) };
      return;
    }
    const body = res.body;
    if (!body) {
      for (const l of (await res.text()).split('\n')) {
        if (l.trim() === '') continue;
        const ev = parseAgentEvent(l);
        yield ev ?? badStream();
        if (!ev) return;
      }
      return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const l = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (l.trim() !== '') {
            const ev = parseAgentEvent(l);
            yield ev ?? badStream();
            if (!ev) return;
          }
          nl = buffer.indexOf('\n');
        }
        if (done) break;
      }
      if (buffer.trim() !== '') yield parseAgentEvent(buffer) ?? badStream();
    } finally {
      try {
        await reader.cancel();
      } catch {
        // the stream was already closed
      }
    }
  };
}

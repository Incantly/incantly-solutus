/**
 * The studio and `@incantly/server` (server design 8, R7.2): the dev server proxies `/v1` to the server, so the browser
 * makes same-origin calls. At start the studio asks `GET /v1/health`; where the server answers and a model is ready, the
 * studio's AI uses it, and otherwise nothing changes (Tiptap shows `ai_unavailable`).
 */

/** How long the probe waits before the studio goes on without the server. */
export const PROBE_MS = 1500;

/** What the studio reads of `/v1/health`. */
export interface ServerHealth {
  readonly provider: string;
  /** A model endpoint can answer (a key is set). */
  readonly ready: boolean;
}

/** The health of the server at this origin, or `undefined` when it does not answer. Never throws. */
export async function probeServer(fetchImpl: typeof fetch = (input, init) => fetch(input, init), timeoutMs: number = PROBE_MS): Promise<ServerHealth | undefined> {
  try {
    const res = await fetchImpl('/v1/health', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { ok?: unknown; provider?: unknown; ready?: unknown };
    if (body.ok !== true) return undefined;
    return { provider: typeof body.provider === 'string' ? body.provider : 'unknown', ready: body.ready === true };
  } catch {
    return undefined;
  }
}

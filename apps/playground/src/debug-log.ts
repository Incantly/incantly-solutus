/**
 * The playground's debug log: every learner prompt, every generation request
 * the client actually sent, every refused or failed answer, and what became of
 * each run. Kept in localStorage so a reload keeps the evidence, and copyable
 * as one JSON blob the learner can hand to whoever is fixing the bug.
 */

export type DebugEntry = {
  at: string;
  kind: 'prompt' | 'request' | 'refused' | 'failed' | 'error' | 'done';
  label: string;
  body?: unknown;
  status?: number;
  message?: string;
};

const DEBUG_KEY = 'incantly-playground-debug';
const LIMIT = 40;
const MAX_CHARS = 6000;

function read(): DebugEntry[] {
  try {
    const raw = localStorage.getItem(DEBUG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DebugEntry[]) : [];
  } catch {
    return [];
  }
}

export function loadDebug(): readonly DebugEntry[] {
  return read();
}

export function clearDebug(): void {
  try {
    localStorage.removeItem(DEBUG_KEY);
    // Empty: the log is gone; nothing to say about it.
  } catch {
    // Storage unavailable — a cleared log stays cleared in memory use anyway.
  }
}

export function recordDebug(entry: Omit<DebugEntry, 'at'>): void {
  const list = read();
  list.push({ at: new Date().toISOString(), ...entry });
  while (list.length > LIMIT) list.shift();
  try {
    localStorage.setItem(DEBUG_KEY, JSON.stringify(list));
  } catch {
    list.splice(0, Math.ceil(list.length / 2));
    try {
      localStorage.setItem(DEBUG_KEY, JSON.stringify(list));
    } catch {
      // Storage truly full — drop the retry, the entries still live in memory.
    }
  }
}

function bodyOf(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body.slice(0, MAX_CHARS);
  }
}

function trimmed(value: string): string {
  return value.length > MAX_CHARS ? `${value.slice(0, MAX_CHARS)}…(+${value.length - MAX_CHARS} chars)` : value;
}

/** A fetch that writes into the debug log what it sends and what comes back. */
export function recordingFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input, init) => {
    const label = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    recordDebug({ kind: 'request', label, body: bodyOf(init?.body) });
    try {
      const answer = await base(input, init);
      if (answer.status >= 400) {
        let text = '';
        try {
          text = await answer.clone().text();
        } catch {
          // Unreadable body — an empty text is correct there.
        }
        recordDebug({ kind: 'refused', label, status: answer.status, message: trimmed(text) });
      }
      return answer;
    } catch (error) {
      recordDebug({ kind: 'failed', label, message: trimmed(String(error)) });
      throw error;
    }
  }) as typeof fetch;
}

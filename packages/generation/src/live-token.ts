/**
 * The short-lived Live token the learner's browser uses to open a Gemini
 * Live session directly. The real key never reaches the page: the server
 * mints a single-use token scoped to the Live API and hands that over.
 * See docs/product/live-voice-films.md section 5.4.
 */

/** What the service hands the browser for one Live session. */
export interface LiveToken {
  readonly token: string;
  readonly model: string;
  /** Milliseconds since the epoch when the token stops working. */
  readonly expiresAt: number;
}

/** A minter the service calls per token request; the dev server builds one from the Gemini key. */
export interface LiveTokenMinter {
  mint(): Promise<LiveToken>;
}

export interface GeminiLiveTokenOptions {
  readonly apiKey: string;
  /**
   * The operator accepts that learner audio goes to Google under the Live
   * API's retention terms. Fail-closed: construction throws without it, like
   * Cartesia's CARTESIA_RETENTION_ACCEPTED gate.
   */
  readonly retentionAccepted: boolean;
  readonly fetch?: typeof fetch;
  /** Skips model discovery and mints for this Live model id (without the `models/` prefix). */
  readonly model?: string;
}

/**
 * Whether the operator accepts the Live retention terms for learner audio.
 * Fail-closed: only GEMINI_LIVE_RETENTION_ACCEPTED=1 accepts.
 */
export function geminiLiveRetentionAccepted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GEMINI_LIVE_RETENTION_ACCEPTED === '1';
}

/** Minutes a minted token keeps a Live session alive; the default when the endpoint is asked for none. */
const TOKEN_TTL_MINUTES = 30;
/** Seconds a minted token stays usable for opening a new Live session. */
const NEW_SESSION_WINDOW_SECONDS = 60;

function tokenError(status: number | null, detail: string): Error {
  const where = status === null ? 'Google did not answer' : `Google answered ${status}`;
  return new Error(`${where} for a Live token (${detail})`);
}

interface ListedModel {
  readonly name?: string;
  readonly supportedGenerationMethods?: string[];
}

/**
 * Single-purpose models that speak bidi but cannot teach: transcription and
 * translation models only repeat or convert, robotics models stream control
 * data, and extended-thinking variants reason too slowly for a teacher.
 */
const UNSUITABLE_LIVE_MODELS = /transcribe|translate|robotics|extended-thinking/i;

/** Preferred teachers, fastest conversational Live model first. */
const PREFERRED_LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'];

/** The Live model to mint for: an explicit id wins, else the best listed model that can hold a conversation. */
export function pickLiveModel(models: readonly ListedModel[], explicit?: string): string | null {
  if (explicit && explicit.trim() !== '') return explicit.trim();
  const id = (name: string): string => name.replace(/^models\//, '');
  const usable = models.filter(
    (m) => typeof m.name === 'string' && (m.supportedGenerationMethods ?? []).includes('bidiGenerateContent') && !UNSUITABLE_LIVE_MODELS.test(m.name),
  );
  if (usable.length === 0) return null;
  for (const preferred of PREFERRED_LIVE_MODELS) {
    if (usable.some((m) => id(m.name!) === preferred)) return preferred;
  }
  const live = usable.find((m) => /-live|native-audio/i.test(id(m.name!)));
  return id((live ?? usable[0]!).name!);
}

/**
 * Mints single-use, short-lived Live tokens through the ephemeral token
 * endpoint. Throws unless retention is accepted; never puts the key in an
 * error message. Docs: https://aistudio.google.com/docs/live-api/ephemeral-tokens
 * and https://aistudio.google.com/api-reference/live.
 */
export function geminiLiveTokenMinter(options: GeminiLiveTokenOptions): LiveTokenMinter {
  if (!options.retentionAccepted) {
    throw new Error('Set GEMINI_LIVE_RETENTION_ACCEPTED=1 to mint Live tokens; without it learner audio must not go to Google.');
  }
  if (!options.apiKey || options.apiKey.trim() === '') throw new Error('A Gemini API key is required to mint Live tokens.');
  const key = options.apiKey.trim();
  const fetcher = options.fetch ?? fetch;
  const explicit = options.model?.trim() ? options.model.trim() : undefined;

  /** Lists the models the key can reach, without ever naming the key. */
  async function discoverModel(): Promise<string> {
    let answer: Response;
    try {
      answer = await fetcher('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw tokenError(null, 'could not reach the models list');
    }
    if (!answer.ok) throw tokenError(answer.status, 'the models list was refused');
    let payload: { models?: ListedModel[] };
    try {
      payload = (await answer.json()) as { models?: ListedModel[] };
    } catch {
      throw tokenError(answer.status, 'the models list was unreadable');
    }
    const model = pickLiveModel(payload.models ?? [], explicit);
    if (!model) throw new Error('No Live model is reachable with that key: none lists bidiGenerateContent.');
    return model;
  }

  return {
    async mint(): Promise<LiveToken> {
      const model = explicit ?? (await discoverModel());
      const now = Date.now();
      const body = {
        uses: 1,
        expireTime: new Date(now + TOKEN_TTL_MINUTES * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_SECONDS * 1000).toISOString(),
      };
      let answer: Response;
      try {
        answer = await fetcher('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw tokenError(null, 'could not reach the token endpoint');
      }
      if (!answer.ok) throw tokenError(answer.status, 'the token was refused');
      let payload: { name?: unknown };
      try {
        payload = (await answer.json()) as { name?: unknown };
      } catch {
        throw tokenError(answer.status, 'the token reply was unreadable');
      }
      if (typeof payload.name !== 'string' || payload.name === '') {
        throw new Error('Google minted no Live token: the reply carried no token.');
      }
      return { token: payload.name, model, expiresAt: now + TOKEN_TTL_MINUTES * 60_000 };
    },
  };
}

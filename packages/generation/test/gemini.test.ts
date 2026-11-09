import { describe, expect, it } from 'vitest';
import { planPrompt } from '../src/context';
import { DEFAULT_GEMINI_MODELS, GEMINI_THINKING_HEADROOM, GeminiClient, geminiFallbackModels, geminiThinkingConfig } from '../src/gemini';
import { CONTINUE_PROMPT, ModelError, type ModelCall } from '../src/models';

const encoder = new TextEncoder();

function sse(events: ReadonlyArray<Record<string, unknown>>): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
}

const STREAM = sse([
  { candidates: [{ content: { role: 'model', parts: [{ text: 'Weighing the plan.', thought: true }] } }], modelVersion: 'gemini-3.5-flash-lite' },
  { candidates: [{ content: { role: 'model', parts: [{ text: '```json\n{"concept":' }] } }] },
  {
    candidates: [{ content: { role: 'model', parts: [{ text: ' "sine wave"}\n```' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1300, cachedContentTokenCount: 1200, candidatesTokenCount: 50, thoughtsTokenCount: 7 },
  },
]);

/** A fetch that answers from a queue of responses, streaming bodies in pieces of `chunk` bytes. */
function fakeFetch(responses: Array<{ status?: number; body?: string; hang?: boolean; stall?: boolean }>, chunk = 9) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new TypeError('fetch failed');
    if (next.hang) {
      // Never answers: only the caller's signal ends it, as with an overloaded model.
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
        else init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    }
    const bytes = encoder.encode(next.body ?? '');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
        if (next.stall) {
          // Streams what it has, then goes quiet; the caller's timeout or signal must end it.
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          return;
        }
        controller.close();
      },
    });
    return new Response(body, { status: next.status ?? 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetcher, requests };
}

/** The parts of a Gemini request body the tests read. */
interface GeminiBody {
  readonly systemInstruction: { readonly parts: ReadonlyArray<{ readonly text: string }> };
  readonly contents: ReadonlyArray<{ readonly role: string; readonly parts: ReadonlyArray<{ readonly text: string }> }>;
  readonly generationConfig: { readonly maxOutputTokens?: number; readonly thinkingConfig?: unknown };
}

const call = (overrides: Partial<ModelCall> = {}): ModelCall => ({
  purpose: 'plan',
  prompt: planPrompt({ prompt: 'Show me a sine wave' }),
  maxTokens: 2000,
  ...overrides,
});

describe('the Gemini client', () => {
  it('sends the fixed blocks as the system instruction, one user turn and low thinking', async () => {
    const { fetcher, requests } = fakeFetch([{ body: STREAM }]);
    await new GeminiClient({ apiKey: 'test-key', fetch: fetcher }).complete(call());
    const { url, init } = requests[0]!;
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODELS.plan}:streamGenerateContent?alt=sse`);
    // The key goes in a header, never in the URL.
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    expect(url).not.toContain('test-key');
    const body = JSON.parse(String(init.body)) as GeminiBody;
    expect(body.systemInstruction.parts).toEqual([{ text: expect.stringContaining('Rules for every scene') }, { text: expect.stringContaining('PLAN format') }]);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: expect.stringContaining('Show me a sine wave') }] }]);
    expect(body.generationConfig).toEqual({ maxOutputTokens: 2000 + GEMINI_THINKING_HEADROOM, thinkingConfig: { thinkingLevel: 'low' } });
  });

  it('streams the text, never the thinking, and counts cached and thinking tokens', async () => {
    const { fetcher } = fakeFetch([{ body: STREAM }]);
    const seen: string[] = [];
    const reply = await new GeminiClient({ apiKey: 'k', fetch: fetcher }).complete(call({ onText: (d) => seen.push(d) }));
    expect(reply.text).toBe('```json\n{"concept": "sine wave"}\n```');
    expect(seen.join('')).toBe(reply.text);
    expect(reply.stopReason).toBe('end_turn');
    expect(reply.model).toBe('gemini-3.5-flash-lite');
    expect(reply.usage).toEqual({ inputTokens: 100, outputTokens: 57, cacheReadTokens: 1200, cacheWriteTokens: 0 });
    expect(reply.firstTextMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a reply cut off at the limit as max_tokens, and asks for the rest as a model turn', async () => {
    const cut = sse([{ candidates: [{ content: { parts: [{ text: 'half a scene' }] }, finishReason: 'MAX_TOKENS' }] }]);
    const { fetcher, requests } = fakeFetch([{ body: cut }, { body: STREAM }]);
    const client = new GeminiClient({ apiKey: 'k', fetch: fetcher });
    expect((await client.complete(call())).stopReason).toBe('max_tokens');
    await client.complete(call({ continueFrom: 'half a scene' }));
    const body = JSON.parse(String(requests[1]!.init.body)) as GeminiBody;
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.contents[1]!.parts[0]!.text).toBe('half a scene');
    expect(body.contents[2]!.parts[0]!.text).toBe(CONTINUE_PROMPT);
  });

  it('turns thinking down the way each model accepts', () => {
    expect(geminiThinkingConfig('gemini-3.8-flash', 'low')).toEqual({ thinkingLevel: 'low' });
    expect(geminiThinkingConfig('gemini-2.5-flash', 'low')).toEqual({ thinkingBudget: 0 });
    expect(geminiThinkingConfig('gemini-2.5-pro', 'low')).toEqual({});
    // With thinking off, the reply's cap needs no room for it.
    const old = new GeminiClient({ apiKey: 'k', models: { plan: 'gemini-2.5-flash' } });
    expect((old.body(call()).generationConfig as Record<string, unknown>).maxOutputTokens).toBe(2000);
  });

  it('asks again without a thinking setting when a model refuses it', async () => {
    const refused = JSON.stringify({ error: { code: 400, message: 'Thinking level is not supported for this model.', status: 'INVALID_ARGUMENT' } });
    const { fetcher, requests } = fakeFetch([{ status: 400, body: refused }, { body: STREAM }]);
    const reply = await new GeminiClient({ apiKey: 'k', fetch: fetcher, retries: 0 }).complete(call());
    expect(reply.text).toContain('sine wave');
    expect((JSON.parse(String(requests[1]!.init.body)) as GeminiBody).generationConfig.thinkingConfig).toBeUndefined();
  });
});

describe('Gemini resilience', () => {
  // A reply whose events carry no model version: the reply names the model that was asked.
  const plain = (text: string) => sse([{ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }]);

  it('treats a model that never responds as overloaded and falls back, naming the model that answered', async () => {
    const { fetcher, requests } = fakeFetch([{ hang: true }, { hang: true }, { body: plain('hello from the fallback') }]);
    const reply = await new GeminiClient({ apiKey: 'k', fetch: fetcher, firstResponseMs: 40, fallbacks: { plan: ['gemini-3-flash-preview'] } }).complete(call());
    expect(reply.text).toBe('hello from the fallback');
    expect(reply.model).toBe('gemini-3-flash-preview');
    // One retry on the silent primary, then the fallback at once.
    expect(requests).toHaveLength(3);
    expect(requests[0]!.url).toContain(DEFAULT_GEMINI_MODELS.plan);
    expect(requests[2]!.url).toContain('gemini-3-flash-preview');
  });

  it('retries a 503 and then falls back', async () => {
    const down = JSON.stringify({ error: { code: 503, message: 'Service unavailable.', status: 'UNAVAILABLE' } });
    const { fetcher, requests } = fakeFetch([{ status: 503, body: down }, { status: 503, body: down }, { body: plain('recovered') }]);
    const reply = await new GeminiClient({ apiKey: 'k', fetch: fetcher, fallbacks: { plan: ['gemini-3-flash-preview'] } }).complete(call());
    expect(reply.text).toBe('recovered');
    expect(reply.model).toBe('gemini-3-flash-preview');
    expect(requests).toHaveLength(3);
    expect(requests[0]!.url).toContain(DEFAULT_GEMINI_MODELS.plan);
    expect(requests[1]!.url).toContain(DEFAULT_GEMINI_MODELS.plan);
    expect(requests[2]!.url).toContain('gemini-3-flash-preview');
  });

  it('does not retry or fall back once text has streamed', async () => {
    const { fetcher, requests } = fakeFetch([{ body: plain('half a scene'), stall: true }]);
    const error = await new GeminiClient({ apiKey: 'k', fetch: fetcher, timeoutMs: 60, firstResponseMs: 1000, fallbacks: { plan: ['other'] } })
      .complete(call())
      .catch((e: unknown) => e);
    expect((error as ModelError).kind).toBe('timeout');
    expect(requests).toHaveLength(1);
  });

  it('does not fall back when the call is cancelled', async () => {
    const cancel = new AbortController();
    const { fetcher, requests } = fakeFetch([{ hang: true }, { body: plain('late') }]);
    const pending = new GeminiClient({ apiKey: 'k', fetch: fetcher, firstResponseMs: 30, fallbacks: { plan: ['other'] } })
      .complete(call({ signal: cancel.signal }))
      .catch((e: unknown) => e);
    setTimeout(() => cancel.abort(), 10);
    expect(((await pending) as ModelError).kind).toBe('aborted');
    expect(requests).toHaveLength(1);
  });

  it('derives fallbacks from a key check list: measured order first, then newest', () => {
    // What the key check lists for this key, newest names first. The default
    // scene model answers fastest, so it is chosen; the chain starts with the
    // measured runners-up, then the remaining text flash models newest-first.
    const listed = [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.1-flash-image-preview',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-flash-preview',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-live-preview',
      'gemini-2.5-flash-preview-tts',
      'gemini-2.5-flash-native-audio-dialog',
      'gemini-2.5-flash',
      'gemini-3.5-transcribe-live',
    ].map((id) => ({ id, methods: ['generateContent'] as readonly string[] }));
    expect(geminiFallbackModels(listed, { plan: 'gemini-3.5-flash-lite', scene: 'gemini-3-flash-preview' })).toEqual({
      plan: [],
      scene: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
      repair: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
    });
    // An entry whose listed methods leave out generateContent is skipped, and
    // one with no methods listed is kept: the probe cannot always say.
    const methods = listed.map((entry) =>
      entry.id === 'gemini-3.6-flash' ? { ...entry, methods: ['embedContent'] as readonly string[] } : entry.id === 'gemini-2.5-flash' ? { id: entry.id } : entry,
    );
    expect(geminiFallbackModels(methods, { plan: 'gemini-3.5-flash-lite', scene: 'gemini-3-flash-preview' }).scene).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
    ]);
  });

  it('skips a retired model with a 404 and tries the next fallback, without spending retries on it', async () => {
    const gone = (id: string) => JSON.stringify({ error: { code: 404, message: `Model ${id} is no longer available to new users.`, status: 'NOT_FOUND' } });
    const { fetcher, requests } = fakeFetch([
      { status: 404, body: gone(DEFAULT_GEMINI_MODELS.plan) },
      { status: 404, body: gone('gemini-2.5-flash') },
      { body: plain('answered') },
    ]);
    const reply = await new GeminiClient({ apiKey: 'k', fetch: fetcher, fallbacks: { plan: ['gemini-2.5-flash', 'gemini-3-flash-preview'] } }).complete(call());
    expect(reply.text).toBe('answered');
    expect(reply.model).toBe('gemini-3-flash-preview');
    // One try each: a 404 is never retried, on the primary or a fallback.
    expect(requests).toHaveLength(3);
  });

  it('does not fall back on other client errors', async () => {
    const bad = JSON.stringify({ error: { code: 400, message: 'The request was malformed.', status: 'INVALID_ARGUMENT' } });
    const { fetcher, requests } = fakeFetch([{ status: 400, body: bad }]);
    const error = await new GeminiClient({ apiKey: 'k', fetch: fetcher, fallbacks: { plan: ['other'] } }).complete(call()).catch((e: unknown) => e);
    expect((error as ModelError).kind).toBe('invalid-request');
    expect(requests).toHaveLength(1);
  });

  it('asks a fallback model again without thinking when it refuses the setting', async () => {
    const down = JSON.stringify({ error: { code: 503, message: 'Service unavailable.', status: 'UNAVAILABLE' } });
    const refused = JSON.stringify({ error: { code: 400, message: 'Thinking level is not supported for this model.', status: 'INVALID_ARGUMENT' } });
    const { fetcher, requests } = fakeFetch([{ status: 503, body: down }, { status: 400, body: refused }, { body: plain('no thinking needed') }]);
    const reply = await new GeminiClient({ apiKey: 'k', fetch: fetcher, retries: 0, fallbacks: { plan: ['gemini-3-flash-preview'] } }).complete(call());
    expect(reply.text).toBe('no thinking needed');
    expect(reply.model).toBe('gemini-3-flash-preview');
    expect(requests).toHaveLength(3);
    const bodies = requests.map((r) => JSON.parse(String(r.init.body)) as GeminiBody);
    expect(bodies[1]!.generationConfig.thinkingConfig).toBeDefined();
    expect(bodies[2]!.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('turns a spent quota, a bad key and a blocked prompt into model errors the pipeline knows', async () => {
    const quota = JSON.stringify({ error: { code: 429, message: 'Quota exceeded.', status: 'RESOURCE_EXHAUSTED' } });
    const key = JSON.stringify({ error: { code: 403, message: 'API key not valid.', status: 'PERMISSION_DENIED' } });
    const blocked = sse([{ promptFeedback: { blockReason: 'SAFETY' } }]);
    const errorOf = async (status: number, body: string) =>
      new GeminiClient({ apiKey: 'k', retries: 0, fetch: fakeFetch([{ status, body }]).fetcher }).complete(call()).then(
        () => new ModelError('protocol', 'no error was thrown'),
        (e: unknown) => e as ModelError,
      );
    expect((await errorOf(429, quota)).kind).toBe('rate-limited');
    expect((await errorOf(403, key)).kind).toBe('auth');
    const refused = await errorOf(200, blocked);
    expect(refused.kind).toBe('invalid-request');
    expect(refused.message).toContain('SAFETY');
  });
});

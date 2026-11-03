import { describe, expect, it } from 'vitest';
import { planPrompt } from '../src/context';
import { CONTINUE_PROMPT, ModelError, costOf, type ModelCall } from '../src/models';
import { DEFAULT_SPARK_MODELS, SPARK_MODEL, SparkClient } from '../src/spark';

const encoder = new TextEncoder();

function sse(events: ReadonlyArray<Record<string, unknown> | '[DONE]'>): string {
  return events.map((e) => `data: ${e === '[DONE]' ? e : JSON.stringify(e)}\n\n`).join('');
}

const STREAM = sse([
  { model: 'muse-spark-1.3-contributor', choices: [{ delta: { role: 'assistant' } }] },
  { choices: [{ delta: { content: '```json\n{"concept":' } }] },
  { choices: [{ delta: { content: ' "sine wave"}\n```' }, finish_reason: 'stop' }] },
  { choices: [], usage: { prompt_tokens: 1300, completion_tokens: 57, prompt_tokens_details: { cached_tokens: 1200 } } },
  '[DONE]',
]);

/** A fetch that answers from a queue of responses, streaming bodies in pieces of `chunk` bytes. */
function fakeFetch(responses: Array<{ status?: number; body: string }>, chunk = 11) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new TypeError('fetch failed');
    const bytes = encoder.encode(next.body);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
        controller.close();
      },
    });
    return new Response(body, { status: next.status ?? 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { fetcher, requests };
}

/** The parts of a Chat Completions request body the tests read. */
interface ChatBody {
  readonly model: string;
  readonly max_completion_tokens: number;
  readonly reasoning_effort?: string;
  readonly stream_options?: unknown;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
}

const call = (overrides: Partial<ModelCall> = {}): ModelCall => ({
  purpose: 'plan',
  prompt: planPrompt({ prompt: 'Show me a sine wave' }),
  maxTokens: 2000,
  ...overrides,
});

const sent = (init: RequestInit) => JSON.parse(String(init.body)) as ChatBody;

describe('the Spark client', () => {
  it('sends one system message, the user turn and low reasoning to Model API’s Chat Completions endpoint', async () => {
    const { fetcher, requests } = fakeFetch([{ body: STREAM }]);
    await new SparkClient({ apiKey: 'meta-key', fetch: fetcher }).complete(call());
    const { url, init } = requests[0]!;
    expect(url).toBe('https://api.meta.ai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer meta-key');
    const body = sent(init);
    expect(body).toMatchObject({ model: DEFAULT_SPARK_MODELS.plan, max_completion_tokens: 2000, reasoning_effort: 'low', stream_options: { include_usage: true } });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[0]!.content).toContain('Rules for every scene');
    expect(body.messages[0]!.content).toContain('PLAN format');
  });

  it('streams the reply and counts cached tokens apart', async () => {
    const { fetcher } = fakeFetch([{ body: STREAM }]);
    const seen: string[] = [];
    const reply = await new SparkClient({ apiKey: 'k', fetch: fetcher }).complete(call({ onText: (d) => seen.push(d) }));
    expect(reply.text).toBe('```json\n{"concept": "sine wave"}\n```');
    expect(seen.join('')).toBe(reply.text);
    expect(reply.stopReason).toBe('end_turn');
    expect(reply.model).toBe('muse-spark-1.3-contributor');
    expect(reply.usage).toEqual({ inputTokens: 100, outputTokens: 57, cacheReadTokens: 1200, cacheWriteTokens: 0 });
  });

  it('reports a reply cut off at the limit as max_tokens, and asks for the rest as an assistant turn', async () => {
    const cut = sse([{ choices: [{ delta: { content: 'half a scene' }, finish_reason: 'length' }] }, '[DONE]']);
    const { fetcher, requests } = fakeFetch([{ body: cut }, { body: STREAM }]);
    const client = new SparkClient({ apiKey: 'k', fetch: fetcher });
    expect((await client.complete(call())).stopReason).toBe('max_tokens');
    await client.complete(call({ continueFrom: 'half a scene' }));
    const body = sent(requests[1]!.init);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(body.messages[2]!.content).toBe('half a scene');
    expect(body.messages[3]!.content).toBe(CONTINUE_PROMPT);
  });

  it('asks again without streamed usage when Model API refuses it, and remembers that', async () => {
    const refused = JSON.stringify({ error: { message: 'Unsupported parameter: stream_options' } });
    const { fetcher, requests } = fakeFetch([{ status: 400, body: refused }, { body: STREAM }, { body: STREAM }]);
    const client = new SparkClient({ apiKey: 'k', fetch: fetcher, retries: 0 });
    await client.complete(call());
    expect(sent(requests[1]!.init).stream_options).toBeUndefined();
    await client.complete(call());
    expect(sent(requests[2]!.init).stream_options).toBeUndefined();
  });

  it('asks again without a reasoning effort when a model refuses it, and with half the length when it refuses that', async () => {
    const effort = JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } });
    const { fetcher, requests } = fakeFetch([{ status: 400, body: effort }, { body: STREAM }]);
    await new SparkClient({ apiKey: 'k', fetch: fetcher, retries: 0 }).complete(call());
    expect(sent(requests[1]!.init).reasoning_effort).toBeUndefined();
    const length = JSON.stringify({ error: { message: 'max_completion_tokens exceeds the model limit' } });
    const retry = fakeFetch([{ status: 400, body: length }, { body: STREAM }]);
    await new SparkClient({ apiKey: 'k', fetch: retry.fetcher, retries: 0 }).complete(call({ maxTokens: 14_000 }));
    expect(sent(retry.requests[1]!.init).max_completion_tokens).toBe(7_000);
  });

  it('takes the Muse text models, and refuses open-weight, image and other providers’ models', () => {
    for (const model of ['muse-spark-1.3', 'muse-spark-1.3-contributor', 'muse-spark-1.2', 'muse-spark-1.2-contributor', 'muse-spark-1.1', 'muse-wonder-1.0']) {
      expect(SPARK_MODEL.test(model), model).toBe(true);
    }
    for (const model of ['muse-spark-1.4', 'muse-spark-open', 'muse-glimmer-1.0', 'muse-image-1.0', 'claude-sonnet-5-5', 'gemini-3.8-flash']) {
      expect(SPARK_MODEL.test(model), model).toBe(false);
      expect(() => new SparkClient({ apiKey: 'k', models: { scene: model } }), model).toThrow(/Muse Spark and Muse Wonder/);
    }
  });

  it('turns a bad key and a throttled call into model errors the pipeline knows, and prices the reply', async () => {
    const errorOf = async (status: number, body: string) =>
      new SparkClient({ apiKey: 'k', retries: 0, fetch: fakeFetch([{ status, body }]).fetcher }).complete(call()).then(
        () => new ModelError('protocol', 'no error was thrown'),
        (e: unknown) => e as ModelError,
      );
    const badKey = await errorOf(401, JSON.stringify({ error: { message: 'Invalid API key' } }));
    expect(badKey.kind).toBe('auth');
    expect(badKey.message).toContain('Invalid API key');
    expect((await errorOf(429, JSON.stringify({ error: { message: 'Rate limit exceeded' } }))).kind).toBe('rate-limited');
    // The Contributor reply above: 100 input + 1200 cached at $0.10/$0.002, 57 output at $0.20.
    const usage = { inputTokens: 100, outputTokens: 57, cacheReadTokens: 1200, cacheWriteTokens: 0 };
    expect(costOf('muse-spark-1.3-contributor', usage)).toBeCloseTo((100 * 0.1 + 1200 * 0.002 + 57 * 0.2) / 1_000_000, 10);
    expect(costOf('muse-wonder-1.0', usage)).toBeCloseTo((100 * 4 + 1200 * 0.2 + 57 * 20) / 1_000_000, 10);
  });
});

import { describe, expect, it } from 'vitest';
import { BEDROCK_MODEL, BedrockClient, DEFAULT_BEDROCK_MODELS } from '../src/bedrock';
import { planPrompt } from '../src/context';
import { CONTINUE_PROMPT, ModelError, type ModelCall } from '../src/models';

const encoder = new TextEncoder();

function sse(events: ReadonlyArray<Record<string, unknown> | '[DONE]'>): string {
  return events.map((e) => `data: ${e === '[DONE]' ? e : JSON.stringify(e)}\n\n`).join('');
}

const STREAM = sse([
  { model: 'zai.glm-4.7-flash', choices: [{ delta: { role: 'assistant', reasoning_content: 'Weighing the plan.' } }] },
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
  readonly max_tokens: number;
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

describe('the Bedrock client', () => {
  it('sends one system message, the user turn and low reasoning to the Region’s Chat Completions endpoint', async () => {
    const { fetcher, requests } = fakeFetch([{ body: STREAM }]);
    await new BedrockClient({ apiKey: 'bedrock-key', region: 'us-west-2', fetch: fetcher }).complete(call());
    const { url, init } = requests[0]!;
    expect(url).toBe('https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer bedrock-key');
    const body = sent(init);
    expect(body).toMatchObject({ model: DEFAULT_BEDROCK_MODELS.plan, max_tokens: 2000, reasoning_effort: 'low', stream_options: { include_usage: true } });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[0]!.content).toContain('Rules for every scene');
    expect(body.messages[0]!.content).toContain('PLAN format');
  });

  it('streams the reply, never the reasoning, and counts cached tokens apart', async () => {
    const { fetcher } = fakeFetch([{ body: STREAM }]);
    const seen: string[] = [];
    const reply = await new BedrockClient({ apiKey: 'k', fetch: fetcher }).complete(call({ onText: (d) => seen.push(d) }));
    expect(reply.text).toBe('```json\n{"concept": "sine wave"}\n```');
    expect(seen.join('')).toBe(reply.text);
    expect(reply.stopReason).toBe('end_turn');
    expect(reply.model).toBe('zai.glm-4.7-flash');
    expect(reply.usage).toEqual({ inputTokens: 100, outputTokens: 57, cacheReadTokens: 1200, cacheWriteTokens: 0 });
  });

  it('reports a reply cut off at the limit as max_tokens, and asks for the rest as an assistant turn', async () => {
    const cut = sse([{ choices: [{ delta: { content: 'half a scene' }, finish_reason: 'length' }] }, '[DONE]']);
    const { fetcher, requests } = fakeFetch([{ body: cut }, { body: STREAM }]);
    const client = new BedrockClient({ apiKey: 'k', fetch: fetcher });
    expect((await client.complete(call())).stopReason).toBe('max_tokens');
    await client.complete(call({ continueFrom: 'half a scene' }));
    const body = sent(requests[1]!.init);
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(body.messages[2]!.content).toBe('half a scene');
    expect(body.messages[3]!.content).toBe(CONTINUE_PROMPT);
  });

  it('asks DeepSeek for no more than its 8K reply, and halves the reply when a model refuses its length', async () => {
    const deepseek = new BedrockClient({ apiKey: 'k', models: { scene: 'deepseek.v3.2' } });
    expect(deepseek.body(call({ purpose: 'scene', maxTokens: 14_000 })).max_tokens).toBe(8_192);
    const refused = JSON.stringify({ message: 'max_tokens exceeds the model limit of 8192' });
    const { fetcher, requests } = fakeFetch([{ status: 400, body: refused }, { body: STREAM }]);
    await new BedrockClient({ apiKey: 'k', fetch: fetcher, retries: 0, models: { scene: 'qwen.qwen3-32b-v1:0' } }).complete(call({ purpose: 'scene', maxTokens: 14_000 }));
    expect(sent(requests[1]!.init).max_tokens).toBe(7_000);
  });

  it('asks again without a reasoning effort when a model refuses it', async () => {
    const refused = JSON.stringify({ message: 'Unsupported parameter: reasoning_effort' });
    const { fetcher, requests } = fakeFetch([{ status: 400, body: refused }, { body: STREAM }]);
    await new BedrockClient({ apiKey: 'k', fetch: fetcher, retries: 0 }).complete(call());
    expect(sent(requests[1]!.init).reasoning_effort).toBeUndefined();
  });

  it('takes GLM, DeepSeek, Qwen, Kimi and MiniMax, and refuses Anthropic, OpenAI and xAI models', () => {
    for (const model of ['zai.glm-4.7', 'us.zai.glm-5.3', 'deepseek.v3.2', 'qwen.qwen3-32b-v1:0', 'moonshotai.kimi-k2.5', 'minimax.minimax-m2.5']) {
      expect(BEDROCK_MODEL.test(model), model).toBe(true);
    }
    for (const model of ['anthropic.claude-sonnet-4-6', 'us.anthropic.claude-opus-4-8', 'openai.gpt-oss-120b-1:0', 'xai.grok-4']) {
      expect(BEDROCK_MODEL.test(model), model).toBe(false);
      expect(() => new BedrockClient({ apiKey: 'k', models: { scene: model } }), model).toThrow(/GLM, DeepSeek, Qwen, Kimi and MiniMax/);
    }
  });

  it('turns a throttled call, a bad key and an AWS error body into model errors the pipeline knows', async () => {
    const errorOf = async (status: number, body: string) =>
      new BedrockClient({ apiKey: 'k', retries: 0, fetch: fakeFetch([{ status, body }]).fetcher }).complete(call()).then(
        () => new ModelError('protocol', 'no error was thrown'),
        (e: unknown) => e as ModelError,
      );
    const throttled = await errorOf(429, JSON.stringify({ message: 'Too many requests, please wait before trying again.' }));
    expect(throttled.kind).toBe('rate-limited');
    expect(throttled.message).toContain('Too many requests');
    expect((await errorOf(403, JSON.stringify({ Message: 'The security token included in the request is invalid.' }))).kind).toBe('auth');
  });
});

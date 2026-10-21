import { describe, expect, it } from 'vitest';
import { planPrompt } from '../src/context';
import { AnthropicClient, DEFAULT_MODELS, ModelError, ScriptedModel, costOf, thinkingField, type ModelCall } from '../src/models';

const encoder = new TextEncoder();

function sse(events: ReadonlyArray<Record<string, unknown>>): string {
  return events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

const STREAM = sse([
  {
    type: 'message_start',
    message: { model: 'claude-haiku-5-5', usage: { input_tokens: 40, output_tokens: 1, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 } },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think about the plan.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'ping' },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '```json\n{"concept":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' "sine wave"}\n```' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 57 } },
  { type: 'message_stop' },
]);

/** A fetch that answers from a queue of responses, streaming bodies in pieces of `chunk` bytes. */
function fakeFetch(responses: Array<{ status?: number; body: string; stall?: boolean }>, chunk = 7) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new TypeError('fetch failed');
    const bytes = encoder.encode(next.body);
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
        if (next.stall) {
          // Never closes; the caller's timeout or signal must end it.
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

const call = (overrides: Partial<ModelCall> = {}): ModelCall => ({
  purpose: 'plan',
  prompt: planPrompt({ prompt: 'Show me a sine wave' }),
  maxTokens: 2000,
  ...overrides,
});

describe('the Anthropic client', () => {
  it('sends the cached system blocks, one user turn and the effort for the call', async () => {
    const { fetcher, requests } = fakeFetch([{ body: STREAM }]);
    const client = new AnthropicClient({ apiKey: 'test-key', fetch: fetcher });
    await client.complete(call());
    const { url, init } = requests[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: DEFAULT_MODELS.plan, max_tokens: 2000, stream: true, output_config: { effort: 'low' } });
    // Thinking is off by default: the plan model takes `disabled`.
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.system).toEqual([
      { type: 'text', text: expect.stringContaining('Rules for every scene'), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: expect.stringContaining('PLAN format'), cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining('Show me a sine wave') }]);
  });

  it('turns thinking off the way each model accepts, or leaves it adaptive when asked', () => {
    expect(thinkingField('claude-sonnet-5-5', 'off')).toEqual({ type: 'between_tools' });
    expect(thinkingField('claude-haiku-5-5', 'off')).toEqual({ type: 'disabled' });
    expect(thinkingField('claude-sonnet-5-5', 'adaptive')).toBeNull();
    const client = new AnthropicClient({ apiKey: 'k', thinking: { scene: 'adaptive' } });
    expect(client.body(call({ purpose: 'scene' })).thinking).toBeUndefined();
    expect(client.body(call({ purpose: 'repair' })).thinking).toEqual({ type: 'between_tools' });
  });

  it('streams the text, never the thinking, and reads usage with cache counts', async () => {
    const { fetcher } = fakeFetch([{ body: STREAM }], 5);
    const client = new AnthropicClient({ apiKey: 'k', fetch: fetcher });
    const pieces: string[] = [];
    const reply = await client.complete(call({ onText: (t) => pieces.push(t) }));
    expect(reply.text).toBe('```json\n{"concept": "sine wave"}\n```');
    expect(pieces.join('')).toBe(reply.text);
    expect(reply.text).not.toContain('think');
    expect(reply.usage).toEqual({ inputTokens: 40, outputTokens: 57, cacheReadTokens: 1200, cacheWriteTokens: 0 });
    expect(reply.stopReason).toBe('end_turn');
    expect(reply.model).toBe('claude-haiku-5-5');
  });

  it('retries once when the provider is busy, and not after an authentication failure', async () => {
    const busy = fakeFetch([{ status: 529, body: '{"error":{"message":"Overloaded"}}' }, { body: STREAM }]);
    const reply = await new AnthropicClient({ apiKey: 'k', fetch: busy.fetcher }).complete(call());
    expect(reply.text).toContain('sine wave');
    expect(busy.requests).toHaveLength(2);

    const denied = fakeFetch([{ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }, { body: STREAM }]);
    const error = await new AnthropicClient({ apiKey: 'k', fetch: denied.fetcher }).complete(call()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe('auth');
    expect((error as ModelError).message).toContain('invalid x-api-key');
    expect(denied.requests).toHaveLength(1);
  });

  it('does not retry once text has streamed', async () => {
    const broken = sse([
      { type: 'message_start', message: { model: 'm', usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '```html\n' } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]);
    const { fetcher, requests } = fakeFetch([{ body: broken }, { body: STREAM }]);
    const error = await new AnthropicClient({ apiKey: 'k', fetch: fetcher }).complete(call()).catch((e: unknown) => e);
    expect((error as ModelError).kind).toBe('overloaded');
    expect(requests).toHaveLength(1);
  });

  it('gives up on a call that runs past its timeout, and on a cancelled one', async () => {
    const stalled = fakeFetch([{ body: STREAM.slice(0, 200), stall: true }]);
    const late = await new AnthropicClient({ apiKey: 'k', fetch: stalled.fetcher, timeoutMs: 50 }).complete(call()).catch((e: unknown) => e);
    expect((late as ModelError).kind).toBe('timeout');

    const cancel = new AbortController();
    const again = fakeFetch([{ body: STREAM.slice(0, 200), stall: true }]);
    const pending = new AnthropicClient({ apiKey: 'k', fetch: again.fetcher }).complete(call({ signal: cancel.signal })).catch((e: unknown) => e);
    setTimeout(() => cancel.abort(), 20);
    expect(((await pending) as ModelError).kind).toBe('aborted');
  });

  it('maps an unreachable provider to a network error', async () => {
    const { fetcher } = fakeFetch([]);
    const error = await new AnthropicClient({ apiKey: 'k', fetch: fetcher, retries: 0 }).complete(call()).catch((e: unknown) => e);
    expect((error as ModelError).kind).toBe('network');
  });

  it('refuses to start without a key', () => {
    expect(() => new AnthropicClient({ apiKey: '' })).toThrow(/key/);
  });
});

describe('costs', () => {
  it('prices input, output and cached tokens', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costOf('claude-sonnet-5-5', usage)).toBeCloseTo(12);
    expect(costOf('claude-sonnet-5-5', { ...usage, inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.1);
    expect(costOf('claude-haiku-5-5', { ...usage, outputTokens: 0, inputTokens: 0, cacheWriteTokens: 1_000_000 })).toBeCloseTo(0.125);
  });

  it('prices an unknown model as the most expensive known one, and stand-ins at nothing', () => {
    const usage = { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costOf('some-new-model', usage)).toBeCloseTo(20);
    expect(costOf('reference-scene', usage)).toBe(0);
    expect(costOf('scripted-plan', usage)).toBe(0);
  });
});

describe('the scripted model', () => {
  it('streams its reply in pieces and records every call', async () => {
    const model = new ScriptedModel((c) => `reply to ${c.purpose}`, { chunk: 4 });
    const pieces: string[] = [];
    const reply = await model.complete(call({ onText: (t) => pieces.push(t) }));
    expect(reply.text).toBe('reply to plan');
    expect(pieces).toEqual(['repl', 'y to', ' pla', 'n']);
    expect(model.calls).toHaveLength(1);
    expect(reply.usage.outputTokens).toBeGreaterThan(0);
  });

  it('can be cancelled while it waits', async () => {
    const model = new ScriptedModel(() => 'late', { latencyMs: 1000 });
    const cancel = new AbortController();
    const pending = model.complete(call({ signal: cancel.signal })).catch((e: unknown) => e);
    cancel.abort();
    expect(((await pending) as ModelError).kind).toBe('aborted');
  });
});

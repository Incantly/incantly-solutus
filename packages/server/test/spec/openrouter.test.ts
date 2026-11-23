/**
 * The OpenRouter request (server design 4 "OpenRouter", requirements R1.3, R3.1, R3.3, R3.5, plan round 2 item 2): what is
 * sent, to where, with which header, and how the answer becomes chat events. The network is `FakeFetch`: it keeps each call
 * and plays the recorded streams of `test/fixtures/`. No real network, no real key.
 */
import { describe, expect, it } from 'vitest';
import { toolset } from '@incantly/teacher';
import type { ChatEvent, ChatRequest } from '@incantly/teacher';
import { OPENROUTER_URL, openRouterClient, requestBody } from '../../src/index';
import { SECRET_KEY } from './helpers';
import { FakeFetch, chatRequest, collect, controlled, fixture, hang, lastOf, network, ok, status, textOf, wait } from './r2-helpers';

const TEXT = ['alpha/one:free', 'beta/two:free', 'gamma/three:free'];
const VISION = ['vis/one:free', 'vis/two:free'];

const clientOver = (fake: FakeFetch, key: string | null = SECRET_KEY) => openRouterClient({ apiKey: () => key ?? undefined, fetch: fake.fetch }, { textModels: TEXT, visionModels: VISION });

const run = async (fake: FakeFetch, request: ChatRequest = chatRequest(), key: string | null = SECRET_KEY): Promise<ChatEvent[]> => collect(clientOver(fake, key).chat(request, new AbortController().signal));

const errorKind = (events: readonly ChatEvent[]): string => {
  const last = lastOf(events);
  return last !== undefined && 'error' in last ? last.error.kind : '(not an error)';
};

describe('the request (design 4: POST chat completions with stream true and the toolset as tools)', () => {
  it('goes to OpenRouter\'s chat completions with POST', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(OPENROUTER_URL).toBe('https://openrouter.ai/api/v1');
    expect(fake.calls[0]?.method).toBe('POST');
  });

  it('asks for a stream', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls[0]?.json['stream']).toBe(true);
  });

  it('sends the first model of the list as `model`', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls[0]?.json['model']).toBe('alpha/one:free');
  });

  it('puts the system text first, then the messages in order', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake, chatRequest({ system: 'THE SYSTEM', messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'second' }, { role: 'user', content: 'third' }] }));
    const messages = fake.calls[0]?.json['messages'] as { role: string; content: unknown }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages.map((m) => m.content)).toEqual(['THE SYSTEM', 'first', 'second', 'third']);
  });

  it('sends the toolset as function-style tools: name, description and the schema as parameters', async () => {
    const set = toolset(['draw', 'figure']);
    if (!set.ok) throw new Error(set.message);
    const specs = set.value.specs();
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake, chatRequest({ tools: specs }));
    const tools = fake.calls[0]?.json['tools'] as { type: string; function: { name: string; description: string; parameters: unknown } }[];
    expect(tools).toHaveLength(specs.length);
    tools.forEach((t, i) => {
      expect(t.type).toBe('function');
      expect(t.function.name).toBe(specs[i]?.name);
      expect(t.function.description).toBe(specs[i]?.description);
      expect(t.function.parameters).toEqual(JSON.parse(JSON.stringify(specs[i]?.schema)));
    });
  });

  it('a picture goes as an image_url part holding a data URL, beside the text', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake, chatRequest({ vision: true, messages: [{ role: 'user', content: 'what is this?', images: [{ mime: 'image/png', data: 'iVBORw0KGgo=' }] }] }));
    const user = (fake.calls[0]?.json['messages'] as { role: string; content: unknown }[])[1];
    expect(Array.isArray(user?.content)).toBe(true);
    const parts = user?.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts.find((p) => p.type === 'text')?.text).toBe('what is this?');
    expect(parts.find((p) => p.type === 'image_url')?.image_url?.url).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('a JPEG picture is a data URL of image/jpeg, and two pictures are two parts', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake, chatRequest({ vision: true, messages: [{ role: 'user', content: 'compare', images: [{ mime: 'image/jpeg', data: '/9j/AA==' }, { mime: 'image/png', data: 'AAAA' }] }] }));
    const parts = ((fake.calls[0]?.json['messages'] as { content: unknown }[])[1]?.content ?? []) as { type: string; image_url?: { url: string } }[];
    expect(parts.filter((p) => p.type === 'image_url').map((p) => p.image_url?.url)).toEqual(['data:image/jpeg;base64,/9j/AA==', 'data:image/png;base64,AAAA']);
  });

  it('a message with no picture stays plain text', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake, chatRequest({ messages: [{ role: 'user', content: 'just words' }] }));
    expect((fake.calls[0]?.json['messages'] as { content: unknown }[])[1]?.content).toBe('just words');
  });

  it('an assistant tool call and the tool\'s answer go as function-call messages', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(
      fake,
      chatRequest({
        messages: [
          { role: 'user', content: 'draw it' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'draw', args: '{"lines":["a = 1"]}' }] },
          { role: 'tool', toolCallId: 'call_1', name: 'draw', content: '{"applied":1}' },
        ],
      }),
    );
    const messages = fake.calls[0]?.json['messages'] as Record<string, unknown>[];
    const assistant = messages[2] as { role: string; tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[] };
    expect(assistant.role).toBe('assistant');
    expect(assistant.tool_calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'draw', arguments: '{"lines":["a = 1"]}' } }]);
    expect(messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"applied":1}' });
  });

  it('`requestBody` is the same JSON text', () => {
    const body = JSON.parse(requestBody('alpha/one:free', chatRequest())) as Record<string, unknown>;
    expect(body['model']).toBe('alpha/one:free');
    expect(body['stream']).toBe(true);
  });
});

describe('the key (R1.3): only in the Authorization header', () => {
  it('is sent as a bearer token in `authorization`', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls[0]?.headers['authorization']).toBe(`Bearer ${SECRET_KEY}`);
  });

  it('is in no other header, not in the address, and not in the body', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake, chatRequest({ system: 'SYS', messages: [{ role: 'user', content: 'hello' }] }));
    const call = fake.calls[0];
    for (const [name, value] of Object.entries(call?.headers ?? {})) if (name !== 'authorization') expect(value, name).not.toContain(SECRET_KEY);
    expect(call?.url).not.toContain(SECRET_KEY);
    expect(call?.bodyText).not.toContain(SECRET_KEY);
  });

  it('names the app: X-Title is Incantly, and HTTP-Referer is set', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls[0]?.headers['x-title']).toBe('Incantly');
    expect((fake.calls[0]?.headers['http-referer'] ?? '').length).toBeGreaterThan(0);
  });

  it('sends JSON', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls[0]?.headers['content-type']).toMatch(/application\/json/);
  });

  it('with no key set, no call is made and the answer is model_unavailable', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    const events = await run(fake, chatRequest(), null);
    expect(fake.calls).toHaveLength(0);
    expect(errorKind(events)).toBe('model_unavailable');
  });

  it('with an empty key, no call is made either', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    const events = await run(fake, chatRequest(), '');
    expect(fake.calls).toHaveLength(0);
    expect(errorKind(events)).toBe('model_unavailable');
  });

  it('a network failure that quotes the key in its text does not put the key in any event', async () => {
    const fake = new FakeFetch(() => network(`request to https://openrouter.ai failed, headers: Authorization: Bearer ${SECRET_KEY}`));
    const events = await run(fake);
    expect(errorKind(events)).not.toBe('(not an error)');
    expect(JSON.stringify(events)).not.toContain(SECRET_KEY);
    expect(JSON.stringify(events)).not.toContain('Bearer');
  });

  it('an error answer that echoes the key and a raw provider text puts neither in any event', async () => {
    const fake = new FakeFetch(() => status(401, { 'content-type': 'application/json' }, JSON.stringify({ error: { message: `Invalid key ${SECRET_KEY} RAWPROVIDERTEXT` } })));
    const events = await run(fake);
    const text = JSON.stringify(events);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toContain('RAWPROVIDERTEXT');
  });
});

describe('the answer', () => {
  it('a text stream gives its text and a done with the model and the usage', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    const events = await run(fake);
    expect(textOf(events)).toBe('A circle of radius 2 is every point two units from the centre.');
    expect(lastOf(events)).toEqual({ done: { model: 'baidu/ernie-5.5-flash-preview:free', inputTokens: 3120, outputTokens: 17 } });
  });

  it('a tool call stream gives both calls complete', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-tool-calls.sse')));
    const events = await run(fake);
    expect(events.flatMap((e) => ('toolCall' in e ? [e.toolCall.name] : []))).toEqual(['draw', 'figure']);
  });

  it('the same stream arriving in pieces of 1 byte gives the same events', async () => {
    const a = await run(new FakeFetch(() => ok(fixture('openrouter-tool-calls.sse'))));
    const b = await run(new FakeFetch(() => ok(fixture('openrouter-tool-calls.sse'), 1)));
    expect(b).toEqual(a);
  });

  it('the recorded 429 is model_busy, and the provider\'s own words are not passed on', async () => {
    const rec = JSON.parse(fixture('openrouter-429.json')) as { status: number; headers: Record<string, string>; body: unknown };
    const fake = new FakeFetch(() => status(rec.status, rec.headers, JSON.stringify(rec.body)));
    const events = await run(fake);
    expect(errorKind(events)).toBe('model_busy');
    expect(JSON.stringify(events)).not.toContain('rate-limited upstream');
  });

  it('a body that fails to read after some text is a stream_cut error event, not a throw', async () => {
    const c = controlled();
    c.push(`data: ${JSON.stringify({ model: 'alpha/one:free', choices: [{ index: 0, delta: { content: 'a = 1\n' }, finish_reason: null }] })}\n\n`);
    const fake = new FakeFetch(() => ({ kind: 'stream', body: c.body }));
    const pending = run(fake);
    await wait(15);
    c.fail(new Error('connection reset by peer'));
    const events = await pending;
    expect(textOf(events)).toBe('a = 1\n');
    expect(errorKind(events)).toBe('stream_cut');
    expect(JSON.stringify(events)).not.toContain('connection reset by peer');
  });
});

describe('the call is aborted with the caller (R2.5, SV2: the model request is aborted when the call ends)', () => {
  it('the caller\'s signal reaches fetch: aborting it aborts the request', async () => {
    const fake = new FakeFetch(() => hang());
    const ctl = new AbortController();
    const pending = collect(clientOver(fake).chat(chatRequest(), ctl.signal));
    await wait(20);
    expect(fake.calls[0]?.signal?.aborted).toBe(false);
    ctl.abort();
    const events = await Promise.race([pending, wait(1500).then(() => 'stuck' as const)]);
    expect(events).not.toBe('stuck');
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('a call that ends well leaves no request open: its signal is aborted at the end', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    await run(fake);
    expect(fake.calls[0]?.signal?.aborted).toBe(true);
  });

  it('an abort before the call makes no request and ends the stream without an error', async () => {
    const fake = new FakeFetch(() => ok(fixture('openrouter-text.sse')));
    const ctl = new AbortController();
    ctl.abort();
    const events = await collect(clientOver(fake).chat(chatRequest(), ctl.signal));
    expect(fake.calls).toHaveLength(0);
    expect(events.some((e) => 'error' in e)).toBe(false);
  });

  it('an abort during the stream ends it, and no error event is sent for the stop', async () => {
    const c = controlled();
    c.push(`data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }] })}\n\n`);
    const fake = new FakeFetch(() => ({ kind: 'stream', body: c.body }));
    const ctl = new AbortController();
    const out: ChatEvent[] = [];
    const reading = (async () => {
      for await (const e of clientOver(fake).chat(chatRequest(), ctl.signal)) out.push(e);
    })();
    await wait(20);
    ctl.abort();
    await Promise.race([reading, wait(1500)]);
    expect(out.some((e) => 'text' in e)).toBe(true);
    expect(out.some((e) => 'error' in e)).toBe(false);
  });
});

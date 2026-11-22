/**
 * The SSE reader and the chunk joiner (server design 4 "OpenRouter", requirements R3.1, plan round 2 item 1, errors.md):
 * `data:` lines, comment lines, `[DONE]`, tool call argument pieces joined by index and given only when complete, and a
 * stream that ends without `[DONE]` as `stream_cut`. Run over the recorded streams in `test/fixtures/` (written by hand
 * from OpenRouter's documented format) and over streams built here. No network.
 */
import { describe, expect, it } from 'vitest';
import { chatEvents, readSse } from '../../src/index';
import type { SseItem } from '../../src/index';
import type { ChatEvent } from '@incantly/teacher';
import { bodyOf, collect, controlled, fixture, finishChunk, lastOf, sseOf, textChunk, textOf, toolChunk, usageChunk, wait } from './r2-helpers';

const items = async (text: string, size?: number): Promise<SseItem[]> => collect(readSse(bodyOf(text, size)));
const events = async (text: string, size?: number, model = 'requested/model:free'): Promise<ChatEvent[]> => collect(chatEvents(bodyOf(text, size), model));

describe('readSse: server-sent events cut from a body', () => {
  it('a `data:` line followed by a blank line is one event, with its text', async () => {
    expect(await items('data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\n')).toEqual([{ data: '{"a":1}' }, { data: '{"a":2}' }, { done: true }]);
  });

  it('`data:` with no space after the colon is the same', async () => {
    expect(await items('data:{"a":1}\n\ndata:[DONE]\n\n')).toEqual([{ data: '{"a":1}' }, { done: true }]);
  });

  it('comment lines (a colon first) carry nothing and are dropped', async () => {
    expect(await items(': OPENROUTER PROCESSING\n\ndata: {"a":1}\n\n: OPENROUTER PROCESSING\n\ndata: [DONE]\n\n')).toEqual([{ data: '{"a":1}' }, { done: true }]);
  });

  it('a comment line between two `data:` lines of one event does not end or join it', async () => {
    const out = await items('data: one\n: keep-alive\ndata: two\n\ndata: [DONE]\n\n');
    expect(out).toEqual([{ data: 'one\ntwo' }, { done: true }]);
  });

  it('`[DONE]` ends the stream: nothing after it is read', async () => {
    expect(await items('data: [DONE]\n\ndata: {"late":true}\n\n')).toEqual([{ done: true }]);
  });

  it('lines end with CRLF as well as LF', async () => {
    expect(await items('data: {"a":1}\r\n\r\ndata: [DONE]\r\n\r\n')).toEqual([{ data: '{"a":1}' }, { done: true }]);
  });

  it('a body with no event gives nothing and ends', async () => {
    expect(await items('')).toEqual([]);
    expect(await items(': only a comment\n\n')).toEqual([]);
  });

  it('a body that ends with no `[DONE]` gives the events it had and no done item', async () => {
    const out = await items('data: {"a":1}\n\ndata: {"a":2}\n\n');
    expect(out).toEqual([{ data: '{"a":1}' }, { data: '{"a":2}' }]);
  });

  it('multi-byte characters cut between two pieces arrive whole', async () => {
    const text = 'data: {"t":"π ≈ 3.14 — 🙂 done"}\n\ndata: [DONE]\n\n';
    const want = [{ data: '{"t":"π ≈ 3.14 — 🙂 done"}' }, { done: true }];
    for (let size = 1; size <= 9; size++) expect(await items(text, size), `pieces of ${size} bytes`).toEqual(want);
  });

  it('the recorded text stream gives the same events however its bytes are cut', async () => {
    const text = fixture('openrouter-text.sse');
    const whole = await items(text);
    expect(whole.length).toBeGreaterThan(5);
    expect(whole[whole.length - 1]).toEqual({ done: true });
    for (const size of [1, 2, 3, 5, 7, 16, 64, 100, 1000]) expect(await items(text, size), `pieces of ${size} bytes`).toEqual(whole);
  });

  it('the recorded tool call stream gives the same events however its bytes are cut', async () => {
    const text = fixture('openrouter-tool-calls.sse');
    const whole = await items(text);
    for (const size of [1, 3, 11, 97, 500]) expect(await items(text, size), `pieces of ${size} bytes`).toEqual(whole);
  });

  it('a body cut in two at every byte of the first 600 gives the same events', async () => {
    const text = fixture('openrouter-text.sse');
    const bytes = new TextEncoder().encode(text);
    const whole = await items(text);
    for (let at = 1; at < 600; at += 1) {
      const out = await collect(
        readSse(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(bytes.slice(0, at));
              c.enqueue(bytes.slice(at));
              c.close();
            },
          }),
        ),
      );
      expect(out, `cut at ${at}`).toEqual(whole);
    }
  });

  it('every data event of the recorded streams is JSON, and no comment line shows in one', async () => {
    for (const name of ['openrouter-text.sse', 'openrouter-tool-calls.sse', 'openrouter-cut.sse']) {
      for (const item of await items(fixture(name))) {
        if ('data' in item) {
          expect(() => JSON.parse(item.data), name).not.toThrow();
          expect(item.data).not.toContain('OPENROUTER PROCESSING');
        }
      }
    }
  });

  it('leaving the reader early cancels the body', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\ndata: two\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const item of readSse(body)) {
      expect(item).toEqual({ data: 'one' });
      break;
    }
    await wait(20);
    expect(cancelled).toBe(true);
  });
});

describe('chatEvents: the recorded streams', () => {
  it('a text reply: its pieces as text events, then one done with the model and the usage', async () => {
    const out = await events(fixture('openrouter-text.sse'));
    expect(textOf(out)).toBe('A circle of radius 2 is every point two units from the centre.');
    expect(out.filter((e) => 'text' in e).map((e) => ('text' in e ? e.text : ''))).toEqual(['A circle of radius 2', ' is every point two units', ' from the centre.']);
    const done = lastOf(out);
    expect(done).toEqual({ done: { model: 'baidu/ernie-5.5-flash-preview:free', inputTokens: 3120, outputTokens: 17 } });
    expect(out.filter((e) => 'done' in e)).toHaveLength(1);
    expect(out.some((e) => 'error' in e)).toBe(false);
  });

  it('the same reply read in pieces of 1 byte', async () => {
    const out = await events(fixture('openrouter-text.sse'), 1);
    expect(textOf(out)).toBe('A circle of radius 2 is every point two units from the centre.');
    expect(lastOf(out)).toHaveProperty('done');
  });

  it('a reply with two tool calls: text, then each call with its arguments joined, then done', async () => {
    const out = await events(fixture('openrouter-tool-calls.sse'));
    expect(textOf(out)).toBe('Here is the circle.');
    const calls = out.flatMap((e) => ('toolCall' in e ? [e.toolCall] : []));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.id).toBe('call_draw_1');
    expect(calls[0]?.name).toBe('draw');
    expect(JSON.parse(calls[0]?.args ?? '')).toEqual({ lines: ['c = Circle((0, 0), 2)', 'P = PointOn(c)'] });
    expect(calls[1]?.id).toBe('call_figure_2');
    expect(calls[1]?.name).toBe('figure');
    expect(JSON.parse(calls[1]?.args ?? '')).toEqual({});
    expect(lastOf(out)).toEqual({ done: { model: 'baidu/ernie-5.5-flash-preview:free', inputTokens: 3350, outputTokens: 46 } });
  });

  it('the text comes before the calls, and the calls are in index order', async () => {
    const out = await events(fixture('openrouter-tool-calls.sse'));
    const kinds = out.map((e) => Object.keys(e)[0]);
    expect(kinds.indexOf('text')).toBeLessThan(kinds.indexOf('toolCall'));
    expect(kinds.lastIndexOf('toolCall')).toBeLessThan(kinds.indexOf('done'));
    expect(out.flatMap((e) => ('toolCall' in e ? [e.toolCall.name] : []))).toEqual(['draw', 'figure']);
  });

  it('the cut stream: its text, then a stream_cut error, and no done', async () => {
    const out = await events(fixture('openrouter-cut.sse'));
    expect(textOf(out)).toBe('c = Circle((0, 0), 2)\nP = PointOn(');
    const last = lastOf(out);
    expect(last).toBeDefined();
    expect(last !== undefined && 'error' in last ? last.error.kind : '').toBe('stream_cut');
    expect(out.some((e) => 'done' in e)).toBe(false);
  });

  it('the cut stream read in single bytes is still a stream_cut', async () => {
    const out = await events(fixture('openrouter-cut.sse'), 1);
    const last = lastOf(out);
    expect(last !== undefined && 'error' in last ? last.error.kind : '').toBe('stream_cut');
  });
});

describe('chatEvents: a stream that ends without [DONE] is a stream_cut', () => {
  it('after some text, with no finish_reason', async () => {
    const out = await events(sseOf([textChunk('a = 1\n')], 'none'));
    expect(textOf(out)).toBe('a = 1\n');
    const last = lastOf(out);
    expect(last !== undefined && 'error' in last ? last.error.kind : '').toBe('stream_cut');
    expect(out.some((e) => 'done' in e)).toBe(false);
  });

  it('with nothing at all in it', async () => {
    const out = await events('');
    expect(out).toHaveLength(1);
    expect('error' in (out[0] as ChatEvent) ? (out[0] as { error: { kind: string } }).error.kind : '').toBe('stream_cut');
  });

  it('after a finish_reason and usage but with no [DONE] marker (the reply is not known to be whole)', async () => {
    const out = await events(sseOf([textChunk('a = 1\n'), finishChunk('stop'), usageChunk(3, 2)], 'none'));
    const last = lastOf(out);
    expect(last !== undefined && 'error' in last ? last.error.kind : 'done-or-other').toBe('stream_cut');
  });

  it('a stream_cut error carries no provider text', async () => {
    const out = await events(sseOf([textChunk('x')], 'none'));
    const last = lastOf(out);
    expect(JSON.stringify(last)).not.toContain('OPENROUTER');
  });
});

describe('chatEvents: tool call arguments (R3.1: a tool call only with complete arguments)', () => {
  it('pieces of one call are joined by index', async () => {
    const out = await events(sseOf([toolChunk(0, { id: 'c1', name: 'draw', arguments: '' }), toolChunk(0, { arguments: '{"lines":' }), toolChunk(0, { arguments: '["a = 1"' }), toolChunk(0, { arguments: ']}' }), finishChunk('tool_calls')]));
    const calls = out.flatMap((e) => ('toolCall' in e ? [e.toolCall] : []));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: 'c1', name: 'draw', args: '{"lines":["a = 1"]}' });
  });

  it('two calls whose pieces arrive mixed are joined each by its own index', async () => {
    const out = await events(
      sseOf([
        toolChunk(0, { id: 'c0', name: 'draw', arguments: '{"lines":' }),
        toolChunk(1, { id: 'c1', name: 'figure', arguments: '{' }),
        toolChunk(0, { arguments: '["a = 1"]}' }),
        toolChunk(1, { arguments: '}' }),
        finishChunk('tool_calls'),
      ]),
    );
    const calls = out.flatMap((e) => ('toolCall' in e ? [e.toolCall] : []));
    expect(calls.map((c) => [c.id, c.name, JSON.parse(c.args)])).toEqual([
      ['c0', 'draw', { lines: ['a = 1'] }],
      ['c1', 'figure', {}],
    ]);
  });

  it('a call is not given while its arguments are incomplete', async () => {
    const c = controlled();
    const seen: ChatEvent[] = [];
    const reading = (async () => {
      for await (const e of chatEvents(c.body, 'm')) seen.push(e);
    })();
    const send = (chunk: unknown): void => c.push(`data: ${JSON.stringify(chunk)}\n\n`);
    send(toolChunk(0, { id: 'c1', name: 'draw', arguments: '' }));
    send(toolChunk(0, { arguments: '{"lines":["a = ' }));
    await wait(30);
    expect(seen.filter((e) => 'toolCall' in e), 'given with half its arguments').toHaveLength(0);
    send(toolChunk(0, { arguments: '1"]' }));
    await wait(30);
    expect(seen.filter((e) => 'toolCall' in e), 'given before the closing brace').toHaveLength(0);
    send(toolChunk(0, { arguments: '}' }));
    await wait(30);
    expect(seen.filter((e) => 'toolCall' in e)).toHaveLength(1);
    send(finishChunk('tool_calls'));
    c.push('data: [DONE]\n\n');
    await reading;
    expect(seen.filter((e) => 'toolCall' in e)).toHaveLength(1);
  });

  it('a call is given once, not again at the end of the choice', async () => {
    const out = await events(sseOf([toolChunk(0, { id: 'c1', name: 'figure', arguments: '{}' }), finishChunk('tool_calls')]));
    expect(out.filter((e) => 'toolCall' in e)).toHaveLength(1);
  });

  it('a call whose arguments never complete is not given as a finished call when the stream is cut', async () => {
    const out = await events(sseOf([toolChunk(0, { id: 'c1', name: 'draw', arguments: '{"lines":["a = ' })], 'none'));
    expect(out.some((e) => 'toolCall' in e)).toBe(false);
    const last = lastOf(out);
    expect(last !== undefined && 'error' in last ? last.error.kind : '').toBe('stream_cut');
  });

  it('a call with no arguments piece at all is given with empty arguments `{}`, so the tool can answer tool_input', async () => {
    const out = await events(sseOf([toolChunk(0, { id: 'c1', name: 'figure' }), finishChunk('tool_calls')]));
    const calls = out.flatMap((e) => ('toolCall' in e ? [e.toolCall] : []));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.args ?? 'x')).toEqual({});
  });
});

describe('chatEvents: errors inside a stream carry no provider text', () => {
  it('an error chunk after some text: the text, then an error event, and the stream ends', async () => {
    const out = await events(sseOf([textChunk('a = 1\n'), { error: { code: 502, message: 'RAWPROVIDERTEXT upstream exploded' } }, textChunk('late')]));
    expect(textOf(out)).toBe('a = 1\n');
    const last = lastOf(out);
    expect(last !== undefined && 'error' in last).toBe(true);
    expect(JSON.stringify(out)).not.toContain('RAWPROVIDERTEXT');
    expect(out.some((e) => 'done' in e)).toBe(false);
  });

  it('a 429 inside the stream is model_busy', async () => {
    const out = await events(sseOf([{ error: { code: 429, message: 'RAWPROVIDERTEXT' } }]));
    const last = lastOf(out);
    expect(last !== undefined && 'error' in last ? last.error.kind : '').toBe('model_busy');
  });

  it('a finish_reason of error is an error event', async () => {
    const out = await events(sseOf([textChunk('a'), finishChunk('error')]));
    expect(lastOf(out)).toHaveProperty('error');
  });
});

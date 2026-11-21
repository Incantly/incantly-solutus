/**
 * R6 (AI) and the AI request section of design.md (section 9): `askIncantly`, `aiTransport`, `ai_unavailable`,
 * `ai_partial`, abort of an older request on the same figure, and the HTTP client.
 */
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_CHARS, aiUnavailable, askIncantly, httpTransport, parseEvent } from '../../src/index';
import type { AiEvent, AiRequest, AiTransport } from '../../src/index';
import { Viewport, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, posOf, real, undoOnce, until, lastError } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.unstubAllGlobals();
});

const doc = (script = 'a = 1', mode = 'graphing') => docOf(para('Intro text before.'), figureJson({ id: 'fig_a', script, mode }), para('Text after the figure.'));

/** A transport that replays events and records what it was asked. */
function replay(events: readonly (AiEvent | Error)[], seen: AiRequest[] = []): AiTransport {
  return async function* (request) {
    seen.push(request);
    for (const e of events) {
      if (e instanceof Error) throw e;
      yield e;
    }
  };
}

/** Counts the transactions that change the figure's script. */
function scriptTransactions(editor: Editor, id: string): () => number {
  let last = figureAttrs(editor, id)?.script;
  let n = 0;
  editor.on('transaction', () => {
    const now = figureAttrs(editor, id)?.script;
    if (now !== last) n++;
    last = now;
  });
  return () => n;
}

describe('without a server (R6.1)', () => {
  it('gives ai_unavailable with the reason and changes nothing', async () => {
    const { editor, errors } = makeEditor(doc());
    const before = editor.getJSON();
    const r = await askIncantly(editor, 'fig_a', 'draw a circle');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('ai_unavailable');
    expect(r.message.length).toBeGreaterThan(0);
    expect(r.node).toBe('fig_a');
    expect(editor.getJSON()).toEqual(before);
    expect(errors.map((e) => e.kind)).toContain('ai_unavailable');
    expect(lastError(editor)?.kind).toBe('ai_unavailable');
  });

  it('is decided by aiUnavailable from the options', () => {
    expect(aiUnavailable({})?.kind).toBe('ai_unavailable');
    expect(aiUnavailable({ server: 'http://x' })).toBeUndefined();
    expect(aiUnavailable({ aiTransport: replay([]) })).toBeUndefined();
  });

  it('the AI box in the toolbar shows the reason and the figure stays as it was', async () => {
    const { editor } = makeEditor(doc());
    editor.commands.setNodeSelection(posOf(editor, 'fig_a'));
    const bar = editor.view.dom.querySelector('[role="toolbar"]') as HTMLElement;
    const aiBtn = Array.from(bar.querySelectorAll('button')).find((b) => /^AI$/.test(b.textContent ?? '')) as HTMLButtonElement;
    aiBtn.click();
    const input = bar.querySelector<HTMLInputElement>('[aria-label="Ask the AI"]') as HTMLInputElement;
    input.value = 'draw a circle';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await real(30);
    expect(bar.querySelector('.inc-tt-ai')?.textContent ?? '').toMatch(/server|AI/i);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1');
  });
});

describe('the request (R6.2, design 9)', () => {
  it('sends the writer\'s text, the mode, the script, the figure summary for an edit, and the text round the figure', async () => {
    const seen: AiRequest[] = [];
    const { editor } = makeEditor(doc('a = 1\nb = 2'), { aiTransport: replay([{ done: true }], seen) });
    await askIncantly(editor, 'fig_a', 'make b bigger');
    expect(seen).toHaveLength(1);
    const q = seen[0] as AiRequest;
    expect(q.request).toBe('make b bigger');
    expect(q.mode).toBe('graphing');
    expect(q.script).toBe('a = 1\nb = 2');
    expect(q.figure).not.toBeNull();
    expect(JSON.stringify(q.figure)).toContain('"a"');
    expect(q.before).toContain('Intro text before.');
    expect(q.after).toContain('Text after the figure.');
  });

  it('sends figure: null for a new figure with an empty script', async () => {
    const seen: AiRequest[] = [];
    const { editor } = makeEditor(doc(''), { aiTransport: replay([{ done: true }], seen) });
    await askIncantly(editor, 'fig_a', 'draw a parabola');
    expect(seen[0]?.figure).toBeNull();
    expect(seen[0]?.script).toBe('');
  });

  it('sends at most 500 characters of text before and after, the ones nearest the figure', async () => {
    expect(CONTEXT_CHARS).toBe(500);
    const seen: AiRequest[] = [];
    const before = `${'x'.repeat(900)}NEAR-BEFORE`;
    const after = `NEAR-AFTER${'y'.repeat(900)}`;
    const content = docOf(para(before), figureJson({ id: 'fig_a', script: 'a = 1' }), para(after));
    const { editor } = makeEditor(content, { aiTransport: replay([{ done: true }], seen) });
    await askIncantly(editor, 'fig_a', 'more');
    const q = seen[0] as AiRequest;
    expect(q.before.length).toBeLessThanOrEqual(500);
    expect(q.after.length).toBeLessThanOrEqual(500);
    expect(q.before.endsWith('NEAR-BEFORE')).toBe(true);
    expect(q.after.startsWith('NEAR-AFTER')).toBe(true);
    expect(q.before.length).toBeGreaterThan(400);
    expect(q.after.length).toBeGreaterThan(400);
  });
});

describe('a stream that ends well (R6.2)', () => {
  it('adds the lines to the script and commits once, as one undo step', async () => {
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: replay([{ lines: ['b = 2'] }, { lines: ['c = 3', 'd = 4'] }, { done: true }]) });
    const count = scriptTransactions(editor, 'fig_a');
    const r = await askIncantly(editor, 'fig_a', 'add three objects');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.applied).toBe(3);
      expect(r.value.failed).toEqual([]);
    }
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2\nc = 3\nd = 4');
    expect(count()).toBe(1);
    expect(undoOnce(editor)).toBe(true);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1');
  });

  it('writes a new figure from lines alone', async () => {
    const { editor } = makeEditor(doc(''), { aiTransport: replay([{ lines: ['f(x) = x^2 - 2x - 3', 'r1 = Root(f, -5, 1)'] }, { done: true }]) });
    const r = await askIncantly(editor, 'fig_a', 'show a parabola');
    expect(r.ok).toBe(true);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('f(x) = x^2 - 2x - 3\nr1 = Root(f, -5, 1)');
  });

  it('shows the lines in the code panel as they arrive, and commits only at the end', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const transport: AiTransport = async function* () {
      yield { lines: ['b = 2'] };
      await gate;
      yield { done: true };
    };
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: transport });
    editor.commands.setNodeSelection(posOf(editor, 'fig_a'));
    (Array.from(editor.view.dom.querySelectorAll('[role="toolbar"] button')).find((b) => /edit lines/i.test(b.textContent ?? '')) as HTMLButtonElement).click();
    const area = editor.view.dom.querySelector('.inc-tt-panel textarea') as HTMLTextAreaElement;
    const job = askIncantly(editor, 'fig_a', 'add b');
    await until(() => area.value.includes('b = 2'), 'the streamed line in the panel');
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1');
    release();
    const r = await job;
    expect(r.ok).toBe(true);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2');
  });

  it('applies lines to the live figure as they arrive', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const transport: AiTransport = async function* () {
      yield { lines: ['b = 2'] };
      await gate;
      yield { done: true };
    };
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: transport });
    await until(() => editor.view.dom.querySelector('.inc-tt-box[data-state="live"]'), 'a live figure');
    const job = askIncantly(editor, 'fig_a', 'add b');
    await until(() => (editor.view.dom.querySelector('[aria-label="Objects in the figure"]')?.textContent ?? '').includes('b'), 'b in the live figure');
    release();
    await job;
  });

  it('keeps lines that fail aside: the script gets the old lines plus the ones that worked', async () => {
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: replay([{ lines: ['b = 2', 'c = Nope((('] }, { lines: ['d = a + 1'] }, { done: true }]) });
    const r = await askIncantly(editor, 'fig_a', 'add things');
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2\nd = a + 1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.applied).toBe(2);
      expect(r.value.failed).toEqual(['c = Nope(((']);
    }
  });

  it('the command starts the job, returns true, and the script is committed when it ends', async () => {
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: replay([{ lines: ['b = 2'] }, { done: true }]) });
    expect(editor.commands.askIncantly('fig_a', 'add b')).toBe(true);
    await until(() => figureAttrs(editor, 'fig_a')?.script === 'a = 1\nb = 2', 'the committed script');
  });

  it('never takes Tiptap JSON or HTML from the model: such text is only a line that fails', async () => {
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: replay([{ lines: ['{"type":"paragraph","content":[]}', '<p>hello</p>', 'b = 2'] }, { done: true }]) });
    const before = editor.state.doc.childCount;
    await askIncantly(editor, 'fig_a', 'anything');
    expect(editor.state.doc.childCount).toBe(before);
    const script = figureAttrs(editor, 'fig_a')?.script ?? '';
    expect(script).toBe('a = 1\nb = 2');
    expect(editor.getText()).not.toContain('hello');
  });
});

describe('a stream that stops (R6.3, errors.md ai_partial)', () => {
  it('keeps the lines that worked and gives ai_partial listing the lines that did not', async () => {
    const t = replay([{ lines: ['b = 2', 'c = Nope((('] }, new Error('connection dropped')]);
    const { editor, errors } = makeEditor(doc('a = 1'), { aiTransport: t });
    const r = await askIncantly(editor, 'fig_a', 'add things');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('ai_partial');
    expect(r.node).toBe('fig_a');
    expect(JSON.stringify(r)).toContain('c = Nope(((');
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2');
    expect(errors.map((e) => e.kind)).toContain('ai_partial');
    expect(lastError(editor)?.kind).toBe('ai_partial');
  });

  it('commits the good lines in one transaction even when the stream fails', async () => {
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: replay([{ lines: ['b = 2'] }, { lines: ['c = 3'] }, new Error('boom')]) });
    const count = scriptTransactions(editor, 'fig_a');
    await askIncantly(editor, 'fig_a', 'add');
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2\nc = 3');
    expect(count()).toBe(1);
  });

  it('gives ai_partial for an error event after some lines', async () => {
    const t = replay([{ lines: ['b = 2'] }, { error: { kind: 'overloaded', message: 'The model is busy' } }]);
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: t });
    const r = await askIncantly(editor, 'fig_a', 'add');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('ai_partial');
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2');
  });
});

describe('a request that gets nothing (R6.1, design 9)', () => {
  it('gives ai_unavailable for an error event with no lines, and the script stays', async () => {
    const t = replay([{ error: { kind: 'refused', message: 'Not allowed' } }]);
    const { editor, errors } = makeEditor(doc('a = 1'), { aiTransport: t });
    const before = editor.getJSON();
    const r = await askIncantly(editor, 'fig_a', 'add');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('ai_unavailable');
      expect(r.message).toContain('Not allowed');
    }
    expect(editor.getJSON()).toEqual(before);
    expect(errors.map((e) => e.kind)).toEqual(['ai_unavailable']);
  });

  it('gives ai_unavailable when the transport fails at once', async () => {
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: replay([new Error('network down')]) });
    const before = editor.getJSON();
    const r = await askIncantly(editor, 'fig_a', 'add');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('ai_unavailable');
    expect(editor.getJSON()).toEqual(before);
  });

  it('gives an error for an unknown figure id and returns false from the command', async () => {
    const { editor, errors } = makeEditor(doc('a = 1'), { aiTransport: replay([{ done: true }]) });
    const r = await askIncantly(editor, 'fig_missing', 'add');
    expect(r.ok).toBe(false);
    expect(editor.commands.askIncantly('fig_missing', 'add')).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('a new request on the same figure (R6, design 9)', () => {
  it('aborts the older request, and the old job leaves the node as it was', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const signals: AbortSignal[] = [];
    const transport: AiTransport = async function* (request, signal) {
      signals.push(signal);
      if (request.request === 'first') {
        yield { lines: ['one = 1'] };
        await gate;
        yield { lines: ['late = 9'] };
        yield { done: true };
      } else {
        yield { lines: ['two = 2'] };
        yield { done: true };
      }
    };
    const { editor } = makeEditor(doc('a = 1'), { aiTransport: transport });
    const first = askIncantly(editor, 'fig_a', 'first');
    await until(() => signals.length === 1, 'the first request to start');
    expect(signals[0]?.aborted).toBe(false);
    const second = askIncantly(editor, 'fig_a', 'second');
    await until(() => signals.length === 2, 'the second request to start');
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\ntwo = 2');
  });

  it('does not abort a request on another figure', async () => {
    const signals = new Map<string, AbortSignal>();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const transport: AiTransport = async function* (request, signal) {
      signals.set(request.request, signal);
      if (request.request === 'first') await gate;
      yield { lines: [`${request.request}_v = 1`] };
      yield { done: true };
    };
    const content = docOf(figureJson({ id: 'fig_a', script: 'a = 1' }), figureJson({ id: 'fig_b', script: 'b = 1' }), para('x'));
    const { editor } = makeEditor(content, { aiTransport: transport });
    const first = askIncantly(editor, 'fig_a', 'first');
    await until(() => signals.has('first'), 'first started');
    const second = askIncantly(editor, 'fig_b', 'second');
    await second;
    expect(signals.get('first')?.aborted).toBe(false);
    release();
    await first;
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nfirst_v = 1');
    expect(figureAttrs(editor, 'fig_b')?.script).toBe('b = 1\nsecond_v = 1');
  });
});

describe('the HTTP client (design 9)', () => {
  const ndjson = (...events: unknown[]): Response => new Response(events.map((e) => JSON.stringify(e)).join('\n') + '\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
  const collect = async (t: AiTransport, req: AiRequest): Promise<AiEvent[]> => {
    const out: AiEvent[] = [];
    for await (const e of t(req, new AbortController().signal)) out.push(e);
    return out;
  };
  const req: AiRequest = { request: 'draw', mode: 'graphing', script: '', figure: null, before: 'b', after: 'a' };

  it('posts the request as JSON to {server}/v1/figure/draw and reads NDJSON events', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return ndjson({ lines: ['a = 1'] }, { lines: ['b = 2'] }, { done: true });
    });
    const events = await collect(httpTransport('http://ai.test', fake as unknown as typeof fetch), req);
    expect(events).toEqual([{ lines: ['a = 1'] }, { lines: ['b = 2'] }, { done: true }]);
    expect(calls[0]?.url).toBe('http://ai.test/v1/figure/draw');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(req);
  });

  it('turns a non-2xx answer into ai_unavailable through askIncantly, leaving the figure alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 500 })));
    const { editor } = makeEditor(doc('a = 1'), { server: 'http://ai.test' });
    const before = editor.getJSON();
    const r = await askIncantly(editor, 'fig_a', 'add');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('ai_unavailable');
    expect(editor.getJSON()).toEqual(before);
  });

  it('turns a network error into ai_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const { editor } = makeEditor(doc('a = 1'), { server: 'http://ai.test' });
    const r = await askIncantly(editor, 'fig_a', 'add');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('ai_unavailable');
  });

  it('turns a line that is not an event into ai_unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('this is not json\n', { status: 200 })));
    const { editor } = makeEditor(doc('a = 1'), { server: 'http://ai.test' });
    const r = await askIncantly(editor, 'fig_a', 'add');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('ai_unavailable');
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1');
  });

  it('works end to end with a server answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ndjson({ lines: ['b = 2'] }, { done: true })));
    const { editor } = makeEditor(doc('a = 1'), { server: 'http://ai.test' });
    const r = await askIncantly(editor, 'fig_a', 'add b');
    expect(r.ok).toBe(true);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = 2');
  });

  it('parses one event per line and refuses anything else', () => {
    expect(parseEvent('{"lines":["a = 1"]}')).toEqual({ lines: ['a = 1'] });
    expect(parseEvent('{"done":true}')).toEqual({ done: true });
    expect(parseEvent('{"error":{"kind":"x","message":"y"}}')).toEqual({ error: { kind: 'x', message: 'y' } });
    expect(parseEvent('not json')).toBeUndefined();
    expect(parseEvent('{"unknown":1}')).toBeUndefined();
  });
});

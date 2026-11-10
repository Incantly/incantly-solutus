/**
 * Bug-hunt probes for live voice in generation (stage E): the Gemini Live
 * client against a fake socket, and the Live token minter against a mocked
 * fetch. Each `it` demonstrates one real defect; each currently FAILS.
 * No real connection is opened and no file under src/ is touched.
 */
import type { LiveEvent } from '@incantly/core';
import { describe, expect, it, vi } from 'vitest';
import { GeminiLiveVoice, type LiveSocket } from '../src/client/live-gemini';
import { geminiLiveTokenMinter } from '../src/live-token';

class FakeSocket implements LiveSocket {
  readonly sent: unknown[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown);
  }

  close(): void {}
}

function harness(refreshToken?: () => Promise<string>) {
  const sockets: FakeSocket[] = [];
  const events: LiveEvent[] = [];
  const voice = new GeminiLiveVoice({
    token: 'short-lived-token',
    model: 'gemini-2.5-flash-native-audio',
    ...(refreshToken ? { refreshToken } : {}),
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  voice.on((event) => events.push(event));
  return { sockets, events, voice };
}

function server(socket: FakeSocket, message: unknown): void {
  socket.onmessage!({ data: JSON.stringify(message) });
}

/** Lets the socket's ordered frame chain drain before asserting on events. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function connected() {
  const h = harness();
  const promise = h.voice.connect({ instruction: 'Teach.', tools: [] });
  const socket = h.sockets[0]!;
  socket.onopen!({});
  server(socket, { setupComplete: {} });
  await promise;
  return { ...h, socket };
}

describe('GeminiLiveVoice bugs: malformed server messages', () => {
  it('ignores non-object server messages without throwing', async () => {
    const { socket } = await connected();
    for (const message of [null, 5, 'hi', true]) {
      expect(() => server(socket, message), `message ${JSON.stringify(message)}`).not.toThrow();
    }
  });

  it('ignores malformed toolCall shapes without throwing', async () => {
    const { socket, events } = await connected();
    const before = events.length;
    expect(() => server(socket, { toolCall: null }), 'null toolCall').not.toThrow();
    expect(() => server(socket, { toolCall: { functionCalls: {} } }), 'object functionCalls').not.toThrow();
    expect(() => server(socket, { toolCall: { functionCalls: [null] } }), 'null entry').not.toThrow();
    expect(() => server(socket, { toolCall: { functionCalls: [{ id: 1, name: null }] } }), 'bad id/name').not.toThrow();
    // Nothing well-formed arrived, so no tool call may have been emitted.
    await flush();
    expect(events.slice(before).filter((event) => event.type === 'tool-call')).toEqual([]);
  });

  it('ignores malformed model parts and bad audio without throwing', async () => {
    const { socket, events } = await connected();
    const before = events.length;
    expect(() => server(socket, { serverContent: { modelTurn: { parts: {} } } }), 'object parts').not.toThrow();
    expect(() => server(socket, { serverContent: { modelTurn: { parts: [null] } } }), 'null part').not.toThrow();
    expect(
      () => server(socket, { serverContent: { modelTurn: { parts: [{ inlineData: { data: '!!!not-base64!!!' } }] } } }),
      'bad base64',
    ).not.toThrow();
    // No usable audio or text arrived, so no speaking/transcript may follow.
    await flush();
    expect(events.slice(before)).toEqual([]);
  });
});

describe('GeminiLiveVoice bugs: lifecycle', () => {
  it('settles a pending connect() when close() runs first', async () => {
    const h = harness();
    const promise = h.voice.connect({ instruction: 'Hi.', tools: [] });
    let settled = false;
    void promise.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    h.voice.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Either resolve or reject: the caller must never wait forever.
    expect(settled).toBe(true);
    expect(h.events).toEqual([{ type: 'closed' }]);
    await h.sockets[0]!.onclose!({});
  });

  it('answers a late tool result after close() without throwing', async () => {
    const { voice } = await connected();
    voice.close();
    expect(() => voice.respondTool('call-9', { ok: true })).not.toThrow();
  });
});

describe('live token bugs: minter', () => {
  function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
    return vi.fn(async (url: string) => {
      const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(route.body), { status: route.status });
    }) as unknown as typeof fetch;
  }

  it('fails cleanly when the models list is not a list', async () => {
    const fetch = mockFetch({
      'https://generativelanguage.googleapis.com/v1beta/models': { status: 200, body: { models: { name: 'models/x' } } },
    });
    const minter = geminiLiveTokenMinter({ apiKey: 'k', retentionAccepted: true, fetch });
    // A clean "no Live model" failure, never a raw TypeError from .filter.
    await expect(minter.mint()).rejects.toThrow(/bidiGenerateContent|Live model|unreadable|refused/);
  });
});

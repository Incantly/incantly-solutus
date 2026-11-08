/**
 * The Gemini Live client against a fake socket: setup contents, turn
 * tagging, transcripts, interruption, tool round trips, goAway resumption,
 * and error/close mapping. No real connection is opened.
 */
import type { LiveEvent } from '@incantly/core';
import { describe, expect, it } from 'vitest';
import { GeminiLiveVoice, type LiveSocket } from '../src/client/live-gemini';

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
  const audio: Uint8Array[] = [];
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
  voice.onAudio((pcm) => audio.push(pcm));
  return { sockets, events, audio, voice };
}

const SETUP = {
  instruction: 'Teach Pythagoras.',
  tools: [
    { name: 'pause', description: 'Pause the film.', parameters: { type: 'object', properties: {} }, blocking: true },
    { name: 'make_example', description: 'Draw another example.', parameters: { type: 'object', properties: {} }, blocking: false },
  ],
  voice: 'Kore',
} as const;

function server(socket: FakeSocket, message: unknown): void {
  socket.onmessage!({ data: JSON.stringify(message) });
}

async function connected() {
  const h = harness();
  const promise = h.voice.connect({ instruction: SETUP.instruction, tools: [...SETUP.tools], voice: SETUP.voice });
  const socket = h.sockets[0]!;
  socket.onopen!({});
  server(socket, { setupComplete: {} });
  await promise;
  return { ...h, socket };
}

describe('GeminiLiveVoice setup', () => {
  it('opens the constrained endpoint and sends the full setup message', async () => {
    const { sockets } = await connected();
    const socket = sockets[0]!;
    expect(socket.url.startsWith('wss://generativelanguage.googleapis.com/ws/')).toBe(true);
    expect(socket.url).toContain('BidiGenerateContentConstrained');
    expect(socket.url).toContain('access_token=short-lived-token');
    const setup = (socket.sent[0] as { setup: Record<string, unknown> }).setup;
    expect(setup.model).toBe('models/gemini-2.5-flash-native-audio');
    // responseModalities and speechConfig belong inside generationConfig;
    // the server rejects them as setup fields (close 1007).
    expect(setup.responseModalities).toBeUndefined();
    expect(setup.speechConfig).toBeUndefined();
    expect(setup.generationConfig).toEqual({
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    });
    expect(setup.systemInstruction).toEqual({ parts: [{ text: 'Teach Pythagoras.' }] });
    expect(setup.inputAudioTranscription).toEqual({});
    expect(setup.outputAudioTranscription).toEqual({});
    expect(setup.sessionResumption).toEqual({});
    expect(setup.contextWindowCompression).toEqual({ slidingWindow: {} });
    const declarations = (setup.tools as Array<{ functionDeclarations: Array<{ name: string; behavior: string }> }>)[
      0
    ]!.functionDeclarations;
    expect(declarations).toHaveLength(2);
    expect(declarations.find((d) => d.name === 'pause')!.behavior).toBe('BLOCKING');
    expect(declarations.find((d) => d.name === 'make_example')!.behavior).toBe('NON_BLOCKING');
  });

  it('strips parameters to the subset the Live API accepts, and omits them for no-argument tools', async () => {
    const h = harness();
    const promise = h.voice.connect({
      instruction: 'Teach.',
      tools: [
        {
          name: 'show_me',
          description: 'Change controls.',
          parameters: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            additionalProperties: false,
            required: ['angle'],
            properties: {
              angle: {
                type: 'number',
                description: 'The angle.',
                minimum: 0,
                maximum: 180,
                default: 40,
                oneOf: [{ type: 'number' }],
              },
              tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'], additionalProperties: false } },
            },
          },
          blocking: true,
        },
        { name: 'pause', description: 'Pause.', parameters: { type: 'object', properties: {}, additionalProperties: false }, blocking: true },
      ],
    });
    h.sockets[0]!.onopen!({});
    server(h.sockets[0]!, { setupComplete: {} });
    await promise;
    const setup = (h.sockets[0]!.sent[0] as { setup: Record<string, unknown> }).setup;
    const declarations = (setup.tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>)[0]!.functionDeclarations;
    // Nested additionalProperties, $schema, default and oneOf are gone; the supported subset survives.
    expect(JSON.stringify(declarations)).not.toContain('additionalProperties');
    expect(JSON.stringify(declarations)).not.toContain('$schema');
    expect(JSON.stringify(declarations)).not.toContain('oneOf');
    expect(declarations.find((d) => d.name === 'show_me')).toEqual({
      name: 'show_me',
      description: 'Change controls.',
      parameters: {
        type: 'object',
        required: ['angle'],
        properties: {
          angle: { type: 'number', description: 'The angle.', minimum: 0, maximum: 180 },
          tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } },
        },
      },
      behavior: 'BLOCKING',
    });
    // A tool with no properties carries no parameters at all.
    expect(declarations.find((d) => d.name === 'pause')).toEqual({ name: 'pause', description: 'Pause.', behavior: 'BLOCKING' });
    h.voice.close();
  });

  it('rejects connect when the socket closes before setupComplete', async () => {
    const h = harness();
    const promise = h.voice.connect({ instruction: 'Hi.', tools: [] });
    const socket = h.sockets[0]!;
    socket.onopen!({});
    socket.onclose!({});
    await expect(promise).rejects.toThrow(/before setup completed/);
    expect(h.events).toContainEqual({ type: 'closed' });
  });
});

describe('GeminiLiveVoice turns', () => {
  it('tags a beat turn and clears the tag when the model speaks on its own', async () => {
    const { socket, events, audio, voice } = await connected();
    voice.say('The square of the hypotenuse.', 's1b2');
    const said = socket.sent.at(-1) as { clientContent: { turns: Array<{ parts: Array<{ text: string }> }>; turnComplete: boolean } };
    expect(said.clientContent.turnComplete).toBe(true);
    expect(said.clientContent.turns[0]!.parts[0]!.text).toContain('The square of the hypotenuse.');

    const pcm = Buffer.from([1, 2, 3, 4]).toString('base64');
    server(socket, { serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm, mimeType: 'audio/pcm;rate=24000' } }] } } });
    // Transcriptions arrive as chunks; each event carries the turn so far.
    server(socket, { serverContent: { outputTranscription: { text: 'The square ' } } });
    server(socket, { serverContent: { outputTranscription: { text: 'of the hypotenuse.' } } });
    server(socket, { serverContent: { turnComplete: true } });
    // The model's own answer afterwards carries no beat id.
    const replyPcm = Buffer.from([5, 6]).toString('base64');
    server(socket, { serverContent: { modelTurn: { parts: [{ inlineData: { data: replyPcm, mimeType: 'audio/pcm;rate=24000' } }] } } });
    server(socket, { serverContent: { turnComplete: true } });

    expect(events).toContainEqual({ type: 'speaking', turnId: 's1b2' });
    expect(events).toContainEqual({ type: 'transcript', text: 'The square ', turnId: 's1b2' });
    expect(events).toContainEqual({ type: 'transcript', text: 'The square of the hypotenuse.', turnId: 's1b2' });
    expect(events).toContainEqual({ type: 'turn-complete', turnId: 's1b2' });
    expect(events).toContainEqual({ type: 'speaking', turnId: null });
    expect(events).toContainEqual({ type: 'turn-complete', turnId: null });
    // One speaking event per turn: the second audio chunk of a turn adds bytes, not events.
    expect(events.filter((e) => e.type === 'speaking')).toHaveLength(2);
    expect(audio.map((chunk) => [...chunk])).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);
  });

  it('maps interruption and learner transcription', async () => {
    const { socket, events } = await connected();
    server(socket, { serverContent: { interrupted: true } });
    server(socket, { serverContent: { inputTranscription: { text: 'wait, ' } } });
    server(socket, { serverContent: { inputTranscription: { text: 'what angle?' } } });
    expect(events).toContainEqual({ type: 'interrupted' });
    expect(events).toContainEqual({ type: 'learner-transcript', text: 'wait, ' });
    expect(events).toContainEqual({ type: 'learner-transcript', text: 'wait, what angle?' });
  });

  it('clears the beat tag on interrupted so the answer carries turnId null', async () => {
    const { socket, events, voice } = await connected();
    voice.say('The square of the hypotenuse.', 's1b2');
    server(socket, { serverContent: { outputTranscription: { text: 'The square ' } } });
    server(socket, { serverContent: { interrupted: true } });
    // The learner's answer starts a turn of its own: no beat id rides it.
    const pcm = Buffer.from([7, 8]).toString('base64');
    server(socket, { serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm, mimeType: 'audio/pcm;rate=24000' } }] } } });
    server(socket, { serverContent: { outputTranscription: { text: 'This angle ' } } });
    server(socket, { serverContent: { turnComplete: true } });
    expect(events).toContainEqual({ type: 'speaking', turnId: null });
    expect(events).toContainEqual({ type: 'transcript', text: 'This angle ', turnId: null });
    expect(events).toContainEqual({ type: 'turn-complete', turnId: null });
  });

  it('sends context without starting a reply', async () => {
    const { socket, voice } = await connected();
    voice.sendContext('The learner set angle to 40.');
    const sent = socket.sent.at(-1) as { clientContent: { turnComplete: boolean } };
    expect(sent.clientContent.turnComplete).toBe(false);
  });

  it('sends microphone audio as base64 realtime input', async () => {
    const { socket, voice } = await connected();
    voice.sendAudio(new Int16Array([1000, -1000, 0, 32767]));
    const sent = socket.sent.at(-1) as { realtimeInput: { audio: { data: string; mimeType: string } } };
    expect(sent.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect([...Buffer.from(sent.realtimeInput.audio.data, 'base64')]).toEqual([
      ...new Uint8Array(new Int16Array([1000, -1000, 0, 32767]).buffer),
    ]);
  });
});

describe('GeminiLiveVoice tools', () => {
  it('emits one tool-call per function call and answers with the matching id', async () => {
    const { socket, events, voice } = await connected();
    server(socket, {
      toolCall: {
        functionCalls: [
          { id: 'call-1', name: 'pause', args: {} },
          { id: 'call-2', name: 'make_example', args: { beat: 's1b1' } },
        ],
      },
    });
    expect(events).toContainEqual({ type: 'tool-call', callId: 'call-1', name: 'pause', args: {} });
    expect(events).toContainEqual({ type: 'tool-call', callId: 'call-2', name: 'make_example', args: { beat: 's1b1' } });

    voice.respondTool('call-1', { paused: true });
    const sent = socket.sent.at(-1) as { toolResponse: { functionResponses: Array<Record<string, unknown>> } };
    // Blocking answers keep the default interrupt turn: no scheduling field.
    expect(sent.toolResponse.functionResponses).toEqual([{ name: 'pause', id: 'call-1', response: { result: { paused: true } } }]);

    voice.respondTool('call-2', { context: 'beat s1b1' });
    const second = socket.sent.at(-1) as { toolResponse: { functionResponses: Array<Record<string, unknown>> } };
    // Non-blocking answers wait for a natural pause (WHEN_IDLE).
    expect(second.toolResponse.functionResponses).toEqual([
      { name: 'make_example', id: 'call-2', scheduling: 'WHEN_IDLE', response: { result: { context: 'beat s1b1' } } },
    ]);
  });
});

describe('GeminiLiveVoice session lifetime', () => {
  it('resumes on goAway with the resumption handle and a fresh token', async () => {
    const h = await connected();
    h.voice.close();
    const fresh = harness(async () => 'fresh-token-2');
    const promise = fresh.voice.connect({ instruction: 'Hi.', tools: [] });
    const first = fresh.sockets[0]!;
    expect(first.url).toContain('access_token=short-lived-token');
    first.onopen!({});
    server(first, { setupComplete: {} });
    await promise;
    server(first, { sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } });
    server(first, { goAway: { timeLeft: '60s' } });
    first.onclose!({});
    await Promise.resolve();

    expect(fresh.sockets).toHaveLength(2);
    const second = fresh.sockets[1]!;
    // Single-use tokens cannot be reused: the resume opens with a fresh one.
    expect(second.url).toContain('access_token=fresh-token-2');
    second.onopen!({});
    const setup = (second.sent[0] as { setup: Record<string, unknown> }).setup;
    expect(setup.model).toBe('models/gemini-2.5-flash-native-audio');
    expect(setup.sessionResumption).toEqual({ handle: 'handle-abc' });
    server(second, { setupComplete: {} });
    // No error or closed across a clean resume.
    expect(fresh.events.some((e) => e.type === 'error' || e.type === 'closed')).toBe(false);
    fresh.voice.close();
  });

  it('resumes up to five times per connect, then ends the session', async () => {
    const fresh = harness(async () => 'fresh-token');
    const promise = fresh.voice.connect({ instruction: 'Hi.', tools: [] });
    fresh.sockets[0]!.onopen!({});
    server(fresh.sockets[0]!, { setupComplete: {} });
    await promise;
    for (let i = 0; i < 5; i++) {
      const socket = fresh.sockets[i]!;
      server(socket, { sessionResumptionUpdate: { newHandle: `handle-${i}`, resumable: true } });
      server(socket, { goAway: { timeLeft: '60s' } });
      socket.onclose!({});
      await Promise.resolve();
      fresh.sockets[i + 1]!.onopen!({});
      server(fresh.sockets[i + 1]!, { setupComplete: {} });
    }
    expect(fresh.sockets).toHaveLength(6);
    const last = fresh.sockets[5]!;
    server(last, { sessionResumptionUpdate: { newHandle: 'handle-5', resumable: true } });
    server(last, { goAway: { timeLeft: '5s' } });
    last.onclose!({});
    await Promise.resolve();
    expect(fresh.sockets).toHaveLength(6);
    expect(fresh.events.filter((e) => e.type === 'closed')).toHaveLength(1);
    fresh.voice.close();
  });

  it('ends with an error when resumption has no fresh token to use', async () => {
    const h = await connected();
    const first = h.sockets[0]!;
    server(first, { sessionResumptionUpdate: { newHandle: 'handle-abc', resumable: true } });
    server(first, { goAway: { timeLeft: '60s' } });
    first.onclose!({});
    await Promise.resolve();
    expect(h.sockets).toHaveLength(1);
    expect(h.events).toContainEqual({ type: 'error', message: expect.stringContaining('refreshToken') });
    expect(h.events.at(-1)).toEqual({ type: 'closed' });
  });

  it('rejects connect with the server close reason', async () => {
    const h = harness();
    const promise = h.voice.connect({ instruction: 'Hi.', tools: [] });
    const socket = h.sockets[0]!;
    socket.onopen!({});
    socket.onclose!({ code: 1007, reason: 'Invalid JSON payload received.' });
    await expect(promise).rejects.toThrow(/1007.*Invalid JSON payload/);
    expect(h.events.at(-1)).toEqual({ type: 'closed' });
  });

  it('reports the close code and reason on error, never the token', async () => {
    const { socket, events } = await connected();
    socket.onerror!({});
    socket.onclose!({ code: 1011, reason: 'Your prepayment credits are depleted.' });
    expect(events).toContainEqual({ type: 'error', message: expect.stringContaining('1011') });
    expect(events).toContainEqual({ type: 'error', message: expect.stringContaining('prepayment credits are depleted') });
    for (const event of events) {
      if (event.type === 'error') expect(event.message).not.toContain('short-lived-token');
    }
    expect(events.at(-1)).toEqual({ type: 'closed' });
  });

  it('close() ends the session with a single closed event', async () => {
    const { socket, events, voice } = await connected();
    voice.close();
    socket.onclose!({});
    expect(events.filter((e) => e.type === 'closed')).toHaveLength(1);
  });
});

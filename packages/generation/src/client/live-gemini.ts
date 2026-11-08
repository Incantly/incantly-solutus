/**
 * The browser side of live voice: a Gemini Live session over the Live API
 * WebSocket, opened with a short-lived token the server mints. It speaks
 * the film's beats, listens to the learner, and surfaces tool calls, while
 * the driver (stage A) decides what to say next. Audio capture and playback
 * (AudioContext, worklets) stay out of this file; a later stage wires them
 * to sendAudio/onAudio.
 *
 * Docs: https://aistudio.google.com/docs/live-api/get-started-websocket
 * (endpoint, setup, realtime input, tool responses),
 * https://aistudio.google.com/api-reference/live (message shapes, goAway,
 * session resumption), https://aistudio.google.com/docs/live-api/ephemeral-tokens
 * (constrained endpoint with access_token).
 */
import type { LiveEvent, LiveSetup, LiveVoice } from '@incantly/core';

/** The small slice of WebSocket this client uses, so tests can inject a fake. */
export interface LiveSocket {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

export type LiveSocketFactory = (url: string) => LiveSocket;

export interface GeminiLiveVoiceOptions {
  /** The short-lived token from POST /v1/live/token, never the real API key. */
  readonly token: string;
  /** The Live model id, without the `models/` prefix. */
  readonly model: string;
  readonly socketFactory?: LiveSocketFactory;
  /**
   * Mints a fresh single-use token for session resumption: reconnects cannot
   * reuse the first token. Without it a goAway ends the session with an
   * error and closed, since there is nothing fresh to resume with.
   */
  readonly refreshToken?: () => Promise<string>;
}

/** Model audio arrives as 24 kHz 16-bit PCM; the player turns these bytes into sound. */
export type LiveAudioListener = (pcm16: Uint8Array) => void;

type LiveEventListener = (event: LiveEvent) => void;

/** The constrained Live endpoint: mint-scoped tokens only open sessions here. */
export const LIVE_ENDPOINT = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

function liveUrl(token: string): string {
  return `${LIVE_ENDPOINT}?access_token=${encodeURIComponent(token)}`;
}

function encodeBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

function decodeBase64(data: string): Uint8Array {
  const text = atob(data);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** How many times one connect() may resume after goAway before giving up. */
const MAX_RESUMES = 5;

/**
 * The server's close reason for an error message, e.g. " (code 1011:
 * ...)". Empty when the event carries none; never carries the token,
 * which lives only in the socket URL that is never quoted.
 */
function closeDetail(event: unknown): string {
  if (typeof event === 'object' && event !== null) {
    const { code, reason } = event as { code?: unknown; reason?: unknown };
    if (typeof code === 'number') {
      const text = typeof reason === 'string' && reason !== '' ? `: ${reason}` : '';
      return ` (code ${code}${text})`;
    }
  }
  return '';
}

/**
 * A provider Live session behind the core LiveVoice contract. Turn ids come
 * from say(): the speaking/transcript/turn-complete events that follow carry
 * the beat id, while replies the model starts itself carry null.
 */
export class GeminiLiveVoice implements LiveVoice {
  private readonly factory: LiveSocketFactory;
  private socket: LiveSocket | null = null;
  private setup: LiveSetup | null = null;
  private awaitSetup: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private currentTurn: string | null = null;
  private spokeThisTurn = false;
  /** What the voice has said so far this turn; transcriptions arrive as chunks. */
  private transcriptSoFar = '';
  /** What the learner has said so far this turn, same chunking. */
  private learnerTranscriptSoFar = '';
  private resumptionHandle: string | null = null;
  private goAwaySeen = false;
  private reconnects = 0;
  private closedByUs = false;
  private emittedClosed = false;
  private readonly toolNames = new Map<string, string>();
  private readonly toolBlocking = new Map<string, boolean>();
  private readonly listeners = new Set<LiveEventListener>();
  private readonly audioListeners = new Set<LiveAudioListener>();

  constructor(private readonly options: GeminiLiveVoiceOptions) {
    if (!options.token) throw new Error('A Live token is required: mint one at POST /v1/live/token.');
    if (!options.model) throw new Error('A Live model is required: take the model POST /v1/live/token returns.');
    const globalSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
    const factory =
      options.socketFactory ?? (typeof globalSocket === 'function' ? ((url: string) => new (globalSocket as new (url: string) => LiveSocket)(url)) : null);
    if (!factory) throw new Error('Live voice needs a WebSocket implementation: pass socketFactory.');
    this.factory = factory;
  }

  connect(setup: LiveSetup): Promise<void> {
    this.closeSocket();
    this.setup = setup;
    this.closedByUs = false;
    this.emittedClosed = false;
    this.goAwaySeen = false;
    this.reconnects = 0;
    this.resumptionHandle = null;
    this.currentTurn = null;
    this.spokeThisTurn = false;
    this.transcriptSoFar = '';
    this.learnerTranscriptSoFar = '';
    this.toolBlocking.clear();
    for (const tool of setup.tools) this.toolBlocking.set(tool.name, tool.blocking);
    this.openSocket(null, this.options.token);
    return new Promise<void>((resolve, reject) => {
      this.awaitSetup = { resolve, reject };
    });
  }

  /** Speak this beat aloud; its id rides the turn's events until turn-complete. */
  say(text: string, turnId: string): void {
    this.currentTurn = turnId;
    this.spokeThisTurn = false;
    this.transcriptSoFar = '';
    this.send({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: `Read this beat aloud, word for word:\n${text}` }] }],
        turnComplete: true,
      },
    });
  }

  /** A silent context update: turnComplete false starts no reply. */
  sendContext(text: string): void {
    this.send({
      clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false },
    });
  }

  /** Learner microphone audio: 16 kHz 16-bit PCM, base64 in realtimeInput. */
  sendAudio(pcm16: Int16Array | ArrayBuffer): void {
    const bytes = pcm16 instanceof Int16Array ? new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength) : new Uint8Array(pcm16);
    this.send({ realtimeInput: { audio: { data: encodeBase64(bytes), mimeType: 'audio/pcm;rate=16000' } } });
  }

  respondTool(callId: string, result: unknown): void {
    const name = this.toolNames.get(callId);
    this.toolNames.delete(callId);
    // A non-blocking answer must not cut the teacher off: WHEN_IDLE waits
    // for a natural pause (docs: Live API asynchronous function calling).
    // Blocking calls omit scheduling, keeping the default interrupt turn.
    const nonBlocking = name !== undefined && this.toolBlocking.get(name) === false;
    this.send({
      toolResponse: {
        functionResponses: [{ ...(name ? { name } : {}), id: callId, ...(nonBlocking ? { scheduling: 'WHEN_IDLE' } : {}), response: { result } }],
      },
    });
  }

  on(listener: LiveEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Model audio output chunks, 24 kHz 16-bit PCM, for the player to play. */
  onAudio(listener: LiveAudioListener): () => void {
    this.audioListeners.add(listener);
    return () => {
      this.audioListeners.delete(listener);
    };
  }

  close(): void {
    this.closedByUs = true;
    // A connect() still waiting for setupComplete must never hang: leaving
    // it unsettled strands callers such as the live driver.
    this.awaitSetup?.reject(new Error('Live voice was closed before setup completed.'));
    this.awaitSetup = null;
    this.closeSocket();
    this.emit({ type: 'closed' });
  }

  // -------------------------------------------------------------------------

  private send(message: unknown): void {
    // Late calls after close (a tool answer, a queued beat) are routine
    // timing, not programmer error: they drop, never throw.
    if (!this.socket) return;
    this.socket.send(JSON.stringify(message));
  }

  private setupMessage(handle: string | null): unknown {
    const setup = this.setup!;
    return {
      setup: {
        model: `models/${this.options.model}`,
        // responseModalities and speechConfig live inside generationConfig:
        // the server rejects them as setup fields (close 1007).
        generationConfig: {
          responseModalities: ['AUDIO'],
          ...(setup.voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: setup.voice } } } } : {}),
        },
        systemInstruction: { parts: [{ text: setup.instruction }] },
        ...(setup.tools.length > 0
          ? {
              tools: [
                {
                  functionDeclarations: setup.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                    behavior: tool.blocking ? 'BLOCKING' : 'NON_BLOCKING',
                  })),
                },
              ],
            }
          : {}),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: handle ? { handle } : {},
        // Audio sessions are time-capped; compression keeps a long film
        // talking instead of dropping at the cap.
        contextWindowCompression: { slidingWindow: {} },
      },
    };
  }

  private openSocket(handle: string | null, token: string): void {
    const socket = this.factory(liveUrl(token));
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify(this.setupMessage(handle)));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      this.onServerMessage(message);
    };
    socket.onerror = () => {
      this.emit({ type: 'error', message: 'The Live session hit a connection error.' });
      this.awaitSetup?.reject(new Error('The Live session failed before setup completed.'));
      this.awaitSetup = null;
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUs) {
        this.emit({ type: 'closed' });
        return;
      }
      if (this.awaitSetup) {
        this.awaitSetup.reject(new Error(`The Live session closed before setup completed${closeDetail(event)}.`));
        this.awaitSetup = null;
        this.emit({ type: 'closed' });
        return;
      }
      // The server ends time-capped sessions with goAway first; resume on
      // the stored handle with a fresh single-use token so a film outlives
      // one session, up to a bounded number of resumes per connect.
      if (this.goAwaySeen && this.reconnects < MAX_RESUMES && this.resumptionHandle) {
        this.reconnects += 1;
        this.goAwaySeen = false;
        const handle = this.resumptionHandle;
        const refresh = this.options.refreshToken;
        if (!refresh) {
          this.emit({ type: 'error', message: 'The Live session asked to resume but no fresh token is available: pass refreshToken.' });
          this.emit({ type: 'closed' });
          return;
        }
        refresh().then(
          (token) => {
            if (this.closedByUs || this.socket) return;
            this.openSocket(handle, token);
          },
          () => {
            this.emit({ type: 'error', message: 'The Live session could not mint a fresh token to resume.' });
            this.emit({ type: 'closed' });
          },
        );
        return;
      }
      this.emit({ type: 'error', message: `The Live session closed${closeDetail(event)}.` });
      this.emit({ type: 'closed' });
    };
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Closing a broken socket must never throw past close().
    }
  }

  private onServerMessage(message: unknown): void {
    // Malformed frames are skipped: nothing the server sends may throw out
    // of a socket handler.
    if (typeof message !== 'object' || message === null) return;
    const frame = message as Record<string, unknown>;
    if ('setupComplete' in frame) {
      this.awaitSetup?.resolve();
      this.awaitSetup = null;
      return;
    }
    if (typeof frame.sessionResumptionUpdate === 'object' && frame.sessionResumptionUpdate !== null) {
      const update = frame.sessionResumptionUpdate as { newHandle?: unknown; resumable?: unknown };
      if (update.resumable === true && typeof update.newHandle === 'string' && update.newHandle !== '') {
        this.resumptionHandle = update.newHandle;
      }
      return;
    }
    if ('goAway' in frame) {
      this.goAwaySeen = true;
      return;
    }
    if (typeof frame.toolCall === 'object' && frame.toolCall !== null) {
      const raw = (frame.toolCall as { functionCalls?: unknown }).functionCalls;
      if (Array.isArray(raw)) {
        for (const call of raw) {
          if (typeof call !== 'object' || call === null) continue;
          const { id, name, args } = call as { id?: unknown; name?: unknown; args?: unknown };
          if (typeof id !== 'string' || typeof name !== 'string') continue;
          this.toolNames.set(id, name);
          this.emit({ type: 'tool-call', callId: id, name, args: args ?? {} });
        }
      }
      return;
    }
    if (typeof frame.serverContent === 'object' && frame.serverContent !== null) {
      this.onServerContent(frame.serverContent);
    }
  }

  private onServerContent(content: unknown): void {
    if (typeof content !== 'object' || content === null) return;
    const body = content as Record<string, unknown>;
    if (body.interrupted === true) {
      // The beat never finished: the answer that follows is the model's
      // own, so it must not carry the interrupted beat's id.
      this.currentTurn = null;
      this.spokeThisTurn = false;
      this.transcriptSoFar = '';
      this.emit({ type: 'interrupted' });
    }
    if (typeof body.inputTranscription === 'object' && body.inputTranscription !== null) {
      const input = body.inputTranscription as { text?: unknown };
      if (typeof input.text === 'string' && input.text !== '') {
        this.learnerTranscriptSoFar += input.text;
        this.emit({ type: 'learner-transcript', text: this.learnerTranscriptSoFar });
      }
    }
    const turn = typeof body.modelTurn === 'object' && body.modelTurn !== null ? (body.modelTurn as { parts?: unknown }).parts : undefined;
    if (Array.isArray(turn)) {
      for (const part of turn) {
        if (typeof part !== 'object' || part === null) continue;
        const inline = (part as { inlineData?: unknown }).inlineData;
        const data = typeof inline === 'object' && inline !== null ? (inline as { data?: unknown }).data : undefined;
        if (typeof data !== 'string' || data === '') continue;
        let pcm: Uint8Array;
        try {
          pcm = decodeBase64(data);
        } catch {
          continue;
        }
        if (!this.spokeThisTurn) {
          this.spokeThisTurn = true;
          // The learner's turn ended when the model started answering.
          this.learnerTranscriptSoFar = '';
          this.emit({ type: 'speaking', turnId: this.currentTurn });
        }
        for (const listener of this.audioListeners) listener(pcm);
      }
    }
    const output = body.outputTranscription as { text?: unknown } | undefined;
    if (output && typeof output.text === 'string' && output.text !== '') {
      // Transcriptions arrive as chunks; the contract wants the turn so far.
      this.transcriptSoFar += output.text;
      this.emit({ type: 'transcript', text: this.transcriptSoFar, turnId: this.currentTurn });
    }
    if (body.turnComplete === true) {
      const turnId = this.currentTurn;
      this.currentTurn = null;
      this.spokeThisTurn = false;
      this.transcriptSoFar = '';
      this.learnerTranscriptSoFar = '';
      this.emit({ type: 'turn-complete', turnId });
    }
  }

  private emit(event: LiveEvent): void {
    if (event.type === 'closed') {
      if (this.emittedClosed) return;
      this.emittedClosed = true;
    }
    for (const listener of [...this.listeners]) listener(event);
  }
}

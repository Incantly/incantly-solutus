/**
 * Fakes for the lesson round 2 spec tests (no tests here): a fake lesson server that streams NDJSON by hand, a fake
 * recogniser, fake clips and browser voice, a fake silence timer and a fake board target. Nothing reaches a network, a
 * microphone or a speaker.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { expect } from 'vitest';
import { LessonConversation } from '../../src/lesson';
import type { ConversationState, ConversationTarget, SilenceTimer } from '../../src/lesson';
import type { LessonBoard } from '../../src/lesson-client';
import type { BrowserVoice, Clip, ClipSource, Recogniser, RecogniserHandlers } from '../../src/voice';

export async function until(check: () => boolean, ms = 1500): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 4));
  }
  return true;
}

export const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Lets pending promises and stream reads run without using timers (for tests that fake `setTimeout`). */
export async function settle(check: () => boolean = () => false, rounds = 400): Promise<boolean> {
  for (let i = 0; i < rounds; i++) {
    if (check()) return true;
    await new Promise<void>((r) => setImmediate(r));
  }
  return check();
}

export class FakeRecogniser implements Recogniser {
  handlers: RecogniserHandlers | undefined;
  started = 0;
  stopped = 0;
  start(h: RecogniserHandlers): void {
    this.started += 1;
    this.handlers = h;
  }
  stop(): void {
    this.stopped += 1;
  }
  /** Started and not stopped since. */
  get open(): boolean {
    return this.started > 0 && this.stopped === 0;
  }
  hear(text: string, final: boolean): void {
    this.handlers?.onText(text, final);
  }
  end(failure?: string): void {
    this.handlers?.onEnd(failure);
  }
}

/** A silence timer the test fires by hand. A cancelled timer never fires, as a real one. */
export interface FakeTimerEntry {
  readonly ms: number;
  cancelled: boolean;
  fired: boolean;
  readonly fire: () => void;
}
export class FakeTimer {
  readonly entries: FakeTimerEntry[] = [];
  readonly timer: SilenceTimer = (fire, ms) => {
    const entry: FakeTimerEntry = {
      ms,
      cancelled: false,
      fired: false,
      fire: () => {
        if (entry.cancelled || entry.fired) return;
        entry.fired = true;
        fire();
      },
    };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  /** The timers that are neither cancelled nor fired. */
  get live(): FakeTimerEntry[] {
    return this.entries.filter((e) => !e.cancelled && !e.fired);
  }
  /** Fires the live timer (the silence). */
  elapse(): void {
    for (const e of this.live) e.fire();
  }
}

/** One turn of the fake server's `/v1/lesson/turn`, fed by hand. */
export class FakeTurn {
  readonly signal: AbortSignal;
  ended = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  constructor(
    readonly request: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    this.signal = signal;
  }
  attach(c: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = c;
  }
  get aborted(): boolean {
    return this.signal.aborted;
  }
  push(event: unknown): void {
    if (this.ended) return;
    try {
      this.controller?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
    } catch {
      // the reader cancelled the stream
    }
  }
  say(text: string): void {
    this.push({ say: text });
  }
  actions(actions: readonly unknown[]): void {
    this.push({ actions });
  }
  lesson(plan: readonly string[], step: number, state = 'teaching'): void {
    this.push({ lesson: { plan, step, state } });
  }
  done(ended = false): void {
    this.push(ended ? { done: true, ended: true } : { done: true });
    this.end();
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      this.controller?.close();
    } catch {
      // already closed
    }
  }
}

export interface Seen {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

/** The server of the lesson routes: every `/turn` opens a stream the test feeds by hand. */
export class FakeLessonServer {
  readonly starts: Seen[] = [];
  readonly turns: FakeTurn[] = [];
  readonly ends: Seen[] = [];
  readonly speech: string[] = [];
  readonly all: Seen[] = [];
  private nextId = 1;
  /** The answer of the next `/start`, instead of a new lesson id. */
  startAnswer: (() => Response | Promise<Response>) | undefined;
  /** The answer of the next `/turn`, instead of a stream. */
  turnAnswer: (() => Response | Promise<Response>) | undefined;
  /** `/v1/speech` answers 503, so the browser's voice would speak. */
  speechOff = false;
  readonly fetch: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    this.all.push({ url, body });
    if (url.endsWith('/v1/speech')) {
      this.speech.push(String(body['text']));
      return this.speechOff ? new Response('{}', { status: 503 }) : new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }
    if (url.endsWith('/v1/lesson/start')) {
      this.starts.push({ url, body });
      if (this.startAnswer !== undefined) {
        const answer = this.startAnswer;
        this.startAnswer = undefined;
        return answer();
      }
      const id = `lesson-${this.nextId++}`;
      return new Response(JSON.stringify({ lessonId: id }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/v1/lesson/end')) {
      this.ends.push({ url, body });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/v1/lesson/turn')) {
      if (this.turnAnswer !== undefined) {
        const answer = this.turnAnswer;
        this.turnAnswer = undefined;
        return answer();
      }
      const signal = init?.signal ?? new AbortController().signal;
      const box: { c?: ReadableStreamDefaultController<Uint8Array> } = {};
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          box.c = c;
          signal.addEventListener('abort', () => {
            try {
              c.error(new DOMException('aborted', 'AbortError'));
            } catch {
              // already closed
            }
          });
        },
      });
      const turn = new FakeTurn(body, signal);
      if (box.c !== undefined) turn.attach(box.c);
      this.turns.push(turn);
      this.turnsSeen.push({ url, body });
      return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    }
    throw new Error(`unexpected request to ${url}`);
  }) as typeof fetch;
  readonly turnsSeen: Seen[] = [];
  get last(): FakeTurn {
    return this.turns[this.turns.length - 1] as FakeTurn;
  }
}

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type ClipState = 'new' | 'playing' | 'finished' | 'stopped';
type ClipMove = 'play' | 'end' | 'stop';
/** What a fake clip does: it plays until it ends by itself or its signal stops it. */
const CLIP_MACHINE: MachineTable<ClipState, ClipMove> = {
  new: { play: 'playing' },
  playing: { end: 'finished', stop: 'stopped' },
  finished: {},
  stopped: {},
};

/** A fake clip: plays until the test ends it, or its signal fires. */
export class FakeClip implements Clip {
  private readonly machine = new StateMachine(CLIP_MACHINE, 'new', (from, move) => this.faults.push(`${from}:${move}`));
  readonly faults: string[] = [];
  disposals = 0;
  private finish: (() => void) | undefined;
  constructor(
    readonly text: string,
    private readonly onPlay: (text: string) => void,
  ) {}
  get playing(): boolean {
    return this.machine.state === 'playing';
  }
  /** True once play was called, whatever happened after. */
  get played(): boolean {
    return this.machine.state !== 'new';
  }
  get stoppedBySignal(): boolean {
    return this.machine.state === 'stopped';
  }
  play(signal: AbortSignal): Promise<void> {
    if (this.machine.can('play')) this.machine.send('play');
    this.onPlay(this.text);
    return new Promise<void>((resolve) => {
      this.finish = () => resolve();
      const stop = (): void => {
        if (this.machine.can('stop')) this.machine.send('stop');
        resolve();
      };
      if (signal.aborted) return stop();
      signal.addEventListener('abort', stop, { once: true });
    });
  }
  dispose(): void {
    this.disposals += 1;
  }
  /** The clip ends by itself. */
  end(): void {
    if (this.machine.can('end')) this.machine.send('end');
    this.finish?.();
  }
}

export class FakeAudio {
  readonly requested: string[] = [];
  readonly signals: AbortSignal[] = [];
  readonly clips: FakeClip[] = [];
  /** Sentences whose audio is not available. */
  missing = new Set<string>();
  /** Called when a clip starts playing, with the text. */
  onPlay: (text: string) => void = () => undefined;
  readonly source: ClipSource = (text, signal) => {
    this.requested.push(text);
    this.signals.push(signal);
    if (this.missing.has(text)) return Promise.resolve(undefined);
    const clip = new FakeClip(text, (t) => this.onPlay(t));
    this.clips.push(clip);
    return Promise.resolve(clip);
  };
  clip(text: string): FakeClip {
    const c = this.clips.find((x) => x.text === text);
    if (c === undefined) throw new Error(`no clip for "${text}"`);
    return c;
  }
  get playingNow(): FakeClip | undefined {
    return this.clips.find((c) => c.playing);
  }
}

export class FakeBrowserVoice implements BrowserVoice {
  readonly said: string[] = [];
  say(text: string, signal: AbortSignal): Promise<void> {
    this.said.push(text);
    return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  }
}

/** A board target that records what the conversation asks of it. */
export class FakeTarget implements ConversationTarget {
  readonly log: string[] = [];
  readonly actionSets: (readonly unknown[])[] = [];
  boardNow: LessonBoard = { items: [{ id: 'shape:a', kind: 'text' }], more: 0, page: 'page-1' };
  actionsDelay = 0;
  board(): LessonBoard {
    return this.boardNow;
  }
  begin(): void {
    this.log.push('begin');
  }
  async actions(actions: readonly unknown[]): Promise<void> {
    this.log.push('actions:start');
    if (this.actionsDelay > 0) await tick(this.actionsDelay);
    this.actionSets.push(actions);
    this.log.push('actions:end');
  }
  finish(stopped: boolean): void {
    this.log.push(`finish:${stopped ? 'stopped' : 'done'}`);
  }
  count(entry: string): number {
    return this.log.filter((l) => l === entry).length;
  }
}

export interface Snapshot {
  readonly state: ConversationState;
  readonly micOpen: boolean;
  /** Recognisers that are open at this moment. */
  readonly openRecognisers: number;
}

export interface Rig {
  readonly conversation: LessonConversation;
  readonly server: FakeLessonServer;
  readonly audio: FakeAudio;
  readonly voice: FakeBrowserVoice;
  readonly target: FakeTarget;
  readonly timer: FakeTimer;
  readonly recognisers: FakeRecogniser[];
  readonly faults: string[];
  readonly snapshots: Snapshot[];
  /** Recognisers open while a clip started to play (must stay 0: the microphone is closed while the teacher speaks). */
  readonly openWhilePlaying: number[];
}

export interface RigOptions {
  /** False: the browser cannot listen (no recogniser). */
  listens?: boolean;
  /** False: the conversation has no board. */
  board?: boolean;
  target?: ConversationTarget;
  silenceMs?: number;
  /** False: no browser voice. */
  browser?: boolean;
}

const rigs: Rig[] = [];

/** Every test that made a rig ends with no refused move reported, and the conversation disposed. */
export function endRigs(): void {
  for (const rig of rigs.splice(0)) {
    expect(rig.faults).toEqual([]);
    rig.conversation.dispose();
  }
}

export function rig(options: RigOptions = {}): Rig {
  const server = new FakeLessonServer();
  const audio = new FakeAudio();
  const voice = new FakeBrowserVoice();
  const target = new FakeTarget();
  const timer = new FakeTimer();
  const recognisers: FakeRecogniser[] = [];
  const faults: string[] = [];
  const snapshots: Snapshot[] = [];
  const openWhilePlaying: number[] = [];
  const holder: { c?: LessonConversation } = {};
  audio.onPlay = () => openWhilePlaying.push(recognisers.filter((r) => r.open).length);
  const conversation = new LessonConversation({
    target: () => (options.board === false ? undefined : (options.target ?? target)),
    clips: audio.source,
    ...(options.browser === false ? {} : { browserVoice: voice }),
    ...(options.listens === false
      ? {}
      : {
          recogniser: () => {
            const r = new FakeRecogniser();
            recognisers.push(r);
            return r;
          },
          canListen: true,
        }),
    fetch: server.fetch,
    timer: timer.timer,
    ...(options.silenceMs !== undefined ? { silenceMs: options.silenceMs } : {}),
    onChange: () => {
      const c = holder.c;
      if (c === undefined) return;
      snapshots.push({ state: c.state, micOpen: c.micOpen, openRecognisers: recognisers.filter((r) => r.open).length });
    },
    onFault: (from, move) => faults.push(`${from}:${move}`),
  });
  holder.c = conversation;
  const r: Rig = { conversation, server, audio, voice, target, timer, recognisers, faults, snapshots, openWhilePlaying };
  rigs.push(r);
  return r;
}

/** Waits until the nth `/v1/lesson/turn` is open. */
export async function turnOf(r: Rig, n = 1): Promise<FakeTurn> {
  expect(await until(() => r.server.turns.length >= n)).toBe(true);
  return r.server.turns[n - 1] as FakeTurn;
}

/** Waits until a clip is playing for `text`, and ends it. */
export async function playOut(r: Rig, ...texts: string[]): Promise<void> {
  for (const text of texts) {
    expect(await until(() => r.audio.clips.some((c) => c.text === text && c.playing))).toBe(true);
    r.audio.clip(text).end();
  }
}

export async function reach(r: Rig, state: ConversationState): Promise<void> {
  expect(await until(() => r.conversation.state === state)).toBe(true);
}

/** A lesson that is `speaking`: started, the first turn open with the sentence "S1" playing. */
export async function toSpeaking(r: Rig, words = 'Teach me about vectors'): Promise<FakeTurn> {
  expect(r.conversation.start(words)).toBe(true);
  const turn = await turnOf(r);
  turn.say('S1');
  turn.say('S2');
  await reach(r, 'speaking');
  return turn;
}

/** A lesson that is `listening`: the first turn (one sentence) is done and spoken. */
export async function toListening(r: Rig, words = 'Teach me about vectors'): Promise<FakeTurn> {
  expect(r.conversation.start(words)).toBe(true);
  const turn = await turnOf(r);
  turn.say('Hello.');
  turn.done();
  await playOut(r, 'Hello.');
  await reach(r, 'listening');
  return turn;
}

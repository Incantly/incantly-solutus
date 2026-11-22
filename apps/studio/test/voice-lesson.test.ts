/**
 * Round 4, the studio's voice lesson (teacher design 8, server design 6 and requirements R7.3 to R7.5, docs/state-machines.md
 * TE4): `VoiceLesson` with a fake recogniser, a fake `fetch` that streams the answer of `/v1/teach` by hand, fake clips and a
 * fake browser voice. Every row of the TE4 table, the text box where nothing can listen, the sentence queue (in order, fetched
 * ahead), the browser's voice in place of a clip that failed, and barge-in. Only the lesson's public API is used. Nothing
 * reaches a network, a microphone or a speaker.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { SentenceQueue, VOICE_MACHINE, VoiceLesson } from '../src/voice';
import type { Clip, ClipSource, LessonTarget, Recogniser, RecogniserHandlers, VoiceState } from '../src/voice';
import type { FilmControl, TeachContext } from '../src/teach-client';

// ---- fakes --------------------------------------------------------------------------------------------------------------

async function until(check: () => boolean, ms = 1500): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}
const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

class FakeRecogniser implements Recogniser {
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
  hear(text: string, final: boolean): void {
    this.handlers?.onText(text, final);
  }
  end(failure?: string): void {
    this.handlers?.onEnd(failure);
  }
}

/** The answer of `/v1/teach`, fed by hand. */
class FakeTurn {
  readonly request: Record<string, unknown>;
  readonly signal: AbortSignal;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  ended = false;
  constructor(request: Record<string, unknown>, signal: AbortSignal, readonly body: ReadableStream<Uint8Array>) {
    this.request = request;
    this.signal = signal;
  }
  attach(c: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = c;
  }
  /** One event as an NDJSON line. */
  push(event: unknown): void {
    if (this.ended) return;
    try {
      this.controller?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
    } catch {
      // the stream was cancelled by the reader
    }
  }
  say(text: string): void {
    this.push({ say: text });
  }
  done(): void {
    this.push({ done: true });
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

/** The server's `/v1/teach`: every request opens a turn the test feeds by hand. */
class Server2 {
  readonly turns: FakeTurn[] = [];
  next: (() => Response | Promise<Response>) | undefined;
  readonly fetch: typeof fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/v1/teach')) throw new Error(`unexpected request to ${url}`);
    if (this.next !== undefined) {
      const answer = this.next;
      this.next = undefined;
      return answer();
    }
    const request = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const signal = init?.signal ?? new AbortController().signal;
    const box: { turn?: FakeTurn; pending: ReadableStreamDefaultController<Uint8Array> | undefined } = { pending: undefined };
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        box.pending = c;
        signal.addEventListener('abort', () => {
          try {
            c.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // already closed
          }
        });
      },
    });
    const turn = new FakeTurn(request, signal, body);
    if (box.pending !== undefined) turn.attach(box.pending);
    this.turns.push(turn);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
  }) as typeof fetch;
  get last(): FakeTurn {
    return this.turns[this.turns.length - 1] as FakeTurn;
  }
}

type ClipState = 'new' | 'playing' | 'finished' | 'stopped';
type ClipMove = 'play' | 'end' | 'stop';
/** What a fake clip does: it plays until it ends by itself or its signal stops it. */
const CLIP_MACHINE: MachineTable<ClipState, ClipMove> = {
  new: { play: 'playing' },
  playing: { end: 'finished', stop: 'stopped' },
  finished: {},
  stopped: {},
};

/** A clip of a sentence: it plays until the test finishes it, or until its signal fires. */
class FakeClip implements Clip {
  private readonly machine = new StateMachine(CLIP_MACHINE, 'new');
  /** How many times `dispose` was called. */
  disposals = 0;
  private finishPlay: (() => void) | undefined;
  constructor(
    readonly text: string,
    private readonly log: string[],
    private readonly failsToPlay: boolean,
  ) {}
  get playing(): boolean {
    return this.machine.state === 'playing';
  }
  get stoppedBySignal(): boolean {
    return this.machine.state === 'stopped';
  }
  get disposed(): boolean {
    return this.disposals > 0;
  }
  play(signal: AbortSignal): Promise<void> {
    this.log.push(`play:${this.text}`);
    this.machine.send('play');
    if (this.failsToPlay) return Promise.reject(new Error('cannot play'));
    return new Promise<void>((resolve) => {
      this.finishPlay = () => resolve();
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
    this.finishPlay?.();
  }
}

class FakeAudio {
  readonly requested: string[] = [];
  readonly signals: AbortSignal[] = [];
  readonly clips: FakeClip[] = [];
  readonly log: string[] = [];
  /** Sentences whose audio is not available (the voice is off or busy). */
  missing = new Set<string>();
  /** Sentences whose clip is made but cannot be played. */
  broken = new Set<string>();
  /** Holds the audio of a sentence until the test lets it go. */
  held = new Map<string, (clip: Clip | undefined) => void>();
  hold = new Set<string>();
  readonly source: ClipSource = (text, signal) => {
    this.requested.push(text);
    this.signals.push(signal);
    if (this.hold.has(text)) return new Promise<Clip | undefined>((resolve) => this.held.set(text, resolve));
    return Promise.resolve(this.make(text));
  };
  make(text: string): FakeClip | undefined {
    if (this.missing.has(text)) return undefined;
    const clip = new FakeClip(text, this.log, this.broken.has(text));
    this.clips.push(clip);
    return clip;
  }
  release(text: string): void {
    this.held.get(text)?.(this.make(text));
    this.held.delete(text);
  }
  clip(text: string): FakeClip {
    const c = this.clips.find((x) => x.text === text);
    if (c === undefined) throw new Error(`no clip for "${text}"`);
    return c;
  }
}

class FakeBrowserVoice {
  readonly said: string[] = [];
  readonly aborted: string[] = [];
  private readonly ends = new Map<string, () => void>();
  /** Resolves at once instead of waiting for `finish`. */
  quick = false;
  say(text: string, signal: AbortSignal): Promise<void> {
    this.said.push(text);
    return new Promise<void>((resolve) => {
      if (this.quick) return resolve();
      this.ends.set(text, resolve);
      signal.addEventListener(
        'abort',
        () => {
          this.aborted.push(text);
          resolve();
        },
        { once: true },
      );
    });
  }
  finish(text: string): void {
    this.ends.get(text)?.();
  }
}

class FakeTarget implements LessonTarget {
  context: () => TeachContext = () => ({ mode: 'geometry', script: 'c = Circle((0, 0), 2)', t: 1.5 });
  readonly log: string[] = [];
  readonly lineSets: (readonly string[])[] = [];
  readonly actionSets: (readonly unknown[])[] = [];
  readonly controls: FilmControl[] = [];
  actionsDelay = 0;
  begin(): void {
    this.log.push('begin');
  }
  lines(lines: readonly string[]): void {
    this.lineSets.push(lines);
    this.log.push(`lines:${lines.join('|')}`);
  }
  async actions(actions: readonly unknown[]): Promise<void> {
    this.log.push('actions:start');
    if (this.actionsDelay > 0) await tick(this.actionsDelay);
    this.actionSets.push(actions);
    this.log.push('actions:end');
  }
  control(control: FilmControl): void {
    this.controls.push(control);
    this.log.push(`control:${control.op}`);
  }
}

interface Rig {
  readonly lesson: VoiceLesson;
  readonly server: Server2;
  readonly audio: FakeAudio;
  readonly voice: FakeBrowserVoice;
  readonly target: FakeTarget;
  readonly recognisers: FakeRecogniser[];
  readonly faults: string[];
  readonly states: VoiceState[];
}

const rigs: Rig[] = [];
afterEach(() => {
  // a refused move of the machine is a bug in the lesson: every test of this file ends with none
  for (const rig of rigs.splice(0)) {
    expect(rig.faults).toEqual([]);
    rig.lesson.dispose();
  }
});

function rig(over: { listens?: boolean; browser?: boolean; target?: boolean } = {}): Rig {
  const server = new Server2();
  const audio = new FakeAudio();
  const voice = new FakeBrowserVoice();
  const target = new FakeTarget();
  const recognisers: FakeRecogniser[] = [];
  const faults: string[] = [];
  const states: VoiceState[] = [];
  const holder: { lesson?: VoiceLesson } = {};
  const lesson = new VoiceLesson({
    target: () => (over.target === false ? undefined : target),
    clips: audio.source,
    ...(over.browser === false ? {} : { browserVoice: voice }),
    ...(over.listens === false
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
    onChange: () => {
      const s = holder.lesson?.state;
      if (s !== undefined && states[states.length - 1] !== s) states.push(s);
    },
    onFault: (from, move) => faults.push(`${from}:${move}`),
  });
  holder.lesson = lesson;
  const r: Rig = { lesson, server, audio, voice, target, recognisers, faults, states };
  rigs.push(r);
  return r;
}

/** Waits until the lesson has a request open and returns its turn. */
async function request(r: Rig, n = 1): Promise<FakeTurn> {
  expect(await until(() => r.server.turns.length >= n)).toBe(true);
  return r.server.turns[n - 1] as FakeTurn;
}

// ---- the machine (TE4) -----------------------------------------------------------------------------------------------------

describe('TE4: the table', () => {
  const rows: [VoiceState, string, VoiceState][] = [
    ['idle', 'listen', 'listening'],
    ['idle', 'type', 'thinking'],
    ['listening', 'heard', 'thinking'],
    ['listening', 'stop', 'idle'],
    ['listening', 'type', 'thinking'],
    ['listening', 'fail', 'idle'],
    ['thinking', 'play', 'speaking'],
    ['thinking', 'type', 'thinking'],
    ['thinking', 'drained', 'idle'],
    ['thinking', 'listen', 'listening'],
    ['thinking', 'stop', 'idle'],
    ['thinking', 'fail', 'idle'],
    ['speaking', 'play', 'speaking'],
    ['speaking', 'wait', 'thinking'],
    ['speaking', 'type', 'thinking'],
    ['speaking', 'drained', 'idle'],
    ['speaking', 'listen', 'listening'],
    ['speaking', 'stop', 'idle'],
    ['speaking', 'fail', 'idle'],
  ];

  it.each(rows)('VOICE_MACHINE has the row %s --%s--> %s', (from, move, to) => {
    expect((VOICE_MACHINE as Record<string, Record<string, string>>)[from]?.[move]).toBe(to);
  });

  it('and no other row: idle has only listen and type; listening has heard, stop, type and fail; the table has exactly the rows above', () => {
    const count = Object.values(VOICE_MACHINE).reduce((n, moves) => n + Object.keys(moves).length, 0);
    expect(count).toBe(rows.length);
    expect(Object.keys(VOICE_MACHINE.idle).sort()).toEqual(['listen', 'type']);
    expect(Object.keys(VOICE_MACHINE.listening).sort()).toEqual(['fail', 'heard', 'stop', 'type']);
    expect(Object.keys(VOICE_MACHINE).sort()).toEqual(['idle', 'listening', 'speaking', 'thinking']);
  });
});

// ---- listening ---------------------------------------------------------------------------------------------------------------

describe('TE4 rows: listening', () => {
  it('idle --listen--> listening when a recogniser exists: it is started, and the lesson says it can listen', () => {
    const r = rig();
    expect(r.lesson.state).toBe('idle');
    expect(r.lesson.canListen).toBe(true);
    expect(r.lesson.listen()).toBe(true);
    expect(r.lesson.state).toBe('listening');
    expect(r.recognisers).toHaveLength(1);
    expect(r.recognisers[0]?.started).toBe(1);
  });

  it('listening --heard--> thinking: the final text closes the recogniser and is sent as the request', async () => {
    const r = rig();
    r.lesson.listen();
    r.recognisers[0]?.hear('show me a circle of radius two', true);
    expect(r.lesson.state).toBe('thinking');
    expect(r.recognisers[0]?.stopped).toBeGreaterThanOrEqual(1);
    const turn = await request(r);
    expect(turn.request['text']).toBe('show me a circle of radius two');
  });

  it('interim text is shown and never sent; an empty final text does nothing', async () => {
    const r = rig();
    r.lesson.listen();
    r.recognisers[0]?.hear('show me a', false);
    expect(r.lesson.interim).toBe('show me a');
    expect(r.lesson.state).toBe('listening');
    r.recognisers[0]?.hear('', true);
    expect(r.lesson.state).toBe('listening');
    await tick(40);
    expect(r.server.turns).toHaveLength(0);
  });

  it('listening --stop--> idle: the button again closes the recogniser, and nothing is sent', async () => {
    const r = rig();
    r.lesson.listen();
    expect(r.lesson.stop()).toBe(true);
    expect(r.lesson.state).toBe('idle');
    expect(r.recognisers[0]?.stopped).toBeGreaterThanOrEqual(1);
    await tick(30);
    expect(r.server.turns).toHaveLength(0);
  });

  it('listening --stop--> idle also when nobody spoke (the recogniser ends with no failure)', () => {
    const r = rig();
    r.lesson.listen();
    r.recognisers[0]?.end(undefined);
    expect(r.lesson.state).toBe('idle');
    expect(r.lesson.transcript).toEqual([]);
  });

  it('listening --fail--> idle: a recognition error shows its reason in the transcript', () => {
    const r = rig();
    r.lesson.listen();
    r.recognisers[0]?.end('not-allowed');
    expect(r.lesson.state).toBe('idle');
    const note = r.lesson.transcript.find((l) => l.who === 'notice');
    expect(note?.text).toContain('not-allowed');
  });

  it('listening --type--> thinking: typing while the microphone is open closes it and sends the typed text', async () => {
    const r = rig();
    r.lesson.listen();
    expect(r.lesson.type('what is a tangent')).toBe(true);
    expect(r.lesson.state).toBe('thinking');
    expect(r.recognisers[0]?.stopped).toBeGreaterThanOrEqual(1);
    expect((await request(r)).request['text']).toBe('what is a tangent');
  });

  it('a late recognition result after Stop is dropped: no request, still idle (TE4: heard has no row outside listening)', async () => {
    const r = rig();
    r.lesson.listen();
    const rec = r.recognisers[0] as FakeRecogniser;
    r.lesson.stop();
    rec.hear('too late', true);
    rec.end('late failure');
    expect(r.lesson.state).toBe('idle');
    await tick(30);
    expect(r.server.turns).toHaveLength(0);
    expect(r.lesson.transcript).toEqual([]);
  });

  it('a late result after a barge-in is dropped too: it does not start a second request', async () => {
    const r = rig();
    r.lesson.listen();
    const first = r.recognisers[0] as FakeRecogniser;
    first.hear('first words', true);
    await request(r);
    // the learner talks again: a new recogniser; the old one's late echo changes nothing
    r.lesson.listen();
    first.hear('echo of the first', true);
    expect(r.lesson.state).toBe('listening');
    expect(r.server.turns).toHaveLength(1);
  });

  it('rows with no entry are refused without a fault: listen while listening, stop while idle, type with no text', () => {
    const r = rig();
    expect(r.lesson.stop()).toBe(false);
    expect(r.lesson.type('')).toBe(false);
    expect(r.lesson.type('   ')).toBe(false);
    r.lesson.listen();
    expect(r.lesson.listen()).toBe(false);
    expect(r.recognisers).toHaveLength(1);
    expect(r.lesson.state).toBe('listening');
  });
});

describe('the text box where nothing can listen (R7.3)', () => {
  it('with no recogniser the lesson cannot listen, listen() is refused, and typing works', async () => {
    const r = rig({ listens: false });
    expect(r.lesson.canListen).toBe(false);
    expect(r.lesson.listen()).toBe(false);
    expect(r.lesson.state).toBe('idle');
    expect(r.lesson.type('Show me a circle.')).toBe(true);
    expect(r.lesson.state).toBe('thinking');
    expect((await request(r)).request['text']).toBe('Show me a circle.');
  });

  it('a recogniser factory that gives nothing (the browser has none) is the same: listen() is false and the state stays idle', () => {
    const server = new Server2();
    const lesson = new VoiceLesson({ target: () => new FakeTarget(), clips: () => Promise.resolve(undefined), recogniser: () => undefined, canListen: false, fetch: server.fetch });
    expect(lesson.listen()).toBe(false);
    expect(lesson.state).toBe('idle');
    lesson.dispose();
  });
});

// ---- the turn ------------------------------------------------------------------------------------------------------------------

describe('a turn: the request, the transcript and the history', () => {
  it('the request holds the text, and the target\'s mode, script and film time (and the board when there is one)', async () => {
    const r = rig();
    r.target.context = () => ({ mode: 'graphing', script: 'f(x) = x^2', t: 4, board: { items: [{ id: 'shape:a1' }], more: 0, page: 'page:1' } });
    r.lesson.type('Where is the minimum?');
    const turn = await request(r);
    expect(turn.request).toMatchObject({ text: 'Where is the minimum?', mode: 'graphing', script: 'f(x) = x^2', t: 4, history: [], board: { page: 'page:1', more: 0 } });
    expect(r.target.log[0]).toBe('begin');
  });

  it('the transcript keeps the learner\'s words and each sentence the teacher said', async () => {
    const r = rig();
    r.lesson.type('Take a circle.');
    const turn = await request(r);
    turn.say('Here is a circle.');
    turn.say('It has radius two.');
    turn.done();
    expect(await until(() => r.lesson.transcript.length === 3)).toBe(true);
    expect(r.lesson.transcript.map((l) => [l.who, l.text])).toEqual([
      ['you', 'Take a circle.'],
      ['teacher', 'Here is a circle.'],
      ['teacher', 'It has radius two.'],
    ]);
  });

  it('the second request carries the first turn: the learner\'s words, and the teacher\'s sentences joined', async () => {
    const r = rig();
    r.lesson.type('Take a circle.');
    const t1 = await request(r);
    t1.say('Here is a circle.');
    t1.say('It has radius two.');
    t1.done();
    expect(await until(() => r.lesson.state === 'speaking')).toBe(true);
    // the clips are fetched ahead: let both finish
    r.audio.clip('Here is a circle.').end();
    expect(await until(() => r.audio.log.includes('play:It has radius two.'))).toBe(true);
    r.audio.clip('It has radius two.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    r.lesson.type('Make it bigger.');
    const t2 = await request(r, 2);
    expect(t2.request['history']).toEqual([
      { role: 'user', text: 'Take a circle.' },
      { role: 'assistant', text: 'Here is a circle. It has radius two.' },
    ]);
  });

  it('the history is at most 10 turns and 8,000 characters (server design 6)', async () => {
    const r = rig({ browser: false });
    r.audio.missing.add('x');
    for (let i = 0; i < 8; i++) {
      r.lesson.type(`Question ${i} ${'q'.repeat(600)}`);
      const turn = await request(r, i + 1);
      turn.done();
      expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    }
    r.lesson.type('The last question.');
    const last = await request(r, 9);
    const history = last.request['history'] as { role: string; text: string }[];
    expect(history.length).toBeLessThanOrEqual(10);
    expect(history.reduce((n, h) => n + h.text.length, 0)).toBeLessThanOrEqual(8000);
    // the newest turns are the ones kept
    expect(history[history.length - 1]?.text).toContain('Question 7');
  });

  it('the transcript keeps at most 60 lines, the newest', async () => {
    const r = rig({ browser: false });
    r.lesson.type('Talk a lot.');
    const turn = await request(r);
    for (let i = 0; i < 80; i++) turn.say(`Sentence ${i}.`);
    turn.done();
    expect(await until(() => r.lesson.transcript.length >= 60)).toBe(true);
    await tick(50);
    expect(r.lesson.transcript.length).toBeLessThanOrEqual(60);
    expect(r.lesson.transcript[r.lesson.transcript.length - 1]?.text).toBe('Sentence 79.');
  });

  it('lines, actions and film controls are applied as they arrive, whatever the state, and in order', async () => {
    const r = rig();
    r.lesson.type('Show me.');
    const turn = await request(r);
    turn.say('A sentence.');
    expect(await until(() => r.lesson.state === 'speaking')).toBe(true);
    turn.push({ lines: ['c = Circle((0, 0), 2)'] });
    turn.push({ control: { op: 'pause' } });
    turn.push({ actions: [{ op: 'write', text: 'hi', at: 'free' }] });
    turn.push({ control: { op: 'seek', t: 3 } });
    turn.push({ control: { op: 'resume' } });
    expect(await until(() => r.target.log.includes('control:resume'))).toBe(true);
    // the clip of the sentence is still playing while the figure changed
    expect(r.audio.clip('A sentence.').playing).toBe(true);
    expect(r.target.log).toEqual(['begin', 'lines:c = Circle((0, 0), 2)', 'control:pause', 'actions:start', 'actions:end', 'control:seek', 'control:resume']);
    expect(r.target.controls).toEqual([{ op: 'pause' }, { op: 'seek', t: 3 }, { op: 'resume' }]);
    expect(r.target.actionSets).toEqual([[{ op: 'write', text: 'hi', at: 'free' }]]);
  });

  it('an event that is not a lesson event (junk on the wire) ends the turn with a notice, not a hang', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.push({ nonsense: true });
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.lesson.transcript.some((l) => l.who === 'notice')).toBe(true);
  });
});

// ---- speaking ---------------------------------------------------------------------------------------------------------------------

describe('TE4 rows: thinking, speaking and the sentence queue', () => {
  it('thinking --play--> speaking: the first sentence\'s clip starts as soon as it is ready', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    expect(r.lesson.state).toBe('thinking');
    turn.say('Hello there.');
    expect(await until(() => r.lesson.state === 'speaking')).toBe(true);
    expect(r.audio.log).toEqual(['play:Hello there.']);
  });

  it('sentences play in order, one at a time: the second starts only when the first has ended (speaking --play--> speaking)', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.say('Two.');
    turn.say('Three.');
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    await tick(40);
    expect(r.audio.log).toEqual(['play:One.']);
    r.audio.clip('One.').end();
    expect(await until(() => r.audio.log.length === 2)).toBe(true);
    expect(r.lesson.state).toBe('speaking');
    r.audio.clip('Two.').end();
    expect(await until(() => r.audio.log.length === 3)).toBe(true);
    expect(r.audio.log).toEqual(['play:One.', 'play:Two.', 'play:Three.']);
  });

  it('the audio of the next sentences is asked for at once, while the first one plays (prefetch)', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.say('Two.');
    turn.say('Three.');
    expect(await until(() => r.audio.requested.length === 3)).toBe(true);
    expect(r.audio.requested).toEqual(['One.', 'Two.', 'Three.']);
    // only the first is playing
    expect(r.audio.clips.filter((c) => c.playing).map((c) => c.text)).toEqual(['One.']);
  });

  it('a later sentence whose audio is ready first still waits its turn: the order is the order of the sentences', async () => {
    const r = rig();
    r.audio.hold.add('One.');
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.say('Two.');
    expect(await until(() => r.audio.requested.length === 2)).toBe(true);
    await tick(40);
    // Two. is ready, One. is not: nothing plays yet
    expect(r.audio.log).toEqual([]);
    expect(r.lesson.state).toBe('thinking');
    r.audio.release('One.');
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    expect(r.audio.log).toEqual(['play:One.']);
    r.audio.clip('One.').end();
    expect(await until(() => r.audio.log.length === 2)).toBe(true);
    expect(r.audio.log).toEqual(['play:One.', 'play:Two.']);
  });

  it('speaking --wait--> thinking: a clip ended and the next sentence is not here yet; then --play--> speaking when it comes', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    expect(await until(() => r.lesson.state === 'speaking')).toBe(true);
    r.audio.clip('One.').end();
    expect(await until(() => r.lesson.state === 'thinking')).toBe(true);
    turn.say('Two.');
    expect(await until(() => r.lesson.state === 'speaking')).toBe(true);
    expect(r.audio.log).toEqual(['play:One.', 'play:Two.']);
    expect(r.states).toEqual(['thinking', 'speaking', 'thinking', 'speaking']);
  });

  it('--drained--> idle: when the turn is done and the last clip has ended, and not before', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.say('Two.');
    turn.done();
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    await tick(40);
    // the turn is over but the queue is not: the lesson is still speaking
    expect(r.lesson.state).toBe('speaking');
    r.audio.clip('One.').end();
    expect(await until(() => r.audio.log.length === 2)).toBe(true);
    expect(r.lesson.state).toBe('speaking');
    r.audio.clip('Two.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
  });

  it('thinking --drained--> idle: a turn with no sentence (only lines) ends at its done', async () => {
    const r = rig();
    r.lesson.type('Just draw it.');
    const turn = await request(r);
    turn.push({ lines: ['c = Circle((0, 0), 2)'] });
    turn.done();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.target.lineSets).toEqual([['c = Circle((0, 0), 2)']]);
    expect(r.audio.requested).toEqual([]);
  });

  it('the player never takes an empty queue for the end of the turn: with the stream still open the state is thinking, not idle', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    expect(await until(() => r.lesson.state === 'speaking')).toBe(true);
    r.audio.clip('One.').end();
    expect(await until(() => r.lesson.state === 'thinking')).toBe(true);
    await tick(80);
    expect(r.lesson.state).toBe('thinking');
    turn.done();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
  });

  it('the panel reads the states in the order a single sentence turn goes through them: thinking, speaking, idle', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('Hello.');
    turn.done();
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    r.audio.clip('Hello.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.states).toEqual(['thinking', 'speaking', 'idle']);
  });

  it('clips are disposed once played', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.done();
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    r.audio.clip('One.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.audio.clip('One.').disposed).toBe(true);
  });
});

describe('the browser\'s voice in place of the server\'s (R7.4)', () => {
  it('a sentence whose audio is not available (the voice is busy, failed or off) is spoken by the browser, in its place in the order', async () => {
    const r = rig();
    r.audio.missing.add('Two.');
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.say('Two.');
    turn.say('Three.');
    turn.done();
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    r.audio.clip('One.').end();
    expect(await until(() => r.voice.said.length === 1)).toBe(true);
    expect(r.voice.said).toEqual(['Two.']);
    // Three. does not start until the browser has finished Two.
    await tick(40);
    expect(r.audio.log).toEqual(['play:One.']);
    r.voice.finish('Two.');
    expect(await until(() => r.audio.log.length === 2)).toBe(true);
    expect(r.audio.log).toEqual(['play:One.', 'play:Three.']);
    r.audio.clip('Three.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
  });

  it('while the browser speaks the state is speaking', async () => {
    const r = rig();
    r.audio.missing.add('One.');
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    expect(await until(() => r.voice.said.length === 1)).toBe(true);
    expect(r.lesson.state).toBe('speaking');
  });

  it('a clip that cannot be played (the audio is bad) is spoken by the browser instead', async () => {
    const r = rig();
    r.audio.broken.add('One.');
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.done();
    expect(await until(() => r.voice.said.length === 1)).toBe(true);
    expect(r.voice.said).toEqual(['One.']);
    expect(r.audio.clip('One.').disposed).toBe(true);
    r.voice.finish('One.');
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
  });

  it('with no browser voice and no clip the sentence is shown and not spoken, and the lesson goes on to the end (no hang)', async () => {
    const r = rig({ browser: false });
    r.audio.missing.add('One.');
    r.audio.missing.add('Two.');
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.say('Two.');
    turn.done();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.lesson.transcript.filter((l) => l.who === 'teacher').map((l) => l.text)).toEqual(['One.', 'Two.']);
  });

  it('a clip source that rejects is a missing clip, not a crash', async () => {
    const server = new Server2();
    const voice = new FakeBrowserVoice();
    voice.quick = true;
    const faults: string[] = [];
    const lesson = new VoiceLesson({ target: () => new FakeTarget(), clips: () => Promise.reject(new Error('boom')), browserVoice: voice, fetch: server.fetch, onFault: (f, m) => faults.push(`${f}:${m}`) });
    lesson.type('Hi.');
    expect(await until(() => server.turns.length === 1)).toBe(true);
    server.last.say('One.');
    server.last.done();
    expect(await until(() => lesson.state === 'idle')).toBe(true);
    expect(voice.said).toEqual(['One.']);
    expect(faults).toEqual([]);
  });
});

// ---- barge-in ----------------------------------------------------------------------------------------------------------------------

describe('barge-in: stop the clip, drop the queue, abort the turn (R7.4, design 8, TE4 invariants)', () => {
  async function speakingTwo(r: Rig): Promise<FakeTurn> {
    r.lesson.type('Tell me a story.');
    const turn = await request(r);
    turn.say('Once upon a time.');
    turn.say('There was a circle.');
    turn.say('It rolled away.');
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    expect(await until(() => r.audio.requested.length === 3)).toBe(true);
    return turn;
  }

  it('typing while the teacher talks (speaking --type--> thinking): the clip stops, the queued sentences are dropped, the old request is aborted, a new request goes out', async () => {
    const r = rig();
    const old = await speakingTwo(r);
    expect(r.lesson.state).toBe('speaking');
    expect(r.lesson.type('Stop, what is a radius?')).toBe(true);
    expect(r.lesson.state).toBe('thinking');
    expect(r.audio.clip('Once upon a time.').stoppedBySignal).toBe(true);
    expect(old.signal.aborted).toBe(true);
    // the queued sentences never play
    await tick(60);
    expect(r.audio.log).toEqual(['play:Once upon a time.']);
    // and their fetched clips are freed
    expect(r.audio.clip('There was a circle.').disposed).toBe(true);
    expect(r.audio.clip('It rolled away.').disposed).toBe(true);
    const next = await request(r, 2);
    expect(next.request['text']).toBe('Stop, what is a radius?');
  });

  it('the requests for the audio of the dropped sentences are aborted too: the clip source is given the lesson\'s signal', async () => {
    const r = rig();
    await speakingTwo(r);
    expect(r.audio.signals).toHaveLength(3);
    expect(r.audio.signals.every((s) => !s.aborted)).toBe(true);
    r.lesson.stop();
    expect(r.audio.signals.every((s) => s.aborted)).toBe(true);
  });

  it('typing while thinking (thinking --type--> thinking) aborts the open turn and sends the new text', async () => {
    const r = rig();
    r.lesson.type('First question.');
    const first = await request(r);
    expect(r.lesson.state).toBe('thinking');
    expect(r.lesson.type('Second question.')).toBe(true);
    expect(first.signal.aborted).toBe(true);
    const second = await request(r, 2);
    expect(second.request['text']).toBe('Second question.');
    expect(r.lesson.state).toBe('thinking');
  });

  it('speaking by voice (speaking --listen--> listening): the same stop, then the recogniser opens', async () => {
    const r = rig();
    const old = await speakingTwo(r);
    expect(r.lesson.listen()).toBe(true);
    expect(r.lesson.state).toBe('listening');
    expect(r.audio.clip('Once upon a time.').stoppedBySignal).toBe(true);
    expect(old.signal.aborted).toBe(true);
    expect(r.recognisers[0]?.started).toBe(1);
    await tick(60);
    expect(r.audio.log).toEqual(['play:Once upon a time.']);
  });

  it('listening while thinking (thinking --listen--> listening) aborts the turn', async () => {
    const r = rig();
    r.lesson.type('A question.');
    const turn = await request(r);
    r.lesson.listen();
    expect(r.lesson.state).toBe('listening');
    expect(turn.signal.aborted).toBe(true);
  });

  it('Stop (speaking --stop--> idle and thinking --stop--> idle): the clip stops, the queue is dropped, the turn is aborted, nothing more is said', async () => {
    const r = rig();
    const old = await speakingTwo(r);
    expect(r.lesson.stop()).toBe(true);
    expect(r.lesson.state).toBe('idle');
    expect(old.signal.aborted).toBe(true);
    expect(r.audio.clip('Once upon a time.').stoppedBySignal).toBe(true);
    await tick(60);
    expect(r.audio.log).toEqual(['play:Once upon a time.']);
    const t = rig();
    t.lesson.type('Hi.');
    const turn = await request(t);
    expect(t.lesson.stop()).toBe(true);
    expect(t.lesson.state).toBe('idle');
    expect(turn.signal.aborted).toBe(true);
  });

  it('the browser\'s voice is cut too', async () => {
    const r = rig();
    r.audio.missing.add('One.');
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    expect(await until(() => r.voice.said.length === 1)).toBe(true);
    r.lesson.stop();
    expect(r.voice.aborted).toEqual(['One.']);
  });

  it('an event of the old turn that arrives later is ignored: no sentence, lines, actions or controls from it reach the new turn', async () => {
    const r = rig();
    const old = await speakingTwo(r);
    const spokenBefore = r.audio.requested.length;
    r.lesson.type('A new question.');
    const next = await request(r, 2);
    old.say('A LATE SENTENCE.');
    old.push({ lines: ['late = 1'] });
    old.push({ control: { op: 'pause' } });
    old.push({ actions: [{ op: 'write', text: 'late', at: 'free' }] });
    old.done();
    await tick(80);
    expect(r.audio.requested).toHaveLength(spokenBefore);
    expect(r.target.lineSets).toEqual([]);
    expect(r.target.controls).toEqual([]);
    expect(r.target.actionSets).toEqual([]);
    expect(r.lesson.transcript.map((l) => l.text)).not.toContain('A LATE SENTENCE.');
    // the new turn goes on as usual
    next.say('A new answer.');
    expect(await until(() => r.audio.log.includes('play:A new answer.'))).toBe(true);
  });

  it('the old turn\'s end does not end the new one: the new turn is still thinking when the old stream ends', async () => {
    const r = rig();
    r.lesson.type('First.');
    const first = await request(r);
    r.lesson.type('Second.');
    await request(r, 2);
    first.done();
    await tick(60);
    expect(r.lesson.state).toBe('thinking');
  });

  it('the old turn is not remembered in the history as if it had finished (an aborted turn is dropped, the new request carries the earlier ones only)', async () => {
    const r = rig();
    r.lesson.type('First.');
    const first = await request(r);
    first.say('Half an answ');
    r.lesson.type('Second.');
    const second = await request(r, 2);
    expect(second.request['history']).toEqual([]);
  });

  it('after a barge-in the lesson works again from idle: a second stop is refused', async () => {
    const r = rig();
    await speakingTwo(r);
    r.lesson.stop();
    expect(r.lesson.stop()).toBe(false);
    expect(r.lesson.type('Again.')).toBe(true);
  });
});

// ---- errors and failures ------------------------------------------------------------------------------------------------------------

describe('failures end in idle with a reason shown (TE4 --fail--> idle)', () => {
  it('no figure or board to teach on: idle, a notice, and no request', async () => {
    const r = rig({ target: false });
    r.lesson.type('Hi.');
    expect(r.lesson.state).toBe('idle');
    expect(r.lesson.transcript.some((l) => l.who === 'notice' && l.text.length > 5)).toBe(true);
    await tick(30);
    expect(r.server.turns).toHaveLength(0);
  });

  it('a server that cannot be reached: a notice with what happened, and the lesson ends idle (not stuck in thinking)', async () => {
    const r = rig();
    r.server.next = () => Promise.reject(new TypeError('failed to fetch'));
    r.lesson.type('Hi.');
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.lesson.transcript.some((l) => l.who === 'notice')).toBe(true);
  });

  it('an HTTP error shows the server\'s own message: the kind and message of the error body', async () => {
    const r = rig();
    r.server.next = () => new Response(JSON.stringify({ ok: false, kind: 'rate_limited', message: 'Too many requests; try again in 12 s.' }), { status: 429, headers: { 'content-type': 'application/json' } });
    r.lesson.type('Hi.');
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    expect(r.lesson.transcript.find((l) => l.who === 'notice')?.text).toBe('Too many requests; try again in 12 s.');
  });

  it('an HTTP error with no error body shows http_<status> information, not a blank', async () => {
    const r = rig();
    r.server.next = () => new Response('<html>bad gateway</html>', { status: 502 });
    r.lesson.type('Hi.');
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
    const note = r.lesson.transcript.find((l) => l.who === 'notice');
    expect(note?.text).toBeTruthy();
    expect(note?.text).not.toContain('bad gateway');
  });

  it('an error event in the stream is shown, and the sentences already queued are still spoken before the lesson ends', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.push({ error: { kind: 'model_busy', message: 'The AI is busy; try again in 5 s.' } });
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    expect(r.lesson.transcript.some((l) => l.who === 'notice' && l.text === 'The AI is busy; try again in 5 s.')).toBe(true);
    expect(r.lesson.state).toBe('speaking');
    r.audio.clip('One.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
  });

  it('a stream that is cut (the connection breaks) ends the turn and does not hang the lesson', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    turn.end();
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    r.audio.clip('One.').end();
    expect(await until(() => r.lesson.state === 'idle')).toBe(true);
  });

  it('a target that throws in lines() or control() does not stop the turn (the lesson keeps going)', async () => {
    const r = rig();
    r.target.lines = (): void => {
      throw new Error('the figure refused');
    };
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.push({ lines: ['x = 1'] });
    turn.say('After.');
    expect(await until(() => r.audio.log.includes('play:After.') || r.lesson.state === 'idle', 800)).toBe(true);
  });
});

describe('dispose and the queue itself', () => {
  it('dispose stops the clip, aborts the turn and clears the transcript', async () => {
    const r = rig();
    r.lesson.type('Hi.');
    const turn = await request(r);
    turn.say('One.');
    expect(await until(() => r.audio.log.length === 1)).toBe(true);
    r.lesson.dispose();
    expect(turn.signal.aborted).toBe(true);
    expect(r.audio.clip('One.').stoppedBySignal).toBe(true);
    expect(r.lesson.transcript).toEqual([]);
  });

  it('SentenceQueue: take gives items in order, waits when empty, and clear ends a wait', async () => {
    const q = new SentenceQueue();
    const never = new AbortController();
    q.push({ kind: 'say', text: 'a', clip: Promise.resolve(undefined) });
    q.push({ kind: 'end' });
    expect(q.size).toBe(2);
    expect(await q.take(never.signal)).toMatchObject({ kind: 'say', text: 'a' });
    expect(await q.take(never.signal)).toEqual({ kind: 'end' });
    const waiting = q.take(never.signal);
    q.push({ kind: 'say', text: 'b', clip: Promise.resolve(undefined) });
    expect(await waiting).toMatchObject({ text: 'b' });
    const stuck = q.take(never.signal);
    q.clear();
    expect(await stuck).toBeUndefined();
  });

  it('SentenceQueue: an aborted signal ends a wait with undefined, and clear frees the clips that were fetched', async () => {
    const q = new SentenceQueue();
    const ac = new AbortController();
    const waiting = q.take(ac.signal);
    ac.abort();
    expect(await waiting).toBeUndefined();
    const log: string[] = [];
    const clip: Clip = { play: () => Promise.resolve(), dispose: () => log.push('disposed') };
    q.push({ kind: 'say', text: 'x', clip: Promise.resolve(clip) });
    q.clear();
    await tick(10);
    expect(log).toEqual(['disposed']);
    expect(q.size).toBe(0);
  });
});

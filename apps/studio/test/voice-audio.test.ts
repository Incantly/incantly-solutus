/**
 * Round 4, the sound side of the studio's voice lesson (teacher design 8, server design 6, requirements R7.3 to R7.5): the
 * teacher's voice from `POST /v1/speech` (an audio element for MP3, Web Audio for PCM at the `x-sample-rate` of the answer),
 * the browser's own voice, the browser's speech recognition, and the Talk panel with its text box. The browser's audio and
 * speech objects are replaced by fakes, and `fetch` by a fake, so nothing is heard and nothing reaches a network.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserRecogniser, browserVoice, canListen, speechClips } from '../src/voice-audio';
import { STATE_TEXT, mountVoice } from '../src/voice-ui';
import { mountStudio } from '../src/studio-page';
import type { LessonTarget } from '../src/voice';

// ---- fakes for the browser's audio --------------------------------------------------------------------------------------

class FakeSource {
  buffer: { rate: number; length: number } | undefined;
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  disconnected = 0;
  connect(): void {}
  start(): void {
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
  disconnect(): void {
    this.disconnected += 1;
  }
}

interface MadeBuffer {
  readonly channels: number;
  readonly length: number;
  readonly rate: number;
  readonly data: Float32Array;
}

/** The one Web Audio context of the page (the studio keeps it for all clips). */
const web = { buffers: [] as MadeBuffer[], sources: [] as FakeSource[], resumed: 0 };

class FakeAudioContext {
  destination = {};
  get state(): string {
    return web.resumed > 0 ? 'running' : 'suspended';
  }
  resume(): Promise<void> {
    web.resumed += 1;
    return Promise.resolve();
  }
  createBuffer(channels: number, length: number, rate: number): { getChannelData(i: number): Float32Array } {
    const data = new Float32Array(length);
    web.buffers.push({ channels, length, rate, data });
    return { getChannelData: () => data };
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    web.sources.push(s);
    return s;
  }
}

class FakeMediaElement {
  static all: FakeMediaElement[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  played = 0;
  playFails = false;
  constructor(readonly src: string) {
    FakeMediaElement.all.push(this);
  }
  play(): Promise<void> {
    this.played += 1;
    return this.playFails ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

const urls = { made: [] as { type: string; size: number }[], revoked: [] as string[] };

const realUrl = { create: (URL as unknown as { createObjectURL?: unknown }).createObjectURL, revoke: (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL };

beforeAll(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('Audio', FakeMediaElement);
  Object.assign(URL, {
    createObjectURL: (blob: Blob): string => {
      urls.made.push({ type: blob.type, size: blob.size });
      return `blob:fake/${urls.made.length}`;
    },
    revokeObjectURL: (u: string): void => {
      urls.revoked.push(u);
    },
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  Object.assign(URL, { createObjectURL: realUrl.create, revokeObjectURL: realUrl.revoke });
});
afterEach(() => {
  FakeMediaElement.all.length = 0;
  urls.made.length = 0;
  urls.revoked.length = 0;
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Seen {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fetchOf(answer: () => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    seen.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init });
    return answer();
  }) as typeof fetch;
}

const mp3 = (bytes = [1, 2, 3, 4]): Response => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
const pcm = (bytes: number[], rate?: string): Response => new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': 'audio/pcm', ...(rate !== undefined ? { 'x-sample-rate': rate } : {}) } });

// ---- the teacher's voice from /v1/speech -------------------------------------------------------------------------------------

describe('speechClips: the clip of a sentence from POST /v1/speech', () => {
  it('asks /v1/speech with a POST of { text } as JSON, and the lesson\'s signal', async () => {
    const seen: Seen[] = [];
    const ac = new AbortController();
    await speechClips(fetchOf(() => mp3(), seen))('Take a circle of radius two.', ac.signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('/v1/speech');
    expect(seen[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ text: 'Take a circle of radius two.' });
    expect((seen[0]?.init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(seen[0]?.init?.signal).toBe(ac.signal);
  });

  it('an MP3 answer is a clip played by an audio element on an object URL of the bytes; it ends when the element ends', async () => {
    const clip = await speechClips(fetchOf(() => mp3([9, 8, 7])))('One.', new AbortController().signal);
    expect(clip).toBeDefined();
    expect(urls.made).toEqual([{ type: 'audio/mpeg', size: 3 }]);
    const done = clip?.play(new AbortController().signal);
    const el = FakeMediaElement.all[0] as FakeMediaElement;
    expect(el.src).toBe('blob:fake/1');
    await sleep(5);
    expect(el.played).toBe(1);
    el.onended?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('an MP3 clip stops when its signal fires (the clip resolves, the element is paused), and disposing frees the object URL', async () => {
    const clip = await speechClips(fetchOf(() => mp3()))('One.', new AbortController().signal);
    const ac = new AbortController();
    const done = clip?.play(ac.signal);
    await sleep(5);
    ac.abort();
    await expect(done).resolves.toBeUndefined();
    const el = FakeMediaElement.all[0] as FakeMediaElement;
    expect(el.paused).toBe(true);
    clip?.dispose();
    expect(urls.revoked).toEqual(['blob:fake/1']);
  });

  it('an MP3 clip that the browser refuses to play (autoplay) rejects, so the lesson can use the browser\'s voice', async () => {
    const clip = await speechClips(fetchOf(() => mp3()))('One.', new AbortController().signal);
    FakeMediaElement.prototype.play = function (this: FakeMediaElement) {
      this.played += 1;
      return Promise.reject(new Error('NotAllowedError'));
    };
    await expect(clip?.play(new AbortController().signal)).rejects.toThrow();
    FakeMediaElement.prototype.play = function (this: FakeMediaElement) {
      this.played += 1;
      return Promise.resolve();
    };
  });

  it('a PCM answer is 16-bit little-endian mono played through Web Audio at the x-sample-rate of the answer', async () => {
    web.buffers.length = 0;
    // samples: 0, 16384 (0.5), -16384 (-0.5), -32768 (-1)
    const bytes = [0x00, 0x00, 0x00, 0x40, 0x00, 0xc0, 0x00, 0x80];
    const clip = await speechClips(fetchOf(() => pcm(bytes, '16000')))('One.', new AbortController().signal);
    expect(clip).toBeDefined();
    const made = web.buffers[web.buffers.length - 1] as MadeBuffer;
    expect(made.channels).toBe(1);
    expect(made.rate).toBe(16_000);
    expect(made.length).toBe(4);
    expect([...made.data]).toEqual([0, 0.5, -0.5, -1]);
  });

  it('without an x-sample-rate the PCM is read at 24,000 samples a second', async () => {
    web.buffers.length = 0;
    await speechClips(fetchOf(() => pcm([0, 0, 1, 0])))('One.', new AbortController().signal);
    expect((web.buffers[web.buffers.length - 1] as MadeBuffer).rate).toBe(24_000);
  });

  it('a PCM clip plays on a source, ends when the source ends, and stops when its signal fires', async () => {
    const clip = await speechClips(fetchOf(() => pcm([0, 0, 1, 0])))('One.', new AbortController().signal);
    const source = web.sources[web.sources.length - 1] as FakeSource;
    const done = clip?.play(new AbortController().signal);
    await sleep(5);
    expect(source.started).toBe(1);
    source.onended?.();
    await expect(done).resolves.toBeUndefined();
    const again = await speechClips(fetchOf(() => pcm([0, 0, 1, 0])))('Two.', new AbortController().signal);
    const second = web.sources[web.sources.length - 1] as FakeSource;
    const ac = new AbortController();
    const stopped = again?.play(ac.signal);
    await sleep(5);
    ac.abort();
    await expect(stopped).resolves.toBeUndefined();
    expect(second.stopped).toBe(1);
  });

  it.each([
    ['a 429', () => new Response('{"ok":false}', { status: 429 })],
    ['a 503 model_busy', () => new Response('{"ok":false,"kind":"model_busy"}', { status: 503 })],
    ['a 504', () => new Response('', { status: 504 })],
    ['an answer with no bytes', () => new Response(new Uint8Array(0), { status: 200, headers: { 'content-type': 'audio/mpeg' } })],
  ])('%s: no clip (undefined), so the browser\'s voice speaks the sentence', async (_name, answer) => {
    expect(await speechClips(fetchOf(answer))('One.', new AbortController().signal)).toBeUndefined();
  });

  it('a network error is no clip, and never a throw', async () => {
    const failing = (async () => {
      throw new TypeError('failed to fetch');
    }) as unknown as typeof fetch;
    expect(await speechClips(failing)('One.', new AbortController().signal)).toBeUndefined();
  });

  it('an aborted request is no clip either (the lesson was stopped)', async () => {
    const ac = new AbortController();
    ac.abort();
    const aborting = (async (_u: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
      return mp3();
    }) as unknown as typeof fetch;
    expect(await speechClips(aborting)('One.', ac.signal)).toBeUndefined();
  });
});

// ---- the browser's own voice -----------------------------------------------------------------------------------------------------

describe('browserVoice: the browser\'s speech synthesis (R7.4 fallback)', () => {
  class Utterance {
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }

  const install = (): { spoken: Utterance[]; cancelled: { n: number } } => {
    const spoken: Utterance[] = [];
    const cancelled = { n: 0 };
    vi.stubGlobal('speechSynthesis', { speak: (u: Utterance) => spoken.push(u), cancel: () => void (cancelled.n += 1) });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    return { spoken, cancelled };
  };

  it('is undefined where the browser has no speech synthesis', () => {
    vi.stubGlobal('speechSynthesis', undefined);
    expect(browserVoice()).toBeUndefined();
  });

  it('speaks a sentence and resolves when the utterance ends', async () => {
    const f = install();
    const voice = browserVoice();
    expect(voice).toBeDefined();
    const done = voice?.say('Hello there.', new AbortController().signal);
    expect(f.spoken.map((u) => u.text)).toEqual(['Hello there.']);
    f.spoken[0]?.onend?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('an utterance that errors still resolves (the lesson goes on)', async () => {
    const f = install();
    const done = browserVoice()?.say('Hello.', new AbortController().signal);
    f.spoken[0]?.onerror?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('a signal that fires cancels the speech and resolves; an aborted signal speaks nothing', async () => {
    const f = install();
    const ac = new AbortController();
    const done = browserVoice()?.say('Hello.', ac.signal);
    ac.abort();
    await expect(done).resolves.toBeUndefined();
    expect(f.cancelled.n).toBe(1);
    const spokenBefore = f.spoken.length;
    await browserVoice()?.say('Never.', ac.signal);
    expect(f.spoken).toHaveLength(spokenBefore);
  });
});

// ---- the browser's recognition ------------------------------------------------------------------------------------------------------

describe('browserRecogniser: speech recognition (R7.3)', () => {
  class Recognition {
    static last: Recognition | undefined;
    lang = '';
    continuous = true;
    interimResults = false;
    onresult: ((e: { results: ArrayLike<unknown> }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = 0;
    aborted = 0;
    constructor() {
      Recognition.last = this;
    }
    start(): void {
      this.started += 1;
    }
    stop(): void {}
    abort(): void {
      this.aborted += 1;
    }
  }
  const result = (transcript: string, isFinal: boolean): unknown => Object.assign([{ transcript }], { isFinal });

  it('there is none where the browser has no SpeechRecognition: canListen is false and no recogniser is made', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    expect(canListen()).toBe(false);
    expect(browserRecogniser()).toBeUndefined();
  });

  it('the prefixed webkitSpeechRecognition counts, and a recogniser takes one utterance with interim results', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', Recognition);
    expect(canListen()).toBe(true);
    const rec = browserRecogniser();
    expect(rec).toBeDefined();
    expect(Recognition.last?.continuous).toBe(false);
    expect(Recognition.last?.interimResults).toBe(true);
    expect(Recognition.last?.lang.length).toBeGreaterThan(1);
  });

  it('start opens the recognition; results come as text with their final flag; the transcript parts are joined', () => {
    vi.stubGlobal('SpeechRecognition', Recognition);
    const rec = browserRecogniser();
    const heard: [string, boolean][] = [];
    rec?.start({ onText: (t, f) => heard.push([t, f]), onEnd: () => undefined });
    const raw = Recognition.last as Recognition;
    expect(raw.started).toBe(1);
    raw.onresult?.({ results: [result('show me ', false)] });
    raw.onresult?.({ results: [result('show me', true), result(' a circle', true)] });
    expect(heard).toEqual([
      ['show me', false],
      ['show me a circle', true],
    ]);
  });

  it('"no speech" and "aborted" end quietly (no failure); any other error is the failure reason; the end of the session is a quiet end', () => {
    vi.stubGlobal('SpeechRecognition', Recognition);
    const ends: (string | undefined)[] = [];
    browserRecogniser()?.start({ onText: () => undefined, onEnd: (f) => ends.push(f) });
    const raw = Recognition.last as Recognition;
    raw.onerror?.({ error: 'no-speech' });
    raw.onerror?.({ error: 'aborted' });
    raw.onerror?.({ error: 'not-allowed' });
    raw.onend?.();
    expect(ends).toEqual([undefined, undefined, 'not-allowed', undefined]);
  });

  it('stop aborts the recognition and silences its handlers (a late result is dropped)', () => {
    vi.stubGlobal('SpeechRecognition', Recognition);
    const rec = browserRecogniser();
    const heard: string[] = [];
    rec?.start({ onText: (t) => heard.push(t), onEnd: () => undefined });
    const raw = Recognition.last as Recognition;
    rec?.stop();
    expect(raw.aborted).toBe(1);
    expect(raw.onresult).toBeNull();
    expect(raw.onend).toBeNull();
  });

  it('a recognition that cannot start ends with a failure, not a throw', () => {
    class Broken extends Recognition {
      override start(): void {
        throw new Error('already started');
      }
    }
    vi.stubGlobal('SpeechRecognition', Broken);
    const ends: (string | undefined)[] = [];
    browserRecogniser()?.start({ onText: () => undefined, onEnd: (f) => ends.push(f) });
    expect(ends).toHaveLength(1);
    expect(ends[0]).toBeDefined();
  });
});

// ---- the panel -------------------------------------------------------------------------------------------------------------------------

describe('the Talk panel (R7.3: a text box where recognition is missing)', () => {
  const target = (): LessonTarget => ({ context: () => ({ mode: 'geometry', script: '', t: 0 }), begin: () => undefined, lines: () => undefined, actions: () => Promise.resolve(), control: () => undefined });

  /** A fetch for the whole path: /v1/teach streams one sentence, /v1/speech answers an MP3. */
  function network(): { fetch: typeof fetch; seen: Seen[] } {
    const seen: Seen[] = [];
    const f = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, init });
      if (url === '/v1/teach') return new Response(`${JSON.stringify({ say: 'Here is a circle.' })}\n${JSON.stringify({ say: 'It has radius two.' })}\n${JSON.stringify({ done: true })}\n`, { status: 200 });
      return mp3();
    }) as typeof fetch;
    return { fetch: f, seen };
  }

  it('where the browser cannot listen there is no microphone button, and the text box takes the question', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const net = network();
    const ui = mountVoice({ target, fetch: net.fetch });
    document.body.append(ui.button, ui.panel);
    expect(ui.panel.querySelector('.voice-mic')).toBeNull();
    const input = ui.panel.querySelector<HTMLInputElement>('.voice-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'Show me a circle.';
    ui.panel.querySelector<HTMLButtonElement>('.voice-send')?.click();
    expect(input.value).toBe('');
    expect(ui.lesson.state).toBe('thinking');
    await vi.waitFor(() => expect(net.seen.some((s) => s.url === '/v1/teach')).toBe(true));
    const teach = net.seen.find((s) => s.url === '/v1/teach') as Seen;
    expect(JSON.parse(String(teach.init?.body))).toMatchObject({ text: 'Show me a circle.', mode: 'geometry' });
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });

  it('Enter in the text box sends too, and the key does not reach the studio\'s shortcuts', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const net = network();
    const ui = mountVoice({ target, fetch: net.fetch });
    document.body.append(ui.button, ui.panel);
    const input = ui.panel.querySelector<HTMLInputElement>('.voice-input') as HTMLInputElement;
    input.value = 'Hello';
    let bubbled = false;
    document.body.addEventListener('keydown', () => (bubbled = true), { once: true });
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ui.lesson.state).toBe('thinking');
    expect(bubbled).toBe(false);
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });

  it('the sentences of the answer are sent to /v1/speech at once, in order, as { text } (the whole path with fakes)', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const net = network();
    const ui = mountVoice({ target, fetch: net.fetch });
    document.body.append(ui.button, ui.panel);
    ui.lesson.type('Show me a circle.');
    await vi.waitFor(() => expect(net.seen.filter((s) => s.url === '/v1/speech')).toHaveLength(2));
    const spoken = net.seen.filter((s) => s.url === '/v1/speech').map((s) => JSON.parse(String(s.init?.body)).text);
    expect(spoken).toEqual(['Here is a circle.', 'It has radius two.']);
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });

  it('the panel starts hidden; the button opens it, and pressing it again closes it and stops the lesson', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const ui = mountVoice({ target, fetch: network().fetch });
    document.body.append(ui.button, ui.panel);
    expect(ui.panel.hidden).toBe(true);
    ui.button.click();
    expect(ui.panel.hidden).toBe(false);
    expect(ui.button.getAttribute('aria-expanded')).toBe('true');
    ui.button.click();
    expect(ui.panel.hidden).toBe(true);
    expect(ui.button.getAttribute('aria-expanded')).toBe('false');
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });

  it('the panel says what the lesson is doing, in words, for each state; Stop is off when idle', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const ui = mountVoice({ target, fetch: network().fetch });
    document.body.append(ui.button, ui.panel);
    expect(Object.keys(STATE_TEXT).sort()).toEqual(['idle', 'listening', 'speaking', 'thinking']);
    for (const text of Object.values(STATE_TEXT)) expect(text.length).toBeGreaterThan(3);
    expect(ui.panel.querySelector('.voice-status')?.textContent).toBe(STATE_TEXT.idle);
    expect(ui.panel.querySelector<HTMLButtonElement>('.voice-stop')?.disabled).toBe(true);
    ui.lesson.type('Hi.');
    expect(ui.panel.dataset['state']).toBe('thinking');
    expect(ui.panel.querySelector('.voice-status')?.textContent).toBe(STATE_TEXT.thinking);
    expect(ui.panel.querySelector<HTMLButtonElement>('.voice-stop')?.disabled).toBe(false);
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });

  it('the transcript shows the learner\'s words and the teacher\'s sentences as list items, and the text is text (no HTML is made of it)', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const ui = mountVoice({ target, fetch: network().fetch });
    document.body.append(ui.button, ui.panel);
    ui.lesson.type('<img src=x onerror=alert(1)> hello');
    await vi.waitFor(() => expect(ui.panel.querySelectorAll('.voice-log li').length).toBeGreaterThanOrEqual(2));
    expect(ui.panel.querySelector('.voice-log img')).toBeNull();
    expect(ui.panel.querySelector('.voice-log li')?.textContent).toContain('<img');
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });

  it('setAvailable(false) hides the button and stops the lesson', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const ui = mountVoice({ target, fetch: network().fetch });
    document.body.append(ui.button, ui.panel);
    ui.setAvailable(false);
    expect(ui.button.hidden).toBe(true);
    ui.setAvailable(true);
    expect(ui.button.hidden).toBe(false);
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  });
});

describe('the Talk button in the studio (R7.3: the views that hold a figure or the board)', () => {
  // the mounted studio probes /v1/health: nothing may reach a network, so the answer is a refusal
  beforeEach(() => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
  });
  const open = (mode: string): { root: HTMLElement; m: ReturnType<typeof mountStudio> } => {
    const root = document.createElement('div');
    document.body.append(root);
    return { root, m: mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, mode: mode as never }) };
  };

  it.each(['graphing', 'geometry', 'notes'])('mode %s has a visible Talk button and a closed panel', (mode) => {
    const { root, m } = open(mode);
    const button = root.querySelector<HTMLButtonElement>('.voice-talk');
    expect(button).not.toBeNull();
    expect(button?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.voice-panel')?.hidden).toBe(true);
    m.dispose();
    root.remove();
  });

  it('the scientific mode has no figure or board to teach on, so its Talk button is hidden', () => {
    const { root, m } = open('scientific');
    expect(root.querySelector<HTMLButtonElement>('.voice-talk')?.hidden).toBe(true);
    m.dispose();
    root.remove();
  });
});

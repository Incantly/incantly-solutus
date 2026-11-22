/**
 * Lesson round 2, the Talk panel (lesson design 1, 6; requirements R1.2 to R1.4; handoff/teacher/findings.md TR-50): the panel
 * on a board is the lesson (Start lesson, End lesson, the plan and the step at the top, the microphone, Space, the text box),
 * and opening it starts no microphone, in the lesson and in the single-turn voice of a graph or geometry view. `mountVoice` with
 * a fake `SpeechRecognition`, fake audio elements and a fake server. Nothing reaches a network, a microphone or a speaker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationTarget } from '../../src/lesson';
import { mountStudio } from '../../src/studio-page';
import type { LessonTarget } from '../../src/voice';
import { mountVoice } from '../../src/voice-ui';
import type { VoiceUi } from '../../src/voice-ui';
import { FakeLessonServer, FakeTarget, json, settle } from './lesson-helpers';

// ---- fakes for the browser ---------------------------------------------------------------------------------------------------

/** The browser's speech recognition: every one made is kept, and the test speaks into it. */
class Recognition {
  static all: Recognition[] = [];
  lang = '';
  continuous = true;
  interimResults = false;
  onresult: ((e: { results: ArrayLike<unknown> }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = 0;
  constructor() {
    Recognition.all.push(this);
  }
  start(): void {
    this.started += 1;
  }
  stop(): void {}
  abort(): void {
    this.aborted += 1;
  }
  say(text: string, final: boolean): void {
    this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: final })] });
  }
  /** Started and not aborted since. */
  get open(): boolean {
    return this.started > 0 && this.aborted === 0;
  }
}

/** An audio element: it plays until the test ends it or the lesson pauses it. */
class Media {
  static all: Media[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  played = 0;
  finished = false;
  constructor(readonly src: string) {
    Media.all.push(this);
  }
  play(): Promise<void> {
    this.played += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  get playing(): boolean {
    return this.played > 0 && !this.paused && !this.finished;
  }
  end(): void {
    this.finished = true;
    this.onended?.();
  }
}

const realUrl = { create: (URL as unknown as { createObjectURL?: unknown }).createObjectURL, revoke: (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL };

function listensWith(): void {
  vi.stubGlobal('SpeechRecognition', Recognition);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
}
function listensNot(): void {
  vi.stubGlobal('SpeechRecognition', undefined);
  vi.stubGlobal('webkitSpeechRecognition', undefined);
}

const mounted: VoiceUi[] = [];
beforeEach(() => {
  Recognition.all.length = 0;
  Media.all.length = 0;
  vi.stubGlobal('Audio', Media);
  Object.assign(URL, { createObjectURL: (): string => `blob:fake/${Media.all.length + 1}`, revokeObjectURL: (): void => undefined });
});
afterEach(() => {
  for (const ui of mounted.splice(0)) {
    ui.dispose();
    ui.button.remove();
    ui.panel.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.assign(URL, { createObjectURL: realUrl.create, revokeObjectURL: realUrl.revoke });
});

// ---- the panel ---------------------------------------------------------------------------------------------------------------------

const figure: LessonTarget = { context: () => ({ mode: 'geometry', script: '', t: 0 }), begin: () => undefined, lines: () => undefined, actions: () => Promise.resolve(), control: () => undefined };

interface Panel {
  readonly ui: VoiceUi;
  readonly server: FakeLessonServer;
  readonly target: FakeTarget;
  readonly input: HTMLInputElement;
  /** The buttons of the panel, by their label. */
  button(label: string): HTMLButtonElement | undefined;
}

function open(options: { board?: boolean } = {}): Panel {
  const server = new FakeLessonServer();
  const target = new FakeTarget();
  const conversation = options.board === false ? {} : { conversation: (): ConversationTarget => target };
  const ui = mountVoice({ target: () => figure, ...conversation, fetch: server.fetch });
  mounted.push(ui);
  document.body.append(ui.button, ui.panel);
  ui.button.click();
  const input = ui.panel.querySelector<HTMLInputElement>('input[type="text"]') as HTMLInputElement;
  return {
    ui,
    server,
    target,
    input,
    button: (label) => [...ui.panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label),
  };
}

const visible = (b: HTMLElement | undefined): boolean => b !== undefined && !b.hidden;
const turnOf = async (p: Panel, n = 1): Promise<NonNullable<FakeLessonServer['turns'][number]>> => {
  expect(await settle(() => p.server.turns.length >= n)).toBe(true);
  return p.server.turns[n - 1] as NonNullable<FakeLessonServer['turns'][number]>;
};
const playing = (): Media | undefined => Media.all.find((m) => m.playing);
const endAudio = async (): Promise<void> => {
  expect(await settle(() => playing() !== undefined)).toBe(true);
  playing()?.end();
};
const logText = (p: Panel): string[] => [...p.ui.panel.querySelectorAll('ol[aria-label="The lesson so far"] li')].map((li) => li.textContent ?? '');

/** Types the words and presses Start lesson. */
function startWith(p: Panel, words: string): void {
  p.input.value = words;
  p.button('Start lesson')?.click();
}

/** A first turn that spoke "Hello." and ended: the panel waits for the learner. */
async function firstTurn(p: Panel, plan?: readonly string[]): Promise<void> {
  startWith(p, 'Teach me about vectors');
  const turn = await turnOf(p);
  if (plan !== undefined) turn.lesson(plan, 1);
  turn.say('Hello.');
  turn.done();
  await endAudio();
  expect(await settle(() => p.ui.conversation.state === 'listening')).toBe(true);
}

describe('opening the Talk panel does not start the microphone (R1.4, TR-50)', () => {
  it('on a board, where the browser can listen: opening the panel makes no recognition, starts none, and the lesson is off', () => {
    listensWith();
    const p = open();
    expect(p.ui.panel.hidden).toBe(false);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    expect(p.ui.conversation.state).toBe('off');
    expect(p.ui.lesson.state).toBe('idle');
    expect(p.server.all).toHaveLength(0);
  });

  it('in the single-turn voice of a graph or geometry view too: opening the panel starts no microphone, and the voice is idle', () => {
    listensWith();
    const p = open({ board: false });
    expect(p.ui.panel.hidden).toBe(false);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    expect(p.ui.lesson.state).toBe('idle');
    expect(p.ui.panel.textContent ?? '').not.toContain('The microphone stopped');
  });

  it('closing the panel and opening it again still starts nothing', () => {
    listensWith();
    const p = open();
    p.ui.button.click();
    expect(p.ui.panel.hidden).toBe(true);
    p.ui.button.click();
    expect(p.ui.panel.hidden).toBe(false);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    expect(p.ui.conversation.state).toBe('off');
  });

  it('the microphone starts only on its button, or on Start lesson with an empty box (the single-turn voice: on its button)', () => {
    listensWith();
    const lesson = open();
    lesson.button('Talk')?.click();
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(1);
    expect(lesson.ui.conversation.state).toBe('listening');
    const single = open({ board: false });
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(1);
    single.button('Talk')?.click();
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(2);
    expect(single.ui.lesson.state).toBe('listening');
  });

  it('where the browser cannot listen there is no microphone button, and the text box is there and has the focus', () => {
    listensNot();
    const p = open();
    expect(p.button('Talk')).toBeUndefined();
    expect(p.input).not.toBeNull();
    expect(document.activeElement).toBe(p.input);
  });

  it('the opened studio: the Talk button of the notes board opens a lesson panel, and of a graph view the single-turn voice, and neither starts the microphone', () => {
    listensWith();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    for (const [mode, lessonPanel] of [
      ['notes', true],
      ['graphing', false],
    ] as const) {
      const root = document.createElement('div');
      document.body.append(root);
      const m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, mode: mode as never });
      const talk = root.querySelector<HTMLButtonElement>('.voice-talk') as HTMLButtonElement;
      talk.click();
      const panel = root.querySelector<HTMLElement>('.voice-panel') as HTMLElement;
      expect(panel.hidden, mode).toBe(false);
      expect(Recognition.all.filter((r) => r.started > 0), mode).toHaveLength(0);
      const start = [...panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === 'Start lesson');
      expect(start !== undefined && !start.hidden, mode).toBe(lessonPanel);
      m.dispose();
      root.remove();
    }
  });
});

describe('the lesson controls of the panel on a board (design 1, 6; plan Round 2 item 3)', () => {
  it('off: Start lesson is there, End lesson is not, and the plan is not shown', () => {
    listensWith();
    const p = open();
    expect(visible(p.button('Start lesson'))).toBe(true);
    expect(visible(p.button('End lesson'))).toBe(false);
    expect(p.ui.panel.querySelector('[aria-label="The plan of the lesson"]')?.parentElement?.hidden).toBe(true);
  });

  it('in a graph or geometry view there is no lesson: neither lesson button is shown', () => {
    listensWith();
    const p = open({ board: false });
    expect(visible(p.button('Start lesson'))).toBe(false);
    expect(visible(p.button('End lesson'))).toBe(false);
  });

  it('Start lesson with the words in the box starts the lesson with them: the box is emptied, /start and /turn go out, and the panel is thinking', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about linear algebra');
    expect(p.input.value).toBe('');
    expect(p.ui.conversation.state).toBe('thinking');
    expect(p.ui.panel.dataset['state']).toBe('thinking');
    const turn = await turnOf(p);
    expect(p.server.starts).toHaveLength(1);
    expect(turn.request['text']).toBe('Teach me about linear algebra');
    expect(visible(p.button('Start lesson'))).toBe(false);
    expect(visible(p.button('End lesson'))).toBe(true);
    turn.done();
  });

  it('Enter in the box starts the lesson too, and the key does not reach the studio\'s shortcuts', async () => {
    listensWith();
    const p = open();
    p.input.value = 'Teach me about vectors';
    let bubbled = false;
    document.body.addEventListener('keydown', () => (bubbled = true), { once: true });
    p.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(p.ui.conversation.state).toBe('thinking');
    expect(bubbled).toBe(false);
    (await turnOf(p)).done();
  });

  it('Start lesson with an empty box, where the browser can listen, opens the microphone to say the topic', () => {
    listensWith();
    const p = open();
    p.button('Start lesson')?.click();
    expect(p.ui.conversation.state).toBe('listening');
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(1);
    expect(p.server.all).toHaveLength(0);
  });

  it('Start lesson with an empty box, where nothing can listen, only puts the focus in the text box', () => {
    listensNot();
    const p = open();
    p.input.blur();
    p.button('Start lesson')?.click();
    expect(p.ui.conversation.state).toBe('off');
    expect(document.activeElement).toBe(p.input);
    expect(p.server.all).toHaveLength(0);
  });

  it('the plan and the current step are at the top of the panel, from the lesson event, and the step moves with the next event', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about linear algebra');
    const turn = await turnOf(p);
    const plan = ['Vectors', 'Adding them', 'Scaling', 'Matrices as moves', 'Solving'];
    turn.lesson(plan, 1);
    const shown = (): string => p.ui.panel.textContent ?? '';
    expect(await settle(() => shown().includes('Matrices as moves'))).toBe(true);
    for (const title of plan) expect(shown()).toContain(title);
    expect(shown()).toMatch(/1 of 5|1\/5/);
    const now = (): string | undefined => p.ui.panel.querySelector('[aria-current="step"]')?.textContent ?? undefined;
    expect(now()).toBe('Vectors');
    turn.lesson(plan, 3);
    expect(await settle(() => now() === 'Scaling')).toBe(true);
    expect(shown()).toMatch(/3 of 5|3\/5/);
    // the plan comes before the transcript in the panel
    const planNode = p.ui.panel.querySelector('[aria-label="The plan of the lesson"]') as HTMLElement;
    const logNode = p.ui.panel.querySelector('ol[aria-label="The lesson so far"]') as HTMLElement;
    expect(planNode.compareDocumentPosition(logNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    turn.done();
  });

  it('the transcript shows the learner\'s words and the teacher\'s sentences as text, not as HTML', async () => {
    listensWith();
    const p = open();
    startWith(p, '<img src=x onerror=alert(1)> hello');
    const turn = await turnOf(p);
    turn.say('A vector is <b>an arrow</b>.');
    turn.done();
    expect(await settle(() => logText(p).length >= 2)).toBe(true);
    expect(logText(p)).toEqual(['<img src=x onerror=alert(1)> hello', 'A vector is <b>an arrow</b>.']);
    expect(p.ui.panel.querySelector('ol img, ol b')).toBeNull();
  });

  it('End lesson ends the lesson: off, the server is told with the lesson id, and Start lesson is offered again', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    (await turnOf(p)).say('One moment.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    p.button('End lesson')?.click();
    expect(p.ui.conversation.state).toBe('off');
    expect(playing()).toBeUndefined();
    expect(await settle(() => p.server.ends.length === 1)).toBe(true);
    expect(p.server.ends[0]?.body).toEqual({ lessonId: 'lesson-1' });
    expect(visible(p.button('End lesson'))).toBe(false);
    expect(visible(p.button('Start a new lesson') ?? p.button('Start lesson'))).toBe(true);
  });

  it('when the server says the lesson is gone, the panel offers "Start a new lesson"', async () => {
    listensWith();
    const p = open();
    await firstTurn(p);
    p.server.turnAnswer = () => json({ ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' }, 404);
    p.ui.conversation.type('more');
    expect(await settle(() => p.ui.conversation.state === 'off')).toBe(true);
    const offer = [...p.ui.panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => /start a new lesson/i.test(b.textContent ?? ''));
    expect(visible(offer)).toBe(true);
  });

  it('a start that failed shows the server\'s message in the panel and offers Start lesson again', async () => {
    listensWith();
    const p = open();
    p.server.startAnswer = () => json({ ok: false, kind: 'model_unavailable', message: 'The teacher has no model key set.' }, 503);
    startWith(p, 'Teach me about vectors');
    expect(await settle(() => p.ui.conversation.state === 'off')).toBe(true);
    expect(logText(p)).toContain('The teacher has no model key set.');
    expect(visible([...p.ui.panel.querySelectorAll<HTMLButtonElement>('button')].find((b) => /start/i.test(b.textContent ?? '')))).toBe(true);
  });

  it('the server\'s end of the lesson (done with ended) leaves the panel off, the microphone shut and the transcript on screen', async () => {
    listensWith();
    const p = open();
    startWith(p, 'stop the lesson');
    const turn = await turnOf(p);
    turn.say('Well done.');
    turn.done(true);
    await endAudio();
    expect(await settle(() => p.ui.conversation.state === 'off')).toBe(true);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    expect(logText(p)).toContain('Well done.');
  });
});

describe('the conversation through the panel: the microphone opens by itself, barge-in, silence (R1.2, R1.3, design 6)', () => {
  it('after the teacher\'s last sentence the microphone opens by itself, and not before; what the learner says is the next turn', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    turn.say('Ready?');
    turn.done();
    expect(await settle(() => playing() !== undefined)).toBe(true);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    playing()?.end();
    expect(await settle(() => playing() !== undefined)).toBe(true);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    playing()?.end();
    expect(await settle(() => p.ui.conversation.state === 'listening')).toBe(true);
    const mic = Recognition.all.filter((r) => r.open);
    expect(mic).toHaveLength(1);
    mic[0]?.say('Yes', true);
    expect(p.ui.conversation.state).toBe('thinking');
    expect((await turnOf(p, 2)).request['text']).toBe('Yes');
  });

  it('while the teacher speaks no recognition is open, and the panel shows the words heard only while listening', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(0);
    turn.done();
    playing()?.end();
    expect(await settle(() => p.ui.conversation.state === 'listening')).toBe(true);
    Recognition.all.find((r) => r.open)?.say('what is', false);
    expect(p.ui.panel.textContent).toContain('what is');
  });

  it('a click on the microphone while the teacher speaks interrupts: the audio stops, the turn is aborted, and the microphone opens', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    turn.say('More.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    const clip = playing() as Media;
    p.button('Talk')?.click();
    expect(p.ui.conversation.state).toBe('listening');
    expect(clip.paused).toBe(true);
    expect(turn.aborted).toBe(true);
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(1);
    expect(p.target.log.at(-1)).toBe('finish:stopped');
  });

  it('Space interrupts the teacher the same way', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(space);
    expect(p.ui.conversation.state).toBe('listening');
    expect(turn.aborted).toBe(true);
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(1);
    expect(space.defaultPrevented).toBe(true);
  });

  it('Space typed in the text box is a space, not an interruption', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    p.input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(p.ui.conversation.state).toBe('speaking');
    expect(turn.aborted).toBe(false);
  });

  it('typing in the box while the teacher speaks is a barge-in: the old turn is aborted and the typed words are the next turn', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    p.input.value = 'Slow down';
    p.button('Send')?.click();
    expect(turn.aborted).toBe(true);
    expect((await turnOf(p, 2)).request['text']).toBe('Slow down');
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(0);
  });

  it('8 seconds of silence pause the lesson: nothing at 7.9 s, paused at 8 s, and the microphone is closed', async () => {
    listensWith();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = open();
    await firstTurn(p);
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(1);
    vi.advanceTimersByTime(7999);
    expect(p.ui.conversation.state).toBe('listening');
    vi.advanceTimersByTime(1);
    expect(p.ui.conversation.state).toBe('paused');
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(0);
    expect(p.server.ends).toHaveLength(0);
    expect(visible(p.button('End lesson'))).toBe(true);
  });

  it('words heard stop the silence timer: 8 s later the lesson is still listening', async () => {
    listensWith();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = open();
    await firstTurn(p);
    Recognition.all.find((r) => r.open)?.say('um', false);
    vi.advanceTimersByTime(20_000);
    expect(p.ui.conversation.state).toBe('listening');
  });

  it('paused: a click on the microphone listens again, and typing goes on with the same lesson', async () => {
    listensWith();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = open();
    await firstTurn(p);
    vi.advanceTimersByTime(8000);
    expect(p.ui.conversation.state).toBe('paused');
    p.button('Talk')?.click();
    expect(p.ui.conversation.state).toBe('listening');
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(1);
    vi.advanceTimersByTime(8000);
    expect(p.ui.conversation.state).toBe('paused');
    p.input.value = 'I am back';
    p.button('Send')?.click();
    expect(p.ui.conversation.state).toBe('thinking');
    expect((await turnOf(p, 2)).request).toMatchObject({ lessonId: 'lesson-1', text: 'I am back' });
  });

  it('a microphone that fails (not allowed) pauses the lesson and the panel says that typing works', async () => {
    listensWith();
    const p = open();
    await firstTurn(p);
    Recognition.all.find((r) => r.open)?.onerror?.({ error: 'not-allowed' });
    expect(p.ui.conversation.state).toBe('paused');
    expect((p.ui.panel.textContent ?? '').toLowerCase()).toContain('type');
    expect(logText(p).some((t) => t.toLowerCase().includes('microphone'))).toBe(true);
  });

  it('closing the panel pauses the lesson: the teacher stops, nothing listens, the lesson is not ended', async () => {
    listensWith();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    expect(await settle(() => playing() !== undefined)).toBe(true);
    const clip = playing() as Media;
    p.ui.button.click();
    expect(p.ui.panel.hidden).toBe(true);
    expect(p.ui.conversation.state).toBe('paused');
    expect(clip.paused).toBe(true);
    expect(turn.aborted).toBe(true);
    expect(Recognition.all.filter((r) => r.open)).toHaveLength(0);
    expect(p.server.ends).toHaveLength(0);
  });
});

describe('where the browser cannot listen the text box is the way in (R1.2)', () => {
  it('after the last sentence the text box has the focus, no microphone is made, and typing goes on the same way', async () => {
    listensNot();
    const p = open();
    startWith(p, 'Teach me about vectors');
    const turn = await turnOf(p);
    turn.say('Hello.');
    turn.done();
    p.input.blur();
    await endAudio();
    expect(await settle(() => p.ui.conversation.state === 'listening')).toBe(true);
    expect(Recognition.all).toHaveLength(0);
    expect(document.activeElement).toBe(p.input);
    expect((p.ui.panel.textContent ?? '').toLowerCase()).toContain('type');
    p.input.value = 'It gets bigger?';
    p.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(p.ui.conversation.state).toBe('thinking');
    const second = await turnOf(p, 2);
    expect(second.request).toMatchObject({ lessonId: 'lesson-1', text: 'It gets bigger?' });
    second.say('Yes.');
    second.done();
    await endAudio();
    expect(await settle(() => p.ui.conversation.state === 'listening')).toBe(true);
    expect(document.activeElement).toBe(p.input);
  });

  it('it never pauses by silence: no timer is running, so waiting for the learner takes as long as the learner takes', async () => {
    listensNot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = open();
    await firstTurn(p);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(p.ui.conversation.state).toBe('listening');
  });
});

describe('TR-50: a microphone that is refused says plainly that typing works', () => {
  it('in the single-turn voice: the microphone button, then "not-allowed", gives a line that names the microphone and says the learner can type', () => {
    listensWith();
    const p = open({ board: false });
    p.button('Talk')?.click();
    Recognition.all.find((r) => r.open)?.onerror?.({ error: 'not-allowed' });
    expect(p.ui.lesson.state).toBe('idle');
    const lines = logText(p);
    expect(lines.some((t) => t.toLowerCase().includes('microphone'))).toBe(true);
    expect(lines.some((t) => t.toLowerCase().includes('type'))).toBe(true);
  });
});

describe('the single-turn voice of a graph or geometry view is not the lesson (design 6, LE2 "Where")', () => {
  it('the answer is spoken and the voice goes idle: the microphone does not open again by itself', async () => {
    listensWith();
    const server = new FakeLessonServer();
    const net: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === '/v1/teach') return new Response(`${JSON.stringify({ say: 'Here is a circle.' })}\n${JSON.stringify({ done: true })}\n`, { status: 200 });
      return server.fetch(input, init);
    };
    const ui = mountVoice({ target: () => figure, fetch: net });
    mounted.push(ui);
    document.body.append(ui.button, ui.panel);
    ui.button.click();
    expect(ui.lesson.type('Show me a circle.')).toBe(true);
    expect(await settle(() => playing() !== undefined)).toBe(true);
    playing()?.end();
    expect(await settle(() => ui.lesson.state === 'idle')).toBe(true);
    await settle(() => false, 20);
    expect(Recognition.all.filter((r) => r.started > 0)).toHaveLength(0);
    expect(ui.conversation.state).toBe('off');
  });
});

import { describe, expect, it } from 'vitest';
import {
  FakeLiveVoice,
  FilmController,
  LIVE_TEACHER_INSTRUCTION,
  liveToolDeclarations,
  LiveDriver,
  resolveAskAnchor,
  SceneRuntime,
  THIRTY_SECOND_FILM,
  type AskAnchor,
  type CompiledFilm,
  type FilmSceneInput,
  type LiveDriverEvent,
  type LiveMakeExample,
  type LiveShowMe,
} from '../src/index';
import { trustFixture } from './helpers/film';

async function fixture(): Promise<{ readonly film: CompiledFilm; readonly scenes: readonly FilmSceneInput[] }> {
  return trustFixture(THIRTY_SECOND_FILM);
}

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Setup {
  readonly film: CompiledFilm;
  readonly runtime: SceneRuntime;
  readonly controller: FilmController;
  readonly voice: FakeLiveVoice;
  readonly driver: LiveDriver;
  readonly events: LiveDriverEvent[];
}

async function setup(options: { readonly showMe?: LiveShowMe; readonly makeExample?: LiveMakeExample } = {}): Promise<Setup> {
  const { film, scenes } = await fixture();
  const runtime = mounted(scenes[0]!);
  const controller = new FilmController({ runtime, film });
  const voice = new FakeLiveVoice();
  const events: LiveDriverEvent[] = [];
  const driver = new LiveDriver({
    controller,
    film,
    voice,
    runtime,
    ...(options.showMe ? { showMe: options.showMe } : {}),
    ...(options.makeExample ? { makeExample: options.makeExample } : {}),
    onEvent: (event) => events.push(event),
  });
  return { film, runtime, controller, voice, driver, events };
}

function answerFor(voice: FakeLiveVoice, callId: string): unknown {
  return voice.answers.find((answer) => answer.callId === callId)?.result;
}

/** The live utterance id of the nth line the voice was asked to say. */
function saidId(voice: FakeLiveVoice, index: number): string {
  return voice.said[index]!.turnId;
}

/** The beat an utterance id names; turn ids are opaque on the wire. */
function saidBeat(turnId: string): string {
  return turnId.split('#')[0]!;
}

describe('live voice: fake', () => {
  it('records setups, lines, context and tool answers, and emits events', async () => {
    const { film } = await fixture();
    const voice = new FakeLiveVoice();
    const seen: string[] = [];
    voice.on((event) => seen.push(event.type));
    await voice.connect({ instruction: 'teach', tools: [] });
    voice.say(film.beats[0]!.step.say, 's1b1');
    voice.sendContext('earlier: a pivot');
    voice.respondTool('c1', { ok: true });
    voice.emit({ type: 'turn-complete', turnId: 's1b1' });
    voice.close();
    expect(voice.connected).toBe(true);
    expect(voice.setups).toHaveLength(1);
    expect(voice.said).toEqual([{ text: film.beats[0]!.step.say, turnId: 's1b1' }]);
    expect(voice.contexts).toEqual(['earlier: a pivot']);
    expect(answerFor(voice, 'c1')).toEqual({ ok: true });
    expect(seen).toEqual(['turn-complete', 'closed']);
    expect(voice.closed).toBe(true);
  });

  it('records typed learner questions in order', async () => {
    const voice = new FakeLiveVoice();
    await voice.connect({ instruction: 'teach', tools: [] });
    voice.ask('Why does it keep the same time?');
    voice.ask('What if I push harder?');
    expect(voice.questions).toEqual(['Why does it keep the same time?', 'What if I push harder?']);
  });
});

describe('live voice: driver beats', () => {
  it('connects with the teacher instruction and tools, and reads beats in order', async () => {
    const { film, controller, voice, driver, events, runtime } = await setup();
    await driver.start();
    expect(controller.advance).toBe('click');
    expect(voice.setups).toHaveLength(1);
    expect(voice.setups[0]!.instruction).toBe(LIVE_TEACHER_INSTRUCTION);
    expect(voice.setups[0]!.tools.map((tool) => tool.name)).toEqual(['pause', 'resume', 'seek_beat', 'get_context', 'show_me', 'make_example']);
    expect(voice.setups[0]!.tools.find((tool) => tool.name === 'make_example')!.blocking).toBe(false);
    // The session declares this film's own tools, not a static list.
    expect(voice.setups[0]!.tools).toEqual(liveToolDeclarations(film, runtime));
    for (let i = 0; i < 5; i++) {
      voice.emit({ type: 'turn-complete', turnId: saidId(voice, i) });
    }
    // Every reading is its own utterance, even of a beat read once.
    expect(new Set(voice.said.map((line) => line.turnId)).size).toBe(6);
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2', 's1b3', 's1b4', 's1b5', 's1b6']);
    expect(voice.said.map((line) => line.text)).toEqual(film.beats.map((beat) => beat.step.say));
    expect(controller.currentBeat?.id).toBe('s1b6');
    expect(driver.saidBeats.map((beat) => beat.id)).toEqual(['s1b1', 's1b2', 's1b3', 's1b4', 's1b5', 's1b6']);
    // The last beat finishes the film instead of saying another line.
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 5) });
    expect(voice.said).toHaveLength(6);
    expect(driver.driverState).toBe('done');
    expect(events.map((event) => event.type)).toContain('done');
    expect(events.filter((event) => event.type === 'said').map((event) => (event as { beat: string }).beat)).toEqual([
      's1b1',
      's1b2',
      's1b3',
      's1b4',
      's1b5',
      's1b6',
    ]);
    controller.destroy();
  });

  it('ignores a turn-complete for a stale turnId', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: 's1b9' });
    voice.emit({ type: 'turn-complete', turnId: null });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1']);
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });
});

describe('live voice: teacher prompt', () => {
  it('tells the model the film pauses itself and resume waits for the learner', async () => {
    expect(LIVE_TEACHER_INSTRUCTION).toContain('pauses itself');
    expect(LIVE_TEACHER_INSTRUCTION).toContain('only when the learner');
    expect(LIVE_TEACHER_INSTRUCTION).toContain('Never invent visuals');
    const { controller, voice, driver } = await setup();
    await driver.start();
    const tools = voice.setups[0]!.tools;
    expect(tools.find((tool) => tool.name === 'pause')!.description).toContain('pauses itself');
    expect(tools.find((tool) => tool.name === 'resume')!.description).toContain('carry on');
    controller.destroy();
  });
});

describe('live voice: captions', () => {
  it('shows the voice transcript for the current beat, falling back to beat text', async () => {
    const { film, controller, voice, driver } = await setup();
    await driver.start();
    expect(driver.caption()).toBe(film.beats[0]!.step.say);
    voice.emit({ type: 'transcript', text: 'A pendulum hangs', turnId: 's1b1' });
    expect(driver.caption()).toBe('A pendulum hangs');
    // Another turn's transcript never leaks into this beat's caption.
    voice.emit({ type: 'transcript', text: 'Something else', turnId: 's1b9' });
    expect(driver.caption()).toBe('A pendulum hangs');
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(driver.caption()).toBe(film.beats[1]!.step.say);
    controller.destroy();
  });
});

describe('live voice: interrupt', () => {
  it('pauses and pins the word the transcript had reached', async () => {
    const { controller, voice, driver, events } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    controller.play();
    expect(controller.isPlaying).toBe(true);
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: 's1b2' });
    voice.emit({ type: 'interrupted' });
    expect(controller.isPlaying).toBe(false);
    const anchor = driver.lastAnchor;
    expect(anchor).toMatchObject({ beat: 's1b2', wordIndex: 3 });
    expect(anchor?.controlValues.angle).toEqual(expect.any(Number));
    expect(Array.isArray(anchor?.readouts)).toBe(true);
    expect(events.filter((event) => event.type === 'anchor')).toHaveLength(1);
    controller.destroy();
  });

  it('pins the first word when the voice had said nothing yet', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'interrupted' });
    expect(driver.lastAnchor).toMatchObject({ beat: 's1b1', wordIndex: 0 } satisfies Partial<AskAnchor>);
    controller.destroy();
  });

  it('pauses and pins the anchor when the learner types mid-reading', async () => {
    const { controller, voice, driver, events } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    controller.play();
    expect(controller.isPlaying).toBe(true);
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: 's1b2' });
    // A typed question cuts in the same way a spoken one does: the driver
    // pauses first, then the host sends the text as a learner turn.
    driver.interrupt();
    expect(controller.isPlaying).toBe(false);
    expect(driver.lastAnchor).toMatchObject({ beat: 's1b2', wordIndex: 3 });
    expect(events.filter((event) => event.type === 'anchor')).toHaveLength(1);
    controller.destroy();
  });

  it('ignores interrupt when the driver is not live', async () => {
    const { controller, driver } = await setup();
    driver.interrupt();
    expect(driver.lastAnchor).toBeNull();
    expect(controller.isPlaying).toBe(false);
    controller.destroy();
  });

  it('pushes the screen state to the voice on interrupt', async () => {
    const { controller, runtime, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'interrupted' });
    // One context line, before any answer: beat text, said ids, values, readouts.
    expect(voice.contexts).toHaveLength(1);
    const line = voice.contexts[0]!;
    expect(line).toContain('Pull the bob aside');
    expect(line).toContain('s1b1');
    expect(line).toContain('s1b2');
    expect(line).toContain('angle=0.5 rad');
    const readouts = runtime.uiState().readouts;
    if (readouts.length > 0) expect(line).toContain(readouts[0]!.text);
    controller.destroy();
  });

  it('holds a resume tool call until the model answer ends', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    voice.emit({ type: 'speaking', turnId: null });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'resume', args: {} });
    await flush();
    // The answer is still going: nothing said, no tool answer yet.
    expect(answerFor(voice, 'c1')).toBeUndefined();
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2']);
    voice.emit({ type: 'turn-complete', turnId: null });
    await flush();
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, beat: 's1b2', fromWord: 3 });
    expect(voice.said[voice.said.length - 1]).toEqual({ text: 'aside, let go, and watch the swing begin.', turnId: saidId(voice, 2) });
    controller.destroy();
  });

  it('queues a host resume while the model answers', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    voice.emit({ type: 'speaking', turnId: null });
    expect(driver.resume()).toEqual({ ok: true, queued: true });
    await flush();
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2']);
    voice.emit({ type: 'turn-complete', turnId: null });
    await flush();
    expect(voice.said[voice.said.length - 1]).toEqual({ text: 'aside, let go, and watch the swing begin.', turnId: saidId(voice, 2) });
    expect(controller.currentBeat?.id).toBe('s1b2');
    controller.destroy();
  });
});

describe('live voice: tools', () => {
  it('pauses through the tool and pins the word that was said', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    controller.play();
    voice.emit({ type: 'transcript', text: 'A pendulum hangs', turnId: 's1b1' });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'pause', args: {} });
    await flush();
    // Three words said, not the clock: the anchor is the third word.
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, beat: 's1b1', wordIndex: 2 });
    expect(controller.isPlaying).toBe(false);
    expect(driver.lastAnchor).toMatchObject({ beat: 's1b1', wordIndex: 2 });
    controller.destroy();
  });

  it('ignores a late turn-complete while paused by the pause tool', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'pause', args: {} });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true });
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1']);
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });

  it('ignores a late turn-complete while interrupted', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    // The provider still closes the cut-off turn; the paused film holds.
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 1) });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2']);
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(driver.driverState).toBe('live');
    controller.destroy();
  });

  it('resumes with the remainder of the interrupted beat', async () => {
    const { film, controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    const anchor = driver.lastAnchor!;
    const at = resolveAskAnchor(film, anchor)!;
    const cutOff = saidId(voice, 1);
    const seeks: number[] = [];
    controller.on((event) => {
      if (event.type === 'seek') seeks.push(event.time);
    });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, beat: 's1b2', fromWord: 3 });
    expect(seeks[0]).toBeCloseTo(at, 9);
    // The unheard rest of beat 2 is read as its own utterance.
    const reread = saidId(voice, 2);
    expect(reread).not.toBe(cutOff);
    expect(voice.said[voice.said.length - 1]).toEqual({ text: 'aside, let go, and watch the swing begin.', turnId: reread });
    expect(controller.currentBeat?.id).toBe('s1b2');
    // The cut-off turn's close arrives first and is stale: the film holds.
    voice.emit({ type: 'turn-complete', turnId: cutOff });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2', 's1b2']);
    expect(controller.currentBeat?.id).toBe('s1b2');
    // The re-read's own close advances normally to the next beat.
    voice.emit({ type: 'turn-complete', turnId: reread });
    expect(voice.said[voice.said.length - 1]).toEqual({ text: film.beats[2]!.step.say, turnId: saidId(voice, 3) });
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.destroy();
  });

  it('advances the re-read when the cut-off turn closes as null', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    // The real client clears its turn on interrupt: the cut-off close is null.
    voice.emit({ type: 'turn-complete', turnId: null });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true, beat: 's1b2' });
    const reread = saidId(voice, 2);
    voice.emit({ type: 'turn-complete', turnId: reread });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2', 's1b2', 's1b3']);
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.destroy();
  });

  it('advances the re-read when the cut-off turn never closes', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    // No close for the cut-off utterance ever arrives.
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true, beat: 's1b2' });
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 2) });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2', 's1b2', 's1b3']);
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.destroy();
  });

  it('re-reads the sought beat when resume follows a seek', async () => {
    const { film, controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    // Jumping back to beat 1 retires the interrupt pin and pins beat 1.
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'seek_beat', args: { beat: 's1b1' } });
    await flush();
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, beat: 's1b1' });
    expect(driver.lastAnchor).toMatchObject({ beat: 's1b1', wordIndex: 0 });
    // Resume re-reads where the film stands instead of teleporting away.
    voice.emit({ type: 'tool-call', callId: 'c2', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c2')).toEqual({ ok: true, beat: 's1b1', fromWord: 0 });
    expect(voice.said[voice.said.length - 1]).toEqual({ text: film.beats[0]!.step.say, turnId: saidId(voice, 3) });
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });

  it('resumes with the next beat when the film drifted past a completed anchor', async () => {
    const { film, controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'interrupted' });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true, beat: 's1b2' });
    const reread = saidId(voice, 2);
    // The cut-off close is stale; the re-read's own close moves the film on.
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 1) });
    voice.emit({ type: 'turn-complete', turnId: reread });
    expect(controller.currentBeat?.id).toBe('s1b3');
    // The anchor is beat 2, completed, and the film stands on beat 3: resume
    // returns to the anchor and continues with the next beat.
    const anchor = driver.lastAnchor!;
    voice.emit({ type: 'tool-call', callId: 'c2', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c2')).toEqual({ ok: true, beat: 's1b3' });
    expect(voice.said[voice.said.length - 1]).toEqual({ text: film.beats[2]!.step.say, turnId: saidId(voice, 4) });
    expect(controller.currentBeat?.id).toBe('s1b3');
    expect(driver.lastAnchor?.beat).toBe(anchor.beat);
    controller.destroy();
  });

  it('refuses resume with no recorded anchor', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    expect(driver.lastAnchor).toBeNull();
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'resume', args: {} });
    await flush();
    const result = answerFor(voice, 'c1') as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    // The film never moved and the host can resume the same way.
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1']);
    expect(driver.resume()).toMatchObject({ ok: false });
    controller.destroy();
  });

  it('seeks by beat id and by index, then reads the beat', async () => {
    const { film, controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'seek_beat', args: { beat: 's1b4' } });
    await flush();
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, beat: 's1b4' });
    expect(controller.currentBeat?.id).toBe('s1b4');
    expect(voice.said[voice.said.length - 1]).toEqual({ text: film.beats[3]!.step.say, turnId: saidId(voice, 1) });
    voice.emit({ type: 'tool-call', callId: 'c2', name: 'seek_beat', args: { beat: 0 } });
    await flush();
    expect(answerFor(voice, 'c2')).toEqual({ ok: true, beat: 's1b1' });
    expect(driver.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });

  it('answers get_context with the beat, said beats, source lines, values and readouts', async () => {
    const { film, controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'get_context', args: {} });
    await flush();
    const result = answerFor(voice, 'c1') as {
      ok: boolean;
      current: { id: string; text: string };
      said: { id: string; text: string }[];
      sourceLines: number[];
      values: Record<string, number>;
      readouts: { label: string; text: string }[];
    };
    expect(result.ok).toBe(true);
    expect(result.current).toEqual({ id: 's1b2', text: film.beats[1]!.step.say });
    expect(result.said.map((line) => line.id)).toEqual(['s1b1', 's1b2']);
    expect(result.said[0]!.text).toBe(film.beats[0]!.step.say);
    expect(result.sourceLines).toEqual([...(film.sourceMap['s1b2']?.lines ?? [])]);
    expect(result.values.angle).toEqual(expect.any(Number));
    expect(Array.isArray(result.readouts)).toBe(true);
    controller.destroy();
  });

  it('shows me through the default beginShowMe binding', async () => {
    const { film, controller, runtime, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    // The beat replay lands its own set, then the requested values on top.
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'show_me', args: { set: { angle: 0.9 }, beat: 's1b5' } });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true, beat: 's1b5', set: { angle: 0.9 } });
    expect(runtime.values().angle).toBe(0.9);
    expect(runtime.values().push).toBe(0.8);
    expect(controller.isPlaying).toBe(false);
    expect(driver.lastAnchor?.beat).toBe('s1b2');
    expect(film.beats).toHaveLength(6);
    controller.destroy();
  });

  it('calls the host showMe with the current beat when no beat is named', async () => {
    const seen: Array<{ set: Readonly<Record<string, number>>; beat: string }> = [];
    const { controller, runtime, voice, driver } = await setup({
      showMe: ((set: Readonly<Record<string, number>>, beat: { id: string }) => {
        seen.push({ set, beat: beat.id });
        return { replayed: beat.id };
      }) as LiveShowMe,
    });
    await driver.start();
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'show_me', args: { set: { angle: 0.7 } } });
    await flush();
    expect(seen).toEqual([{ set: { angle: 0.7 }, beat: 's1b1' }]);
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true, beat: 's1b1' });
    // A host binding owns the values; the film still holds on its beat.
    expect(runtime.values().angle).not.toBe(0.7);
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });

  it('makes an example through the host and answers when it resolves', async () => {
    const seen: Array<{ request: string; anchor: AskAnchor }> = [];
    const { controller, voice, driver } = await setup({
      makeExample: (async (request: string, anchor: AskAnchor) => {
        seen.push({ request, anchor });
        return { clipId: 'clip-1' };
      }) as LiveMakeExample,
    });
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'interrupted' });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'make_example', args: { request: '  Another swing  ' } });
    await flush();
    await flush();
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, request: 'Another swing', result: { clipId: 'clip-1' } });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.anchor.beat).toBe('s1b2');
    controller.destroy();
  });

  it('holds the film while an example is generated, then resumes its remainder', async () => {
    let resolveHost!: (value: unknown) => void;
    const { controller, voice, driver } = await setup({
      makeExample: () => new Promise<unknown>((resolve) => { resolveHost = resolve; }),
    });
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'make_example', args: { request: 'Another swing' } });
    await flush();
    // The host is still generating: nothing answered yet, film paused.
    expect(answerFor(voice, 'c1')).toBeUndefined();
    expect(controller.currentBeat?.id).toBe('s1b2');
    // The cut-off turn closes while the host is pending: the film must hold.
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 1) });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2']);
    expect(controller.currentBeat?.id).toBe('s1b2');
    resolveHost({ clipId: 'clip-1' });
    await flush();
    await flush();
    expect(answerFor(voice, 'c1')).toEqual({ ok: true, request: 'Another swing', result: { clipId: 'clip-1' } });
    // Resume re-reads the unheard rest of the held beat.
    voice.emit({ type: 'tool-call', callId: 'c2', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c2')).toEqual({ ok: true, beat: 's1b2', fromWord: 3 });
    expect(voice.said[voice.said.length - 1]).toEqual({ text: 'aside, let go, and watch the swing begin.', turnId: saidId(voice, 2) });
    controller.destroy();
  });

  it('holds the film while show_me runs, then resumes its remainder', async () => {
    const { controller, runtime, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'show_me', args: { set: { angle: 0.9 } } });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: true, beat: 's1b2' });
    expect(runtime.values().angle).toBe(0.9);
    // The cut-off turn closes during the demonstration: the film must hold.
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 1) });
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2']);
    expect(controller.currentBeat?.id).toBe('s1b2');
    voice.emit({ type: 'tool-call', callId: 'c2', name: 'resume', args: {} });
    await flush();
    expect(answerFor(voice, 'c2')).toEqual({ ok: true, beat: 's1b2', fromWord: 3 });
    expect(voice.said[voice.said.length - 1]).toEqual({ text: 'aside, let go, and watch the swing begin.', turnId: saidId(voice, 2) });
    controller.destroy();
  });
});

describe('live voice: tool declarations', () => {
  function setPropertiesOf(film: CompiledFilm, runtime?: SceneRuntime): Record<string, Record<string, unknown>> {
    const declarations = liveToolDeclarations(film, runtime);
    const show = declarations.find((tool) => tool.name === 'show_me')!;
    const parameters = show.parameters as { properties: { set: { properties: Record<string, Record<string, unknown>> } } };
    return parameters.properties.set.properties;
  }

  it('names this film beats and controls with their ranges', async () => {
    const { film, runtime, controller } = await setup();
    const declarations = liveToolDeclarations(film, runtime);
    expect(declarations.map((tool) => tool.name)).toEqual(['pause', 'resume', 'seek_beat', 'get_context', 'show_me', 'make_example']);
    const seek = declarations.find((tool) => tool.name === 'seek_beat')!;
    const beat = (seek.parameters as { properties: { beat: unknown } }).properties.beat as { type: string; enum: string[] };
    expect(beat.type).toBe('string');
    expect(beat.enum).toEqual(film.beats.map((candidate) => candidate.id));
    const set = setPropertiesOf(film, runtime);
    expect(set.angle).toMatchObject({ type: 'number', minimum: 0.1, maximum: 1.1 });
    expect(set.push).toMatchObject({ type: 'number', minimum: 0, maximum: 1 });
    expect(set.angle!.description as string).toContain('Start angle');
    controller.destroy();
  });

  it('uses only the provider OpenAPI subset, never additionalProperties', async () => {
    // Schema keywords are fixed; property names (beat ids, control names) are data.
    const checkSchema = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => checkSchema(item, `${path}[${index}]`));
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'properties') {
          for (const [prop, schema] of Object.entries(item as Record<string, unknown>)) checkSchema(schema, `${path}.${prop}`);
        } else {
          expect(['type', 'description', 'properties', 'required', 'enum', 'minimum', 'maximum'].includes(key), `${path}.${key}`).toBe(true);
          checkSchema(item, `${path}.${key}`);
        }
      }
    };
    const { film, runtime, controller } = await setup();
    for (const declarations of [liveToolDeclarations(film, runtime), liveToolDeclarations(film)]) {
      expect(declarations.length).toBeGreaterThan(0);
      for (const tool of declarations) {
        expect(Object.keys(tool).sort()).toEqual(['blocking', 'description', 'name', 'parameters']);
        checkSchema(tool.parameters, tool.name);
      }
    }
    controller.destroy();
  });

  it('falls back to the film beat sets without a runtime, still validating names', async () => {
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    const applied: Array<Readonly<Record<string, number>>> = [];
    const driver = new LiveDriver({
      controller,
      film,
      voice,
      showMe: ((set: Readonly<Record<string, number>>) => {
        applied.push(set);
        return null;
      }) as LiveShowMe,
    });
    const set = setPropertiesOf(film);
    expect(Object.keys(set).sort()).toEqual(['angle', 'push']);
    for (const prop of Object.values(set)) {
      expect(prop.type).toBe('number');
      expect(prop).not.toHaveProperty('minimum');
      expect(prop).not.toHaveProperty('maximum');
    }
    await driver.start();
    // Unknown controls fail; without known bounds any finite number lands.
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'show_me', args: { set: { nope: 1 } } });
    await flush();
    expect(answerFor(voice, 'c1')).toMatchObject({ ok: false });
    voice.emit({ type: 'tool-call', callId: 'c2', name: 'show_me', args: { set: { angle: 5 } } });
    await flush();
    expect(answerFor(voice, 'c2')).toMatchObject({ ok: true, set: { angle: 5 } });
    expect(applied).toEqual([{ angle: 5 }]);
    controller.destroy();
  });
});

describe('live voice: bad tool arguments', () => {
  it('rejects bad calls without throwing or moving the film', async () => {
    const { film, controller, runtime, voice, driver } = await setup();
    await driver.start();
    const angleBefore = runtime.values().angle;
    const calls: Array<[string, unknown]> = [
      ['c1', { name: 'seek_beat', args: { beat: 'missing' } }],
      ['c2', { name: 'seek_beat', args: { beat: 99 } }],
      ['c3', { name: 'seek_beat', args: {} }],
      ['c4', { name: 'show_me', args: { set: { nope: 1 } } }],
      ['c5', { name: 'show_me', args: { set: { angle: 5 } } }],
      ['c6', { name: 'show_me', args: { set: { angle: 'big' } } }],
      ['c7', { name: 'show_me', args: { set: {} } }],
      ['c8', { name: 'show_me', args: { set: { angle: 0.9 }, beat: 'missing' } }],
      ['c9', { name: 'make_example', args: { request: '' } }],
      ['c10', { name: 'make_example', args: {} }],
      ['c11', { name: 'nope', args: {} }],
      ['c12', { name: 'seek_beat', args: 's1b2' }],
    ];
    for (const [callId, call] of calls) {
      const { name, args } = call as { name: string; args: unknown };
      voice.emit({ type: 'tool-call', callId, name, args });
    }
    await flush();
    await flush();
    for (const [callId] of calls) {
      const result = answerFor(voice, callId) as { ok: boolean; error?: string };
      expect(result?.ok).toBe(false);
      expect(typeof result?.error).toBe('string');
    }
    // Nothing moved: still on the first beat, values untouched, one line said.
    expect(controller.currentBeat?.id).toBe('s1b1');
    expect(runtime.values().angle).toBe(angleBefore);
    expect(voice.said).toHaveLength(1);
    expect(film.beats).toHaveLength(6);
    expect(driver.driverState).toBe('live');
    controller.destroy();
  });
});

describe('live voice: stop', () => {
  it('keeps the learner position and restores the advance mode', async () => {
    const { film, controller, voice, driver, events } = await setup();
    controller.seek(film.beats[2]!.start);
    expect(controller.advance).toBe('time');
    await driver.start();
    expect(controller.advance).toBe('click');
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    expect(controller.currentBeat?.id).toBe('s1b4');
    driver.stop();
    expect(voice.closed).toBe(true);
    expect(controller.advance).toBe('time');
    // Live mode never seeks back: the learner stays where the voice left them.
    expect(controller.time).toBeCloseTo(film.beats[3]!.start, 9);
    expect(controller.currentBeat?.id).toBe('s1b4');
    expect(driver.driverState).toBe('idle');
    expect(events[events.length - 1]).toEqual({ type: 'stopped' });
    controller.destroy();
  });
});

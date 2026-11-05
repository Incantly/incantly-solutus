import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  attachAudio,
  cueSfx,
  FilmController,
  handleRendererMessage,
  ManualClock,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  type CompiledFilm,
  type FilmEvent,
  type FilmSceneInput,
  type FilmTransport,
  type RuntimeUpdate,
  type UiState,
} from '../src/index';
import { trustFixture } from './helpers/film';

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

function snapshot(runtime: SceneRuntime): string {
  const parts = [...runtime.parts.parts.values()]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((p) => [p.name, p.node.hidden, [...p.node.attrs].sort(), p.node.text]);
  return JSON.stringify({ parts, values: runtime.values(), focus: runtime.uiState().focus });
}

/** The last value a delivered stream drew for an attribute, or undefined when never drawn. */
function lastAttr(updates: readonly RuntimeUpdate[], id: number, name: string): string | null | undefined {
  let found: string | null | undefined;
  for (const update of updates)
    for (const command of update.commands) if (command.op === 'attr' && command.id === id && command.name === name) found = command.value;
  return found;
}

/** The last class a delivered stream set on a node, or undefined when never set. */
function lastClass(updates: readonly RuntimeUpdate[], id: number): string | undefined {
  let found: string | undefined;
  for (const update of updates) for (const command of update.commands) if (command.op === 'class' && command.id === id) found = command.value;
  return found;
}

/** The last value a delivered stream set for a UI section, or undefined when never set. */
function lastUi<K extends keyof UiState>(updates: readonly RuntimeUpdate[], key: K): UiState[K] | undefined {
  let found: UiState[K] | undefined;
  for (const update of updates) if (update.ui[key] !== undefined) found = update.ui[key];
  return found;
}

/** The last teaching step a delivered stream reported, or undefined when never reported. */
function lastStep(updates: readonly RuntimeUpdate[]): number | null | undefined {
  let found: number | null | undefined;
  for (const update of updates) if (update.step !== undefined) found = update.step;
  return found;
}

/** Drives a driver-mode controller to a film time, resuming through pause points. */
function driveTo(controller: FilmController, target: number): void {
  for (let i = 0; i < 20000 && controller.time + 1e-9 < target; i++) {
    if (!controller.isPlaying) controller.play();
    controller.tick(1 / 60);
    if (!controller.isPlaying && controller.time + 1e-9 >= target) break;
  }
}

async function thirty(): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  return trustFixture(THIRTY_SECOND_FILM);
}

describe('film controller: beats', () => {
  it('applies beats in order through a ManualClock', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const clock = new ManualClock();
    const controller = new FilmController({ runtime, film, clock, onEvent: (event) => events.push(event) });
    controller.play();
    expect(controller.currentBeat?.id).toBe('s1b1');
    // s1b2 is an explore pause point: the film pauses at its start.
    for (let i = 0; i < 2000 && controller.currentBeat?.id !== 's1b2'; i++) clock.advance(1000 / 60);
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(controller.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'pausePoint' && e.beat.id === 's1b2' && e.kind === 'explore')).toBe(true);
    // Resume and play to the end.
    for (let i = 0; i < 20000 && !events.some((e) => e.type === 'end'); i++) {
      if (!controller.isPlaying) controller.play();
      clock.advance(1000 / 60);
    }
    expect(events.some((e) => e.type === 'end')).toBe(true);
    expect(controller.time).toBeCloseTo(controller.duration, 2);
    expect(events.filter((e) => e.type === 'beat').map((e) => (e as { beat: { id: string } }).beat.id)).toEqual([
      's1b1',
      's1b2',
      's1b3',
      's1b4',
      's1b5',
      's1b6',
    ]);
    const overhead = controller.stats.boundaryMs / controller.stats.beatsApplied;
    console.log(`[film-bench] controller overhead: ${overhead.toFixed(3)} ms/beat (${controller.stats.beatsApplied} beats)`);
    controller.destroy();
  });

  it('brings show parts in and focuses beats', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    expect(runtime.parts.parts.get('Push')?.node.hidden).toBe(true);
    driveTo(controller, film.beats[4]!.start + 0.5);
    expect(controller.currentBeat?.id).toBe('s1b5');
    expect(runtime.parts.parts.get('Push')?.node.hidden).toBe(false);
    expect(runtime.uiState().focus).toBe('Push');
    expect(runtime.values().push).toBeCloseTo(0.8, 2);
    controller.destroy();
  });

  it('eases set moves over the beat ease, not the step default', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[1]!.start + 0.6);
    // Halfway through the 1.2 s ease from 0.5 to 0.9, eased halfway.
    expect(runtime.values().angle).toBeCloseTo(0.7, 1);
    driveTo(controller, film.beats[1]!.start + 1.3);
    expect(runtime.values().angle).toBeCloseTo(0.9, 2);
    controller.destroy();
  });

  it('fires sfx through the sound kit note command', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    // The cue itself queues note commands; unknown cues play nothing.
    expect(cueSfx(runtime, 'chime')).toBe(true);
    expect(cueSfx(runtime, 'klaxon')).toBe(false);
    const update = runtime.flush();
    const notes = update.commands.filter((command) => command.op === 'note');
    expect(notes.length).toBe(2);
    // The film fires its beat cue as the beat starts.
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    controller.play();
    driveTo(controller, film.beats[4]!.start + 0.2);
    expect(events.some((e) => e.type === 'sfx' && e.name === 'pop' && e.played)).toBe(true);
    controller.destroy();
  });

  it('reports an unknown sfx cue as not played', async () => {
    const { film, scenes } = await thirty();
    const beats = film.beats.map((beat, i) => (i === 0 ? { ...beat, step: { ...beat.step, sfx: 'klaxon' } } : beat));
    const retimed = { ...film, scenes: film.scenes.map((scene) => ({ ...scene, beats: beats.filter((beat) => beat.sceneId === scene.id) })), beats };
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film: retimed, onEvent: (event) => events.push(event) });
    controller.play();
    expect(events.some((event) => event.type === 'sfx' && event.name === 'klaxon' && event.played === false)).toBe(true);
    controller.destroy();
  });

  it('tracks the last applied beat cues', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    expect(controller.currentCues).toBe(null);
    controller.play();
    expect(controller.currentCues?.focusing).toBe('Pivot');
    expect(controller.currentCues?.framing).toBe(null);
    controller.seek(film.beats[2]!.start);
    expect(controller.currentCues?.focusing).toBe('Bob');
    expect(controller.currentCues?.framing?.part).toBe('Bob');
    controller.destroy();
  });

  it('pauses predict beats and answers ask with an anchor', async () => {
    const { film, scenes } = await trustFixture(SIXTY_SECOND_FILM);
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    controller.play();
    for (let i = 0; i < 20000 && controller.isPlaying; i++) controller.tick(1 / 60);
    expect(controller.currentBeat?.id).toBe('s1b5');
    expect(controller.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'pausePoint' && e.kind === 'predict')).toBe(true);
    const asked = controller.ask('Why four times?');
    expect(asked?.anchor).toMatchObject({ film: 'wave', scene: 's1', beat: 's1b5' });
    expect(asked?.lines.map((line) => line.beat)).toEqual(['s1b4', 's1b5', 's1b6']);
    controller.destroy();
  });

  it('moves kit-owned cameras absolutely and returns to wide', async () => {
    const { film, scenes } = await trustFixture(SIXTY_SECOND_FILM);
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[2]!.start + 0.2);
    const zoomed = runtime.viewControllers().map(([, controller]) => controller.changed());
    expect(zoomed.some(Boolean)).toBe(true);
    driveTo(controller, film.beats[3]!.start + 0.2);
    expect(runtime.viewControllers().every(([, controller]) => !controller.changed())).toBe(true);
    controller.destroy();
  });
});

describe('film controller: seek', () => {
  it('seeking draws what playing there draws', async () => {
    const { film, scenes } = await thirty();
    const target = film.beats[4]!.start + 1;
    const played = mounted(scenes[0]!);
    const playController = new FilmController({ runtime: played, film });
    playController.play();
    driveTo(playController, target);
    if (playController.isPlaying) playController.pause();

    const sought = mounted(scenes[0]!);
    const seekController = new FilmController({ runtime: sought, film });
    seekController.play();
    seekController.seek(target);
    seekController.pause();

    expect(sought.time).toBeCloseTo(played.time, 9);
    expect(snapshot(sought)).toBe(snapshot(played));
    expect(seekController.currentBeat?.id).toBe('s1b5');
    playController.destroy();
    seekController.destroy();
  });

  it('seeks land on the target while hidden or sped up', async () => {
    const { film, scenes } = await thirty();
    // Hidden: wall ticks skip the figure, which would strand the seek at the beat's start.
    const hidden = mounted(scenes[0]!);
    const hiddenController = new FilmController({ runtime: hidden, film });
    hidden.setVisible(false);
    hiddenController.seek(26);
    expect(hiddenController.time).toBeCloseTo(26, 9);
    expect(hiddenController.currentBeat?.id).toBe('s1b6');
    hiddenController.destroy();
    // Sped up: wall ticks run extra steps per call, which would overshoot the target.
    const fast = mounted(scenes[0]!);
    const fastController = new FilmController({ runtime: fast, film });
    fast.setSpeed(2);
    fastController.seek(26);
    expect(fastController.time).toBeCloseTo(26, 9);
    expect(fastController.currentBeat?.id).toBe('s1b6');
    fastController.destroy();
  });

  it('seeks by beat id and by anchor, never by seconds alone', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    expect(controller.seekBeat('s1b5')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b5');
    expect(controller.seekBeat('missing')).toBe(false);
    expect(controller.seekAnchor(anchorFor(film, 's1b2', 1000)!)).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(controller.seekAnchor({ film: 'other', version: 1, scene: 's1', beat: 's1b1', offsetMs: 0 })).toBe(false);
    controller.destroy();
  });

  it('keeps a paused film paused and pauses into pause points', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    controller.play();
    controller.pause();
    controller.seek(film.beats[3]!.start);
    expect(controller.isPlaying).toBe(false);
    expect(controller.currentBeat?.id).toBe('s1b4');
    controller.play();
    controller.seek(film.beats[1]!.start);
    expect(controller.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'pausePoint' && e.beat.id === 's1b2')).toBe(true);
    controller.destroy();
  });

  it('re-times when audio arrives, keeping the beat on screen', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    driveTo(controller, film.beats[2]!.start + 0.2);
    controller.retime(attachAudio(film, 's1b1', { seconds: 8 }));
    expect(controller.currentBeat?.id).toBe('s1b3');
    expect(controller.duration).toBeCloseTo(film.seconds + (8 + 0.5 - film.beats[0]!.seconds), 9);
    controller.destroy();
  });
});

describe('film controller: transport and transcript', () => {
  it('plays in observer mode while the renderer ticks', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const sent: string[] = [];
    const controller = new FilmController({
      runtime,
      film,
      transport: {
        send: (message) => {
          sent.push(message.type);
          handleRendererMessage(runtime, message);
        },
      },
    });
    controller.play();
    expect(sent[0]).toBe('play');
    // The renderer's loop ticks; the host polls once per frame.
    for (let i = 0; i < 400; i++) {
      runtime.tick(1 / 60);
      controller.poll();
    }
    expect(['s1b2', 's1b3']).toContain(controller.currentBeat?.id);
    controller.seek(film.beats[4]!.start);
    expect(sent).toContain('seek');
    expect(controller.currentBeat?.id).toBe('s1b5');
    controller.destroy();
  });

  it('seeks deliver the same figure playing there delivers', async () => {
    const { film, scenes } = await thirty();
    // Mid-beat with the transitions settled, so the beat's figure is exact on both paths.
    const target = film.beats[4]!.start + 1;
    const observe = (runtime: SceneRuntime): { delivered: RuntimeUpdate[]; transport: FilmTransport } => {
      const delivered: RuntimeUpdate[] = [];
      return {
        delivered,
        transport: {
          send: (message) => {
            const update = handleRendererMessage(runtime, message);
            if (update) delivered.push(update);
          },
          apply: (update) => delivered.push(update),
        },
      };
    };

    const played = mounted(scenes[0]!);
    const playObserved = observe(played);
    const playController = new FilmController({ runtime: played, film, transport: playObserved.transport });
    playController.play();
    for (let i = 0; i < 20000 && playController.time + 1e-9 < target; i++) {
      if (!playController.isPlaying) playController.play();
      const update = handleRendererMessage(played, { type: 'tick', dt: 1 / 60 });
      if (update) playObserved.delivered.push(update);
      playController.poll();
    }
    playController.pause();

    const sought = mounted(scenes[0]!);
    const seekObserved = observe(sought);
    const seekController = new FilmController({ runtime: sought, film, transport: seekObserved.transport });
    seekController.play();
    seekController.pause();
    seekController.seek(target);

    // Both runtimes mount the same scene, so the figure's node ids agree.
    const pushId = played.parts.parts.get('Push')!.node.id;
    const trailId = played.parts.parts.get('SwingTrail')!.node.id;
    expect(sought.parts.parts.get('Push')!.node.id).toBe(pushId);
    expect(sought.parts.parts.get('SwingTrail')!.node.id).toBe(trailId);
    // The replay reaches the renderer: past the seek's reset frame, drawing commands land.
    expect(seekObserved.delivered.filter((update) => !update.reset).flatMap((update) => update.commands).length).toBeGreaterThan(0);
    // The beat's drawn figure: Push shown with its arrow, the wide trail, the focus and the step.
    expect(lastClass(seekObserved.delivered, pushId)).toBe(lastClass(playObserved.delivered, pushId));
    expect(lastClass(seekObserved.delivered, pushId)).not.toContain('inc-hidden');
    expect(lastAttr(seekObserved.delivered, pushId, 'd')).toBe(lastAttr(playObserved.delivered, pushId, 'd'));
    expect(lastAttr(seekObserved.delivered, trailId, 'points')).toBe(lastAttr(playObserved.delivered, trailId, 'points'));
    expect(lastUi(seekObserved.delivered, 'focus')).toBe('Push');
    expect(lastUi(seekObserved.delivered, 'focus')).toBe(lastUi(playObserved.delivered, 'focus'));
    expect(lastStep(seekObserved.delivered)).toBe(4);
    expect(lastStep(seekObserved.delivered)).toBe(lastStep(playObserved.delivered));
    playController.destroy();
    seekController.destroy();
  });

  it('reads the transcript and chapters', async () => {
    const { film, scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const transcript = controller.transcript();
    expect(transcript.length).toBe(6);
    expect(transcript[0]).toMatchObject({ beat: 's1b1', start: 0 });
    expect(transcript[5]!.short).toBe('Same time');
    expect(controller.chapters()).toEqual([{ scene: 's1', title: film.scenes[0]!.title, start: 0, seconds: film.seconds, beats: ['s1b1', 's1b2', 's1b3', 's1b4', 's1b5', 's1b6'] }]);
    controller.destroy();
  });

  it('seeks through the channel with refuel per step', async () => {
    const { scenes } = await thirty();
    const runtime = mounted(scenes[0]!);
    let calls = 0;
    const update = handleRendererMessage(runtime, { type: 'seek', seconds: 1 }, { beforeStep: () => calls++ });
    expect(update?.reset).toBe(true);
    expect(calls).toBe(1 + Math.round(1 / (1 / 60)));
    expect(runtime.time).toBeCloseTo(1, 9);
  });
});

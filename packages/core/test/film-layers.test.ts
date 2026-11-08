import { describe, expect, it } from 'vitest';
import {
  accumulatedNotes,
  applyBeatCues,
  applyCueState,
  beatCard,
  beatCueState,
  beatWrite,
  compileFilm,
  explainerCardRect,
  ExportCancellation,
  exportFrameLayers,
  FilmController,
  flattenFilm,
  layerProblems,
  layoutStageWidth,
  planExportFilm,
  PlayerModel,
  probeFilm,
  renderExportChunk,
  renderMathText,
  sanitizeProbedSnapshot,
  sceneSplit,
  SceneRuntime,
  solveCard,
  solveNotes,
  solveWrite,
  splitLayout,
  writeShownAt,
  type Beat,
  type CompiledFilm,
  type FigureHandle,
  type SceneFunction,
} from '../src/index';

/**
 * Explainer layers: write-on text, step-by-step notes and full-stage cards.
 * Every layer is a pure function of the fixed film clock and beat progress,
 * so seeking to t draws what playing to t draws.
 */

const fixed = (text: string, fontPx: number): number => text.length * fontPx * 0.5;

const LAYER_STEPS: readonly Beat[] = [
  { say: 'First we set the scene for the whole film.', card: { kind: 'section', text: 'The ball' } },
  {
    say: 'The ball sits still while we write its rule.',
    focus: 'Ball',
    write: { text: 'x = 3', math: true },
    notes: ['The ball rests on the left.'],
  },
  { say: 'And that is all the ball does today.', notes: ['Nothing else moves.'] },
];

/** A ball mid-left, leaving the top-left corner and the bottom notes strip clear for layers. */
function layerScene(): SceneFunction {
  return (inc) => {
    const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Layers', description: 'A ball with room for layers.' });
    const ball = stage.circle(150, 200, 25, { tone: 'hi' });
    stage.part('Ball', ball, { label: 'Ball', info: 'A ball left of centre.' });
    // Reading time keeps the scene animated, so the film clock ticks while playing.
    inc.onFrame(({ time }) => {
      ball.at(Math.sin(time * 2) * 3, 0);
    });
    inc.steps([...LAYER_STEPS]);
  };
}

/** The same beats under a wall that covers the whole stage, so no layer slot stays clear. */
function wallScene(): SceneFunction {
  return (inc) => {
    const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Wall', description: 'A wall over everything.' });
    const wall = stage.rect(0, 0, 600, 400, { tone: 'mid' });
    stage.part('Wall', wall, { label: 'Wall', info: 'Covers the stage.' });
    const ball = stage.circle(150, 200, 25, { tone: 'hi' });
    stage.part('Ball', ball, { label: 'Ball', info: 'A ball behind the wall.' });
    inc.onFrame(({ time }) => {
      ball.at(Math.sin(time * 2) * 3, 0);
    });
    inc.steps([...LAYER_STEPS]);
  };
}

function storyboard() {
  return {
    film: { id: 'layers', title: 'Layers', version: 1, lengthTarget: 30 },
    scenes: [{ id: 's1', beats: LAYER_STEPS.map((step, i) => ({ id: `b${i + 1}`, say: step.say })) }],
  };
}

function compiledWith(scene: SceneFunction): CompiledFilm {
  const runtime = new SceneRuntime({});
  runtime.mount(scene);
  const steps = runtime.beats();
  if (!steps) throw new Error('The layer scene has no steps');
  const result = compileFilm(storyboard(), [{ id: 's1', js: '', steps: [...steps] }]);
  if (!result.ok || !result.film) throw new Error(`The layer film did not compile: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return result.film;
}

function mounted(scene: SceneFunction): SceneRuntime {
  const runtime = new SceneRuntime({ film: true });
  runtime.mount(scene);
  return runtime;
}

/** Drives a driver-mode controller to a film time; the fixture has no pause points. */
function driveTo(controller: FilmController, target: number): void {
  for (let i = 0; i < 20000 && controller.time + 1e-9 < target; i++) {
    if (!controller.isPlaying) controller.play();
    controller.tick(1 / 60);
  }
}

describe('film layers: validation', () => {
  it('accepts well-formed layers', () => {
    expect(layerProblems({ say: 'Hi.', write: { text: 'E = m*c^2', math: true }, notes: ['One line.'], card: { kind: 'recap', text: 'Done.' } })).toEqual([]);
    expect(layerProblems({ say: 'Hi.' })).toEqual([]);
  });

  it('rejects bad shapes with clear diagnostics', () => {
    expect(layerProblems({ say: 'Hi.', write: { text: '  ' } as Beat['write'] }).join(';')).toContain('write needs text');
    expect(layerProblems({ say: 'Hi.', write: 'x = 1' as unknown as Beat['write'] }).join(';')).toContain('write must be');
    expect(layerProblems({ say: 'Hi.', write: { text: 'x'.repeat(201) } }).join(';')).toContain('at most 200');
    expect(layerProblems({ say: 'Hi.', write: { text: 'x', math: 'yes' as unknown as boolean } }).join(';')).toContain('math must be');
    expect(layerProblems({ say: 'Hi.', notes: ['a', 'b', 'c', 'd', 'e'] }).join(';')).toContain('at most 4');
    expect(layerProblems({ say: 'Hi.', notes: ['x'.repeat(141)] }).join(';')).toContain('at most 140');
    expect(layerProblems({ say: 'Hi.', notes: 'one' as unknown as Beat['notes'] }).join(';')).toContain('notes must be a list');
    expect(layerProblems({ say: 'Hi.', card: { kind: 'title', text: 'Hi' } as unknown as Beat['card'] }).join(';')).toContain('not section or recap');
    expect(layerProblems({ say: 'Hi.', card: { kind: 'recap', text: '' } }).join(';')).toContain('card needs text');
  });

  it('fails compilation on malformed layers, naming the beat', () => {
    const bad: Beat[] = [
      { say: 'First we set the scene for the whole film.', card: { kind: 'section', text: 'The ball' } },
      { say: 'The ball sits still while we write its rule.', notes: ['a', 'b', 'c', 'd', 'e'] },
      { say: 'And that is all the ball does today.', write: { text: '' } },
    ];
    const result = compileFilm(storyboard(), [{ id: 's1', js: '', steps: bad }]);
    expect(result.ok).toBe(false);
    expect(result.film).toBe(null);
    expect(result.diagnostics.some((d) => d.severity === 'error' && d.beat === 'b2' && d.message.includes('at most 4'))).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'error' && d.beat === 'b3' && d.message.includes('write needs text'))).toBe(true);
  });
});

describe('film layers: cues', () => {
  it('applies a beat write, notes and card through the same path as titles', () => {
    const runtime = mounted(layerScene());
    const cues = applyBeatCues(runtime, LAYER_STEPS[1]!);
    expect(cues.title).toBe(null);
    expect(cues.write).toEqual({ text: 'x = 3', math: true });
    expect(cues.notes).toEqual(['The ball rests on the left.']);
    expect(cues.card).toBe(null);
    const carded = applyBeatCues(runtime, LAYER_STEPS[0]!);
    expect(carded.card).toEqual({ kind: 'section', text: 'The ball' });
    expect(carded.write).toBe(null);
    expect(beatWrite(LAYER_STEPS[1]!)).toEqual({ text: 'x = 3', math: true });
    expect(beatWrite(LAYER_STEPS[0]!)).toBe(null);
    expect(beatCard(LAYER_STEPS[0]!)).toEqual({ kind: 'section', text: 'The ball' });
  });

  it('accumulates notes across the scene in order', () => {
    const film = compiledWith(layerScene());
    const sceneBeats = film.scenes[0]!.beats;
    expect(accumulatedNotes(sceneBeats, 0)).toEqual([]);
    expect(accumulatedNotes(sceneBeats, 1)).toEqual(['The ball rests on the left.']);
    expect(accumulatedNotes(sceneBeats, 2)).toEqual(['The ball rests on the left.', 'Nothing else moves.']);
  });

  it('reveals write-on text with beat progress, never wall time', () => {
    const film = compiledWith(layerScene());
    const beat = film.beats[1]!;
    expect(writeShownAt(beat, beat.start)).toBe('');
    expect(writeShownAt(beat, beat.start + beat.seconds)).toBe('x = 3');
    const mid = writeShownAt(beat, beat.start + beat.seconds / 2);
    expect('x = 3'.startsWith(mid)).toBe(true);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan('x = 3'.length);
    // Clamped past either end, and silent beats show nothing.
    expect(writeShownAt(beat, beat.start - 99)).toBe('');
    expect(writeShownAt(beat, beat.start + 99)).toBe('x = 3');
    expect(writeShownAt(film.beats[0]!, film.beats[0]!.start + 1)).toBe('');
  });
});

describe('film layers: solver', () => {
  const viewBox = [0, 0, 600, 400] as const;

  it('renders simple math readably and leaves the rest literal', () => {
    expect(renderMathText('E = m*c^2')).toBe('E = m×c²');
    expect(renderMathText('a^n + b_1 <= c')).toBe('aⁿ + b_1 ≤ c');
    expect(renderMathText('x != y, x >= 0, dx -> 0')).toBe('x ≠ y, x ≥ 0, dx → 0');
    expect(renderMathText('sqrt(pi) and theta, Delta')).toBe('√(π) and θ, Δ');
    expect(renderMathText('A plain line stays plain.')).toBe('A plain line stays plain.');
    expect(renderMathText('x^q stays literal')).toBe('x^q stays literal');
  });

  it('places the write-on chip in the top-left slot clear of parts, or nowhere when full', () => {
    const part = { minX: 100, minY: 250, maxX: 200, maxY: 350 };
    const placed = solveWrite('x = 3', { viewBox: [...viewBox], stageWidthPx: 600, occupied: [part], measure: fixed });
    expect(placed).not.toBe(null);
    expect(placed!.slot).toBe(0);
    const rect = placed!.rect;
    expect(rect.minX).toBe(20);
    expect(rect.minY).toBe(20);
    expect(rect.maxX).toBeLessThanOrEqual(580);
    expect(rect.maxY).toBeLessThanOrEqual(380);
    // A blocked top-left falls through to a later corner, which the player never draws.
    const blocked = solveWrite('x = 3', { viewBox: [...viewBox], stageWidthPx: 600, occupied: [{ minX: 0, minY: 0, maxX: 300, maxY: 200 }], measure: fixed });
    expect(blocked?.slot).toBeGreaterThan(0);
    const whole = { minX: 0, minY: 0, maxX: 600, maxY: 400 };
    expect(solveWrite('x = 3', { viewBox: [...viewBox], stageWidthPx: 600, occupied: [whole], measure: fixed })).toBe(null);
  });

  it('splits notes beside wide stages and strips them along the bottom under narrow ones', () => {
    const side = solveNotes(['First line.', 'Second line.'], { viewBox: [...viewBox], stageWidthPx: 960, measure: fixed });
    expect(side.kind).toBe('side');
    // Beside the stage the column stands outside the drawing: no panel to overlap anything.
    expect(side.panel).toBe(null);
    expect(side.lines).toHaveLength(2);
    const stack = solveNotes(['First line.', 'Second line.'], { viewBox: [...viewBox], stageWidthPx: 360, measure: fixed });
    expect(stack.kind).toBe('stack');
    // The stacked strip sits along the bottom inside the safe area, where the export paints it.
    expect(stack.panel!.minX).toBe(20);
    expect(stack.panel!.maxX).toBe(580);
    expect(stack.panel!.maxY).toBe(380);
    expect(stack.panel!.minY).toBeGreaterThan(200);
    expect(solveNotes(['x'], { viewBox: [...viewBox], stageWidthPx: 640, measure: fixed }).kind).toBe('side');
  });

  it('lays split scenes out the same way for every consumer', () => {
    expect(splitLayout(false, 960)).toBe('full');
    expect(splitLayout(true, 960)).toBe('side');
    expect(splitLayout(true, 360)).toBe('stack');
    expect(splitLayout(true, 640)).toBe('side');
    expect(layoutStageWidth(960, 'side')).toBeCloseTo(960 * 0.62, 9);
    expect(layoutStageWidth(960, 'full')).toBe(960);
    expect(layoutStageWidth(360, 'stack')).toBe(360);
    expect(sceneSplit([{ step: { say: 'Hi.' } }])).toBe(false);
    expect(sceneSplit([{ step: { say: 'Hi.', notes: ['One line.'] } }])).toBe(true);
  });

  it('cards the full safe area with a line that fits', () => {
    const rect = explainerCardRect([...viewBox]);
    expect(rect).toEqual({ minX: 20, minY: 20, maxX: 580, maxY: 380 });
    const layout = solveCard('The ball', { viewBox: [...viewBox], stageWidthPx: 640, measure: fixed });
    expect(layout.overflow).toBe(false);
    expect(layout.lines).toEqual(['The ball']);
    expect(layout.fontPx).toBeGreaterThanOrEqual(12);
    const long = solveCard('w '.repeat(100).trim(), { viewBox: [...viewBox], stageWidthPx: 360, measure: fixed });
    expect(long.overflow).toBe(true);
  });
});

describe('film layers: seek equals play', () => {
  it('seeks a still scene to the absolute film time, not the time within the beat', () => {
    // A scene whose onFrame never reads time idles the runtime; the seek
    // replay loop breaks with nothing to draw, and the clock still has to
    // land on its target — otherwise the reveal and the transport read the
    // within-beat offset. This bit a layered film first, but it holds for
    // any still scene.
    const still: SceneFunction = (inc) => {
      const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Still', description: 'A still scene.' });
      const ball = stage.circle(150, 200, 25, { tone: 'hi' });
      stage.part('Ball', ball, { label: 'Ball', info: 'A still ball.' });
      inc.onFrame(() => {
        ball.at(0, 0);
      });
      inc.steps([...LAYER_STEPS]);
    };
    const film = compiledWith(still);
    const runtime = mounted(still);
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    controller.play();
    const beat = film.beats[1]!;
    for (const target of [beat.start + 1, beat.start + beat.seconds / 2, film.beats[2]!.start + 1]) {
      controller.seek(target);
      expect(controller.time).toBeCloseTo(target, 9);
    }
    // Mid-beat the reveal prefix is non-empty and the caption carries it.
    controller.seek(beat.start + beat.seconds / 2);
    expect(writeShownAt(beat, controller.time).length).toBeGreaterThan(0);
    expect(model.state.caption?.write?.shown).toBe(writeShownAt(beat, controller.time));
    expect(model.state.caption?.split).toBe(true);
    controller.destroy();
  });

  it('lands the same layer state by seek as by play', () => {
    const film = compiledWith(layerScene());
    const target = film.beats[1]!.start + 1;

    const played = mounted(layerScene());
    const playController = new FilmController({ runtime: played, film });
    playController.play();
    driveTo(playController, target);
    playController.pause();

    const sought = mounted(layerScene());
    const seekController = new FilmController({ runtime: sought, film });
    seekController.play();
    seekController.seek(target);
    seekController.pause();

    expect(sought.time).toBeCloseTo(played.time, 9);
    expect(seekController.currentBeat?.id).toBe(playController.currentBeat?.id);
    const at = (controller: FilmController): { shown: string; notes: readonly string[] } => {
      const beat = controller.currentBeat!;
      const sceneBeats = film.scenes.find((scene) => scene.id === beat.sceneId)!.beats;
      return { shown: writeShownAt(beat, controller.time), notes: accumulatedNotes(sceneBeats, beat.index) };
    };
    expect(at(seekController)).toEqual(at(playController));
    expect(seekController.currentCues?.write).toEqual(playController.currentCues?.write);
    expect(seekController.currentCues?.notes).toEqual(playController.currentCues?.notes);
    expect(seekController.currentCues?.card).toEqual(playController.currentCues?.card);
    playController.destroy();
    seekController.destroy();
  });

  it('reads the same caption layers from the player model after a seek', () => {
    const film = compiledWith(layerScene());
    const runtime = mounted(layerScene());
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    controller.seek(film.beats[0]!.start);
    expect(model.state.caption?.card).toEqual({ kind: 'section', text: 'The ball' });
    expect(model.state.caption?.write).toBe(null);
    expect(model.state.caption?.notes).toEqual([]);
    // Notes arrive on beat 2, but the scene splits from its first frame.
    expect(model.state.caption?.split).toBe(true);
    const target = film.beats[1]!.start + 1;
    controller.seek(target);
    const caption = model.state.caption!;
    expect(caption.write?.text).toBe('x = 3');
    expect(caption.write?.shown).toBe(writeShownAt(film.beats[1]!, target));
    expect(caption.notes).toEqual(['The ball rests on the left.']);
    expect(caption.card).toBe(null);
    expect(caption.split).toBe(true);
    controller.destroy();
  });
});

describe('film layers: split decision', () => {
  it('splits a scene from its first frame when any later beat introduces notes', () => {
    const film = compiledWith(layerScene());
    expect(film.scenes).toHaveLength(1);
    expect(film.scenes[0]!.split).toBe(true);
    // The decision is scene-level: identical on every beat, so seeks never re-lay the stage.
    for (const beat of film.beats) {
      expect(film.scenes.find((scene) => scene.id === beat.sceneId)!.split).toBe(true);
    }
  });

  it('leaves scenes without notes on the full stage', () => {
    const runtime = new SceneRuntime({});
    runtime.mount((inc) => {
      const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Plain', description: 'No layers.' });
      stage.part('Ball', stage.circle(150, 200, 25, { tone: 'hi' }), { label: 'Ball', info: 'A ball.' });
      inc.steps([{ say: 'Nothing layered happens here at all.' }]);
    });
    const steps = runtime.beats();
    if (!steps) throw new Error('The plain scene has no steps');
    const result = compileFilm(
      { film: { id: 'plain', title: 'Plain', version: 1, lengthTarget: 30 }, scenes: [{ id: 's1', beats: [{ id: 'b1', say: steps[0]!.say }] }] },
      [{ id: 's1', js: '', steps: [...steps] }],
    );
    if (!result.ok || !result.film) throw new Error('The plain film did not compile');
    expect(result.film.scenes[0]!.split).toBe(false);
    expect(splitLayout(result.film.scenes[0]!.split, 960)).toBe('full');
    expect(layoutStageWidth(960, 'full')).toBe(960);
  });

  it('carries the same split into the export plan', () => {
    const film = compiledWith(layerScene());
    const planned = planExportFilm(film, flattenFilm(film), [{ id: 's1', scene: layerScene() }], { fps: 30 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.chunks).toHaveLength(1);
    expect(planned.plan.chunks[0]!.film.scenes[0]!.split).toBe(film.scenes[0]!.split);
  });
});

describe('film layers: export', () => {
  it('draws the right layer text on the right frames', () => {
    const film = compiledWith(layerScene());
    const planned = planExportFilm(film, flattenFilm(film), [{ id: 's1', scene: layerScene() }], { fps: 30 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const chunk = planned.plan.chunks[0]!;
    const frames = [...renderExportChunk(chunk, { id: 's1', scene: layerScene() }, new ExportCancellation())];
    expect(frames.length).toBe(chunk.frames);
    // The capture sessions paint these per frame; the same helper feeds
    // them all, so asserting it here pins every surface at once.
    const layers = frames.map((frame) => exportFrameLayers(chunk.film, frame));
    // Every frame of a split scene carries the split, from the first frame.
    expect(layers.every((entry) => entry.split)).toBe(true);
    const byBeat = (id: string): ReturnType<typeof exportFrameLayers>[] => layers.filter((_, i) => frames[i]!.beatId === id);
    const first = byBeat('b1');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((entry) => entry.card)).toBe(true);
    expect(first.every((entry) => entry.write === '' && entry.notes.length === 0)).toBe(true);
    // The write-on reveal grows across its beat: nothing, prefixes, and the
    // longest prefix on its last frame (the end instant itself belongs to
    // the next beat; the full line at the exact end is pinned above).
    const second = byBeat('b2');
    expect(second.length).toBeGreaterThan(2);
    expect(second[0]!.write).toBe('');
    const shown = second.map((entry) => entry.write);
    expect(shown.some((text) => text.length > 0 && text.length < 'x = 3'.length)).toBe(true);
    expect(second.every((entry, i, all) => i === 0 || entry.write.length >= all[i - 1]!.write.length)).toBe(true);
    expect(second[second.length - 1]!.write.length).toBe(Math.max(...shown.map((text) => text.length)));
    expect(second.every((entry) => entry.writeMath)).toBe(true);
    expect(second.map((entry) => entry.notes)).toEqual(second.map(() => ['The ball rests on the left.']));
    // Later beats keep earlier notes: the column accumulates beat by beat.
    const third = byBeat('b3');
    expect(third.length).toBeGreaterThan(0);
    expect(third.every((entry) => entry.write === '')).toBe(true);
    expect(third[0]!.notes).toEqual(['The ball rests on the left.', 'Nothing else moves.']);
  });

  it('leaves unlayered beats and scenes empty', () => {
    const film = compiledWith(layerScene());
    // A beat id the film never carried draws nothing, never crashes.
    expect(exportFrameLayers(film, { beatId: 'missing', time: 0 })).toEqual({ split: false, write: '', writeMath: false, notes: [], card: null });
  });
});

describe('film layers: checks', () => {
  it('passes a film using all three layers at every width, light and dark', () => {
    const film = compiledWith(layerScene());
    const report = probeFilm({ film, scenes: [{ id: 's1', scene: layerScene() }] });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('fails a film whose write-on chip misses its top-left slot or places nowhere', () => {
    const film = compiledWith(wallScene());
    const report = probeFilm({ film, scenes: [{ id: 's1', scene: wallScene() }], widths: [640], themes: ['light'] });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'overlap' && f.beat === 'b2' && f.message.includes('write-on'))).toBe(true);
  });

  it('fails a film whose stacked notes strip covers a part', () => {
    const film = compiledWith(wallScene());
    const report = probeFilm({ film, scenes: [{ id: 's1', scene: wallScene() }], widths: [360], themes: ['light'] });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'overlap' && f.beat === 'b2' && f.message.includes('notes'))).toBe(true);
  });

  it('fails a film whose write-on text leaves the top-left slot but lands elsewhere', () => {
    // A part blocking only the top-left corner still places the solver —
    // just never where the player and export draw.
    const scene: SceneFunction = (inc) => {
      const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Corner', description: 'A blocked corner.' });
      const lid = stage.rect(0, 0, 200, 120, { tone: 'mid' });
      stage.part('Lid', lid, { label: 'Lid', info: 'Blocks the top-left corner.' });
      inc.onFrame(({ time }) => {
        lid.at(0, Math.sin(time * 2));
      });
      // Cues ride Beat, as title and marks do; inc.steps takes the wider step type at runtime.
      inc.steps([{ say: 'The corner stays covered while we write.', write: { text: 'x = 3' } } as Beat]);
    };
    const runtime = new SceneRuntime({});
    runtime.mount(scene);
    const steps = runtime.beats();
    if (!steps) throw new Error('The corner scene has no steps');
    const result = compileFilm(
      { film: { id: 'corner', title: 'Corner', version: 1, lengthTarget: 30 }, scenes: [{ id: 's1', beats: [{ id: 'b1', say: steps[0]!.say }] }] },
      [{ id: 's1', js: '', steps: [...steps] }],
    );
    if (!result.ok || !result.film) throw new Error('The corner film did not compile');
    const report = probeFilm({ film: result.film, scenes: [{ id: 's1', scene }], widths: [640], themes: ['light'] });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'overlap' && f.message.includes('top-left slot'))).toBe(true);
  });

  it('fails low-contrast tokens on layered beats too', () => {
    const film = compiledWith(layerScene());
    const report = probeFilm({
      film,
      scenes: [{ id: 's1', scene: layerScene() }],
      widths: [640],
      themes: ['light'],
      tokens: { light: { fg: '#888888', bg: '#ffffff' }, dark: { fg: '#888888', bg: '#ffffff' } },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.check === 'contrast' && f.beat === 'b2')).toBe(true);
  });
});

describe('film layers: sandbox mirror', () => {
  it('sanitizes layered steps and rejects smuggled shapes', () => {
    const honest = {
      steps: [
        { say: 'First we set the scene.', card: { kind: 'section', text: 'The ball' } },
        { say: 'The ball sits still.', write: { text: 'x = 3', math: true }, notes: ['The ball rests.'] },
      ],
      params: [],
      parts: ['Ball'],
      hidden: [],
      stage: null,
    };
    const sanitized = sanitizeProbedSnapshot(honest);
    expect(sanitized?.steps[0]?.card).toEqual({ kind: 'section', text: 'The ball' });
    expect(sanitized?.steps[1]?.write).toEqual({ text: 'x = 3', math: true });
    expect(sanitized?.steps[1]?.notes).toEqual(['The ball rests.']);
    const mutate = (fn: (copy: { steps: Array<Record<string, unknown>> }) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(honest)) as { steps: Array<Record<string, unknown>> };
      fn(copy);
      return copy;
    };
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.write = { text: '' })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.write = { text: 'x'.repeat(201) })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.write = { text: 'x', math: 'yes' })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.notes = ['a', 'b', 'c', 'd', 'e'])))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.notes = ['x'.repeat(141)])))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.notes = [])))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[1]!.card = { kind: 'title', text: 'Hi' })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps[0]!.card = { kind: 'section', text: '' })))).toBeNull();
  });

  it('mirrors layers in the absolute cue state, revealed by film time', () => {
    const film = compiledWith(layerScene());
    const authored = new Set<string>();
    const at = (index: number, time?: number): NonNullable<ReturnType<typeof beatCueState>> => beatCueState(film, 's1', index, authored, time)!;
    expect(at(0).card).toEqual({ kind: 'section', text: 'The ball' });
    expect(at(0).write).toBe(null);
    expect(at(0).notes).toEqual([]);
    expect(at(1).card).toBe(null);
    expect(at(1).notes).toEqual(['The ball rests on the left.']);
    expect(at(2).notes).toEqual(['The ball rests on the left.', 'Nothing else moves.']);
    const beat = film.beats[1]!;
    expect(at(1).write?.shown).toBe('');
    expect(at(1, beat.start + beat.seconds)?.write?.shown).toBe('x = 3');
    expect(at(1, beat.start + beat.seconds)?.write).toMatchObject({ text: 'x = 3', math: true });
    expect(beatCueState(film, 'nope', 0, authored)).toBeNull();
  });

  it('plays the layered absolute state into a handle like any other', () => {
    const film = compiledWith(layerScene());
    const calls: Array<{ method: string; args: readonly unknown[] }> = [];
    const handle = {
      restore: (state: unknown) => calls.push({ method: 'restore', args: [state] }),
      setPartVisible: (name: string, visible: boolean) => calls.push({ method: 'setPartVisible', args: [name, visible] }),
      focusPart: (name: string | null) => calls.push({ method: 'focusPart', args: [name] }),
      framePart: (part: string | null, zoom?: number) => calls.push({ method: 'framePart', args: [part, zoom] }),
    } as unknown as FigureHandle;
    const state = beatCueState(film, 's1', 1, new Set<string>())!;
    applyCueState(handle, state);
    expect(calls).toContainEqual({ method: 'restore', args: [{ step: 1 }] });
    expect(calls).toContainEqual({ method: 'focusPart', args: ['Ball'] });
    expect(state.write).toMatchObject({ text: 'x = 3', math: true });
    expect(state.notes).toEqual(['The ball rests on the left.']);
    // The mirror reads the same compiled split as the player, checks and export.
    expect(state.split).toBe(true);
    expect(beatCueState(film, 's1', 0, new Set<string>())!.split).toBe(true);
  });
});

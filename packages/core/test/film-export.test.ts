import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import {
  assembleExportAudio,
  compileFilm,
  ExportCancellation,
  ExportCancelledError,
  ExportError,
  exportAvSyncBound,
  exportFrameSize,
  exportStepsPerFrame,
  exportSyncReport,
  exportTimelineFallback,
  exportTimelineMp4,
  exportVideoFilename,
  flattenFilm,
  FilmController,
  hashPixels,
  listTopLevelBoxes,
  meanPixelDifference,
  muxMp4,
  planExportFilm,
  probeExportCodecs,
  renderExportChunk,
  resampleMono16,
  resumeFallbackPlayback,
  sanitizeExportFilenameSegment,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  EXPORT_FILENAME_MAX_CHARS,
  EXPORT_FILENAME_SEGMENT_CHARS,
  EXPORT_FPS_DEFAULT,
  EXPORT_MAX_AUDIO_SECONDS,
  EXPORT_MAX_SAMPLE_RATE,
  EXPORT_MIN_SAMPLE_RATE,
  EXPORT_SAMPLE_RATE,
  EXPORT_SEED,
  type CompiledFilm,
  type ExportFrame,
  type ExportPlan,
  type ExportSceneInput,
  type FilmSceneSource,
  type InsertClip,
  type MixerClip,
  type SceneFunction,
} from '../src/index';
import { trustFixture } from './helpers/film';

function toInputs(scenes: ReadonlyArray<{ id: string; scene: SceneFunction; kits?: ExportSceneInput['kits'] }>): ExportSceneInput[] {
  return scenes.map((scene) => ({ id: scene.id, scene: scene.scene, ...(scene.kits ? { kits: scene.kits } : {}) }));
}

function frameDigest(frame: ExportFrame): string {
  return JSON.stringify({ time: frame.time, beat: frame.beatId, caption: frame.caption, commands: frame.update.commands, reset: frame.update.reset === true });
}

function partSnapshot(runtime: SceneRuntime): string {
  return JSON.stringify(
    [...runtime.parts.parts.values()]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((p) => [p.name, p.node.kind, [...p.node.attrs].sort(), p.node.text, p.node.hidden]),
  );
}

/** A mono 16-bit sine clip, like the stub narrator's bytes but local. */
function synthClip(beatId: string, seconds: number, sampleRate = 8000, hz = 440): MixerClip {
  const count = Math.max(1, Math.round(seconds * sampleRate));
  const pcm = new Uint8Array(count * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(20000 * Math.sin((2 * Math.PI * hz * i) / sampleRate)), true);
  return { beatId, hash: `stub-${beatId}`, pcm, sampleRate, seconds: count / sampleRate };
}

/** An impulse clip: silence except frame one, so the onset sample is exact. */
function impulseClip(beatId: string, seconds: number, sampleRate = 8000): MixerClip {
  const count = Math.max(2, Math.round(seconds * sampleRate));
  const pcm = new Uint8Array(count * 2);
  new DataView(pcm.buffer).setInt16(0, 20000, true);
  return { beatId, hash: `impulse-${beatId}`, pcm, sampleRate, seconds: count / sampleRate };
}

function insertClip(film: CompiledFilm): InsertClip {
  return {
    id: 'insert-1',
    anchor: { film: film.id, version: film.version, scene: 's1', beat: 's1b3', wordIndex: 2, controlValues: {}, readouts: [] },
    lines: [
      { say: 'Here is the step again, slowly.', seconds: 3 },
      { say: 'Watch the bob pass the bottom.', seconds: 2.5 },
    ],
    seconds: 5.5,
  };
}

/** The hostile timeline: 64 inserts of 4 lines at 30 s, the storage caps multiplied out. */
function hostileInserts(film: CompiledFilm): InsertClip[] {
  const anchorBeat = film.beats[0]!;
  return Array.from({ length: 64 }, (_, i) => ({
    id: `evil-${i}`,
    anchor: { film: film.id, version: film.version, scene: anchorBeat.sceneId, beat: anchorBeat.id, wordIndex: 0, controlValues: {}, readouts: [] },
    lines: [
      { say: 'Evil line one.', seconds: 30 },
      { say: 'Evil line two.', seconds: 30 },
      { say: 'Evil line three.', seconds: 30 },
      { say: 'Evil line four.', seconds: 30 },
    ],
    seconds: 120,
  }));
}

const tinyScene = (says: readonly string[]): SceneFunction => {
  const scene = (inc: Inc): void => {
    inc.idea('A tiny export scene.');
    const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Tiny' });
    const dot = stage.circle(10, 10, 2, {});
    stage.part('Dot', dot, { label: 'Dot', info: 'A dot.' });
    inc.steps(says.map((say) => ({ say })));
  };
  return scene as SceneFunction;
};

async function twoSceneFilm(): Promise<{ film: CompiledFilm; inputs: ExportSceneInput[] }> {
  const defs = [
    { id: 'a', says: ['Alpha one two three', 'Alpha four five six'] },
    { id: 'b', says: ['Beta one two three'] },
  ];
  const sources: FilmSceneSource[] = [];
  const inputs: ExportSceneInput[] = [];
  for (const def of defs) {
    const scene = tinyScene(def.says);
    const runtime = new SceneRuntime({});
    runtime.mount(scene);
    const steps = runtime.beats();
    runtime.destroy();
    if (!steps) throw new Error('tiny scene has no steps');
    sources.push({ id: def.id, js: '', steps });
    inputs.push({ id: def.id, scene });
  }
  const result = compileFilm(
    {
      film: { id: 'tiny', title: 'Tiny', version: 1 },
      scenes: [
        { id: 'a', beats: [{ id: 'a1', say: 'Alpha one two three' }, { id: 'a2', say: 'Alpha four five six' }] },
        { id: 'b', beats: [{ id: 'b1', say: 'Beta one two three' }] },
      ],
    },
    sources,
  );
  if (!result.ok || !result.film) throw new Error(`tiny film failed: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, inputs };
}

describe('film export: the plan', () => {
  it('plans one chunk for the single-scene fixture', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.chunks.length).toBe(1);
    expect(planned.plan.fps).toBe(EXPORT_FPS_DEFAULT);
    expect(planned.plan.chunks[0]!.frames).toBe(Math.ceil(film.seconds * EXPORT_FPS_DEFAULT - 1e-9));
    expect(planned.plan.chunks[0]!.start).toBe(0);
    expect(planned.plan.seconds).toBeCloseTo(planned.plan.frames / EXPORT_FPS_DEFAULT, 12);
  });

  it('splices insert lines into their scene, replaying the anchor step', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const clip = insertClip(film);
    const planned = planExportFilm(film, flattenFilm(film, [clip]), toInputs(scenes), {});
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const chunk = planned.plan.chunks[0]!;
    const anchor = film.beats.find((beat) => beat.id === 's1b3')!;
    const spliced = chunk.film.beats.filter((beat) => beat.id.startsWith('insert-1'));
    expect(spliced.length).toBe(2);
    for (const beat of spliced) expect(beat.index).toBe(anchor.index);
    expect(spliced[0]!.step.say).toBe('Here is the step again, slowly.');
    // Contiguous: every beat starts where the last ends.
    chunk.film.beats.forEach((beat, i) => {
      if (i === 0) expect(beat.start).toBe(0);
      else expect(beat.start).toBeCloseTo(chunk.film.beats[i - 1]!.start + chunk.film.beats[i - 1]!.seconds, 12);
    });
  });

  it('chunks per scene with cumulative starts', async () => {
    const { film, inputs } = await twoSceneFilm();
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.chunks.map((chunk) => chunk.sceneId)).toEqual(['a', 'b']);
    expect(planned.plan.chunks[1]!.start).toBeCloseTo(planned.plan.chunks[0]!.seconds, 12);
    expect(planned.plan.frames).toBe(planned.plan.chunks[0]!.frames + planned.plan.chunks[1]!.frames);
  });

  it('rejects off-lattice rates, missing scenes and foreign timelines', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    expect(planExportFilm(film, flattenFilm(film), toInputs(scenes), { fps: 24 }).ok).toBe(false);
    expect(planExportFilm(film, flattenFilm(film), [], {}).ok).toBe(false);
    const { film: other } = await trustFixture(SIXTY_SECOND_FILM);
    expect(planExportFilm(other, flattenFilm(film), toInputs(scenes), {}).ok).toBe(false);
    expect(exportStepsPerFrame(24)).toBeNull();
    expect(exportStepsPerFrame(30)).toBe(2);
    expect(exportStepsPerFrame(60)).toBe(1);
  });
});

describe('film export: the fixed-clock renderer', () => {
  it('steps every frame on the film lattice', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const chunk = planned.plan.chunks[0]!;
    const frames = [...renderExportChunk(chunk, toInputs(scenes)[0]!, new ExportCancellation())];
    expect(frames.length).toBe(chunk.frames);
    frames.forEach((frame, i) => {
      expect(frame.frame).toBe(i);
      expect(frame.time * 60).toBeCloseTo(i * 2, 9);
    });
    expect(frames[0]!.update.commands.some((command) => command.op === 'stage')).toBe(true);
    expect(frames[0]!.beatId).toBe('s1b1');
    // Every beat appears, in order, playing through the explore pause point.
    const seen = frames.map((frame) => frame.beatId).filter((id, i, all) => i === 0 || id !== all[i - 1]);
    expect(seen).toEqual(['s1b1', 's1b2', 's1b3', 's1b4', 's1b5', 's1b6']);
  });

  it('renders the same frames on every run: no wall clock on the path', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const chunk = planned.plan.chunks[0]!;
    const input = toInputs(scenes)[0]!;
    const first = [...renderExportChunk(chunk, input, new ExportCancellation())].map(frameDigest).join('\n');
    const second = [...renderExportChunk(chunk, input, new ExportCancellation())].map(frameDigest).join('\n');
    expect(second).toBe(first);
  });

  it('plays through holds and questions to the last frame', async () => {
    const { film, scenes } = await trustFixture(SIXTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const chunk = planned.plan.chunks[0]!;
    const frames = [...renderExportChunk(chunk, toInputs(scenes)[0]!, new ExportCancellation())];
    expect(frames.length).toBe(chunk.frames);
    const seen = frames.map((frame) => frame.beatId).filter((id, i, all) => i === 0 || id !== all[i - 1]);
    expect(seen).toEqual(film.beats.map((beat) => beat.id));
    expect(frames[frames.length - 1]!.beatId).toBe('s1b8');
  });
});

describe('film export: frame identity with live playback', () => {
  it('matches a live controller frame for frame: same times, beats, captions and commands', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const chunk = planned.plan.chunks[0]!;
    const exported = [...renderExportChunk(chunk, inputs[0]!, new ExportCancellation())];

    // The live path: the same film on its own runtime, ticked at the export
    // rate, resumed through pause points as a learner would resume.
    const runtime = new SceneRuntime({ ...(inputs[0]!.kits ? { kits: inputs[0]!.kits } : {}), film: true, seed: EXPORT_SEED });
    const live: string[] = [];
    try {
      const mounted = runtime.mount(inputs[0]!.scene);
      const controller = new FilmController({ runtime, film, now: () => 0 });
      const digest = (commands: unknown): string => {
        const beat = controller.currentBeat;
        return JSON.stringify({ time: runtime.time, beat: beat?.id ?? '', caption: beat?.step.say ?? '', commands });
      };
      controller.play();
      if (!controller.isPlaying) controller.play();
      const initial = runtime.redraw();
      live.push(digest([...mounted.commands, ...initial.commands]));
      for (let i = 1; i < chunk.frames; i++) {
        const update = controller.tick(1 / EXPORT_FPS_DEFAULT);
        if (!controller.isPlaying && controller.time + 1e-9 < film.seconds) controller.play();
        live.push(digest(update.commands));
      }
      controller.destroy();
    } finally {
      runtime.destroy();
    }
    expect(live.length).toBe(exported.length);
    // Identical renderer input is identical pixels: the same commands into the same renderer draw the same frame.
    live.forEach((digest, i) => expect(digest).toBe(JSON.stringify({ time: exported[i]!.time, beat: exported[i]!.beatId, caption: exported[i]!.caption, commands: exported[i]!.update.commands })));
  });

  it('matches seek-by-replay state at sampled lattice times', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const chunk = planned.plan.chunks[0]!;
    const states = new Map<number, string>();
    for (const frame of renderExportChunk(chunk, inputs[0]!, new ExportCancellation(), { inspect: (runtime, at) => void states.set(at.frame, partSnapshot(runtime)) })) {
      void frame;
    }
    const runtime = new SceneRuntime({ ...(inputs[0]!.kits ? { kits: inputs[0]!.kits } : {}), film: true, seed: EXPORT_SEED });
    try {
      runtime.mount(inputs[0]!.scene);
      const controller = new FilmController({ runtime, film, now: () => 0 });
      for (const at of [0, Math.floor(chunk.frames / 2), chunk.frames - 1]) {
        controller.seek(at / EXPORT_FPS_DEFAULT);
        // The seek lands the beat's cues; the export frame holds the same state.
        expect(partSnapshot(runtime)).toBe(states.get(at));
      }
      controller.destroy();
    } finally {
      runtime.destroy();
    }
  });
});

describe('film export: the audio track', () => {
  it('places each clip at its beat offset, sample-exact', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const plan = planned.plan;
    const clips = film.beats.map((beat) => impulseClip(beat.id, 1));
    const track = assembleExportAudio(plan, clips, 8000);
    expect(track.clipsPlaced).toBe(film.beats.length);
    expect(track.seconds).toBeCloseTo(plan.seconds, 6);
    for (const beat of plan.chunks[0]!.film.beats) {
      const at = Math.round((plan.chunks[0]!.start + beat.start) * 8000);
      expect(track.pcm[at]).toBe(20000);
      expect(track.pcm[at - 1] ?? 0).toBe(0);
    }
  });

  it('cuts clips at the beat end and resolves doubles last-wins', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const plan = planned.plan;
    const beat = plan.chunks[0]!.film.beats[0]!;
    const long = synthClip(beat.id, beat.seconds + 5, 8000);
    const track = assembleExportAudio(plan, [long], 8000);
    const end = Math.round((plan.chunks[0]!.start + beat.start + beat.seconds) * 8000);
    expect(track.pcm[end]).toBe(0);
    expect(track.pcm[end + 100]).toBe(0);
    const quiet = impulseClip(beat.id, 1);
    const loud = synthClip(beat.id, 1);
    const doubled = assembleExportAudio(plan, [quiet, loud], 8000);
    const at = Math.round((plan.chunks[0]!.start + beat.start) * 8000);
    // The mixer keeps the last attach; the export assembles it.
    expect(doubled.pcm[at]).toBe(0);
    expect(doubled.pcm[at + 1]).not.toBe(0);
  });

  it('leaves insert lines silent and resamples narration to the export rate', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const clip = insertClip(film);
    const planned = planExportFilm(film, flattenFilm(film, [clip]), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const plan = planned.plan;
    const clips = film.beats.map((beat) => synthClip(beat.id, beat.seconds));
    const track = assembleExportAudio(plan, clips, EXPORT_SAMPLE_RATE);
    expect(track.sampleRate).toBe(EXPORT_SAMPLE_RATE);
    const spliced = plan.chunks[0]!.film.beats.filter((beat) => beat.id.startsWith('insert-1'));
    expect(spliced.length).toBe(2);
    const at = Math.round((plan.chunks[0]!.start + spliced[0]!.start + 0.5) * EXPORT_SAMPLE_RATE);
    expect(track.pcm[at]).toBe(0);
  });

  it('resampling copies matching rates bit-exact and preserves constants', () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const copied = resampleMono16(samples, 8000, 8000);
    expect(copied).toEqual(samples);
    expect(copied).not.toBe(samples);
    const flat = new Int16Array(800).fill(5000);
    const up = resampleMono16(flat, 8000, EXPORT_SAMPLE_RATE);
    expect(up.length).toBe(Math.round((800 * EXPORT_SAMPLE_RATE) / 8000));
    for (const value of up) expect(value).toBe(5000);
    expect(() => resampleMono16(samples, 0, 8000)).toThrow();
  });

  it('refuses timelines past the audio cap before allocating', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film, hostileInserts(film)), toInputs(scenes), {});
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.seconds).toBeGreaterThan(EXPORT_MAX_AUDIO_SECONDS);
    expect(() => assembleExportAudio(planned.plan, [], 8000)).toThrow(ExportError);
    expect(() => assembleExportAudio(planned.plan, [], 8000)).toThrow(/at most/);
  });

  it('refuses sample rates outside the patch-gate range before allocating', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    for (const rate of [0, -44100, 999, 96001, 2 ** 31 - 1, 44100.5, Number.NaN]) {
      expect(() => assembleExportAudio(planned.plan, [], rate)).toThrow(ExportError);
      expect(() => assembleExportAudio(planned.plan, [], rate)).toThrow(/1000 to 96000/);
    }
  });

  it('accepts the boundary sample rates', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const plan = planned.plan;
    const clips = film.beats.map((beat) => synthClip(beat.id, beat.seconds));
    const low = assembleExportAudio(plan, clips, EXPORT_MIN_SAMPLE_RATE);
    expect(low.sampleRate).toBe(1000);
    expect(low.clipsPlaced).toBe(film.beats.length);
    const high = assembleExportAudio(plan, clips, EXPORT_MAX_SAMPLE_RATE);
    expect(high.sampleRate).toBe(96000);
    expect(high.clipsPlaced).toBe(film.beats.length);
  });

  it('a cancelled assembly throws without returning a track', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const clips = film.beats.map((beat) => synthClip(beat.id, 1));
    const cancel = new ExportCancellation();
    cancel.cancel();
    expect(() => assembleExportAudio(planned.plan, clips, 8000, cancel)).toThrow(ExportCancelledError);
    expect(() => resampleMono16(new Int16Array([1, 2, 3]), 8000, EXPORT_SAMPLE_RATE, cancel)).toThrow(ExportCancelledError);
  });
});

describe('film export: A/V sync', () => {
  it('starts every clip within one video frame of its first frame', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const clips = film.beats.map((beat) => synthClip(beat.id, 1));
    const report = exportSyncReport(planned.plan, clips);
    expect(exportAvSyncBound(EXPORT_FPS_DEFAULT)).toBeCloseTo(1 / 30, 12);
    expect(report.bound).toBeCloseTo(1 / 30, 12);
    expect(report.lines.length).toBe(film.beats.length);
    expect(report.ok).toBe(true);
    expect(report.maxError).toBeLessThanOrEqual(report.bound);
    for (const line of report.lines) {
      expect(line.errorSeconds).toBeGreaterThanOrEqual(0);
      expect(line.videoStart).toBeLessThanOrEqual(line.clipStart);
    }
  });

  it('holds the bound with inserts spliced in', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const planned = planExportFilm(film, flattenFilm(film, [insertClip(film)]), toInputs(scenes), {});
    if (!planned.ok) throw new Error('no plan');
    const clips = film.beats.map((beat) => synthClip(beat.id, 1));
    const report = exportSyncReport(planned.plan, clips);
    expect(report.ok).toBe(true);
  });
});

describe('film export: the muxer', () => {
  const avcDescription = new Uint8Array([1, 100, 0, 28, 255, 225, 0, 5, 103, 100, 0, 28, 234, 1, 0, 4, 104, 235, 236, 178]);
  const asc = new Uint8Array([0x12, 0x10]);

  const videoTrack = (samples: number, keyframes: readonly number[] = [0]) => ({
    codec: 'avc' as const,
    width: 640,
    height: 480,
    fps: 30,
    description: avcDescription,
    samples: Array.from({ length: samples }, (_, i) => ({ data: new Uint8Array([i + 1, 2, 3, 4]), keyframe: keyframes.includes(i) })),
  });

  const audioTrack = (samples: number) => ({ sampleRate: 44100, channels: 1 as const, description: asc, samples: Array.from({ length: samples }, (_, i) => new Uint8Array([9, i])) });

  /** Walks a box's children, returning their types and ranges. */
  function children(bytes: Uint8Array, start: number, size: number): Array<{ type: string; start: number; size: number }> {
    const out: Array<{ type: string; start: number; size: number }> = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = start + 8;
    while (at + 8 <= start + size) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
      if (length < 8 || at + length > start + size) break;
      out.push({ type, start: at, size: length });
      at += length;
    }
    return out;
  }

  /** Boxes with payload instead of children. */
  const LEAF = new Set(['mvhd', 'tkhd', 'mdhd', 'hdlr', 'vmhd', 'smhd', 'dref', 'url ', 'stts', 'stsc', 'stsz', 'stco', 'stss', 'esds', 'avcC', 'vpcC']);

  function find(bytes: Uint8Array, path: readonly string[]): { type: string; start: number; size: number } | null {
    let level = listTopLevelBoxes(bytes);
    let found: { type: string; start: number; size: number } | null = null;
    for (const type of path) {
      found = level.find((box) => box.type === type) ?? null;
      if (!found) return null;
      if (type === 'stsd') {
        // The sample entry follows the full header and the entry count.
        const at = found.start + 16;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const length = view.getUint32(at);
        const entry = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
        level = [{ type: entry, start: at, size: length }];
      } else {
        level = LEAF.has(type) ? [] : children(bytes, found.start, found.size);
      }
    }
    return found;
  }

  it('writes ftyp, mdat and moov with the samples where stco says', () => {
    const bytes = muxMp4(videoTrack(5, [0, 2]), audioTrack(3));
    const top = listTopLevelBoxes(bytes);
    expect(top.map((box) => box.type)).toEqual(['ftyp', 'mdat', 'moov']);
    expect(top[0]!.start).toBe(0);
    expect(top[2]!.start + top[2]!.size).toBe(bytes.length);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The video chunk opens mdat's payload; the audio chunk follows the video samples.
    const mdat = top[1]!;
    expect(view.getUint32(mdat.start)).toBe(mdat.size);
    expect(bytes[mdat.start + 8]).toBe(1);
    const videoBytes = 5 * 4;
    expect(bytes[mdat.start + 8 + videoBytes]).toBe(9);
    // Both sample tables point into mdat.
    const moov = find(bytes, ['moov'])!;
    expect(moov).not.toBeNull();
    const trakCount = children(bytes, moov.start, moov.size).filter((box) => box.type === 'trak').length;
    expect(trakCount).toBe(2);
  });

  it('times tracks from their samples: 90000 Hz video, native-rate audio', () => {
    const bytes = muxMp4(videoTrack(5, [0, 2]), audioTrack(3));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sttsOf = (trakIndex: number): Array<readonly [number, number]> => {
      const moov = find(bytes, ['moov'])!;
      const traks = children(bytes, moov.start, moov.size).filter((box) => box.type === 'trak');
      const mdia = children(bytes, traks[trakIndex]!.start, traks[trakIndex]!.size).find((box) => box.type === 'mdia')!;
      const minf = children(bytes, mdia.start, mdia.size).find((box) => box.type === 'minf')!;
      const stbl = children(bytes, minf.start, minf.size).find((box) => box.type === 'stbl')!;
      const stts = children(bytes, stbl.start, stbl.size).find((box) => box.type === 'stts')!;
      const entries = view.getUint32(stts.start + 12);
      const out: Array<readonly [number, number]> = [];
      for (let i = 0; i < entries; i++) out.push([view.getUint32(stts.start + 16 + i * 8), view.getUint32(stts.start + 20 + i * 8)]);
      return out;
    };
    expect(sttsOf(0)).toEqual([[5, 3000]]);
    expect(sttsOf(1)).toEqual([[3, 1024]]);
    // The sync table names the keyframes, one-based.
    const stss = find(bytes, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stss'])!;
    expect(stss).not.toBeNull();
    expect(view.getUint32(stss.start + 12)).toBe(2);
    expect([view.getUint32(stss.start + 16), view.getUint32(stss.start + 20)]).toEqual([1, 3]);
    // The entries name their codecs.
    expect(find(bytes, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1'])).not.toBeNull();
  });

  it('muxes VP9 with a generic vpcC and muxes video-only', () => {
    const vp9 = muxMp4({ ...videoTrack(2), codec: 'vp09', description: new Uint8Array(0) });
    expect(find(vp9, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'vp09'])).not.toBeNull();
    const silent = muxMp4(videoTrack(2));
    const moov = find(silent, ['moov'])!;
    expect(children(silent, moov.start, moov.size).filter((box) => box.type === 'trak').length).toBe(1);
  });

  it('muxes deterministically and refuses broken tracks', () => {
    const first = muxMp4(videoTrack(5, [0, 2]), audioTrack(3));
    const second = muxMp4(videoTrack(5, [0, 2]), audioTrack(3));
    expect(second).toEqual(first);
    expect(() => muxMp4({ ...videoTrack(2), width: 641 })).toThrow();
    expect(() => muxMp4({ ...videoTrack(2), samples: [] })).toThrow();
    expect(() => muxMp4(videoTrack(2, [1]))).toThrow();
    expect(() => muxMp4({ ...videoTrack(2), description: new Uint8Array(0) })).toThrow();
    expect(() => muxMp4(videoTrack(2), { ...audioTrack(1), samples: [] })).toThrow();
  });
});

describe('film export: frame size and pixels', () => {
  it('frames the drawing at the stage aspect with an evened caption band', () => {
    const size = exportFrameSize(600, 400, 720);
    expect(size).toEqual({ width: 1080, height: 720, band: 130, frameWidth: 1080, frameHeight: 850 });
    const odd = exportFrameSize(601, 400, 481);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(odd.band % 2).toBe(0);
    expect(() => exportFrameSize(0, 400, 720)).toThrow();
    expect(() => exportFrameSize(600, 400, 60)).toThrow();
  });

  it('hashes pixels stably and diffs them exactly', () => {
    const a = { width: 2, height: 1, data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]) };
    const b = { width: 2, height: 1, data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]) };
    const c = { width: 2, height: 1, data: new Uint8Array([11, 20, 30, 255, 40, 50, 60, 255]) };
    expect(hashPixels(a)).toBe(hashPixels(b));
    expect(hashPixels(a)).not.toBe(hashPixels(c));
    expect(meanPixelDifference(a, b)).toBe(0);
    expect(meanPixelDifference(a, c)).toBeCloseTo(1 / 6, 12);
    expect(meanPixelDifference(a, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) })).toBeNaN();
  });
});

describe('film export: the offline run', () => {
  interface FakeRig {
    readonly drivers: {
      openCapture(chunk: ExportPlan['chunks'][number]): Promise<{ capture(frame: ExportFrame, first: boolean): Promise<unknown>; destroy(): void }>;
      openVideo(width: number, height: number, fps: number): Promise<{
        encode(image: unknown, timestampUs: number, keyFrame: boolean): Promise<void>;
        finish(): Promise<{ codec: 'avc'; description: Uint8Array; samples: ReadonlyArray<{ data: Uint8Array; keyframe: boolean }> }>;
        close(): void;
      }>;
      openAudio(): Promise<{
        encode(track: Int16Array, sampleRate: number): Promise<void>;
        finish(): Promise<{ description: Uint8Array; samples: readonly Uint8Array[] } | null>;
        close(): void;
      } | null>;
    };
    readonly captured: ExportFrame[];
    readonly stamps: number[];
    readonly keys: boolean[];
    readonly audioTracks: Int16Array[];
    videoClosed: boolean;
    audioClosed: boolean;
    sessions: number;
    destroyed: number;
    audio: 'aac' | 'none';
  }

  function fakeRig(): FakeRig {
    const rig = {
      captured: [] as ExportFrame[],
      stamps: [] as number[],
      keys: [] as boolean[],
      audioTracks: [] as Int16Array[],
      videoClosed: false,
      audioClosed: false,
      sessions: 0,
      destroyed: 0,
      audio: 'aac' as 'aac' | 'none',
    } as FakeRig;
    const drivers = {
      openCapture: async () => {
        rig.sessions++;
        return {
          capture: async (frame: ExportFrame) => {
            rig.captured.push(frame);
            return frame.frame;
          },
          destroy: () => void rig.destroyed++,
        };
      },
      openVideo: async () => ({
        encode: async (_image: unknown, timestampUs: number, keyFrame: boolean) => {
          rig.stamps.push(timestampUs);
          rig.keys.push(keyFrame);
        },
        finish: async () => ({
          codec: 'avc' as const,
          description: new Uint8Array([1, 2, 3, 4]),
          samples: rig.stamps.map((_, i) => ({ data: new Uint8Array([i & 0xff, 7]), keyframe: rig.keys[i]! })),
        }),
        close: () => void (rig.videoClosed = true),
      }),
      openAudio: async () =>
        rig.audio === 'none'
          ? null
          : {
              encode: async (track: Int16Array) => void rig.audioTracks.push(track),
              finish: async () => ({ description: new Uint8Array([0x12, 0x10]), samples: [new Uint8Array([9, 9])] }),
              close: () => void (rig.audioClosed = true),
            },
    };
    return Object.assign(rig, { drivers });
  }

  it('exports every frame in order with monotonic timestamps and keyframes', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const rig = fakeRig();
    const clips = film.beats.map((beat) => synthClip(beat.id, 1));
    const progress: Array<{ phase: string; frame: number; frames: number }> = [];
    const result = await exportTimelineMp4({
      film,
      timeline: flattenFilm(film),
      scenes: inputs,
      clips,
      size: exportFrameSize(600, 400, 480),
      drivers: rig.drivers,
      onProgress: (event) => void progress.push({ phase: event.phase, frame: event.frame, frames: event.frames }),
    });
    expect(result.fallback).toBe(false);
    expect(result.mimeType).toBe('video/mp4');
    expect(result.frames).toBe(planned.plan.frames);
    expect(result.hasAudio).toBe(true);
    expect(rig.captured.length).toBe(planned.plan.frames);
    // Frame 0 carries full state (the stage asserts it), so capture applies it with reset.
    expect(rig.captured[0]!.update.commands.some((command) => command.op === 'stage')).toBe(true);
    expect(rig.stamps.length).toBe(planned.plan.frames);
    rig.stamps.forEach((stamp, i) => {
      expect(stamp).toBe(Math.round((i * 1_000_000) / EXPORT_FPS_DEFAULT));
      expect(rig.keys[i]).toBe(i % 60 === 0);
    });
    expect(rig.sessions).toBe(1);
    expect(rig.destroyed).toBe(1);
    expect(rig.videoClosed).toBe(true);
    expect(rig.audioClosed).toBe(true);
    expect(rig.audioTracks.length).toBe(1);
    expect(progress[progress.length - 1]).toEqual({ phase: 'mux', frame: planned.plan.frames, frames: planned.plan.frames });
    expect(listTopLevelBoxes(result.bytes).map((box) => box.type)).toEqual(['ftyp', 'mdat', 'moov']);
  });

  it('ships video-only without clips or without an audio encoder', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const timeline = flattenFilm(film);
    const size = exportFrameSize(600, 400, 480);
    const silent = await exportTimelineMp4({ film, timeline, scenes: inputs, size, drivers: fakeRig().drivers });
    expect(silent.hasAudio).toBe(false);
    const rig = fakeRig();
    rig.audio = 'none';
    const clips = film.beats.map((beat) => synthClip(beat.id, 1));
    const noEncoder = await exportTimelineMp4({ film, timeline, scenes: inputs, clips, size, drivers: rig.drivers });
    expect(noEncoder.hasAudio).toBe(false);
    expect(rig.audioTracks.length).toBe(0);
  });

  it('exports scene by scene, destroying each scene before the next', async () => {
    const { film, inputs } = await twoSceneFilm();
    const rig = fakeRig();
    const order: string[] = [];
    const drivers = {
      ...rig.drivers,
      openCapture: async (chunk: ExportPlan['chunks'][number]) => {
        order.push(`open-${chunk.sceneId}`);
        const session = await rig.drivers.openCapture(chunk);
        return { capture: session.capture, destroy: () => void (order.push(`close-${chunk.sceneId}`), session.destroy()) };
      },
    };
    const result = await exportTimelineMp4({ film, timeline: flattenFilm(film), scenes: inputs, size: exportFrameSize(100, 100, 480), drivers });
    expect(order).toEqual(['open-a', 'close-a', 'open-b', 'close-b']);
    expect(result.frames).toBe(rig.captured.length);
    const firstChunk = rig.captured.filter((frame) => frame.chunk === 0).length;
    expect(firstChunk).toBeGreaterThan(0);
    expect(rig.captured.every((frame, i) => frame.chunk === (i < firstChunk ? 0 : 1))).toBe(true);
  });

  it('cancellation stops stepping, closes the encoders and destroys the scene', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const rig = fakeRig();
    const cancel = new ExportCancellation();
    const promise = exportTimelineMp4({
      film,
      timeline: flattenFilm(film),
      scenes: inputs,
      size: exportFrameSize(600, 400, 480),
      drivers: rig.drivers,
      cancel,
      onProgress: (event) => {
        if (event.frame >= 10) cancel.cancel();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(ExportCancelledError);
    expect(rig.captured.length).toBeLessThanOrEqual(11);
    expect(rig.videoClosed).toBe(true);
    expect(rig.destroyed).toBe(rig.sessions);
    expect(rig.sessions).toBe(1);
  });

  it('refuses the hostile timeline before encoding a frame', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const rig = fakeRig();
    await expect(
      exportTimelineMp4({ film, timeline: flattenFilm(film, hostileInserts(film)), scenes: inputs, size: exportFrameSize(600, 400, 480), drivers: rig.drivers }),
    ).rejects.toThrow(/at most/);
    expect(rig.captured.length).toBe(0);
    expect(rig.sessions).toBe(0);
  });

  it('cancel during the audio encode stops promptly and closes the sinks', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const rig = fakeRig();
    const cancel = new ExportCancellation();
    let chunks = 0;
    const drivers = {
      ...rig.drivers,
      openAudio: async () => ({
        encode: async (_track: Int16Array, _rate: number, token?: ExportCancellation) => {
          for (let i = 0; i < 100; i++) {
            if (i === 2) cancel.cancel();
            token?.throwIfCancelled();
            chunks++;
            await Promise.resolve();
          }
        },
        finish: async () => ({ description: new Uint8Array([0x12, 0x10]), samples: [new Uint8Array([9, 9])] as const }),
        close: () => void (rig.audioClosed = true),
      }),
    };
    const clips = film.beats.map((beat) => synthClip(beat.id, 1));
    await expect(exportTimelineMp4({ film, timeline: flattenFilm(film), scenes: inputs, clips, size: exportFrameSize(600, 400, 480), drivers, cancel })).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
    expect(chunks).toBeLessThan(100);
    expect(rig.audioClosed).toBe(true);
    expect(rig.videoClosed).toBe(true);
  });
});

describe('film export: the realtime fallback', () => {
  it('plays the same timeline back to back, beat for beat', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const byScene = new Map(inputs.map((scene) => [scene.id, scene]));
    const visited: string[] = [];
    const waits: number[] = [];
    let started = 0;
    let stopped = 0;
    const result = await exportTimelineFallback({
      film,
      timeline: flattenFilm(film),
      scenes: inputs,
      fps: 10,
      openSession: async (chunk) => {
        const scene = byScene.get(chunk.sceneId)!;
        const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true, seed: EXPORT_SEED });
        runtime.mount(scene.scene);
        const controller = new FilmController({ runtime, film: chunk.film, now: () => 0 });
        controller.play();
        resumeFallbackPlayback(controller, chunk.film);
        return {
          applyAhead: (seconds) => {
            controller.tick(seconds);
            resumeFallbackPlayback(controller, chunk.film);
            const beat = controller.currentBeat?.id;
            if (beat && visited[visited.length - 1] !== beat) visited.push(beat);
          },
          destroy: () => {
            controller.destroy();
            runtime.destroy();
          },
        };
      },
      recorder: {
        mimeType: 'video/webm',
        start: () => void started++,
        stop: async () => {
          stopped++;
          return new Uint8Array([1, 2, 3]);
        },
      },
      clock: { wait: async (ms) => void waits.push(ms) },
    });
    expect(result.fallback).toBe(true);
    expect(result.label).toBe('fallback · realtime');
    expect(result.mimeType).toBe('video/webm');
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(visited).toEqual(['s1b1', 's1b2', 's1b3', 's1b4', 's1b5', 's1b6']);
    expect(waits.length).toBe(result.frames);
    expect(started).toBe(1);
    expect(stopped).toBe(1);
  });

  it('cancellation stops the recorder and the playback', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const inputs = toInputs(scenes);
    const cancel = new ExportCancellation();
    let sessions = 0;
    let destroyed = 0;
    let stopped = 0;
    const promise = exportTimelineFallback({
      film,
      timeline: flattenFilm(film),
      scenes: inputs,
      fps: 10,
      openSession: async () => {
        sessions++;
        return { applyAhead: () => undefined, destroy: () => void destroyed++ };
      },
      recorder: {
        mimeType: 'video/webm',
        start: () => undefined,
        stop: async () => {
          stopped++;
          return new Uint8Array(0);
        },
      },
      clock: { wait: async () => undefined },
      cancel,
      onProgress: (event) => {
        if (event.frame >= 3) cancel.cancel();
      },
    });
    await expect(promise).rejects.toBeInstanceOf(ExportCancelledError);
    expect(sessions).toBe(1);
    expect(destroyed).toBe(1);
    expect(stopped).toBe(1);
  });

  it('rejects absurd capture rates', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    await expect(
      exportTimelineFallback({
        film,
        timeline: flattenFilm(film),
        scenes: toInputs(scenes),
        fps: 120,
        openSession: async () => ({ applyAhead: () => undefined, destroy: () => undefined }),
        recorder: { mimeType: 'video/webm', start: () => undefined, stop: async () => new Uint8Array(0) },
        clock: { wait: async () => undefined },
      }),
    ).rejects.toThrow();
  });

  it('refuses the hostile timeline before recording', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    let started = 0;
    await expect(
      exportTimelineFallback({
        film,
        timeline: flattenFilm(film, hostileInserts(film)),
        scenes: toInputs(scenes),
        fps: 10,
        openSession: async () => ({ applyAhead: () => undefined, destroy: () => undefined }),
        recorder: {
          mimeType: 'video/webm',
          start: () => void started++,
          stop: async () => new Uint8Array(0),
        },
        clock: { wait: async () => undefined },
      }),
    ).rejects.toThrow(/at most/);
    expect(started).toBe(0);
  });
});

describe('film export: codec selection', () => {
  const view = globalThis as unknown as Record<string, unknown>;
  const savedVideo = view.VideoEncoder;
  const savedAudio = view.AudioEncoder;
  const restore = (): void => {
    if (savedVideo === undefined) delete view.VideoEncoder;
    else view.VideoEncoder = savedVideo;
    if (savedAudio === undefined) delete view.AudioEncoder;
    else view.AudioEncoder = savedAudio;
  };

  it('falls back where WebCodecs is missing', async () => {
    delete view.VideoEncoder;
    delete view.AudioEncoder;
    try {
      expect(await probeExportCodecs(640, 480)).toEqual({ video: null, videoCodecString: null, audio: false });
    } finally {
      restore();
    }
  });

  it('picks H.264 first, then VP9, then VP8, by capability', async () => {
    const decisions = new Map<string, boolean>();
    view.VideoEncoder = { isConfigSupported: async (config: { codec: string }) => ({ supported: decisions.get(config.codec) ?? false }) };
    view.AudioEncoder = { isConfigSupported: async () => ({ supported: true }) };
    try {
      decisions.set('avc1.640028', true);
      expect(await probeExportCodecs(640, 480)).toEqual({ video: 'avc', videoCodecString: 'avc1.640028', audio: true });
      decisions.set('avc1.640028', false);
      decisions.set('avc1.42001f', false);
      decisions.set('vp09.00.10.08', true);
      expect(await probeExportCodecs(640, 480)).toEqual({ video: 'vp09', videoCodecString: 'vp09.00.10.08', audio: true });
      decisions.set('vp09.00.10.08', false);
      decisions.set('vp8', true);
      expect(await probeExportCodecs(640, 480)).toEqual({ video: 'vp08', videoCodecString: 'vp8', audio: true });
      decisions.set('vp8', false);
      expect(await probeExportCodecs(640, 480)).toEqual({ video: null, videoCodecString: null, audio: false });
    } finally {
      restore();
    }
  });

  it('treats a throwing probe as unsupported, and ships video-only without AAC', async () => {
    view.VideoEncoder = { isConfigSupported: async () => ({ supported: true }) };
    view.AudioEncoder = {
      isConfigSupported: async () => {
        throw new Error('no aac');
      },
    };
    try {
      const support = await probeExportCodecs(640, 480);
      expect(support.video).toBe('avc');
      expect(support.audio).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('film export: download filenames', () => {
  it('keeps honest names byte-identical', () => {
    expect(exportVideoFilename('pendulum', 1, null, '480', 'mp4', false)).toBe('pendulum-v1-480p.mp4');
    expect(exportVideoFilename('pendulum', 1, 'with-inserts', '720', 'mp4', false)).toBe('pendulum-v1-with-inserts-720p.mp4');
    expect(exportVideoFilename('pendulum', 1, 'insert-1', '480', 'webm', true)).toBe('pendulum-v1-insert-1-480p-fallback.webm');
    expect(sanitizeExportFilenameSegment('pendulum')).toBe('pendulum');
  });

  it('neutralizes a hostile insert id and resolution', () => {
    const hostileId = '../../etc/passwd\u0000; rm -rf ~';
    const hostileHeight = '480p/../../evil';
    const mp4 = exportVideoFilename('pendulum', 1, hostileId, hostileHeight, 'mp4', false);
    const fallback = exportVideoFilename('../wave', 1, hostileId, hostileHeight, 'webm', true);
    for (const name of [mp4, fallback]) {
      expect(name).not.toContain('/');
      expect(name).not.toContain('\\');
      expect(name).not.toContain('..');
      expect(name).not.toContain('\0');
      expect(name).not.toContain(' ');
    }
    expect(mp4.endsWith('.mp4')).toBe(true);
    expect(fallback.endsWith('.webm')).toBe(true);
    expect(mp4).toMatch(/^[A-Za-z0-9_.-]+\.mp4$/);
    expect(sanitizeExportFilenameSegment(hostileId).length).toBeLessThanOrEqual(EXPORT_FILENAME_SEGMENT_CHARS);
    expect(sanitizeExportFilenameSegment('')).toBe('film');
    expect(sanitizeExportFilenameSegment('...')).not.toContain('.');
  });

  it('keeps triple-max hostile segments within NAME_MAX', () => {
    const max = 'a'.repeat(EXPORT_FILENAME_SEGMENT_CHARS);
    const tall = '1'.repeat(EXPORT_FILENAME_SEGMENT_CHARS);
    for (const extension of ['mp4', 'webm'] as const) {
      for (const fallback of [false, true]) {
        const name = exportVideoFilename(max, 1, max, tall, extension, fallback);
        expect(name.length).toBeLessThanOrEqual(EXPORT_FILENAME_MAX_CHARS);
        expect(name.endsWith(`.${extension}`)).toBe(true);
        expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
      }
    }
    // A tampered resolution and a big version stay bounded too.
    const big = exportVideoFilename(max, Number.MAX_SAFE_INTEGER, max, '9'.repeat(200), 'mp4', true);
    expect(big.length).toBeLessThanOrEqual(EXPORT_FILENAME_MAX_CHARS);
    expect(big.endsWith('.mp4')).toBe(true);
  });

  it('leaves short names byte-identical after the length bound', () => {
    expect(exportVideoFilename('pendulum', 1, null, '480', 'mp4', false)).toBe('pendulum-v1-480p.mp4');
    expect(exportVideoFilename('a'.repeat(80), 12, 'b'.repeat(80), '720', 'mp4', false)).toBe(
      `${'a'.repeat(80)}-v12-${'b'.repeat(80)}-720p.mp4`,
    );
  });

  it('falls back to v1 for versions that would interpolate outside the charset', () => {
    const honest = exportVideoFilename('pendulum', 1, null, '480', 'mp4', false);
    // Past 1e21 integers stringify in exponential form ('1e+21'), and unsafe,
    // fractional, negative or non-finite versions carry no honest digits.
    for (const version of [1e21, 1e300, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER + 1, 2 ** 60, 1.5, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const name = exportVideoFilename('pendulum', version, null, '480', 'mp4', false);
      expect(name).toBe(honest);
      expect(name).toMatch(/^[A-Za-z0-9_.-]+$/);
      expect(name.length).toBeLessThanOrEqual(EXPORT_FILENAME_MAX_CHARS);
    }
  });

  it('renders safe-integer versions byte-identical, including MAX_SAFE_INTEGER', () => {
    expect(exportVideoFilename('pendulum', 2, null, '480', 'mp4', false)).toBe('pendulum-v2-480p.mp4');
    expect(exportVideoFilename('pendulum', 12, 'with-inserts', '720', 'mp4', false)).toBe('pendulum-v12-with-inserts-720p.mp4');
    const biggest = exportVideoFilename('pendulum', Number.MAX_SAFE_INTEGER, null, '480', 'mp4', false);
    expect(biggest).toBe(`pendulum-v${Number.MAX_SAFE_INTEGER}-480p.mp4`);
    expect(biggest).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});

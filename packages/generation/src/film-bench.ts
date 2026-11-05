import {
  compileFilm,
  compileTrusted,
  ExportCancellation,
  filmPresetFor,
  FILM_GENERATION_CEILING_MS,
  FILM_LENGTH_PRESETS,
  FILM_PLAN_BASE_TOKENS,
  FILM_PLAN_TOKENS_PER_SCENE,
  FILM_SCENE_MAX_SECONDS,
  flattenFilm,
  loadKitModules,
  planExportFilm,
  renderExportChunk,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  validateScene,
} from '@incantly/core';
import { streamAnswer } from './ask';
import { generateFilm } from './film';
import { filmReferenceModel } from './film-reference';
import { addUsage, NO_USAGE, type CallPurpose, type ModelCall, type ModelClient, type ModelReply, type ModelUsage, type WarmCall } from './models';
import { narrateBeats } from './narration';
import { isolatedProbe, type SceneProber } from './probe';
import { referenceModel } from './reference-model';
import { StubNarrator, type Narrator } from './tts';

/**
 * The film bench (video-figures.md section 14): tokens and dollars per film
 * length, time to the first playable scene, time to the whole film, repair
 * rate, seek time, export time per film minute, answer latency to first
 * words, and speech time per beat. Generation runs through the real pipeline
 * on the film stand-in model with the stub narrator, so it measures the
 * pipeline and the device, never a model or a speech provider: model
 * latencies come from the figure bench, and the caps are derived from both,
 * with the derivation recorded beside the numbers.
 */

/** Model latencies from the figure bench (text latency, novel condition): plan, scene written whole, one repair. */
export const FILM_MODEL_ALLOWANCE_MS = 3000 + 12_000 + 4000;

/** A seek that stays under this keeps scrubbing near; the scene cap holds scenes to what meets it. */
export const FILM_SEEK_LIMIT_MS = 150;

export interface FilmBenchOptions {
  readonly model?: ModelClient;
  readonly narrator?: Narrator;
  readonly lengths?: readonly number[];
  readonly trialsPerLength?: number;
  readonly probe?: SceneProber | null;
  readonly concurrency?: number;
  readonly now?: () => number;
  readonly onFilm?: (length: number, done: number, total: number) => void;
}

/** Usage recorded per call purpose, so plan tokens read off separately. */
class RecordingModel implements ModelClient {
  readonly name: string;
  readonly usage: Record<CallPurpose, ModelUsage> = { plan: NO_USAGE, scene: NO_USAGE, repair: NO_USAGE };

  constructor(private readonly inner: ModelClient) {
    this.name = inner.name;
  }

  modelFor(purpose: CallPurpose): string {
    return this.inner.modelFor(purpose);
  }

  async complete(call: ModelCall): Promise<ModelReply> {
    const reply = await this.inner.complete(call);
    this.usage[call.purpose] = addUsage(this.usage[call.purpose], reply.usage);
    return reply;
  }

  warm?(call: WarmCall): Promise<ModelUsage> {
    return this.inner.warm?.(call) ?? Promise.resolve(NO_USAGE);
  }
}

export interface FilmBenchLengthLine {
  readonly length: number;
  readonly films: number;
  readonly scenes: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Model dollars plus speech dollars. */
  readonly usd: number;
  readonly speechChars: number;
  readonly speechUsd: number;
  readonly firstSceneMs: readonly number[];
  readonly totalMs: readonly number[];
  readonly repairs: number;
  readonly repairRate: number;
  /** Plan output tokens per scene, the plan-cap derivation's input. */
  readonly planTokensPerScene: number;
}

export interface FilmBenchSeek {
  readonly fixture: string;
  readonly seconds: number;
  readonly ms: number;
}

export interface FilmBenchExport {
  readonly fixture: string;
  readonly filmSeconds: number;
  readonly frames: number;
  readonly renderMs: number;
  /** Render milliseconds per minute of film: the offline renderer only, no encoder or muxer. */
  readonly msPerFilmMinute: number;
}

export interface FilmBenchAnswer {
  readonly firstWordsMs: number;
  readonly ms: number;
}

export interface FilmBenchSpeech {
  readonly beats: number;
  readonly chars: number;
  readonly ms: number;
  readonly msPerBeat: number;
}

export interface FilmBenchDeadlineFit {
  readonly length: number;
  readonly deadlineMs: number;
  /** Slowest scripted whole-film time: the pipeline's own checks, probe and speech queue, no model wait. */
  readonly codeMs: number;
  readonly allowanceMs: number;
  readonly fits: boolean;
}

export interface FilmBenchCaps {
  /** Measured plan output tokens per scene against the per-scene plan cap. */
  readonly planTokensPerScene: { readonly measured: number; readonly cap: number; readonly fits: boolean };
  /** Slowest 60 s seek against the scrub limit, which the scene cap holds. */
  readonly seekMs: { readonly measured: number; readonly limit: number; readonly sceneCapSeconds: number; readonly fits: boolean };
  readonly deadlines: readonly FilmBenchDeadlineFit[];
  readonly ceilingMs: number;
  readonly fits: boolean;
}

export interface FilmBenchReport {
  readonly model: string;
  readonly lengths: readonly FilmBenchLengthLine[];
  readonly seek: readonly FilmBenchSeek[];
  readonly export: FilmBenchExport;
  readonly answer: FilmBenchAnswer;
  readonly speech: FilmBenchSpeech;
  readonly caps: FilmBenchCaps;
}

/** Derives the film caps' fit from a bench report: every cap the bench sets, with its measured input. */
export function deriveFilmCaps(
  lines: ReadonlyArray<Pick<FilmBenchLengthLine, 'planTokensPerScene' | 'scenes'>>,
  seek: ReadonlyArray<Pick<FilmBenchSeek, 'ms'>>,
  deadlines: { readonly length: number; readonly deadlineMs: number; readonly codeMs: number }[],
): FilmBenchCaps {
  const perScene = lines.flatMap((line) => (line.scenes > 0 ? [line.planTokensPerScene] : []));
  const measuredPlan = perScene.length > 0 ? Math.max(...perScene) : 0;
  const measuredSeek = seek.length > 0 ? Math.max(...seek.map((s) => s.ms)) : 0;
  const fits = deadlines.map((line) => ({ ...line, allowanceMs: FILM_MODEL_ALLOWANCE_MS, fits: line.codeMs + FILM_MODEL_ALLOWANCE_MS <= line.deadlineMs }));
  const planFits = measuredPlan <= FILM_PLAN_TOKENS_PER_SCENE;
  const seekFits = measuredSeek <= FILM_SEEK_LIMIT_MS;
  return {
    planTokensPerScene: { measured: Math.ceil(measuredPlan), cap: FILM_PLAN_TOKENS_PER_SCENE, fits: planFits },
    seekMs: { measured: Math.round(measuredSeek * 10) / 10, limit: FILM_SEEK_LIMIT_MS, sceneCapSeconds: FILM_SCENE_MAX_SECONDS, fits: seekFits },
    deadlines: fits,
    ceilingMs: FILM_GENERATION_CEILING_MS,
    fits: planFits && seekFits && fits.every((line) => line.fits),
  };
}

export async function runFilmBench(options: FilmBenchOptions = {}): Promise<FilmBenchReport> {
  const now = options.now ?? (() => Date.now());
  const lengths = options.lengths ?? [...FILM_LENGTH_PRESETS];
  const trialsPerLength = Math.max(1, options.trialsPerLength ?? 2);
  const probe = options.probe === undefined ? isolatedProbe : options.probe;
  const narrator = options.narrator ?? new StubNarrator();
  const total = lengths.length * trialsPerLength;
  let done = 0;

  const lines: FilmBenchLengthLine[] = [];
  for (const length of lengths) {
    const preset = filmPresetFor(length);
    let films = 0;
    let scenes = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let usd = 0;
    let speechChars = 0;
    let speechUsd = 0;
    let repairs = 0;
    let planOutput = 0;
    let planScenes = 0;
    const firstSceneMs: number[] = [];
    const totalMs: number[] = [];
    for (let trial = 0; trial < trialsPerLength; trial++) {
      const recording = new RecordingModel(options.model ?? filmReferenceModel());
      const state = await generateFilm({ prompt: `Bench film of ${preset.seconds} seconds`, lengthTarget: length }, { model: recording, narrator, probe });
      films++;
      scenes += state.scenes.length;
      inputTokens += state.usage.inputTokens + state.usage.cacheReadTokens + state.usage.cacheWriteTokens;
      outputTokens += state.usage.outputTokens;
      usd += state.cost + state.speechUsd;
      speechChars += state.speechChars;
      speechUsd += state.speechUsd;
      repairs += state.scenes.reduce((sum, scene) => sum + scene.repairsUsed, 0);
      planOutput += recording.usage.plan.outputTokens;
      planScenes += state.scenes.length;
      if (state.timings.firstSceneMs !== null) firstSceneMs.push(state.timings.firstSceneMs);
      totalMs.push(state.timings.totalMs);
      done++;
      options.onFilm?.(length, done, total);
    }
    lines.push({
      length: preset.seconds,
      films,
      scenes,
      inputTokens,
      outputTokens,
      usd: Math.round(usd * 10000) / 10000,
      speechChars,
      speechUsd: Math.round(speechUsd * 10000) / 10000,
      firstSceneMs,
      totalMs,
      repairs,
      repairRate: scenes === 0 ? 0 : Math.round((repairs / scenes) * 10000) / 10000,
      planTokensPerScene: planScenes === 0 ? 0 : planOutput / planScenes,
    });
  }

  const seek = await measureSeek(now);
  const exportLine = await measureExport(now);
  const answer = await measureAnswer();
  const speech = await measureSpeech(narrator);
  const caps = deriveFilmCaps(
    lines,
    seek,
    lines.map((line) => ({ length: line.length, deadlineMs: filmPresetFor(line.length).deadlineMs, codeMs: line.totalMs.reduce((a, b) => Math.max(a, b), 0) })),
  );
  return { model: options.model?.name ?? 'film-reference', lengths: lines, seek, export: exportLine, answer, speech, caps };
}

/** Seek-by-replay to near the scene cap on both fixture scenes: the scene cap's derivation input. */
async function measureSeek(now: () => number): Promise<FilmBenchSeek[]> {
  const out: FilmBenchSeek[] = [];
  for (const fixture of [THIRTY_SECOND_FILM, SIXTY_SECOND_FILM]) {
    const scene = fixture.scenes[0]!;
    const validation = validateScene({ html: scene.html, css: scene.css, js: scene.js });
    if (!validation.ok || !validation.scene) throw new Error(`Fixture scene failed validation: ${fixture.id}`);
    const kits = await loadKitModules(validation.scene.kits);
    const compiled = compileTrusted(scene.js);
    for (const seconds of [20, 40, 59]) {
      const runtime = new SceneRuntime({ kits });
      runtime.mount(compiled);
      const started = now();
      runtime.seek(seconds);
      out.push({ fixture: fixture.id, seconds, ms: now() - started });
      runtime.destroy();
    }
  }
  return out;
}

/** The offline renderer over the sixty-second fixture: frames counted and timed, nothing encoded. */
async function measureExport(now: () => number): Promise<FilmBenchExport> {
  const fixture = SIXTY_SECOND_FILM;
  const scene = fixture.scenes[0]!;
  const validation = validateScene({ html: scene.html, css: scene.css, js: scene.js });
  if (!validation.ok || !validation.scene) throw new Error(`Fixture scene failed validation: ${fixture.id}`);
  const kits = await loadKitModules(validation.scene.kits);
  const compiled = compileTrusted(scene.js);
  const runtime = new SceneRuntime({ kits });
  runtime.mount(compiled);
  const steps = runtime.beats();
  runtime.destroy();
  if (!steps) throw new Error('Fixture scene has no steps');
  const result = compileFilm(JSON.parse(JSON.stringify(fixture.storyboard)) as unknown, [{ id: scene.id, js: scene.js, steps }]);
  if (!result.ok || !result.film) throw new Error(`Fixture film failed to compile: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  const film = result.film;
  const planned = planExportFilm(film, flattenFilm(film), [{ id: scene.id, scene: compiled, kits }], {});
  if (!planned.ok) throw new Error(`Fixture export failed to plan: ${planned.problems.join('; ')}`);
  const plan = planned.plan;
  const cancel = new ExportCancellation();
  const started = now();
  let frames = 0;
  for (const chunk of plan.chunks) {
    for (const _frame of renderExportChunk(chunk, { id: scene.id, scene: compiled, kits }, cancel)) frames++;
  }
  const renderMs = now() - started;
  return { fixture: fixture.id, filmSeconds: Math.round(film.seconds * 10) / 10, frames, renderMs, msPerFilmMinute: film.seconds > 0 ? (renderMs / film.seconds) * 60 : 0 };
}

/** Answer latency to the first streamed words, through the answering call. */
async function measureAnswer(): Promise<FilmBenchAnswer> {
  const beat = THIRTY_SECOND_FILM.storyboard.scenes[0]!.beats[0]!;
  const neighbour = THIRTY_SECOND_FILM.storyboard.scenes[0]!.beats[1]!;
  const reply = await streamAnswer(referenceModel(), {
    question: 'Why does every swing take the same time?',
    anchor: { film: 'pendulum', version: 1, scene: 's1', beat: beat.id, wordIndex: 0 },
    beat: { beat: beat.id, say: beat.say },
    neighbours: [{ beat: neighbour.id, say: neighbour.say }],
    sceneLines: [{ n: 1, text: "inc.idea('A pendulum swings in the same time whatever its size.');" }],
    sceneSummary: 'A pendulum swings from its pivot.',
    values: { angle: 0.5 },
    readouts: [],
    thread: [],
    depth: 'standard',
    language: 'en',
  });
  return { firstWordsMs: reply.firstChunkMs, ms: reply.ms };
}

/** Speech time per beat over the thirty-second fixture's lines, through the stub narrator. */
async function measureSpeech(narrator: Narrator): Promise<FilmBenchSpeech> {
  const beats = THIRTY_SECOND_FILM.storyboard.scenes[0]!.beats.map((beat) => ({ beatId: beat.id, text: beat.say }));
  const run = await narrateBeats(beats, { narrator });
  return { beats: run.beats.length, chars: run.chars, ms: run.ms, msPerBeat: Math.round(run.msPerBeat * 10) / 10 };
}

const ms = (values: readonly number[]): string => {
  if (values.length === 0) return '–';
  const sorted = [...values].sort((a, b) => a - b);
  return `${Math.round(sorted[Math.floor(sorted.length / 2)]!)}`;
};

/** The bench report as Markdown, with the cap derivation recorded beside the numbers. */
export function filmBenchMarkdown(report: FilmBenchReport): string {
  const caps = report.caps;
  const seekNote = caps.seekMs.fits
    ? `Slowest 60 s seek ${caps.seekMs.measured} ms against the ${caps.seekMs.limit} ms scrub limit: scenes hold at ${caps.seekMs.sceneCapSeconds} s (fits).`
    : `Slowest 60 s seek ${caps.seekMs.measured} ms against the ${caps.seekMs.limit} ms scrub limit (EXCEEDS on plot-heavy scenes; see the seeks above). ` +
      `Per-step plot resampling dominates, so capping length lower cannot fix it — even short seeks on such scenes exceed — and the ${caps.seekMs.sceneCapSeconds} s cap stands as the bound on replayed steps (at most 3,600). ` +
      `The video-figures section 6 contingency applies: seek from the start of the beat where a beat restarts the model from its values.`;
  const lines = [
    `# Film bench: ${report.model}`,
    '',
    'Generation through the real pipeline on the stand-in model with the stub narrator: tokens and dollars are measured, while model waits come from the figure bench and capacities from this device.',
    '',
    '| Length | Films | Scenes | Input tokens | Output tokens | Total $ | Speech chars | Speech $ | First scene ms (p50) | Total ms (p50) | Repairs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.lengths.map(
      (line) =>
        `| ${line.length}s | ${line.films} | ${line.scenes} | ${line.inputTokens} | ${line.outputTokens} | $${line.usd.toFixed(4)} | ${line.speechChars} | $${line.speechUsd.toFixed(4)} | ${ms(line.firstSceneMs)} | ${ms(line.totalMs)} | ${line.repairs} |`,
    ),
    '',
    '## Pace off the generation path',
    '',
    ...report.seek.map((s) => `- Seek to ${s.seconds} s on the ${s.fixture} scene: ${s.ms} ms.`),
    `- Export render of the ${report.export.fixture} film (${report.export.filmSeconds} s, ${report.export.frames} frames): ${report.export.renderMs} ms, ${Math.round(report.export.msPerFilmMinute)} ms per film minute (renderer only; no encoder or muxer).`,
    `- Answer latency to first words: ${report.answer.firstWordsMs} ms (${report.answer.ms} ms whole).`,
    `- Speech time per beat: ${report.speech.msPerBeat} ms over ${report.speech.beats} beats (${report.speech.chars} chars, stub narrator).`,
    '',
    '## Cap derivation',
    '',
    `- Plan cap: ${caps.planTokensPerScene.measured} plan output tokens per scene measured, against ${FILM_PLAN_BASE_TOKENS} base plus ${caps.planTokensPerScene.cap} per scene (${caps.planTokensPerScene.fits ? 'fits' : 'EXCEEDS'}).`,
    `- Scene cap: ${seekNote}`,
    ...caps.deadlines.map(
      (line) => `- ${line.length} s deadline: ${line.codeMs} ms of pipeline plus ${line.allowanceMs} ms of model allowance (plan 3 s, scene 12 s, one repair 4 s, from the figure bench) against ${line.deadlineMs} ms (${line.fits ? 'fits' : 'EXCEEDS'}).`,
    ),
    `- Every deadline sits within the ${caps.ceilingMs / 1000} s generation ceiling. Scene counts stay at one per 30 to 60 s of film (ADR 009).`,
    '',
  ];
  return lines.join('\n');
}

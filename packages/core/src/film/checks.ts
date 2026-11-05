import type { ViewBox } from '../api/types';
import type { KitRegistry } from '../runtime/kits';
import { applyBeatCues, applyShowHide, partBox, partBoxes, sfxNames } from '../runtime/film';
import { SceneRuntime, type SceneFunction } from '../runtime/runtime';
import { FILM_READING_WPS_LIMIT, type CompiledBeat, type CompiledFilm } from './storyboard';
import { CAPTION_MIN_PX, CAPTION_MIN_STAGE_SHARE, SAFE_MARGIN_SHARE, solveCallouts, solveCaption, titleCardRect } from './solver';
import type { Box } from '../scene/bounds';

/**
 * The film checks: every beat at its start, middle and end, at 360, 640 and
 * 960 px, light and dark. Safe margin, caption lines, size, overlap,
 * contrast, focus in frame, reading speed and one emphasis at a time. Audio
 * sync checks run when narration audio arrives; until then beats are
 * estimated and the checks say so.
 */

export type FilmCheck = 'safe-margin' | 'caption-lines' | 'size' | 'overlap' | 'contrast' | 'focus-in-frame' | 'reading-speed' | 'one-emphasis' | 'sfx';

export type FilmPoint = 'start' | 'mid' | 'end';

export type FilmTheme = 'light' | 'dark';

export interface FilmFailure {
  readonly check: FilmCheck;
  readonly message: string;
  readonly scene: string;
  readonly beat: string;
  readonly point?: FilmPoint;
  readonly width?: number;
  readonly theme?: FilmTheme;
}

export interface FilmReportStats {
  readonly beats: number;
  readonly points: number;
  readonly ms: number;
  readonly msPerBeat: number;
}

export interface FilmReport {
  readonly ok: boolean;
  readonly failures: readonly FilmFailure[];
  readonly warnings: readonly string[];
  readonly stats: FilmReportStats;
}

export interface FilmSceneInput {
  readonly id: string;
  readonly scene: SceneFunction;
  readonly kits?: KitRegistry;
}

export interface FilmTokens {
  readonly fg: string;
  readonly bg: string;
}

export interface ProbeFilmOptions {
  readonly film: CompiledFilm;
  readonly scenes: readonly FilmSceneInput[];
  readonly widths?: readonly number[];
  readonly themes?: readonly FilmTheme[];
  /** Text and chip colours per theme; defaults are the theme's own (theme.ts). */
  readonly tokens?: Readonly<Record<FilmTheme, FilmTokens>>;
  readonly seed?: number;
  /** Called before every runtime step, so the Worker can refuel. */
  readonly beforeStep?: () => void;
  readonly now?: () => number;
  readonly onProgress?: (beat: number, beats: number) => void;
}

/** Default text and chip colours, the theme's own fg and bg. */
export const FILM_TOKENS: Readonly<Record<FilmTheme, FilmTokens>> = {
  light: { fg: '#1f1f24', bg: '#ffffff' },
  dark: { fg: '#ececf1', bg: '#17171b' },
};

/** Lowest text contrast the checks accept. */
export const FILM_CONTRAST_MIN = 4.5;

const WIDTHS = [360, 640, 960];
const THEMES: readonly FilmTheme[] = ['light', 'dark'];
const POINTS: ReadonlyArray<{ readonly name: FilmPoint; readonly at: number }> = [
  { name: 'start', at: 0 },
  { name: 'mid', at: 0.5 },
  { name: 'end', at: 1 },
];
const MAX_FAILURES_PER_CHECK_BEAT = 4;

export function probeFilm(options: ProbeFilmOptions): FilmReport {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const started = now();
  const shared = shareChecks(options);
  for (let beat = 0; beat < options.film.beats.length; beat++) {
    options.onProgress?.(beat, options.film.beats.length);
    checkBeat(shared, beat);
  }
  return finishReport(options, shared, now() - started);
}

/**
 * The same checks, yielding to the event loop between beats so a player can
 * report progress. Results equal probeFilm's beat for beat.
 */
export async function probeFilmAsync(options: ProbeFilmOptions): Promise<FilmReport> {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const started = now();
  const shared = shareChecks(options);
  for (let beat = 0; beat < options.film.beats.length; beat++) {
    options.onProgress?.(beat, options.film.beats.length);
    checkBeat(shared, beat);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return finishReport(options, shared, now() - started);
}

interface SharedChecks {
  readonly options: ProbeFilmOptions;
  readonly widths: readonly number[];
  readonly themes: readonly FilmTheme[];
  readonly tokens: Readonly<Record<FilmTheme, FilmTokens>>;
  readonly byId: ReadonlyMap<string, FilmSceneInput>;
  readonly failures: FilmFailure[];
  points: number;
}

function shareChecks(options: ProbeFilmOptions): SharedChecks {
  return {
    options,
    widths: options.widths ?? WIDTHS,
    themes: options.themes ?? THEMES,
    tokens: options.tokens ?? FILM_TOKENS,
    byId: new Map(options.scenes.map((scene) => [scene.id, scene])),
    failures: [],
    points: 0,
  };
}

function finishReport(options: ProbeFilmOptions, shared: SharedChecks, ms: number): FilmReport {
  const beats = options.film.beats.length;
  return {
    ok: shared.failures.length === 0,
    failures: shared.failures,
    warnings: ['Narration is estimated from words; audio and caption sync checks run when audio arrives.'],
    stats: { beats, points: shared.points, ms: Math.round(ms * 10) / 10, msPerBeat: beats > 0 ? Math.round((ms / beats) * 10) / 10 : 0 },
  };
}

function failBeat(shared: SharedChecks, failure: FilmFailure): void {
  const same = shared.failures.filter((f) => f.check === failure.check && f.beat === failure.beat).length;
  if (same < MAX_FAILURES_PER_CHECK_BEAT) shared.failures.push(failure);
}

/**
 * One beat at its start, middle and end: one runtime seeks to the start, then
 * ticks forward in exact 1/60 s steps, which replay identically to seeks
 * (the film clock advances tick for tick on exact gaps). Steps land at once,
 * as under reduced motion, so every point measures the beat's own state.
 */
function checkBeat(shared: SharedChecks, beatNumber: number): void {
  const { options } = shared;
  const beat = options.film.beats[beatNumber]!;
  const fail = (failure: FilmFailure): void => failBeat(shared, failure);
  const input = shared.byId.get(beat.sceneId);
  if (!input) {
    fail({ check: 'focus-in-frame', scene: beat.sceneId, beat: beat.id, message: `Scene "${beat.sceneId}" has no source` });
    return;
  }
  checkBeatOnce(beat, fail);
  const sceneStart = options.film.scenes.find((scene) => scene.id === beat.sceneId)!.start;
  const runtime = new SceneRuntime({ ...(input.kits ? { kits: input.kits } : {}), seed: options.seed ?? 1 });
  options.beforeStep?.();
  runtime.mount(input.scene);
  if (!runtime.isMounted) {
    fail({ check: 'focus-in-frame', scene: beat.sceneId, beat: beat.id, message: 'The scene threw while mounting' });
    return;
  }
  runtime.seek(beat.start - sceneStart, { beforeStep: () => options.beforeStep?.() });
  // A seek to the film's start runs no frames; one still frame draws the kits' initial state.
  runtime.tick(0);
  runtime.setReducedMotion(true);
  runtime.step('goto', beat.index);
  // Show and hide accumulate across the scene, as under the controller's
  // seek: earlier beats' lists are already landed when the beat starts.
  const sceneBeats = options.film.scenes.find((scene) => scene.id === beat.sceneId)?.beats ?? [];
  for (const earlier of sceneBeats) {
    if (earlier.index >= beat.index) break;
    applyShowHide(runtime, earlier.step);
  }
  applyBeatCues(runtime, beat.step, { sfx: false });
  let measured = runtime.time;
  for (const point of POINTS) {
    const target = beat.start - sceneStart + point.at * beat.seconds;
    const steps = Math.max(0, Math.round((target - measured) / (1 / 60)));
    for (let i = 0; i < steps; i++) {
      options.beforeStep?.();
      runtime.tick(1 / 60);
    }
    measured += steps / 60;
    shared.points++;
    const stage = runtime.graph.stages[0];
    if (!stage) {
      fail({ check: 'focus-in-frame', scene: beat.sceneId, beat: beat.id, point: point.name, message: 'The scene draws no stage' });
      continue;
    }
    // The beat's own end is the next beat's start; the beat is measured with its own cues on.
    checkPoint(beat, runtime, stage.viewBox, shared.widths, shared.themes, shared.tokens, point.name, fail);
  }
}

/** Checks that hold for the whole beat, whatever the point, width or theme. */
function checkBeatOnce(beat: CompiledBeat, fail: (failure: FilmFailure) => void): void {
  const words = beat.words.length;
  const wps = words / beat.seconds;
  if (wps > FILM_READING_WPS_LIMIT) {
    fail({
      check: 'reading-speed',
      scene: beat.sceneId,
      beat: beat.id,
      message: `Beat "${beat.id}" reads ${words} words in ${beat.seconds.toFixed(1)} s (${wps.toFixed(1)} words per second); the limit is ${FILM_READING_WPS_LIMIT}`,
    });
  }
  const moving = (beat.step.mark ?? []).filter((mark) => mark.type === 'pulse' || mark.type === 'draw');
  if (moving.length > 1) {
    fail({ check: 'one-emphasis', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" moves ${moving.length} emphases at once; one at a time` });
  }
  if (beat.step.sfx !== undefined && !sfxNames().includes(beat.step.sfx)) {
    fail({ check: 'sfx', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" cues "${beat.step.sfx}", which is not a named cue (${sfxNames().join(', ')})` });
  }
}

function checkPoint(
  beat: CompiledBeat,
  runtime: SceneRuntime,
  viewBox: ViewBox,
  widths: readonly number[],
  themes: readonly FilmTheme[],
  tokens: Readonly<Record<FilmTheme, FilmTokens>>,
  point: FilmPoint,
  fail: (failure: FilmFailure) => void,
): void {
  const boxes = partBoxes(runtime);
  const occupied = [...boxes.values()].map((entry) => entry.box);
  const focusName = beat.step.focus ?? beat.step.cam?.to ?? beat.step.mark?.[0]?.part ?? null;
  const focus = focusName ? partBox(runtime, focusName) : null;
  const card = beat.step.title !== undefined && (typeof beat.step.title === 'string' ? false : (beat.step.title.kind ?? 'lower') === 'card') ? titleCardRect(viewBox) : null;

  for (const width of widths) {
    const stageHeightPx = (width * viewBox[3]) / viewBox[2];
    const caption = solveCaption(beat.step.say, { widthPx: width, stageHeightPx });
    if (caption.overflow || caption.lines.length > 2) {
      fail({
        check: 'caption-lines',
        scene: beat.sceneId,
        beat: beat.id,
        point,
        width,
        message: `Beat "${beat.id}" needs more than two caption lines at ${width} px; split it or shorten the line`,
      });
    }
    if (caption.fontPx < CAPTION_MIN_PX || caption.fontPx < stageHeightPx * CAPTION_MIN_STAGE_SHARE - 1e-9) {
      fail({
        check: 'size',
        scene: beat.sceneId,
        beat: beat.id,
        point,
        width,
        message: `Beat "${beat.id}" captions at ${caption.fontPx.toFixed(1)} px at ${width} px, under the minimum`,
      });
    }
    // The band sits outside the drawing with its side margins; the drawing keeps the full width.
    if (caption.bandHeightPx > stageHeightPx * 0.6) {
      fail({
        check: 'safe-margin',
        scene: beat.sceneId,
        beat: beat.id,
        point,
        width,
        message: `Beat "${beat.id}" caption band takes ${Math.round(caption.bandHeightPx)} px of a ${Math.round(stageHeightPx)} px drawing at ${width} px`,
      });
    }
    const callouts = (beat.step.mark ?? []).filter((mark) => mark.type === 'callout');
    const chips = solveCallouts(
      callouts.map((mark) => ({ id: mark.part, at: calloutAnchor(boxes.get(mark.part)?.box ?? null), text: beat.step.short ?? firstWords(beat.step.say, 6) })),
      { viewBox, stageWidthPx: width, occupied: card ? [...occupied, card] : occupied },
    );
    for (const id of chips.failed) {
      fail({
        check: 'overlap',
        scene: beat.sceneId,
        beat: beat.id,
        point,
        width,
        message: `Beat "${beat.id}" callout on "${id}" places nowhere at ${width} px without covering a part; shorten "short" or free a slot`,
      });
    }
    if (card && focus && covers(card, focus.box)) {
      fail({
        check: 'overlap',
        scene: beat.sceneId,
        beat: beat.id,
        point,
        width,
        message: `Beat "${beat.id}" title card covers "${focusName}" at ${width} px; cards must leave the focus uncovered`,
      });
    }
    for (const theme of themes) {
      const ratio = contrastRatio(tokens[theme].fg, tokens[theme].bg);
      if (ratio < FILM_CONTRAST_MIN) {
        fail({
          check: 'contrast',
          scene: beat.sceneId,
          beat: beat.id,
          point,
          width,
          theme,
          message: `Beat "${beat.id}" text contrasts ${ratio.toFixed(1)}:1 in ${theme}; the minimum is ${FILM_CONTRAST_MIN}:1`,
        });
      }
    }
  }

  if (focusName && !focus) {
    fail({
      check: 'focus-in-frame',
      scene: beat.sceneId,
      beat: beat.id,
      point,
      message: `Beat "${beat.id}" focuses on "${focusName}", which is hidden or draws nothing at the ${point}`,
    });
  } else if (focus) {
    const [vx, vy, vw, vh] = viewBox;
    const margin = Math.min(vw, vh) * SAFE_MARGIN_SHARE;
    const box = focus.box;
    if (box.minX < vx - margin || box.maxX > vx + vw + margin || box.minY < vy - margin || box.maxY > vy + vh + margin) {
      fail({
        check: 'focus-in-frame',
        scene: beat.sceneId,
        beat: beat.id,
        point,
        message: `Beat "${beat.id}" focus "${focusName}" lies outside its stage at the ${point}`,
      });
    }
  }
}

function calloutAnchor(box: Box | null): readonly [number, number] {
  if (!box) return [0, 0];
  return [(box.minX + box.maxX) / 2, box.minY];
}

function firstWords(say: string, count: number): string {
  return say.trim().split(/\s+/).slice(0, count).join(' ');
}

function covers(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/** WCAG relative luminance of an #rgb or #rrggbb colour. */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 0;
  const full = match[1]!.length === 3 ? match[1]!.split('').map((c) => c + c).join('') : match[1]!;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of text on background. */
export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

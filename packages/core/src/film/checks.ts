import type { ViewBox } from '../api/types';
import type { KitRegistry } from '../runtime/kits';
import { accumulatedNotes, applyBeatCues, applyShowHide, partBox, partBoxes, sfxNames } from '../runtime/film';
import { SceneRuntime, type SceneFunction } from '../runtime/runtime';
import { FILM_READING_WPS_LIMIT, type CompiledBeat, type CompiledFilm, type FilmContext } from './storyboard';
import { CAPTION_MIN_PX, CAPTION_MIN_STAGE_SHARE, SAFE_MARGIN_SHARE, explainerCardRect, layoutStageWidth, renderMathText, solveCallouts, solveCaption, solveCard, solveNotes, solveWrite, splitLayout, titleCardRect } from './solver';
import type { Box } from '../scene/bounds';

/**
 * The film checks: every beat at its start, middle and end, at 360, 640 and
 * 960 px, light and dark. Safe margin, caption lines, size, overlap,
 * contrast, focus in frame, reading speed and one emphasis at a time. Audio
 * sync checks run when narration audio arrives; until then beats are
 * estimated and the checks say so. The context check runs per scene when the
 * film carries a shared context: palette, parts, notation and units.
 */

export type FilmCheck = 'safe-margin' | 'caption-lines' | 'size' | 'overlap' | 'contrast' | 'focus-in-frame' | 'reading-speed' | 'one-emphasis' | 'sfx' | 'audio-sync' | 'context';

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
  /** Speech characters across every beat's line: what narrating the film bills. */
  readonly speechChars: number;
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
  /** Scene id to its script: the context check reads palette, parts and units from it. */
  readonly js?: Readonly<Record<string, string>>;
}

/** Imperial words an 'si' notation never uses. */
const IMPERIAL_WORDS = ['inch', 'inches', 'foot', 'feet', 'pound', 'pounds', 'fahrenheit', 'mile', 'miles', 'gallon', 'gallons', 'ounce', 'ounces'];

/** Most words a 'plain' tone allows in one line. */
export const FILM_PLAIN_TONE_MAX_WORDS = 40;

/**
 * The context-conformance check (ADR 009 drift defence): one scene's script
 * and one line against the shared film context. Palette: no colour values,
 * tones only. Parts: names that match the context case-insensitively must
 * match exactly. Units: a parameter's unit must equal the context's. Notation
 * 'si': no imperial words. Tone 'plain': short lines, no semicolons. Empty
 * context fields constrain nothing. Returns one message per breach.
 */
export function checkSceneContext(js: string, say: string, beatParts: readonly string[], context: FilmContext): string[] {
  const problems: string[] = [];
  if (context.palette !== '') {
    const colour = /#[0-9a-f]{3,8}\b/i.exec(js);
    if (colour) problems.push(`uses a colour value "${colour[0]}"; the "${context.palette}" palette uses tones only`);
  }
  if (context.parts.length > 0) {
    const canonical = new Map(context.parts.map((part) => [part.toLowerCase(), part]));
    const registered = [...js.matchAll(/\.part\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
    for (const name of [...beatParts, ...registered]) {
      const want = canonical.get(name.toLowerCase());
      if (want !== undefined && want !== name) problems.push(`names "${name}"; the film calls it "${want}"`);
    }
  }
  if (Object.keys(context.units).length > 0) {
    for (const match of js.matchAll(/inc\.param\(\s*['"]([^'"]+)['"][\s\S]{0,400}?unit:\s*['"]([^'"]+)['"]/g)) {
      const want = context.units[match[1]!];
      if (want !== undefined && want !== match[2]) problems.push(`measures "${match[1]}" in "${match[2]}"; the film uses "${want}"`);
    }
  }
  if (context.notation.toLowerCase() === 'si') {
    const words = say.toLowerCase().split(/[^a-z]+/);
    const imperial = IMPERIAL_WORDS.find((word) => words.includes(word));
    if (imperial) problems.push(`says "${imperial}"; the film's SI notation never uses imperial words`);
  }
  if (context.tone.toLowerCase() === 'plain') {
    const count = say.trim().split(/\s+/).filter((word) => word !== '').length;
    if (count > FILM_PLAIN_TONE_MAX_WORDS) problems.push(`says ${count} words; the film's plain tone keeps lines under ${FILM_PLAIN_TONE_MAX_WORDS}`);
    else if (say.includes(';')) problems.push('joins sentences with a semicolon; the film\'s plain tone keeps one idea per sentence');
  }
  return [...new Set(problems)];
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

export interface ProbeFilmStaticOptions {
  readonly film: CompiledFilm;
  /** Scene id to its script: the context check reads palette, parts and units from it. */
  readonly js?: Readonly<Record<string, string>>;
  readonly now?: () => number;
}

/**
 * The film checks that need no scene: reading speed, one emphasis, sfx
 * names, audio sync and the shared-context read. Sandboxed films run these,
 * where mounting the scene would run its script on the host; the geometry
 * checks ride the sandbox probe instead, and the report says so.
 */
export function probeFilmStatic(options: ProbeFilmStaticOptions): FilmReport {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const started = now();
  const full: ProbeFilmOptions = { film: options.film, scenes: [] };
  const shared = shareChecks(full);
  for (const beat of options.film.beats) {
    checkBeatOnce(beat, (failure) => failBeat(shared, failure));
    const context = options.film.context;
    if (context) {
      const step = beat.step;
      const parts = [step.focus, step.cam?.to, ...(step.show ?? []), ...(step.hide ?? []), ...(step.mark ?? []).map((mark) => mark.part)].filter(
        (name): name is string => typeof name === 'string' && name !== '',
      );
      for (const problem of checkSceneContext(options.js?.[beat.sceneId] ?? '', step.say, parts, context)) {
        failBeat(shared, { check: 'context', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" ${problem}` });
      }
    }
  }
  const report = finishReport(full, shared, now() - started);
  return {
    ...report,
    warnings: [...report.warnings, 'Safe margin, captions, overlap, contrast and focus-in-frame need the scene; the sandbox probe covers the scene itself.'],
  };
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
  const estimated = options.film.beats.some((beat) => !beat.timed);
  return {
    ok: shared.failures.length === 0,
    failures: shared.failures,
    warnings: estimated ? ['Narration is estimated from words; audio and caption sync checks run when audio arrives.'] : [],
    stats: {
      beats,
      points: shared.points,
      ms: Math.round(ms * 10) / 10,
      msPerBeat: beats > 0 ? Math.round((ms / beats) * 10) / 10 : 0,
      speechChars: options.film.beats.reduce((sum, beat) => sum + beat.step.say.length, 0),
    },
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
  const context = options.film.context;
  if (context) {
    const step = beat.step;
    const parts = [step.focus, step.cam?.to, ...(step.show ?? []), ...(step.hide ?? []), ...(step.mark ?? []).map((mark) => mark.part)].filter(
      (name): name is string => typeof name === 'string' && name !== '',
    );
    for (const problem of checkSceneContext(options.js?.[beat.sceneId] ?? '', step.say, parts, context)) {
      fail({ check: 'context', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" ${problem}` });
    }
  }
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
  const compiled = options.film.scenes.find((scene) => scene.id === beat.sceneId);
  const sceneBeats = compiled?.beats ?? [];
  const split = compiled?.split ?? false;
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
    // Notes persist: later beats are checked with every line shown so far.
    // Split scenes are checked against the narrowed stage they render, from the first beat.
    checkPoint(beat, runtime, stage.viewBox, shared.widths, shared.themes, shared.tokens, point.name, fail, accumulatedNotes(sceneBeats, beat.index), split);
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
  // Timed beats carry their audio's word starts; captions highlight from the
  // same starts, so a bad one puts caption and audio out of sync.
  if (beat.timed && beat.audioStarts !== undefined) {
    const starts = beat.audioStarts;
    if (starts.length !== beat.words.length) {
      fail({ check: 'audio-sync', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" times ${starts.length} words of ${beat.words.length}` });
    }
    let last = -Infinity;
    starts.forEach((start, i) => {
      if (!Number.isFinite(start) || start < 0 || start > beat.seconds) {
        fail({ check: 'audio-sync', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" word ${i + 1} starts outside the beat` });
      } else if (start + 1e-9 < last) {
        fail({ check: 'audio-sync', scene: beat.sceneId, beat: beat.id, message: `Beat "${beat.id}" word ${i + 1} starts before the word ahead of it` });
      }
      last = Math.max(last, start);
    });
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
  /** Notes showing on this beat: its scene's lines up to and including it. */
  showing: readonly string[] = [],
  /** True when the scene renders split: the stage narrows beside its notes column from the first beat. */
  split = false,
): void {
  const boxes = partBoxes(runtime);
  const occupied = [...boxes.values()].map((entry) => entry.box);
  const focusName = beat.step.focus ?? beat.step.cam?.to ?? beat.step.mark?.[0]?.part ?? null;
  const focus = focusName ? partBox(runtime, focusName) : null;
  const card = beat.step.title !== undefined && (typeof beat.step.title === 'string' ? false : (beat.step.title.kind ?? 'lower') === 'card') ? titleCardRect(viewBox) : null;
  // A section or recap card covers the stage's own layers for its beat: only
  // the card itself is checked, never what it covers by design.
  const layerCard = beat.step.card !== undefined ? explainerCardRect(viewBox) : null;

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
    // Split scenes render the narrowed stage beside their notes column from
    // the first beat; every other solver reads the narrowed width with it.
    const layout = splitLayout(split, width);
    const stageW = layoutStageWidth(width, layout);
    // The drawing stands no taller than the narrowed stage at its aspect; the
    // caption band below keeps the full frame width either way.
    const drawingHeightPx = (stageW * viewBox[3]) / viewBox[2];
    // Beside the stage the notes column covers nothing by construction; the
    // stacked strip overlays the bottom of the safe area and must clear it.
    const notes = layerCard === null && showing.length > 0 ? solveNotes(showing, { viewBox, stageWidthPx: width }) : null;
    if (notes) {
      if (notes.fontPx < CAPTION_MIN_PX || notes.fontPx < drawingHeightPx * CAPTION_MIN_STAGE_SHARE - 1e-9) {
        fail({
          check: 'size',
          scene: beat.sceneId,
          beat: beat.id,
          point,
          width,
          message: `Beat "${beat.id}" notes at ${notes.fontPx.toFixed(1)} px at ${width} px, under the minimum`,
        });
      }
      if (notes.panel !== null) {
        if (!insideSafe(notes.panel, viewBox)) {
          fail({
            check: 'safe-margin',
            scene: beat.sceneId,
            beat: beat.id,
            point,
            width,
            message: `Beat "${beat.id}" notes leave the safe area at ${width} px`,
          });
        }
        for (const [name, entry] of boxes) {
          if (covers(notes.panel, entry.box)) {
            fail({
              check: 'overlap',
              scene: beat.sceneId,
              beat: beat.id,
              point,
              width,
              message: `Beat "${beat.id}" notes cover "${name}" at ${width} px; keep the notes strip clear`,
            });
            break;
          }
        }
        if (card && covers(notes.panel, card)) {
          fail({
            check: 'overlap',
            scene: beat.sceneId,
            beat: beat.id,
            point,
            width,
            message: `Beat "${beat.id}" notes cover the title card at ${width} px; keep the notes strip clear`,
          });
        }
      }
    }
    const callouts = layerCard === null ? (beat.step.mark ?? []).filter((mark) => mark.type === 'callout') : [];
    const chips = solveCallouts(
      callouts.map((mark) => ({ id: mark.part, at: calloutAnchor(boxes.get(mark.part)?.box ?? null), text: beat.step.short ?? firstWords(beat.step.say, 6) })),
      { viewBox, stageWidthPx: stageW, occupied: [...occupied, ...(card ? [card] : []), ...(notes?.panel ? [notes.panel] : [])] },
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
    // Write-on text draws in the top-left slot on every surface, so the
    // checks require that slot — not just any clear corner.
    const writeText = layerCard === null && typeof beat.step.write?.text === 'string' ? (beat.step.write.math === true ? renderMathText(beat.step.write.text) : beat.step.write.text) : null;
    if (writeText !== null) {
      const placed = solveWrite(writeText, {
        viewBox,
        stageWidthPx: stageW,
        occupied: [...occupied, ...(card ? [card] : []), ...(notes?.panel ? [notes.panel] : []), ...chips.placed.map((chip) => chip.rect)],
      });
      if (!placed) {
        fail({
          check: 'overlap',
          scene: beat.sceneId,
          beat: beat.id,
          point,
          width,
          message: `Beat "${beat.id}" write-on text places nowhere at ${width} px without covering a part; free a corner slot`,
        });
      } else if (placed.slot !== 0) {
        fail({
          check: 'overlap',
          scene: beat.sceneId,
          beat: beat.id,
          point,
          width,
          message: `Beat "${beat.id}" write-on text misses its top-left slot at ${width} px; keep that corner clear`,
        });
      } else {
        if (placed.fontPx < CAPTION_MIN_PX || placed.fontPx < drawingHeightPx * CAPTION_MIN_STAGE_SHARE - 1e-9) {
          fail({
            check: 'size',
            scene: beat.sceneId,
            beat: beat.id,
            point,
            width,
            message: `Beat "${beat.id}" write-on text at ${placed.fontPx.toFixed(1)} px at ${width} px, under the minimum`,
          });
        }
        if (!insideSafe(placed.rect, viewBox)) {
          fail({
            check: 'safe-margin',
            scene: beat.sceneId,
            beat: beat.id,
            point,
            width,
            message: `Beat "${beat.id}" write-on text leaves the safe area at ${width} px`,
          });
        }
      }
    }
    // The full-stage card stays mounted over the scene: its line must fit it.
    if (layerCard !== null && typeof beat.step.card?.text === 'string') {
      const layout = solveCard(beat.step.card.text, { viewBox, stageWidthPx: width });
      if (layout.overflow) {
        fail({
          check: 'caption-lines',
          scene: beat.sceneId,
          beat: beat.id,
          point,
          width,
          message: `Beat "${beat.id}" card needs more than three lines at ${width} px; split it or shorten the line`,
        });
      }
      if (layout.fontPx < CAPTION_MIN_PX) {
        fail({
          check: 'size',
          scene: beat.sceneId,
          beat: beat.id,
          point,
          width,
          message: `Beat "${beat.id}" card at ${layout.fontPx.toFixed(1)} px at ${width} px, under the minimum`,
        });
      }
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

/** True when a layer rect stays inside the drawing's safe area. */
function insideSafe(rect: Box, viewBox: ViewBox): boolean {
  const [vx, vy, vw, vh] = viewBox;
  const margin = Math.min(vw, vh) * SAFE_MARGIN_SHARE;
  return rect.minX >= vx + margin - 1e-9 && rect.minY >= vy + margin - 1e-9 && rect.maxX <= vx + vw - margin + 1e-9 && rect.maxY <= vy + vh - margin + 1e-9;
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

import type { FilmContext, StoryboardScene } from '@incantly/core';
import { filmPresetFor } from '@incantly/core';
import { ScriptedModel, type CallPurpose, type ModelCall } from './models';

/**
 * A stand-in model that answers film calls the way the reference model
 * answers figure calls: the storyboard for the requested length, then one
 * valid scene per slice. It exercises the film pipeline (plan, parallel
 * scenes, validation, probe, context checks, repairs) without a model or an
 * API key: the film bench and the film evals run on it, and it measures the
 * pipeline, never a model.
 *
 * Every scene is the same small figure — one dot, one shift control, the
 * slice's own steps — so every slice passes its checks and every say line
 * matches. Repairs rebuild the same figure from the spoken lines quoted in
 * the repair prompt.
 */

export interface FilmReferenceOptions {
  readonly latencyMs?: number;
  readonly chunk?: number;
  /** Beats per storyboard scene; default 3, within the quick size budget. */
  readonly beatsPerScene?: number;
  /** Model names to report; the defaults mark a stand-in that costs nothing. */
  readonly models?: Partial<Record<CallPurpose, string>>;
}

/** The shared context every storyboard carries: one part, one unit, tones only. */
export const FILM_REFERENCE_CONTEXT: FilmContext = { palette: 'default', parts: ['Dot'], notation: '', units: { shift: 'px' }, tone: '' };

const SAY_LINES = [
  'A dot appears at the center of the stage.',
  'Move the shift control and watch the dot glide aside.',
  'The dot settles, holding its new place.',
  'Shift again to see the same motion repeated.',
];

/** One scene's beat lines: the shared lines rotated by scene, so scenes differ. */
function sceneSays(scene: number, beats: number): string[] {
  return Array.from({ length: beats }, (_, i) => SAY_LINES[(scene + i) % SAY_LINES.length]!);
}

/** The storyboard text for a length: shared by the film stand-in and the figure stand-in's film path. */
export function filmReferenceStoryboard(lengthTarget: number, scenes: number, title: string, beatsPerScene: number): string {
  const slices: StoryboardScene[] = Array.from({ length: scenes }, (_, i) => ({
    id: `s${i + 1}`,
    idea: `A dot shifts aside, part ${i + 1} of ${scenes}`,
    kit: 'svg',
    beats: sceneSays(i, beatsPerScene).map((say, j) => ({ id: `s${i + 1}b${j + 1}`, say, focus: 'Dot' })),
    cut: i % 2 === 0 ? 'fade' : 'cut',
    durationShare: 1 / scenes,
  }));
  return `Here is the storyboard.\n\`\`\`json\n${JSON.stringify({ film: { title, lengthTarget, context: FILM_REFERENCE_CONTEXT }, scenes: slices })}\n\`\`\`\n`;
}

/**
 * The stand-in scene for beats: one dot, one shift control, the beats' own
 * steps. Generic over any beat lines: steps carry the say text verbatim with
 * the shared focus, and the shift values cycle inside the control's range.
 */
export function filmReferenceSceneJs(beats: ReadonlyArray<{ readonly say: string }>): string {
  const steps = beats.map((beat, i) => `  { say: '${beat.say.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', focus: 'Dot', set: { shift: ${(i * 7 + 10) % 40} } },`).join('\n');
  return [
    "inc.idea('A dot shifts as its control changes.');",
    "const shift = inc.param('shift', { min: 0, max: 40, step: 1, value: 20, label: 'Shift', unit: 'px' });",
    "const stage = inc.svg('#stage', { viewBox: [0, 0, 600, 400], title: 'Dot', description: 'A dot that shifts.' });",
    "const dot = stage.circle(300, 200, 20, { tone: 'b' });",
    "stage.part('Dot', dot, { label: 'Dot', info: 'The dot.' });",
    'inc.onFrame(() => {',
    '  dot.at(shift.value - 20, 0);',
    '});',
    "inc.describe(() => 'A dot shifted ' + shift.value.toFixed(0) + ' px.');",
    'inc.steps([',
    steps,
    ']);',
    '',
  ].join('\n');
}

export function filmReferenceSceneReply(beats: ReadonlyArray<{ readonly say: string }>): string {
  return `\`\`\`html\n<div id='stage'></div>\n\`\`\`\n\`\`\`css\n\n\`\`\`\n\`\`\`js\n${filmReferenceSceneJs(beats)}\`\`\`\n`;
}

/** The slice a scene call was asked for, read back out of its prompt. */
export function filmSliceOf(call: ModelCall): StoryboardScene | null {
  const fenced = /```json\n([\s\S]*?)\n```/.exec(call.prompt.user);
  if (!fenced) return null;
  try {
    return JSON.parse(fenced[1]!) as StoryboardScene;
  } catch {
    return null;
  }
}

/** Spoken lines quoted in a repair prompt's js fragment, in order. */
export function filmSaysOfJs(js: string): string[] {
  return [...js.matchAll(/say:\s*'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]!.replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

export function filmReferenceModel(options: FilmReferenceOptions = {}): ScriptedModel {
  const beatsPerScene = Math.max(1, Math.min(options.beatsPerScene ?? 3, 8));
  let lastBeats: ReadonlyArray<{ readonly say: string }> = [{ say: SAY_LINES[0]! }];

  const script = (call: ModelCall): string => {
    const user = call.prompt.user;
    if (call.purpose === 'plan') {
      const planned = /Plan one film of (\d+) seconds in (\d+) scenes?/.exec(user);
      const lengthTarget = planned ? Number(planned[1]) : 60;
      const preset = filmPresetFor(lengthTarget);
      const request = /The learner asked: "([^"]*)"/.exec(user)?.[1] ?? 'dots shifting';
      const title = `Film about ${request}`.replace(/\s+/g, ' ').trim().slice(0, 120);
      return filmReferenceStoryboard(preset.seconds, preset.scenes, title, beatsPerScene);
    }
    if (call.purpose === 'scene') {
      const slice = filmSliceOf(call);
      const beats = slice?.beats ?? lastBeats;
      lastBeats = beats;
      return filmReferenceSceneReply(beats);
    }
    // A repair: the same figure rebuilt from the spoken lines the prompt quotes.
    const quoted = /```js\n([\s\S]*?)\n```/.exec(user)?.[1] ?? '';
    const says = filmSaysOfJs(quoted);
    const beats = says.length > 0 ? says.map((say) => ({ say })) : lastBeats;
    return `Fixed.\n${filmReferenceSceneReply(beats)}\n`;
  };

  return new ScriptedModel(script, {
    name: 'film-reference',
    ...(options.chunk ? { chunk: options.chunk } : {}),
    ...(options.latencyMs ? { latencyMs: options.latencyMs } : {}),
    models: { plan: 'film-reference-plan', scene: 'film-reference-scene', repair: 'film-reference-repair', ...options.models },
  });
}

import type { ScenePlan } from '@incantly/core';
import { REFERENCE_SCENES, type ReferenceScene } from '@incantly/core/scenes';
import { parsePlanReply } from './fragments';
import { ScriptedModel, type CallPurpose, type ModelCall } from './models';

/**
 * A stand-in model that answers from the reviewed reference scenes, with
 * faults injected on purpose. It exercises every path of the pipeline (plan
 * rejections, validator and probe failures, unreadable replies, repairs that
 * work and repairs that change nothing) without a model or an API key: the
 * pipeline's own tests, the fault-injection gate, and the playground use it.
 * It measures the pipeline, never a model.
 */

export type Fault =
  | 'none'
  /** The first plan has four parameters; the re-plan is fine. */
  | 'bad-plan'
  /** Static faults: the validator rejects the scene. */
  | 'forbidden-call'
  | 'unknown-call'
  | 'colour'
  /** Probe faults: the scene validates but fails a check when it runs. */
  | 'frame-throw'
  | 'non-finite'
  | 'missing-part'
  | 'runaway'
  /** The reply stops in the middle of the script. */
  | 'cut-off';

export const FAULTS: readonly Fault[] = ['bad-plan', 'forbidden-call', 'unknown-call', 'colour', 'frame-throw', 'non-finite', 'missing-part', 'runaway', 'cut-off'];

export interface ReferenceModelOptions {
  /** The fault for each trial, counted from zero by plan requests. */
  readonly fault?: Fault | ((trial: number) => Fault);
  /** Repairs return the broken fragment unchanged, so the generation falls back. */
  readonly stubborn?: boolean | ((trial: number) => boolean);
  readonly latencyMs?: number;
  readonly chunk?: number;
  readonly scenes?: Readonly<Record<string, ReferenceScene>>;
  /** Model names to report; the defaults mark a stand-in that costs nothing. */
  readonly models?: Partial<Record<CallPurpose, string>>;
}

/** Words that pick a concept out of a learner's request. */
const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  'sine-wave': ['sine', 'sinus', 'sin(', 'wave', 'amplitude', 'frequency', 'phase', 'trig', 'periodic', 'oscillat'],
  projectile: ['projectile', 'thrown', 'throw', 'ball', 'cannon', 'launch', 'trajector', 'parabola', 'range', 'gravity', 'vertical velocity', 'horizontal speed'],
  'thin-lens': ['lens', 'focal', 'ray', 'image', 'convex', 'optic', 'magnif', 'refract'],
};

export function conceptFor(text: string, scenes: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES): ReferenceScene | null {
  const lower = text.toLowerCase();
  let best: ReferenceScene | null = null;
  let bestScore = 0;
  for (const scene of Object.values(scenes)) {
    const words = KEYWORDS[scene.id] ?? scene.plan.concept.toLowerCase().split(/\s+/);
    const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = scene;
      bestScore = score;
    }
  }
  return best;
}

function fence(name: string, source: string): string {
  return `\`\`\`${name}\n${source.replace(/\n$/, '')}\n\`\`\``;
}

function sceneReply(html: string, css: string, js: string): string {
  return `${fence('html', html)}\n${fence('css', css)}\n${fence('js', js)}\n`;
}

/**
 * An edit reply turning `before` into `after`: one SEARCH/REPLACE over the
 * lines that differ, with a line of context, or the whole script when the
 * changes are scattered.
 */
export function editReply(before: string, after: string): string {
  if (before === after) return '```edit js\n```\n';
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const removed = a.slice(start, a.length - end);
  const added = b.slice(start, b.length - end);
  if (removed.length > 12 || added.length > 12) return fence('js', after);
  // One line of context, so the SEARCH is never empty and stays unique.
  const before1 = start > 0 ? [a[start - 1]!] : [];
  const search = [...before1, ...removed];
  const replace = [...before1, ...added];
  if (search.length === 0) return `\`\`\`edit js\n<<<<<<< SEARCH\n=======\n${replace.join('\n')}\n>>>>>>> REPLACE\n\`\`\`\n`;
  const occurrences = before.split(search.join('\n')).length - 1;
  if (occurrences !== 1) return fence('js', after);
  return `\`\`\`edit js\n<<<<<<< SEARCH\n${search.join('\n')}\n=======\n${replace.join('\n')}\n>>>>>>> REPLACE\n\`\`\`\n`;
}

/** Injects a fault into a reference scene's script. */
export function faultyScript(scene: ReferenceScene, fault: Fault): string {
  const js = scene.js;
  const frame = /^inc\.onFrame\((.*)=> \{$/m;
  const intoFrame = (lines: string) => {
    if (!frame.test(js)) throw new Error(`${scene.id} has no frame callback to break`);
    return js.replace(frame, (line) => `${line}\n${lines}`);
  };
  switch (fault) {
    case 'forbidden-call':
      return `${js.replace(/\n$/, '')}\nfetch('https://example.com/data.json');\n`;
    case 'unknown-call':
      return `${js.replace(/\n$/, '')}\ninc.plotGraph('#stage', { x: [0, 1] });\n`;
    case 'colour':
      return `${js.replace(/\n$/, '')}\nconst accent = '#ff3300';\n`;
    case 'frame-throw':
      return intoFrame('  const recent = [];\n  recent[2].at(0, 0);');
    case 'non-finite': {
      const param = /^const (\w+) = inc\.param\(/m.exec(js)?.[1];
      const handle = /\.part\('[^']+', ([\w.]+)/.exec(js)?.[1];
      if (!param || !handle) throw new Error(`${scene.id} has no parameter or part to break`);
      return intoFrame(`  ${handle}.set({ opacity: 1 / (${param}.max - ${param}.value) });`);
    }
    case 'missing-part': {
      // Renamed everywhere in the script, so only the plan's list of parts disagrees.
      const name = /\.part\('([^']+)'/.exec(js)?.[1];
      if (!name) throw new Error(`${scene.id} registers no parts`);
      return js.split(`'${name}'`).join(`'${name} (draft)'`);
    }
    case 'runaway':
      return intoFrame('  const queue = [1];\n  for (const item of queue) queue.push(item);');
    default:
      return js;
  }
}

/** The reference plan with a fourth parameter, which the plan validator rejects. */
function overfullPlan(plan: ScenePlan): ScenePlan {
  const extra = { name: 'extra', unit: '', min: 0, max: 1, default: 0.5, why: 'One more control.' };
  return { ...plan, parameters: [...plan.parameters, extra], model: { ...plan.model, inputs: [...plan.model.inputs, 'extra'] } };
}

/** A plan the validator always rejects: the concept has no reviewed scene to stand in for. */
function unsupportedPlan(request: string): Record<string, unknown> {
  return {
    concept: request.slice(0, 60),
    idea: 'This concept has no reviewed figure in the reference model.',
    kind: 'diagram',
    capabilities: ['physics2d'],
    parameters: [],
    model: { inputs: [], outputs: [] },
    parts: ['Thing'],
    moves: 'Nothing.',
    steps: [],
  };
}

export function referenceModel(options: ReferenceModelOptions = {}): ScriptedModel {
  const scenes = options.scenes ?? REFERENCE_SCENES;
  const faultFor = (trial: number): Fault => (typeof options.fault === 'function' ? options.fault(trial) : options.fault ?? 'none');
  const stubbornFor = (trial: number): boolean => (typeof options.stubborn === 'function' ? options.stubborn(trial) : options.stubborn ?? false);
  let trial = -1;

  const script = (call: ModelCall): string => {
    const user = call.prompt.user;
    if (call.purpose === 'plan') {
      const replan = user.includes('Your previous plan was rejected');
      if (!replan) trial++;
      const request = /The learner asked: "([^"]*)"/.exec(user)?.[1] ?? '';
      const scene = conceptFor(request, scenes);
      if (!scene) return fence('json', JSON.stringify(unsupportedPlan(request)));
      const plan = faultFor(trial) === 'bad-plan' && !replan ? overfullPlan(scene.plan) : scene.plan;
      return `Here is the plan.\n${fence('json', JSON.stringify(plan, null, 2))}\n`;
    }
    const planned = parsePlanReply(user).value as { concept?: string } | null;
    const scene = conceptFor(planned?.concept ?? user, scenes) ?? Object.values(scenes)[0]!;
    const fault = faultFor(trial);
    if (call.purpose === 'scene') {
      // Asked for edits to the reviewed scene of the same concept: reply with only the changes.
      const editing = call.prompt.system.some((block) => block.text.startsWith('EDIT format'));
      if (editing) {
        const reply = editReply(scene.js, fault === 'cut-off' ? faultyScript(scene, 'forbidden-call') : faultyScript(scene, fault));
        return fault === 'cut-off' ? reply.slice(0, Math.max(12, Math.floor(reply.length / 2))) : reply;
      }
      if (fault === 'cut-off') {
        const reply = sceneReply(scene.html, scene.css, scene.js);
        return reply.slice(0, reply.indexOf('```js') + Math.floor(scene.js.length / 2));
      }
      return sceneReply(scene.html, scene.css, faultyScript(scene, fault));
    }
    // A repair: the script as reviewed, or the same broken one.
    if (stubbornFor(trial)) return fence('js', faultyScript(scene, fault === 'cut-off' ? 'forbidden-call' : fault));
    return `Fixed.\n${fence('js', scene.js)}\n`;
  };

  return new ScriptedModel(script, {
    name: 'reference',
    ...(options.chunk ? { chunk: options.chunk } : {}),
    ...(options.latencyMs ? { latencyMs: options.latencyMs } : {}),
    models: { plan: 'reference-plan', scene: 'reference-scene', repair: 'reference-repair', ...options.models },
  });
}

import type { ScenePlan } from '@incantly/core';
import { REFERENCE_SCENES, type ReferenceScene } from '@incantly/core/scenes';
import { CAPABILITIES, CORE_CONTRACT, capability, catalogText } from './catalog';
import { SDK_CONTRACT } from './generated/contract';

/**
 * The generation context (SP-1): short core rules and the catalog, always;
 * then, for the scene call, only the SDK declarations the plan needs and the
 * nearest reviewed example. Prompts are split into system blocks so the fixed
 * prefix can be cached by the model provider.
 */

export interface PromptBlock {
  readonly text: string;
  /** Mark the end of a prefix worth caching. */
  readonly cache: boolean;
}

export interface Prompt {
  readonly system: readonly PromptBlock[];
  readonly user: string;
}

/** What the learner asked, and at most a little of the note around it. */
export interface LearnerRequest {
  readonly prompt: string;
  /** Text near the request in the note. Sent to the model only, never stored (see the service's retention rule). */
  readonly noteContext?: string;
}

/** Limits on learner text sent to the model. */
export const REQUEST_LIMITS = { prompt: 500, noteContext: 600 } as const;

export const CORE_RULES = `You write interactive STEM figures for a learner's notes with the Incantly kit. The kit already builds the parameter controls, play and pause, the readout panel, step navigation, the theme and the card around the figure. You choose kit features and configure them; you never build infrastructure.

There are two calls. PLAN: return the plan as one JSON object. BUILD: return three fenced blocks, \`\`\`html, \`\`\`css and \`\`\`js, in that order, and nothing else.

Rules for every scene
1. One model drives everything. Compute every number the learner sees from inc.model. Never type a computed number into a label, readout or sentence.
2. Every adjustable quantity is an inc.param with the plan's name, bounds and default; at most three. Never write inputs, sliders, buttons, listeners, timers or animation loops.
3. Declare everything once, at the top level: params, model, stages, elements, parts, inc.onFrame, inc.readout, inc.explain, inc.describe, inc.steps. Callbacks only update what already exists; never create elements inside them.
4. Build shapes once and move them with at, set, rotate and scale. Rebuild path data only when its shape changes. Keep every shape inside its stage at every parameter value.
5. Animate only from the frame's time and dt. A paused redraw has dt = 0 and must still draw the current state. Every parameter value inside its range, including both ends, must draw without errors, NaN or Infinity; guard the plan's singular points.
6. Colour comes only from tones: lo, mid, hi, lit, faint, a, b, c. Use one lit accent. Never write a colour value.
7. Show the real thing. Write the actual formula in the source with inc.formula or Math; never call a function that is not in the contract. Name quantities with their units. Never fall back to a diagram of boxes, arrows and labels: draw the real mechanism — its actual parts, in their real shape and motion — and treat any box, arrow or label as an addition to that, never a substitute.
8. Register every part the plan names, with exactly that name: stage.part(name, handle, { label, info }).
9. Call inc.idea once with the plan's idea, inc.describe with a function of the model, and inc.steps with the plan's steps: each says one thing, focuses a part and may set parameters.
10. JavaScript is a small subset: const and let, arrow functions, if, switch, the conditional operator, for loops with a visible numeric bound (for (let i = 0; i <= 120; i++)), for...of over arrays, Math (inc.random instead of Math.random), template strings. Never var, function, class, this, new, try, throw, while, regular expressions, window, document, globalThis, fetch, eval or timers.
11. Stay small: under 300 drawn elements, under 500 samples per curve, about 120 lines.
12. HTML is a few plain elements; each stage is a div with an id, usually <div id="stage"></div>. No script, style, svg, img, inputs or inline styles. CSS only lays out that HTML, usually #stage { max-width: 760px; margin: 0 auto; }, with var(--inc-...) tokens and no colours or url().
13. If you are not sure the kit has something, it does not. Use only the catalog and the contract you are given.`;

export const PLAN_FORMAT = `PLAN format. Reply with one JSON object in a \`\`\`json fence:
{
  "concept": "short name of the concept",
  "idea": "One sentence: what moves and what that motion means.",
  "kind": "graph" | "motion" | "diagram",
  "capabilities": ["names from the catalog only; graph2d or svg to draw on"],
  "parameters": [{ "name": "camelCase", "unit": "m/s", "min": 5, "max": 20, "default": 12, "why": "why these bounds teach well" }],
  "model": { "inputs": ["every parameter name"], "outputs": [{ "name": "range", "dependsOn": ["speed", "angle"] }] },
  "parts": ["Named visual parts, at most 8"],
  "moves": "What moves or changes as time passes or parameters change.",
  "steps": ["Two to five teaching steps, one point each"],
  "singularPoints": [{ "parameterName": 8 }]
}
One to three parameters with meaningful bounds; list singular points where the model is undefined inside the bounds, or [] when there are none.`;

export const BUILD_FORMAT = `BUILD format. Reply with exactly three fenced blocks and nothing else:
\`\`\`html
...
\`\`\`
\`\`\`css
...
\`\`\`
\`\`\`js
...
\`\`\``;

/** A rough token count: about 3.5 characters per token for English and code. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** The block every call starts with: the rules and the catalog. Identical across calls, so one cache entry serves all. */
export function coreBlock(): PromptBlock {
  return { text: `${CORE_RULES}\n\nCATALOG\n${catalogText()}`, cache: true };
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** The plan call. A re-plan quotes the rejected plan's problems. */
export function planPrompt(request: LearnerRequest, replan?: { readonly previous: string; readonly problems: string }): Prompt {
  const lines = [`The learner asked: "${clip(request.prompt, REQUEST_LIMITS.prompt)}"`];
  if (request.noteContext) lines.push(`Text near the request in their note: "${clip(request.noteContext, REQUEST_LIMITS.noteContext)}"`);
  lines.push('Plan one figure that teaches this.');
  if (replan) {
    lines.push('', 'Your previous plan was rejected:', replan.previous, '', 'Problems:', replan.problems, '', 'Return a corrected plan.');
  }
  return { system: [coreBlock(), { text: PLAN_FORMAT, cache: true }], user: lines.join('\n') };
}

/** The declarations of the SDK contract a plan needs, in a stable order. */
export function contractFor(capabilities: readonly string[]): string {
  const names: string[] = [...CORE_CONTRACT];
  for (const entry of CAPABILITIES) {
    if (!capabilities.includes(entry.name)) continue;
    for (const name of entry.contract) if (!names.includes(name)) names.push(name);
  }
  return names
    .map((name) => SDK_CONTRACT[name])
    .filter((text): text is string => typeof text === 'string')
    .join('\n\n');
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/(ing|es|s)$/, '')),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * The reviewed example closest to a plan: its concept and idea first, then
 * the kit features it shares. `withhold` leaves examples out, as leak-free
 * evals do with a concept's own example.
 */
export function nearestExample(
  plan: Pick<ScenePlan, 'concept' | 'idea' | 'capabilities'>,
  options: { readonly withhold?: readonly string[]; readonly examples?: Readonly<Record<string, ReferenceScene>> } = {},
): ReferenceScene | null {
  const examples = Object.values(options.examples ?? REFERENCE_SCENES).filter((e) => !options.withhold?.includes(e.id));
  const concept = words(`${plan.concept} ${plan.idea}`);
  const features = new Set(plan.capabilities);
  let best: ReferenceScene | null = null;
  let bestScore = -1;
  for (const example of examples) {
    const shared = example.plan.capabilities.filter((c) => features.has(c)).length / Math.max(1, example.plan.capabilities.length);
    const score = 2 * overlap(concept, words(`${example.plan.concept} ${example.plan.idea}`)) + shared;
    if (score > bestScore || (score === bestScore && best && example.id < best.id)) {
      best = example;
      bestScore = score;
    }
  }
  return best;
}

function exampleText(example: ReferenceScene): string {
  return [
    `REVIEWED EXAMPLE: ${example.plan.concept}. A finished scene for another request: follow its style and its use of the kit, not its content.`,
    'Its plan:',
    JSON.stringify(example.plan),
    '```html',
    example.html.trim(),
    '```',
    '```css',
    example.css.trim(),
    '```',
    '```js',
    example.js.trim(),
    '```',
  ].join('\n');
}

export interface ScenePromptOptions {
  /** Examples left out, by id. */
  readonly withhold?: readonly string[];
  readonly examples?: Readonly<Record<string, ReferenceScene>>;
}

/** The scene call: the plan, the contract it needs, and the nearest reviewed example. */
export function scenePrompt(plan: ScenePlan, options: ScenePromptOptions = {}): { readonly prompt: Prompt; readonly example: string | null } {
  const example = nearestExample(plan, options);
  const reference = [
    BUILD_FORMAT,
    'CONTRACT. The kit API your scene may use, as TypeScript declarations; the scene itself is plain JavaScript.',
    '```ts',
    contractFor(plan.capabilities),
    '```',
    ...(example ? [exampleText(example)] : []),
  ].join('\n');
  const user = ['Build the scene for this plan.', '```json', JSON.stringify(plan, null, 2), '```'].join('\n');
  return { prompt: { system: [coreBlock(), { text: reference, cache: true }], user }, example: example?.id ?? null };
}

/** Catalog lines for the capabilities a plan uses, for repair requests. */
export function catalogLines(capabilities: readonly string[]): string {
  return capabilities
    .map((name) => capability(name))
    .filter((c) => c !== undefined)
    .map((c) => `- ${c.line}`)
    .join('\n');
}

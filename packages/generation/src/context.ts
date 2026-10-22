import { SIZE_BUDGETS, type ScenePlan } from '@incantly/core';
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

export const CORE_RULES = `You write interactive STEM figures for a learner's notes with the Incantly kit. The kit already builds controls, play and pause, readouts, steps, legends, zoom, dragging, the card and the theme. You pick kit features and configure them; you never build infrastructure.

There are two calls. PLAN: reply with the plan as one JSON object. BUILD: reply with three fenced blocks, html, css and js, and nothing else.

Rules for every scene
1. One model drives everything. Compute every number the learner sees; never type a computed number into a label, readout or sentence.
2. The controls are the plan's parameters, with its names, bounds and defaults: inc.param for a slider, inc.toggle or inc.choice where the plan says so. Never write inputs, listeners, timers or animation loops.
3. Declare everything once, at the top level: controls, model, stages, elements, parts and callbacks. Callbacks only update what already exists; never create elements inside them.
4. Build shapes once and move them with at, set, rotate and scale. Stage units work like pixels (text is 12 units tall), so give a stage a viewBox a few hundred units wide and scale the model to it. Keep every shape inside its stage at every parameter value. Let the learner touch the figure: when moving the main object would change a parameter, make it draggable (graph.handle, graph.drag, stage.drag, draggable bodies).
5. Animate only from frame.time and frame.dt. A paused redraw (dt = 0) still draws the current state. Every value in range, both ends included, must draw without NaN; guard the plan's singular points.
6. Colour comes only from tones: lo, mid, hi, lit, faint, a, b, c, water. Water is for liquids. Use one lit accent. Never write a colour value.
7. Show the real thing: the actual formula and true units, with the kit's helpers (calc, vec, units, shapes, sym, chem) instead of your own. A law worth seeing in the drawing goes in stage.equation, which draws it as maths. Never call anything that is not in the contract.
8. Register every part the plan names, with exactly that name, through part() on its stage or kit.
9. Call inc.idea once with the plan's idea, inc.describe with a function of the model, and inc.steps with the plan's steps.
10. JavaScript is a small subset: const and let, arrow functions, if, switch, the conditional operator, for loops with a visible numeric bound (for (let i = 0; i <= 120; i++)), for...of, Math (inc.random instead of Math.random), template strings. Never var, function, class, this, new, try, throw, while, regular expressions, window, document, globalThis, fetch, eval or timers.
11. Write little and let the kit do the work (a 3D prop is one space.model call): a quick figure is about ${SIZE_BUDGETS.quick.lines} lines, standard ${SIZE_BUDGETS.standard.lines}, rich ${SIZE_BUDGETS.rich.lines}; under 500 samples per curve.
12. HTML is one div per stage with an id, usually <div id="stage"></div>, and nothing else. CSS only lays it out, usually #stage { max-width: 760px; margin: 0 auto; }, with var(--inc-...) tokens and no colours or url(). Two panels, such as a scene beside its graph: one div each and inc.layout('row'), no CSS for it.
13. If you are not sure the kit has something, it does not. Use only the catalog and the contract you are given.`;

export const PLAN_FORMAT = `PLAN format. Reply with one JSON object in a \`\`\`json fence; keep every text short:
{
  "concept": "short name of the concept",
  "idea": "One sentence: what moves and what that motion means.",
  "kind": "graph" | "motion" | "diagram",
  "size": "quick" | "standard" | "rich",
  "capabilities": ["catalog names only; at least one stage: graph2d, svg, space3d, graph3d, physics2d, chart or flow"],
  "parameters": [{ "name": "camelCase", "unit": "m/s", "min": 5, "max": 20, "default": 12, "why": "a few words on these bounds" }],
  "model": { "inputs": ["every parameter name"], "outputs": [{ "name": "range", "dependsOn": ["speed", "angle"] }] },
  "parts": ["things drawn in the figure that steps point at; never readouts, sliders, buttons or formulas, which the kit shows itself"],
  "moves": "What moves or changes.",
  "steps": ["Two to five teaching steps, one point each"],
  "singularPoints": [{ "parameterName": 8 }]
}
Sizes: quick (the default: one view, up to ${SIZE_BUDGETS.quick.controls} controls and ${SIZE_BUDGETS.quick.parts} parts), standard (a second view, such as a graph beside the scene: up to ${SIZE_BUDGETS.standard.controls} controls and ${SIZE_BUDGETS.standard.parts} parts), rich (several linked panels, only when the learner asks for that much: up to ${SIZE_BUDGETS.rich.controls} controls and ${SIZE_BUDGETS.rich.parts} parts).
A parameter is a slider unless it says "control": "toggle" (min 0, max 1) or "control": "choice" with "options": ["first", "second"] (min 0, max one less than the options).
List singular points where the model is undefined inside the bounds, or [] when there are none.
Concepts with a reviewed figure: ${reviewedConcepts().join(', ')}. When the request is one of these, use that name exactly as the concept.`;

/** The concepts that have a reviewed scene; a plan that reuses one of these names starts from that scene. */
export function reviewedConcepts(examples: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES): string[] {
  return [...new Set(Object.values(examples).map((e) => e.plan.concept))].sort();
}

export const BUILD_FORMAT = `BUILD format. This is the BUILD call: the plan is settled. Reply with exactly three fenced blocks, html, css and js, in that order, and nothing else: no plan, no JSON, no prose.
\`\`\`html
...
\`\`\`
\`\`\`css
...
\`\`\`
\`\`\`js
...
\`\`\``;

/** Asking only for differences from a reviewed scene of the same concept (PRD 25.5). */
export const EDIT_FORMAT = `EDIT format. You start from the reviewed scene below, written for this concept. Change only what this plan needs: its names, bounds, defaults, parts, steps and idea. Reply with edit blocks only, one per fragment you change:
\`\`\`edit js
<<<<<<< SEARCH
a few whole lines copied exactly from the starting scene
=======
what replaces them
>>>>>>> REPLACE
\`\`\`
A block may hold several SEARCH/REPLACE pairs, applied in order; each SEARCH must match one place. If nothing needs to change, reply with an empty \`\`\`edit js block. If a fragment needs rewriting, reply with it whole in its usual \`\`\`js (or html, css) block instead.`;

/** Starting from the reviewed scene a request names, before any plan (PRD 25.5). */
export const LIBRARY_FORMAT = `LIBRARY format. The reviewed scene below already teaches this concept well. Change it only as far as the learner's request needs: often a default, a step, a preset or a label; often nothing at all. Reply with edit blocks only, as in the EDIT format, or with an empty \`\`\`edit js block when the scene already answers the request. Keep its parameter and part names and its number of steps. Only if the request needs a different parameter, part or number of steps, add the whole updated plan in a \`\`\`json block after the edits.`;

/** Changing a figure the learner already has, as they ask (HO-8). */
export const CHANGE_FORMAT = `CHANGE format. The figure below is in the learner's note and works. Make the change the learner asks for, and only that: keep everything the change does not touch as it is, names, steps and wording included. Reply with edit blocks only, as in the EDIT format. If the change needs another parameter, part or number of steps, also add the whole updated plan in a \`\`\`json block after the edits, and keep the scene and its plan in step. If this kit cannot make the change, reply with an empty \`\`\`edit js block.`;

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
  /** Start from a reviewed scene of the same concept, asking only for differences (default true). */
  readonly adapt?: boolean;
}

export interface ScenePrompt {
  readonly prompt: Prompt;
  /** The example shown, by id. */
  readonly example: string | null;
  /** 'adapt': the reply edits `start`; 'write': the reply is the whole scene. */
  readonly mode: 'write' | 'adapt';
  readonly start: ReferenceScene | null;
}

function sizeLine(plan: ScenePlan): string {
  const size = plan.size ?? 'quick';
  const budget = SIZE_BUDGETS[size];
  return `Size: ${size}, about ${budget.lines} lines, at most ${budget.controls} controls and ${budget.elements} drawn elements.`;
}

/** The reviewed scene for the same concept, when there is one this plan can start from. */
export function startingScene(plan: ScenePlan, options: ScenePromptOptions = {}): ReferenceScene | null {
  if (options.adapt === false) return null;
  const examples = Object.fromEntries(Object.entries(options.examples ?? REFERENCE_SCENES).filter(([id]) => !options.withhold?.includes(id)));
  const same = standardFigure(plan.concept, examples);
  if (!same) return null;
  // Starting from a scene drawn on another kind of stage would mean rewriting it.
  const stages = (capabilities: readonly string[]) => capabilities.filter((c) => capability(c)?.draws);
  const shared = stages(same.plan.capabilities).some((c) => plan.capabilities.includes(c));
  return shared ? same : null;
}

/**
 * The scene call: the plan, the contract it needs and either a reviewed
 * scene of the same concept to adapt by edits, or the nearest reviewed
 * example to follow while writing the scene whole.
 */
export function scenePrompt(plan: ScenePlan, options: ScenePromptOptions = {}): ScenePrompt {
  const start = startingScene(plan, options);
  const contract = ['CONTRACT. The kit API your scene may use, as TypeScript declarations; the scene itself is plain JavaScript.', '```ts', contractFor(plan.capabilities), '```'];
  const planText = ['```json', JSON.stringify(plan, null, 2), '```'].join('\n');
  if (start) {
    // The starting scene sits in the cached prefix: requests for the same concept share it.
    const reference = [
      EDIT_FORMAT,
      ...contract,
      `THE STARTING SCENE: reviewed, for ${start.plan.concept}. Its plan:`,
      JSON.stringify(start.plan),
      ...(['html', 'css', 'js'] as const).flatMap((name) => ['```' + name, start[name].trim(), '```']),
    ].join('\n');
    const user = ['Adapt the starting scene to this plan.', planText, sizeLine(plan)].join('\n');
    return { prompt: { system: [coreBlock(), { text: reference, cache: true }], user }, example: start.id, mode: 'adapt', start };
  }
  const example = nearestExample(plan, options);
  const reference = [BUILD_FORMAT, ...contract, ...(example ? [exampleText(example)] : [])].join('\n');
  const user = ['Build the scene for this plan.', planText, sizeLine(plan)].join('\n');
  return { prompt: { system: [coreBlock(), { text: reference, cache: true }], user }, example: example?.id ?? null, mode: 'write', start: null };
}

/**
 * The library call: the reviewed scene a request names, adapted to the
 * request itself, with no plan to wait for. The system blocks are the same
 * for every request about this concept, so their prefix is cached across
 * learners; only the request is new.
 */
export function libraryPrompt(scene: ReferenceScene, request: LearnerRequest): Prompt {
  const reference = [
    EDIT_FORMAT,
    LIBRARY_FORMAT,
    'CONTRACT. The kit API your scene may use, as TypeScript declarations; the scene itself is plain JavaScript.',
    '```ts',
    contractFor(scene.plan.capabilities),
    '```',
    `THE REVIEWED SCENE: ${scene.plan.concept}. Its plan:`,
    JSON.stringify(scene.plan),
    ...(['html', 'css', 'js'] as const).flatMap((name) => ['```' + name, scene[name].trim(), '```']),
  ].join('\n');
  const lines = [`The learner asked: "${clip(request.prompt, REQUEST_LIMITS.prompt)}"`];
  if (request.noteContext) lines.push(`Text near the request in their note: "${clip(request.noteContext, REQUEST_LIMITS.noteContext)}"`);
  lines.push('Adapt the reviewed scene to this request, changing only what it needs.');
  return { system: [coreBlock(), { text: reference, cache: true }], user: lines.join('\n') };
}

/**
 * The change call (HO-8): the learner's figure as it stands, its plan, the
 * contract it uses, and the change they asked for. The reply is edits, so a
 * change costs a few lines of output, not a new figure.
 */
export function changePrompt(plan: ScenePlan, fragments: { readonly html: string; readonly css: string; readonly js: string }, request: LearnerRequest): Prompt {
  const reference = [
    EDIT_FORMAT,
    CHANGE_FORMAT,
    'CONTRACT. The kit API your scene may use, as TypeScript declarations; the scene itself is plain JavaScript.',
    '```ts',
    contractFor(plan.capabilities),
    '```',
    `THE FIGURE AS IT STANDS: ${plan.concept}. Its plan:`,
    JSON.stringify(plan),
    ...(['html', 'css', 'js'] as const).flatMap((name) => ['```' + name, fragments[name].trim(), '```']),
  ].join('\n');
  const lines = [`The learner wants this change: "${clip(request.prompt, REQUEST_LIMITS.prompt)}"`];
  if (request.noteContext) lines.push(`Text near the figure in their note: "${clip(request.noteContext, REQUEST_LIMITS.noteContext)}"`);
  lines.push('Make this change to the figure, and nothing else.');
  return { system: [coreBlock(), { text: reference, cache: true }], user: lines.join('\n') };
}

/** Catalog lines for the capabilities a plan uses, for repair requests. */
export function catalogLines(capabilities: readonly string[]): string {
  return capabilities
    .map((name) => capability(name))
    .filter((c) => c !== undefined)
    .map((c) => `- ${c.line}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// The reviewed scene of the same concept: the starting point for edits, and
// the second rung of the fallback ladder
// ---------------------------------------------------------------------------

function conceptWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/(es|s)$/, '')),
  );
}

/**
 * The reviewed figure for the same concept, if there is one: the second rung
 * of the fallback ladder (RP-9). Unlike the nearest example in the context, it
 * must be the same concept, not merely a similar scene.
 */
export function standardFigure(concept: string, examples: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES): ReferenceScene | null {
  const wanted = conceptWords(concept);
  let best: ReferenceScene | null = null;
  let bestScore = 0;
  for (const example of Object.values(examples)) {
    const words = conceptWords(`${example.plan.concept} ${example.id.replace(/-/g, ' ')}`);
    let shared = 0;
    for (const w of wanted) if (words.has(w)) shared++;
    const score = wanted.size === 0 ? 0 : shared / Math.min(wanted.size, conceptWords(example.plan.concept).size);
    if (score > bestScore) {
      best = example;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

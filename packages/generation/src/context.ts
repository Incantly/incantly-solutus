import { SIZE_BUDGETS, type ScenePlan } from '@incantly/core';
import { REFERENCE_SCENES, type ReferenceScene } from '@incantly/core/scenes';
import { CAPABILITIES, CORE_CONTRACT, capability, catalogText } from './catalog';
import { SDK_CONTRACT } from './generated/contract';
import { STOP_WORDS } from './words';

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
2. The controls are the plan's parameters, with its names, bounds and defaults: inc.param for a slider, inc.toggle or inc.choice where the plan says so. Never write inputs, listeners, timers or animation loops. Declare each control above whatever names it, such as a formula, spelled exactly.
3. Declare everything once, at the top level: controls, model, stages, elements, parts and callbacks. Callbacks only update what already exists; never create elements inside them.
4. Build shapes once and move them with at, set, rotate and scale. Stage units work like pixels (text is 12 units tall), so give a stage a viewBox a few hundred units wide and scale the model to it, or use fit: true to frame a real object. Keep every shape inside its stage at every parameter value. Let the learner touch the figure: when moving the main object would change a parameter, make it draggable (graph.handle, graph.drag, stage.drag, draggable bodies).
5. Animate only from frame.time and frame.dt. A paused redraw (dt = 0) still draws the current state, and moving any control while paused changes the drawing at once, even before time has run: draw what it sets, such as a length, an arrow's size or a label. Every value in range, both ends included, must draw without NaN; guard the plan's singular points.
6. Colour comes only from tones: lo, mid, hi, lit, faint, a, b, c, water. Water is for liquids. Use one lit accent. Never write a colour value.
7. Show the real thing: the actual formula and true units, with the kit's helpers (calc, vec, units, shapes, sym, chem) instead of your own. A law worth seeing goes in stage.equation, drawn as maths. Never call anything that is not in the contract. Draw the real mechanism in its real shape and motion, on the whole object the learner names, so it is recognisable; boxes, arrows and labels only add to it. Build a construction (tiling, chain, spiral) piece by piece in the model, each piece against the one before.
8. Register every part the plan names, with exactly that name, through part() on its stage or kit.
9. Call inc.idea once with the plan's idea, inc.describe with a function of the model, and inc.steps with the plan's steps.
10. JavaScript is a small subset: const and let, arrow functions, if, switch, the conditional operator, for loops with a numeric bound written in the loop (i <= 120, or i <= Math.min(n, 120) when the count varies), for...of, Math (inc.random instead of Math.random), template strings. The only globals are inc, Math, Number, isFinite and isNaN: write \`\${x}\` instead of String(x). Never var, function, class, this, new, void, try, throw, while, regular expressions, window, document, globalThis, fetch, eval or timers.
11. Write little and let the kit do the work (a 3D prop is one space.model call): a quick figure is about ${SIZE_BUDGETS.quick.lines} lines, standard ${SIZE_BUDGETS.standard.lines}, rich ${SIZE_BUDGETS.rich.lines}; under 500 samples per curve.
12. HTML is one div per stage with an id, usually <div id="stage"></div>, and nothing else. CSS only lays it out, usually #stage { max-width: 760px; margin: 0 auto; }, with var(--inc-...) tokens and no colours or url(). Two panels: one div each and inc.layout('row'), no CSS for it.
13. If you are not sure the kit has something, it does not. Use only the catalog and the contract you are given.`;

/**
 * The plan's format. Every plan token is time the learner waits before the
 * scene call can start (PRD 16.1: about 150 tokens out), so the JSON is
 * compact, the prose is a few words, and quick is the size to pick.
 */
export const PLAN_FORMAT = `PLAN format. Reply with one compact JSON object in a \`\`\`json fence: no indentation, no line breaks inside it. Every word is time the learner waits, so write few: the idea under 25 words, each why 2 to 5 words, moves under 12 words, each step under 14 words.
{"concept":"short name of the concept","idea":"One sentence: what moves and what that motion means.","kind":"graph"|"motion"|"diagram","size":"quick"|"standard"|"rich","capabilities":["catalog names only; at least one stage: ${stageNames()}"],"parameters":[{"name":"camelCase","unit":"m/s","min":5,"max":20,"default":12,"why":"typical throwing speeds"}],"model":{"inputs":["every parameter name"],"outputs":[{"name":"range","dependsOn":["speed","angle"]}]},"parts":["ball","cannon"],"moves":"What moves or changes.","steps":["Two to four teaching steps, one point each"],"singularPoints":[]}
Sizes: quick (one view, up to ${SIZE_BUDGETS.quick.controls} controls and ${SIZE_BUDGETS.quick.parts} parts) when there is one thing to see, and its figure arrives soonest; standard (a second view, such as a graph beside the scene: up to ${SIZE_BUDGETS.standard.controls} controls and ${SIZE_BUDGETS.standard.parts} parts) when the learner asks to see several things or one view cannot show them all; rich (several linked panels, up to ${SIZE_BUDGETS.rich.controls} controls and ${SIZE_BUDGETS.rich.parts} parts) only when the learner asks for that much.
A parameter is a slider unless it says "control": "toggle" (min 0, max 1) or "control": "choice" with "options": ["first", "second"] (min 0, max one less than the options).
Parts are things drawn in the figure that steps point at, each named in a few words (under 40 characters): every thing the learner asks to see, and, when the learner names an object (a bicycle, a heart, an engine), that object whole with its frame, body or case, so the figure looks like the real thing; never readouts, sliders, buttons or formulas, which the kit shows itself. Capabilities include the helpers that draw those parts' real shapes, such as shapes for gears and belts and path for arcs.
Give every parameter meaningful bounds. Each model output's dependsOn names model inputs or other outputs; time is not an input, and a constant such as π or φ is not an output.
List only singular points that fall inside the declared parameter bounds, using the actual parameter name as the key, for example [{ "objectDistance": 8 }]. If an undefined value is outside the allowed range, it is not a singular point for this figure; return [] when there are none.
Be concise and return only the fenced JSON, with no explanation before or after it.
Concepts with a reviewed figure, and the stage it is drawn on: ${reviewedFigures().join('; ')}. When the request is one of these, use that name exactly as the concept, and that stage unless the learner asks for another kind of figure.`;

/** The concepts that have a reviewed scene; a plan that reuses one of these names starts from that scene. */
export function reviewedConcepts(examples: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES): string[] {
  return [...new Set(Object.values(examples).map((e) => e.plan.concept))].sort();
}

/**
 * Each reviewed concept with the capabilities that draw its scene. A plan
 * that names the concept but another stage writes the scene whole, as the
 * reviewed one cannot be adapted onto a different stage; with the stage
 * named, a plan picks it unless the learner wants another kind of figure.
 */
export function reviewedFigures(examples: Readonly<Record<string, ReferenceScene>> = REFERENCE_SCENES): string[] {
  const figures = new Map<string, string>();
  for (const e of Object.values(examples)) figures.set(e.plan.concept, `${e.plan.concept} (${e.plan.capabilities.filter((c) => capability(c)?.draws).join(', ')})`);
  return [...figures.values()].sort();
}

/** The capabilities that draw a stage, as the plan format lists them. */
function stageNames(): string {
  const names = CAPABILITIES.filter((c) => c.draws).map((c) => c.name);
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
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
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
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
 * The reviewed example closest to a plan: one drawn on the same kind of
 * stage first, as a scene follows its example's use of the kit; then its
 * concept and idea; then the kind of figure and the other features it
 * shares. A scene follows its example's length too, and every line of it is
 * time the learner waits, so between otherwise close examples the shorter
 * one wins. `withhold` leaves examples out, as leak-free evals do with a
 * concept's own example.
 */
export function nearestExample(
  plan: Pick<ScenePlan, 'concept' | 'idea' | 'capabilities'> & Partial<Pick<ScenePlan, 'kind'>>,
  options: { readonly withhold?: readonly string[]; readonly examples?: Readonly<Record<string, ReferenceScene>> } = {},
): ReferenceScene | null {
  const examples = Object.values(options.examples ?? REFERENCE_SCENES).filter((e) => !options.withhold?.includes(e.id));
  const concept = words(`${plan.concept} ${plan.idea}`);
  const draws = (name: string) => capability(name)?.draws === true;
  const stages = new Set(plan.capabilities.filter(draws));
  const features = new Set(plan.capabilities.filter((c) => !draws(c)));
  let best: ReferenceScene | null = null;
  let bestScore = -1;
  for (const example of examples) {
    // An Ohm's law circuit drawn in SVG learns nothing from a membrane drawn with the biology kit, however close the words.
    const stage = example.plan.capabilities.some((c) => stages.has(c)) ? 3 : 0;
    const shared = example.plan.capabilities.filter((c) => features.has(c)).length / Math.max(1, features.size);
    // A graph follows a graph and a mechanism a moving scene, more than any shared helper.
    const kind = plan.kind !== undefined && example.plan.kind === plan.kind ? 1 : 0;
    // 0.25 per hundred lines: enough to choose between near ties, never to outweigh the stage, the words or the kind.
    const length = 0.25 * (example.js.split('\n').length / 100);
    const score = stage + 2 * overlap(concept, words(`${example.plan.concept} ${example.plan.idea}`)) + kind + 0.5 * shared - length;
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
  // The scene call streams at about a hundred and fifty tokens a second: its length is the learner's wait.
  return `Size: ${size}: js about ${budget.lines} lines, at most ${budget.controls} controls and ${budget.elements} drawn elements. No comments, no blank lines.`;
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
  const planText = ['```json', JSON.stringify(plan), '```'].join('\n');
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
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
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

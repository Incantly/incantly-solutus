import { INC_FUNCTIONS, SCENE_SIZES, SIZE_BUDGETS, type ControlKind, type PlanOutput, type PlanParameter, type SceneKind, type ScenePlan, type SceneSize, type SingularPoint } from '@incantly/core';
import { CAPABILITIES, capability, capabilityNames } from './catalog';

/**
 * The plan validator (PL-1, PL-2). The plan is the model's first, small reply:
 * what the figure teaches and which kit features it needs. It is checked in
 * milliseconds, before the expensive scene call, against a fixed schema and
 * the rules below. A rejected plan is re-planned with these problems, never
 * repaired as code.
 */

export type PlanRule =
  | 'schema'
  | 'unknown-capability'
  | 'no-stage'
  | 'no-params'
  | 'too-many-params'
  | 'invalid-bounds'
  | 'missing-justification'
  | 'duplicate-name'
  | 'unknown-input'
  | 'unused-parameter'
  | 'unreachable-output'
  | 'unclear-idea'
  | 'too-many-parts'
  | 'too-many-steps';

export interface PlanProblem {
  readonly rule: PlanRule;
  /** Where in the plan, e.g. `parameters[1].max`. */
  readonly path: string;
  readonly message: string;
}

export interface PlanValidation {
  readonly ok: boolean;
  /** The normalized plan, when there are no problems. */
  readonly plan: ScenePlan | null;
  readonly problems: readonly PlanProblem[];
}

/** Limits for the default size, quick; a standard or rich plan may have more controls and parts (SIZE_BUDGETS). */
export const PLAN_LIMITS = {
  params: SIZE_BUDGETS.quick.controls,
  parts: SIZE_BUDGETS.quick.parts,
  steps: 5,
  choiceOptions: 8,
  ideaMin: 20,
  ideaMax: 240,
  ideaWords: 6,
  concept: 80,
  name: 40,
  unit: 24,
  text: 300,
} as const;

const KINDS: readonly SceneKind[] = ['graph', 'motion', 'diagram'];
/** Parameter and output names become JavaScript names in the scene. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

type Problems = PlanProblem[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown, path: string, max: number, problems: Problems, required = true): string | null {
  if (value === undefined || value === null) {
    if (required) problems.push({ rule: 'schema', path, message: `${path} is required` });
    return null;
  }
  if (typeof value !== 'string') {
    problems.push({ rule: 'schema', path, message: `${path} must be a string` });
    return null;
  }
  const text = value.trim().replace(/\s+/g, ' ');
  if (required && text === '') {
    problems.push({ rule: 'schema', path, message: `${path} must not be empty` });
    return null;
  }
  if (text.length > max) {
    problems.push({ rule: 'schema', path, message: `${path} is longer than ${max} characters` });
    return null;
  }
  return text;
}

/**
 * Prose that only guides the scene call (moves, why, steps) is clipped rather
 * than rejected: a re-plan costs a whole model call, and a long sentence is
 * not wrong.
 */
function readProse(value: unknown, path: string, max: number, problems: Problems, required = true): string | null {
  if (typeof value === 'string' && value.trim().replace(/\s+/g, ' ').length > max) {
    const text = value.trim().replace(/\s+/g, ' ');
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`;
  }
  return readText(value, path, max, problems, required);
}

/**
 * A name the scene can use as a JavaScript identifier: "equivalence volume (mL)"
 * becomes equivalenceVolume. Units in brackets are dropped.
 */
export function identifierFrom(text: string): string | null {
  const words = text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  const [first, ...rest] = words;
  let name = first!.length > 1 && first === first!.toUpperCase() ? first! : first!.charAt(0).toLowerCase() + first!.slice(1);
  for (const word of rest) name += word.charAt(0).toUpperCase() + word.slice(1);
  if (!/^[A-Za-z]/.test(name)) name = `v${name}`;
  return name.slice(0, 40);
}

function readNumber(value: unknown, path: string, problems: Problems): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push({ rule: 'invalid-bounds', path, message: `${path} must be a finite number` });
    return null;
  }
  return value;
}

function readList(value: unknown, path: string, problems: Problems): unknown[] | null {
  if (!Array.isArray(value)) {
    problems.push({ rule: 'schema', path, message: `${path} must be a list` });
    return null;
  }
  return value;
}

/** Why an idea sentence does not say what the figure teaches, or null when it does. */
export function unclearIdea(idea: string): string | null {
  if (idea.length < PLAN_LIMITS.ideaMin) return `it is shorter than ${PLAN_LIMITS.ideaMin} characters`;
  if (idea.length > PLAN_LIMITS.ideaMax) return `it is longer than ${PLAN_LIMITS.ideaMax} characters`;
  if (idea.trim().endsWith('?')) return 'it is a question; say what the figure shows';
  // A sentence ends, and another begins, inside it.
  if (/[.!?]\s+["'(]?[A-Z]/.test(idea)) return 'it is more than one sentence';
  if (idea.split(/\s+/).filter(Boolean).length < PLAN_LIMITS.ideaWords) return 'it has too few words to teach anything';
  return null;
}

/** A parameter's control: a slider unless the plan says toggle, or choice with its options. */
function readControl(raw: Record<string, unknown>, path: string, problems: Problems): { kind: ControlKind; options: string[] } {
  const kind = raw.control === undefined ? 'slider' : raw.control;
  if (kind !== 'slider' && kind !== 'toggle' && kind !== 'choice') {
    problems.push({ rule: 'schema', path: `${path}.control`, message: `${path}.control must be "slider", "toggle" or "choice"` });
    return { kind: 'slider', options: [] };
  }
  if (kind !== 'choice') return { kind, options: [] };
  const list = Array.isArray(raw.options) ? raw.options : null;
  const options = (list ?? []).filter((o): o is string => typeof o === 'string' && o.trim() !== '').map((o) => o.trim().slice(0, PLAN_LIMITS.name));
  if (!list || options.length < 2 || options.length > PLAN_LIMITS.choiceOptions || options.length !== list.length || new Set(options).size !== options.length) {
    problems.push({ rule: 'schema', path: `${path}.options`, message: `A choice needs "options": from 2 to ${PLAN_LIMITS.choiceOptions} different, short names` });
  }
  return { kind, options };
}

/** The well-formed parameters, and the names of all of them, so one bad number does not hide a name. */
function readParameters(value: unknown, problems: Problems, renames: Map<string, string>, size: SceneSize): { parameters: PlanParameter[]; names: Set<string> } {
  const seen = new Set<string>();
  const list = readList(value, 'parameters', problems);
  if (!list) return { parameters: [], names: seen };
  if (list.length === 0) problems.push({ rule: 'no-params', path: 'parameters', message: 'A figure needs at least one parameter the learner can change' });
  const allowed = SIZE_BUDGETS[size].controls;
  if (list.length > allowed) {
    problems.push({
      rule: 'too-many-params',
      path: 'parameters',
      message: `The plan has ${list.length} parameters; a ${size} figure has at most ${allowed}. Keep the ones that teach the idea${size === 'rich' ? '' : ', or make it a larger size if the learner asked for that much'}`,
    });
  }
  const out: PlanParameter[] = [];
  list.forEach((raw, i) => {
    const path = `parameters[${i}]`;
    if (!isRecord(raw)) {
      problems.push({ rule: 'schema', path, message: `${path} must be an object` });
      return;
    }
    const written = readText(raw.name, `${path}.name`, PLAN_LIMITS.name, problems);
    let name = written;
    if (written !== null && !IDENTIFIER.test(written)) {
      const fixed = identifierFrom(written);
      if (fixed && IDENTIFIER.test(fixed)) {
        renames.set(written, fixed);
        name = fixed;
      } else {
        problems.push({ rule: 'schema', path: `${path}.name`, message: `"${written}" must be a name like launchSpeed: a letter, then letters or digits` });
      }
    }
    if (name !== null && seen.has(name)) problems.push({ rule: 'duplicate-name', path: `${path}.name`, message: `Two parameters are called "${name}"` });
    if (name !== null) seen.add(name);
    const unit = readText(raw.unit, `${path}.unit`, PLAN_LIMITS.unit, problems, false);
    const control = readControl(raw, path, problems);
    // A toggle runs from 0 to 1 and a choice over its options: their bounds follow, whatever the plan wrote.
    let min = control.kind === 'slider' ? readNumber(raw.min, `${path}.min`, problems) : 0;
    let max = control.kind === 'slider' ? readNumber(raw.max, `${path}.max`, problems) : control.kind === 'toggle' ? 1 : Math.max(1, control.options.length - 1);
    let fallback = control.kind === 'slider' ? readNumber(raw.default, `${path}.default`, problems) : Math.round(typeof raw.default === 'number' && Number.isFinite(raw.default) ? raw.default : 0);
    if (control.kind !== 'slider') {
      fallback = Math.min(max!, Math.max(0, fallback ?? 0));
      min = 0;
      max = max!;
    }
    if (min !== null && max !== null && !(min < max)) {
      problems.push({ rule: 'invalid-bounds', path, message: `${name ?? path}: min (${min}) must be less than max (${max})` });
    } else if (min !== null && max !== null && fallback !== null && (fallback < min || fallback > max)) {
      problems.push({ rule: 'invalid-bounds', path: `${path}.default`, message: `${name ?? path}: the default ${fallback} lies outside ${min} to ${max}` });
    }
    const why = readProse(raw.why, `${path}.why`, PLAN_LIMITS.text, problems, false);
    if (!why && control.kind === 'slider') {
      problems.push({
        rule: 'missing-justification',
        path: `${path}.why`,
        message: `${name ?? path}: say in a few words why these bounds are physically or mathematically meaningful`,
      });
    }
    if (name !== null && min !== null && max !== null && fallback !== null) {
      out.push({
        name,
        ...(unit ? { unit } : {}),
        min,
        max,
        default: fallback,
        why: why ?? '',
        ...(control.kind !== 'slider' ? { control: control.kind } : {}),
        ...(control.kind === 'choice' ? { options: control.options } : {}),
      });
    }
  });
  return { parameters: out, names: seen };
}

function readModel(value: unknown, names: ReadonlySet<string>, problems: Problems, renames: ReadonlyMap<string, string>): ScenePlan['model'] {
  const renamed = (name: string) => renames.get(name) ?? name;
  if (!isRecord(value)) {
    problems.push({ rule: 'schema', path: 'model', message: 'model must be an object with inputs and outputs' });
    return { inputs: [], outputs: [] };
  }
  const inputs: string[] = [];
  for (const [i, raw] of (readList(value.inputs, 'model.inputs', problems) ?? []).entries()) {
    const written = readText(raw, `model.inputs[${i}]`, PLAN_LIMITS.name, problems);
    if (written === null) continue;
    const input = renamed(written);
    if (!names.has(input)) {
      problems.push({ rule: 'unknown-input', path: `model.inputs[${i}]`, message: `The model input "${input}" is not a parameter; inputs are the parameters` });
      continue;
    }
    if (!inputs.includes(input)) inputs.push(input);
  }
  for (const name of names) {
    if (!inputs.includes(name)) {
      problems.push({
        rule: 'unused-parameter',
        path: 'model.inputs',
        message: `The parameter "${name}" is not a model input, so changing it would change nothing`,
      });
    }
  }
  const written: Array<{ readonly name: string; readonly path: string; readonly depends: readonly string[] }> = [];
  const seen = new Set<string>();
  for (const [i, raw] of (readList(value.outputs, 'model.outputs', problems) ?? []).entries()) {
    const path = `model.outputs[${i}]`;
    if (!isRecord(raw)) {
      problems.push({ rule: 'schema', path, message: `${path} must be an object with a name and dependsOn` });
      continue;
    }
    const text = readText(raw.name, `${path}.name`, PLAN_LIMITS.name, problems);
    if (text === null) continue;
    const name = IDENTIFIER.test(text) ? text : identifierFrom(text);
    if (name === null || !IDENTIFIER.test(name)) {
      problems.push({ rule: 'schema', path: `${path}.name`, message: `"${text}" must be a name like flightTime` });
      continue;
    }
    if (seen.has(name)) problems.push({ rule: 'duplicate-name', path: `${path}.name`, message: `Two outputs are called "${name}"` });
    seen.add(name);
    const depends = (readList(raw.dependsOn, `${path}.dependsOn`, problems) ?? []).filter((d): d is string => typeof d === 'string').map(renamed);
    written.push({ name, path, depends });
  }
  // An output may depend on another output, as a gradient on the concentration it is worked out from: it then
  // depends on the inputs that output depends on.
  const byName = new Map(written.map((o) => [o.name, o]));
  const inputsOf = (output: (typeof written)[number], visiting: Set<string>): string[] => {
    const found: string[] = [];
    for (const d of output.depends) {
      if (inputs.includes(d)) found.push(d);
      else {
        const other = byName.get(d);
        if (other && !visiting.has(d)) found.push(...inputsOf(other, new Set([...visiting, d])));
      }
    }
    return [...new Set(found)];
  };
  // An output declared with no dependencies is a constant, such as φ: the scene computes it, but it is not an
  // output. It is dropped rather than rejected, as a re-plan costs a whole model call.
  const constants = new Set(written.filter((o) => o.depends.length === 0).map((o) => o.name));
  const outputs: PlanOutput[] = [];
  for (const output of written) {
    if (constants.has(output.name)) continue;
    const reachable = inputsOf(output, new Set([output.name]));
    if (reachable.length === 0) {
      problems.push({
        rule: 'unreachable-output',
        path: output.path,
        message: `No input can change the output "${output.name}"; drop it or say which parameters it depends on`,
      });
      continue;
    }
    const strangers = output.depends.filter((d) => !inputs.includes(d) && !byName.has(d));
    if (strangers.length > 0) {
      problems.push({
        rule: 'unknown-input',
        path: `${output.path}.dependsOn`,
        message: `"${output.name}" depends on ${strangers.join(', ')}, which ${strangers.length === 1 ? 'is neither an input nor an output' : 'are neither inputs nor outputs'}`,
      });
    }
    outputs.push({ name: output.name, dependsOn: reachable });
  }
  return { inputs, outputs };
}

function readNames(value: unknown, path: string, max: number, rule: PlanRule, noun: string, problems: Problems): string[] {
  let list = readList(value, path, problems) ?? [];
  // A walkthrough longer than the limit keeps its first steps: a certain fix, cheaper than a re-plan.
  if (path === 'steps' && list.length > max) list = list.slice(0, max);
  if (list.length > max) problems.push({ rule, path, message: `The plan has ${list.length} ${noun}; at most ${max} are allowed` });
  const out: string[] = [];
  list.forEach((raw, i) => {
    const text = path === 'steps' ? readProse(raw, `${path}[${i}]`, PLAN_LIMITS.text, problems) : readText(raw, `${path}[${i}]`, PLAN_LIMITS.name, problems);
    if (text === null) return;
    if (out.includes(text)) problems.push({ rule: 'duplicate-name', path: `${path}[${i}]`, message: `"${text}" appears twice in ${path}` });
    else out.push(text);
  });
  return out;
}

/**
 * Singular points as a list of parameter states. Models also write a map,
 * { "f": 0 } or { "f": [0, 10] } or { "f": [] }; those mean the same points and
 * are read as such rather than sent back for a re-plan.
 */
export function singularPointList(value: unknown): unknown[] | null {
  if (value === undefined || value === null) return [];
  const expand = (record: Record<string, unknown>): unknown[] => {
    const entries = Object.entries(record);
    if (entries.length === 0) return [];
    const listed = entries.filter(([, v]) => Array.isArray(v));
    if (listed.length === 0) return [record];
    // { "f": [0, 10] } names several points of one parameter; empty lists name none.
    if (entries.length === 1) return (listed[0]![1] as unknown[]).map((v) => ({ [listed[0]![0]]: v }));
    return entries.flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => ({ [k]: x })) : [{ [k]: v }]));
  };
  if (isRecord(value)) return expand(value);
  if (!Array.isArray(value)) return null;
  return value.flatMap((item) => (isRecord(item) && Object.values(item).some(Array.isArray) ? expand(item) : [item]));
}

/**
 * The parameter states where the model is singular. They only add probe
 * configurations, so anything the learner can never reach (a value outside the
 * slider's range, a name that is not a parameter) is dropped, not re-planned.
 */
function readSingularPoints(value: unknown, parameters: readonly PlanParameter[], renames: ReadonlyMap<string, string>): SingularPoint[] {
  const list = singularPointList(value) ?? [];
  const byName = new Map(parameters.map((p) => [p.name, p]));
  const out: SingularPoint[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const point: Record<string, number> = {};
    let reachable = Object.keys(raw).length > 0;
    for (const [written, v] of Object.entries(raw)) {
      const parameter = byName.get(renames.get(written) ?? written);
      if (!parameter || typeof v !== 'number' || !Number.isFinite(v) || v < parameter.min || v > parameter.max) reachable = false;
      else point[parameter.name] = v;
    }
    if (reachable && !out.some((p) => JSON.stringify(p) === JSON.stringify(point))) out.push(point);
  }
  return out;
}

export function validatePlan(input: unknown): PlanValidation {
  const problems: Problems = [];
  if (!isRecord(input)) {
    return { ok: false, plan: null, problems: [{ rule: 'schema', path: 'plan', message: 'The plan must be a JSON object' }] };
  }
  const concept = readProse(input.concept, 'concept', PLAN_LIMITS.concept, problems);
  const idea = readText(input.idea, 'idea', 1000, problems);
  if (idea !== null) {
    const reason = unclearIdea(idea);
    if (reason) problems.push({ rule: 'unclear-idea', path: 'idea', message: `The idea must be one clear sentence saying what the figure teaches: ${reason}` });
  }
  const kind = input.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    problems.push({ rule: 'schema', path: 'kind', message: `kind must be one of ${KINDS.join(', ')}` });
  }
  // An unknown or missing size is quick: not worth a re-plan.
  const size: SceneSize = typeof input.size === 'string' && (SCENE_SIZES as readonly string[]).includes(input.size) ? (input.size as SceneSize) : 'quick';

  const capabilities: string[] = [];
  for (const [i, raw] of (readList(input.capabilities, 'capabilities', problems) ?? []).entries()) {
    // A core call every scene already has (idea, model, param...) is not a capability: not worth a re-plan.
    if (typeof raw === 'string' && !capability(raw) && Object.hasOwn(INC_FUNCTIONS, raw)) continue;
    if (typeof raw !== 'string' || !capability(raw)) {
      problems.push({
        rule: 'unknown-capability',
        path: `capabilities[${i}]`,
        message: `"${String(raw)}" is not in the catalog. If you are unsure a capability exists, it does not. Use only: ${capabilityNames().join(', ')}`,
      });
    } else if (!capabilities.includes(raw)) capabilities.push(raw);
  }
  if (!capabilities.some((name) => capability(name)?.draws)) {
    problems.push({
      rule: 'no-stage',
      path: 'capabilities',
      message: `The plan needs something to draw on: ${CAPABILITIES.filter((c) => c.draws)
        .map((c) => c.name)
        .join(', ')}`,
    });
  }

  const renames = new Map<string, string>();
  const { parameters, names } = readParameters(input.parameters, problems, renames, size);
  const model = readModel(input.model, names, problems, renames);
  const parts = readNames(input.parts, 'parts', SIZE_BUDGETS[size].parts, 'too-many-parts', 'parts', problems);
  if (parts.length === 0) problems.push({ rule: 'schema', path: 'parts', message: 'Name at least one visual part, so it can be highlighted and described' });
  const moves = readProse(input.moves, 'moves', PLAN_LIMITS.text, problems);
  const steps = readNames(input.steps ?? [], 'steps', PLAN_LIMITS.steps, 'too-many-steps', 'steps', problems);
  const singularPoints = readSingularPoints(input.singularPoints, parameters, renames);

  if (problems.length > 0 || concept === null || idea === null || moves === null) return { ok: false, plan: null, problems };

  // Every scene has a text alternative, and a plan with steps uses the steps capability.
  if (!capabilities.includes('describe')) capabilities.push('describe');
  if (steps.length > 0 && !capabilities.includes('steps')) capabilities.push('steps');
  // Toggles and choices are controls of the controls capability.
  if (parameters.some((p) => p.control === 'toggle' || p.control === 'choice') && !capabilities.includes('controls')) capabilities.push('controls');
  const plan: ScenePlan = {
    concept,
    idea,
    kind: kind as SceneKind,
    size,
    capabilities,
    parameters,
    model,
    parts,
    moves,
    steps,
    singularPoints,
  };
  return { ok: true, plan, problems: [] };
}

/** The problems as the re-plan request quotes them. */
export function formatPlanProblems(problems: readonly PlanProblem[]): string {
  return problems.map((p) => `- ${p.rule} at ${p.path}: ${p.message}`).join('\n');
}

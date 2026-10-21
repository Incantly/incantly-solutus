import type { PlanOutput, PlanParameter, SceneKind, ScenePlan, SingularPoint } from '@incantly/core';
import { capability, capabilityNames } from './catalog';

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
  | 'too-many-steps'
  | 'invalid-singular-point';

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

export const PLAN_LIMITS = {
  params: 3,
  parts: 8,
  steps: 5,
  ideaMin: 20,
  ideaMax: 200,
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

/** The well-formed parameters, and the names of all of them, so one bad number does not hide a name. */
function readParameters(value: unknown, problems: Problems): { parameters: PlanParameter[]; names: Set<string> } {
  const seen = new Set<string>();
  const list = readList(value, 'parameters', problems);
  if (!list) return { parameters: [], names: seen };
  if (list.length === 0) problems.push({ rule: 'no-params', path: 'parameters', message: 'A figure needs at least one parameter the learner can change' });
  if (list.length > PLAN_LIMITS.params) {
    problems.push({
      rule: 'too-many-params',
      path: 'parameters',
      message: `The plan has ${list.length} parameters; at most ${PLAN_LIMITS.params} are allowed. Keep the ones that teach the idea`,
    });
  }
  const out: PlanParameter[] = [];
  list.forEach((raw, i) => {
    const path = `parameters[${i}]`;
    if (!isRecord(raw)) {
      problems.push({ rule: 'schema', path, message: `${path} must be an object` });
      return;
    }
    const name = readText(raw.name, `${path}.name`, PLAN_LIMITS.name, problems);
    if (name !== null && !IDENTIFIER.test(name)) {
      problems.push({ rule: 'schema', path: `${path}.name`, message: `"${name}" must be a name like launchSpeed: a letter, then letters or digits` });
    }
    if (name !== null && seen.has(name)) problems.push({ rule: 'duplicate-name', path: `${path}.name`, message: `Two parameters are called "${name}"` });
    if (name !== null) seen.add(name);
    const unit = readText(raw.unit, `${path}.unit`, PLAN_LIMITS.unit, problems, false);
    const min = readNumber(raw.min, `${path}.min`, problems);
    const max = readNumber(raw.max, `${path}.max`, problems);
    const fallback = readNumber(raw.default, `${path}.default`, problems);
    if (min !== null && max !== null && !(min < max)) {
      problems.push({ rule: 'invalid-bounds', path, message: `${name ?? path}: min (${min}) must be less than max (${max})` });
    } else if (min !== null && max !== null && fallback !== null && (fallback < min || fallback > max)) {
      problems.push({ rule: 'invalid-bounds', path: `${path}.default`, message: `${name ?? path}: the default ${fallback} lies outside ${min} to ${max}` });
    }
    const why = readText(raw.why, `${path}.why`, PLAN_LIMITS.text, problems, false);
    if (!why) {
      problems.push({
        rule: 'missing-justification',
        path: `${path}.why`,
        message: `${name ?? path}: say in a few words why these bounds are physically or mathematically meaningful`,
      });
    }
    if (name !== null && min !== null && max !== null && fallback !== null) {
      out.push({ name, ...(unit ? { unit } : {}), min, max, default: fallback, why: why ?? '' });
    }
  });
  return { parameters: out, names: seen };
}

function readModel(value: unknown, names: ReadonlySet<string>, problems: Problems): ScenePlan['model'] {
  if (!isRecord(value)) {
    problems.push({ rule: 'schema', path: 'model', message: 'model must be an object with inputs and outputs' });
    return { inputs: [], outputs: [] };
  }
  const inputs: string[] = [];
  for (const [i, raw] of (readList(value.inputs, 'model.inputs', problems) ?? []).entries()) {
    const input = readText(raw, `model.inputs[${i}]`, PLAN_LIMITS.name, problems);
    if (input === null) continue;
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
  const outputs: PlanOutput[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of (readList(value.outputs, 'model.outputs', problems) ?? []).entries()) {
    const path = `model.outputs[${i}]`;
    if (!isRecord(raw)) {
      problems.push({ rule: 'schema', path, message: `${path} must be an object with a name and dependsOn` });
      continue;
    }
    const name = readText(raw.name, `${path}.name`, PLAN_LIMITS.name, problems);
    if (name === null) continue;
    if (!IDENTIFIER.test(name)) problems.push({ rule: 'schema', path: `${path}.name`, message: `"${name}" must be a name like flightTime` });
    if (seen.has(name)) problems.push({ rule: 'duplicate-name', path: `${path}.name`, message: `Two outputs are called "${name}"` });
    seen.add(name);
    const depends = (readList(raw.dependsOn, `${path}.dependsOn`, problems) ?? []).filter((d): d is string => typeof d === 'string');
    const reachable = depends.filter((d) => inputs.includes(d));
    if (reachable.length === 0) {
      problems.push({
        rule: 'unreachable-output',
        path,
        message: `No input can change the output "${name}"; drop it or say which parameters it depends on`,
      });
      continue;
    }
    const strangers = depends.filter((d) => !inputs.includes(d));
    if (strangers.length > 0) {
      problems.push({ rule: 'unknown-input', path: `${path}.dependsOn`, message: `"${name}" depends on ${strangers.join(', ')}, which ${strangers.length === 1 ? 'is' : 'are'} not inputs` });
    }
    outputs.push({ name, dependsOn: reachable });
  }
  return { inputs, outputs };
}

function readNames(value: unknown, path: string, max: number, rule: PlanRule, noun: string, problems: Problems): string[] {
  const list = readList(value, path, problems) ?? [];
  if (list.length > max) problems.push({ rule, path, message: `The plan has ${list.length} ${noun}; at most ${max} are allowed` });
  const out: string[] = [];
  list.forEach((raw, i) => {
    const text = readText(raw, `${path}[${i}]`, path === 'steps' ? PLAN_LIMITS.text : PLAN_LIMITS.name, problems);
    if (text === null) return;
    if (out.includes(text)) problems.push({ rule: 'duplicate-name', path: `${path}[${i}]`, message: `"${text}" appears twice in ${path}` });
    else out.push(text);
  });
  return out;
}

function readSingularPoints(value: unknown, parameters: readonly PlanParameter[], problems: Problems): SingularPoint[] {
  if (value === undefined || value === null) return [];
  const list = readList(value, 'singularPoints', problems) ?? [];
  const byName = new Map(parameters.map((p) => [p.name, p]));
  const out: SingularPoint[] = [];
  list.forEach((raw, i) => {
    const path = `singularPoints[${i}]`;
    if (!isRecord(raw) || Object.keys(raw).length === 0) {
      problems.push({ rule: 'invalid-singular-point', path, message: `${path} must name parameter values, like { "objectDistance": 8, "focalLength": 8 }` });
      return;
    }
    const point: Record<string, number> = {};
    let valid = true;
    for (const [name, v] of Object.entries(raw)) {
      const parameter = byName.get(name);
      if (!parameter) {
        problems.push({ rule: 'invalid-singular-point', path: `${path}.${name}`, message: `"${name}" is not a parameter` });
        valid = false;
      } else if (typeof v !== 'number' || !Number.isFinite(v) || v < parameter.min || v > parameter.max) {
        problems.push({
          rule: 'invalid-singular-point',
          path: `${path}.${name}`,
          message: `${name} = ${String(v)} must be a number from ${parameter.min} to ${parameter.max}`,
        });
        valid = false;
      } else point[name] = v;
    }
    if (valid) out.push(point);
  });
  return out;
}

export function validatePlan(input: unknown): PlanValidation {
  const problems: Problems = [];
  if (!isRecord(input)) {
    return { ok: false, plan: null, problems: [{ rule: 'schema', path: 'plan', message: 'The plan must be a JSON object' }] };
  }
  const concept = readText(input.concept, 'concept', PLAN_LIMITS.concept, problems);
  const idea = readText(input.idea, 'idea', 1000, problems);
  if (idea !== null) {
    const reason = unclearIdea(idea);
    if (reason) problems.push({ rule: 'unclear-idea', path: 'idea', message: `The idea must be one clear sentence saying what the figure teaches: ${reason}` });
  }
  const kind = input.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    problems.push({ rule: 'schema', path: 'kind', message: `kind must be one of ${KINDS.join(', ')}` });
  }

  const capabilities: string[] = [];
  for (const [i, raw] of (readList(input.capabilities, 'capabilities', problems) ?? []).entries()) {
    if (typeof raw !== 'string' || !capability(raw)) {
      problems.push({
        rule: 'unknown-capability',
        path: `capabilities[${i}]`,
        message: `"${String(raw)}" is not in the catalog. If you are unsure a capability exists, it does not. Use only: ${capabilityNames().join(', ')}`,
      });
    } else if (!capabilities.includes(raw)) capabilities.push(raw);
  }
  if (!capabilities.some((name) => capability(name)?.draws)) {
    problems.push({ rule: 'no-stage', path: 'capabilities', message: 'The plan needs something to draw on: graph2d or svg' });
  }

  const { parameters, names } = readParameters(input.parameters, problems);
  const model = readModel(input.model, names, problems);
  const parts = readNames(input.parts, 'parts', PLAN_LIMITS.parts, 'too-many-parts', 'parts', problems);
  if (parts.length === 0) problems.push({ rule: 'schema', path: 'parts', message: 'Name at least one visual part, so it can be highlighted and described' });
  const moves = readText(input.moves, 'moves', PLAN_LIMITS.text, problems);
  const steps = readNames(input.steps ?? [], 'steps', PLAN_LIMITS.steps, 'too-many-steps', 'steps', problems);
  const singularPoints = readSingularPoints(input.singularPoints, parameters, problems);

  if (problems.length > 0 || concept === null || idea === null || moves === null) return { ok: false, plan: null, problems };

  // Every scene has a text alternative, and a plan with steps uses the steps capability.
  if (!capabilities.includes('describe')) capabilities.push('describe');
  if (steps.length > 0 && !capabilities.includes('steps')) capabilities.push('steps');
  const plan: ScenePlan = {
    concept,
    idea,
    kind: kind as SceneKind,
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

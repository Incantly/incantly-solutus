import type { Diagnostic, ProbeFailure, ProbeReport, ScenePlan } from '@incantly/core';
import { formatDiagnostic } from '@incantly/core';
import { BUILD_FORMAT, CORE_RULES, catalogLines, contractFor, coreBlock, type Prompt } from './context';
import type { FragmentName, FragmentSet } from './fragments';

/**
 * The repair report (RP-2, PRD 27.3). A vague message produces a vague fix,
 * so the report names the failing check, the exact parameter state, the real
 * error, the line in the agent's own fragment with two lines of context, a
 * hint from the failure taxonomy, and the rule that was broken.
 */

export type ReportKind = 'parse' | 'validation' | 'probe';

export interface RepairReport {
  readonly kind: ReportKind;
  /** The failing check or validator rule, for records and statistics. */
  readonly check: string;
  /** The report as the repair call quotes it. */
  readonly text: string;
  /** Core rules cited, by number. */
  readonly rules: readonly number[];
  /** One line for failure records. */
  readonly summary: string;
}

/** The numbered core rules, by number. */
const RULES: ReadonlyMap<number, string> = new Map(
  [...CORE_RULES.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]!] as const),
);

const VALIDATION_RULES: Readonly<Record<string, number>> = {
  'unknown-sdk-call': 13,
  'unknown-method': 13,
  'unknown-property': 13,
  'forbidden-global': 10,
  'unknown-global': 10,
  'forbidden-syntax': 10,
  'forbidden-member': 10,
  'blocked-property': 10,
  'unbounded-loop': 10,
  'loop-variable-assigned': 10,
  recursion: 10,
  'assign-global': 10,
  'assign-const': 10,
  'assign-sdk': 10,
  'reserved-name': 10,
  'mount-only': 3,
  'element-in-frame': 3,
  'hard-coded-colour': 6,
  'unknown-tone': 6,
  'stage-selector': 12,
  'missing-stage-host': 12,
  'no-stage': 12,
  'too-many-params': 2,
  'budget-size': 11,
  'budget-ast': 11,
  'budget-depth': 11,
  'budget-string': 11,
  'number-in-text': 1,
};

const PROBE_RULES: Readonly<Record<string, number>> = {
  mount: 3,
  runs: 5,
  numbers: 5,
  sweep: 5,
  singular: 5,
  interior: 5,
  'paused-change': 5,
  bounds: 4,
  budget: 11,
  'frame-cost': 4,
  parts: 8,
  steps: 9,
  idea: 9,
  description: 9,
  timeout: 10,
};

function ruleFor(diagnostic: Diagnostic): number {
  return VALIDATION_RULES[diagnostic.rule] ?? (diagnostic.fragment === 'html' || diagnostic.fragment === 'css' ? 12 : 13);
}

function quoteRules(numbers: readonly number[]): string {
  return [...new Set(numbers)]
    .sort((a, b) => a - b)
    .map((n, i) => `${i === 0 ? 'RULE     ' : '         '}${n}. ${RULES.get(n) ?? ''}`)
    .join('\n');
}

/** The line and its neighbours, numbered as in the fragment. */
export function sourceContext(source: string, line: number, around = 1): string {
  const lines = source.split('\n');
  const from = Math.max(1, line - around);
  const to = Math.min(lines.length, line + around);
  const width = String(to).length;
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`  ${n === line ? '>' : ' '} ${String(n).padStart(width)} | ${lines[n - 1] ?? ''}`);
  return out.join('\n');
}

function where(fragment: FragmentName | 'scene', line: number | undefined, column: number | undefined, fragments: FragmentSet): string[] {
  if (line === undefined || fragment === 'scene') return [];
  const source = fragments[fragment] ?? '';
  return [`WHERE    AGENT_${fragment.toUpperCase()} line ${line}${column !== undefined ? `, column ${column}` : ''}`, sourceContext(source, line)];
}

function header(attempt: number, of: number): string {
  return `REPAIR ${attempt} of ${of}: the figure failed its check. Return only the fragments you change, each in its fenced block.`;
}

// ---------------------------------------------------------------------------
// Unreadable replies
// ---------------------------------------------------------------------------

export function parseReport(problems: readonly string[], missing: readonly FragmentName[], attempt = 1, of = 1): RepairReport {
  const lines = [header(attempt, of), '', 'FAILURE  reply'];
  for (const problem of problems) lines.push(`ERROR    ${problem}`);
  if (missing.length > 0) lines.push(`ERROR    Missing fragment${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  lines.push('LIKELY   the reply was cut off or did not use one fenced block per fragment');
  return {
    kind: 'parse',
    check: 'reply',
    text: lines.join('\n'),
    rules: [],
    summary: `reply: ${[...problems, ...missing.map((m) => `missing ${m}`)].join('; ')}`,
  };
}

// ---------------------------------------------------------------------------
// Static validation
// ---------------------------------------------------------------------------

/** At most this many validator errors are quoted; the first ones usually explain the rest. */
const MAX_DIAGNOSTICS = 5;

export function validationReport(diagnostics: readonly Diagnostic[], fragments: FragmentSet, attempt = 1, of = 1): RepairReport {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const quoted = errors.slice(0, MAX_DIAGNOSTICS);
  const lines = [header(attempt, of), '', 'FAILURE  validation: the scene was rejected before it ran'];
  for (const diagnostic of quoted) {
    lines.push('', `ERROR    ${formatDiagnostic(diagnostic)}`, ...where(diagnostic.fragment, diagnostic.line, diagnostic.column, fragments));
  }
  if (errors.length > quoted.length) lines.push('', `         ...and ${errors.length - quoted.length} more of the same kinds.`);
  const rules = quoted.map(ruleFor);
  lines.push('', quoteRules(rules));
  const first = quoted[0];
  return {
    kind: 'validation',
    check: first?.rule ?? 'validation',
    text: lines.join('\n'),
    rules: [...new Set(rules)],
    summary: quoted.map((d) => `${d.rule} at ${d.fragment}:${d.line}:${d.column}`).join('; '),
  };
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

function describeValue(name: string, value: number, plan: ScenePlan | null): string {
  const parameter = plan?.parameters.find((p) => p.name === name);
  const rounded = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  if (!parameter) return `${name} = ${rounded}`;
  const unit = parameter.unit ? ` ${parameter.unit}` : '';
  const at = value === parameter.min ? ' (minimum)' : value === parameter.max ? ' (maximum)' : value === parameter.default ? ' (default)' : '';
  return `${name} = ${rounded}${unit}${at}`;
}

function when(failure: ProbeFailure, plan: ScenePlan | null): string | null {
  const parts: string[] = [];
  if (failure.values) for (const [name, value] of Object.entries(failure.values)) parts.push(describeValue(name, value, plan));
  if (failure.time !== undefined) parts.push(`t = ${Math.round(failure.time * 100) / 100} s`);
  if (failure.playing !== undefined) parts.push(failure.playing ? 'playing' : 'paused');
  return parts.length > 0 ? parts.join(', ') : null;
}

/** A hint from the failure taxonomy (PRD 27.7): what usually causes this. */
export function likelyCause(failure: ProbeFailure): string | null {
  const message = failure.error?.message ?? '';
  if (failure.error?.phase === 'runaway') return 'a loop never ends, or does far too much work: give every loop a small fixed bound';
  if (/reading '[^']*'/.test(message) || /of undefined|of null/.test(message)) {
    return 'an index or key is out of range at this parameter state; check lengths and bounds before reading';
  }
  if (/is not a function/.test(message)) return 'a value is not what the code assumes; check the contract for that method';
  if (/is not available in scenes|Only numbers and strings/.test(message)) return 'a computed property name is not allowed; use a plain name or a number';
  switch (failure.check) {
    case 'numbers':
    case 'sweep':
    case 'interior':
      return failure.error ? null : 'a division by zero or a square root of a negative number at this state; guard it';
    case 'singular':
      return 'the model is undefined at the plan’s singular point; handle that state explicitly';
    case 'paused-change':
      return 'the drawing changes only when time advances; draw from the model in inc.onFrame and use dt only to advance state';
    case 'bounds':
      return /Nothing is drawn/.test(failure.message)
        ? 'the coordinates do not match the stage: check the viewBox or the graph x and y ranges'
        : 'some coordinates leave the stage; scale them to the viewBox or the graph ranges';
    case 'budget':
      return 'too many elements: draw a curve as one path, and create elements once';
    case 'frame-cost':
      return 'too much work per frame: build shapes once and only move them';
    case 'parts':
      return 'register each planned part with stage.part, using exactly the plan’s name';
    case 'steps':
      return 'inc.steps needs one step for each planned step';
    case 'idea':
    case 'description':
      return 'declare it once at the top level';
    case 'timeout':
      return 'the check ran out of time: a loop or a curve does far too much work';
    default:
      return null;
  }
}

export function probeReport(report: ProbeReport, fragments: FragmentSet, plan: ScenePlan | null, attempt = 1, of = 1): RepairReport {
  const failures = report.failures;
  const first = failures[0];
  if (!first) throw new Error('A passing probe has nothing to repair');
  const lines = [header(attempt, of), '', `FAILURE  ${first.check}: ${first.message}`];
  const state = when(first, plan);
  if (state) lines.push(`WHEN     ${state}`);
  if (first.error) {
    lines.push(`ERROR    ${first.error.name && first.error.name !== 'Error' ? `${first.error.name}: ` : ''}${first.error.message}`);
    lines.push(...where('js', first.error.line, first.error.column, fragments));
  }
  const hint = likelyCause(first);
  if (hint) lines.push(`LIKELY   ${hint}`);
  const others = failures.slice(1, 4).filter((f) => f.check !== first.check || f.message !== first.message);
  if (others.length > 0) {
    lines.push('ALSO');
    for (const other of others) {
      const at = when(other, plan);
      lines.push(`         ${other.check}: ${other.message}${at ? ` (${at})` : ''}`);
    }
  }
  const rules = [first, ...others].map((f) => PROBE_RULES[f.check] ?? 5);
  lines.push(quoteRules(rules));
  const location = first.error?.line !== undefined ? ` at js:${first.error.line}:${first.error.column ?? 0}` : '';
  return {
    kind: 'probe',
    check: first.check,
    text: lines.join('\n'),
    rules: [...new Set(rules)],
    summary: `${first.check}: ${first.error?.message ?? first.message}${location}`,
  };
}

// ---------------------------------------------------------------------------
// The repair call
// ---------------------------------------------------------------------------

export const REPAIR_FORMAT = `REPAIR format. Fix the reported failure. Reply with only the fragments you change, each in its own fenced block (\`\`\`html, \`\`\`css or \`\`\`js), complete, and nothing else. Keep everything that already works.`;

/**
 * The repair call (RP-5): only the report, the fragments as they stand, the
 * catalog lines for the capabilities in use and, when the failure is an
 * unknown name, the contract for them. Never the conversation so far.
 */
export function repairPrompt(report: RepairReport, fragments: FragmentSet, plan: ScenePlan): Prompt {
  const unknownName = /^unknown-(sdk-call|method|property)$/.test(report.check);
  const reference = [
    REPAIR_FORMAT,
    BUILD_FORMAT.replace('exactly three fenced blocks', 'the fenced blocks you change'),
    'Capabilities this scene uses:',
    catalogLines(plan.capabilities),
    ...(unknownName ? ['CONTRACT', '```ts', contractFor(plan.capabilities), '```'] : []),
  ].join('\n');
  const user = [
    report.text,
    '',
    'The fragments as they stand:',
    ...(['html', 'css', 'js'] as const).flatMap((name) => ['```' + name, (fragments[name] ?? '').replace(/\n$/, ''), '```']),
    '',
    `The plan's parameters: ${plan.parameters.map((p) => `${p.name} from ${p.min} to ${p.max}`).join('; ')}. Parts: ${plan.parts.join(', ')}.`,
  ].join('\n');
  return { system: [coreBlock(), { text: reference, cache: false }], user };
}

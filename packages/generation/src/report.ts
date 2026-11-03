import type { Diagnostic, ProbeFailure, ProbeReport, ScenePlan } from '@incantly/core';
import { formatDiagnostic } from '@incantly/core';
import { CORE_RULES, catalogLines, contractFor, coreBlock, type Prompt } from './context';
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
  // A failure after the last repair is recorded, not repaired: it is not numbered as a repair that never runs.
  if (attempt > of) return `FAILED after ${of} repairs: the figure still fails its check.`;
  return `REPAIR ${attempt} of ${of}: the figure failed its check. Return only the fragments you change, each in its fenced block.`;
}

// ---------------------------------------------------------------------------
// Unreadable replies
// ---------------------------------------------------------------------------

export function parseReport(problems: readonly string[], missing: readonly FragmentName[], attempt = 1, of = 1): RepairReport {
  const lines = [header(attempt, of), '', 'FAILURE  reply'];
  for (const problem of problems) lines.push(`ERROR    ${problem}`);
  if (missing.length > 0) lines.push(`ERROR    Missing fragment${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  // Edits that failed among others that applied: the fragment shown is as those left it, so only the failed ones need sending.
  const edits = problems.length > 0 && missing.length === 0 && problems.every((p) => p.startsWith('Edit failed:'));
  lines.push(
    edits
      ? 'LIKELY   the other edits were applied, and the fragment below is as they left it: send only the edits that failed, each SEARCH copied exactly from it'
      : 'LIKELY   the reply was cut off or did not use one fenced block per fragment',
  );
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

/**
 * At most this many validator errors are quoted, one of each kind first: a
 * repair that never saw a kind of error leaves it in place, and a second
 * failure ends the generation.
 */
const MAX_DIAGNOSTICS = 5;

export function validationReport(diagnostics: readonly Diagnostic[], fragments: FragmentSet, attempt = 1, of = 1): RepairReport {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const firsts = errors.filter((d, i) => errors.findIndex((e) => e.rule === d.rule) === i);
  const chosen = new Set([...new Set([...firsts, ...errors])].slice(0, MAX_DIAGNOSTICS));
  const quoted = errors.filter((d) => chosen.has(d));
  const rest = errors.filter((d) => !chosen.has(d));
  const lines = [header(attempt, of), '', 'FAILURE  validation: the scene was rejected before it ran'];
  for (const diagnostic of quoted) {
    lines.push('', `ERROR    ${formatDiagnostic(diagnostic)}`, ...where(diagnostic.fragment, diagnostic.line, diagnostic.column, fragments));
  }
  if (rest.length > 0) lines.push('', `         ...and ${rest.length} more: ${rest.map((d) => `${d.rule} at ${d.fragment} line ${d.line}`).join('; ')}.`);
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

/**
 * API-guard errors, hinted by message: the same guard can surface under any
 * check that runs the line, so the check alone misleads (a spring error found
 * while stepping is about the stiffness, not the steps).
 */
const GUARDS: ReadonlyArray<readonly [RegExp, (match: RegExpMatchArray) => string]> = [
  [/has no values|has no points/, () => 'a series starts with data: pass initial values, or a function returning them for live data'],
  [/has \d+ (values|points); at most (\d+)/, (m) => `keep the series to ${m[2]} ${m[1]}: sample or window the data`],
  [/has \d+ values but the chart has (\d+) categories/, (m) => `a series holds exactly one value per category: match the chart's ${m[1]} categories`],
  [/must be above 0/, () => 'a control reaches a value the kit rejects; clamp it above 0 where it is passed in'],
  [/Expected an element the SDK made/, () => 'pass an element (stage.circle, …) or a kit object with a handle; a chart series is already a part under its own name'],
  [/must be a point \[x, y\]/, () => 'pass both coordinates as an [x, y] pair'],
];

/** The guard hint for an error message, or null when no guard fired. */
function guardHint(message: string): string | null {
  for (const [pattern, hint] of GUARDS) {
    const match = pattern.exec(message);
    if (match) return hint(match);
  }
  return null;
}

/** Whether the failure is an API-guard error: its fix is in the contract, not the check's rule. */
function guardFailure(failure: ProbeFailure): boolean {
  return failure.error !== undefined && guardHint(failure.error.message) !== null;
}

/**
 * Concrete moves from a bounds message: "the circle reaches y = 433, below
 * 400" becomes "move the circle up by 33 units". Stage units grow right and
 * down, so a negative y shift moves up. At most three moves; an element the
 * message does not parse contributes none.
 */
function boundsShifts(message: string): string[] {
  const shifts: string[] = [];
  for (const part of message.split(';')) {
    const who = /the (\w+(?: "[^"]+")?) reaches /.exec(part)?.[1];
    if (!who) continue;
    for (const match of part.matchAll(/([xy]) = (-?[\d.]+), (left of|right of|above|below) (-?[\d.]+)/g)) {
      const [, axis, reached, , bound] = match;
      const delta = Math.round((Number(bound) - Number(reached)) * 100) / 100;
      if (!Number.isFinite(delta) || delta === 0) continue;
      const move = axis === 'x' ? (delta > 0 ? 'right' : 'left') : delta > 0 ? 'down' : 'up';
      shifts.push(`move the ${who} ${move} by ${Math.abs(delta)} units`);
    }
    if (shifts.length >= 3) break;
  }
  return shifts.slice(0, 3);
}

/** A hint from the failure taxonomy (PRD 27.7): what usually causes this. */
export function likelyCause(failure: ProbeFailure): string | null {
  const message = failure.error?.message ?? '';
  if (failure.error?.phase === 'runaway') return 'a loop never ends, or does far too much work: give every loop a small fixed bound';
  const guard = guardHint(message);
  if (guard) return guard;
  if (/reading '[^']*'/.test(message) || /of undefined|of null/.test(message)) {
    return 'an index or key is out of range at this parameter state; check lengths and bounds before reading';
  }
  const namespace = /\binc\.(state|calc|vec|units|motion|shapes|path|geom) is not a function/.exec(message);
  if (namespace) return `inc.${namespace[1]} is an object of helpers, not a function: call one of its methods from the contract`;
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
      return 'the drawing changes only when time advances: draw from the model in inc.onFrame and use dt only to advance state. If this parameter rightly changes nothing in the motion, still show it: label or size what it describes';
    case 'bounds': {
      if (/Nothing is drawn/.test(failure.message)) return 'the coordinates do not match the stage: check the viewBox or the graph x and y ranges';
      // Text and points are sized like pixels: in a viewBox a few units wide they cover the whole stage.
      const box = /viewBox \[(-?[\d.]+), (-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\]/.exec(failure.message);
      const width = box ? Number(box[3]) : Number.NaN;
      if (width < 60) {
        return `stage units work like pixels: text is 12 units tall, so in a viewBox only ${width} wide it covers the stage. Use a viewBox a few hundred units wide, such as [0, 0, 520, 390], and scale the model's metres to it`;
      }
      const shifts = boundsShifts(failure.message);
      if (shifts.length > 0) {
        return `${shifts.join('; ')} to fit the viewBox; if a shape is larger than the box, scale its coordinates instead. Then check every parameter value still fits`;
      }
      return 'some coordinates leave the stage; scale them to the viewBox or the graph ranges';
    }
    case 'budget':
      return 'too many elements: draw many small dots (particles, samples) with stage.dots, a curve as one path, and create elements once';
    case 'frame-cost':
      return 'too much work per frame: build shapes once and only move them';
    case 'parts':
      return 'register each planned part with stage.part (or a kit’s part), using exactly the plan’s name, on an element drawn in the figure; a readout or formula is not a part, so draw a text label for it and register that';
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
  // A guard error's fix is in the contract (rule 13); the check that happened to run the line misleads.
  const rules = [guardFailure(first) ? 13 : (PROBE_RULES[first.check] ?? 5), ...others.map((f) => PROBE_RULES[f.check] ?? 5)];
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

export const REPAIR_FORMAT = `REPAIR format. Fix the reported failure and keep everything that already works. Reply with edits only, one block per fragment you change, and nothing else:
\`\`\`edit js
<<<<<<< SEARCH
a few whole lines copied exactly from the fragment
=======
what replaces them
>>>>>>> REPLACE
\`\`\`
A block may hold several SEARCH/REPLACE pairs, applied in order; each SEARCH must match one place. If a fragment needs rewriting, reply with it whole in its usual \`\`\`js (or html, css) block instead.`;

/**
 * The repair call (RP-5): only the report, the fragments as they stand, the
 * catalog lines for the capabilities in use and, when the failure is an
 * unknown name or the probe caught it live, the contract for them. A probe
 * failure's fix needs the API it tripped; one line per capability leaves the
 * model guessing it from memory. Never the conversation so far.
 */
export function repairPrompt(report: RepairReport, fragments: FragmentSet, plan: ScenePlan): Prompt {
  const unknownName = /^unknown-(sdk-call|method|property)$/.test(report.check);
  const needsContract = unknownName || report.kind === 'probe';
  const reference = [
    REPAIR_FORMAT,
    'Capabilities this scene uses:',
    catalogLines(plan.capabilities),
    ...(needsContract ? ['CONTRACT', '```ts', contractFor(plan.capabilities), '```'] : []),
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

/**
 * The film tools (core design 10, teacher design 4): `pause`, `resume`, `seek_beat` and `show_me`. They move the target's
 * clock and write free values; the figure reacts through the normal update pass. Each also sends a `control` (or `lines`)
 * event, so the client that shows the figure does the same to its own copy. On a board the client acts on the figure card
 * the turn made last, or the one in focus (teacher design 4).
 *
 * `show_me` is a `draw` call of one `SetValue` line, so it follows the same checks and gives the same result.
 */
import type { Result } from '@incantly/kernel';
import { drawTool } from './draw';
import { defineTool, ok, toolInputError } from './schema';
import type { JsonSchema, Target, ToolDef, ToolValue, TurnOutput } from './types';

/** The longest `seconds` a `show_me` may ask for. */
export const SHOW_SECONDS_MAX = 30;

const NO_INPUT: JsonSchema = { type: 'object', properties: {} };

/** The film time the clock stands at, rounded so a result reads cleanly. */
const timeOf = (target: Target): number => Math.round(target.clock.t * 1e6) / 1e6;

export const pauseTool: ToolDef = defineTool({
  name: 'pause',
  description: 'Stop the film where it is, for example before a question to the learner. Result: the film time t.',
  schema: NO_INPUT,
  body(target) {
    target.clock.pause();
    return ok({ ok: true, t: timeOf(target) });
  },
  outputs: (): readonly TurnOutput[] => [{ control: { op: 'pause' } }],
});

export const resumeTool: ToolDef = defineTool({
  name: 'resume',
  description: 'Play the film again from where it stopped. Result: the film time t.',
  schema: NO_INPUT,
  body(target) {
    target.clock.play();
    return ok({ ok: true, t: timeOf(target) });
  },
  outputs: (): readonly TurnOutput[] => [{ control: { op: 'resume' } }],
});

export const seekBeatTool: ToolDef = defineTool({
  name: 'seek_beat',
  description: 'Jump the film to the time t, in seconds, for example the beat where the thing you explain happens. The film keeps its play state. Result: the film time t the figure stands at.',
  schema: { type: 'object', properties: { t: { type: 'number', description: 'Film time in seconds, 0 or more.', minimum: 0, maximum: 86_400 } }, required: ['t'] },
  body(target, input) {
    target.clock.seek(input['t'] as number);
    return ok({ ok: true, t: timeOf(target) });
  },
  outputs(_input, value): readonly TurnOutput[] {
    const t = value['t'];
    return typeof t === 'number' ? [{ control: { op: 'seek', t } }] : [];
  },
});

/** A name of a free object: letters, digits and `_`, with an optional list index (`L[2]`). */
const NAME = /^[\p{L}_][\p{L}\p{N}_]*(\[\d+\])?$/u;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The language's source for a value the model gave (a number, true or false, a text, or a point `[x, y]`), or the problem. */
function sourceOf(v: unknown, at: string): { readonly source: string } | { readonly problem: string } {
  if (finite(v)) return { source: String(v) };
  if (typeof v === 'boolean') return { source: v ? 'true' : 'false' };
  if (typeof v === 'string') {
    if (/["\\\r\n]/.test(v)) return { problem: `${at} is text with a quote, a backslash or a line break; use plain text.` };
    return { source: `"${v}"` };
  }
  if (Array.isArray(v) && v.length === 2 && v.every(finite)) return { source: `(${String(v[0])}, ${String(v[1])})` };
  return { problem: `${at} must be a number, true or false, text, or a point [x, y].` };
}

/** The `SetValue` line a `show_me` input stands for, or what is wrong with the input. */
function lineOf(input: Record<string, unknown>): { readonly line: string } | { readonly problem: string } {
  const name = input['name'];
  if (typeof name !== 'string' || !NAME.test(name)) return { problem: '"name" must be the name of a free object, such as a or L[2].' };
  const hasValue = input['value'] !== undefined;
  const hasTo = input['to'] !== undefined;
  if (hasValue === hasTo) return { problem: 'Give either "value" (set it now) or "to" with "seconds" (move it there).' };
  const read = sourceOf(hasValue ? input['value'] : input['to'], hasValue ? '"value"' : '"to"');
  if ('problem' in read) return read;
  if (hasTo) {
    const seconds = input['seconds'];
    if (!finite(seconds) || seconds <= 0 || seconds > SHOW_SECONDS_MAX) return { problem: `"seconds" must be a number above 0 and at most ${SHOW_SECONDS_MAX}.` };
  }
  return { line: `SetValue(${name}, ${read.source})` };
}

const SHOW_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The free object to change: a slider, a free number or a free point.', minLength: 1, maxLength: 64 },
    value: { description: 'Set it to this now: a number, true or false, text, or a point [x, y].' },
    to: { description: 'Move it to this over "seconds": the same kinds of value as "value".' },
    seconds: { type: 'number', description: `How long the move takes, above 0 and at most ${SHOW_SECONDS_MAX}.`, minimum: 0.1, maximum: SHOW_SECONDS_MAX },
  },
  required: ['name'],
};

/** The draw result of a line sent on without a figure to check it on (a board target). */
function sentOn(line: string): Result<ToolValue> {
  return ok({ lines: [{ ok: true, line: 1, summary: `${line} (sent to the figure in focus)` }], applied: 1, undefined: [] });
}

export const showMeTool: ToolDef = defineTool({
  name: 'show_me',
  description:
    'Change a free value or a slider while you explain it, so the figure moves where the learner can see it: show_me { name: "a", value: 2 }, or { name: "a", to: 2, seconds: 3 } to move it there. It writes one SetValue line and gives the same result as draw. On a board it acts on the figure card you made last or the one in focus.',
  schema: SHOW_SCHEMA,
  check(input) {
    const read = lineOf(input);
    return 'problem' in read ? read.problem : undefined;
  },
  body(target, input) {
    const read = lineOf(input);
    if ('problem' in read) return toolInputError('show_me', SHOW_SCHEMA, read.problem);
    // a board target has no figure of its own: the line goes to the card in focus, which checks it as it applies it
    if (target.kind === 'board') return sentOn(read.line);
    const result = drawTool.run(target, { lines: [read.line] });
    if (!result.ok) return result;
    return ok({ ...result.value, show: { name: input['name'] as string, line: read.line, ...(input['seconds'] !== undefined ? { seconds: input['seconds'] as number } : {}) } });
  },
  outputs(input, value): readonly TurnOutput[] {
    const read = lineOf(input as Record<string, unknown>);
    if ('problem' in read) return [];
    const results = value['lines'];
    const passed = Array.isArray(results) && results.length === 1 && (results[0] as { ok?: unknown } | undefined)?.ok === true;
    return passed ? [{ lines: [read.line] }] : [];
  },
});

/** The film tools, in the order a toolset lists them. */
export const FILM_TOOLS: readonly ToolDef[] = [pauseTool, resumeTool, seekBeatTool, showMeTool];

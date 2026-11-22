/**
 * The `draw` tool (core design 10, teacher design 4): one to five lines of the formula language, each applied on its
 * own. A good line commits; a bad line changes nothing and does not undo the lines before it. The result is the SDK's
 * line result per line (the kernel's error object unchanged) and the objects that are undefined now.
 */
import { DEFAULT_LIMITS } from '@incantly/kernel';
import type { LineResult } from '@incantly/sdk';
import { defineTool, ok } from './schema';
import type { JsonSchema, ToolDef, TurnOutput } from './types';

export const DRAW_MAX_LINES = 5;
/** The most undefined objects a `draw` result lists; the rest are counted. */
export const DRAW_UNDEFINED_MAX = 20;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      description: 'One to five lines of the formula language, one change a line.',
      items: { type: 'string', minLength: 1, maxLength: DEFAULT_LIMITS.lineLength },
      minItems: 1,
      maxItems: DRAW_MAX_LINES,
    },
  },
  required: ['lines'],
};

/** One line of a `draw` result: what the SDK reports for a good line, or the error object as it is. */
export function lineResultOf(r: LineResult): unknown {
  if (!r.ok) return r;
  return {
    ok: true,
    line: r.line,
    ...(r.name !== undefined ? { name: r.name } : {}),
    ...(r.type !== undefined ? { type: r.type } : {}),
    ...(r.summary !== undefined ? { summary: r.summary } : {}),
  };
}

export const drawTool: ToolDef = defineTool({
  name: 'draw',
  description:
    'Write one to five lines of the formula language to add or change objects. Each line is applied on its own: a good line is kept, a bad line changes nothing and the lines before it stay. The result lists every line (name, type and value, or the error with forms and a hint) and the objects that are undefined.',
  schema: SCHEMA,
  check(input, target) {
    const lines = input['lines'] as string[];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      if (line.trim() === '') return `lines[${i + 1}] is empty.`;
      if (/[\r\n]/.test(line)) return `lines[${i + 1}] holds more than one line; send one line per item.`;
      if (line.length > target.lineLimit) return `lines[${i + 1}] has ${line.length} characters; at most ${target.lineLimit}.`;
    }
    return undefined;
  },
  body(target, input) {
    const lines = input['lines'] as string[];
    const results = target.run(lines);
    const undef = target.undefinedObjects();
    return ok({
      lines: results.map(lineResultOf),
      applied: results.filter((r) => r.ok).length,
      undefined: undef.slice(0, DRAW_UNDEFINED_MAX),
      ...(undef.length > DRAW_UNDEFINED_MAX ? { undefinedOmitted: undef.length - DRAW_UNDEFINED_MAX } : {}),
    });
  },
  outputs(input, value): readonly TurnOutput[] {
    const sent = (input as { lines: string[] }).lines;
    const results = value['lines'] as readonly { ok: boolean }[];
    if (results.length !== sent.length) return [];
    const passed = sent.filter((_, i) => results[i]?.ok === true);
    return passed.length > 0 ? [{ lines: passed }] : [];
  },
});

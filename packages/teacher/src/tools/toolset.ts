/**
 * Toolsets (teacher design 4): the tools one job offers, built from a list of names plus any tool a host adds. A call
 * goes through the target's guard, so two calls on one target never overlap, and nothing a tool does throws out of it.
 */
import { err } from '@incantly/kernel';
import type { Result } from '@incantly/kernel';
import { faultError, toolUnknownError } from '../errors';
import { boardReadTool, boardTool } from './board';
import { drawTool } from './draw';
import { figureTool } from './figure';
import { toolInputError } from './schema';
import type { Target, ToolDef, ToolOutcome, ToolSpec, ToolValue, Toolset } from './types';

const BUILTIN: readonly ToolDef[] = [drawTool, figureTool, boardReadTool, boardTool];

/** The names of the tools this package ships (`draw`, `figure`, `board_read`, `board`; round 4 adds the film tools). */
export const BUILTIN_TOOL_NAMES: readonly string[] = BUILTIN.map((t) => t.name);

const WHOLE = { line: 0, col: 1, endCol: 1 } as const;

/** The built-in tool of `name`, or undefined. */
export function builtinTool(name: string): ToolDef | undefined {
  return BUILTIN.find((t) => t.name === name);
}

function parseArgs(def: ToolDef, args: unknown): { readonly input: unknown } | { readonly error: Result<ToolValue> } {
  if (typeof args !== 'string') return { input: args ?? {} };
  if (args.trim() === '') return { input: {} };
  try {
    return { input: JSON.parse(args) as unknown };
  } catch {
    return { error: toolInputError(def.name, def.schema, 'The arguments are not valid JSON.') };
  }
}

class ToolsetImpl implements Toolset {
  constructor(
    readonly names: readonly string[],
    private readonly tools: ReadonlyMap<string, ToolDef>,
  ) {}

  specs(): readonly ToolSpec[] {
    return this.names.map((n) => {
      const t = this.tools.get(n) as ToolDef;
      return { name: t.name, description: t.description, schema: t.schema };
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  call(target: Target, name: string, args: unknown): ToolOutcome {
    const def = this.tools.get(name);
    if (def === undefined) return { result: toolUnknownError(name, this.names), outputs: [] };
    const parsed = parseArgs(def, args);
    if ('error' in parsed) return { result: parsed.error, outputs: [] };
    if (!target.guard.enter()) {
      return { result: err('tool_busy', WHOLE, {}, { token: name, hint: `${name} was not run; the figure was busy.`, fingerprintKey: name }), outputs: [] };
    }
    try {
      const result = def.run(target, parsed.input);
      return { result, outputs: result.ok ? (def.outputs?.(parsed.input, result.value) ?? []) : [] };
    } catch (e) {
      return { result: faultError(`tool ${name}`, e instanceof Error ? e.message : 'unknown'), outputs: [] };
    } finally {
      target.guard.leave();
    }
  }
}

/**
 * A toolset of the built-in tools in `names`, plus the host's own tools of the same shape. A name that is not a tool is
 * `tool_unknown`; a name given twice is `bad_argument`.
 */
export function toolset(names: readonly string[], extra: readonly ToolDef[] = []): Result<Toolset> {
  const tools = new Map<string, ToolDef>();
  const order: string[] = [];
  const available = [...BUILTIN_TOOL_NAMES, ...extra.map((t) => t.name)];
  const seen = new Set<string>();
  for (const def of extra) {
    if (seen.has(def.name) || builtinTool(def.name) !== undefined) return err('bad_argument', WHOLE, { command: 'toolset', why: `${def.name} is already a tool` }, { token: def.name, fingerprintKey: def.name });
    seen.add(def.name);
  }
  for (const name of names) {
    const def = builtinTool(name) ?? extra.find((t) => t.name === name);
    if (def === undefined) return toolUnknownError(name, available);
    if (tools.has(name)) return err('bad_argument', WHOLE, { command: 'toolset', why: `${name} is listed twice` }, { token: name, fingerprintKey: name });
    tools.set(name, def);
    order.push(name);
  }
  for (const def of extra) {
    if (tools.has(def.name)) continue;
    tools.set(def.name, def);
    order.push(def.name);
  }
  return { ok: true, value: new ToolsetImpl(order, tools), notices: [] };
}

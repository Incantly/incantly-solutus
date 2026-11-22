/**
 * A small checker for the JSON Schema subset the tools declare, and the printer that tells the model the shape it
 * missed. Both are pure; neither throws.
 */
import { err } from '@incantly/kernel';
import type { ErrorObject, Result } from '@incantly/kernel';
import type { JsonSchema, Target, ToolDef, ToolRun, ToolValue } from './types';
import { faultError } from '../errors';

const WHOLE = { line: 0, col: 1, endCol: 1 } as const;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The first way `value` breaks `schema`, in a sentence, or undefined when it fits. `at` names the place ("lines[2]"). */
export function checkSchema(schema: JsonSchema, value: unknown, at = 'the input'): string | undefined {
  switch (schema.type) {
    case 'object': {
      if (!isObject(value)) return `${at} must be an object.`;
      for (const key of schema.required ?? []) if (value[key] === undefined) return `${at} needs "${key}".`;
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        const v = value[key];
        if (v === undefined) continue;
        const problem = checkSchema(sub, v, at === 'the input' ? `"${key}"` : `${at}.${key}`);
        if (problem !== undefined) return problem;
      }
      return undefined;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${at} must be a list.`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${at} has ${value.length} item(s); at least ${schema.minItems}.`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${at} has ${value.length} items; at most ${schema.maxItems}.`;
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const problem = checkSchema(schema.items, value[i], `${at}[${i + 1}]`);
          if (problem !== undefined) return problem;
        }
      }
      return undefined;
    }
    case 'string': {
      if (typeof value !== 'string') return `${at} must be text.`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${at} is too short.`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${at} has ${value.length} characters; at most ${schema.maxLength}.`;
      if (schema.enum && !schema.enum.includes(value)) return `${at} must be one of ${schema.enum.join(', ')}.`;
      return undefined;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${at} must be a number.`;
      if (schema.type === 'integer' && !Number.isInteger(value)) return `${at} must be a whole number.`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${at} must be at least ${schema.minimum}.`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${at} must be at most ${schema.maximum}.`;
      return undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? undefined : `${at} must be true or false.`;
    default:
      return undefined;
  }
}

/** The shape of a schema in a few words: `{ lines: string[] (1 to 5) }`. */
export function shapeOf(schema: JsonSchema): string {
  switch (schema.type) {
    case 'object': {
      const required = new Set(schema.required ?? []);
      const parts = Object.entries(schema.properties ?? {}).map(([key, sub]) => `${key}${required.has(key) ? '' : '?'}: ${shapeOf(sub)}`);
      return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
    }
    case 'array': {
      const range =
        schema.minItems !== undefined && schema.maxItems !== undefined ? ` (${schema.minItems} to ${schema.maxItems})` : schema.maxItems !== undefined ? ` (at most ${schema.maxItems})` : '';
      return `${schema.items ? shapeOf(schema.items) : 'any'}[]${range}`;
    }
    case 'string':
      return schema.enum ? schema.enum.map((e) => JSON.stringify(e)).join(' | ') : 'string';
    case 'integer':
      return 'whole number';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'any';
  }
}

/** T001: the call's arguments break the tool's schema. `problem` says how; `forms` holds the schema's shape. */
export function toolInputError(tool: string, schema: JsonSchema, problem: string): ErrorObject {
  const shape = shapeOf(schema);
  return err('tool_input', WHOLE, { tool, expected: shape }, { token: tool, forms: [`${tool}(${shape})`], recovery: 'fix_line', hint: problem, fingerprintKey: `${tool}:${problem}` });
}

export const ok = (value: ToolValue): Result<ToolValue> => ({ ok: true, value, notices: [] });

export interface ToolSource {
  readonly name: string;
  readonly description: string;
  readonly schema: JsonSchema;
  /**
   * The schema the whole call is checked against, when it is looser than `schema` (the model still reads `schema`). A tool
   * whose parts fail on their own, as the actions of `board` do, checks only the outer shape here and each part in its body.
   */
  readonly callSchema?: JsonSchema;
  /** A check the schema cannot say; returns the problem in a sentence, or undefined. */
  readonly check?: (input: Record<string, unknown>, target: Target) => string | undefined;
  /** Runs on an input that passed the schema and `check`. */
  readonly body: (target: Target, input: Record<string, unknown>) => Result<ToolValue>;
  readonly outputs?: ToolDef['outputs'];
}

/**
 * Makes a tool whose `run` first checks the input against the schema, then runs the body, and turns anything the body
 * throws into an `internal` error (the tool boundary of errors design 5).
 */
export function defineTool(source: ToolSource): ToolDef {
  const run: ToolRun = (target, input) => {
    const problem = checkSchema(source.callSchema ?? source.schema, input);
    if (problem !== undefined || !isObject(input)) return toolInputError(source.name, source.schema, problem ?? 'The input must be an object.');
    try {
      const extra = source.check?.(input, target);
      if (extra !== undefined) return toolInputError(source.name, source.schema, extra);
      return source.body(target, input);
    } catch (e) {
      return faultError(`tool ${source.name}`, e instanceof Error ? e.message : 'unknown');
    }
  };
  return { name: source.name, description: source.description, schema: source.schema, run, ...(source.outputs ? { outputs: source.outputs } : {}) };
}

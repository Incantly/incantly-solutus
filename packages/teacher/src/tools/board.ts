/**
 * The board tools (teacher design 4, board agent.md 1 and 2): `board_read` and `board`. Their names, descriptions and
 * input schemas are the board core's (`BOARD_READ_TOOL`, `BOARD_TOOL`), so the model reads what the board itself checks.
 * They act on `target.board` (`boardTarget`): `board_read` gives the items the request carries, and `board` checks each
 * action and sends on the ones that passed, as `actions` events (the board applies them, one gesture for the answer).
 */
import { ACTIONS_MAX, BOARD_READ_TOOL, BOARD_TOOL } from '@incantly/board/core';
import { defineTool, ok, toolInputError } from './schema';
import type { JsonSchema, ToolDef, TurnOutput } from './types';

const READ_SCHEMA = BOARD_READ_TOOL.inputSchema as unknown as JsonSchema;
const BOARD_SCHEMA = BOARD_TOOL.inputSchema as unknown as JsonSchema;

/**
 * What the whole `board` call is checked against: an `actions` list of 1 to 20. The shape of each action is checked on
 * its own by the target (board agent.md 2: an action that fails does not stop the ones after it), so one bad action gets
 * its own error and the others run. The model still reads `BOARD_SCHEMA`.
 */
const BOARD_CALL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { actions: { type: 'array', minItems: 1, maxItems: ACTIONS_MAX } },
  required: ['actions'],
};

/** The actions of each `board` result that passed, in their checked form, for `outputs`. */
const sent = new WeakMap<object, readonly unknown[]>();

export const boardReadTool: ToolDef = defineTool({
  name: BOARD_READ_TOOL.name,
  description: BOARD_READ_TOOL.description,
  schema: READ_SCHEMA,
  body(target, input) {
    return target.board === undefined ? toolInputError(BOARD_READ_TOOL.name, READ_SCHEMA, 'This job has no board to read.') : target.board.read(input);
  },
});

export const boardTool: ToolDef = defineTool({
  name: BOARD_TOOL.name,
  description: `${BOARD_TOOL.description} The result lists each action in order. The board gives the ids: name the shape the previous action made as "$last".`,
  schema: BOARD_SCHEMA,
  callSchema: BOARD_CALL_SCHEMA,
  body(target, input) {
    if (target.board === undefined) return toolInputError(BOARD_TOOL.name, BOARD_SCHEMA, 'This job has no board to change.');
    const checks = target.board.check(input['actions'] as readonly unknown[]);
    const passed = checks.flatMap((c) => (c.send === undefined ? [] : [c.send]));
    const result = ok({ results: checks.map((c) => c.result), applied: passed.length });
    if (result.ok) sent.set(result.value, passed);
    return result;
  },
  outputs(_input, value): readonly TurnOutput[] {
    const actions = sent.get(value);
    return actions !== undefined && actions.length > 0 ? [{ actions }] : [];
  },
});

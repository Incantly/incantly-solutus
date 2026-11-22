/**
 * Round 3, the board tools and the board target (board agent.md 1 and 2, teacher design 4 and 9, teacher errors.md T001,
 * requirements R2.1, R6.1; server design 5, errors.md). Written from the docs and the public exports only: `board_read`
 * reads the request's items; `board` checks each action as the board would and hands on only what passed.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS_MAX, BOARD_READ_TOOL, BOARD_TOOL, ITEMS_MAX, readAction } from '@incantly/board/core';
import { createHeadlessApp } from '@incantly/sdk';
import { BUILTIN_TOOL_NAMES, boardReadTool, boardTool, figureTarget } from '../../src/index';
import type { ModeName } from './helpers';
import { PAGE, boardTools, callBoard, callRead, makeBoard, manyItems, modelItem, results, sentActions, userItem, valueOf } from './board-helpers';
import { errorOf } from './helpers';

describe('the two tools exist (agent.md 1, R2.1)', () => {
  it('board_read and board are built-in tools with a JSON schema', () => {
    expect(BUILTIN_TOOL_NAMES).toEqual(expect.arrayContaining(['board_read', 'board']));
    const set = boardTools();
    expect(set.names).toEqual(['board_read', 'board']);
    for (const spec of set.specs()) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.schema.type).toBe('object');
    }
    expect(boardReadTool.name).toBe('board_read');
    expect(boardTool.name).toBe('board');
  });

  it('the model reads the schema the board itself checks: names and descriptions come from the board core', () => {
    const specs = boardTools().specs();
    expect(specs.find((s) => s.name === BOARD_READ_TOOL.name)?.description).toContain('board');
    expect(specs.find((s) => s.name === BOARD_TOOL.name)?.description).toContain(String(ACTIONS_MAX));
  });

  it('board takes 1 to 20 actions in its schema; board_read takes an optional area and page', () => {
    const specs = boardTools().specs();
    const actions = specs.find((s) => s.name === 'board')?.schema.properties?.['actions'];
    expect(actions?.type).toBe('array');
    expect(actions?.minItems).toBe(1);
    expect(actions?.maxItems).toBe(20);
    const read = specs.find((s) => s.name === 'board_read')?.schema;
    expect(Object.keys(read?.properties ?? {}).sort()).toEqual(['area', 'page']);
    expect(read?.required ?? []).toEqual([]);
  });

  it('board_read says what the board lists, madeBy included (agent.md 1: the item list holds madeBy)', () => {
    const text = boardTools().specs().find((s) => s.name === 'board_read')?.description ?? '';
    expect(text).toMatch(/madeBy/);
  });
});

describe('board_read from the request items (agent.md 1, design 9)', () => {
  it('gives the items of the request, the page and a count of the rest', () => {
    const items = [userItem('shape:a'), userItem('shape:b', { kind: 'text', text: 'hello' })];
    const v = valueOf(callRead(makeBoard(items)));
    expect(v['page']).toBe(PAGE);
    expect(v['items']).toEqual(items);
    expect(v['more']).toBe(0);
  });

  it('keeps the order the request lists them in (the board sends reading order)', () => {
    const items = [userItem('shape:z', { box: [900, 900, 10, 10] }), userItem('shape:m', { box: [0, 500, 10, 10] }), userItem('shape:a', { box: [0, 0, 10, 10] })];
    const got = valueOf(callRead(makeBoard(items)))['items'] as { id: string }[];
    expect(got.map((i) => i.id)).toEqual(['shape:z', 'shape:m', 'shape:a']);
  });

  it('keeps every field: kind, box, text, summary, shape and madeBy', () => {
    const items = [
      { id: 'shape:c', kind: 'figure', box: [1, 2, 3, 4] as const, summary: 'f(x) = x^2: 1 object', text: 'T' },
      { id: 'shape:d', kind: 'ink', box: [5, 6, 7, 8] as const, shape: 'triangle' },
      { id: 'shape:e', kind: 'text', box: [9, 9, 9, 9] as const, text: 'by agent', madeBy: 'model' as const },
    ];
    expect(valueOf(callRead(makeBoard(items)))['items']).toEqual(items);
  });

  it('lists at most 60 items and says how many it left out', () => {
    expect(ITEMS_MAX).toBe(60);
    const v = valueOf(callRead(makeBoard(manyItems(75))));
    const got = v['items'] as { id: string }[];
    expect(got).toHaveLength(60);
    expect(got[0]?.id).toBe('shape:i1');
    expect(got[59]?.id).toBe('shape:i60');
    expect(v['more']).toBe(15);
  });

  it('exactly 60 items are all listed and nothing is left out', () => {
    const v = valueOf(callRead(makeBoard(manyItems(60))));
    expect(v['items']).toHaveLength(60);
    expect(v['more']).toBe(0);
  });

  it('the request\'s own `more` (items beyond the 60 the board listed) is passed on', () => {
    const v = valueOf(callRead(makeBoard(manyItems(60), {}, 7)));
    expect(v['items']).toHaveLength(60);
    expect(v['more']).toBe(7);
  });

  it('an area gives the items that meet it, in the same order', () => {
    const items = [userItem('shape:in1', { box: [0, 0, 50, 50] }), userItem('shape:far', { box: [5000, 5000, 50, 50] }), userItem('shape:in2', { box: [60, 0, 50, 50] })];
    const got = valueOf(callRead(makeBoard(items), { area: [0, 0, 200, 100] }))['items'] as { id: string }[];
    expect(got.map((i) => i.id)).toEqual(['shape:in1', 'shape:in2']);
  });

  it('an area that holds nothing gives an empty list', () => {
    const v = valueOf(callRead(makeBoard([userItem('shape:a', { box: [0, 0, 10, 10] })]), { area: [900, 900, 10, 10] }));
    expect(v['items']).toEqual([]);
  });

  it('an area with more than 60 items is cut at 60 and counts the rest', () => {
    const v = valueOf(callRead(makeBoard(manyItems(80)), { area: [-10, -10, 1000, 100_000] }));
    expect(v['items']).toHaveLength(60);
    expect(v['more']).toBe(20);
  });

  it('a bad area is tool_input T001, not a throw', () => {
    const out = callRead(makeBoard([userItem('shape:a')]), { area: [1, 2, 3] });
    expect(errorOf(out)).toMatchObject({ kind: 'tool_input', code: 'T001' });
  });

  it('an empty board is an empty list', () => {
    const v = valueOf(callRead(makeBoard([])));
    expect(v['items']).toEqual([]);
    expect(v['more']).toBe(0);
  });

  it('a page the request does not hold is an error the model can read, not a throw', () => {
    const out = callRead(makeBoard([userItem('shape:a')]), { page: 'page:99' });
    expect(out.result.ok).toBe(false);
  });

  it('does not change the request\'s items', () => {
    const items = [userItem('shape:a', { text: 'keep' })];
    const copy = JSON.parse(JSON.stringify(items)) as unknown;
    const target = makeBoard(items);
    callRead(target);
    callRead(target, { area: [0, 0, 1, 1] });
    expect(items).toEqual(copy);
  });
});

describe('board: 1 to 20 actions (agent.md 1, errors.md T001)', () => {
  it('one action passes, is reported ok and is sent on to the client', () => {
    const action = { op: 'write', text: 'hello', at: 'free' };
    const out = callBoard(makeBoard([]), [action]);
    expect(results(out)).toHaveLength(1);
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(sentActions(out)).toEqual([action]);
  });

  it('twenty actions all pass, one result each, in order', () => {
    const actions = Array.from({ length: 20 }, (_v, i) => ({ op: 'write', text: `n${i}`, at: { x: i * 10, y: 0 } }));
    const out = callBoard(makeBoard([]), actions);
    expect(results(out).map((r) => r['ok'])).toEqual(Array(20).fill(true));
    expect(sentActions(out).map((a) => a['text'])).toEqual(actions.map((a) => a.text));
  });

  it('21 actions are tool_input T001 (errors.md), nothing is sent', () => {
    const actions = Array.from({ length: 21 }, () => ({ op: 'write', text: 'x', at: 'free' }));
    const out = callBoard(makeBoard([]), actions);
    expect(errorOf(out)).toMatchObject({ ok: false, kind: 'tool_input', code: 'T001', recovery: 'fix_line' });
    expect(out.outputs).toEqual([]);
  });

  it('no actions, a missing list and a list that is not a list are tool_input T001', () => {
    const t = makeBoard([]);
    for (const input of [[], undefined, 'write', { op: 'write' }]) {
      const out = boardTools().call(t, 'board', { actions: input });
      expect(errorOf(out), JSON.stringify(input)).toMatchObject({ kind: 'tool_input', code: 'T001' });
      expect(out.outputs).toEqual([]);
    }
    expect(errorOf(boardTools().call(t, 'board', {}))).toMatchObject({ kind: 'tool_input' });
  });

  it('the T001 error holds the expected shape in `forms` so the model can fix its call', () => {
    const e = errorOf(callBoard(makeBoard([]), []));
    expect(e.forms.join(' ')).toContain('actions');
  });

  it('arguments that are not JSON are tool_input, not a throw', () => {
    const out = boardTools().call(makeBoard([]), 'board', '{"actions": [');
    expect(errorOf(out)).toMatchObject({ kind: 'tool_input' });
  });

  it('a call to a target with no board says so instead of throwing', () => {
    const rig = createHeadlessApp({ mode: 'geometry' });
    const out = boardTools().call(figureTarget(rig), 'board', { actions: [{ op: 'write', text: 'x', at: 'free' }] });
    expect(out.result.ok).toBe(false);
    expect(out.outputs).toEqual([]);
    expect(boardTools().call(figureTarget(rig), 'board_read', {}).result.ok).toBe(false);
  });
});

describe('every op of agent.md 2 passes when it is well formed', () => {
  const items = [userItem('shape:u1'), modelItem('shape:m1'), modelItem('shape:m2')];
  const good: readonly unknown[] = [
    { op: 'write', text: '$x^2$', at: { x: 0, y: 0 }, style: 'hand', size: 24, color: '#ff0000' },
    { op: 'write', text: 'typed', at: { near: 'shape:u1', side: 'below' }, style: 'typed' },
    { op: 'shape', kind: 'rect', at: 'free', w: 100, h: 50, label: 'A', color: '#00f' },
    { op: 'shape', kind: 'star', at: { x: 5, y: 5 } },
    { op: 'arrow', from: 'shape:u1', to: 'shape:m1', label: 'so' },
    { op: 'arrow', from: [0, 0, 10, 10], to: '$last' },
    { op: 'stroke', points: [[0, 0], [10, 10], [20, 0]], at: { x: 0, y: 0 }, color: '#000', size: 3 },
    { op: 'figure', lines: ['f(x) = x^2'], mode: 'graphing', at: { near: 'shape:u1', side: 'right' }, w: 300, h: 200 },
    { op: 'mark', target: 'shape:u1', how: 'circle' },
    { op: 'mark', target: [0, 0, 50, 50], how: 'highlight' },
    { op: 'point', target: 'shape:u1' },
    { op: 'move', id: 'shape:m1', at: { x: 10, y: 10 } },
    { op: 'edit', id: 'shape:m2', text: 'new words' },
    { op: 'delete', id: 'shape:m2' },
    { op: 'camera', target: 'shape:u1' },
    { op: 'camera', target: 'all' },
    { op: 'page', to: 'new', name: 'Next' },
  ];

  it.each(good.map((a, i) => [`${(a as { op: string }).op} #${i + 1}`, a] as const))('%s', (_name, action) => {
    const out = callBoard(makeBoard(items), [action]);
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(sentActions(out)).toHaveLength(1);
    expect(sentActions(out)[0]).toMatchObject({ op: (action as { op: string }).op });
  });

  it('all of them in two calls of at most 20 leave the target usable', () => {
    const t = makeBoard(items);
    const a = callBoard(t, good.slice(0, 10));
    const b = callBoard(t, good.slice(10));
    expect(results(a).every((r) => r['ok'] === true)).toBe(true);
    expect(results(b).every((r) => r['ok'] === true)).toBe(true);
  });
});

describe('each action is checked by the board core (agent.md 2, server design 5, R4.2)', () => {
  const bad: readonly (readonly [string, unknown])[] = [
    ['write with no text', { op: 'write', at: 'free' }],
    ['write with text of 4001 characters', { op: 'write', text: 'x'.repeat(4001), at: 'free' }],
    ['write with a size of 3', { op: 'write', text: 'x', at: 'free', size: 3 }],
    ['write with no place', { op: 'write', text: 'x' }],
    ['write with a place that is not a place', { op: 'write', text: 'x', at: 'middle' }],
    ['write with a side that does not exist', { op: 'write', text: 'x', at: { near: 'shape:u1', side: 'inside' } }],
    ['write with x that is not a number', { op: 'write', text: 'x', at: { x: 'one', y: 2 } }],
    ['write with x that is infinite', { op: 'write', text: 'x', at: { x: Number.POSITIVE_INFINITY, y: 2 } }],
    ['shape with a width of 0', { op: 'shape', kind: 'rect', at: 'free', w: 0 }],
    ['stroke with one point', { op: 'stroke', points: [[1, 1]], at: 'free' }],
    ['stroke with 2001 points', { op: 'stroke', points: Array.from({ length: 2001 }, (_v, i) => [i, i]), at: 'free' }],
    ['figure with no lines', { op: 'figure', lines: [], at: 'free' }],
    ['figure with 201 lines', { op: 'figure', lines: Array.from({ length: 201 }, () => 'a = 1'), at: 'free' }],
    ['figure too small', { op: 'figure', lines: ['a = 1'], at: 'free', w: 10 }],
    ['mark with an empty target', { op: 'mark', target: '', how: 'box' }],
    ['mark with an area of three numbers', { op: 'mark', target: [0, 0, 1], how: 'box' }],
    ['mark with a negative width', { op: 'mark', target: [0, 0, -1, 5], how: 'box' }],
    ['move with no id', { op: 'move', at: 'free' }],
    ['edit with no text', { op: 'edit', id: 'shape:m1' }],
    ['arrow with no end', { op: 'arrow', from: 'shape:u1' }],
    ['page with no target', { op: 'page' }],
  ];

  it.each(bad)('%s is refused with the board core\'s own error and sent nowhere', (_name, action) => {
    const items = [userItem('shape:u1'), modelItem('shape:m1')];
    const out = callBoard(makeBoard(items), [action]);
    const oracle = readAction(action);
    expect(oracle.ok).toBe(false);
    const r = results(out)[0] as Record<string, unknown>;
    expect(r['ok']).toBe(false);
    expect(r['kind']).toBe('bad_argument');
    expect(r['detail']).toMatchObject({ op: (action as { op: string }).op, field: expect.any(String) });
    expect(sentActions(out)).toEqual([]);
  });

  it('the result of a refused action names the same field as the board core', () => {
    for (const [, action] of bad) {
      const oracle = readAction(action);
      const r = results(callBoard(makeBoard([userItem('shape:u1'), modelItem('shape:m1')]), [action]))[0] as { detail?: { field?: string } };
      if (!oracle.ok) expect(r.detail?.field, JSON.stringify(action).slice(0, 80)).toBe((oracle as unknown as { detail: { field: string } }).detail.field);
    }
  });

  /** Bad in a way the tool's JSON schema also names (an enum, a nested type): the board core refuses each of these on its own too. */
  const schemaBad: readonly (readonly [string, unknown])[] = [
    ['shape of a kind that is not one', { op: 'shape', kind: 'hexagon', at: 'free' }],
    ['stroke with a point that has one number', { op: 'stroke', points: [[1, 1], [2]], at: 'free' }],
    ['figure with a line that is not text', { op: 'figure', lines: [1], at: 'free' }],
    ['mark with a way that is not one', { op: 'mark', target: 'shape:u1', how: 'scribble' }],
  ];

  it.each(schemaBad)('%s is refused (by the board core or the schema) and sent nowhere', (_name, action) => {
    expect(readAction(action).ok).toBe(false);
    const out = callBoard(makeBoard([userItem('shape:u1')]), [action]);
    expect(sentActions(out)).toEqual([]);
    expect(out.result.ok === false || results(out).every((r) => r['ok'] === false)).toBe(true);
  });

  it.each(schemaBad)('%s: only that action fails; the actions around it still run (agent.md 2: "does not stop the actions after it")', (_name, action) => {
    const before = { op: 'write', text: 'before', at: 'free' };
    const after = { op: 'write', text: 'after', at: 'free' };
    const out = callBoard(makeBoard([userItem('shape:u1')]), [before, action, after]);
    expect(out.result.ok, 'the whole call was refused').toBe(true);
    expect(results(out).map((r) => r['ok'])).toEqual([true, false, true]);
    expect(sentActions(out)).toEqual([before, after]);
  });

  it('a bad action changes nothing and does not stop the actions after it (agent.md 2)', () => {
    const goodA = { op: 'write', text: 'before', at: 'free' };
    const goodB = { op: 'shape', kind: 'rect', at: 'free' };
    const out = callBoard(makeBoard([]), [goodA, { op: 'write', at: 'free' }, goodB, { op: 'stroke', points: [[1, 1]], at: 'free' }, { op: 'camera', target: 'all' }]);
    expect(results(out).map((r) => r['ok'])).toEqual([true, false, true, false, true]);
    expect(sentActions(out)).toEqual([goodA, goodB, { op: 'camera', target: 'all' }]);
  });

  it('a wrong value that the JSON schema also names (an op that does not exist) never throws and sends nothing', () => {
    const out = callBoard(makeBoard([]), [{ op: 'explode' }]);
    expect(out.outputs).toEqual([]);
    expect(out.result.ok === false || results(out).every((r) => r['ok'] === false)).toBe(true);
  });

  it('what is sent on is the action as the board reads it, not extra fields the model added', () => {
    const out = callBoard(makeBoard([]), [{ op: 'write', text: 'hi', at: 'free', evil: '<script>' }]);
    const sent = sentActions(out)[0] ?? {};
    expect(sent['evil']).toBeUndefined();
  });
});

describe('what the model may change: allowEdit and madeBy (agent.md 2, board design 11, server design 5)', () => {
  const items = [userItem('shape:user1'), userItem('shape:user2', { kind: 'text', text: 'mine' }), modelItem('shape:agent1'), modelItem('shape:agent2')];
  const ops = (id: string): readonly unknown[] => [
    { op: 'edit', id, text: 'changed' },
    { op: 'move', id, at: { x: 5, y: 5 } },
    { op: 'delete', id },
  ];

  it.each(['edit', 'move', 'delete'])('%s of a shape the user made is agent_refused with reason not_model (allowEdit false)', (op) => {
    const action = ops('shape:user1').find((a) => (a as { op: string }).op === op);
    const out = callBoard(makeBoard(items, { allowEdit: false }), [action]);
    expect(results(out)[0]).toMatchObject({ ok: false, kind: 'agent_refused', detail: { reason: 'not_model' } });
    expect(sentActions(out)).toEqual([]);
  });

  it('allowEdit defaults to false', () => {
    const out = callBoard(makeBoard(items), [{ op: 'delete', id: 'shape:user1' }]);
    expect(results(out)[0]).toMatchObject({ ok: false, kind: 'agent_refused', detail: { reason: 'not_model' } });
  });

  it.each(['edit', 'move', 'delete'])('%s of a shape the agent made passes with allowEdit false', (op) => {
    const action = ops('shape:agent1').find((a) => (a as { op: string }).op === op);
    const out = callBoard(makeBoard(items, { allowEdit: false }), [action]);
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(sentActions(out)).toEqual([action]);
  });

  it.each(['edit', 'move', 'delete'])('%s of a shape the user made passes with allowEdit true', (op) => {
    const action = ops('shape:user2').find((a) => (a as { op: string }).op === op);
    const out = callBoard(makeBoard(items, { allowEdit: true }), [action]);
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(sentActions(out)).toEqual([action]);
  });

  it('a refusal does not stop the actions after it, and only what passed is sent', () => {
    const keep = { op: 'write', text: 'new', at: { near: 'shape:user1', side: 'right' } };
    const out = callBoard(makeBoard(items), [{ op: 'delete', id: 'shape:user1' }, keep, { op: 'delete', id: 'shape:agent2' }]);
    expect(results(out).map((r) => r['ok'])).toEqual([false, true, true]);
    expect(sentActions(out)).toEqual([keep, { op: 'delete', id: 'shape:agent2' }]);
  });

  it('new shapes, marks, arrows and points may use the user\'s shapes without allowEdit', () => {
    const actions = [
      { op: 'write', text: 'x', at: { near: 'shape:user1', side: 'above' } },
      { op: 'arrow', from: 'shape:user1', to: 'shape:user2' },
      { op: 'mark', target: 'shape:user1', how: 'circle' },
      { op: 'point', target: 'shape:user2' },
      { op: 'camera', target: 'shape:user1' },
    ];
    const out = callBoard(makeBoard(items), actions);
    expect(results(out).every((r) => r['ok'] === true)).toBe(true);
    expect(sentActions(out)).toEqual(actions);
  });

  it('the shape the previous action made, $last, is the agent\'s own: edit, move and delete of it pass', () => {
    const actions = [
      { op: 'shape', kind: 'rect', at: 'free' },
      { op: 'move', id: '$last', at: { x: 1, y: 1 } },
      { op: 'edit', id: '$last', text: 'label' },
      { op: 'delete', id: '$last' },
    ];
    const out = callBoard(makeBoard(items), actions);
    expect(results(out).map((r) => r['ok'])).toEqual([true, true, true, true]);
  });

  it('a shape that is not among the items is agent_refused when the request lists them all (more = 0)', () => {
    const t = makeBoard(items, { allowEdit: true }, 0);
    for (const action of [
      { op: 'edit', id: 'shape:ghost', text: 'x' },
      { op: 'move', id: 'shape:ghost', at: 'free' },
      { op: 'delete', id: 'shape:ghost' },
      { op: 'mark', target: 'shape:ghost', how: 'box' },
      { op: 'point', target: 'shape:ghost' },
      { op: 'arrow', from: 'shape:ghost', to: 'shape:user1' },
      { op: 'arrow', from: 'shape:user1', to: 'shape:ghost' },
      { op: 'write', text: 'x', at: { near: 'shape:ghost', side: 'below' } },
      { op: 'camera', target: 'shape:ghost' },
    ]) {
      const out = callBoard(t, [action]);
      expect(results(out)[0], JSON.stringify(action)).toMatchObject({ ok: false, kind: 'agent_refused' });
      expect(sentActions(out)).toEqual([]);
    }
  });

  it('a shape that is not among the items is NOT refused when the area held more than the request lists (more > 0)', () => {
    const t = makeBoard(items, { allowEdit: true }, 12);
    const out = callBoard(t, [{ op: 'mark', target: 'shape:elsewhere', how: 'box' }, { op: 'delete', id: 'shape:elsewhere' }]);
    expect(results(out).map((r) => r['ok'])).toEqual([true, true]);
  });

  it('an unknown shape is also unknown for an agent that may edit', () => {
    const out = callBoard(makeBoard(items, { allowEdit: true }), [{ op: 'delete', id: 'shape:ghost' }]);
    expect(results(out)[0]).toMatchObject({ ok: false, kind: 'agent_refused' });
  });

  it('an area target needs no shape and always passes', () => {
    const out = callBoard(makeBoard([]), [{ op: 'mark', target: [0, 0, 20, 20], how: 'underline' }, { op: 'camera', target: [0, 0, 400, 300] }]);
    expect(results(out).every((r) => r['ok'] === true)).toBe(true);
  });

  it('refusals are plain data (no throw, JSON-safe) with a message and a hint for the model', () => {
    const r = results(callBoard(makeBoard(items), [{ op: 'delete', id: 'shape:user1' }]))[0] as Record<string, unknown>;
    expect(typeof r['message']).toBe('string');
    expect(typeof r['hint']).toBe('string');
    expect(() => JSON.stringify(r)).not.toThrow();
  });
});

describe('a figure action runs its lines on a headless app (agent.md 2, server design 5, R4.1)', () => {
  const figure = (lines: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ op: 'figure', lines, at: 'free', ...extra });
  type LineRow = { ok: boolean; kind?: string; line?: number; name?: string; blockedBy?: unknown; message?: string };
  const lineRows = (out: ReturnType<typeof callBoard>, i = 0): LineRow[] => (results(out)[i] as { lines: LineRow[] }).lines;

  it('good lines pass, one row each with name and type as draw gives them', () => {
    const out = callBoard(makeBoard([]), [figure(['c = Circle((0, 0), 2)', 'P = PointOn(c)'], { mode: 'geometry' })]);
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(lineRows(out)).toMatchObject([
      { ok: true, name: 'c', type: 'Circle' },
      { ok: true, name: 'P', type: expect.any(String) },
    ]);
    expect(sentActions(out)[0]).toMatchObject({ op: 'figure', lines: ['c = Circle((0, 0), 2)', 'P = PointOn(c)'], mode: 'geometry' });
  });

  it('a bad line is dropped with the kernel\'s own error, and the good lines are sent', () => {
    const out = callBoard(makeBoard([]), [figure(['c = Circle((0, 0), 2)', 'P = PointOn(nope)', 'd = 3'], { mode: 'geometry' })]);
    const rows = lineRows(out);
    expect(rows.map((r) => r.ok)).toEqual([true, false, true]);
    expect(rows[1]).toMatchObject({ kind: 'unknown_name', line: 2, committed: false });
    expect(typeof rows[1]?.message).toBe('string');
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(sentActions(out)[0]?.['lines']).toEqual(['c = Circle((0, 0), 2)', 'd = 3']);
  });

  it('a later line that reads a name a failed line was to make is blocked, as in draw (core design 10)', () => {
    const out = callBoard(makeBoard([]), [figure(['P = PointOn(nope)', 'Q = PointOn(P)', 'k = 1'], { mode: 'geometry' })]);
    const rows = lineRows(out);
    expect(rows[1]).toMatchObject({ ok: false, recovery: 'fix_earlier', blockedBy: { line: 1 } });
    expect(sentActions(out)[0]?.['lines']).toEqual(['k = 1']);
  });

  it('the bad line never reaches the client: its text is in no sent action', () => {
    const out = callBoard(makeBoard([]), [figure(['good = 1', 'PointOn(nope) +'], { mode: 'geometry' })]);
    expect(JSON.stringify(sentActions(out))).not.toContain('PointOn(nope)');
  });

  it('when no line runs the action fails with a board error, lists the line errors and sends nothing', () => {
    const out = callBoard(makeBoard([]), [figure(['P = PointOn(nope)', 'oops oops'], { mode: 'geometry' })]);
    const r = results(out)[0] as { ok: boolean; kind: string; detail?: { lines?: unknown[] } };
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('figure_failed');
    expect(r.detail?.lines).toHaveLength(2);
    expect(sentActions(out)).toEqual([]);
  });

  it('a mode the app does not have fails the lines and sends nothing', () => {
    const out = callBoard(makeBoard([]), [figure(['x = 1'], { mode: 'nonsense' })]);
    expect(results(out)[0]).toMatchObject({ ok: false });
    expect(sentActions(out)).toEqual([]);
  });

  it('the mode defaults to graphing and "graph" means graphing (board core\'s sdkMode)', () => {
    const a = callBoard(makeBoard([]), [figure(['f(x) = x^2'])]);
    const b = callBoard(makeBoard([]), [figure(['f(x) = x^2'], { mode: 'graph' })]);
    expect(results(a)[0]).toMatchObject({ ok: true });
    expect(results(b)[0]).toMatchObject({ ok: true });
  });

  it('each figure card is its own figure: two cards may use the same name, and one does not see the other\'s names', () => {
    const out = callBoard(makeBoard([]), [figure(['c = Circle((0, 0), 2)'], { mode: 'geometry' }), figure(['c = Circle((1, 1), 3)'], { mode: 'geometry' }), figure(['P = PointOn(c)'], { mode: 'geometry' })]);
    expect(results(out).map((r) => r['ok'])).toEqual([true, true, false]);
    expect(sentActions(out)).toHaveLength(2);
  });

  it('a figure card runs under its mode\'s gate: the same answers as a headless app of that mode', () => {
    const lines = ['c = Circle((0, 0), 2)', 'f(x) = x^2', 'a = 2 + 3', 'X = Normal(0, 1)', 'g = Derivative(x^2)'];
    for (const mode of ['graphing', 'geometry', 'scientific', 'probability', 'classic'] as const) {
      const app = createHeadlessApp({ mode: mode as ModeName });
      const oracle = lines.map((l) => figureTarget(app).run([l])[0]?.ok === true);
      app.destroy();
      const rows = lines.map((l) => {
        const out = callBoard(makeBoard([]), [figure([l], { mode })]);
        return (results(out)[0] as { ok: boolean }).ok;
      });
      expect(rows, mode).toEqual(oracle);
    }
  });

  it('a figure of 30 good lines passes (more than the five a draw call takes)', () => {
    const lines = Array.from({ length: 30 }, (_v, i) => `a${i} = ${i}`);
    const out = callBoard(makeBoard([]), [figure(lines)]);
    expect(results(out)[0]).toMatchObject({ ok: true });
    expect(sentActions(out)[0]?.['lines']).toEqual(lines);
  });

  it('lines of one figure are independent: a failed middle line does not undo the first', () => {
    const out = callBoard(makeBoard([]), [figure(['a = 1', 'b = nope + 1', 'c = a + 1'])]);
    expect(lineRows(out).map((r) => r.ok)).toEqual([true, false, true]);
  });

  it('a figure card never changes the target: the same figure again gives the same answer', () => {
    const t = makeBoard([]);
    const one = callBoard(t, [figure(['a = 1', 'b = a + 1'])]);
    const two = callBoard(t, [figure(['a = 1', 'b = a + 1'])]);
    expect(JSON.stringify(results(one))).toBe(JSON.stringify(results(two)));
  });
});

describe('the board target (design 9)', () => {
  it('is a board target of the mode it was made with, graphing by default', () => {
    expect(makeBoard([]).kind).toBe('board');
    expect(makeBoard([]).mode).toBe('graphing');
    expect(makeBoard([], { mode: 'geometry' }).mode).toBe('geometry');
  });

  it('describes the board: the page, how many items, how many more, the circle\'s area, and every item', () => {
    const t = makeBoard([userItem('shape:a', { text: 'alpha' }), modelItem('shape:b')], {}, 3, { circle: [10, 20, 30, 40] });
    const d = t.board?.describe();
    expect(d?.head).toContain(PAGE);
    expect(d?.head).toContain('3');
    expect(d?.head).toContain('10, 20, 30, 40');
    expect(d?.items).toContain('shape:a');
    expect(d?.items).toContain('alpha');
    expect(d?.items).toContain('shape:b');
  });

  it('has no figure of its own: running lines on it is an error per line, not a throw', () => {
    const t = makeBoard([]);
    const rows = t.run(['a = 1', 'b = 2']);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(t.figureSummary().objects).toBe(0);
    expect(t.objects().list).toEqual([]);
  });

  it('two calls at once on one target are not run together: a busy target answers tool_busy T002', () => {
    const t = makeBoard([]);
    expect(t.guard.enter()).toBe(true);
    const out = boardTools().call(t, 'board_read', {});
    expect(errorOf(out)).toMatchObject({ kind: 'tool_busy' });
    t.guard.leave();
    expect(boardTools().call(t, 'board_read', {}).result.ok).toBe(true);
  });
});

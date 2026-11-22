/**
 * Tools (teacher design 4, errors.md T001 T002 T004, requirements R2, R7): `draw`, `figure`, the toolset, the guard.
 * Written from the docs and the public exports.
 */
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { BUILTIN_TOOL_NAMES, DRAW_MAX_LINES, ToolGuard, TOOL_MACHINE, defineTool, figureTarget, toolset } from '../../src/index';
import { drawLines, errorOf, makeRig, namesOn, tools, valueOf } from './helpers';
import type { ModeName } from './helpers';

describe('the built-in tools (R2.1)', () => {
  it('draw and figure are tool definitions with a JSON schema', () => {
    const set = tools(['draw', 'figure']);
    expect(set.names).toEqual(['draw', 'figure']);
    for (const spec of set.specs()) {
      expect(spec.name).toMatch(/^[a-z_]+$/);
      expect(spec.description.length).toBeGreaterThan(10);
      expect(spec.schema.type).toBe('object');
    }
    expect(BUILTIN_TOOL_NAMES).toEqual(expect.arrayContaining(['draw', 'figure']));
  });

  it('draw takes 1 to 5 lines of text in its schema', () => {
    const draw = tools().specs().find((s) => s.name === 'draw');
    const lines = draw?.schema.properties?.['lines'];
    expect(lines?.type).toBe('array');
    expect(lines?.minItems).toBe(1);
    expect(lines?.maxItems).toBe(5);
    expect(lines?.items?.type).toBe('string');
    expect(DRAW_MAX_LINES).toBe(5);
  });
});

describe('draw: good lines (design 4, R2.3)', () => {
  it('one line commits and is reported as { ok, name, type, summary }', () => {
    const { target } = makeRig('geometry');
    const out = tools().call(target, 'draw', { lines: ['c = Circle((0, 0), 2)'] });
    const [r] = drawLines(out);
    expect(r).toMatchObject({ ok: true, name: 'c', type: 'Circle' });
    expect(typeof r?.['summary']).toBe('string');
    expect(namesOn(target)).toEqual(['c']);
  });

  it('five lines all commit, in order, and later lines may use earlier ones', () => {
    const { target } = makeRig('geometry');
    const lines = ['c = Circle((0, 0), 2)', 'P = PointOn(c)', 'tn = Tangent(P, c)', 'a = 3', 'b = a + 1'];
    const rows = drawLines(tools().call(target, 'draw', { lines }));
    expect(rows.map((r) => r['ok'])).toEqual([true, true, true, true, true]);
    expect(rows.map((r) => r['name'])).toEqual(['c', 'P', 'tn', 'a', 'b']);
    expect(namesOn(target)).toEqual(['P', 'a', 'b', 'c', 'tn']);
  });

  it('the snippets of agent.md 3 draw as written', () => {
    const { target } = makeRig('geometry');
    const set = tools();
    const first = drawLines(set.call(target, 'draw', { lines: ['c = Circle((0, 0), 2)'] }));
    const second = drawLines(set.call(target, 'draw', { lines: ['P = PointOn(c)', 'tg = Tangent(P, c)'] }));
    expect([...first, ...second].map((r) => r['ok'])).toEqual([true, true, true]);
  });

  it('the result lists undefined objects with their reasons', () => {
    const { target } = makeRig('graphing');
    const out = valueOf(tools().call(target, 'draw', { lines: ['a = 0', 'b = 1 / a'] }));
    const undef = out['undefined'];
    expect(Array.isArray(undef)).toBe(true);
    expect(undef).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'b', reason: expect.any(String) })]));
  });
});

describe('draw: independent lines (R2.2, errors design 6 rules 1 and 2)', () => {
  it('a bad line changes nothing and does not undo the lines before it, nor stop the ones after', () => {
    const { target } = makeRig('graphing');
    const rows = drawLines(tools().call(target, 'draw', { lines: ['a = 1', 'b = (', 'c = a + 1'] }));
    expect(rows.map((r) => r['ok'])).toEqual([true, false, true]);
    expect(namesOn(target)).toEqual(['a', 'c']);
  });

  it('a failing line leaves the figure exactly as it was', () => {
    const { target } = makeRig('graphing', 'a = 5\n');
    const before = JSON.stringify(target.objects().list);
    const rows = drawLines(tools().call(target, 'draw', { lines: ['q = nonsense_name + 1'] }));
    expect(rows[0]?.['ok']).toBe(false);
    expect(JSON.stringify(target.objects().list)).toBe(before);
  });

  it('a line that reads an object a failed line did not make is blocked by it (errors design 6.2)', () => {
    const { target } = makeRig('graphing');
    const rows = drawLines(tools().call(target, 'draw', { lines: ['m = zzz + 1', 'n = m + 1'] }));
    expect(rows[0]?.['ok']).toBe(false);
    expect(rows[1]?.['ok']).toBe(false);
    expect(rows[1]).toMatchObject({ recovery: 'fix_earlier', blockedBy: { line: 1 } });
  });

  it('the batch of one call is not atomic: lines before and after a failure stay', () => {
    const { target } = makeRig('graphing');
    drawLines(tools().call(target, 'draw', { lines: ['a = 1', 'a = (', 'b = 2'] }));
    expect(namesOn(target)).toEqual(['a', 'b']);
  });
});

describe('draw: the kernel error object is passed on unchanged (R2.3, errors.md notes)', () => {
  const lines = ['a = 1', 'b = (', 'c = missing + 1', 'd = a + 1', 'e = Circle(1, 2, 3, 4)'];

  it('each failed line is the object the SDK app gives for the same line, deeply equal', () => {
    const { target } = makeRig('geometry');
    const reference = createHeadlessApp({ mode: 'geometry' as ModeName }).run(lines);
    const rows = drawLines(tools().call(target, 'draw', { lines }));
    expect(rows).toHaveLength(lines.length);
    rows.forEach((row, i) => {
      const expected = reference[i] as unknown as Record<string, unknown>;
      if (expected['ok'] === false) expect(row).toEqual(expected);
      else expect(row).toMatchObject({ ok: true, name: expected['name'], type: expected['type'], summary: expected['summary'] });
    });
    expect(rows.some((r) => r['ok'] === false)).toBe(true);
  });

  it('a failed line carries the fields the model reads to fix it (errors design 3)', () => {
    const { target } = makeRig('graphing');
    const [r] = drawLines(tools().call(target, 'draw', { lines: ['b = (' ] }));
    expect(r).toMatchObject({ ok: false, committed: false, severity: 'error' });
    for (const field of ['kind', 'code', 'phase', 'message', 'line', 'col', 'endCol', 'token', 'expected', 'forms', 'suggest', 'recovery', 'fingerprint']) {
      expect(r).toHaveProperty(field);
    }
    expect(r?.['line']).toBe(1);
  });

  it('line numbers are the line\'s place in the call (errors design 3.3)', () => {
    const { target } = makeRig('graphing');
    const rows = drawLines(tools().call(target, 'draw', { lines: ['a = 1', 'b = 2', 'c = ('] }));
    expect(rows[2]?.['line']).toBe(3);
  });
});

describe('draw: malformed calls are tool_input T001 (R2.4, errors.md)', () => {
  const bad: readonly [string, unknown][] = [
    ['six lines', { lines: ['a=1', 'b=2', 'c=3', 'd=4', 'e=5', 'f=6'] }],
    ['no lines', { lines: [] }],
    ['no lines field', {}],
    ['lines not a list', { lines: 'a = 1' }],
    ['a non-text line', { lines: ['a = 1', 7] }],
    ['null', null],
    ['a list instead of an object', ['a = 1']],
    ['arguments that are not JSON', '{"lines": ["a = 1"'],
  ];
  for (const [name, args] of bad) {
    it(`${name}`, () => {
      const { target } = makeRig('graphing');
      const e = errorOf(tools().call(target, 'draw', args));
      expect(e).toMatchObject({ ok: false, kind: 'tool_input', code: 'T001' });
      expect(e.message).toMatch(/draw needs/);
      expect(e.forms.length).toBeGreaterThan(0);
      expect(e.recovery).toBe('fix_line');
      expect(namesOn(target)).toEqual([]);
    });
  }

  it('arguments as JSON text are read like parsed data', () => {
    const { target } = makeRig('graphing');
    const rows = drawLines(tools().call(target, 'draw', '{"lines": ["a = 1"]}'));
    expect(rows[0]).toMatchObject({ ok: true, name: 'a' });
  });
});

describe('tool_busy T002 (R2.4)', () => {
  it('a call while another runs on the same target gets tool_busy and is not run', () => {
    const { target } = makeRig('graphing');
    expect(target.guard.enter()).toBe(true);
    const e = errorOf(tools().call(target, 'draw', { lines: ['a = 1'] }));
    expect(e).toMatchObject({ kind: 'tool_busy', code: 'T002', recovery: 'skip' });
    expect(e.message).toBe('The figure is busy; try again.');
    expect(namesOn(target)).toEqual([]);
    expect(target.guard.busy).toBe(true);
  });

  it('the busy answer does not end the call that is running', () => {
    const { target } = makeRig('graphing');
    target.guard.enter();
    tools().call(target, 'figure', {});
    expect(target.guard.busy).toBe(true);
    target.guard.leave();
    expect(target.guard.busy).toBe(false);
  });

  it('the target is free again after a call, also after an error', () => {
    const { target } = makeRig('graphing');
    const set = tools();
    set.call(target, 'draw', { lines: ['b = ('] });
    expect(target.guard.busy).toBe(false);
    set.call(target, 'draw', {});
    expect(target.guard.busy).toBe(false);
    set.call(target, 'nope', {});
    expect(target.guard.busy).toBe(false);
    expect(drawLines(set.call(target, 'draw', { lines: ['a = 1'] }))[0]).toMatchObject({ ok: true });
  });

  it('two targets do not block each other', () => {
    const one = makeRig('graphing');
    const two = makeRig('graphing');
    one.target.guard.enter();
    expect(drawLines(tools().call(two.target, 'draw', { lines: ['a = 1'] }))[0]).toMatchObject({ ok: true });
  });

  it('TOOL_MACHINE has two states and two rows (docs/state-machines.md TE2)', () => {
    expect(TOOL_MACHINE).toEqual({ idle: { begin: 'running' }, running: { end: 'idle' } });
  });

  it('ToolGuard refuses nothing it is asked in the wrong state and reports no fault', () => {
    const faults: unknown[] = [];
    const guard = new ToolGuard((e) => faults.push(e));
    guard.leave();
    expect(guard.enter()).toBe(true);
    expect(guard.enter()).toBe(false);
    guard.leave();
    guard.leave();
    expect(faults).toEqual([]);
  });
});

describe('tool_unknown T004 (R2.4)', () => {
  it('an unknown tool is tool_unknown and expected lists the toolset', () => {
    const { target } = makeRig('graphing');
    const e = errorOf(tools().call(target, 'erase', {}));
    expect(e).toMatchObject({ ok: false, kind: 'tool_unknown', code: 'T004', recovery: 'fix_line' });
    expect(e.message).toBe('There is no tool erase; the tools are draw, figure.');
    expect(e.expected).toEqual(['draw', 'figure']);
  });

  it('a tool left out of the job\'s toolset is unknown even when this package ships it', () => {
    const { target } = makeRig('graphing');
    const e = errorOf(tools(['figure']).call(target, 'draw', { lines: ['a = 1'] }));
    expect(e.kind).toBe('tool_unknown');
    expect(e.expected).toEqual(['figure']);
    expect(namesOn(target)).toEqual([]);
  });
});

describe('toolsets (R2.5)', () => {
  it('are built from any subset', () => {
    expect(tools(['draw']).names).toEqual(['draw']);
    expect(tools(['figure']).has('draw')).toBe(false);
    expect(tools(['figure', 'draw']).names).toEqual(['figure', 'draw']);
  });

  it('a host adds its own tool of the same shape and it runs through the same guard', () => {
    const echo = defineTool({
      name: 'echo',
      description: 'Echoes a word back to the model.',
      schema: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
      body: (_target, input) => ({ ok: true, value: { said: input['word'] }, notices: [] }),
    });
    const r = toolset(['draw'], [echo]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { target } = makeRig('graphing');
    expect(r.value.has('echo')).toBe(true);
    expect(valueOf(r.value.call(target, 'echo', { word: 'hi' }))).toEqual({ said: 'hi' });
    expect(errorOf(r.value.call(target, 'echo', {})).kind).toBe('tool_input');
    target.guard.enter();
    expect(errorOf(r.value.call(target, 'echo', { word: 'hi' })).kind).toBe('tool_busy');
  });

  it('a tool that throws becomes an error result, never a throw (R7)', () => {
    const boom = defineTool({
      name: 'boom',
      description: 'Always fails inside.',
      schema: { type: 'object' },
      body: () => {
        throw new Error('inside');
      },
    });
    const r = toolset(['figure'], [boom]);
    if (!r.ok) throw new Error('toolset failed');
    const { target } = makeRig('graphing');
    const out = r.value.call(target, 'boom', {});
    expect(out.result.ok).toBe(false);
    expect(target.guard.busy).toBe(false);
  });

  it('asking for a name nobody has does not throw', () => {
    expect(() => toolset(['no_such_tool'])).not.toThrow();
  });

  it('specs are what the model is told: name, description and schema only', () => {
    for (const spec of tools().specs()) expect(Object.keys(spec).sort()).toEqual(['description', 'name', 'schema']);
  });
});

describe('figure (design 4)', () => {
  it('lists every object with name, type, value summary and visible', () => {
    const { target } = makeRig('geometry');
    tools().call(target, 'draw', { lines: ['c = Circle((0, 0), 2)', 'P = PointOn(c)'] });
    const v = valueOf(tools().call(target, 'figure', {}));
    const objects = v['objects'] as Record<string, unknown>[];
    expect(objects.map((o) => o['name']).sort()).toEqual(['P', 'c']);
    for (const o of objects) {
      expect(typeof o['type']).toBe('string');
      expect(typeof o['summary']).toBe('string');
      expect(typeof o['visible']).toBe('boolean');
    }
    expect(objects.find((o) => o['name'] === 'c')?.['type']).toBe('Circle');
  });

  it('gives the reason an undefined object is undefined', () => {
    const { target } = makeRig('graphing');
    tools().call(target, 'draw', { lines: ['a = 0', 'b = 1 / a'] });
    const v = valueOf(tools().call(target, 'figure', {}));
    const b = (v['objects'] as Record<string, unknown>[]).find((o) => o['name'] === 'b');
    expect(b).toBeDefined();
    expect(JSON.stringify(b)).toMatch(/reason|undefined/i);
    expect(v['undefined']).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'b', reason: expect.any(String) })]));
  });

  it('takes `{}` and changes nothing', () => {
    const { target } = makeRig('graphing', 'a = 1\n');
    const before = JSON.stringify(target.objects().list);
    valueOf(tools().call(target, 'figure', {}));
    expect(JSON.stringify(target.objects().list)).toBe(before);
  });

  it('an empty figure lists no objects', () => {
    const { target } = makeRig('graphing');
    const v = valueOf(tools().call(target, 'figure', {}));
    expect(v['objects']).toEqual([]);
  });
});

describe('figureTarget (design 9, R6.1)', () => {
  it('wraps an SDK app: kind, mode, line limit, clock', () => {
    const app = createHeadlessApp({ mode: 'geometry' as ModeName });
    const target = figureTarget(app);
    expect(target.kind).toBe('figure');
    expect(target.mode).toBe('geometry');
    expect(target.lineLimit).toBeGreaterThan(50);
    expect(typeof target.clock.t).toBe('number');
  });

  it('runs lines through the app, so the app sees them', () => {
    const app = createHeadlessApp({ mode: 'graphing' as ModeName });
    const target = figureTarget(app);
    tools().call(target, 'draw', { lines: ['k = 4'] });
    expect(app.list().map((o) => o.name)).toEqual(['k']);
  });

  it('gives figureSummary and undefinedObjects', () => {
    const { target } = makeRig('graphing');
    tools().call(target, 'draw', { lines: ['a = 0', 'b = 1 / a'] });
    expect(target.figureSummary().objects).toBe(2);
    expect(target.undefinedObjects().map((u) => u.name)).toEqual(['b']);
  });
});

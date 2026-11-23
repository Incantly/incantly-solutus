/**
 * Round 4, the film tools `pause`, `resume`, `seek_beat` and `show_me` (teacher design 4, 9; agent.md 3; requirements R2.1 and
 * R6.2; core design 10). Written from the docs and the package's public exports: a toolset over a figure target, and over a
 * live board target (`liveTarget`) whose card in focus is the request's script.
 */
import { createHeadlessApp } from '@incantly/sdk';
import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOL_NAMES, FILM_TOOLS, boardTarget, figureTarget, liveTarget, toolset } from '../../src/index';
import type { Target } from '../../src/index';
import { drawLines, errorOf, makeRig, tools, valueOf } from './helpers';

const FILM = ['pause', 'resume', 'seek_beat', 'show_me'] as const;
const SCRIPT = '@clock 0..30\na = 1 in 0..5 step 0.5\np = (1, 2)\nflag = true\nlabel = "hi"';

const film = (script: string = SCRIPT) => {
  const rig = makeRig('graphing', script);
  return { ...rig, tools: tools(['draw', 'figure', ...FILM]) };
};

describe('the film tools are tools of the package (R2.1, design 4)', () => {
  it('all four are built-in names and a toolset can be made from them, with a JSON schema each', () => {
    for (const name of FILM) expect(BUILTIN_TOOL_NAMES).toContain(name);
    const set = tools([...FILM]);
    expect(set.names).toEqual([...FILM]);
    for (const spec of set.specs()) {
      expect(spec.description.length).toBeGreaterThan(10);
      expect(spec.schema.type).toBe('object');
    }
    expect(FILM_TOOLS.map((t) => t.name)).toEqual([...FILM]);
  });

  it('the schemas ask for what design 4 lists: seek_beat needs t; show_me needs name and value and takes nothing else (a timed move is later, TR-34)', () => {
    const specs = Object.fromEntries(tools([...FILM]).specs().map((s) => [s.name, s.schema]));
    expect(specs['seek_beat']?.required).toEqual(['t']);
    expect(Object.keys(specs['seek_beat']?.properties ?? {})).toEqual(['t']);
    expect(specs['show_me']?.required).toContain('name');
    expect(Object.keys(specs['show_me']?.properties ?? {}).sort()).toEqual(['name', 'value']);
    expect(Object.keys(specs['pause']?.properties ?? {})).toEqual([]);
    expect(Object.keys(specs['resume']?.properties ?? {})).toEqual([]);
  });

  // TR-44: removed with the timed form (TR-34): SHOW_SECONDS_MAX no longer exists

  it('a host may leave the film tools out (Tiptap offers draw and figure only)', () => {
    const set = tools(['draw', 'figure']);
    for (const name of FILM) expect(set.has(name)).toBe(false);
    const r = toolset(['draw', 'figure']);
    expect(r.ok).toBe(true);
  });
});

describe('pause and resume (design 4: result { ok: true, t }, and a control event for the client)', () => {
  it('pause stops the clock and gives { ok: true, t } and a pause control', () => {
    const f = film();
    f.app.clock.play();
    expect(f.app.clock.playing).toBe(true);
    const out = f.tools.call(f.target, 'pause', {});
    expect(valueOf(out)).toMatchObject({ ok: true, t: expect.any(Number) });
    expect(f.app.clock.playing).toBe(false);
    expect(out.outputs).toEqual([{ control: { op: 'pause' } }]);
  });

  it('resume plays the clock again and gives a resume control', () => {
    const f = film();
    const out = f.tools.call(f.target, 'resume', {});
    expect(valueOf(out)).toMatchObject({ ok: true });
    expect(f.app.clock.playing).toBe(true);
    expect(out.outputs).toEqual([{ control: { op: 'resume' } }]);
  });

  it('the t of the result is the film time the clock stands at', () => {
    const f = film();
    f.app.clock.seek(7.5);
    expect(valueOf(f.tools.call(f.target, 'pause', {}))['t']).toBe(7.5);
    expect(valueOf(f.tools.call(f.target, 'resume', {}))['t']).toBe(7.5);
  });

  it('pausing twice and resuming twice are fine (no error, the control is sent each time)', () => {
    const f = film();
    expect(f.tools.call(f.target, 'pause', {}).result.ok).toBe(true);
    expect(f.tools.call(f.target, 'pause', {}).result.ok).toBe(true);
    expect(f.tools.call(f.target, 'resume', {}).result.ok).toBe(true);
    const again = f.tools.call(f.target, 'resume', {});
    expect(again.result.ok).toBe(true);
    expect(again.outputs).toEqual([{ control: { op: 'resume' } }]);
  });

  it('arguments as JSON text work too, and an empty object is the only input', () => {
    const f = film();
    expect(f.tools.call(f.target, 'pause', '{}').result.ok).toBe(true);
    expect(f.tools.call(f.target, 'resume', '').result.ok).toBe(true);
  });
});

describe('seek_beat (design 4: { t } in, { ok: true, t } out, a control event with the time the target stands at)', () => {
  it('moves the film to t and sends { op: "seek", t }', () => {
    const f = film();
    const out = f.tools.call(f.target, 'seek_beat', { t: 12.5 });
    expect(valueOf(out)).toMatchObject({ ok: true, t: 12.5 });
    expect(f.app.clock.t).toBe(12.5);
    expect(out.outputs).toEqual([{ control: { op: 'seek', t: 12.5 } }]);
  });

  it('keeps the play state of the film', () => {
    const f = film();
    f.app.clock.play();
    f.tools.call(f.target, 'seek_beat', { t: 3 });
    expect(f.app.clock.playing).toBe(true);
    f.app.clock.pause();
    f.tools.call(f.target, 'seek_beat', { t: 4 });
    expect(f.app.clock.playing).toBe(false);
  });

  it('a time past the end of the film is clamped, and the control carries the time the figure stands at', () => {
    const f = film();
    const out = f.tools.call(f.target, 'seek_beat', { t: 900 });
    const t = valueOf(out)['t'] as number;
    expect(t).toBeLessThanOrEqual(30);
    expect(f.app.clock.t).toBe(t);
    expect(out.outputs).toEqual([{ control: { op: 'seek', t } }]);
  });

  it.each([
    ['no t', {}],
    ['t as text', { t: 'soon' }],
    ['a negative t', { t: -1 }],
    ['t = NaN as null', { t: null }],
    ['a list', { t: [1] }],
  ])('%s: tool_input (T001), the clock does not move, no control is sent', (_name, input) => {
    const f = film();
    f.app.clock.seek(5);
    const out = f.tools.call(f.target, 'seek_beat', input);
    expect(errorOf(out).kind).toBe('tool_input');
    expect(out.outputs).toEqual([]);
    expect(f.app.clock.t).toBe(5);
  });
});

describe('show_me writes a SetValue line through draw (design 4)', () => {
  it('{ name, value: number } moves a slider and gives the draw result of the line', () => {
    const f = film();
    const out = f.tools.call(f.target, 'show_me', { name: 'a', value: 2 });
    const lines = drawLines(out);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ok: true });
    expect(f.target.objects().list.find((o) => o.name === 'a')?.summary ?? '').toContain('2');
    expect(out.outputs).toEqual([{ lines: ['SetValue(a, 2)'] }]);
  });

  it('true or false, a text and a point [x, y] are written as the language writes them', () => {
    const f = film();
    expect(f.tools.call(f.target, 'show_me', { name: 'flag', value: false }).outputs).toEqual([{ lines: ['SetValue(flag, false)'] }]);
    expect(f.tools.call(f.target, 'show_me', { name: 'label', value: 'hello' }).outputs).toEqual([{ lines: ['SetValue(label, "hello")'] }]);
    expect(f.tools.call(f.target, 'show_me', { name: 'p', value: [3, 4] }).outputs).toEqual([{ lines: ['SetValue(p, (3, 4))'] }]);
  });

  // TR-44 (review r4): the timed form is not built (TR-34); these tests rested on it and now say it is not accepted
  it('the timed form { name, to, seconds } is not offered: it is tool_input and writes nothing', () => {
    const f = film();
    const out = f.tools.call(f.target, 'show_me', { name: 'a', to: 4, seconds: 3 });
    expect(errorOf(out).kind).toBe('tool_input');
    expect(out.outputs).toEqual([]);
  });

  it('name and value are both needed; a name alone or a value alone is tool_input', () => {
    const f = film();
    expect(f.tools.call(f.target, 'show_me', { name: 'a', value: 1 }).result.ok).toBe(true);
    expect(errorOf(f.tools.call(f.target, 'show_me', { name: 'a' })).kind).toBe('tool_input');
    expect(errorOf(f.tools.call(f.target, 'show_me', { value: 1 })).kind).toBe('tool_input');
  });

  it('a name that is not a name, or a value of the wrong kind, is tool_input and writes nothing', () => {
    const f = film();
    for (const input of [{ name: 'a, 1); Delete(a', value: 1 }, { name: '', value: 1 }, { name: 'a', value: { x: 1 } }, { name: 'a', value: [1, 2, 3] }, { name: 'a', value: 'say "hi"' }]) {
      const out = f.tools.call(f.target, 'show_me', input);
      expect(errorOf(out).kind, JSON.stringify(input)).toBe('tool_input');
      expect(out.outputs).toEqual([]);
    }
    expect(f.target.objects().list.map((o) => o.name)).toContain('a');
  });

  it('an object that does not exist gives the draw error of the line (unknown_name, kernel object unchanged) and sends nothing', () => {
    const f = film();
    const out = f.tools.call(f.target, 'show_me', { name: 'nope', value: 1 });
    expect(out.outputs).toEqual([]);
    expect(drawLines(out)[0]).toMatchObject({ ok: false, kind: 'unknown_name', committed: false });
  });

  it('an object that is not free (it is defined by a formula) gives the draw error not_free and sends nothing', () => {
    const f = film('a = 1 in 0..5 step 1\nb = 2 * a');
    const out = f.tools.call(f.target, 'show_me', { name: 'b', value: 3 });
    expect(out.outputs).toEqual([]);
    expect(drawLines(out)[0]).toMatchObject({ ok: false, kind: 'not_free' });
  });

  it('is a draw call: its result has the draw shape (lines, applied, undefined)', () => {
    const f = film();
    const v = valueOf(f.tools.call(f.target, 'show_me', { name: 'a', value: 1 }));
    expect(v['lines']).toBeInstanceOf(Array);
    expect(v['applied']).toBe(1);
    expect(v['undefined']).toBeInstanceOf(Array);
  });
});

describe('on a board the film tools act on the figure card in focus (R6.2, design 4 and 9)', () => {
  const board = { page: 'page:1', items: [{ id: 'shape:c1', kind: 'figure', box: [0, 0, 100, 100] as [number, number, number, number], summary: 'a card' }], more: 0 };
  const live = (script: string = SCRIPT): { app: ReturnType<typeof createHeadlessApp>; target: Target } => {
    const app = createHeadlessApp({ mode: 'graphing', script });
    return { app, target: liveTarget(app, board as never) };
  };

  it('a live target on a board is of kind board, carries the board port and still reaches the focus figure\'s clock', () => {
    const { app, target } = live();
    expect(target.kind).toBe('board');
    expect(target.board).toBeDefined();
    app.clock.seek(2);
    expect(target.clock.t).toBe(2);
  });

  it('pause, resume and seek_beat move the clock of the card in focus and send their controls', () => {
    const { app, target } = live();
    const set = tools(['board_read', 'board', ...FILM]);
    expect(valueOf(set.call(target, 'resume', {}))).toMatchObject({ ok: true });
    expect(app.clock.playing).toBe(true);
    expect(set.call(target, 'pause', {}).outputs).toEqual([{ control: { op: 'pause' } }]);
    expect(app.clock.playing).toBe(false);
    const out = set.call(target, 'seek_beat', { t: 8 });
    expect(out.outputs).toEqual([{ control: { op: 'seek', t: 8 } }]);
    expect(app.clock.t).toBe(8);
  });

  it('show_me on a board is sent on as it is: its draw result says the line went to the figure in focus, and the line is the output', () => {
    const { target } = live();
    const set = tools(['board_read', 'board', ...FILM]);
    const out = set.call(target, 'show_me', { name: 'a', value: 2 });
    expect(drawLines(out)[0]).toMatchObject({ ok: true });
    expect(out.outputs).toEqual([{ lines: ['SetValue(a, 2)'] }]);
  });

  it('show_me on a board still checks its own input (the timed form is not offered: tool_input)', () => {
    const { target } = live();
    const set = tools(['board_read', 'board', ...FILM]);
    const out = set.call(target, 'show_me', { name: 'a', to: 1, seconds: 99 });
    expect(errorOf(out).kind).toBe('tool_input');
    expect(out.outputs).toEqual([]);
  });

  it('a board target with no figure of its own keeps a clock (a record of the time asked for): pause, resume and seek_beat answer ok', () => {
    const t = boardTarget({ page: 'page:1', items: [], more: 0 });
    const set = tools(['board_read', 'board', ...FILM]);
    expect(set.call(t, 'pause', {}).result.ok).toBe(true);
    expect(set.call(t, 'resume', {}).result.ok).toBe(true);
    const out = set.call(t, 'seek_beat', { t: 5 });
    expect(valueOf(out)['t']).toBe(5);
    expect(out.outputs).toEqual([{ control: { op: 'seek', t: 5 } }]);
    // the clock keeps the time asked for
    expect(t.clock.t).toBe(5);
  });
});

describe('the film tools and the tool guard', () => {
  it('a call while another runs on the same target is tool_busy (T002) and not run', () => {
    const f = film();
    f.app.clock.play();
    expect(f.target.guard.enter()).toBe(true);
    for (const [name, args] of [['pause', {}], ['resume', {}], ['seek_beat', { t: 3 }], ['show_me', { name: 'a', value: 1 }]] as const) {
      const out = f.tools.call(f.target, name, args);
      expect(errorOf(out), name).toMatchObject({ kind: 'tool_busy', code: 'T002' });
      expect(out.outputs).toEqual([]);
    }
    expect(f.app.clock.playing).toBe(true);
    expect(f.app.clock.t).toBe(0);
    f.target.guard.leave();
    expect(f.tools.call(f.target, 'pause', {}).result.ok).toBe(true);
  });

  it('an unknown film tool name on a toolset without it is tool_unknown (T004)', () => {
    const set = tools(['draw', 'figure']);
    const f = film();
    const out = set.call(f.target, 'pause', {});
    expect(errorOf(out).kind).toBe('tool_unknown');
  });

  it('a figure target made again over the same app shares the clock', () => {
    const f = film();
    const again = figureTarget(f.app);
    f.tools.call(f.target, 'seek_beat', { t: 6 });
    expect(again.clock.t).toBe(6);
  });
});

/**
 * The `board` tool (agent.md 2; design 11; requirements R8.2; errors.md `agent_refused`): every action kind, one
 * transaction for each action with origin `model`, one undo for a call, a failed action that changes nothing and does
 * not stop the rest, places, `$last`, and the refusals.
 */
import { describe, expect, it } from 'vitest';
import { ACTIONS_MAX, BoardAgent, figureOf, setLocked } from '../../src/index';
import type { Diff, ShapeRecord } from '../../src/index';
import { idOf, makeAgentRig, must, overlaps, propValues, readBox, run, shape, shapesOf, userShape, verdict } from './agent-helpers';
import type { AgentRig } from './agent-helpers';

/** Everything on the page as `board_read` boxes, with an area that holds all of it. */
const everything = (rig: AgentRig): readonly { readonly id: string; readonly box: readonly [number, number, number, number] }[] =>
  must(rig.board.agent.runner.read({ area: [-100000, -100000, 200000, 200000] })).items;

const diffsOf = (rig: AgentRig): Diff[] => {
  const diffs: Diff[] = [];
  rig.board.core.store.on((d) => diffs.push(d));
  return diffs;
};

describe('every action kind (agent.md 2)', () => {
  it('write: typed text, with $…$ kept as maths, size and colour', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'write', text: 'Area is $a^2$', at: { x: 30, y: 40 }, style: 'typed', size: 32, color: '#d93025' }]);
    const s = shape(rig, idOf(r));
    expect(s.kind).toBe('text');
    const props = s.props as { text: string; font: string; size: number; color: string };
    expect(props.text).toBe('Area is $a^2$');
    expect(props.font).not.toBe('hand');
    expect(props.size).toBe(32);
    expect(props.color).toBe('#d93025');
    expect(Math.abs(readBox(rig, s.id)[0] - 30)).toBeLessThan(6);
    expect(Math.abs(readBox(rig, s.id)[1] - 40)).toBeLessThan(6);
  });

  it('write with style hand is stored as a text shape in the hand font, not as ink (agent.md 2)', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'write', text: 'Look here', at: { x: 30, y: 40 }, style: 'hand' }]);
    const s = shape(rig, idOf(r));
    expect(s.kind).toBe('text');
    expect((s.props as { font: string }).font).toBe('hand');
    expect(shapesOf(rig).some((x) => x.kind === 'ink')).toBe(false);
  });

  it.each(['rect', 'ellipse', 'triangle', 'diamond', 'star', 'line', 'sticky', 'frame'] as const)('shape: a %s is made at the place, with the mark of the model', async (kind) => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'shape', kind, at: { x: 200, y: 150 } }]);
    const s = shape(rig, idOf(r));
    expect(s.kind).toBe(kind);
    expect(s.meta['madeBy']).toBe('model');
    const box = readBox(rig, s.id);
    expect(Math.abs(box[0] - 200)).toBeLessThan(8);
    expect(Math.abs(box[1] - 150)).toBeLessThan(8);
  });

  it('shape: w and h give the size, label and colour are kept', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 100, y: 100 }, w: 220, h: 90, label: 'Base', color: '#1a73e8' }]);
    const s = shape(rig, idOf(r));
    const props = s.props as { w: number; h: number };
    expect(props.w).toBe(220);
    expect(props.h).toBe(90);
    const values = propValues(s);
    expect(values).toContain('Base');
    expect(values).toContain('#1a73e8');
  });

  it('shape: a sticky note keeps its label as its text and a frame as its name', async () => {
    const rig = makeAgentRig();
    const results = await run(rig, [
      { op: 'shape', kind: 'sticky', at: { x: 10, y: 10 }, label: 'Note text' },
      { op: 'shape', kind: 'frame', at: { x: 600, y: 10 }, label: 'Proof' },
    ]);
    expect(propValues(shape(rig, idOf(results[0])))).toContain('Note text');
    expect(propValues(shape(rig, idOf(results[1])))).toContain('Proof');
  });

  it('arrow: runs from one shape to another, and a label is written above its middle', async () => {
    const rig = makeAgentRig();
    const [a, b] = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 100, y: 300 }, w: 100, h: 60 },
      { op: 'shape', kind: 'rect', at: { x: 700, y: 300 }, w: 100, h: 60 },
    ]);
    const [arrow] = await run(rig, [{ op: 'arrow', from: idOf(a), to: idOf(b), label: 'maps to' }]);
    const arrowShape = shape(rig, idOf(arrow));
    expect(arrowShape.kind).toBe('arrow');
    expect(arrowShape.meta['madeBy']).toBe('model');
    const box = readBox(rig, arrowShape.id);
    // it spans the gap between the two shapes
    expect(box[0]).toBeLessThan(260);
    expect(box[0] + box[2]).toBeGreaterThan(640);
    const label = shapesOf(rig).find((s) => s.kind === 'text' && (s.props as { text: string }).text === 'maps to');
    expect(label).toBeDefined();
    const lb = readBox(rig, (label as ShapeRecord).id);
    const midX = box[0] + box[2] / 2;
    expect(Math.abs(lb[0] + lb[2] / 2 - midX)).toBeLessThan(60);
    expect(lb[1] + lb[3]).toBeLessThanOrEqual(box[1] + box[3] + 2);
  });

  it('stroke: points are drawn as ink at the place', async () => {
    const rig = makeAgentRig();
    const points: [number, number][] = [[0, 0], [40, 30], [80, 10], [120, 50]];
    const [r] = await run(rig, [{ op: 'stroke', points, at: { x: 300, y: 200 }, color: '#d93025', size: 6 }]);
    const s = shape(rig, idOf(r));
    expect(s.kind).toBe('ink');
    expect(s.meta['madeBy']).toBe('model');
    const box = readBox(rig, s.id);
    expect(Math.abs(box[0] - 300)).toBeLessThan(12);
    expect(Math.abs(box[1] - 200)).toBeLessThan(12);
  });

  it('mark: circle is an ellipse, underline a line, highlight a translucent rectangle, box a rectangle', async () => {
    const rig = makeAgentRig();
    const [t] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 300, y: 300 }, w: 160, h: 60 }]);
    const target = idOf(t);
    const tb = readBox(rig, target);
    const marks = await run(rig, [
      { op: 'mark', target, how: 'circle' },
      { op: 'mark', target, how: 'underline' },
      { op: 'mark', target, how: 'highlight' },
      { op: 'mark', target, how: 'box' },
    ]);
    const [circle, underline, highlight, box] = marks.map((m) => shape(rig, idOf(m)));
    expect(circle?.kind).toBe('ellipse');
    expect(underline?.kind).toBe('line');
    expect(highlight?.kind).toBe('rect');
    expect(box?.kind).toBe('rect');
    expect((highlight as ShapeRecord).opacity).toBeLessThan(1);
    for (const m of [circle, underline, highlight, box]) expect(m?.meta['madeBy']).toBe('model');
    const cb = readBox(rig, (circle as ShapeRecord).id);
    // the circle goes round the target; the underline is under it; the highlight is over it
    expect(cb[0]).toBeLessThanOrEqual(tb[0]);
    expect(cb[1]).toBeLessThanOrEqual(tb[1]);
    expect(cb[0] + cb[2]).toBeGreaterThanOrEqual(tb[0] + tb[2]);
    expect(cb[1] + cb[3]).toBeGreaterThanOrEqual(tb[1] + tb[3]);
    const ub = readBox(rig, (underline as ShapeRecord).id);
    expect(ub[1]).toBeGreaterThanOrEqual(tb[1] + tb[3] / 2);
    expect(overlaps(readBox(rig, (highlight as ShapeRecord).id), tb)).toBe(true);
  });

  it('point: the laser over the target, and nothing is stored', async () => {
    const rig = makeAgentRig();
    const [t] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 300, y: 300 }, w: 100, h: 50 }]);
    const pointed: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
    const agent = new BoardAgent(rig.board.core, { onPoint: (b) => pointed.push(b) });
    const before = shapesOf(rig).length;
    const diffs = diffsOf(rig);
    const [p] = (must(await agent.run({ actions: [{ op: 'point', target: idOf(t) }] })) as readonly { ok: boolean }[]);
    expect(p?.ok).toBe(true);
    expect(shapesOf(rig)).toHaveLength(before);
    expect(diffs.filter((d) => d.history)).toEqual([]);
    expect(pointed).toHaveLength(1);
    const tb = readBox(rig, idOf(t));
    expect(pointed[0]?.minX).toBeLessThanOrEqual(tb[0] + 6);
    expect(pointed[0]?.maxX).toBeGreaterThanOrEqual(tb[0] + tb[2] - 6);
  });

  it('move: a shape the model made goes to the place', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 100, y: 100 } }]);
    const id = idOf(r);
    const [m] = await run(rig, [{ op: 'move', id, at: { x: 500, y: 400 } }]);
    expect(m?.ok).toBe(true);
    const box = readBox(rig, id);
    expect(Math.abs(box[0] - 500)).toBeLessThan(8);
    expect(Math.abs(box[1] - 400)).toBeLessThan(8);
  });

  it('edit: sets the text of a text shape, a sticky note and a frame name', async () => {
    const rig = makeAgentRig();
    const made = await run(rig, [
      { op: 'write', text: 'old', at: { x: 10, y: 10 } },
      { op: 'shape', kind: 'sticky', at: { x: 300, y: 10 }, label: 'old' },
      { op: 'shape', kind: 'frame', at: { x: 600, y: 10 }, label: 'old' },
    ]);
    const edits = await run(rig, made.map((m) => ({ op: 'edit', id: idOf(m), text: 'new' })));
    expect(edits.map(verdict)).toEqual(['ok', 'ok', 'ok']);
    for (const m of made) expect(propValues(shape(rig, idOf(m)))).toContain('new');
    expect(propValues(shape(rig, idOf(made[0])))).not.toContain('old');
  });

  it('delete: removes a shape the model made', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 100, y: 100 } }]);
    const [d] = await run(rig, [{ op: 'delete', id: idOf(r) }]);
    expect(d?.ok).toBe(true);
    expect(rig.board.core.store.get(idOf(r))).toBeUndefined();
  });

  it('camera: a target brings it into view, and "all" brings everything into view', async () => {
    const rig = makeAgentRig();
    const [a, b] = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 5000, y: 3000 }, w: 100, h: 100 },
      { op: 'shape', kind: 'rect', at: { x: -4000, y: -2000 }, w: 100, h: 100 },
    ]);
    const camera = rig.board.core.camera;
    expect(camera).toBeDefined();
    const [c1] = await run(rig, [{ op: 'camera', target: idOf(a) }]);
    expect(c1?.ok).toBe(true);
    const v1 = camera?.visibleBounds(1280, 720);
    expect(v1?.minX).toBeLessThan(5050);
    expect(v1?.maxX).toBeGreaterThan(5050);
    expect(v1?.minY).toBeLessThan(3050);
    expect(v1?.maxY).toBeGreaterThan(3050);
    const [c2] = await run(rig, [{ op: 'camera', target: 'all' }]);
    expect(c2?.ok).toBe(true);
    const v2 = camera?.visibleBounds(1280, 720);
    for (const id of [idOf(a), idOf(b)]) {
      const box = readBox(rig, id);
      expect(v2?.minX).toBeLessThanOrEqual(box[0]);
      expect(v2?.maxX).toBeGreaterThanOrEqual(box[0] + box[2]);
      expect(v2?.minY).toBeLessThanOrEqual(box[1]);
      expect(v2?.maxY).toBeGreaterThanOrEqual(box[1] + box[3]);
    }
  });

  it('page: new makes and shows a page, previous and next go between pages, a page id goes to it', async () => {
    const rig = makeAgentRig();
    const first = rig.page;
    const [made] = await run(rig, [{ op: 'page', to: 'new', name: 'Proof' }]);
    const second = idOf(made);
    expect(second).not.toBe(first);
    expect(rig.board.core.pages.current).toBe(second);
    expect(rig.board.core.store.get(second)).toMatchObject({ name: 'Proof' });
    await run(rig, [{ op: 'page', to: 'previous' }]);
    expect(rig.board.core.pages.current).toBe(first);
    await run(rig, [{ op: 'page', to: 'next' }]);
    expect(rig.board.core.pages.current).toBe(second);
    await run(rig, [{ op: 'page', to: first }]);
    expect(rig.board.core.pages.current).toBe(first);
  });

  it('page: a page that is not there is refused', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'page', to: 'page:nope' }]);
    expect(verdict(r)).toBe('agent_refused');
    expect(rig.board.core.pages.current).toBe(rig.page);
  });
});

describe('figure: lines run through the SDK (agent.md 2; R8)', () => {
  it('makes a figure card with the lines that ran, in the mode', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'figure', lines: ['f(x) = x^2', 'g(x) = x + 1'], mode: 'graphing', at: { x: 100, y: 100 }, w: 400, h: 300 }]);
    const card = figureOf(rig.board.core, idOf(r));
    expect(card?.meta['madeBy']).toBe('model');
    const props = card?.props;
    expect(props?.mode).toBe('graphing');
    expect(props?.script).toContain('f(x) = x^2');
    expect(props?.script).toContain('g(x) = x + 1');
    expect(props?.w).toBe(400);
    expect(props?.h).toBe(300);
  });

  it('a line that fails comes back in the kernel format and is left out of the card; the other lines still run', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'figure', lines: ['f(x) = x^2', 'g(x = ', 'h(x) = 3'], mode: 'graphing', at: 'free' }]);
    expect(r?.ok).toBe(true);
    if (r === undefined || !r.ok) return;
    const errors = (r.lineErrors ?? []) as readonly Record<string, unknown>[];
    expect(errors).toHaveLength(1);
    const e = errors[0] as Record<string, unknown>;
    // the format of docs/features/errors/design.md 3: ok false, committed false, kind, code, message, line and col
    expect(e['ok']).toBe(false);
    expect(e['committed']).toBe(false);
    expect(typeof e['kind']).toBe('string');
    expect(typeof e['code']).toBe('string');
    expect(typeof e['message']).toBe('string');
    expect(e['line']).toBe(2);
    expect(typeof e['col']).toBe('number');
    const script = figureOf(rig.board.core, idOf(r))?.props.script ?? '';
    expect(script).toContain('f(x) = x^2');
    expect(script).toContain('h(x) = 3');
    expect(script).not.toContain('g(x = ');
  });

  it('edit of a figure card takes its lines as text, one a line, and runs them again', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'figure', lines: ['f(x) = x^2'], mode: 'graphing', at: 'free' }]);
    const id = idOf(r);
    const [e] = await run(rig, [{ op: 'edit', id, text: 'f(x) = x^3\ng(x) = 2' }]);
    expect(e?.ok).toBe(true);
    const script = figureOf(rig.board.core, id)?.props.script ?? '';
    expect(script).toContain('f(x) = x^3');
    expect(script).toContain('g(x) = 2');
    expect(script).not.toContain('x^2');
  });
});

describe('each action is one transaction with origin model, undoable by the user (agent.md intro; R8.2)', () => {
  it('a call of three actions is three transactions, all with origin model', async () => {
    const rig = makeAgentRig();
    const diffs = diffsOf(rig);
    await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 10, y: 10 } },
      { op: 'shape', kind: 'ellipse', at: { x: 300, y: 10 } },
      { op: 'write', text: 'x', at: { x: 600, y: 10 } },
    ]);
    expect(diffs).toHaveLength(3);
    for (const d of diffs) {
      expect(d.origin).toBe('model');
      expect(d.history).toBe(true);
      expect(d.added).toHaveLength(1);
    }
  });

  it('the user undoes a call in one step, and redo brings it back', async () => {
    const rig = makeAgentRig();
    const { history } = rig.board.core;
    const steps = history.undoSteps;
    await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 10, y: 10 } },
      { op: 'shape', kind: 'ellipse', at: { x: 300, y: 10 } },
      { op: 'write', text: 'x', at: { x: 600, y: 10 } },
    ]);
    expect(history.undoSteps).toBe(steps + 1);
    expect(shapesOf(rig)).toHaveLength(3);
    const undone = history.undo();
    expect(undone.ok).toBe(true);
    expect(shapesOf(rig)).toHaveLength(0);
    expect(history.redo().ok).toBe(true);
    expect(shapesOf(rig)).toHaveLength(3);
  });

  it('a model change is a step the user can undo even when it edits a shape', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'write', text: 'one', at: { x: 10, y: 10 } }]);
    await run(rig, [{ op: 'edit', id: idOf(r), text: 'two' }]);
    expect(propValues(shape(rig, idOf(r)))).toContain('two');
    expect(rig.board.core.history.undo().ok).toBe(true);
    expect(propValues(shape(rig, idOf(r)))).toContain('one');
  });
});

describe('a failed action changes nothing and the rest still run (agent.md 2; R8.2)', () => {
  it('a refused action in the middle leaves the others made, with a result for each', async () => {
    const rig = makeAgentRig();
    const diffs = diffsOf(rig);
    const results = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 10, y: 10 } },
      { op: 'arrow', from: 'shape:missing', to: '$last' },
      { op: 'shape', kind: 'ellipse', at: { x: 300, y: 10 } },
    ]);
    expect(results.map(verdict)).toEqual(['ok', 'agent_refused', 'ok']);
    expect(shapesOf(rig).map((s) => s.kind).sort()).toEqual(['ellipse', 'rect']);
    expect(diffs).toHaveLength(2);
  });

  it('a malformed action is that action failing, not the call', async () => {
    const rig = makeAgentRig();
    const results = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 10, y: 10 } },
      { op: 'shape', kind: 'hexagon', at: { x: 10, y: 10 } },
      { op: 'explode' },
      { op: 'shape', kind: 'ellipse', at: { x: 300, y: 10 } },
    ]);
    expect(results.map(verdict)).toEqual(['ok', 'bad_argument', 'bad_argument', 'ok']);
    expect(shapesOf(rig)).toHaveLength(2);
  });

  it('the failure carries an error of errors.md: kind, message', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'delete', id: 'shape:gone' }]);
    expect(r?.ok).toBe(false);
    if (r !== undefined && !r.ok) {
      expect(r.kind).toBe('agent_refused');
      expect(typeof r.message).toBe('string');
    }
  });
});

describe('Place (agent.md 2)', () => {
  it('{ x, y } is where the box begins', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'shape', kind: 'ellipse', at: { x: 321, y: 123 }, w: 90, h: 70 }]);
    const box = readBox(rig, idOf(r));
    expect(Math.abs(box[0] - 321)).toBeLessThan(8);
    expect(Math.abs(box[1] - 123)).toBeLessThan(8);
  });

  it.each(['right', 'left', 'above', 'below'] as const)('near a shape on the %s side puts it on that side', async (side) => {
    const rig = makeAgentRig();
    const [t] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 500, y: 300 }, w: 100, h: 60 }]);
    const [n] = await run(rig, [{ op: 'shape', kind: 'rect', at: { near: idOf(t), side }, w: 80, h: 40 }]);
    const tb = readBox(rig, idOf(t));
    const nb = readBox(rig, idOf(n));
    expect(overlaps(tb, nb)).toBe(false);
    if (side === 'right') expect(nb[0]).toBeGreaterThanOrEqual(tb[0] + tb[2]);
    if (side === 'left') expect(nb[0] + nb[2]).toBeLessThanOrEqual(tb[0]);
    if (side === 'above') expect(nb[1] + nb[3]).toBeLessThanOrEqual(tb[1]);
    if (side === 'below') expect(nb[1]).toBeGreaterThanOrEqual(tb[1] + tb[3]);
  });

  it('near never covers other shapes, even when the nearest spot on that side is taken', async () => {
    const rig = makeAgentRig();
    const [t] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 400, y: 300 }, w: 100, h: 60 }]);
    // the user's work sits just right of the target, and more of it above and below that
    userShape(rig, 'rect', 520, 300, { w: 120, h: 60 });
    userShape(rig, 'rect', 520, 200, { w: 120, h: 80 });
    userShape(rig, 'rect', 520, 380, { w: 120, h: 80 });
    const made: string[] = [];
    for (let i = 0; i < 4; i++) {
      const [n] = await run(rig, [{ op: 'shape', kind: 'rect', at: { near: idOf(t), side: 'right' }, w: 100, h: 60 }]);
      made.push(idOf(n));
    }
    const all = everything(rig);
    for (const a of all) {
      for (const b of all) {
        if (a.id < b.id) expect(overlaps(a.box, b.box), `${a.id} over ${b.id}`).toBe(false);
      }
    }
    for (const id of made) expect(readBox(rig, id)[0]).toBeGreaterThanOrEqual(readBox(rig, idOf(t))[0] + 100);
  });

  it('near an area [x, y, w, h] works as near a shape', async () => {
    const rig = makeAgentRig();
    const [n] = await run(rig, [{ op: 'shape', kind: 'rect', at: { near: [300, 300, 200, 100], side: 'below' }, w: 80, h: 40 }]);
    const nb = readBox(rig, idOf(n));
    expect(nb[1]).toBeGreaterThanOrEqual(400);
    expect(nb[0] + nb[2]).toBeGreaterThan(300);
    expect(nb[0]).toBeLessThan(500);
  });

  it("'free' picks an empty spot in view, and never covers a shape", async () => {
    const rig = makeAgentRig();
    for (let i = 0; i < 8; i++) userShape(rig, 'rect', 60 + (i % 4) * 300, 60 + Math.floor(i / 4) * 200, { w: 200, h: 120 });
    const made: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [n] = await run(rig, [{ op: 'shape', kind: 'rect', at: 'free', w: 100, h: 60 }]);
      made.push(idOf(n));
    }
    const all = everything(rig);
    for (const a of all) {
      for (const b of all) {
        if (a.id < b.id) expect(overlaps(a.box, b.box), `${a.id} over ${b.id}`).toBe(false);
      }
    }
    for (const id of made) {
      const box = readBox(rig, id);
      expect(box[0]).toBeGreaterThanOrEqual(0);
      expect(box[1]).toBeGreaterThanOrEqual(0);
      expect(box[0] + box[2]).toBeLessThanOrEqual(1280);
      expect(box[1] + box[3]).toBeLessThanOrEqual(720);
    }
  });
});

describe("Place 'free' in a crowded view (agent.md 2: the nearest empty spot in view)", () => {
  it('still lands in view when an empty strip big enough for the box is left (140 units high, the box is 60)', async () => {
    const rig = makeAgentRig();
    // 3 rows of 120 units at y 60, 260 and 460: the strip 580 to 720 is empty, and so are the gaps of 80 between the rows
    for (let i = 0; i < 12; i++) userShape(rig, 'rect', 60 + (i % 4) * 300, 60 + Math.floor(i / 4) * 200, { w: 200, h: 120 });
    const [n] = await run(rig, [{ op: 'shape', kind: 'rect', at: 'free', w: 100, h: 60 }]);
    const box = readBox(rig, idOf(n));
    expect(box[1] + box[3]).toBeLessThanOrEqual(720);
    expect(box[0] + box[2]).toBeLessThanOrEqual(1280);
    for (const other of everything(rig)) if (other.id !== idOf(n)) expect(overlaps(box, other.box)).toBe(false);
  });
});

describe('$last (agent.md 2)', () => {
  it('names the shape the previous action made', async () => {
    const rig = makeAgentRig();
    const [a, w] = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 100, y: 100 }, w: 100, h: 60 },
      { op: 'write', text: 'label', at: { near: '$last', side: 'below' } },
    ]);
    const ab = readBox(rig, idOf(a));
    const wb = readBox(rig, idOf(w));
    expect(wb[1]).toBeGreaterThanOrEqual(ab[1] + ab[3]);
  });

  it('names nothing before an action made a shape: the action is refused', async () => {
    const rig = makeAgentRig();
    const [w] = await run(rig, [{ op: 'write', text: 'x', at: { near: '$last', side: 'right' } }]);
    expect(verdict(w)).toBe('agent_refused');
    expect(shapesOf(rig)).toHaveLength(0);
  });

  it('an arrow does not count, so a label can follow it', async () => {
    const rig = makeAgentRig();
    const [a, b, , w] = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 100, y: 100 }, w: 100, h: 60 },
      { op: 'shape', kind: 'rect', at: { x: 700, y: 100 }, w: 100, h: 60 },
      { op: 'arrow', from: [100, 100, 100, 60], to: [700, 100, 100, 60] },
      { op: 'write', text: 'under B', at: { near: '$last', side: 'below' } },
    ]);
    expect(idOf(a)).not.toBe(idOf(b));
    const bb = readBox(rig, idOf(b));
    const wb = readBox(rig, idOf(w));
    // placed below the second rectangle (the last shape made), not below the arrow or the first one
    expect(wb[1]).toBeGreaterThanOrEqual(bb[1] + bb[3]);
    expect(wb[0] + wb[2]).toBeGreaterThan(bb[0] - 60);
    expect(wb[0]).toBeLessThan(bb[0] + bb[2] + 60);
  });

  it('carries over from one board call to the next of the same answer', async () => {
    const rig = makeAgentRig();
    const [a] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 100, y: 100 }, w: 100, h: 60 }]);
    const [w] = await run(rig, [{ op: 'write', text: 'next call', at: { near: '$last', side: 'right' } }]);
    expect(w?.ok).toBe(true);
    const ab = readBox(rig, idOf(a));
    expect(readBox(rig, idOf(w))[0]).toBeGreaterThanOrEqual(ab[0] + ab[2]);
  });

  it('goes when a page action changes the page', async () => {
    const rig = makeAgentRig();
    const results = await run(rig, [
      { op: 'shape', kind: 'rect', at: { x: 100, y: 100 } },
      { op: 'page', to: 'new' },
      { op: 'write', text: 'lost', at: { near: '$last', side: 'right' } },
    ]);
    expect(results.map(verdict)).toEqual(['ok', 'ok', 'agent_refused']);
  });

  it('goes when a new request begins', async () => {
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* () {
        yield { actions: [{ op: 'write', text: 'late', at: { near: '$last', side: 'right' } }] };
        yield { done: true as const };
      },
    });
    await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 100, y: 100 } }]);
    const answer = await rig.board.agent.service.talk('go on');
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.value.made).toEqual([]);
    expect(shapesOf(rig).filter((s) => s.kind === 'text')).toHaveLength(0);
    expect(rig.board.agent.service.job?.failed[0]?.kind).toBe('agent_refused');
  });
});

describe('agent_refused (errors.md; agent.md 2)', () => {
  it.each(['move', 'edit', 'delete', 'mark', 'point', 'arrow'])('%s of a shape that is gone is refused', async (op) => {
    const rig = makeAgentRig();
    const action =
      op === 'move' ? { op, id: 'shape:gone', at: { x: 1, y: 1 } }
        : op === 'edit' ? { op, id: 'shape:gone', text: 'x' }
          : op === 'delete' ? { op, id: 'shape:gone' }
            : op === 'mark' ? { op, target: 'shape:gone', how: 'circle' }
              : op === 'point' ? { op, target: 'shape:gone' }
                : { op, from: 'shape:gone', to: [0, 0, 10, 10] };
    const [r] = await run(rig, [action]);
    expect(verdict(r)).toBe('agent_refused');
  });

  it('a shape on another page is refused', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'shape', kind: 'rect', at: { x: 10, y: 10 } }]);
    await run(rig, [{ op: 'page', to: 'new' }]);
    const results = await run(rig, [
      { op: 'move', id: idOf(r), at: { x: 50, y: 50 } },
      { op: 'delete', id: idOf(r) },
      { op: 'arrow', from: idOf(r), to: [0, 0, 10, 10] },
    ]);
    expect(results.map(verdict)).toEqual(['agent_refused', 'agent_refused', 'agent_refused']);
    expect(rig.board.core.store.get(idOf(r))).toBeDefined();
  });

  it('a locked shape is refused for move, edit and delete, and stays as it was', async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'write', text: 'fixed', at: { x: 10, y: 10 } }]);
    const id = idOf(r);
    const x = shape(rig, id).x;
    must(setLocked(rig.board.core, [id], true));
    const results = await run(rig, [
      { op: 'move', id, at: { x: 500, y: 500 } },
      { op: 'edit', id, text: 'changed' },
      { op: 'delete', id },
    ]);
    expect(results.map(verdict)).toEqual(['agent_refused', 'agent_refused', 'agent_refused']);
    const kept = shape(rig, id);
    expect(propValues(kept)).toContain('fixed');
    expect(kept.x).toBe(x);
  });

  it('an action over a limit is refused', async () => {
    const rig = makeAgentRig({ reducedMotion: true }, { shapesPerPage: 3 });
    const results = await run(rig, Array.from({ length: 5 }, (_, i) => ({ op: 'shape', kind: 'rect', at: { x: i * 150, y: 10 } })));
    expect(results.map(verdict)).toEqual(['ok', 'ok', 'ok', 'agent_refused', 'agent_refused']);
    expect(shapesOf(rig)).toHaveLength(3);
  });

  it(`a call of more than ${ACTIONS_MAX} actions is refused and changes nothing`, async () => {
    const rig = makeAgentRig();
    const diffs = diffsOf(rig);
    const r = await rig.board.agent.runner.run({ actions: Array.from({ length: ACTIONS_MAX + 1 }, (_, i) => ({ op: 'shape', kind: 'rect', at: { x: i * 10, y: 0 } })) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_refused');
    expect(shapesOf(rig)).toHaveLength(0);
    expect(diffs).toHaveLength(0);
  });

  it('exactly 20 actions all run', async () => {
    const rig = makeAgentRig();
    const results = await run(rig, Array.from({ length: ACTIONS_MAX }, (_, i) => ({ op: 'shape', kind: 'rect', at: { x: (i % 5) * 150, y: Math.floor(i / 5) * 100 }, w: 100, h: 60 })));
    expect(results).toHaveLength(20);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(shapesOf(rig)).toHaveLength(20);
  });

  it('a call that is not a list of actions changes nothing and does not throw', async () => {
    const rig = makeAgentRig();
    for (const input of [undefined, null, 'x', {}, { actions: 'x' }, { actions: [] }]) {
      const r = await rig.board.agent.runner.run(input);
      expect(r.ok).toBe(false);
    }
    expect(shapesOf(rig)).toHaveLength(0);
  });
});

describe('a shape the model did not make (agent.md 2 and 4.6)', () => {
  const setup = async (): Promise<{ rig: AgentRig; mine: string }> => {
    const rig = makeAgentRig();
    const mine = userShape(rig, 'text', 50, 50, { text: 'user text' });
    return { rig, mine: mine.id };
  };

  it('edit, move and delete are refused with detail.reason not_model', async () => {
    const { rig, mine } = await setup();
    const results = await run(rig, [
      { op: 'edit', id: mine, text: 'x' },
      { op: 'move', id: mine, at: { x: 400, y: 400 } },
      { op: 'delete', id: mine },
    ]);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.kind).toBe('agent_refused');
        expect((r.detail as { reason?: string } | undefined)?.reason).toBe('not_model');
      }
    }
    expect(shape(rig, mine).x).toBe(50);
    expect(propValues(shape(rig, mine))).toContain('user text');
  });

  it('they work when the request allows it', async () => {
    const { rig, mine } = await setup();
    const results = await run(
      rig,
      [
        { op: 'edit', id: mine, text: 'changed' },
        { op: 'move', id: mine, at: { x: 400, y: 400 } },
      ],
      { allowForeign: true },
    );
    expect(results.map(verdict)).toEqual(['ok', 'ok']);
    expect(propValues(shape(rig, mine))).toContain('changed');
    const [d] = await run(rig, [{ op: 'delete', id: mine }], { allowForeign: true });
    expect(d?.ok).toBe(true);
  });

  it('marking, pointing, drawing an arrow to and placing near the user\'s shape need no leave', async () => {
    const { rig, mine } = await setup();
    const results = await run(rig, [
      { op: 'mark', target: mine, how: 'circle' },
      { op: 'point', target: mine },
      { op: 'shape', kind: 'rect', at: { near: mine, side: 'below' } },
      { op: 'arrow', from: mine, to: '$last' },
    ]);
    expect(results.map(verdict)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it("the shapes the model made stay the model's to edit, move and delete", async () => {
    const rig = makeAgentRig();
    const [r] = await run(rig, [{ op: 'write', text: 'mine', at: { x: 10, y: 10 } }]);
    const results = await run(rig, [
      { op: 'edit', id: idOf(r), text: 'mine too' },
      { op: 'move', id: idOf(r), at: { x: 60, y: 60 } },
      { op: 'delete', id: idOf(r) },
    ]);
    expect(results.map(verdict)).toEqual(['ok', 'ok', 'ok']);
  });
});

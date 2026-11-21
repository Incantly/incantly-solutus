/**
 * `board_read` and the tool definitions (agent.md 1 and 6; requirements R8.1; design 11.2): items in reading order with
 * the fields of agent.md 1, at most 60 items and a count of the rest, the area and page filters, and no throw.
 */
import { describe, expect, it } from 'vitest';
import { BOARD_READ_TOOL, BOARD_TOOL, boardTools, ITEMS_MAX, putNewShape } from '../../src/index';
import type { AgentItem } from '../../src/index';
import { drawPath, line } from './ink-helpers';
import { makeAgentRig, must, run, userShape } from './agent-helpers';
import type { AgentRig } from './agent-helpers';

const read = (rig: AgentRig, input?: unknown): ReturnType<AgentRig['board']['agent']['runner']['read']> => rig.board.agent.runner.read(input);
const itemsOf = (rig: AgentRig, input?: unknown): readonly AgentItem[] => must(read(rig, input)).items;

describe('tool definitions (agent.md 1; R8.1)', () => {
  it('exports board_read and board as tool definitions with a name, a description and a JSON schema', () => {
    expect(BOARD_READ_TOOL.name).toBe('board_read');
    expect(BOARD_TOOL.name).toBe('board');
    expect(boardTools.map((t) => t.name)).toEqual(['board_read', 'board']);
    for (const t of boardTools) {
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema['type']).toBe('object');
    }
  });

  it('board_read takes an optional area and page', () => {
    const props = BOARD_READ_TOOL.inputSchema['properties'] as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['area', 'page']);
    expect(BOARD_READ_TOOL.inputSchema['required']).toBeUndefined();
  });

  it('board takes 1 to 20 actions', () => {
    const actions = ((BOARD_TOOL.inputSchema['properties'] as Record<string, unknown>)['actions'] ?? {}) as Record<string, unknown>;
    expect(actions['type']).toBe('array');
    expect(actions['minItems']).toBe(1);
    expect(actions['maxItems']).toBe(20);
  });

  it('the runner runs a tool by its name, and a name that is no board tool is a bad_argument, not a throw', async () => {
    const rig = makeAgentRig();
    const made = must(await rig.board.agent.runner.tool('board', { actions: [{ op: 'shape', kind: 'rect', at: { x: 10, y: 10 } }] }));
    expect(Array.isArray(made)).toBe(true);
    const seen = must(await rig.board.agent.runner.tool('board_read', {})) as { items: readonly AgentItem[] };
    expect(seen.items).toHaveLength(1);
    const bad = await rig.board.agent.runner.tool('draw', {});
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.kind).toBe('bad_argument');
  });
});

describe('board_read: the fields of an item (agent.md 1)', () => {
  it('an empty page has no items and counts none left out', () => {
    const rig = makeAgentRig();
    const r = must(read(rig));
    expect(r.items).toEqual([]);
    expect(r.more).toBe(0);
    expect(r.page).toBe(rig.page);
  });

  it('gives id, kind and box [x, y, w, h] for a shape', () => {
    const rig = makeAgentRig();
    const s = userShape(rig, 'rect', 100, 80, { w: 120, h: 50 });
    const [item] = itemsOf(rig);
    expect(item?.id).toBe(s.id);
    expect(item?.kind).toBe('rect');
    const box = item?.box ?? [];
    expect(box).toHaveLength(4);
    // the box begins where the shape does and is at least as large as its own size
    expect(Math.abs((box[0] as number) - 100)).toBeLessThan(6);
    expect(Math.abs((box[1] as number) - 80)).toBeLessThan(6);
    expect(box[2] as number).toBeGreaterThanOrEqual(120);
    expect(box[3] as number).toBeGreaterThanOrEqual(50);
  });

  it('gives the text of a text shape and of a sticky note', async () => {
    const rig = makeAgentRig();
    await run(rig, [
      { op: 'write', text: 'Hello board', at: { x: 50, y: 50 }, style: 'typed' },
      { op: 'shape', kind: 'sticky', at: { x: 400, y: 50 }, label: 'Remember this' },
    ]);
    const items = itemsOf(rig);
    expect(items.find((i) => i.kind === 'text')?.text).toBe('Hello board');
    expect(items.find((i) => i.kind === 'sticky')?.text).toContain('Remember this');
  });

  it("gives a figure card's summary", async () => {
    const rig = makeAgentRig();
    await run(rig, [{ op: 'figure', lines: ['f(x) = x^2'], mode: 'graphing', at: { x: 40, y: 40 } }]);
    const card = itemsOf(rig).find((i) => i.kind === 'figure');
    expect(typeof card?.summary).toBe('string');
    expect((card?.summary ?? '').length).toBeGreaterThan(0);
  });

  it('gives the recognised shape of an ink stroke', () => {
    const rig = makeAgentRig();
    const arc: [number, number][] = [];
    for (let i = 0; i <= 30; i++) {
      const t = (i - 15) / 15;
      arc.push([100 + i * 10, 300 - 150 * (1 - t * t)]);
    }
    drawPath({ host: rig.board.host }, arc);
    drawPath({ host: rig.board.host }, [...line(500, 100, 600, 300, 8), ...line(600, 300, 400, 300, 8), ...line(400, 300, 500, 100, 8)], {}, 1000);
    const ink = itemsOf(rig).filter((i) => i.kind === 'ink');
    expect(ink).toHaveLength(2);
    expect(ink.map((i) => i.shape).sort()).toEqual(['curve', 'triangle']);
  });

  it('a plain shape has no summary and no recognised shape', () => {
    const rig = makeAgentRig();
    userShape(rig, 'rect', 10, 10);
    const [item] = itemsOf(rig);
    expect(item?.summary).toBeUndefined();
    expect(item?.shape).toBeUndefined();
  });
});

describe('board_read: reading order (agent.md 1)', () => {
  it('lists rows from the top and each row from the left, whatever order the shapes were made in', () => {
    const rig = makeAgentRig();
    const c = userShape(rig, 'rect', 600, 300);
    const b = userShape(rig, 'rect', 300, 20);
    const d = userShape(rig, 'rect', 20, 300);
    const a = userShape(rig, 'rect', 20, 20);
    expect(itemsOf(rig).map((i) => i.id)).toEqual([a.id, b.id, d.id, c.id]);
  });
});

describe('board_read: at most 60 items and a count (agent.md 1 and 6; ITEMS_MAX)', () => {
  const fill = (rig: AgentRig, n: number): void => {
    const { core } = rig.board;
    const done = core.store.change('user', (tx) => {
      for (let i = 0; i < n; i++) {
        const r = putNewShape(tx, core.store, { kind: 'rect', page: rig.page, x: (i % 20) * 60, y: Math.floor(i / 20) * 50, props: { w: 40, h: 30 } });
        if (!r.ok) throw new Error(r.message);
      }
    });
    if (!done.ok) throw new Error(done.message);
  };

  it('the limit is 60', () => {
    expect(ITEMS_MAX).toBe(60);
  });

  it.each([
    [59, 59, 0],
    [60, 60, 0],
    [61, 60, 1],
    [100, 60, 40],
  ])('%i shapes in view give %i items and more = %i', (total, listed, more) => {
    const rig = makeAgentRig();
    fill(rig, total);
    const r = must(read(rig, { area: [-10, -10, 2000, 2000] }));
    expect(r.items).toHaveLength(listed);
    expect(r.more).toBe(more);
  });

  it('the 60 listed are the first 60 in reading order', () => {
    const rig = makeAgentRig();
    fill(rig, 100);
    const r = must(read(rig, { area: [-10, -10, 2000, 2000] }));
    const ys = r.items.map((i) => i.box[1]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(150);
  });
});

describe('board_read: the area and page filters (agent.md 1)', () => {
  it('by default it reads the visible part of the current page', () => {
    const rig = makeAgentRig();
    const near = userShape(rig, 'rect', 100, 100);
    userShape(rig, 'rect', 9000, 9000);
    expect(itemsOf(rig).map((i) => i.id)).toEqual([near.id]);
  });

  it('an area reads what meets it, also outside the view', () => {
    const rig = makeAgentRig();
    userShape(rig, 'rect', 100, 100);
    const far = userShape(rig, 'rect', 9000, 9000);
    expect(itemsOf(rig, { area: [8900, 8900, 400, 400] }).map((i) => i.id)).toEqual([far.id]);
  });

  it('an area with nothing in it gives no items', () => {
    const rig = makeAgentRig();
    userShape(rig, 'rect', 100, 100);
    const r = must(read(rig, { area: [3000, 3000, 100, 100] }));
    expect(r.items).toEqual([]);
    expect(r.more).toBe(0);
  });

  it('a page reads that page, not the current one', () => {
    const rig = makeAgentRig();
    const first = userShape(rig, 'rect', 100, 100);
    const second = must(rig.board.core.pages.addPage());
    must(rig.board.core.pages.goToPage(second.id));
    const other = userShape(rig, 'rect', 200, 200);
    expect(second.id).not.toBe(rig.page);
    const onFirst = must(read(rig, { page: rig.page, area: [0, 0, 1000, 1000] }));
    expect(onFirst.page).toBe(rig.page);
    expect(onFirst.items.map((i) => i.id)).toEqual([first.id]);
    expect(itemsOf(rig, { area: [0, 0, 1000, 1000] }).map((i) => i.id)).toEqual([other.id]);
  });

  it('a page that is not there is an error, not a throw', () => {
    const rig = makeAgentRig();
    const r = read(rig, { page: 'page:nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('bad_argument');
  });

  it.each([[{ area: 'everything' }], [{ area: [1, 2] }], [{ area: [0, 0, Number.NaN, 5] }], [{ page: 7 }], ['text'], [42]])('input %j never throws', (input) => {
    const rig = makeAgentRig();
    const r = read(rig, input);
    expect(typeof r.ok).toBe('boolean');
  });
});

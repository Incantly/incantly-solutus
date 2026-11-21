/**
 * Round 5 fixes BR-55 (handoff/board/findings.md; docs/features/board/design.md 3, 4 and 8): ink, arrows and text drawn
 * over a figure card show over it, and a bound arrow's end stops 8 units from its target's outline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARROW_GAP, addFigure, bindEnd, createBoard, overCardItems, shapeGeometry, shapesOverCards } from '../../src/index';
import type { Board, Bounds, InputSample, ShapeRecord } from '../../src/index';
import { installCanvas2d, sample } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { must, stubSize } from './round4-helpers';
import { add, get, shapeRig } from './shape-helpers';
import type { BoardRig } from './shape-helpers';

/** A pen stroke along the points, drawn through a tool host as the input layer would. */
function stroke(host: { sample(s: InputSample): void }, pts: readonly (readonly [number, number])[], over: Partial<InputSample> = {}): void {
  pts.forEach(([x, y], i) => host.sample(sample({ x, y, phase: i === 0 ? 'down' : i === pts.length - 1 ? 'up' : 'move', time: i * 8, ...over } as Partial<InputSample>)));
}

const ACROSS_CARD = [[300, 300], [340, 320], [380, 300], [420, 320], [460, 300]] as const;
const ids = (list: readonly { readonly shape: ShapeRecord }[]): string[] => list.map((o) => o.shape.id);

/** A figure card with its middle at (400, 320): its box is 220 to 580 by 190 to 450. */
function card(rig: BoardRig): ShapeRecord {
  return get(rig, must(addFigure(rig.core, { at: { x: 400, y: 320 } })));
}

describe('BR-55: what is above a card is drawn over it (design 8)', () => {
  it('a stroke and an arrow made after a card, over it, are found; each with the outline of the card', () => {
    const rig = shapeRig('pen');
    const c = card(rig);
    stroke(rig.host, ACROSS_CARD);
    const arrow = add(rig, 'arrow', 250, 250, { start: [0, 0], end: [200, 100] });
    const over = shapesOverCards(rig.core, [c]);
    expect(ids(over)).toContain(arrow.id);
    expect(over.some((o) => o.shape.kind === 'ink')).toBe(true);
    const corners = shapeGeometry(c, rig.core.store.kinds)?.corners as readonly number[];
    for (const o of over) expect(o.clip).toEqual([corners]);
  });

  it('a stroke made before the card is under it and is not drawn over it', () => {
    const rig = shapeRig('pen');
    stroke(rig.host, ACROSS_CARD);
    const under = add(rig, 'arrow', 250, 250, { start: [0, 0], end: [200, 100] });
    const c = card(rig);
    expect(ids(shapesOverCards(rig.core, [c]))).toEqual([]);
    expect(under.id).not.toBe(c.id);
  });

  it('a shape that does not touch the card is left to the tiles', () => {
    const rig = shapeRig('pen');
    const c = card(rig);
    add(rig, 'arrow', 700, 250, { start: [0, 0], end: [100, 50] });
    stroke(rig.host, [[700, 600], [740, 620], [780, 600]]);
    expect(shapesOverCards(rig.core, [c])).toEqual([]);
  });

  it('a highlighter is below every shape, so it stays under the card', () => {
    const rig = shapeRig('highlighter');
    const c = card(rig);
    stroke(rig.host, ACROSS_CARD);
    expect(rig.core.store.shapesOn(rig.core.pages.current as string).some((x) => x.kind === 'ink')).toBe(true);
    expect(shapesOverCards(rig.core, [c])).toEqual([]);
  });

  it('a card is never drawn over another card; a shape above two cards has both outlines, in drawing order', () => {
    const rig = shapeRig('pen');
    const a = card(rig);
    const b = get(rig, must(addFigure(rig.core, { at: { x: 700, y: 320 } })));
    stroke(rig.host, [[300, 300], [500, 330], [700, 300], [900, 330]]);
    const over = shapesOverCards(rig.core, [a, b]);
    expect(over.every((o) => o.shape.kind !== 'figure')).toBe(true);
    expect(over).toHaveLength(1);
    expect(over[0]?.clip).toHaveLength(2);
  });

  it('only the cards shown are looked at: no cards, nothing over them', () => {
    const rig = shapeRig('pen');
    stroke(rig.host, ACROSS_CARD);
    expect(shapesOverCards(rig.core, [])).toEqual([]);
    expect(overCardItems(rig.core, [], 1)).toEqual([]);
  });

  it('draw items are made for the shapes over the card, at the zoom asked', () => {
    const rig = shapeRig('pen');
    const c = card(rig);
    stroke(rig.host, ACROSS_CARD);
    const items = overCardItems(rig.core, [c], 1);
    expect(items).toHaveLength(1);
    expect(items[0]?.item.k).toBe('ink');
    expect(items[0]?.clip).toHaveLength(1);
  });
});

describe('BR-55: the top layer on the board (design 3, 8)', () => {
  let fake: FakeCanvas;
  let unsize: () => void;
  let container: HTMLElement;
  let board: Board;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    fake = installCanvas2d();
    unsize = stubSize(1000, 700);
    container = document.createElement('div');
    document.body.append(container);
    board = must(createBoard({ container, canvas2dOnly: true }));
  });
  afterEach(() => {
    board.dispose();
    container.remove();
    unsize();
    fake.restore();
    vi.useRealTimers();
  });

  const frame = (): Promise<unknown> => vi.advanceTimersByTimeAsync(100);
  const stack = (): string[] => [...(container.querySelector('.ib-surface > div')?.children ?? [])].map((e) => (e.tagName === 'CANVAS' ? 'canvas' : e.className));

  it('the card layer sits between the tiles and the live stroke; a top canvas and the overlay come after, and none takes the pointer', () => {
    expect(stack()).toEqual(['canvas', 'ib-figures', 'canvas', 'canvas', 'canvas']);
    const canvases = [...container.querySelectorAll<HTMLCanvasElement>('.ib-surface canvas')];
    expect(canvases).toHaveLength(4);
    expect(canvases.slice(1).every((c) => c.style.pointerEvents === 'none')).toBe(true);
  });

  it('a stroke over a card is drawn on the top layer, clipped to the card; one that is not over a card draws nothing there', async () => {
    must(addFigure(board.core, { at: { x: 400, y: 320 } }));
    await frame();
    const before = fake.calls.get('clip') ?? 0;
    stroke(board.host, ACROSS_CARD);
    await frame();
    expect(fake.calls.get('clip') ?? 0).toBeGreaterThan(before);
  });

  it('a stroke away from every card never clips', async () => {
    must(addFigure(board.core, { at: { x: 400, y: 320 } }));
    await frame();
    stroke(board.host, [[700, 600], [740, 620], [780, 600]]);
    await frame();
    expect(fake.calls.get('clip') ?? 0).toBe(0);
  });
});

describe('BR-55: a bound arrow stops ARROW_GAP short of its target (design 4, 7.1)', () => {
  it('an arrow from a shape to a figure card ends 8 units from the card edge, on the side it comes from', () => {
    const rig = shapeRig();
    const c = card(rig);
    const from = add(rig, 'rect', 20, 280, { w: 100, h: 60 });
    const arrow = add(rig, 'arrow', 70, 310, { start: [0, 0], end: [330, 10] });
    const done = rig.core.store.change('user', (tx) => [bindEnd(tx, rig.core.store, arrow.id, 'start', from.id, { x: 70, y: 310 }), bindEnd(tx, rig.core.store, arrow.id, 'end', c.id, { x: 400, y: 320 })]);
    expect(done.ok && done.value.value.every((r) => r.ok)).toBe(true);
    const a = get(rig, arrow.id);
    const g = shapeGeometry(a, rig.core.store.kinds);
    const p = (a.props as { end: [number, number] }).end;
    const tip = g?.toPage(p[0], p[1]) ?? { x: Number.NaN, y: Number.NaN };
    const box = shapeGeometry(get(rig, c.id), rig.core.store.kinds)?.box as Bounds;
    const left = get(rig, c.id).x + box.minX;
    // 8 units along the line, which comes in nearly level
    expect(left - tip.x).toBeGreaterThan(ARROW_GAP - 0.1);
    expect(left - tip.x).toBeLessThanOrEqual(ARROW_GAP + 1e-6);
  });
});

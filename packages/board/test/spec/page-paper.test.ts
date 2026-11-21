/**
 * Page paper and the selection bar (docs/features/board/ui.md Pages, Layout; design.md 10 Page paper; findings BR-18 and
 * BR-36). The paper (plain, grid, dots, lines) is drawn in each tile under the shapes, is chosen in the style bar or the page
 * menu, follows the snap grid (24 units; lines 32 apart) and is not drawn when finer than 5 pixels. The selection bar is one
 * row that never wraps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_UNITS, PAGE_BACKGROUNDS, addFigure, createBoard } from '../../src/index';
import type { Board } from '../../src/index';
import { must, stubSize } from './round4-helpers';

interface Paint {
  /** `fillRect(x, y, w, h)` calls. */
  readonly rects: (readonly number[])[];
  /** `arc(x, y, r, …)` calls. */
  readonly arcs: (readonly number[])[];
}

/** A Canvas 2D stand-in that keeps the arguments of the calls the paper is made of. */
function recordCanvas(): { paint: Paint; restore(): void; clear(): void } {
  const paint: { rects: (readonly number[])[]; arcs: (readonly number[])[] } = { rects: [], arcs: [] };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) => {
    if (type !== '2d') return null;
    return new Proxy(
      {},
      {
        get: (_t, name) => {
          if (typeof name !== 'string') return undefined;
          return (...args: number[]): unknown => {
            if (name === 'fillRect') paint.rects.push(args);
            else if (name === 'arc') paint.arcs.push(args);
            return undefined;
          };
        },
        set: () => true,
      },
    );
  }) as unknown as HTMLCanvasElement['getContext']);
  return {
    paint,
    restore: () => spy.mockRestore(),
    clear: () => {
      paint.rects.length = 0;
      paint.arcs.length = 0;
    },
  };
}

let rec: ReturnType<typeof recordCanvas>;
let unsize: () => void;
let container: HTMLElement;
let board: Board;
let now = 0;

beforeEach(() => {
  rec = recordCanvas();
  unsize = stubSize(1024, 768);
  container = document.createElement('div');
  document.body.append(container);
  board = must(createBoard({ container, canvas2dOnly: true }));
  now = 0;
});
afterEach(() => {
  board.dispose();
  container.remove();
  unsize();
  rec.restore();
});

/** Draws the frames the board needs until every tile is drawn. */
function draw(): void {
  for (let i = 0; i < 8; i++) {
    now += 20;
    board.view?.render(now);
  }
}

/** The upward steps between neighbouring values (a step down starts the next tile or row and is dropped). */
const steps = (values: readonly number[]): number[] => values.slice(1).map((x, i) => x - (values[i] as number)).filter((d) => d > 0);

const page = (): string => board.core.pages.current as string;
const paperOf = (): string | undefined => board.core.pages.get(page())?.background;
const horizontal = (): number[][] => rec.paint.rects.filter((r) => r[3] === 1 && (r[2] as number) > 1).map((r) => [...r]);
const vertical = (): number[][] => rec.paint.rects.filter((r) => r[2] === 1 && (r[3] as number) > 1).map((r) => [...r]);

describe('page paper is drawn (BR-18; design 10 Page paper)', () => {
  it('has four papers: plain, grid, dots, lines', () => {
    expect([...PAGE_BACKGROUNDS].sort()).toEqual(['dots', 'grid', 'lines', 'none']);
  });

  it('a new page is plain and draws no paper', () => {
    expect(paperOf()).toBe('none');
    draw();
    expect(horizontal().length).toBe(0);
    expect(vertical().length).toBe(0);
    expect(rec.paint.arcs.length).toBe(0);
  });

  it('grid draws horizontal and vertical lines 24 units apart (the snap grid)', () => {
    expect(GRID_UNITS).toBe(24);
    expect(board.view?.setBackground('grid').ok).toBe(true);
    draw();
    const h = horizontal();
    const v = vertical();
    expect(h.length).toBeGreaterThan(0);
    expect(v.length).toBeGreaterThan(0);
    // calls come tile by tile, each tile top to bottom or left to right: a step up inside a tile is one spacing
    expect(steps(h.map((r) => r[1] as number)).every((g) => g === 24)).toBe(true);
    expect(steps(v.map((r) => r[0] as number)).every((g) => g === 24)).toBe(true);
    expect(steps(h.map((r) => r[1] as number)).length).toBeGreaterThan(5);
  });

  it('dots draw a dot at each crossing of the grid and no lines', () => {
    board.view?.setBackground('dots');
    draw();
    expect(rec.paint.arcs.length).toBeGreaterThan(0);
    expect(horizontal().length).toBe(0);
    expect(vertical().length).toBe(0);
    const across = steps(rec.paint.arcs.map((a) => a[0] as number));
    expect(across.length).toBeGreaterThan(5);
    expect(across.every((g) => Math.abs(g - 24) < 1e-6)).toBe(true);
  });

  it('lines draw ruled horizontal lines 32 units apart and nothing vertical', () => {
    board.view?.setBackground('lines');
    draw();
    const h = horizontal();
    expect(h.length).toBeGreaterThan(0);
    expect(vertical().length).toBe(0);
    expect(rec.paint.arcs.length).toBe(0);
    const down = steps(h.map((r) => r[1] as number));
    expect(down.length).toBeGreaterThan(5);
    expect(down.every((g) => g === 32)).toBe(true);
  });

  it('changing the paper draws the tiles again with the new paper (grid, then plain)', () => {
    board.view?.setBackground('grid');
    draw();
    expect(horizontal().length).toBeGreaterThan(0);
    rec.clear();
    board.view?.setBackground('none');
    draw();
    expect(horizontal().length).toBe(0);
    expect(vertical().length).toBe(0);
  });

  it('is not drawn when finer than 5 pixels (zoomed far out)', () => {
    board.core.camera?.moveTo(0, 0, 0.1, now);
    now += 1000;
    draw();
    board.view?.setBackground('grid');
    rec.clear();
    draw();
    expect(horizontal().length).toBe(0);
    expect(vertical().length).toBe(0);
  });

  it('is drawn again when zoomed back in', () => {
    board.core.camera?.moveTo(0, 0, 0.1, now);
    now += 1000;
    draw();
    board.view?.setBackground('grid');
    draw();
    rec.clear();
    board.core.camera?.moveTo(0, 0, 1, now);
    now += 1000;
    draw();
    expect(horizontal().length).toBeGreaterThan(0);
  });

  it('each page has its own paper, and a new page after a grid page is plain', () => {
    board.view?.setBackground('grid');
    const first = page();
    board.view?.addPage();
    expect(page()).not.toBe(first);
    expect(paperOf()).toBe('none');
    expect(board.core.pages.get(first)?.background).toBe('grid');
  });

  it('is saved with the page: a saved board opens with the same paper', () => {
    board.view?.setBackground('dots');
    const text = must(board.save());
    const again = must(createBoard({ document: text }));
    expect(again.core.pages.get(again.core.pages.current as string)?.background).toBe('dots');
    again.dispose();
  });

  it('refuses a paper that is not one of the four, and changes nothing', () => {
    board.view?.setBackground('grid');
    const done = board.view?.setBackground('hexagons' as never);
    expect(done?.ok).toBe(false);
    expect(paperOf()).toBe('grid');
  });
});

describe('page paper is chosen (BR-18; ui.md Pages)', () => {
  const choice = (id: string): HTMLButtonElement | null => container.querySelector(`.ib-style [data-background="${id}"]`);

  it('shows the four papers in the style bar when the select tool has nothing selected', () => {
    board.setTool('select');
    for (const id of PAGE_BACKGROUNDS) expect(choice(id), id).not.toBeNull();
  });

  it('shows them for the hand tool too, and not for the pen', () => {
    board.setTool('hand');
    expect(choice('grid')).not.toBeNull();
    board.setTool('pen');
    expect(choice('grid')).toBeNull();
  });

  it('does not show them while a shape is selected', () => {
    const id = must(addFigure(board.core, { at: { x: 100, y: 100 } }));
    board.setTool('select');
    board.core.selection.set([id]);
    expect(choice('grid')).toBeNull();
  });

  it('a press on Grid sets the page\'s paper and marks the choice pressed', () => {
    board.setTool('select');
    choice('grid')?.click();
    expect(paperOf()).toBe('grid');
    expect(choice('grid')?.getAttribute('aria-pressed')).toBe('true');
    expect(choice('none')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('choosing a paper is one undo step, and undo gives the old paper back', () => {
    board.setTool('select');
    choice('lines')?.click();
    expect(paperOf()).toBe('lines');
    board.core.history.undo();
    expect(paperOf()).toBe('none');
    board.core.history.redo();
    expect(paperOf()).toBe('lines');
  });

  it('the page menu lists the paper, and an item sets it', () => {
    container.querySelector<HTMLButtonElement>('[data-action="page-menu"]')?.click();
    const menu = container.querySelector('[data-menu="page"]') as HTMLElement;
    const item = [...menu.querySelectorAll<HTMLButtonElement>('[data-item]')].find((b) => (b.dataset['item'] ?? '').includes('dots'));
    expect(item).toBeDefined();
    item?.click();
    expect(paperOf()).toBe('dots');
  });

  it('the page menu\'s item for the paper already set is disabled', () => {
    board.view?.setBackground('grid');
    container.querySelector<HTMLButtonElement>('[data-action="page-menu"]')?.click();
    const menu = container.querySelector('[data-menu="page"]') as HTMLElement;
    const item = [...menu.querySelectorAll<HTMLButtonElement>('[data-item]')].find((b) => (b.dataset['item'] ?? '').includes('grid'));
    expect(item?.disabled).toBe(true);
  });
});

describe('the selection bar is one row (BR-36; ui.md Layout)', () => {
  const css = (): string => [...document.head.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  const rule = (selector: string): string => new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*\\}`).exec(css())?.[0] ?? '';

  it('never wraps and scrolls sideways when it does not fit (a phone)', () => {
    const r = rule('.ib-actions');
    expect(r).not.toBe('');
    expect(r).toMatch(/flex-wrap:\s*nowrap/);
    expect(r).toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  it('keeps each of its buttons on one line', () => {
    expect(rule('.ib-actions button,.ib-actions select')).toMatch(/white-space:\s*nowrap/);
  });

  it('is not placed from the middle with a translate, which made its width half the view (the cause of the second row)', () => {
    expect(rule('.ib-actions')).not.toMatch(/left:\s*50%/);
  });

  it('shows all its commands in one bar, as direct children, when a shape is selected', () => {
    const bar = container.querySelector('.ib-actions') as HTMLElement;
    expect(bar.hidden).toBe(true);
    const id = must(addFigure(board.core, { at: { x: 100, y: 100 } }));
    board.core.selection.set([id]);
    expect(bar.hidden).toBe(false);
    const labels = [...bar.children].map((c) => (c as HTMLElement).dataset['action']);
    for (const a of ['duplicate', 'group', 'ungroup', 'lock', 'front', 'back', 'align', 'distribute', 'delete']) expect(labels, a).toContain(a);
    expect([...bar.children].every((c) => c.tagName === 'BUTTON' || c.tagName === 'SELECT')).toBe(true);
  });

  it('is hidden again when nothing is selected', () => {
    const id = must(addFigure(board.core, { at: { x: 100, y: 100 } }));
    board.core.selection.set([id]);
    board.core.selection.clear();
    expect((container.querySelector('.ib-actions') as HTMLElement).hidden).toBe(true);
  });
});

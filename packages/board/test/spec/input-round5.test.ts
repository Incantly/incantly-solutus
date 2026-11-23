/**
 * Round 5 fix BR-58 (handoff/board/findings.md; design 3): a press on something that is not the board (a button, a
 * menu, a panel) is not board input.
 */
import { describe, expect, it, vi } from 'vitest';
import { WebInput, createBoard } from '../../src/index';
import { installCanvas2d } from './ink-helpers';
import { must, stubSize } from './round4-helpers';

describe('BR-58: only the board is board input (design 3, 6.1)', () => {
  const pointer = (type: string, target: EventTarget): void => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true });
    for (const [k, v] of Object.entries({ pointerType: 'pen', pointerId: 4, clientX: 30, clientY: 40, pressure: 0.4, buttons: type === 'pointerup' ? 0 : 1, timeStamp: 10 })) Object.defineProperty(e, k, { value: v, configurable: true });
    target.dispatchEvent(e);
  };

  it('a press on an element the input layer does not accept is not heard, nor are its moves and its release', () => {
    const el = document.createElement('div');
    const button = document.createElement('button');
    el.append(button);
    document.body.append(el);
    const heard: string[] = [];
    const input = new WebInput({
      element: el,
      sink: { sample: (s) => heard.push(s.phase), key: () => undefined, wheel: () => undefined, gesture: () => undefined },
      accepts: (t) => t === el,
    });
    pointer('pointerdown', button);
    pointer('pointermove', el);
    pointer('pointerup', button);
    expect(heard).toEqual([]);
    // the refusal ends with the release: the next press on the board is heard
    pointer('pointerdown', el);
    pointer('pointerup', el);
    expect(heard).toEqual(['down', 'up']);
    input.dispose();
    el.remove();
  });

  it('a press inside the board that is not on its canvases or its card layer is not a stroke', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const fake = installCanvas2d();
    const unsize = stubSize(1000, 700);
    const container = document.createElement('div');
    document.body.append(container);
    const board = must(createBoard({ container, canvas2dOnly: true }));
    const page = board.core.pages.current as string;
    const surface = container.querySelector('.ib-surface') as HTMLElement;
    const stray = document.createElement('button');
    surface.append(stray);
    expect(board.tool).toBe('pen');
    pointer('pointerdown', stray);
    pointer('pointerup', stray);
    expect(board.core.store.shapeCount(page)).toBe(0);
    // a toolbar button, a sibling of the surface, never reaches it
    const toolButton = container.querySelector('.ib-tools button') as HTMLElement;
    pointer('pointerdown', toolButton);
    pointer('pointerup', toolButton);
    expect(board.core.store.shapeCount(page)).toBe(0);
    // the canvas itself is the board
    const canvas = container.querySelector('.ib-surface canvas') as HTMLElement;
    pointer('pointerdown', canvas);
    pointer('pointerup', canvas);
    expect(board.core.store.shapeCount(page)).toBe(1);
    board.dispose();
    container.remove();
    unsize();
    fake.restore();
    vi.useRealTimers();
  });
});

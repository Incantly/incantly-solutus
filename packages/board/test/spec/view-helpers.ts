/**
 * Shared set-up for the round 6 view tests: a page with a size (happy-dom has no layout), animation frames a test runs
 * itself, and a clock a test moves. Only the public API of `packages/board` is used.
 */
import { vi } from 'vitest';
import type { MockInstance } from 'vitest';

export interface Browser {
  /** The animation frames asked for and not run yet. */
  readonly queue: ((now: number) => void)[];
  restore(): void;
}

/** Takes over `requestAnimationFrame` so a test decides when a frame runs, and gives every element a size. */
export function stubBrowser(width = 800, height = 600): Browser {
  const queue: ((now: number) => void)[] = [];
  const raf = window.requestAnimationFrame;
  const caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queue.push(cb);
    return queue.length;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue[id - 1] = () => undefined;
  };
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => height });
  return {
    queue,
    restore: () => {
      window.requestAnimationFrame = raf;
      window.cancelAnimationFrame = caf;
      delete (proto as unknown as Record<string, unknown>)['clientWidth'];
      delete (proto as unknown as Record<string, unknown>)['clientHeight'];
    },
  };
}

/** A clock a test moves: `performance.now()` answers `clock.now`. */
export interface FakeClock {
  now: number;
  restore(): void;
}

export function fakeClock(): FakeClock {
  const clock: FakeClock & { spy?: MockInstance } = {
    now: 0,
    restore: () => {
      clock.spy?.mockRestore();
    },
  };
  clock.spy = vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  return clock;
}

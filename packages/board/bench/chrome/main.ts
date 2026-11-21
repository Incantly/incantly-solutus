/**
 * The page of the "open a board" row of `chrome-board.mjs` (design 13: a 1,000-shape board opens in under 200 ms to its
 * first picture). `window.boardOpen(count)` builds a document of `count` shapes (not timed), then times
 * `createBoard({ container, document })` up to the end of the board's first frame, which runs on the next animation
 * frame; a callback asked for after `createBoard` runs after the board's own, so the time taken when it runs is the end
 * of the first frame's script. The frame after it starts when the first picture can be on screen.
 */
import { createBoard } from '../../src/index';
import { documentOf } from './data';

export interface OpenResult {
  /** `createBoard` returned (parse, check, index, DOM). */
  readonly created: number;
  /** The end of the board's first frame, from the call. */
  readonly firstFrame: number;
  /** The start of the frame after it: an upper bound for the first picture on screen. */
  readonly onScreen: number;
  readonly shapes: number;
  readonly tiles: number;
  readonly backend: string;
}

const frame = (): Promise<number> => new Promise((resolve) => window.requestAnimationFrame(() => resolve(performance.now())));

async function open(count: number): Promise<OpenResult> {
  const text = documentOf(count, 'mixed');
  const host = document.getElementById('host') as HTMLElement;
  host.replaceChildren();
  // a frame first, so the page is idle and the call is not charged for the one before it
  await frame();
  const t0 = performance.now();
  const made = createBoard({ container: host, document: text });
  if (!made.ok) throw new Error(`${made.kind}: ${made.message}`);
  const created = performance.now() - t0;
  const first = (await frame()) - t0;
  const next = (await frame()) - t0;
  const view = host.querySelector('.ib-view') as HTMLElement;
  const result: OpenResult = { created, firstFrame: first, onScreen: next, shapes: Number(view.dataset['shapes']), tiles: Number(view.dataset['tiles']), backend: view.dataset['backend'] ?? '' };
  made.value.dispose();
  return result;
}

(window as unknown as { boardOpen: typeof open }).boardOpen = open;

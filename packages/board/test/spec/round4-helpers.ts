/**
 * Shared set-up for the round-4 spec tests (figure cards and the customisable board). Only the public API of
 * `packages/board` is used: `createBoard`, the view it returns, the card layer, and the DOM the docs describe.
 */
import type { Board, BoardError, KeyInput } from '../../src/index';

/** happy-dom has no layout: give every element a size so the view has a surface to draw on. */
export function stubSize(width = 800, height = 600): () => void {
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    delete (proto as unknown as Record<string, unknown>)['clientWidth'];
    delete (proto as unknown as Record<string, unknown>)['clientHeight'];
  };
}

/** A key press as the input layer would send it. */
export function keyOf(key: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}, down = true): KeyInput {
  return { key, down, shift: mods.shift === true, alt: mods.alt === true, mod: mods.mod === true, repeat: false };
}

/** Presses and releases a key on the board's tool host; true when the board used it. */
export function press(board: Board, key: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
  const used = board.host.key(keyOf(key, mods, true));
  board.host.key(keyOf(key, mods, false));
  return used;
}

/** A board made or an error: the tests want the board. */
export function must<T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly kind: string; readonly message: string }): T {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
}

export const kinds = (errors: readonly BoardError[]): string[] => errors.map((e) => e.kind);

/** A script that follows the format of design 7.4 (header line, then lines). */
export const SCRIPT = '# incantly 1\na = 1\nb = a + 1';

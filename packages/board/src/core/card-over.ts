/**
 * What is drawn over the figure cards (design 8, BR-55). The cards are a DOM layer above the board's tiles, so ink,
 * arrows and text whose order is above a card would be hidden by it. This finds those shapes: for each one, the page
 * outlines of the cards it is above and touches. The painter draws the shape on a layer above the cards, clipped to
 * those outlines, so on screen it shows over the card and nothing is drawn twice (the card hides the tile under it). A
 * highlighter is below every shape, so it stays under the cards. No DOM, no timers.
 */
import type { BoardCore } from './board';
import { shapeGeometry } from './geometry';
import type { Bounds, ShapeRecord } from './types';
import { isShape } from './types';

export interface OverCard {
  readonly shape: ShapeRecord;
  /** The corners of each card the shape is above and touches, as `[x0, y0, …]` in page units. */
  readonly clip: readonly (readonly number[])[];
}

const meets = (a: Bounds, b: Bounds): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
const above = (a: ShapeRecord, b: ShapeRecord): boolean => a.index > b.index || (a.index === b.index && a.id > b.id);
const isHighlighter = (s: ShapeRecord): boolean => s.kind === 'ink' && (s.props as { nib?: unknown }).nib === 'highlighter';

/**
 * The shapes above any of `cards` that touch it, in drawing order, each with the outlines of the cards it is above. A
 * card is never drawn over another (their order is the DOM's).
 */
export function shapesOverCards(core: BoardCore, cards: readonly ShapeRecord[]): OverCard[] {
  const found = new Map<string, { shape: ShapeRecord; clip: number[][] }>();
  const ids: string[] = [];
  for (const card of cards) {
    const g = shapeGeometry(card, core.store.kinds);
    if (g === undefined) continue;
    ids.length = 0;
    core.drawList.cull(g.bounds, 0, ids);
    for (const id of ids) {
      const s = core.store.get(id);
      if (s === undefined || !isShape(s) || s.page !== card.page || s.kind === 'figure' || s.kind === 'group' || isHighlighter(s) || !above(s, card)) continue;
      const sg = shapeGeometry(s, core.store.kinds);
      if (sg === undefined || !meets(sg.bounds, g.bounds)) continue;
      const known = found.get(id);
      if (known === undefined) found.set(id, { shape: s, clip: [[...g.corners]] });
      else known.clip.push([...g.corners]);
    }
  }
  return [...found.values()].sort((a, b) => (a.shape.index < b.shape.index ? -1 : a.shape.index > b.shape.index ? 1 : a.shape.id < b.shape.id ? -1 : 1));
}

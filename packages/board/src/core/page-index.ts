/**
 * The spatial index of the current page (design 5 and 9): only the current page has one. It is built from the page's
 * shapes when the page becomes current and follows every diff after that, so a query reads only the cells it covers.
 * No DOM, no timers.
 */
import { shapeBounds } from './geometry';
import { IndexGrid } from './index-grid';
import type { KindRegistry } from './kinds/def';
import type { Pages } from './pages';
import type { Store } from './store';
import { isShape } from './types';
import type { Diff, ShapeRecord } from './types';

export class PageIndex {
  readonly grid = new IndexGrid();
  readonly #store: Store;
  #page: string | null = null;
  readonly #stops: readonly (() => void)[];

  constructor(store: Store, pages: Pages) {
    this.#store = store;
    this.#stops = [store.on((diff) => this.#follow(diff)), pages.onCurrent((page) => this.#switch(page))];
    this.#switch(pages.current);
  }

  /** The kinds of the store the index follows. */
  get kinds(): KindRegistry {
    return this.#store.kinds;
  }

  /** The page the index holds, or null. */
  get page(): string | null {
    return this.#page;
  }

  dispose(): void {
    for (const stop of this.#stops) stop();
    this.grid.clear();
  }

  /** The shape with this id, when it is on the indexed page. */
  shape(id: string): ShapeRecord | undefined {
    const r = this.#store.get(id);
    return r !== undefined && isShape(r) && r.page === this.#page ? r : undefined;
  }

  /**
   * The shape with this id, for an id that this index's own grid just gave: the grid holds only shapes of the indexed page, so
   * the checks `shape` makes are not made (thousands of ids from one query are looked up with one call each).
   */
  held(id: string): ShapeRecord | undefined {
    return this.#store.get(id) as ShapeRecord | undefined;
  }

  /** Reads the page's shapes again: their boxes changed without a diff (the text measuring function was replaced). */
  refresh(): void {
    this.#switch(this.#page);
  }

  #switch(page: string | null): void {
    this.#page = page;
    this.grid.clear();
    if (page === null) return;
    for (const s of this.#store.shapesOn(page)) this.#put(s);
  }

  #put(s: ShapeRecord): void {
    const b = shapeBounds(s, this.#store.kinds);
    if (b === undefined) this.grid.remove(s.id);
    else this.grid.insert(s.id, b);
  }

  #follow(diff: Diff): void {
    if (this.#page === null) return;
    for (const r of diff.removed) if (isShape(r) && r.page === this.#page) this.grid.remove(r.id);
    for (const r of diff.added) if (isShape(r) && r.page === this.#page) this.#put(r);
    for (const u of diff.updated) {
      if (!isShape(u.after) || u.after.page !== this.#page) continue;
      this.#put(u.after);
    }
  }
}

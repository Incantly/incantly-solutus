/**
 * The selection: the ids of the shapes chosen on the current page. It is not in the store and not an undo step
 * (design 4). The lasso sets it; round 3's select tool will too. No DOM, no timers.
 */
export type SelectionListener = (ids: readonly string[]) => void;

export class Selection {
  #ids: readonly string[] = [];
  #listeners: readonly SelectionListener[] = [];

  /** The selected ids, in the order they were set. */
  get ids(): readonly string[] {
    return this.#ids;
  }

  get size(): number {
    return this.#ids.length;
  }

  has(id: string): boolean {
    return this.#ids.includes(id);
  }

  /** Replaces the selection. */
  set(ids: readonly string[]): void {
    const next = [...new Set(ids)];
    if (next.length === this.#ids.length && next.every((id, i) => id === this.#ids[i])) return;
    this.#ids = next;
    this.#notify();
  }

  /**
   * Replaces the selection with ids the caller knows are all different. The array is kept as it is (the caller makes it
   * and does not change it again), so a selection of thousands of shapes is not copied twice.
   */
  setDistinct(ids: readonly string[]): void {
    const was = this.#ids;
    if (ids.length === was.length) {
      let same = true;
      for (let i = 0; same && i < ids.length; i++) if (ids[i] !== was[i]) same = false;
      if (same) return;
    }
    this.#ids = ids;
    this.#notify();
  }

  clear(): void {
    this.set([]);
  }

  /** Calls `listener` after every change. Returns the function that stops it. */
  on(listener: SelectionListener): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  #notify(): void {
    for (const l of this.#listeners) {
      try {
        l(this.#ids);
      } catch {
        // a listener's failure does not stop the others
      }
    }
  }
}

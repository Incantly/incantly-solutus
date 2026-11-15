/**
 * The studio's selection (algebra-view design 3.9): which objects are selected, in the order they were picked, and which
 * one the pointer is over. It belongs to the view layer, not the kernel: nothing here is saved in the script.
 * The expression list, the graph, the tools (as preselection, tools-2d design 5.4) and the simulation strip read it.
 */
export interface Selection {
  /** Selected names, in pick order. */
  names(): readonly string[];
  has(name: string): boolean;
  /** Replaces the selection with one object, or clears it with `undefined`. */
  set(name: string | undefined): void;
  /** Adds a name, or removes it when it is there (Shift or Ctrl/Cmd click). */
  toggle(name: string): void;
  clear(): void;
  /** Drops names that no longer exist, keeping the order of the rest. */
  keep(exists: (name: string) => boolean): void;
  /** Renames a selected object in place. */
  rename(from: string, to: string): void;
  /** The object the pointer is over, in the list or on the canvas. */
  hover(): string | undefined;
  setHover(name: string | undefined): void;
  /** Called after every change; `source` says who made it, so a pane does not answer its own change. */
  onChange(fn: (source: SelectionSource) => void): () => void;
}

export type SelectionSource = 'list' | 'canvas' | 'tool' | 'figure';

export function createSelection(): Selection {
  let picked: string[] = [];
  let over: string | undefined;
  const listeners = new Set<(s: SelectionSource) => void>();
  let source: SelectionSource = 'figure';
  const emit = (): void => {
    for (const fn of listeners) fn(source);
  };
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  const write = (next: string[]): void => {
    if (same(next, picked)) return;
    picked = next;
    emit();
  };
  const api: Selection & { from(s: SelectionSource): Selection } = {
    names: () => picked,
    has: (n) => picked.includes(n),
    set: (n) => write(n === undefined ? [] : [n]),
    toggle: (n) => write(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n]),
    clear: () => write([]),
    keep(exists) {
      write(picked.filter(exists));
      if (over !== undefined && !exists(over)) api.setHover(undefined);
    },
    rename(from, to) {
      if (picked.includes(from)) write(picked.map((x) => (x === from ? to : x)));
    },
    hover: () => over,
    setHover(n) {
      if (n === over) return;
      over = n;
      emit();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** The same selection, with changes marked as coming from `s`. */
    from(s) {
      const wrap = <A extends unknown[]>(f: (...a: A) => void) => (...a: A): void => {
        const prev = source;
        source = s;
        try {
          f(...a);
        } finally {
          source = prev;
        }
      };
      return { ...api, set: wrap(api.set), toggle: wrap(api.toggle), clear: wrap(api.clear), setHover: wrap(api.setHover) };
    },
  };
  return api;
}

/** The selection as seen from one pane: its changes are marked with that pane's name. */
export function selectionFrom(sel: Selection, source: SelectionSource): Selection {
  const f = (sel as Selection & { from?: (s: SelectionSource) => Selection }).from;
  return f ? f(source) : sel;
}

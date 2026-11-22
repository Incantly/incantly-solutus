/**
 * Pages (design 5): a document holds 1 to 100 pages in order, each an endless plane. The commands `addPage`,
 * `removePage`, `renamePage`, `movePage` and `duplicatePage` are one store transaction each, so one undo step each;
 * `goToPage` only moves the current page and is not a step. The page count's states are read from the count each
 * time, never kept in a field (docs/state-machines.md, B3).
 */
import { cameraIdOf } from './camera';
import { PAGE_NAME_MAX } from './check';
import { copyProps } from './copy';
import { boardError, ok } from './errors';
import type { BoardResult } from './errors';
import { FIRST_KEY, keyBetween } from './fractional';
import type { Store } from './store';
import { PAGE_BACKGROUNDS, isBinding, isCamera, isPage } from './types';
import type { BindingRecord, CameraRecord, Diff, Origin, PageBackground, PageRecord, ShapeRecord } from './types';

/** B3: `empty` (no page), `single` (one), `several` (2 up to the limit minus one), `full` (the limit). */
export type PagesState = 'empty' | 'single' | 'several' | 'full';

export interface AddPageOptions {
  /** Default `Page N`. */
  readonly name?: string;
  /** Default `none`. */
  readonly background?: PageBackground;
  /** The page the new one goes after; default the end. */
  readonly after?: string;
}

export type CurrentListener = (page: string | null) => void;

const byOrder = (a: PageRecord, b: PageRecord): number => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class Pages {
  readonly #store: Store;
  #sorted: readonly PageRecord[] = [];
  #current: string | null = null;
  #listeners: readonly CurrentListener[] = [];
  readonly #stop: () => void;

  constructor(store: Store) {
    this.#store = store;
    this.#rebuild();
    this.#stop = store.on((diff) => this.#follow(diff));
  }

  dispose(): void {
    this.#stop();
    this.#listeners = [];
  }

  /** `empty`, `single`, `several` or `full` (the page limit), derived from the number of pages each time it is read. */
  get state(): PagesState {
    const count = this.#sorted.length;
    if (count === 0) return 'empty';
    if (count === 1) return 'single';
    return count >= this.#store.limits.pages ? 'full' : 'several';
  }

  /** The pages in order. */
  list(): readonly PageRecord[] {
    return this.#sorted;
  }

  get(id: string): PageRecord | undefined {
    // a loop, not `find` with an arrow: the arrow would be a new closure at every call, and a frame asks for its page
    const sorted = this.#sorted;
    for (let i = 0; i < sorted.length; i++) if ((sorted[i] as PageRecord).id === id) return sorted[i];
    return undefined;
  }

  /** The current page's id, or null when there is no page. */
  get current(): string | null {
    return this.#current;
  }

  /** Calls `listener` when the current page changes. Returns the function that stops it. */
  onCurrent(listener: CurrentListener): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  /** Makes a page current. Not an undo step. */
  goToPage(id: string): BoardResult<PageRecord> {
    const page = this.get(id);
    if (page === undefined) return boardError('bad_argument', `There is no page "${id}".`, { detail: { page: id } });
    this.#setCurrent(id);
    return ok(page);
  }

  addPage(options: AddPageOptions = {}, origin: Origin = 'user'): BoardResult<PageRecord> {
    if (this.state === 'full') return this.#limit();
    const position = this.#positionAfter(options.after);
    if (!position.ok) return position;
    const name = options.name ?? `Page ${this.#sorted.length + 1}`;
    const done = this.#store.change(origin, (tx) => {
      const page: PageRecord = { id: tx.newId('page'), name, index: position.value, background: options.background ?? 'none' };
      return tx.put(page);
    });
    if (!done.ok) return done;
    const made = done.value.value;
    return made.ok ? ok(made.value as PageRecord) : made;
  }

  /** Removes a page with its shapes, its camera and the bindings of its shapes. The last page cannot go. */
  removePage(id: string, origin: Origin = 'user'): BoardResult<undefined> {
    if (this.get(id) === undefined) return boardError('bad_argument', `There is no page "${id}".`, { detail: { page: id } });
    if (this.state === 'single' || this.state === 'empty') {
      return boardError('last_page', 'The last page cannot be removed.', { hint: 'Add another page first.', detail: { page: id } });
    }
    const done = this.#store.change(origin, (tx) => {
      const gone = new Set<string>();
      for (const s of this.#store.shapesOn(id)) {
        gone.add(s.id);
        tx.remove(s.id);
      }
      for (const b of this.#store.all('binding')) {
        if (isBinding(b) && (gone.has(b.from) || gone.has(b.to))) tx.remove(b.id);
      }
      const camera = cameraIdOf(id);
      if (tx.get(camera) !== undefined) tx.remove(camera);
      tx.remove(id);
    });
    return done.ok ? ok(undefined) : done;
  }

  renamePage(id: string, name: string, origin: Origin = 'user'): BoardResult<PageRecord> {
    if (this.get(id) === undefined) return boardError('bad_argument', `There is no page "${id}".`, { detail: { page: id } });
    if (typeof name !== 'string' || name === '' || name.length > PAGE_NAME_MAX) {
      return boardError('record_invalid', `A page name is 1 to ${PAGE_NAME_MAX} characters.`, { detail: { record: id, field: 'name' } });
    }
    const done = this.#store.change(origin, (tx) => tx.update(id, { name }));
    if (!done.ok) return done;
    return done.value.value as BoardResult<PageRecord>;
  }

  /** Sets the page's paper: plain, grid, dots or lines. One undo step. */
  setBackground(id: string, background: PageBackground, origin: Origin = 'user'): BoardResult<PageRecord> {
    const page = this.get(id);
    if (page === undefined) return boardError('bad_argument', `There is no page "${id}".`, { detail: { page: id } });
    if (!(PAGE_BACKGROUNDS as readonly unknown[]).includes(background)) {
      return boardError('record_invalid', `A page background is one of ${PAGE_BACKGROUNDS.join(', ')}.`, { detail: { record: id, field: 'background' } });
    }
    if (page.background === background) return ok(page);
    const done = this.#store.change(origin, (tx) => tx.update(id, { background }));
    if (!done.ok) return done;
    return done.value.value as BoardResult<PageRecord>;
  }

  /** Moves a page to a place in the order, counted from 0. */
  movePage(id: string, position: number, origin: Origin = 'user'): BoardResult<PageRecord> {
    const page = this.get(id);
    if (page === undefined) return boardError('bad_argument', `There is no page "${id}".`, { detail: { page: id } });
    const others = this.#sorted.filter((p) => p.id !== id);
    if (!Number.isInteger(position) || position < 0 || position > others.length) {
      return boardError('bad_argument', `A page position is a whole number from 0 to ${others.length}.`, { detail: { position } });
    }
    const index = keyBetween(others[position - 1]?.index ?? null, others[position]?.index ?? null);
    if (!index.ok) return index;
    const done = this.#store.change(origin, (tx) => tx.update(id, { index: index.value }));
    if (!done.ok) return done;
    return done.value.value as BoardResult<PageRecord>;
  }

  /** Copies a page, with its shapes, the bindings between them and its camera, to the place after it. */
  duplicatePage(id: string, origin: Origin = 'user'): BoardResult<PageRecord> {
    const page = this.get(id);
    if (page === undefined) return boardError('bad_argument', `There is no page "${id}".`, { detail: { page: id } });
    if (this.state === 'full') return this.#limit();
    const position = this.#positionAfter(id);
    if (!position.ok) return position;
    const done = this.#store.change(origin, (tx) => {
      const copy: PageRecord = { ...page, id: tx.newId('page'), name: `${page.name} (copy)`.slice(0, PAGE_NAME_MAX), index: position.value };
      const made = tx.put(copy);
      if (!made.ok) return made;
      const map = new Map<string, string>();
      const shapes = this.#store.shapesOn(id);
      for (const s of shapes) map.set(s.id, tx.newId('shape'));
      for (const s of shapes) {
        const parent = s.parent === null ? null : (map.get(s.parent) ?? null);
        const next: ShapeRecord = { ...s, id: map.get(s.id) as string, page: copy.id, parent, props: copyProps(s.props), meta: copyProps(s.meta) };
        tx.put(next);
      }
      for (const b of this.#store.all('binding')) {
        if (!isBinding(b)) continue;
        const from = map.get(b.from);
        const to = map.get(b.to);
        if (from !== undefined && to !== undefined) tx.put({ ...b, id: tx.newId('binding'), from, to, props: copyProps(b.props) } satisfies BindingRecord);
      }
      const saved = this.#store.get(cameraIdOf(id));
      if (saved !== undefined && isCamera(saved)) {
        tx.put({ ...saved, id: cameraIdOf(copy.id), page: copy.id } satisfies CameraRecord);
      }
      return made;
    }, { allowUnknownKinds: true });
    if (!done.ok) return done;
    const made = done.value.value;
    return made.ok ? ok(made.value as PageRecord) : made;
  }

  /** The order key for a new page after `after` (or at the end). */
  #positionAfter(after: string | undefined): BoardResult<string> {
    const list = this.#sorted;
    if (after === undefined) return list.length === 0 ? ok(FIRST_KEY) : keyBetween(list[list.length - 1]?.index ?? null, null);
    const at = list.findIndex((p) => p.id === after);
    if (at < 0) return boardError('bad_argument', `There is no page "${after}".`, { detail: { page: after } });
    return keyBetween(list[at]?.index ?? null, list[at + 1]?.index ?? null);
  }

  #limit(): BoardResult<never> {
    const limit = this.#store.limits.pages;
    return boardError('limit', `This board has ${limit} pages, which is the limit.`, {
      hint: 'Remove a page you do not need.',
      detail: { limit, what: 'pages' },
    });
  }

  #follow(diff: Diff): void {
    const touched = diff.added.some(isPage) || diff.removed.some(isPage) || diff.updated.some((u) => isPage(u.after));
    if (touched) this.#rebuild();
  }

  #rebuild(): void {
    const before = this.#sorted;
    const pages = this.#store.all('page').filter(isPage).sort(byOrder);
    this.#sorted = pages;
    const current = this.#current;
    if (current !== null && pages.some((p) => p.id === current)) return;
    const was = before.findIndex((p) => p.id === current);
    const keep = pages[Math.min(Math.max(was, 0), pages.length - 1)];
    this.#setCurrent(keep?.id ?? null);
  }

  #setCurrent(id: string | null): void {
    if (id === this.#current) return;
    this.#current = id;
    for (const l of this.#listeners) {
      try {
        l(id);
      } catch {
        // a listener's failure does not stop the pages
      }
    }
  }
}

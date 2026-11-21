/**
 * The headless board: the pieces of the core put together (design 10, "headless"). A store with the built-in kinds,
 * pages, one camera per page, the undo history, the index of the current page, the selection and the stroke being
 * drawn. A host or a test builds one with `BoardCore.create`; the web view (`web/board-view.ts`) sits on top.
 * No DOM, no timers, no `Date`.
 */
import type { Camera } from './camera';
import { Cameras } from './camera';
import { DrawList } from './draw';
import type { BoardError, BoardResult } from './errors';
import { ok } from './errors';
import { History } from './history';
import { LiveStroke } from './ink/live';
import { OutlineCache } from './ink/outline';
import { inkKind } from './kinds/ink';
import { KindRegistry } from './kinds/def';
import { PageIndex } from './page-index';
import { Pages } from './pages';
import { Selection } from './selection';
import { Store } from './store';
import type { Limits } from './types';

export interface BoardCoreOptions {
  readonly kinds?: KindRegistry;
  readonly limits?: Partial<Limits>;
  /** A store from `loadBoard`; its kinds should hold the built-in ones (`registerBuiltInKinds`). */
  readonly store?: Store;
  readonly onError?: (error: BoardError) => void;
}

/** Registers the kinds this build draws; a kind that is already there is left. */
export function registerBuiltInKinds(kinds: KindRegistry): void {
  if (!kinds.has(inkKind.kind)) kinds.register(inkKind);
}

export class BoardCore {
  readonly store: Store;
  readonly pages: Pages;
  readonly cameras: Cameras;
  readonly history: History;
  readonly index: PageIndex;
  readonly selection = new Selection();
  readonly outlines = new OutlineCache();
  readonly drawList: DrawList;
  /** The stroke being drawn; the pen tools write to it and the painter reads it. */
  readonly live = new LiveStroke();

  private constructor(store: Store) {
    this.store = store;
    this.pages = new Pages(store);
    this.cameras = new Cameras(store);
    this.history = new History(store);
    this.index = new PageIndex(store, this.pages);
    this.drawList = new DrawList(this.index, this.outlines);
  }

  /** A board with the built-in kinds and, when it has none, one page. */
  static create(options: BoardCoreOptions = {}): BoardResult<BoardCore> {
    const kinds = options.store?.kinds ?? options.kinds ?? new KindRegistry();
    registerBuiltInKinds(kinds);
    const store =
      options.store ??
      new Store({
        kinds,
        ...(options.limits !== undefined ? { limits: options.limits } : {}),
        ...(options.onError !== undefined ? { onError: options.onError } : {}),
      });
    const pagesProbe = new Pages(store);
    if (pagesProbe.list().length === 0) {
      // the first page is not an undo step: the history is made after it
      const first = pagesProbe.addPage();
      if (!first.ok) {
        pagesProbe.dispose();
        return first;
      }
    }
    pagesProbe.dispose();
    return ok(new BoardCore(store));
  }

  /** The camera of the current page, or undefined when there is no page. */
  get camera(): Camera | undefined {
    const page = this.pages.current;
    if (page === null) return undefined;
    const c = this.cameras.forPage(page);
    return c.ok ? c.value : undefined;
  }

  dispose(): void {
    this.index.dispose();
    this.history.dispose();
    this.cameras.dispose();
    this.pages.dispose();
  }
}

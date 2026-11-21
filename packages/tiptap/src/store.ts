/**
 * The per-editor registry of figures: id to the live app, or a headless app made from the script on demand. Formulas
 * and the export read figures through it, so a figure that is not on screen still answers.
 */
import { createHeadlessApp } from '@incantly/sdk';
import type { App, AppModeId } from '@incantly/sdk';

type Listener = () => void;

interface Entry {
  script: string;
  mode: AppModeId;
  live?: App;
  headless?: App;
  offLive?: () => void;
}

export class FigureStore {
  private readonly entries = new Map<string, Entry>();
  private readonly watchers = new Map<string, Set<Listener>>();

  /** The node view tells the store what the document holds. A new script or mode drops the headless copy. */
  set(id: string, script: string, mode: AppModeId): void {
    const e = this.entries.get(id);
    if (!e) {
      this.entries.set(id, { script, mode });
      this.notify(id);
      return;
    }
    if (e.script === script && e.mode === mode) return;
    e.script = script;
    e.mode = mode;
    this.dropHeadless(e);
    this.notify(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Marks the figure's live app (or none, when it was saved or destroyed) and follows its changes. */
  setLive(id: string, app: App | undefined): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.offLive?.();
    delete e.offLive;
    if (app) {
      e.live = app;
      const offs = (['changed', 'added', 'removed', 'redefined', 'renamed', 'loaded', 'cleared'] as const).map((t) => app.on(t, () => this.notify(id)));
      e.offLive = () => offs.forEach((off) => off());
    } else delete e.live;
    this.notify(id);
  }

  live(id: string): App | undefined {
    return this.entries.get(id)?.live;
  }

  /** The live app, or a headless app of the script (made once, dropped when the script changes). `undefined` for an unknown id. */
  appFor(id: string): App | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    if (e.live && !e.live.destroyed) return e.live;
    if (e.headless && !e.headless.destroyed) return e.headless;
    try {
      e.headless = createHeadlessApp({ mode: e.mode, script: e.script, readOnly: true });
    } catch {
      return undefined;
    }
    return e.headless;
  }

  scriptOf(id: string): string | undefined {
    return this.entries.get(id)?.script;
  }

  /** Calls `fn` when the figure's script, mode or live values change. Returns the function that stops it. */
  watch(id: string, fn: Listener): () => void {
    let set = this.watchers.get(id);
    if (!set) {
      set = new Set();
      this.watchers.set(id, set);
    }
    set.add(fn);
    return () => {
      this.watchers.get(id)?.delete(fn);
    };
  }

  drop(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.offLive?.();
    this.dropHeadless(e);
    this.entries.delete(id);
    this.notify(id);
  }

  dispose(): void {
    for (const e of this.entries.values()) {
      e.offLive?.();
      this.dropHeadless(e);
    }
    this.entries.clear();
    this.watchers.clear();
  }

  private dropHeadless(e: Entry): void {
    if (!e.headless) return;
    try {
      e.headless.destroy();
    } catch {
      // already gone
    }
    delete e.headless;
  }

  private notify(id: string): void {
    const set = this.watchers.get(id);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn();
      } catch {
        // a watcher that throws must not stop the others
      }
    }
  }
}

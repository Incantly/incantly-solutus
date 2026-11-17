/**
 * The physics worker (docs/features/physics/design.md 9.6 "Where it runs"; .kiro/specs/physics design, core hook 7).
 *
 * A figure with liquid or waves, in the plane or in space, runs its whole physics world, bodies included, in one worker,
 * so every hit has one order. The
 * worker holds a headless copy of the figure. The page sends the script when the figure's lines change, and each frame
 * the film time, the free values that changed and the `@input` lines made on the page (pushes, grabs). The worker
 * plays its copy to that time and sends back the cells of every object the world owns, with their typed arrays moved,
 * not copied. The page writes those cells over its own (the page's driver steps nothing meanwhile).
 *
 * This file is the message protocol and the worker's side of it, with no DOM and no timers: `physics.worker.ts` wires
 * it to a real worker, and Node tests run the same handler through a channel that clones the messages.
 */
import { Figure, worldDriverOf } from '@incantly/kernel';
import type { Cell, Notice } from '@incantly/kernel';
import { sdkRegistry } from '../registry';

/** The page to the worker. */
export type ToWorker =
  | { readonly k: 'load'; readonly seq: number; readonly script: string }
  | { readonly k: 'frame'; readonly seq: number; readonly t: number; readonly sets: readonly (readonly [string, unknown])[]; readonly lines: readonly string[] };

/** The worker to the page. */
export type FromWorker =
  | {
    readonly k: 'cells'; readonly seq: number; readonly t: number; readonly cells: readonly (readonly [string, Cell])[];
    readonly info: { readonly drops: number; readonly awake: number; readonly contacts: number; readonly hash: string }; readonly warnings: readonly Notice[];
    /** The worker's whole `@input` log, when it changed: what the page saves (a pedal moved in the worker included). */
    readonly log?: readonly string[];
  }
  | { readonly k: 'error'; readonly seq: number; readonly why: string };

/** The worker's state: its copy of the figure. */
export class PhysicsWorkerState {
  private figure: Figure | undefined;
  private lastLog = '';

  /** Handles one message; the reply and the buffers to move with it. */
  handle(m: ToWorker): { reply: FromWorker; transfer: ArrayBuffer[] } {
    try {
      if (m.k === 'load') {
        this.figure = Figure.fromScript(m.script, { commands: sdkRegistry() }).figure;
        this.lastLog = '';
        return this.cellsAt(m.seq, 0, []);
      }
      const f = this.figure;
      if (!f) return { reply: { k: 'error', seq: m.seq, why: 'no figure loaded' }, transfer: [] };
      for (const [name, value] of m.sets) f.setFree(name, value, 'api');
      // the page checked these lines when they were made; the log of the copy takes them as a reload would
      for (const line of m.lines) f.apply(line);
      return this.cellsAt(m.seq, m.t, []);
    } catch (e) {
      return { reply: { k: 'error', seq: m.seq, why: e instanceof Error ? e.message : 'the step failed' }, transfer: [] };
    }
  }

  private cellsAt(seq: number, t: number, warnings: Notice[]): { reply: FromWorker; transfer: ArrayBuffer[] } {
    const f = this.figure as Figure;
    f.setClock(t);
    const d = worldDriverOf(f);
    const { cells, transfer } = d.ownedCells();
    const w = d.world;
    const info = { drops: d.fluid?.ps.n ?? 0, awake: w ? w.awakeCount() : 0, contacts: w ? w.contactCount : 0, hash: d.worldHash() };
    const lines = d.inputLines();
    const key = lines.join('\n');
    const log = key !== this.lastLog ? lines : undefined;
    this.lastLog = key;
    return { reply: { k: 'cells', seq, t, cells, info, warnings: [...warnings, ...f.takeWarnings()], ...(log ? { log } : {}) }, transfer };
  }
}

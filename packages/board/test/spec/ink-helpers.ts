/**
 * Shared set-up for the round-2 spec tests (ink, tools, painter). Only the public API of `packages/board` is used:
 * a headless board (`BoardCore`), the tool host with the default tools, input samples, and a Canvas 2D stand-in for
 * happy-dom (which has no canvas context).
 */
import { describe, expect, it, vi } from 'vitest';
import type { MachineTable } from '@incantly/kernel';
import { BoardCore, ToolHost, createOverlayState, defaultStyles, defaultTools } from '../../src/index';
import type { BoardCoreOptions, InputSample, OverlayState, ShapeRecord, ToolContext, ToolList, ToolStyles } from '../../src/index';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** An `InputSample`: a pen with a real sensor, tip down, in the middle of a move, unless `over` says otherwise. */
export function sample(over: Partial<Mutable<InputSample>> = {}): InputSample {
  return {
    pointer: 1, device: 'pen', phase: 'move', x: 0, y: 0, pressure: 0.6, tiltX: 0, tiltY: 0, twist: 0, buttons: 1, time: 0, predicted: false, ...over,
  };
}

/** A board, its tool host with the default tools, and what the host calls back. */
export interface Rig {
  readonly core: BoardCore;
  readonly host: ToolHost;
  readonly styles: ToolStyles;
  readonly overlay: OverlayState;
  /** How many frames the tools asked for, strokes stored (`strokeEnded`) and strokes dropped. */
  readonly calls: { frames: number; ended: number; dropped: number };
}

export interface RigOptions {
  readonly core?: BoardCoreOptions;
  readonly tools?: ToolList;
  readonly tool?: string;
}

export function makeRig(options: RigOptions = {}): Rig & { readonly ctx: ToolContext } {
  const made = BoardCore.create(options.core ?? {});
  if (!made.ok) throw new Error(`could not make a board: ${made.kind}: ${made.message}`);
  const core = made.value;
  const styles = defaultStyles();
  const overlay = createOverlayState();
  const calls = { frames: 0, ended: 0, dropped: 0 };
  const ctx: ToolContext = {
    core,
    styles,
    overlay,
    camera: () => core.camera,
    requestFrame: () => {
      calls.frames++;
    },
    strokeEnded: () => {
      calls.ended++;
    },
    strokeDropped: () => {
      calls.dropped++;
    },
  };
  const host = new ToolHost(ctx, options.tools ?? defaultTools, options.tool ?? 'pen');
  return { core, host, styles, overlay, calls, ctx };
}

/** A pointer going down at the first point, moving through the others (8 ms apart) and up at the last. */
export function drawPath(
  rig: Pick<Rig, 'host'>,
  path: readonly (readonly [number, number])[],
  over: Partial<Mutable<InputSample>> = {},
  t0 = 0,
): void {
  path.forEach(([x, y], i) => {
    const last = i === path.length - 1;
    const phase = i === 0 ? 'down' : last ? 'up' : 'move';
    rig.host.sample(sample({ ...over, x, y, phase, time: t0 + i * 8 }));
  });
}

/** A straight line of `n + 1` points from `(x0, y0)` to `(x1, y1)`. */
export function line(x0: number, y0: number, x1: number, y1: number, n = 10): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i <= n; i++) out.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  return out;
}

/** The ink strokes of the current page, in the store's order. */
export function strokes(rig: Rig): readonly ShapeRecord[] {
  const page = rig.core.pages.current;
  return page === null ? [] : rig.core.store.shapesOn(page).filter((s) => s.kind === 'ink');
}

/** The first number of each point of an ink record's props. */
export const pointCount = (s: ShapeRecord): number => (s.props as { points: Float32Array; stride: number }).points.length / (s.props as { stride: number }).stride;

export const pointsOf = (s: ShapeRecord): Float32Array => (s.props as { points: Float32Array }).points;

/** The record's points as a plain array, to compare before and after. */
export const copyOf = (s: ShapeRecord): readonly number[] => [...pointsOf(s)];

// ---------------------------------------------------------------------------------------------------------------
// Canvas 2D stand-in

export interface FakeCanvas {
  /** How many times each method of any 2D context was called. */
  readonly calls: Map<string, number>;
  /** Contexts handed out (one per canvas that asked). */
  contexts(): number;
  /** Every `getContext` request: the type and the attributes. */
  readonly requests: (readonly [string, unknown])[];
  restore(): void;
}

/**
 * happy-dom gives no 2D context, so the painter would have nothing to draw with. This gives every canvas a context
 * that accepts any call and counts it; WebGL 2 stays unavailable (`getContext('webgl2')` is null), which is the
 * `render_failed` case of errors.md.
 */
export function installCanvas2d(): FakeCanvas {
  const calls = new Map<string, number>();
  let made = 0;
  const requests: (readonly [string, unknown])[] = [];
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string, attributes?: unknown) => {
    requests.push([type, attributes]);
    if (type !== '2d') return null;
    made++;
    return new Proxy(
      {},
      {
        get: (_t, name) => {
          if (typeof name !== 'string') return undefined;
          return (..._args: unknown[]): unknown => {
            calls.set(name, (calls.get(name) ?? 0) + 1);
            return undefined;
          };
        },
        set: () => true,
      },
    );
  }) as unknown as HTMLCanvasElement['getContext']);
  return { calls, contexts: () => made, requests, restore: () => spy.mockRestore() };
}

// ---------------------------------------------------------------------------------------------------------------
// state tables

export type Row<S extends string, E extends string> = readonly [from: S, event: E, to: S];

/** The state the table leads to from `from` on `event`, or undefined when the table has no such move. */
export const moveOf = <S extends string, E extends string>(table: MachineTable<S, E>, from: S, event: E): S | undefined =>
  (table[from] as { readonly [V in E]?: S })[event];

/** Walks a table against the rows of the document: each row is exact, and every other (state, event) pair has no move. */
export function walk<S extends string, E extends string>(
  name: string,
  table: MachineTable<S, E>,
  states: readonly S[],
  events: readonly E[],
  rows: readonly Row<S, E>[],
): void {
  describe(name, () => {
    it('has exactly the states of the document', () => {
      expect(Object.keys(table).sort()).toEqual([...states].sort());
    });
    for (const [from, event, to] of rows) {
      it(`${from} --${event}--> ${to}`, () => {
        expect(moveOf(table, from, event)).toBe(to);
      });
    }
    it('has no move for any pair the document does not list', () => {
      const listed = new Set(rows.map(([f, e]) => `${f}|${e}`));
      for (const s of states) {
        for (const e of events) {
          if (!listed.has(`${s}|${e}`)) expect(moveOf(table, s, e), `${s} on ${e}`).toBeUndefined();
        }
      }
    });
    it('leads only to states of the document', () => {
      for (const [, , to] of rows) expect(states).toContain(to);
    });
    it('refuses at least one move (a table that refuses nothing is not a machine)', () => {
      const refused = states.some((s) => events.some((e) => moveOf(table, s, e) === undefined));
      expect(refused).toBe(true);
    });
  });
}

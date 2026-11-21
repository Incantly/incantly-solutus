/**
 * Snap guides (design 7.4, docs/state-machines.md B22). While a box moves or is resized, its edges and centre are
 * pulled to the edges and centres of the other shapes, to equal gaps, and to the page grid. The snapper keeps the
 * guides to draw; it has no clock and writes nothing to the store. No DOM, no timers.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from './machine';
import { refusedMove } from './errors';
import type { ErrorSink } from './errors';
import type { MachineTable } from '@incantly/kernel';
import type { GuideLine } from './draw';
import { boxCx, boxCy } from './math2d';
import type { Bounds } from './types';

type SnapState = 'idle' | 'tracking' | 'snapped';
type SnapEvent = 'begin' | 'found' | 'miss' | 'end';

export const SNAP_MACHINE: MachineTable<SnapState, SnapEvent> = {
  idle: { begin: 'tracking' },
  tracking: { found: 'snapped', miss: 'tracking', end: 'idle' },
  snapped: { found: 'snapped', miss: 'tracking', end: 'idle' },
};

/** The distance in screen pixels within which a line pulls. */
export const SNAP_PX = 6;
/** The page grid, in page units, when a page shows one. */
export const GRID_UNITS = 24;

/** Which sides of a box a resize moves. */
export interface MovingSides {
  readonly left: boolean;
  readonly right: boolean;
  readonly top: boolean;
  readonly bottom: boolean;
}

interface Pull {
  /** The change to the moving box's line that lands it on the other line. */
  readonly delta: number;
  readonly kind: GuideLine['kind'];
  /** The line's position. */
  readonly at: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

export class Snapper {
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(SNAP_MACHINE, 'idle', refusedMove('snapper', () => this.#report));
  #others: readonly Bounds[] = [];
  #guides: readonly GuideLine[] = [];

  constructor(report?: ErrorSink) {
    this.#report = report;
  }

  get state(): SnapState {
    return this.#machine.state;
  }

  /** The guides to draw now; empty unless `snapped`. */
  get guides(): readonly GuideLine[] {
    return this.#guides;
  }

  /** Starts a gesture against these boxes (the other shapes near the one that moves). */
  begin(others: readonly Bounds[]): boolean {
    if (!this.#machine.send('begin')) return false;
    this.#others = others;
    this.#guides = [];
    return true;
  }

  end(): void {
    if (sendIfAble(this.#machine, 'end')) {
      this.#others = [];
      this.#guides = [];
    }
  }

  /**
   * The box moved by `dx, dy`'s worth of snapping: the adjustment to add to the box so a line of it lands on a line of
   * another shape, an equal gap, or the grid. `threshold` is in page units.
   */
  snapMove(box: Bounds, threshold: number, grid: number | null): { readonly dx: number; readonly dy: number } {
    if (this.#machine.is('idle')) return { dx: 0, dy: 0 };
    const px = this.#bestPull('x', [box.minX, boxCx(box), box.maxX], box, threshold, grid);
    const py = this.#bestPull('y', [box.minY, boxCy(box), box.maxY], box, threshold, grid);
    const dx = px?.delta ?? 0;
    const dy = py?.delta ?? 0;
    this.#finish({ minX: box.minX + dx, minY: box.minY + dy, maxX: box.maxX + dx, maxY: box.maxY + dy }, px, py, true, true, true, true);
    return { dx, dy };
  }

  /** The box with the sides that move pulled to the lines near them. */
  snapResize(box: Bounds, sides: MovingSides, threshold: number, grid: number | null): Bounds {
    if (this.#machine.is('idle')) return box;
    let { minX, minY, maxX, maxY } = box;
    const pull = (axis: 'x' | 'y', value: number): Pull | undefined => this.#bestPull(axis, [value], box, threshold, grid, true);
    let lx: Pull | undefined;
    let rx: Pull | undefined;
    let ty: Pull | undefined;
    let by: Pull | undefined;
    if (sides.left) {
      lx = pull('x', minX);
      minX += lx?.delta ?? 0;
    }
    if (sides.right) {
      rx = pull('x', maxX);
      maxX += rx?.delta ?? 0;
    }
    if (sides.top) {
      ty = pull('y', minY);
      minY += ty?.delta ?? 0;
    }
    if (sides.bottom) {
      by = pull('y', maxY);
      maxY += by?.delta ?? 0;
    }
    const out = { minX, minY, maxX, maxY };
    this.#finish(out, lx ?? rx, ty ?? by, sides.left, sides.right, sides.top, sides.bottom);
    return out;
  }

  /** The nearest pull of one axis within the threshold: lines of other shapes, equal gaps (moves only), the grid. */
  #bestPull(axis: 'x' | 'y', mine: readonly number[], box: Bounds, threshold: number, grid: number | null, resize = false): Pull | undefined {
    let best: Pull | undefined;
    const consider = (p: Pull): void => {
      if (Math.abs(p.delta) <= threshold && (best === undefined || Math.abs(p.delta) < Math.abs(best.delta))) best = p;
    };
    for (const o of this.#others) {
      const lines = axis === 'x' ? [o.minX, boxCx(o), o.maxX] : [o.minY, boxCy(o), o.maxY];
      const kinds: GuideLine['kind'][] = ['edge', 'centre', 'edge'];
      for (let i = 0; i < lines.length; i++) {
        for (const m of mine) consider({ delta: (lines[i] as number) - m, kind: kinds[i] as GuideLine['kind'], at: lines[i] as number });
      }
    }
    if (grid !== null && grid > 0) {
      for (const m of mine) {
        const at = Math.round(m / grid) * grid;
        consider({ delta: at - m, kind: 'grid', at });
      }
    }
    if (!resize) {
      const gap = this.#gapPull(axis, box);
      if (gap !== undefined) consider(gap);
    }
    return best;
  }

  /** Equal gaps along one axis: the box between two shapes, or beyond two shapes that are a gap apart. */
  #gapPull(axis: 'x' | 'y', box: Bounds): Pull | undefined {
    const lo = axis === 'x' ? box.minX : box.minY;
    const hi = axis === 'x' ? box.maxX : box.maxY;
    // only shapes that overlap the box across the other axis form a row with it
    const row = this.#others
      .filter((o) => (axis === 'x' ? o.maxY >= box.minY && o.minY <= box.maxY : o.maxX >= box.minX && o.minX <= box.maxX))
      .map((o) => (axis === 'x' ? { lo: o.minX, hi: o.maxX } : { lo: o.minY, hi: o.maxY }))
      .sort((a, b) => a.lo - b.lo);
    const before = row.filter((r) => r.hi <= lo);
    const after = row.filter((r) => r.lo >= hi);
    const a = before[before.length - 1];
    const b = after[0];
    let best: Pull | undefined;
    const keep = (p: Pull): void => {
      if (best === undefined || Math.abs(p.delta) < Math.abs(best.delta)) best = p;
    };
    if (a !== undefined && b !== undefined) {
      // the gaps on both sides of the box equal each other
      const left = lo - a.hi;
      const right = b.lo - hi;
      keep({ delta: (right - left) / 2, kind: 'gap', at: lo + (right - left) / 2 });
    }
    // the box one gap beyond the last two shapes of a row
    if (before.length >= 2 && a !== undefined) {
      const p = before[before.length - 2] as { lo: number; hi: number };
      const gap = a.lo - p.hi;
      keep({ delta: a.hi + gap - lo, kind: 'gap', at: a.hi + gap });
    }
    if (after.length >= 2 && b !== undefined) {
      const q = after[1] as { lo: number; hi: number };
      const gap = q.lo - b.hi;
      keep({ delta: b.lo - gap - hi, kind: 'gap', at: b.lo - gap });
    }
    return best;
  }

  /** Sets the guides for the box as it landed, and the machine's state. */
  #finish(box: Bounds, px: Pull | undefined, py: Pull | undefined, left: boolean, right: boolean, top: boolean, bottom: boolean): void {
    const guides: GuideLine[] = [];
    const reach = (axis: 'x' | 'y', at: number, kind: GuideLine['kind']): void => {
      // a guide runs across the moving box and every other box that has a line at the same place
      let from = axis === 'x' ? box.minY : box.minX;
      let to = axis === 'x' ? box.maxY : box.maxX;
      for (const o of this.#others) {
        const lines = axis === 'x' ? [o.minX, boxCx(o), o.maxX] : [o.minY, boxCy(o), o.maxY];
        if (!lines.some((l) => near(l, at))) continue;
        from = Math.min(from, axis === 'x' ? o.minY : o.minX);
        to = Math.max(to, axis === 'x' ? o.maxY : o.maxX);
      }
      guides.push(axis === 'x' ? { kind, x0: at, y0: from, x1: at, y1: to } : { kind, x0: from, y0: at, x1: to, y1: at });
    };
    const lines = (axis: 'x' | 'y'): { readonly value: number; readonly on: boolean }[] =>
      axis === 'x'
        ? [{ value: box.minX, on: left }, { value: boxCx(box), on: left && right }, { value: box.maxX, on: right }]
        : [{ value: box.minY, on: top }, { value: boxCy(box), on: top && bottom }, { value: box.maxY, on: bottom }];
    for (const [axis, pull] of [['x', px], ['y', py]] as const) {
      if (pull === undefined) continue;
      if (pull.kind === 'gap') {
        reach(axis, pull.at, 'gap');
        continue;
      }
      // every line of the box that now sits on a line of another shape (or the grid) gets a guide
      for (const l of lines(axis)) if (l.on && near(l.value, pull.at)) reach(axis, pull.at, pull.kind);
    }
    this.#guides = guides;
    this.#machine.send(guides.length > 0 ? 'found' : 'miss');
  }
}

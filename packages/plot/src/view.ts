/**
 * Validated views and maths/pixel transforms. Level of detail follows the zoom
 * (`docs/design/performance.md` 5.3): every tracer derives its sampling density
 * from the pixel size of the view, so zooming in refines the maths resolution
 * while the pixel work stays flat. Paths are emitted in CSS pixels.
 */
import type { Result } from '@incantly/kernel';
import type { ViewBox } from './contracts';
import { checkView, guard } from './errors';

/** A checked view with its scales and mapping helpers. */
export interface PlotView {
  readonly box: ViewBox;
  /** Device pixels per maths unit. */
  readonly sx: number;
  readonly sy: number;
  /** Maths units per device pixel. */
  readonly dx: number;
  readonly dy: number;
  /** Effective pixel size (CSS pixels times devicePixelRatio), used for sampling density. */
  readonly widthEff: number;
  readonly heightEff: number;
  readonly dpr: number;
  toPx(x: number): number;
  toPy(y: number): number;
  toX(px: number): number;
  toY(py: number): number;
}

/** Checks a view box and derives its scales. */
export function createView(view: ViewBox): Result<PlotView> {
  return guard('createView', () => {
    const bad = checkView('createView', view);
    if (bad) return bad;
    const dpr = view.devicePixelRatio ?? 1;
    const sx = (view.widthPx * dpr) / (view.x1 - view.x0);
    const sy = (view.heightPx * dpr) / (view.y1 - view.y0);
    return {
      ok: true,
      value: {
        box: view,
        sx,
        sy,
        dx: 1 / sx,
        dy: 1 / sy,
        widthEff: view.widthPx * dpr,
        heightEff: view.heightPx * dpr,
        dpr,
        toPx: (x: number): number => (x - view.x0) * (view.widthPx / (view.x1 - view.x0)),
        toPy: (y: number): number => (view.y1 - y) * (view.heightPx / (view.y1 - view.y0)),
        toX: (px: number): number => view.x0 + (px * (view.x1 - view.x0)) / view.widthPx,
        toY: (py: number): number => view.y1 - (py * (view.y1 - view.y0)) / view.heightPx,
      },
      notices: [],
    };
  });
}

/** Distance from point p to the chord ab, in pixels. */
export function pointToChordPx(pmx: number, pmy: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(pmx - ax, pmy - ay);
  const t = ((pmx - ax) * dx + (pmy - ay) * dy) / len2;
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(pmx - (ax + c * dx), pmy - (ay + c * dy));
}

/** Turning angle at b between chords ab and bc, in degrees (0 = straight). */
export function turnDegrees(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const ux = bx - ax;
  const uy = by - ay;
  const vx = cx - bx;
  const vy = cy - by;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (!(lu > 0) || !(lv > 0)) return 0;
  const cos = (ux * vx + uy * vy) / (lu * lv);
  const c = cos < -1 ? -1 : cos > 1 ? 1 : cos;
  return (Math.acos(c) * 180) / Math.PI;
}

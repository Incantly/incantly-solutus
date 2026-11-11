/**
 * Bounds of a kernel value in maths units (VIEW-SM-16). Fit-all and the
 * `objects` export region use these instead of clipped pixel boxes, so an
 * object that lies outside the current view still counts.
 */
import type { ViewValue } from '../contracts';
import { maths, type MathsRect } from './coords';

class Box {
  x0 = Infinity;
  x1 = -Infinity;
  y0 = Infinity;
  y1 = -Infinity;

  add(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }

  addRun(run: Float64Array): void {
    for (let i = 0; i + 1 < run.length; i += 2) this.add(run[i] ?? Number.NaN, run[i + 1] ?? Number.NaN);
  }

  toRect(): MathsRect | null {
    if (!(this.x1 >= this.x0) || !(this.y1 >= this.y0)) return null;
    return { x0: maths(this.x0), x1: maths(this.x1), y0: maths(this.y0), y1: maths(this.y1) };
  }
}

/**
 * Bounds of the finite part of a value, or null when it has none on the 2D
 * plane (numbers, widgets, 3D values, particles, screen-fixed text). Lines
 * and rays count their origin only, because they have no end.
 */
export function mathsBounds(value: ViewValue): MathsRect | null {
  const b = new Box();
  switch (value.k) {
    case 'point':
      b.add(value.x, value.y);
      break;
    case 'vector':
      b.add(value.ox, value.oy);
      b.add(value.ox + value.dx, value.oy + value.dy);
      break;
    case 'segment':
      b.add(value.ax, value.ay);
      b.add(value.bx, value.by);
      break;
    case 'ray':
    case 'line':
      b.add(value.ox, value.oy);
      break;
    case 'circle':
    case 'arc':
    case 'angle':
      // The whole circle: an arc's own extent is smaller, never larger.
      b.add(value.cx - value.r, value.cy - value.r);
      b.add(value.cx + value.r, value.cy + value.r);
      break;
    case 'polygon':
    case 'trace':
    case 'polyline':
      b.addRun(value.pts);
      break;
    case 'curve':
      for (const run of value.runs) b.addRun(run);
      break;
    case 'region':
      for (const ring of value.rings) b.addRun(ring);
      break;
    case 'text':
      if (!value.screen) b.add(value.atX, value.atY);
      break;
    default:
      break;
  }
  return b.toRect();
}

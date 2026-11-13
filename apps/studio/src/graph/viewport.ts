/** The graph's camera: maths coordinates to pixels and back, pan, zoom about a point, and fitting a box. No DOM. */

export interface Box {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

export class Viewport {
  /** Maths coordinates of the canvas centre. */
  cx = 0;
  cy = 0;
  /** Pixels per maths unit across. */
  ppu = 50;
  /** Pixels per maths unit up: equal to `ppu` unless a fit stretched the axes for a chart. */
  ppuY = 50;
  /** Canvas size in CSS pixels. */
  w = 800;
  h = 600;

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  px(x: number): number {
    return this.w / 2 + (x - this.cx) * this.ppu;
  }

  py(y: number): number {
    return this.h / 2 - (y - this.cy) * this.ppuY;
  }

  x(px: number): number {
    return this.cx + (px - this.w / 2) / this.ppu;
  }

  y(py: number): number {
    return this.cy - (py - this.h / 2) / this.ppuY;
  }

  box(): Box {
    return { x0: this.x(0), x1: this.x(this.w), y0: this.y(this.h), y1: this.y(0) };
  }

  pan(dxPx: number, dyPx: number): void {
    this.cx -= dxPx / this.ppu;
    this.cy += dyPx / this.ppuY;
  }

  /** Zooms by `factor` (> 1 zooms in) keeping the maths point under the pixel fixed. */
  zoomAt(px: number, py: number, factor: number): void {
    const mx = this.x(px);
    const my = this.y(py);
    const f = Math.min(1e7 / this.ppu, Math.max(1e-5 / this.ppu, factor));
    this.ppu *= f;
    this.ppuY *= f;
    this.cx = mx - (px - this.w / 2) / this.ppu;
    this.cy = my + (py - this.h / 2) / this.ppuY;
  }

  /**
   * Shows the box with a margin; a degenerate box is widened around its centre. `stretch` lets the two axes take
   * different scales (charts of data); otherwise one unit is the same length across and up (geometry).
   */
  fit(b: Box, marginPx = 40, stretch = false): void {
    let { x0, x1, y0, y1 } = b;
    if (!(x1 > x0)) {
      x0 -= 5;
      x1 += 5;
    }
    if (!(y1 > y0)) {
      y0 -= 5;
      y1 += 5;
    }
    const sx = (this.w - 2 * marginPx) / (x1 - x0);
    const sy = (this.h - 2 * marginPx) / (y1 - y0);
    this.ppu = Math.max(1e-5, stretch ? sx : Math.min(sx, sy));
    this.ppuY = Math.max(1e-5, stretch ? sy : Math.min(sx, sy));
    this.cx = (x0 + x1) / 2;
    this.cy = (y0 + y1) / 2;
  }

  home(): void {
    this.cx = 0;
    this.cy = 0;
    this.ppu = Math.min(this.w, this.h) / 20;
    this.ppuY = this.ppu;
  }
}

/** A grid step of 1, 2 or 5 times a power of ten giving major lines about `target` pixels apart. */
export function gridStep(ppu: number, target = 90): { major: number; minor: number } {
  const raw = target / ppu;
  const e = Math.floor(Math.log10(raw));
  const base = 10 ** e;
  for (const m of [1, 2, 5, 10]) {
    if (m * base >= raw) {
      const major = m * base;
      return { major, minor: m === 2 ? major / 4 : major / 5 };
    }
  }
  return { major: 10 * base, minor: 2 * base };
}

/** A tick label without floating-point noise. */
export function tickText(v: number, step: number): string {
  if (Math.abs(v) < step * 1e-9) return '0';
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + (step / 10 ** Math.floor(Math.log10(step)) === 5 ? 0 : 0));
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(1).replace('e+', 'e');
  return v.toFixed(Math.min(10, digits)).replace('-', '−');
}

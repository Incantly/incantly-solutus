/**
 * Canvas2D screen surface: the `Surface` implementation for the scene,
 * background and overlay canvases. The host owns the canvas elements and
 * hands this file their 2D contexts; nothing here touches the DOM directly.
 */
import type { PxPoint, PxRect } from '../core/coords';
import { renderHatchSpacing, type HatchSpec, type Rgba } from '../core/styles';
import {
  isCommandPath, type FillStyle, type ImageSource, type PathCommand, type PathData,
  type StrokeStyle, type Surface, type TextMetrics, type TextRun, type TextStyle,
  safeFontFamily, type Affine,
} from '../core/surface';

function css(c: Rgba, opacity: number): string {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.min(1, Math.max(0, c.a * opacity))})`;
}

const HATCH_CACHE_MAX = 64;

function quantiseColor(c: Rgba): Rgba {
  const q = (v: number): number => Math.min(255, Math.round(v / 8) * 8);
  return { r: q(c.r), g: q(c.g), b: q(c.b), a: Math.round(c.a * 20) / 20 };
}

/** `ctx.font` value; the family is checked again here as a second line of defence (VIEW-SM-1). */
function fontString(st: TextStyle): string {
  const size = Number.isFinite(st.size) ? Math.min(400, Math.max(1, st.size)) : 14;
  return `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${size}px ${safeFontFamily(st.family)}`;
}

export class CanvasSurface implements Surface {
  private readonly images = new Map<string, CanvasImageSource>();

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  setImage(key: string, img: CanvasImageSource): void {
    this.images.set(key, img);
  }

  save(): void {
    this.ctx.save();
  }
  restore(): void {
    this.ctx.restore();
  }
  transform(m: Affine): void {
    this.ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  }
  clipRect(r: PxRect): void {
    this.ctx.beginPath();
    this.ctx.rect(r.x0 as number, r.y0 as number, (r.x1 as number) - (r.x0 as number), (r.y1 as number) - (r.y0 as number));
    this.ctx.clip();
  }
  clipPath(p: PathData): void {
    this.trace(p);
    this.ctx.clip();
  }
  path(p: PathData): void {
    this.trace(p);
  }

  private trace(p: PathData): void {
    const c = this.ctx;
    c.beginPath();
    if (isCommandPath(p)) {
      for (const cmd of p as readonly PathCommand[]) this.traceCommand(cmd);
      return;
    }
    const run = p;
    if (run.length < 2) return;
    c.moveTo(run[0] ?? 0, run[1] ?? 0);
    for (let i = 2; i + 1 < run.length; i += 2) c.lineTo(run[i] ?? 0, run[i + 1] ?? 0);
  }

  /** Current point and subpath start while tracing, needed to turn SVG arcs into canvas ellipses. */
  private curX = 0;
  private curY = 0;
  private startX = 0;
  private startY = 0;

  private traceCommand(cmd: PathCommand): void {
    const c = this.ctx;
    switch (cmd.k) {
      case 'M':
        c.moveTo(cmd.x, cmd.y);
        this.curX = this.startX = cmd.x;
        this.curY = this.startY = cmd.y;
        break;
      case 'L':
        c.lineTo(cmd.x, cmd.y);
        this.curX = cmd.x;
        this.curY = cmd.y;
        break;
      case 'Q':
        c.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x, cmd.y);
        this.curX = cmd.x;
        this.curY = cmd.y;
        break;
      case 'C':
        c.bezierCurveTo(cmd.c1x, cmd.c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y);
        this.curX = cmd.x;
        this.curY = cmd.y;
        break;
      case 'A':
        this.traceArc(cmd);
        this.curX = cmd.x;
        this.curY = cmd.y;
        break;
      case 'Z':
        c.closePath();
        this.curX = this.startX;
        this.curY = this.startY;
        break;
    }
  }

  /**
   * An SVG arc (endpoint form) as a canvas ellipse (centre form), following
   * the conversion in the SVG implementation notes (F.6.5). Radii too small
   * for the chord are scaled up; a zero radius is a straight line.
   */
  private traceArc(cmd: Extract<PathCommand, { k: 'A' }>): void {
    const c = this.ctx;
    const x1 = this.curX;
    const y1 = this.curY;
    let rx = Math.abs(cmd.rx);
    let ry = Math.abs(cmd.ry);
    if (cmd.x === x1 && cmd.y === y1) return;
    if (!(rx > 0) || !(ry > 0) || !Number.isFinite(rx + ry)) {
      c.lineTo(cmd.x, cmd.y);
      return;
    }
    const phi = (cmd.rot * Math.PI) / 180;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const dx2 = (x1 - cmd.x) / 2;
    const dy2 = (y1 - cmd.y) / 2;
    const x1p = cosP * dx2 + sinP * dy2;
    const y1p = -sinP * dx2 + cosP * dy2;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      const s = Math.sqrt(lambda);
      rx *= s;
      ry *= s;
    }
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    const num = rx2 * ry2 - den;
    const coef = (cmd.large === cmd.sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (coef * rx * y1p) / ry;
    const cyp = (-coef * ry * x1p) / rx;
    const cx = cosP * cxp - sinP * cyp + (x1 + cmd.x) / 2;
    const cy = sinP * cxp + cosP * cyp + (y1 + cmd.y) / 2;
    const a0 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
    const a1 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
    c.ellipse(cx, cy, rx, ry, phi, a0, a1, !cmd.sweep);
  }

  stroke(st: StrokeStyle): void {
    const c = this.ctx;
    c.strokeStyle = css(st.color, st.opacity);
    c.lineWidth = st.width;
    c.lineCap = st.cap;
    c.lineJoin = st.join;
    c.miterLimit = st.miterLimit;
    c.setLineDash([...st.dash]);
    c.lineDashOffset = -st.dashPhase;
    c.stroke();
    c.setLineDash([]);
  }

  fill(f: FillStyle): void {
    const c = this.ctx;
    if (f.kind === 'solid') {
      c.fillStyle = css(f.color, f.opacity);
      c.fill();
      return;
    }
    const pattern = this.hatchPattern(f.spec, f.color);
    if (pattern !== null) {
      c.save();
      c.globalAlpha = Math.min(1, Math.max(0, f.opacity));
      c.fillStyle = pattern;
      c.fill();
      c.restore();
    } else {
      c.fillStyle = css(f.color, f.opacity * 0.5);
      c.fill();
    }
  }

  /** Least-recently-used hatch tiles, at most `HATCH_CACHE_MAX` (VIEW-SM-4). */
  private readonly hatchPatternCache = new Map<string, CanvasPattern | null>();

  private hatchPattern(spec: HatchSpec, rawColor: Rgba): CanvasPattern | null {
    // Quantised colour: an animated colour reuses tiles instead of making one per frame.
    const color = quantiseColor(rawColor);
    const key = JSON.stringify({ spec, color });
    const hit = this.hatchPatternCache.get(key);
    if (hit !== undefined) {
      this.hatchPatternCache.delete(key);
      this.hatchPatternCache.set(key, hit);
      return hit;
    }
    let out: CanvasPattern | null = null;
    try {
      if (spec.kind !== 'image' && typeof document !== 'undefined') {
        const spacing = Math.round(renderHatchSpacing(spec.spacing));
        const tile = document.createElement('canvas');
        tile.width = spacing;
        tile.height = spacing;
        const g = tile.getContext('2d');
        if (g !== null) {
          g.strokeStyle = css(color, 1);
          g.fillStyle = css(color, 1);
          g.lineWidth = 1;
          if (spec.kind === 'dots') {
            g.beginPath();
            g.arc(spacing / 2, spacing / 2, spec.radius ?? 1, 0, 2 * Math.PI);
            g.fill();
          } else if (spec.kind === 'cross' || spec.kind === 'grid') {
            g.beginPath();
            g.moveTo(0, 0);
            g.lineTo(spacing, 0);
            g.moveTo(0, 0);
            g.lineTo(0, spacing);
            g.stroke();
          } else {
            // Here `spec` is `lines | honeycomb | weave | bricks` (`dots`,
            // `cross` and `grid` returned above), so only `lines` carries an angle.
            const angle = (spec.kind === 'lines' ? spec.angle : 45) * (Math.PI / 180);
            g.beginPath();
            g.moveTo(spacing / 2 - Math.cos(angle) * spacing, spacing / 2 - Math.sin(angle) * spacing);
            g.lineTo(spacing / 2 + Math.cos(angle) * spacing, spacing / 2 + Math.sin(angle) * spacing);
            g.stroke();
          }
          out = this.ctx.createPattern(tile, 'repeat');
        }
      }
    } catch {
      out = null;
    }
    this.hatchPatternCache.set(key, out);
    while (this.hatchPatternCache.size > HATCH_CACHE_MAX) {
      const oldest = this.hatchPatternCache.keys().next();
      if (oldest.done === true) break;
      this.hatchPatternCache.delete(oldest.value);
    }
    return out;
  }

  text(t: TextRun, at: PxPoint, st: TextStyle): void {
    const c = this.ctx;
    c.save();
    c.font = fontString(st);
    c.textAlign = st.align;
    c.textBaseline = 'alphabetic';
    if (st.background !== 'none') {
      const w = c.measureText(t.text).width;
      // The box follows the alignment: the text starts at `x` (left), ends at
      // `x` (right) or is centred on it (VIEW-SM-27).
      const left = st.align === 'left' ? (at.x as number) - 2
        : st.align === 'right' ? (at.x as number) - w - 2
          : (at.x as number) - w / 2 - 2;
      c.fillStyle = css(st.background, 1);
      c.fillRect(left, (at.y as number) - st.size - 2, w + 4, st.size + 6);
    }
    c.fillStyle = css(st.color, st.opacity);
    c.fillText(t.text, at.x as number, at.y as number);
    c.restore();
  }

  image(img: ImageSource, dest: PxRect, opacity: number): void {
    const src = this.images.get(img.key);
    if (src === undefined) return;
    const c = this.ctx;
    c.save();
    c.globalAlpha = Math.min(1, Math.max(0, opacity));
    c.drawImage(
      src,
      dest.x0 as number, dest.y0 as number,
      (dest.x1 as number) - (dest.x0 as number), (dest.y1 as number) - (dest.y0 as number),
    );
    c.restore();
  }

  measure(t: TextRun, st: TextStyle): TextMetrics {
    try {
      const c = this.ctx;
      c.save();
      c.font = fontString(st);
      const m = c.measureText(t.text);
      c.restore();
      const ascent = m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : st.size * 0.9;
      const descent = m.actualBoundingBoxDescent > 0 ? m.actualBoundingBoxDescent : st.size * 0.3;
      return { width: m.width, height: ascent + descent, ascent };
    } catch {
      const width = [...t.text].length * st.size * 0.6;
      return { width, height: st.size * 1.2, ascent: st.size * 0.9 };
    }
  }
}

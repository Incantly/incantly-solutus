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
  type Affine,
} from '../core/surface';

function css(c: Rgba, opacity: number): string {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.min(1, Math.max(0, c.a * opacity))})`;
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

  private traceCommand(cmd: PathCommand): void {
    const c = this.ctx;
    switch (cmd.k) {
      case 'M': c.moveTo(cmd.x, cmd.y); break;
      case 'L': c.lineTo(cmd.x, cmd.y); break;
      case 'Q': c.quadraticCurveTo(cmd.cx, cmd.cy, cmd.x, cmd.y); break;
      case 'C': c.bezierCurveTo(cmd.c1x, cmd.c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y); break;
      case 'A':
        // Canvas has no arc-to with radii rotation; approximate with ellipses
        // when the arc is axis-aligned, else a line to the endpoint.
        if (cmd.rot === 0 && cmd.rx === cmd.ry) {
          c.ellipse(cmd.x, cmd.y, 0, 0, 0, 0, 0);
        }
        c.lineTo(cmd.x, cmd.y);
        break;
      case 'Z': c.closePath(); break;
    }
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

  private hatchPatternCache = new Map<string, CanvasPattern | null>();

  private hatchPattern(spec: HatchSpec, color: Rgba): CanvasPattern | null {
    const key = JSON.stringify({ spec, color });
    const hit = this.hatchPatternCache.get(key);
    if (hit !== undefined) return hit;
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
    return out;
  }

  text(t: TextRun, at: PxPoint, st: TextStyle): void {
    const c = this.ctx;
    c.save();
    c.font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${st.size}px ${st.family}`;
    c.textAlign = st.align;
    c.textBaseline = 'alphabetic';
    if (st.background !== 'none') {
      const w = c.measureText(t.text).width;
      c.fillStyle = css(st.background, 1);
      c.fillRect((at.x as number) - w / 2 - 2, (at.y as number) - st.size - 2, w + 4, st.size + 6);
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
      c.font = `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${st.size}px ${st.family}`;
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

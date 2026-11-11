/**
 * SVG export surface (graphics-view design 14.2): curve paths as `<path d>`
 * with 2 decimals, hatch patterns as `<pattern>`, clips as `<clipPath>`,
 * labels as `<text>` (or outlines when the host supplies glyph paths), ids
 * from object names. Deterministic: same calls give the same bytes.
 */
import type { PxPoint, PxRect } from '../core/coords';
import { svgEscape, svgId, svgRound } from '../core/export';
import type { HatchSpec, Rgba } from '../core/styles';
import { renderHatchSpacing } from '../core/styles';
import {
  isCommandPath, type FillStyle, type ImageSource, type PathCommand, type PathData,
  type StrokeStyle, type Surface, type TextMetrics, type TextRun, type TextStyle,
} from '../core/surface';

function css(c: Rgba): string {
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

function commandsToD(cmds: readonly PathCommand[]): string {
  const parts: string[] = [];
  for (const c of cmds) {
    switch (c.k) {
      case 'M': parts.push(`M${svgRound(c.x)},${svgRound(c.y)}`); break;
      case 'L': parts.push(`L${svgRound(c.x)},${svgRound(c.y)}`); break;
      case 'Q': parts.push(`Q${svgRound(c.cx)},${svgRound(c.cy)},${svgRound(c.x)},${svgRound(c.y)}`); break;
      case 'C':
        parts.push(`C${svgRound(c.c1x)},${svgRound(c.c1y)},${svgRound(c.c2x)},${svgRound(c.c2y)},${svgRound(c.x)},${svgRound(c.y)}`);
        break;
      case 'A':
        parts.push(`A${svgRound(c.rx)},${svgRound(c.ry)},${svgRound(c.rot)},${c.large ? 1 : 0},${c.sweep ? 1 : 0},${svgRound(c.x)},${svgRound(c.y)}`);
        break;
      case 'Z': parts.push('Z'); break;
    }
  }
  return parts.join('');
}

function polylineToD(run: Float32Array): string {
  if (run.length < 4) return '';
  const parts: string[] = [`M${svgRound(run[0] ?? 0)},${svgRound(run[1] ?? 0)}`];
  for (let i = 2; i + 1 < run.length; i += 2) parts.push(`L${svgRound(run[i] ?? 0)},${svgRound(run[i + 1] ?? 0)}`);
  return parts.join('');
}

export interface SvgOptions {
  readonly textAs: 'text' | 'paths';
  /** Glyph outline for one character at 1 px em, for `textAs: 'paths'`. */
  readonly glyphPath?: (ch: string) => string | null;
}

export class SvgSurface implements Surface {
  private readonly bodies: string[] = [];
  private readonly defs: string[] = [];
  private readonly patternKeys = new Map<string, string>();
  private readonly clipKeys = new Map<string, string>();
  private current: PathCommand[] = [];
  private currentD = '';
  private currentKind: 'none' | 'commands' | 'polyline' = 'none';
  private currentId = '';
  private readonly hrefs = new Map<string, string>();
  private readonly idCounts = new Map<string, number>();
  private patternSeq = 0;
  private clipSeq = 0;

  constructor(readonly options: SvgOptions = { textAs: 'text' }) {}

  /** Element count, for the 50,000-element cap. */
  get elementCount(): number {
    return this.bodies.length;
  }

  /** Id for the next painted element (the object name). */
  setCurrentId(name: string): void {
    this.currentId = name;
  }

  /**
   * The id attribute for one element. Repeats of one object's id are
   * suffixed (`c-2`, `c-3`), deterministically, so ids stay unique.
   */
  private nextIdAttr(): string {
    if (this.currentId === '') return '';
    const base = svgId(this.currentId);
    const n = (this.idCounts.get(base) ?? 0) + 1;
    this.idCounts.set(base, n);
    return n === 1 ? ` id="${base}"` : ` id="${base}-${n}"`;
  }

  setImageHref(key: string, href: string): void {
    this.hrefs.set(key, href);
  }

  save(): void {
    this.bodies.push('<g>');
  }
  restore(): void {
    this.bodies.push('</g>');
  }
  transform(): void {
    // Export repaints with an export viewport, so no live transforms remain.
  }
  clipRect(r: PxRect): void {
    const key = `r${svgRound(r.x0 as number)},${svgRound(r.y0 as number)},${svgRound(r.x1 as number)},${svgRound(r.y1 as number)}`;
    let id = this.clipKeys.get(key);
    if (id === undefined) {
      id = `clip${this.clipSeq++}`;
      this.clipKeys.set(key, id);
      this.defs.push(
        `<clipPath id="${id}"><rect x="${svgRound(r.x0 as number)}" y="${svgRound(r.y0 as number)}" width="${svgRound((r.x1 as number) - (r.x0 as number))}" height="${svgRound((r.y1 as number) - (r.y0 as number))}"/></clipPath>`,
      );
    }
    this.bodies.push(`<g clip-path="url(#${id})">`);
  }
  clipPath(p: PathData): void {
    const d = isCommandPath(p) ? commandsToD(p) : polylineToD(p);
    const key = `p${d}`;
    let id = this.clipKeys.get(key);
    if (id === undefined) {
      id = `clip${this.clipSeq++}`;
      this.clipKeys.set(key, id);
      this.defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
    }
    this.bodies.push(`<g clip-path="url(#${id})">`);
  }
  path(p: PathData): void {
    if (isCommandPath(p)) {
      this.current = [...p];
      this.currentD = commandsToD(p);
      this.currentKind = 'commands';
    } else {
      this.current = [];
      this.currentD = polylineToD(p);
      this.currentKind = 'polyline';
    }
  }
  private takeD(): string {
    const d = this.currentD;
    this.current = [];
    this.currentD = '';
    this.currentKind = 'none';
    return d;
  }

  stroke(st: StrokeStyle): void {
    const d = this.takeD();
    if (d === '') return;
    const dash = st.dash.length > 0 ? ` stroke-dasharray="${st.dash.map(svgRound).join(',')}" stroke-dashoffset="${svgRound(-st.dashPhase)}"` : '';
    const id = this.nextIdAttr();
    this.bodies.push(
      `<path${id} d="${d}" fill="none" stroke="${css(st.color)}" stroke-width="${svgRound(st.width)}" stroke-opacity="${svgRound(st.opacity)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"${dash}/>`,
    );
  }

  fill(f: FillStyle): void {
    const d = this.takeD();
    if (d === '') return;
    const id = this.nextIdAttr();
    if (f.kind === 'solid') {
      this.bodies.push(
        `<path${id} d="${d}" fill="${css(f.color)}" fill-opacity="${svgRound(f.opacity)}" stroke="none"/>`,
      );
      return;
    }
    const ref = this.patternFor(f.spec, f.color);
    this.bodies.push(
      `<path${id} d="${d}" fill="url(#${ref})" fill-opacity="${svgRound(f.opacity)}" stroke="none"/>`,
    );
  }

  private patternFor(spec: HatchSpec, color: Rgba): string {
    const key = JSON.stringify({ spec, color });
    const hit = this.patternKeys.get(key);
    if (hit !== undefined) return hit;
    const id = `hatch${this.patternSeq++}`;
    this.patternKeys.set(key, id);
    if (spec.kind === 'image') {
      const href = this.hrefs.get(spec.src) ?? '';
      this.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="32" height="32"><image href="${svgEscape(href)}" x="0" y="0" width="32" height="32" preserveAspectRatio="${spec.mode === 'tile' ? 'none' : 'xMidYMid slice'}"/></pattern>`,
      );
      return id;
    }
    const spacing = renderHatchSpacing(spec.spacing);
    const col = css(color);
    if (spec.kind === 'dots') {
      const r = svgRound(spec.radius ?? 1);
      this.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${svgRound(spacing)}" height="${svgRound(spacing)}"><circle cx="${svgRound(spacing / 2)}" cy="${svgRound(spacing / 2)}" r="${r}" fill="${col}"/></pattern>`,
      );
      return id;
    }
    const w = svgRound(spec.kind === 'lines' || spec.kind === 'cross' || spec.kind === 'grid' ? (spec.width ?? 1) : 1);
    const angle = spec.kind === 'lines' || spec.kind === 'cross' ? spec.angle : 0;
    if (spec.kind === 'cross' || spec.kind === 'grid') {
      this.defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${svgRound(spacing)}" height="${svgRound(spacing)}"><path d="M0,0H${svgRound(spacing)}M0,0V${svgRound(spacing)}" stroke="${col}" stroke-width="${w}"/></pattern>`,
      );
      return id;
    }
    this.defs.push(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${svgRound(spacing)}" height="${svgRound(spacing)}" patternTransform="rotate(${svgRound(angle)})"><path d="M0,0V${svgRound(spacing)}" stroke="${col}" stroke-width="${w}"/></pattern>`,
    );
    return id;
  }

  text(t: TextRun, at: PxPoint, st: TextStyle): void {
    const x = svgRound(at.x as number);
    const y = svgRound(at.y as number);
    const anchor = st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start';
    const id = this.nextIdAttr();
    const style = `font-size:${svgRound(st.size)}px;font-family:${svgEscape(st.family)};${st.bold ? 'font-weight:bold;' : ''}${st.italic ? 'font-style:italic;' : ''}`;
    if ((this.options.textAs === 'paths' || t.math) && this.options.glyphPath !== undefined) {
      // Maths text always becomes paths; plain text does when asked.
      let dx = 0;
      const glyphs: string[] = [];
      for (const ch of t.text) {
        const g = this.options.glyphPath(ch);
        if (g !== null) glyphs.push(`<path d="${g}" transform="translate(${svgRound(x + dx)},${svgRound(y)}) scale(${svgRound(st.size)})"/>`);
        dx += st.size * 0.6;
      }
      this.bodies.push(`<g${id} fill="${css(st.color)}" fill-opacity="${svgRound(st.opacity)}">${glyphs.join('')}</g>`);
      return;
    }
    this.bodies.push(
      `<text${id} x="${x}" y="${y}" text-anchor="${anchor}" style="${style}" fill="${css(st.color)}" fill-opacity="${svgRound(st.opacity)}">${svgEscape(t.text)}</text>`,
    );
  }

  image(img: ImageSource, dest: PxRect, opacity: number): void {
    const href = this.hrefs.get(img.key) ?? '';
    const id = this.nextIdAttr();
    this.bodies.push(
      `<image${id} href="${svgEscape(href)}" x="${svgRound(dest.x0 as number)}" y="${svgRound(dest.y0 as number)}" width="${svgRound((dest.x1 as number) - (dest.x0 as number))}" height="${svgRound((dest.y1 as number) - (dest.y0 as number))}" opacity="${svgRound(opacity)}"/>`,
    );
  }

  measure(t: TextRun, st: TextStyle): TextMetrics {
    const width = [...t.text].length * st.size * 0.6;
    return { width, height: st.size * 1.2, ascent: st.size * 0.9 };
  }

  /** The complete deterministic document. */
  toString(widthPx: number, heightPx: number, background: Rgba | 'none'): string {
    const bg = background === 'none'
      ? ''
      : `<rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="${css(background)}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}"><defs>${this.defs.join('')}</defs>${bg}${this.bodies.join('')}</svg>`;
  }
}

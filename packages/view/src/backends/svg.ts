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
  safeFontFamily, type StrokeStyle, type Surface, type TextMetrics, type TextRun, type TextStyle,
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

/** Document byte budget for an SVG export (VIEW-SM-3). */
export const MAX_SVG_BYTES = 64 * 1024 * 1024;

/**
 * An image `href` is kept only for data:image, http(s), blob: and relative
 * references. Other schemes (`javascript:`, `data:text/html`) become empty.
 */
export function safeHref(href: string): string {
  const t = href.trim();
  if (t === '') return '';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(t);
  if (scheme === null) return [...t].some((ch) => ch.charCodeAt(0) < 32 || ch === '\\') ? '' : t;
  const s = (scheme[1] ?? '').toLowerCase();
  if (s === 'http' || s === 'https' || s === 'blob') return t;
  if (s === 'data' && /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml)[;,]/i.test(t)) return t;
  return '';
}

export class SvgSurface implements Surface {
  private readonly bodies: string[] = [];
  private bytes = 0;
  private over = false;
  private readonly maxElements: number;
  private readonly maxBytes: number;
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

  constructor(
    readonly options: SvgOptions = { textAs: 'text' },
    limits: { readonly maxElements?: number; readonly maxBytes?: number } = {},
  ) {
    this.maxElements = limits.maxElements ?? Number.POSITIVE_INFINITY;
    this.maxBytes = limits.maxBytes ?? MAX_SVG_BYTES;
  }

  /** Element count, for the 50,000-element cap. */
  get elementCount(): number {
    return this.bodies.length;
  }

  /** Bytes written to the body so far (UTF-16 code units). */
  get byteCount(): number {
    return this.bytes;
  }

  /** True once the element or byte cap was passed; later calls write nothing. */
  get exceeded(): boolean {
    return this.over;
  }

  /** Definitions (clips, patterns) count toward the byte budget and the element cap. */
  private pushDef(s: string): void {
    if (this.over) return;
    if (this.bodies.length + this.defs.length >= this.maxElements || this.bytes + s.length > this.maxBytes) {
      this.over = true;
      return;
    }
    this.defs.push(s);
    this.bytes += s.length;
  }

  /** The single write path: counts elements and bytes and stops at the cap. */
  private push(s: string): void {
    if (this.over) return;
    if (this.bodies.length >= this.maxElements || this.bytes + s.length > this.maxBytes) {
      this.over = true;
      return;
    }
    this.bodies.push(s);
    this.bytes += s.length;
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
    this.hrefs.set(key, safeHref(href));
  }

  save(): void {
    this.push('<g>');
  }
  restore(): void {
    this.push('</g>');
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
      this.pushDef(
        `<clipPath id="${id}"><rect x="${svgRound(r.x0 as number)}" y="${svgRound(r.y0 as number)}" width="${svgRound((r.x1 as number) - (r.x0 as number))}" height="${svgRound((r.y1 as number) - (r.y0 as number))}"/></clipPath>`,
      );
    }
    this.push(`<g clip-path="url(#${id})">`);
  }
  clipPath(p: PathData): void {
    const d = isCommandPath(p) ? commandsToD(p) : polylineToD(p);
    const key = `p${d}`;
    let id = this.clipKeys.get(key);
    if (id === undefined) {
      id = `clip${this.clipSeq++}`;
      this.clipKeys.set(key, id);
      this.pushDef(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
    }
    this.push(`<g clip-path="url(#${id})">`);
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
    this.push(
      `<path${id} d="${d}" fill="none" stroke="${css(st.color)}" stroke-width="${svgRound(st.width)}" stroke-opacity="${svgRound(st.opacity)}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"${dash}/>`,
    );
  }

  fill(f: FillStyle): void {
    const d = this.takeD();
    if (d === '') return;
    const id = this.nextIdAttr();
    if (f.kind === 'solid') {
      this.push(
        `<path${id} d="${d}" fill="${css(f.color)}" fill-opacity="${svgRound(f.opacity)}" stroke="none"/>`,
      );
      return;
    }
    const ref = this.patternFor(f.spec, f.color);
    this.push(
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
      this.pushDef(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="32" height="32"><image href="${svgEscape(href)}" x="0" y="0" width="32" height="32" preserveAspectRatio="${spec.mode === 'tile' ? 'none' : 'xMidYMid slice'}"/></pattern>`,
      );
      return id;
    }
    const spacing = renderHatchSpacing(spec.spacing);
    const col = css(color);
    if (spec.kind === 'dots') {
      const r = svgRound(spec.radius ?? 1);
      this.pushDef(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${svgRound(spacing)}" height="${svgRound(spacing)}"><circle cx="${svgRound(spacing / 2)}" cy="${svgRound(spacing / 2)}" r="${r}" fill="${col}"/></pattern>`,
      );
      return id;
    }
    const w = svgRound(spec.kind === 'lines' || spec.kind === 'cross' || spec.kind === 'grid' ? (spec.width ?? 1) : 1);
    const angle = spec.kind === 'lines' || spec.kind === 'cross' ? spec.angle : 0;
    if (spec.kind === 'cross' || spec.kind === 'grid') {
      this.pushDef(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${svgRound(spacing)}" height="${svgRound(spacing)}"><path d="M0,0H${svgRound(spacing)}M0,0V${svgRound(spacing)}" stroke="${col}" stroke-width="${w}"/></pattern>`,
      );
      return id;
    }
    this.pushDef(
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${svgRound(spacing)}" height="${svgRound(spacing)}" patternTransform="rotate(${svgRound(angle)})"><path d="M0,0V${svgRound(spacing)}" stroke="${col}" stroke-width="${w}"/></pattern>`,
    );
    return id;
  }

  text(t: TextRun, at: PxPoint, st: TextStyle): void {
    const x = svgRound(at.x as number);
    const y = svgRound(at.y as number);
    const anchor = st.align === 'center' ? 'middle' : st.align === 'right' ? 'end' : 'start';
    const id = this.nextIdAttr();
    // The family is its own quoted attribute and never part of a `style`
    // string, so no authored text can add CSS declarations (VIEW-SM-1).
    const family = svgEscape(safeFontFamily(st.family));
    const weight = st.bold ? ' font-weight="bold"' : '';
    const slant = st.italic ? ' font-style="italic"' : '';
    if ((this.options.textAs === 'paths' || t.math) && this.options.glyphPath !== undefined) {
      // Maths text always becomes paths; plain text does when asked.
      let dx = 0;
      const glyphs: string[] = [];
      for (const ch of t.text) {
        const g = this.options.glyphPath(ch);
        if (g !== null) glyphs.push(`<path d="${svgEscape(g)}" transform="translate(${svgRound(x + dx)},${svgRound(y)}) scale(${svgRound(st.size)})"/>`);
        dx += st.size * 0.6;
      }
      this.push(`<g${id} fill="${css(st.color)}" fill-opacity="${svgRound(st.opacity)}">${glyphs.join('')}</g>`);
      return;
    }
    this.push(
      `<text${id} x="${x}" y="${y}" text-anchor="${anchor}" font-size="${svgRound(st.size)}" font-family="${family}"${weight}${slant} fill="${css(st.color)}" fill-opacity="${svgRound(st.opacity)}">${svgEscape(t.text)}</text>`,
    );
  }

  image(img: ImageSource, dest: PxRect, opacity: number): void {
    const href = this.hrefs.get(img.key) ?? '';
    const id = this.nextIdAttr();
    this.push(
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

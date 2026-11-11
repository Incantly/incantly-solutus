/**
 * The concrete drawable: one per object, caching pixel geometry built by
 * `geometry.ts` and painting it through any `Surface`. Back-ends never see
 * kernel values, only this cache.
 */
import type { ObjId } from '@incantly/kernel';
import type { ValueOrUndef } from '../contracts';
import {
  px, type PxPoint, type PxRect, type Viewport,
} from './coords';
import {
  TYPE_RANK, VIEWPORT_DEPENDENT,
  type Drawable, type DrawableInput, type OutlineMode, type PaintContext, type PaintKind, type SortKey,
} from './drawables';
import {
  buildGeometry, buildInput, hitGeometry, markerIsOpen, markerStroke, shiftGeometry,
  type BuiltGeometry, type TextMeasure,
} from './geometry';
import type { HitCandidate } from './hit';
import {
  describeAngle, describeArc, describeBool, describeCircle, describeCurve, describeFunction,
  describeLine, describeParticles, describePoint, describePolygon, describeRegion,
  describeSegment, describeSlider, describeText, describeUndefined, describeVector,
  VIEW_REASON_TEXT, type ResolvedStyle,
} from './styles';
import {
  expandRect, unionRect, type FillStyle, type PathCommand, type StrokeStyle, type Surface, type TextRun,
} from './surface';

export interface DrawableOptions {
  readonly id: ObjId;
  readonly name: string;
  readonly kind: PaintKind;
  readonly order: number;
  readonly layer: number;
  readonly free: boolean;
  readonly onPath: boolean;
  readonly measure: TextMeasure;
}

function circleCommands(x: number, y: number, r: number): PathCommand[] {
  return [
    { k: 'M', x: x + r, y },
    { k: 'A', rx: r, ry: r, rot: 0, large: true, sweep: true, x: x - r, y },
    { k: 'A', rx: r, ry: r, rot: 0, large: true, sweep: true, x: x + r, y },
    { k: 'Z' },
  ];
}

function strokeOf(style: ResolvedStyle): StrokeStyle {
  return {
    color: style.color,
    width: style.width,
    dash: style.dash,
    dashPhase: style.dashPhase,
    cap: style.dash.length > 0 ? 'butt' : 'round',
    join: 'round',
    miterLimit: 4,
    opacity: style.group ?? style.opacity,
  };
}

function fillOf(style: ResolvedStyle): FillStyle {
  if (style.hatch !== 'none') {
    return { kind: 'hatch', spec: style.hatch, color: style.fillColor, opacity: style.fill };
  }
  return { kind: 'solid', color: style.fillColor, opacity: style.group ?? style.fill };
}

export class GeometryDrawable implements Drawable {
  readonly id: ObjId;
  readonly kind: PaintKind;
  readonly rank: number;
  sortKey: SortKey;
  bbox: PxRect | null = null;

  private geom: BuiltGeometry | null = null;
  private style: ResolvedStyle | null = null;
  private value: ValueOrUndef | null = null;
  private labelOffset: { dx: number; dy: number } | null = null;
  private valueText = '';
  private widgetRect: PxRect | null = null;
  private detail: 0 | 1 | 2 = 0;
  private traceJoin = false;
  private readonly opts: DrawableOptions;

  constructor(opts: DrawableOptions) {
    this.opts = opts;
    this.id = opts.id;
    this.kind = opts.kind;
    this.rank = TYPE_RANK[opts.kind];
    this.sortKey = { layer: opts.layer, rank: this.rank, order: opts.order };
  }

  setDetail(detail: 0 | 1 | 2): void {
    this.detail = detail;
  }

  setTraceJoin(join: boolean): void {
    this.traceJoin = join;
  }

  setLabelOffset(dx: number, dy: number): void {
    this.labelOffset = { dx, dy };
  }

  clearLabelOffset(): void {
    this.labelOffset = null;
  }

  setValueText(text: string): void {
    this.valueText = text;
  }

  /** Label request for the layout phase, or null when no label draws. */
  labelRequest(): { anchor: PxPoint; mode: 'name' | 'value' | 'name-value' | 'caption'; text: string; widthPx: number; heightPx: number } | null {
    const g = this.geom;
    const style = this.style;
    if (g === null || style === null || style.label === 'none') return null;
    let text = this.opts.name;
    if (style.label === 'value') text = g.labelText ?? this.valueText;
    else if (style.label === 'name-value') text = `${this.opts.name} = ${g.labelText ?? this.valueText}`;
    else if (style.label === 'caption') text = style.caption;
    else if (g.labelText !== null && this.kind === 'angle') text = g.labelText;
    const m = this.opts.measure(text, style.textStyle.size);
    const mode = style.label === 'name' ? 'name' as const : style.label === 'value' ? 'value' as const : style.label === 'caption' ? 'caption' as const : 'name-value' as const;
    return { anchor: g.anchor, mode, text, widthPx: m.width, heightPx: m.height };
  }

  /** Cached anchor for hit fallbacks and label leaders. */
  anchor(): PxPoint | null {
    return this.geom?.anchor ?? null;
  }

  /** Cached pixel runs for rubber-band selection. */
  rubberShape(): { strokes: readonly Float32Array[]; fills: readonly Float32Array[] } | null {
    const g = this.geom;
    if (g === null) return null;
    return { strokes: g.strokes, fills: g.fills };
  }

  setWidgetRect(rect: PxRect | null): void {
    this.widgetRect = rect;
  }

  setLayer(layer: number): void {
    this.sortKey = { layer, rank: this.rank, order: this.sortKey.order };
  }

  update(input: DrawableInput, view: Viewport, style: ResolvedStyle): boolean {
    this.style = style;
    this.value = input.value;
    this.setLayer(style.layer);
    if (!input.value.defined || !style.show) {
      this.geom = null;
      this.bbox = null;
      return false;
    }
    const g = buildGeometry(
      input.value.value,
      buildInput(view, this.opts.measure, this.detail, this.traceJoin),
      style,
    );
    if (g === null) {
      this.geom = null;
      // 3D values and particles draw through their own renderers.
      this.bbox = null;
      return input.value.value.k === 'particles' || input.value.value.k === 'mesh' ||
        input.value.value.k === 'meshref' || input.value.value.k === 'point3';
    }
    this.geom = g;
    this.bbox = this.computeBbox(g, style);
    return this.bbox !== null || this.kind === 'particles';
  }

  private computeBbox(g: BuiltGeometry, style: ResolvedStyle): PxRect | null {
    if (this.kind === 'point') {
      const r = g.markerRadius + 1;
      const x = g.anchor.x as number;
      const y = g.anchor.y as number;
      return { x0: px(x - r), x1: px(x + r), y0: px(y - r), y1: px(y + r) };
    }
    if (this.kind === 'text' && this.value !== null && this.value.defined && this.value.value.k === 'text') {
      const m = this.opts.measure(this.value.value.text, style.textStyle.size);
      const w = m.width / 2;
      const h = m.height / 2;
      const x = g.anchor.x as number;
      const y = g.anchor.y as number;
      const rect: PxRect = { x0: px(x - w), x1: px(x + w), y0: px(y - h), y1: px(y + h) };
      return unionRect(g.bbox, rect);
    }
    if ((this.kind === 'widget' || this.kind === 'text') && this.widgetRect !== null) {
      return unionRect(g.bbox, this.widgetRect);
    }
    return g.bbox;
  }

  paint(s: Surface, _ctx: PaintContext): void {
    const g = this.geom;
    const style = this.style;
    if (g === null || style === null) return;
    if (this.value !== null && this.value.defined && this.value.value.k === 'point') {
      this.paintMarker(s, g.anchor, style);
      return;
    }
    const st = strokeOf(style);
    const fl = fillOf(style);
    for (const ring of g.fills) {
      if (style.fill <= 0 && style.hatch === 'none') break;
      s.path(ring);
      s.fill(fl);
    }
    for (const run of g.strokes) {
      s.path(run);
      s.stroke(st);
    }
    if (this.value !== null && this.value.defined && this.value.value.k === 'text') {
      this.paintText(s, this.value.value.text, g.anchor, style);
    }
  }

  private paintMarker(s: Surface, at: PxPoint, style: ResolvedStyle): void {
    const x = at.x as number;
    const y = at.y as number;
    const r = style.pointSize;
    const st = strokeOf(style);
    const fl = fillOf(style);
    const shape = style.pointStyle;
    if (shape === 'dot' || shape === 'ring') {
      s.path(circleCommands(x, y, r));
      if (shape === 'dot') {
        s.fill({ kind: 'solid', color: style.color, opacity: style.opacity });
        s.path(circleCommands(x, y, r));
        s.stroke({ ...st, width: 1 });
      } else {
        s.stroke({ ...st, width: 2 });
      }
      return;
    }
    for (const [x0, y0, x1, y1] of markerStroke(shape, x, y, r)) {
      s.path(new Float32Array([x0, y0, x1, y1]));
      s.stroke(st);
    }
    if (!markerIsOpen(shape)) {
      // Closed markers (diamond, square, triangles) also fill faintly.
      s.path(circleCommands(x, y, r * 0.4));
      s.fill({ kind: 'solid', color: style.color, opacity: style.opacity * 0.3 });
    }
  }

  private paintText(s: Surface, text: string, at: PxPoint, style: ResolvedStyle): void {
    const run: TextRun = { text, math: text.includes('$') };
    s.text(run, at, {
      size: style.textStyle.size,
      bold: style.textStyle.bold,
      italic: style.textStyle.italic,
      family: style.textStyle.family,
      align: style.textStyle.align,
      color: style.color,
      opacity: style.labelOpacity,
      background: style.textStyle.background,
    });
  }

  paintLabel(s: Surface, ctx: PaintContext): void {
    const g = this.geom;
    const style = this.style;
    if (g === null || style === null || style.label === 'none') return;
    const off = this.labelOffset ?? { dx: 6, dy: -6 };
    const at: PxPoint = {
      x: px((g.anchor.x as number) + off.dx),
      y: px((g.anchor.y as number) + off.dy),
    };
    let text = this.opts.name;
    if (style.label === 'value') text = g.labelText ?? this.valueText;
    else if (style.label === 'name-value') text = `${this.opts.name} = ${g.labelText ?? this.valueText}`;
    else if (style.label === 'caption') text = style.caption;
    else if (g.labelText !== null && this.kind === 'angle') text = g.labelText;
    this.paintText(s, text, at, { ...style, labelOpacity: style.labelOpacity });
    if (Math.hypot(off.dx, off.dy) > 20) {
      s.path(new Float32Array([g.anchor.x as number, g.anchor.y as number, at.x as number, at.y as number]));
      s.stroke({ ...strokeOf(style), width: 1, color: ctx.theme.axes, opacity: 0.6 });
    }
  }

  hit(p: PxPoint, slack: number): HitCandidate | null {
    const g = this.geom;
    if (g === null) return null;
    if ((this.kind === 'widget' || this.kind === 'text') && this.widgetRect !== null) {
      const r = this.widgetRect;
      const inside = (p.x as number) >= (r.x0 as number) - 2 && (p.x as number) <= (r.x1 as number) + 2 &&
        (p.y as number) >= (r.y0 as number) - 2 && (p.y as number) <= (r.y1 as number) + 2;
      return inside ? { id: this.id, part: 'body', distance: 0, priority: 2 } : null;
    }
    return hitGeometry(this.id, this.kind, g, p, slack);
  }

  outline(s: Surface, mode: OutlineMode): void {
    const g = this.geom;
    const style = this.style;
    if (g === null || style === null) return;
    const halo: StrokeStyle = {
      ...strokeOf(style),
      width: mode === 'focus' ? 3 : mode === 'selected' ? 6 : 5,
      dash: [],
      dashPhase: 0,
      opacity: mode === 'selected' ? 0.5 : mode === 'focus' ? 1 : 0.35,
    };
    for (const run of g.strokes) {
      s.path(run);
      s.stroke(halo);
    }
    if (this.kind === 'point') {
      s.path(circleCommands(g.anchor.x as number, g.anchor.y as number, g.markerRadius + 3));
      s.stroke(halo);
    }
    if (g.bbox !== null && g.strokes.length === 0 && this.kind !== 'point') {
      const r = expandRect(g.bbox, 3);
      s.path(new Float32Array([
        r.x0 as number, r.y0 as number, r.x1 as number, r.y0 as number,
        r.x1 as number, r.y1 as number, r.x0 as number, r.y1 as number,
        r.x0 as number, r.y0 as number,
      ]));
      s.stroke(halo);
    }
  }

  /** Shift cached pixels after a pan; viewport-dependent kinds rebuild. */
  shiftPixels(dx: number, dy: number): boolean {
    if (this.geom === null) return true;
    if (VIEWPORT_DEPENDENT.has(this.kind)) return false;
    this.geom = shiftGeometry(this.geom, dx, dy);
    const style = this.style;
    if (style !== null) this.bbox = this.computeBbox(this.geom, style);
    return true;
  }

  describe(): string {
    const name = this.opts.name;
    const v = this.value;
    if (v === null || !v.defined) {
      const reason = v !== null && !v.defined ? v.undef.reason : 'not_set';
      return describeUndefined(name, this.kind, VIEW_REASON_TEXT[reason] ?? reason);
    }
    const val = v.value;
    switch (val.k) {
      case 'point':
        return describePoint(name, this.valueText || `${val.x}, ${val.y}`,
          this.opts.free ? 'free' : this.opts.onPath ? 'onPath' : 'dependent', null);
      case 'segment': return describeSegment(name, this.valueText, '', '');
      case 'vector': return describeVector(name, this.valueText, '');
      case 'ray':
      case 'line': return describeLine(name, this.valueText);
      case 'circle': return describeCircle(name, '', this.valueText);
      case 'arc': return describeArc(name, '', this.valueText, '');
      case 'polygon': return describePolygon(name, Math.floor(val.pts.length / 2), this.valueText || null);
      case 'polyline':
      case 'curve': return describeCurve(name, this.valueText || 'parametric');
      case 'region': return describeRegion(name, this.valueText || null);
      case 'angle': return describeAngle(name, this.geom?.labelText ?? this.valueText);
      case 'text': return describeText(name, val.text);
      case 'number': return `${name} = ${this.valueText || String(val.v)}.`;
      case 'bool': return describeBool(name, val.v);
      case 'slider':
        return describeSlider(name, this.valueText || String(val.v), String(val.lo), String(val.hi), String(val.step));
      case 'particles': return describeParticles(name, val.spec.count, null);
      case 'trace': return `Trace of ${name}.`;
      case 'point3': return describePoint(name, this.valueText || `${val.x}, ${val.y}, ${val.z}`, this.opts.free ? 'free' : 'dependent', null);
      case 'mesh':
      case 'meshref': return `${name}, a 3D solid.`;
    }
  }
}

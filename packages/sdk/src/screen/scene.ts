/**
 * What a figure draws: one scene item per object that shows on the graph (the studio's list and every export read
 * the same rule). Selection, hover and tool previews are the screen's own and are added by it.
 */
import { tracePoints, tracedIds } from '@incantly/kernel';
import type { Figure, ObjectView } from '@incantly/kernel';
import { colorAt } from './paint';
import type { SceneItem } from './paint';
import { symDrawing } from './symplot';

/** Types that draw on the graph and so get a swatch. */
const DRAWN = new Set(['Particles', 'Point', 'Vector', 'Segment', 'Line', 'Ray', 'Circle', 'Arc', 'Sector', 'Conic', 'Polyline', 'Polygon', 'Function', 'Curve', 'Relation', 'Region', 'Field', 'Chart', 'ContinuousDistribution', 'DiscreteDistribution']);

export function drawsOnGraph(type: string, typeText: string, value: unknown): boolean {
  const base = type.replace(/<.*$/, '');
  // particles in space belong to the Space view
  if (base === 'Particles' && (value as { space?: unknown } | undefined)?.space === true) return false;
  if (DRAWN.has(base)) return true;
  if (base === 'List') return /^List<(Point|Polygon|Segment|Circle|Line|Vector)/.test(typeText);
  if (base === 'Record') return (value as { schema?: string } | undefined)?.schema === 'Fit';
  return false;
}

export const hiddenByStyle = (o: { style: { shown: boolean } }): boolean => o.style.shown === false;

function colorCss(c: unknown): string | undefined {
  const o = c as { r?: number; g?: number; b?: number; a?: number };
  if (typeof o.r !== 'number' || typeof o.g !== 'number' || typeof o.b !== 'number') return undefined;
  const k = o.r <= 1 && o.g <= 1 && o.b <= 1 ? 255 : 1;
  return `rgba(${Math.round(o.r * k)}, ${Math.round(o.g * k)}, ${Math.round(o.b * k)}, ${o.a ?? 1})`;
}

export interface SceneOptions {
  /** The colour of an object (the studio's list gives each a palette colour in order). */
  readonly color?: (o: ObjectView, index: number) => string;
  /** Objects the screen hides on its own (not by style). */
  readonly hidden?: (o: ObjectView) => boolean;
  /** Draw objects hidden by style faintly (the show/hide tool). */
  readonly showHidden?: boolean;
  /** Free points that can be dragged (the screen asks the session). */
  readonly draggable?: (o: ObjectView) => boolean;
}

/** The scene of a figure now. */
export function sceneOf(figure: Figure, opts: SceneOptions = {}): SceneItem[] {
  const out: SceneItem[] = [];
  const traced = new Set(tracedIds(figure).map((x) => x as unknown as number));
  const t = figure.clock().t;
  let index = 0;
  for (const o of figure.objects()) {
    const color = opts.color ? opts.color(o, index) : colorAt(index);
    index++;
    if (!o.cell.defined) continue;
    const hiddenHere = opts.hidden?.(o) === true;
    // a text is drawn on the graph when it has a place (`with at = …`)
    if (o.type === 'Text') {
      const ext = o.style.ext as { at?: { x: number; y: number }; size?: number; anchor?: string; rotate?: number; bg?: unknown; vertical?: boolean; latex?: string };
      if (!ext.at || hiddenHere || hiddenByStyle(o)) continue;
      const bg = typeof ext.bg === 'object' && ext.bg !== null ? colorCss(ext.bg) : undefined;
      out.push({
        id: o.id, name: o.name, type: 'Text', typeText: 'Text', value: o.cell.value, color, free: false, label: false,
        text: { at: ext.at, size: ext.size ?? 16, anchor: ext.anchor ?? 'sw', rotate: ext.rotate ?? 0, ...(bg ? { bg } : {}), ...(ext.vertical === true ? { vertical: true } : {}), ...(ext.latex === 'full' ? { full: true } : {}) },
      });
      continue;
    }
    if (hiddenHere) continue;
    if (hiddenByStyle(o) && !opts.showHidden) continue;
    // a symbolic row with its show switch on (cas ui.md 4, 7)
    if ((o.style.ext as { plot?: unknown }).plot === true) {
      const d = symDrawing(o.cell.value);
      const base = { id: o.id, name: o.name, typeText: o.typeText, color, free: false, label: false };
      if (d?.kind === 'curve') out.push({ ...base, type: 'Function', value: d.fn, holes: d.holes });
      else if (d?.kind === 'relation') out.push({ ...base, type: 'Relation', value: d.value });
      else if (d?.kind === 'axis') out.push({ ...base, type: 'SymAxis', value: d });
      else if (d?.kind === 'points') out.push({ ...base, type: 'List', typeText: 'List<Point>', value: d.pts });
      continue;
    }
    if (!drawsOnGraph(o.type, o.typeText, o.cell.value)) continue;
    out.push({
      id: o.id, name: o.name, type: o.type, typeText: o.typeText, value: o.cell.value, color, free: o.type === 'Point' && (opts.draggable?.(o) ?? o.free), label: true,
      ...(hiddenByStyle(o) ? { ghost: true } : {}),
      ...(o.type === 'Particles' ? { time: t } : {}),
      ...(traced.has(o.id as unknown as number) ? { trace: tracePoints(figure, o.id) as Float64Array } : {}),
    });
  }
  return out;
}

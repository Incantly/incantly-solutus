/**
 * Fixes strokes: each pen stroke that fits a clean shape within 6% is replaced by that shape, all in one transaction,
 * so one undo brings the ink back (design 7.3). A stroke that fits nothing stays as it is. No DOM, no timers.
 */
import type { BoardCore } from './board';
import type { BoardResult } from './errors';
import { boardError, ok } from './errors';
import { inkToPage } from './ink/geometry';
import { recogniseStroke } from './ink/recognise';
import type { Recognised } from './ink/recognise';
import type { InkProps } from './kinds/ink';
import { putNewShape, shapeOf } from './shapes';
import type { NewShape } from './shapes';
import type { ShapeRecord } from './types';

/** The page points of a stored stroke, turned as it is drawn. */
export function strokePoints(shape: ShapeRecord<'ink', InkProps>): number[] {
  const { points, stride } = shape.props;
  const n = Math.floor(points.length / stride);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = inkToPage(shape, points[i * stride] as number, points[i * stride + 1] as number);
    out.push(p.x, p.y);
  }
  return out;
}

/** The shape that replaces a stroke, from what was recognised: its kind, place and props. */
function replacement(ink: ShapeRecord<'ink', InkProps>, r: Recognised): Pick<NewShape, 'kind' | 'x' | 'y' | 'props' | 'rotation'> {
  const { color, size } = ink.props;
  const line = { stroke: color, size };
  switch (r.kind) {
    case 'line':
      return { kind: 'line', x: r.x0, y: r.y0, props: { points: [0, 0, r.x1 - r.x0, r.y1 - r.y0], closed: false, ...line } };
    case 'arrow':
      return { kind: 'arrow', x: r.x0, y: r.y0, props: { start: [0, 0], end: [r.x1 - r.x0, r.y1 - r.y0], endHead: 'arrow', ...line } };
    case 'ellipse':
      return { kind: 'ellipse', x: r.cx - r.w / 2, y: r.cy - r.h / 2, props: { w: r.w, h: r.h, fill: 'none', ...line } };
    case 'rect':
      return { kind: 'rect', x: r.cx - r.w / 2, y: r.cy - r.h / 2, rotation: r.rotation, props: { w: r.w, h: r.h, fill: 'none', ...line } };
    case 'polygon': {
      let minX = Infinity;
      let minY = Infinity;
      for (let i = 0; i < r.points.length; i += 2) {
        minX = Math.min(minX, r.points[i] as number);
        minY = Math.min(minY, r.points[i + 1] as number);
      }
      const points = r.points.map((v, i) => v - (i % 2 === 0 ? minX : minY));
      return { kind: 'line', x: minX, y: minY, props: { points, closed: true, fill: 'none', ...line } };
    }
  }
}

/** What fixing one stroke would give, or undefined when nothing fits. */
export function fixPreview(ink: ShapeRecord<'ink', InkProps>): Recognised | undefined {
  if (ink.props.nib === 'highlighter') return undefined;
  return recogniseStroke(strokePoints(ink));
}

/**
 * Replaces the strokes among `ids` by their clean shapes, in one undo step. Returns the ids of the new shapes (empty
 * when no stroke fit). Locked strokes and highlighter strokes are left.
 */
export function fixStrokes(core: BoardCore, ids: readonly string[], options: { readonly mergeKey?: string } = {}): BoardResult<string[]> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  const found: { readonly ink: ShapeRecord<'ink', InkProps>; readonly fit: Recognised }[] = [];
  for (const id of ids) {
    const s = shapeOf(core.store, id);
    if (s === undefined || s.kind !== 'ink' || s.locked) continue;
    const ink = s as ShapeRecord<'ink', InkProps>;
    const fit = fixPreview(ink);
    if (fit !== undefined) found.push({ ink, fit });
  }
  if (found.length === 0) return ok([]);
  const made: string[] = [];
  const written = core.store.change(
    'user',
    (tx) => {
      for (const { ink, fit } of found) {
        tx.remove(ink.id);
        const spec = replacement(ink, fit);
        const shape = putNewShape(tx, core.store, { ...spec, page, parent: ink.parent, index: ink.index });
        if (!shape.ok) return;
        // the new shape keeps the ink's own opacity and the host's own data
        tx.update(shape.value.id, { opacity: ink.opacity, meta: { ...ink.meta } });
        made.push(shape.value.id);
      }
    },
    options.mergeKey !== undefined ? { mergeKey: options.mergeKey } : {},
  );
  return written.ok ? ok(made) : written;
}

/** The strokes the toolbar's Fix works on: the selected strokes, or the newest stroke of the page when none is selected. */
export function strokesToFix(core: BoardCore): string[] {
  const chosen = core.selection.ids.filter((id) => shapeOf(core.store, id)?.kind === 'ink');
  if (chosen.length > 0) return chosen;
  const page = core.pages.current;
  if (page === null) return [];
  let last: string | undefined;
  for (const s of core.store.shapesOn(page)) if (s.kind === 'ink') last = s.id;
  return last === undefined ? [] : [last];
}

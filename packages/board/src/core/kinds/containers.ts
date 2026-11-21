/**
 * `frame` (holds and clips its children; its name sits above it) and `group` (no look of its own: a record that says
 * which shapes belong together) (design 7.1). A child's own `x` and `y` are always page units; `parent` only says which
 * frame or group it belongs to, so moving a frame writes the children's positions too (`core/edit.ts`).
 */
import { ok } from '../errors';
import type { BoardResult } from '../errors';
import { distToPath, inPolygon } from '../math2d';
import { cssOrNull, pathPart, polygonPath } from '../paint';
import type { Part } from '../paint';
import { layoutText, textParts } from '../text';
import type { ShapeRecord } from '../types';
import type { DrawLod, KindDef, KindGeometry, StylePatch } from './def';
import { DIM_MAX, DIM_MIN, SIZE_MAX, TEXT_MAX, bagOf, failed, firstError, readColor, readFill, readNumber, readText } from './props';

export interface FrameProps {
  readonly w: number;
  readonly h: number;
  readonly name: string;
  readonly fill: string;
  readonly stroke: string;
  readonly size: number;
}

export const FRAME_DEFAULTS: FrameProps = Object.freeze({ w: 400, h: 300, name: 'Frame', fill: '#ffffff', stroke: '#a8aebb', size: 2 });

/** The frame's name is this big and sits this far above the frame. */
const NAME_PX = 14;
const NAME_GAP = 4;

function nameLayout(p: FrameProps): ReturnType<typeof layoutText> {
  return layoutText(p.name === '' ? ' ' : p.name, NAME_PX, 'sans', '#6b7280', null, 'start');
}

export const frameKind: KindDef<FrameProps> = {
  kind: 'frame',
  defaults: FRAME_DEFAULTS,
  check(props: unknown): BoardResult<FrameProps> {
    const p = bagOf(props, 'A frame');
    if (failed(p)) return p;
    const w = readNumber(p, 'w', FRAME_DEFAULTS.w, DIM_MIN, DIM_MAX);
    const h = readNumber(p, 'h', FRAME_DEFAULTS.h, DIM_MIN, DIM_MAX);
    const name = readText(p, 'name', FRAME_DEFAULTS.name, TEXT_MAX);
    const fill = readFill(p, 'fill', FRAME_DEFAULTS.fill);
    const stroke = readColor(p, 'stroke', FRAME_DEFAULTS.stroke);
    const size = readNumber(p, 'size', FRAME_DEFAULTS.size, 0.5, SIZE_MAX);
    const error = firstError(w, h, name, fill, stroke, size);
    if (error !== undefined) return error;
    return ok({ w, h, name, fill, stroke, size } as FrameProps);
  },
  geometry(shape: ShapeRecord<string, FrameProps>): KindGeometry {
    const p = shape.props;
    const label = nameLayout(p);
    const ring = [0, 0, p.w, 0, p.w, p.h, 0, p.h];
    const title = [0, -label.h - NAME_GAP, label.w, -label.h - NAME_GAP, label.w, 0, 0, 0];
    return {
      box: { minX: 0, minY: 0, maxX: p.w, maxY: p.h },
      pad: label.h + NAME_GAP + p.size,
      poly: ring,
      // a frame is picked by its edge or its name, so a click inside goes through to what is under it
      hit: (x, y, tol) => distToPath(x, y, ring, true) <= p.size / 2 + tol + 3 || inPolygon(x, y, title),
    };
  },
  draw(shape: ShapeRecord<string, FrameProps>, lod: DrawLod): readonly Part[] {
    const p = shape.props;
    const parts: Part[] = [pathPart(polygonPath([0, 0, p.w, 0, p.w, p.h, 0, p.h]), cssOrNull(p.fill), p.stroke, p.size, [], 'butt')];
    if (lod === 'full' && p.name !== '') {
      const label = nameLayout(p);
      parts.push(...textParts(label, 0, -label.h - NAME_GAP, 'sans'));
    }
    return parts;
  },
  onResize: (_shape, box) => ({ w: Math.max(DIM_MIN, box.maxX - box.minX), h: Math.max(DIM_MIN, box.maxY - box.minY) }),
  applyStyle(_props, style: StylePatch): Partial<FrameProps> {
    return {
      ...(style.color !== undefined ? { stroke: style.color } : {}),
      ...(style.fill !== undefined ? { fill: style.fill } : {}),
      ...(style.size !== undefined ? { size: Math.min(SIZE_MAX, Math.max(0.5, style.size)) } : {}),
    };
  },
  text: { get: (p) => p.name, set: (_p, name) => ({ name }) },
};

/** A group has no props: its members name it as their `parent`. It has no geometry, so it is not drawn or indexed. */
export type GroupProps = Record<string, never>;

export const groupKind: KindDef<GroupProps> = {
  kind: 'group',
  defaults: {},
  check(props: unknown): BoardResult<GroupProps> {
    const p = bagOf(props, 'A group');
    if (failed(p)) return p;
    return ok({});
  },
};

import type { Layer, ViewBox } from '../api/types';

export type ElementKind = 'g' | 'path' | 'line' | 'circle' | 'rect' | 'text' | 'polyline';

/**
 * Drawing instructions from the scene runtime to the renderer. Ids are
 * scene-local integers; the renderer scopes them to its figure.
 */
export type SceneCommand =
  | {
      readonly op: 'stage';
      readonly id: number;
      readonly selector: string;
      readonly viewBox: ViewBox;
      readonly title: string;
      readonly description: string;
    }
  | {
      readonly op: 'create';
      readonly id: number;
      readonly kind: ElementKind;
      readonly parent: number;
      readonly layer: Layer;
    }
  | { readonly op: 'attr'; readonly id: number; readonly name: string; readonly value: string | null }
  | { readonly op: 'text'; readonly id: number; readonly value: string }
  | { readonly op: 'class'; readonly id: number; readonly value: string }
  | {
      readonly op: 'part';
      readonly id: number;
      readonly name: string;
      readonly label: string;
      readonly info: string;
    };

/** Attributes the renderer will write. Anything else is dropped. */
export const RENDERABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'd',
  'points',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'transform',
]);

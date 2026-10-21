import type { Vec2 } from '../../api/types';
import { fmt } from '../../scene/format';

/** Node outlines, their sizes from their labels, and where a line from the centre meets the border. */

export type NodeShape = 'box' | 'round' | 'diamond' | 'circle' | 'pill';
export const NODE_SHAPES: readonly NodeShape[] = ['box', 'round', 'diamond', 'circle', 'pill'];

/** Average width of a 14px label character, in stage units. */
export const CHAR_WIDTH = 7.2;
export const LINE_HEIGHT = 18;
/** Labels longer than this wrap onto a second line. */
const WRAP_AT = 22;

/** One line, or two split at the space nearest the middle. */
export function wrapLabel(label: string): string[] {
  const text = label.trim();
  if (text.length <= WRAP_AT) return [text];
  const middle = text.length / 2;
  let split = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (split < 0 || Math.abs(i - middle) < Math.abs(split - middle))) split = i;
  }
  return split < 0 ? [text] : [text.slice(0, split), text.slice(split + 1)];
}

export function nodeSize(shape: NodeShape, lines: readonly string[]): { readonly w: number; readonly h: number } {
  const textWidth = Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH;
  const textHeight = lines.length * LINE_HEIGHT;
  switch (shape) {
    case 'box':
    case 'round':
      return { w: Math.max(56, textWidth + 24), h: textHeight + 16 };
    case 'pill':
      return { w: Math.max(64, textWidth + 36), h: textHeight + 16 };
    case 'diamond':
      // The text sits inside the rhombus, so the rhombus is wider and taller than it.
      return { w: Math.max(76, textWidth * 1.5 + 28), h: Math.max(48, textHeight * 1.7 + 20) };
    case 'circle': {
      const d = Math.max(44, Math.hypot(textWidth, textHeight) + 12);
      return { w: d, h: d };
    }
  }
}

function cornerRadius(shape: NodeShape, w: number, h: number): number {
  if (shape === 'round') return Math.min(10, w / 2, h / 2);
  if (shape === 'pill') return Math.min(w, h) / 2;
  return 0;
}

/** The outline, centred on the origin. */
export function shapePath(shape: NodeShape, w: number, h: number): string {
  const x = w / 2;
  const y = h / 2;
  switch (shape) {
    case 'box':
      return `M${fmt(-x)} ${fmt(-y)}H${fmt(x)}V${fmt(y)}H${fmt(-x)}Z`;
    case 'diamond':
      return `M0 ${fmt(-y)}L${fmt(x)} 0L0 ${fmt(y)}L${fmt(-x)} 0Z`;
    case 'circle':
      return `M${fmt(x)} 0A${fmt(x)} ${fmt(x)} 0 1 1 ${fmt(-x)} 0A${fmt(x)} ${fmt(x)} 0 1 1 ${fmt(x)} 0Z`;
    case 'round':
    case 'pill': {
      const r = cornerRadius(shape, w, h);
      const a = `A${fmt(r)} ${fmt(r)} 0 0 1`;
      return (
        `M${fmt(-x + r)} ${fmt(-y)}H${fmt(x - r)}${a} ${fmt(x)} ${fmt(-y + r)}V${fmt(y - r)}${a} ${fmt(x - r)} ${fmt(y)}` +
        `H${fmt(-x + r)}${a} ${fmt(-x)} ${fmt(y - r)}V${fmt(-y + r)}${a} ${fmt(-x + r)} ${fmt(-y)}Z`
      );
    }
  }
}

/** Where the ray from the centre in direction (dx, dy) leaves the shape, relative to the centre. */
export function borderPoint(shape: NodeShape, w: number, h: number, dx: number, dy: number): Vec2 {
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return [0, h / 2];
  const ux = dx / length;
  const uy = dy / length;
  const x = w / 2;
  const y = h / 2;
  switch (shape) {
    case 'circle':
      return [ux * x, uy * x];
    case 'diamond': {
      const t = 1 / (Math.abs(ux) / x + Math.abs(uy) / y);
      return [ux * t, uy * t];
    }
    case 'box':
    case 'round':
    case 'pill': {
      const t = Math.min(ux === 0 ? Infinity : x / Math.abs(ux), uy === 0 ? Infinity : y / Math.abs(uy));
      const px = ux * t;
      const py = uy * t;
      const r = cornerRadius(shape, w, h);
      if (r > 0 && Math.abs(px) > x - r + 1e-9 && Math.abs(py) > y - r + 1e-9) {
        // The ray leaves through a rounded corner: meet that corner's circle instead.
        const cx = Math.sign(px) * (x - r);
        const cy = Math.sign(py) * (y - r);
        const along = ux * cx + uy * cy;
        const s = along + Math.sqrt(Math.max(0, along * along - (cx * cx + cy * cy - r * r)));
        return [ux * s, uy * s];
      }
      return [px, py];
    }
  }
}

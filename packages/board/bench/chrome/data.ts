/**
 * The boards the Chrome bench puts on screen: built here with the board's own core (no canvas), then pasted into the
 * studio as a board copy (`clipboardText`) or opened as a document (`saveBoard`). Strokes sit in a grid of 100 columns,
 * 60 units apart and 50 rows apart, so a board of 10,000 shapes is 6,000 by 5,000 units.
 */
import { BoardCore, clipboardText, copySelection, keysBetween, saveBoard } from '../../src/index';
import type { BoardResult, ShapeRecord } from '../../src/index';

export type Mix = 'mixed' | 'strokes' | 'boxes';

const must = <T>(r: BoardResult<T>): T => {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
};

/** The wavy points of one stroke: `points` points across 40 units. */
function strokePoints(points: number, seed: number): Float32Array {
  const pts = new Float32Array(points * 3);
  for (let k = 0; k < points; k++) {
    pts[k * 3] = (k * 40) / points;
    pts[k * 3 + 1] = 12 * Math.sin(k / 3 + seed) + 15;
    pts[k * 3 + 2] = 0.3 + 0.6 * ((k % 7) / 7);
  }
  return pts;
}

/** `count` shapes on the board's current page: strokes of 16 points, and in a mix also rects, ellipses, text and sticky notes. */
function fill(core: BoardCore, count: number, mix: Mix): string[] {
  const page = core.pages.current as string;
  const idx = must(keysBetween(null, null, count));
  const ids: string[] = [];
  must(
    core.store.change(
      'host',
      (tx) => {
        for (let i = 0; i < count; i++) {
          const id = tx.newId('shape');
          ids.push(id);
          const slot = mix === 'strokes' ? 0 : i % 20;
          const base = { id, page, x: (i % 100) * 60, y: Math.floor(i / 100) * 50, rotation: 0, parent: null, index: idx[i] as string, locked: false, opacity: 1, meta: {} };
          if (slot < 14) {
            must(tx.put({ ...base, kind: 'ink', props: { points: strokePoints(16, i), stride: 3, nib: 'pen', size: 3, color: '#1f2430', opacity: 1 } }));
          } else if (slot < 16) {
            must(tx.put({ ...base, kind: 'rect', props: { w: 40, h: 30, fill: '#ffe08a', stroke: '#1f2430', dash: 'solid', size: 3, label: '', font: 'sans' } }));
          } else if (slot < 18) {
            must(tx.put({ ...base, kind: 'ellipse', props: { w: 40, h: 30, fill: '#bfe3ff', stroke: '#1f2430', dash: 'solid', size: 3, label: '', font: 'sans' } }));
          } else if (slot === 18 && mix === 'mixed') {
            must(tx.put({ ...base, kind: 'text', props: { text: 'x = 2', size: 18 } }));
          } else if (mix === 'mixed') {
            must(tx.put({ ...base, kind: 'sticky', props: { text: 'note' } }));
          } else {
            must(tx.put({ ...base, kind: 'rect', props: { w: 40, h: 30, fill: '#ffe08a', stroke: '#1f2430', dash: 'solid', size: 3, label: '', font: 'sans' } }));
          }
        }
      },
      { history: false },
    ),
  );
  return ids;
}

function headless(): BoardCore {
  return must(BoardCore.create({}));
}

/** The text of a copy of `count` shapes, for a paste into a board. */
export function copyOf(count: number, mix: Mix): string {
  const core = headless();
  const ids = fill(core, count, mix);
  const text = must(clipboardText(core, must(copySelection(core, ids))));
  core.dispose();
  return text;
}

/** The text of a board document of `count` shapes, for opening. */
export function documentOf(count: number, mix: Mix): string {
  const core = headless();
  fill(core, count, mix);
  const text = must(saveBoard(core.store));
  core.dispose();
  return text;
}

export type { ShapeRecord };

/** Small reads of a document: where the figures are. */
import type { Node as PmNode } from '@tiptap/pm/model';

export const FIGURE_NAME = 'incantlyFigure';
export const FORMULA_NAME = 'incantlyFormula';

export interface FoundFigure {
  readonly node: PmNode;
  readonly pos: number;
}

/** Every figure node in document order. Text blocks are not entered, so a long document costs one pass over blocks. */
export function figuresIn(doc: PmNode): FoundFigure[] {
  const out: FoundFigure[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === FIGURE_NAME) {
      out.push({ node, pos });
      return false;
    }
    return !node.isTextblock;
  });
  return out;
}

export function findFigure(doc: PmNode, id: string): FoundFigure | undefined {
  let found: FoundFigure | undefined;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === FIGURE_NAME) {
      if (node.attrs['id'] === id) found = { node, pos };
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}

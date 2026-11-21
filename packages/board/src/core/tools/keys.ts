/**
 * The keys that edit the selection whatever tool is chosen (ui.md): duplicate, group, ungroup, order, nudge with the
 * arrows, Enter to type in a shape, select all. Copy, cut and paste are the web view's: they go through the system
 * clipboard. A key is used only when it has something to act on, and never while text is being typed.
 */
import { duplicateShapes } from '../clipboard';
import { groupShapes, orderShapes, translateShapes, ungroupShapes } from '../edit';
import type { KeyInput } from '../input';
import { expandGroups } from '../shapes';
import type { ToolContext } from './def';

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** True when the key edited the selection. */
export function editKey(ctx: ToolContext, k: KeyInput): boolean {
  const { core } = ctx;
  if (!k.down || core.editor.state !== 'closed') return false;
  const ids = core.selection.ids;
  const key = k.key.toLowerCase();
  const done = (): true => {
    ctx.requestFrame();
    return true;
  };
  if (k.mod && key === 'a' && !k.shift) {
    const page = core.pages.current;
    if (page === null) return false;
    core.selection.set(expandGroups(core.store, core.store.shapesOn(page).filter((s) => !s.locked && s.kind !== 'group').map((s) => s.id)));
    return done();
  }
  if (ids.length === 0) return false;
  if (k.mod && key === 'd') {
    const copies = duplicateShapes(core, ids);
    if (copies.ok) core.selection.set(copies.value);
    return done();
  }
  if (k.mod && key === 'g') {
    const grouped = k.shift ? ungroupShapes(core, ids) : groupShapes(core, ids);
    if (grouped.ok) core.selection.set(grouped.value);
    return done();
  }
  if (k.key === ']' || k.key === '[') {
    orderShapes(core, ids, k.mod ? (k.key === ']' ? 'front' : 'back') : k.key === ']' ? 'forward' : 'backward');
    return done();
  }
  const arrow = ARROWS[k.key];
  if (arrow !== undefined && !k.mod) {
    const step = k.shift ? 10 : 1;
    translateShapes(core, ids, arrow[0] * step, arrow[1] * step);
    return done();
  }
  if (k.key === 'Enter' && !k.mod && ids.length === 1) {
    const id = ids[0] as string;
    const shape = core.store.get(id);
    if (shape !== undefined && core.store.kinds.get((shape as { kind: string }).kind)?.text !== undefined) {
      core.editor.open(id);
      return done();
    }
  }
  return false;
}

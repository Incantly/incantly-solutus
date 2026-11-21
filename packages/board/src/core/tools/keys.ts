/**
 * The keys that edit the selection whatever tool is chosen (ui.md): duplicate, group, ungroup, order, select all (all
 * through the key map, so a host can move or remove them), and the fixed ones: nudge with the arrows, Enter to type in a
 * shape or to use a figure card. Copy, cut and paste are the web view's: they go through the system clipboard. A key is
 * used only when it has something to act on, and never while text is being typed.
 */
import { duplicateShapes } from '../clipboard';
import { groupShapes, orderShapes, translateShapes, ungroupShapes } from '../edit';
import type { KeyInput } from '../input';
import { ACTION_KEYS, KeyMap } from '../keymap';
import { expandGroups, shapeOf } from '../shapes';
import type { ToolContext } from './def';

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The actions `editAction` carries out. */
export const EDIT_ACTIONS: readonly string[] = ['selectAll', 'duplicate', 'group', 'ungroup', 'forward', 'backward', 'front', 'back'];

const defaultMap = KeyMap.from(ACTION_KEYS);

/** Carries out one of `EDIT_ACTIONS` on the selection. True when it did something (or had the key's meaning). */
export function editAction(ctx: ToolContext, action: string): boolean {
  const { core } = ctx;
  if (core.editor.state !== 'closed') return false;
  const ids = core.selection.ids;
  const done = (): true => {
    ctx.requestFrame();
    return true;
  };
  if (action === 'selectAll') {
    const page = core.pages.current;
    if (page === null) return false;
    core.selection.set(expandGroups(core.store, core.store.shapesOn(page).filter((s) => !s.locked && s.kind !== 'group').map((s) => s.id)));
    return done();
  }
  if (ids.length === 0) return false;
  if (action === 'duplicate') {
    const copies = duplicateShapes(core, ids);
    if (copies.ok) core.selection.set(copies.value);
    return done();
  }
  if (action === 'group' || action === 'ungroup') {
    const grouped = action === 'ungroup' ? ungroupShapes(core, ids) : groupShapes(core, ids);
    if (grouped.ok) core.selection.set(grouped.value);
    return done();
  }
  if (action === 'forward' || action === 'backward' || action === 'front' || action === 'back') {
    orderShapes(core, ids, action === 'forward' ? 'forward' : action === 'backward' ? 'backward' : action === 'front' ? 'front' : 'back');
    return done();
  }
  return false;
}

/** True when the key edited the selection. `keys` is the board's key map; the defaults when it is not given. */
export function editKey(ctx: ToolContext, k: KeyInput, keys: KeyMap = defaultMap): boolean {
  const { core } = ctx;
  if (!k.down || core.editor.state !== 'closed') return false;
  const action = keys.actionOf(k);
  if (action !== undefined && EDIT_ACTIONS.includes(action) && editAction(ctx, action)) return true;
  const ids = core.selection.ids;
  if (ids.length === 0) return false;
  const arrow = ARROWS[k.key];
  if (arrow !== undefined && !k.mod) {
    const step = k.shift ? 10 : 1;
    translateShapes(core, ids, arrow[0] * step, arrow[1] * step);
    ctx.requestFrame();
    return true;
  }
  if (k.key === 'Enter' && !k.mod && ids.length === 1) {
    const id = ids[0] as string;
    const shape = shapeOf(core.store, id);
    if (shape !== undefined && core.store.kinds.get(shape.kind)?.text !== undefined) {
      core.editor.open(id);
      ctx.requestFrame();
      return true;
    }
    // a shape with no text of its own (a figure card) is used, not typed in
    if (shape !== undefined && ctx.activate?.(id) === true) {
      ctx.requestFrame();
      return true;
    }
  }
  return false;
}

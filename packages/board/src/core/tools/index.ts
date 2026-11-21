/** The tools of the board and the lists a host filters (design 10). `defaultTools` is every built-in tool; `inkTools` is the ink tools and the hand. */
import { ToolList } from './def';
import { eraserTool } from './eraser';
import { handTool } from './hand';
import { highlighterTool, penTool } from './pen';
import { laserTool } from './laser';
import { lassoTool } from './lasso';
import { arrowTool, diamondTool, ellipseTool, frameTool, lineTool, rectTool, starTool, stickyTool, textTool, triangleTool } from './shape';
import { selectTool } from './select';

export { ToolList, createOverlayState, defaultStyles } from './def';
export type { OverlayState, ShapeStyle, ToolContext, ToolDef, ToolHandlers, ToolStyles } from './def';
export { ERASER_MACHINE, eraserTool } from './eraser';
export { HAND_MACHINE, handTool } from './hand';
export { LASER_FADE_MS, LASER_MACHINE, LASER_MAX_POINTS, laserTool } from './laser';
export { LASSO_MACHINE, lassoTool } from './lasso';
export { highlighterTool, penTool } from './pen';
export { TOOLS_MACHINE, ToolHost } from './host';
export { SELECT_MACHINE, selectTool } from './select';
export {
  SHAPE_TOOLS, SHAPE_TOOL_MACHINE, arrowTool, diamondTool, ellipseTool, frameTool, lineTool, rectTool, starTool, stickyTool, styledDefaults, textTool, triangleTool,
} from './shape';
export { EDIT_ACTIONS, editAction, editKey } from './keys';

/** The ink tools and the hand (the tools of round 2): the list for a board that draws and nothing else. */
export const inkTools: ToolList = new ToolList([penTool, highlighterTool, eraserTool, laserTool, lassoTool, handTool]);

/**
 * Every built-in tool, in ui.md's order (Select, Hand, the ink tools, then Rect, Ellipse, Arrow, Line, Text, Sticky,
 * Frame; the board view puts Triangle, Diamond and Star in the More shapes menu). A host takes some away with `without`
 * and adds its own with `with`. The same tools as `SHAPE_TOOLS`, which is in the order of the shapes' own table.
 */
export const defaultTools: ToolList = new ToolList([
  selectTool, handTool, penTool, highlighterTool, eraserTool, laserTool, lassoTool,
  rectTool, ellipseTool, arrowTool, lineTool, textTool, stickyTool, frameTool, triangleTool, diamondTool, starTool,
]);

/** The tools of the board and the lists a host filters (design 10). `defaultTools` is the ink tools and the hand; `boardTools` adds the select tool and the shape tools. */
import { ToolList } from './def';
import { eraserTool } from './eraser';
import { handTool } from './hand';
import { highlighterTool, penTool } from './pen';
import { laserTool } from './laser';
import { lassoTool } from './lasso';
import { SHAPE_TOOLS } from './shape';
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
export { editKey } from './keys';

/** Every built-in tool; a host takes some away with `without` and adds its own with `with`. */
export const defaultTools: ToolList = new ToolList([penTool, highlighterTool, eraserTool, laserTool, lassoTool, handTool]);

/** `defaultTools` with the select tool and the shape tools: the list the board view shows (design 10, ui.md). */
export const boardTools: ToolList = new ToolList([selectTool, penTool, highlighterTool, eraserTool, laserTool, lassoTool, handTool, ...SHAPE_TOOLS]);

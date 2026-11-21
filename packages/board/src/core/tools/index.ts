/** The tools of the board and the list a host filters (design 10). Round 2 has the ink tools and the hand. */
import { ToolList } from './def';
import { eraserTool } from './eraser';
import { handTool } from './hand';
import { highlighterTool, penTool } from './pen';
import { laserTool } from './laser';
import { lassoTool } from './lasso';

export { ToolList, createOverlayState, defaultStyles } from './def';
export type { OverlayState, ToolContext, ToolDef, ToolHandlers, ToolStyles } from './def';
export { ERASER_MACHINE, eraserTool } from './eraser';
export { HAND_MACHINE, handTool } from './hand';
export { LASER_FADE_MS, LASER_MACHINE, LASER_MAX_POINTS, laserTool } from './laser';
export { LASSO_MACHINE, lassoTool } from './lasso';
export { highlighterTool, penTool } from './pen';
export { TOOLS_MACHINE, ToolHost } from './host';

/** Every built-in tool; a host takes some away with `without` and adds its own with `with`. */
export const defaultTools: ToolList = new ToolList([penTool, highlighterTool, eraserTool, laserTool, lassoTool, handTool]);

/** @incantly/board: the endless, paged board. The core is DOM-free (`@incantly/board/core`); `web/` holds input, painter and the view. */
export * from './core/index';
export { WebInput } from './web/input';
export type { WebInputOptions } from './web/input';
export { BACKEND_MACHINE, FRAME_MACHINE, LIVELAYER_MACHINE, LIVE_LAG, WebPainter } from './web/painter';
export type { PainterStats, WebPainterOptions } from './web/painter';
export { LOOP_MACHINE, PAGEBAR_MACHINE, mountBoardView } from './web/board-view';
export type { BoardView, BoardViewOptions } from './web/board-view';
export { IMAGE_MACHINE } from './web/images';

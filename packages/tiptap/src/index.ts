/** @incantly/tiptap: the Tiptap extension: incantlyFigure and incantlyFormula nodes. */
export { Incantly, resolveOptions } from './extension';
export type { IncantlyStorage } from './extension';
export { IncantlyFigure, canWrite, scriptOfPaste } from './figure-node';
export {
  FIGURE_DEFAULTS, FULL_WIDTH_PX, HEIGHT_MAX, HEIGHT_MIN, SCRIPT_LIMIT, checkAttrs, headerMode, isModeId, isPictureUrl, newFigureId, scriptFits,
} from './attrs';
export type { IncantlyFigureAttrs } from './attrs';
export { isTiptapError, tiptapError } from './errors';
export type { TiptapError, TiptapErrorKind, TiptapResult, TiptapResult as Result } from './errors';
export type { AiEvent, AiRequest, AiTransport, IncantlyTiptapOptions, InsertFigureOptions } from './types';
export { FIGURE_NAME, FORMULA_NAME, figuresIn, findFigure } from './doc';

/** @incantly/ui: Algebra view, toolbars, input bar, sheet, style bar and maths keyboard, as Web Components. */
import { ErrorCardElement } from './error-card';
import { LineEditorElement } from './line-editor';
import { LineListElement } from './line-list';

export { LineEditorElement, PREVIEW_DELAY_MS, ERROR_DELAY_MS, HISTORY_LIMIT } from './line-editor';
export type { SubmitHandler, SubmitResult, SubmittedDetail } from './line-editor';
export { LineListElement, rightSide, rowLabel } from './line-list';
export type {
  CauseLink, LineRow, RowActionDetail, RowControl, RowEditDetail, RowInsertDetail, RowSetDetail, RowSlideDetail, RowState,
} from './line-list';
export { ErrorCardElement, errorNames } from './error-card';
export type { FixDetail, GotoDetail } from './error-card';
export { DARK, LIGHT } from './styles';
export type { Palette } from './styles';
export { reasonText, speak, typeset } from './text';

export const LINE_EDITOR_TAG = 'incantly-line-editor';
export const LINE_LIST_TAG = 'incantly-line-list';
export const ERROR_CARD_TAG = 'incantly-error-card';

/** Registers the language components. Safe to call more than once. */
export function defineLanguageElements(): void {
  if (!customElements.get(LINE_EDITOR_TAG)) customElements.define(LINE_EDITOR_TAG, LineEditorElement);
  if (!customElements.get(LINE_LIST_TAG)) customElements.define(LINE_LIST_TAG, LineListElement);
  if (!customElements.get(ERROR_CARD_TAG)) customElements.define(ERROR_CARD_TAG, ErrorCardElement);
}

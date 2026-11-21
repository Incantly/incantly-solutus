/**
 * The options the studio gives `createBoard` (board design 10): its words come from the app-modes catalogue, and a
 * customised board for a demo (`?board=custom`) that renames a tool, swaps an icon, moves the toolbar to the left and
 * takes a key away. Both are plain data; nothing here reaches into the board.
 */
import type { BoardOptions } from '@incantly/board';
import type { I18n } from '@incantly/modes';

/** The studio's board: tools and keys as they are, the words from the catalogue in the language in use. */
export function studioBoardOptions(i18n: () => I18n | undefined): Pick<BoardOptions, 'translate'> {
  return {
    translate: (key, params) => {
      const catalogue = i18n();
      const full = `board.${key}`;
      return catalogue !== undefined && catalogue.has(full) ? catalogue.t(full, params) : undefined;
    },
  };
}

/** A bin: the eraser's icon in the demo. */
const BIN_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

/**
 * A customised board: the pen is called "Stylo" and drawn with `x`, the eraser has a bin for an icon, the toolbar is a
 * short column on the left with names beside the icons, and the Delete and Backspace keys no longer delete.
 */
export const customBoardOptions: Pick<BoardOptions, 'toolbar' | 'strings' | 'icons' | 'keys' | 'ui' | 'theme'> = {
  toolbar: {
    position: 'left',
    groups: [['select', 'hand', 'pen', 'highlighter', 'eraser'], ['rect', 'ellipse', 'arrow', 'text'], ['figure', 'image'], ['undo', 'redo']],
  },
  strings: { 'tool.pen': 'Stylo', 'tool.eraser': 'Gomme' },
  icons: { eraser: BIN_ICON },
  keys: { pen: 'x', delete: false },
  ui: { labels: true },
  theme: { base: 'light', vars: { accent: '#0d9488', 'accent-soft': '#ccfbf1', 'accent-line': '#5eead4' } },
};

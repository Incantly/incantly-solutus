/**
 * Every visible or spoken string of the board goes through one table (design 10, "Strings"). The order of lookup is the
 * host's own `strings` table, then its `translate` function (the app-modes catalogue: `I18n.t` over `board.<key>`), then
 * the English table below, then the fallback the caller gave (a tool's own label), then the key. `{name}` is filled
 * from the params. No DOM, no timers, no `Date`.
 */

/** The English table. Keys are the names a host's `strings` option uses. */
export const BOARD_STRINGS: Readonly<Record<string, string>> = Object.freeze({
  'tool.select': 'Select',
  'tool.hand': 'Hand',
  'tool.pen': 'Pen',
  'tool.highlighter': 'Highlighter',
  'tool.eraser': 'Eraser',
  'tool.laser': 'Laser',
  'tool.lasso': 'Lasso',
  'tool.rect': 'Rectangle',
  'tool.ellipse': 'Ellipse',
  'tool.triangle': 'Triangle',
  'tool.diamond': 'Diamond',
  'tool.star': 'Star',
  'tool.line': 'Line',
  'tool.arrow': 'Arrow',
  'tool.text': 'Text',
  'tool.sticky': 'Sticky note',
  'tool.frame': 'Frame',
  'action.image': 'Image',
  'action.fix': 'Fix',
  'action.figure': 'Figure',
  'action.undo': 'Undo',
  'action.redo': 'Redo',
  'action.moreShapes': 'More shapes',
  'action.image.title': 'Add an image (or paste one)',
  'action.fix.title': 'Fix a rough shape: line, circle, polygon or arrow (or hold the pen still for half a second)',
  'action.figure.title': 'Add a figure card (or paste an Incantly script)',
  'toolbar.label': 'Tools',
  'style.label': 'Style',
  'selection.label': 'Selection',
  'pages.label': 'Pages',
  'pages.add': 'Add a page',
  'pages.menu': 'Page menu',
  'zoom.label': 'Zoom',
  'zoom.in': 'Zoom in',
  'zoom.out': 'Zoom out',
  'zoom.reset': 'Zoom to 100%',
  'zoom.fit': 'Zoom to fit',
  'zoom.selection': 'Zoom to selection',
  'menu.main': 'Main menu',
  'menu.context': 'Board menu',
  'menu.pageOf': 'Menu of {name}',
  'page.rename': 'Rename',
  'page.duplicate': 'Duplicate',
  'page.delete': 'Delete',
  'page.background': 'Background',
  'page.renamePrompt': 'Name of the page',
  'background.none': 'Plain',
  'background.grid': 'Grid',
  'background.dots': 'Dots',
  'background.lines': 'Lines',
  'selection.duplicate': 'Duplicate',
  'selection.group': 'Group',
  'selection.ungroup': 'Ungroup',
  'selection.lock': 'Lock',
  'selection.flipH': 'Flip H',
  'selection.flipV': 'Flip V',
  'selection.front': 'Front',
  'selection.back': 'Back',
  'selection.align': 'Align',
  'selection.distribute': 'Distribute',
  'selection.delete': 'Delete',
  'menu.selectAll': 'Select all',
  'menu.paste': 'Paste',
  'menu.zoomFit': 'Zoom to fit',
  'menu.addFigure': 'Add a figure card here',
  'menu.save': 'Save the board',
  'card.editLines': 'Edit lines',
  'card.mode': 'Mode',
  'card.play': 'Play',
  'card.pause': 'Pause',
  'card.delete': 'Delete',
  'card.apply': 'Apply',
  'card.close': 'Close',
  'card.live': 'Use the figure (Esc to leave)',
  'card.failed': 'Figure unavailable',
  'card.linesFailed': '{n} lines have errors',
  'card.label': 'Figure card, {mode}',
  'board.label': 'Board',
  'note.noFix': 'No clean shape fits that stroke.',
});

/** A function that gives a catalogue's text for a key, or undefined when it has none. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string | undefined;

export class Strings {
  readonly #table: Readonly<Record<string, string>>;
  readonly #translate: Translate | undefined;

  constructor(table: Readonly<Record<string, string>> = {}, translate?: Translate) {
    this.#table = table;
    this.#translate = translate;
  }

  /** The text of `key`. `fallback` is used when no table has the key (a tool's own label). */
  t(key: string, fallback?: string, params: Readonly<Record<string, string | number>> = {}): string {
    let text: string | undefined = Object.prototype.hasOwnProperty.call(this.#table, key) ? this.#table[key] : undefined;
    if (text === undefined && this.#translate !== undefined) {
      try {
        text = this.#translate(key, params);
      } catch {
        text = undefined;
      }
    }
    // then the English table, then the caller's own words (a tool's label: a tool the board does not know keeps it), then the key
    if (text === undefined) text = (Object.prototype.hasOwnProperty.call(BOARD_STRINGS, key) ? BOARD_STRINGS[key] : undefined) ?? fallback ?? key;
    return text.replace(/\{(\w+)\}/g, (all, name: string) => (params[name] !== undefined ? String(params[name]) : all));
  }
}

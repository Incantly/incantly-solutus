/**
 * The customisable shell resolved (design 10): the host's options for the toolbar, icons, keys, menus, strings, theme and
 * parts are checked once, here, and the view reads the result. A wrong entry is reported through `report` and left out; it
 * never stops the board (`tool_unknown`, `icon_invalid`, `shortcut_conflict`).
 */
import { boardError } from '../../core/errors';
import type { BoardError } from '../../core/errors';
import { checkIcon } from '../../core/icons';
import type { TouchDraws } from '../../core/input';
import { ACTION_KEYS, KeyMap, defaultKeyTable } from '../../core/keymap';
import type { KeyOptions } from '../../core/keymap';
import { Strings } from '../../core/strings';
import type { Translate } from '../../core/strings';
import { SHAPE_TOOLS } from '../../core/tools/shape';
import type { ToolList } from '../../core/tools/def';
import type { MenuFns } from './menus';
import { themeVars } from './theme';
import type { ThemeOption } from './theme';

export type ToolbarPosition = 'top' | 'bottom' | 'left' | 'right' | 'none';
/** A function that makes an icon element for a tool or action. */
export type IconFactory = (doc: Document) => Element;

/** The buttons of the toolbar that are not tools. */
export const TOOLBAR_ACTIONS: readonly string[] = ['image', 'figure', 'figures', 'graph', 'geometry', 'scientific', 'probability', 'space', 'fix', 'undo', 'redo', 'more-shapes'];
/** A figure button and the mode its card opens in. `figure` stays for a host who names it. */
export const FIGURE_ACTIONS: readonly { readonly id: string; readonly mode: string }[] = [
  { id: 'graph', mode: 'graphing' },
  { id: 'geometry', mode: 'geometry' },
  { id: 'scientific', mode: 'scientific' },
  { id: 'probability', mode: 'probability' },
  { id: 'space', mode: 'graphing3d' },
];
/** The shapes the More shapes menu holds when the rectangle is on the toolbar. */
export const MORE_SHAPES: readonly string[] = ['triangle', 'diamond', 'star'];

/** The parts of the board's own interface a host can turn off. */
export interface UiParts {
  readonly pages: boolean;
  readonly zoom: boolean;
  readonly styleBar: boolean;
  readonly selectionBar: boolean;
  /** Undo and redo on the toolbar. */
  readonly history: boolean;
  readonly mainMenu: boolean;
  /** Show each tool's name beside its icon (a vertical toolbar has room for it). Default false. */
  readonly labels: boolean;
}

export interface ShellOptions {
  readonly toolbar?: { readonly position?: ToolbarPosition; readonly groups?: readonly (readonly string[])[] };
  readonly icons?: Readonly<Record<string, string | IconFactory>>;
  readonly keys?: KeyOptions;
  readonly menus?: MenuFns;
  readonly strings?: Readonly<Record<string, string>>;
  readonly translate?: Translate;
  readonly theme?: ThemeOption;
  readonly ui?: Partial<UiParts>;
  readonly pen?: { readonly touchDraws?: TouchDraws };
  readonly readOnly?: boolean;
  /** True on a Mac: key names are shown as symbols. Default from the page's platform. */
  readonly mac?: boolean;
}

export interface Shell {
  readonly position: ToolbarPosition;
  /** Tool and action ids, group by group. Every id is a tool of the list or one of `TOOLBAR_ACTIONS`. */
  readonly groups: readonly (readonly string[])[];
  /** The icons the host gave that passed the check. */
  readonly icons: ReadonlyMap<string, string | IconFactory>;
  readonly keys: KeyMap;
  readonly strings: Strings;
  readonly menus: MenuFns;
  readonly ui: UiParts;
  readonly theme: { readonly name: string; readonly vars: Readonly<Record<string, string>> };
  readonly touchDraws: TouchDraws | undefined;
  readonly readOnly: boolean;
  readonly mac: boolean;
}

const POSITIONS: readonly ToolbarPosition[] = ['top', 'bottom', 'left', 'right', 'none'];
const DEFAULT_UI: UiParts = { pages: true, zoom: true, styleBar: true, selectionBar: true, history: true, mainMenu: true, labels: false };

/** The groups the toolbar has when the host gives none, in `ui.md` order, from the tools in the list. */
export function defaultGroups(tools: ToolList): readonly (readonly string[])[] {
  const ids = tools.ids();
  const shapeIds = new Set(SHAPE_TOOLS.map((t) => t.id));
  const hasMore = ids.includes('rect') && ids.some((id) => MORE_SHAPES.includes(id));
  const plain = ids.filter((id) => !shapeIds.has(id) && id !== 'ask');
  const shapes: string[] = [];
  for (const id of ids) {
    if (!shapeIds.has(id) || (hasMore && MORE_SHAPES.includes(id))) continue;
    shapes.push(id);
    if (hasMore && id === 'rect') shapes.push('more-shapes');
  }
  // Ask comes after the Figures menu (ui.md, Layout). A host who names graph, geometry, scientific, probability or space still gets that button.
  return [plain, shapes, ['image', 'figures', 'fix', ...(ids.includes('ask') ? ['ask'] : [])], ['undo', 'redo']].filter((g) => g.length > 0);
}

const closeNames = (id: string, known: readonly string[]): string[] => known.filter((k) => k.startsWith(id.slice(0, 1))).slice(0, 4);

/** Checks the host's options. Every wrong entry goes to `report` and is left out. */
export function resolveShell(options: ShellOptions, tools: ToolList, report: (error: BoardError) => void): Shell {
  const known = [...tools.ids(), ...TOOLBAR_ACTIONS];
  // toolbar
  const position = options.toolbar?.position !== undefined && POSITIONS.includes(options.toolbar.position) ? options.toolbar.position : 'bottom';
  if (options.toolbar?.position !== undefined && !POSITIONS.includes(options.toolbar.position)) {
    report(boardError('bad_argument', `The toolbar position "${String(options.toolbar.position)}" is not one of ${POSITIONS.join(', ')}.`, { detail: { position: options.toolbar.position } }));
  }
  let groups: readonly (readonly string[])[];
  if (options.toolbar?.groups === undefined) {
    groups = defaultGroups(tools);
  } else {
    const out: string[][] = [];
    for (const group of options.toolbar.groups) {
      const kept: string[] = [];
      for (const id of Array.isArray(group) ? group : []) {
        if (known.includes(id)) kept.push(id);
        else {
          const close = closeNames(String(id), known);
          report(
            boardError('tool_unknown', `The toolbar names "${String(id)}", which is not a tool.`, {
              hint: close.length > 0 ? `Did you mean ${close.join(', ')}?` : `The tools are ${tools.ids().join(', ')}.`,
              detail: { tool: id },
            }),
          );
        }
      }
      if (kept.length > 0) out.push(kept);
    }
    groups = out;
  }
  // icons: SVG text is checked before it is ever put on the page
  const icons = new Map<string, string | IconFactory>();
  for (const [id, spec] of Object.entries(options.icons ?? {})) {
    if (typeof spec === 'function') {
      icons.set(id, spec);
      continue;
    }
    const checked = checkIcon(id, spec);
    if (checked.ok) icons.set(id, checked.value);
    else report(checked);
  }
  // keys
  const defaults = defaultKeyTable(tools);
  const keys = KeyMap.from(defaults, options.keys ?? {}, report);
  for (const error of keys.errors) report(error);
  for (const action of Object.keys(options.keys ?? {})) {
    if (!(action in defaults) && !(action in ACTION_KEYS)) {
      report(boardError('bad_argument', `The keys name "${action}", which is not a tool or an action.`, { hint: `The actions are ${Object.keys(ACTION_KEYS).join(', ')}.`, detail: { action } }));
    }
  }
  const theme = themeVars(options.theme);
  const mac = options.mac ?? (typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform));
  return {
    position,
    groups,
    icons,
    keys,
    strings: new Strings(options.strings ?? {}, options.translate),
    menus: options.menus ?? {},
    ui: { ...DEFAULT_UI, ...options.ui },
    theme,
    touchDraws: options.pen?.touchDraws,
    readOnly: options.readOnly === true,
    mac,
  };
}

/** The tools a read-only board keeps: the hand and the laser. */
export const READ_ONLY_TOOLS: readonly string[] = ['hand', 'laser'];

/** `tools` as the board uses them: a read-only board keeps only the hand and the laser. */
export function toolsFor(tools: ToolList, readOnly: boolean): ToolList {
  return readOnly ? tools.without(...tools.ids().filter((id) => !READ_ONLY_TOOLS.includes(id))) : tools;
}

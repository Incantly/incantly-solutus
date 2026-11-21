/**
 * `createBoard(options)` (design 10): the one call a host makes. Tools, toolbar, icons, keys, menus, strings, theme, parts,
 * the pen, limits and read-only are all options; every option is checked once and a wrong entry is reported through
 * `onError` and left out (`tool_unknown`, `icon_invalid`, `shortcut_conflict`), never thrown. With no `container` it makes
 * the headless core: the store, the pages, the tools and the key map, for a server, a test or a host's own screen.
 */
import { BoardCore, registerBuiltInKinds } from '../core/board';
import type { BoardError, BoardResult } from '../core/errors';
import { ok } from '../core/errors';
import { loadBoard, saveBoard } from '../core/file';
import { KindRegistry } from '../core/kinds/def';
import type { Limits } from '../core/types';
import { ToolHost } from '../core/tools/host';
import { boardTools, createOverlayState, defaultStyles } from '../core/tools/index';
import type { ToolContext, ToolList } from '../core/tools/index';
import { mountBoardView } from './board-view';
import type { BoardView } from './board-view';
import { resolveShell, toolsFor } from './ui/shell';
import type { Shell, ShellOptions } from './ui/shell';

export interface BoardOptions extends ShellOptions {
  /** Where the board goes on the page (web only); omit for the headless core. */
  readonly container?: HTMLElement;
  /** A saved board (the text of a `.incantly-board` file); a new board with one page when omitted. */
  readonly document?: string;
  /** The tools; default `boardTools`. `defaultTools.without('star').with(myTool)` filters and extends a list. */
  readonly tools?: ToolList;
  /** Lower limits than the defaults (design 4). */
  readonly limits?: Partial<Limits>;
  /** Told of every error the board can only report: a bad option, `render_failed`, `figure_failed`. */
  readonly onError?: (error: BoardError) => void;
  /** Draw with Canvas 2D only. */
  readonly canvas2dOnly?: boolean;
}

export interface Board {
  readonly core: BoardCore;
  readonly host: ToolHost;
  /** The checked customisation. */
  readonly shell: Shell;
  /** The view; undefined for a headless board. */
  readonly view: BoardView | undefined;
  /** The board's element on the page; undefined for a headless board. */
  readonly element: HTMLElement | undefined;
  /** The chosen tool's id. */
  readonly tool: string;
  /** Chooses a tool. `tool_unknown` (also sent to `onError`) when the id is not in the tool list. */
  setTool(id: string): BoardResult<undefined>;
  /** The whole board as the text of a `.incantly-board` file. */
  save(): BoardResult<string>;
  dispose(): void;
}

/** A tool context with no screen: no camera drawing, no frames. The tools still run on the core. */
function headlessContext(core: BoardCore): ToolContext {
  return {
    core,
    styles: defaultStyles(),
    overlay: createOverlayState(),
    camera: () => core.camera,
    requestFrame: () => undefined,
    strokeEnded: () => undefined,
    strokeDropped: () => undefined,
  };
}

/** Makes a board. Returns an error (never throws) when the saved board cannot be read. */
export function createBoard(options: BoardOptions = {}): BoardResult<Board> {
  const report = (e: BoardError): void => {
    try {
      options.onError?.(e);
    } catch {
      // a host's listener that throws does not stop the board
    }
  };
  const tools = toolsFor(options.tools ?? boardTools, options.readOnly === true);
  const shell = resolveShell(options, tools, report);
  const kinds = new KindRegistry();
  registerBuiltInKinds(kinds);
  let core: BoardCore;
  if (options.document !== undefined) {
    const loaded = loadBoard(options.document, { kinds, ...(options.limits !== undefined ? { limits: options.limits } : {}) });
    if (!loaded.ok) return loaded;
    const made = BoardCore.create({ store: loaded.value.store, onError: report });
    if (!made.ok) return made;
    core = made.value;
  } else {
    const made = BoardCore.create({ kinds, ...(options.limits !== undefined ? { limits: options.limits } : {}), onError: report });
    if (!made.ok) return made;
    core = made.value;
  }
  if (options.container === undefined) {
    const host = new ToolHost(headlessContext(core), tools, options.readOnly === true ? 'hand' : 'pen', shell.keys);
    return ok(boardOf(core, host, shell, undefined, report, () => core.dispose()));
  }
  const mounted = mountBoardView({
    container: options.container,
    core,
    tools,
    shell,
    onError: report,
    ...(options.canvas2dOnly === true ? { canvas2dOnly: true } : {}),
  });
  if (!mounted.ok) return mounted;
  const view = mounted.value;
  return ok(boardOf(core, view.host, shell, view, report, () => {
    view.dispose();
    core.dispose();
  }));
}

function boardOf(core: BoardCore, host: ToolHost, shell: Shell, view: BoardView | undefined, report: (e: BoardError) => void, end: () => void): Board {
  return {
    core,
    host,
    shell,
    view,
    element: view?.element,
    get tool(): string {
      return host.tool;
    },
    setTool: (id) => {
      const done = host.setTool(id);
      if (!done.ok) report(done);
      return done;
    },
    save: () => saveBoard(core.store),
    dispose: end,
  };
}

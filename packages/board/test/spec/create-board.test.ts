/**
 * createBoard and the customisable shell (docs/features/board/design.md 10, ui.md Layout, Keys; errors.md tool_unknown,
 * shortcut_conflict, icon_invalid; requirements R7). Tools, toolbar, icons, keys, menus, strings, theme, ui parts, read
 * only, limits and the headless core, all as options of `createBoard`. Only the public API and the DOM the docs describe.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEMES, addFigure, createBoard, defaultIcon, defaultTools, saveBoard } from '../../src/index';
import type { Board, BoardError, BoardOptions, MenuItem, ToolDef, ToolHandlers } from '../../src/index';
import { installCanvas2d, sample } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { kinds, must, press, stubSize } from './round4-helpers';

let fake: FakeCanvas;
let unsize: () => void;
let container: HTMLElement;
let boards: Board[];
let errors: BoardError[];

beforeEach(() => {
  fake = installCanvas2d();
  unsize = stubSize();
  container = document.createElement('div');
  document.body.append(container);
  boards = [];
  errors = [];
});
afterEach(() => {
  for (const b of boards) b.dispose();
  container.remove();
  unsize();
  fake.restore();
});

/** A board on the page with the host's `onError` collecting errors. */
function mount(options: BoardOptions = {}): Board {
  const made = createBoard({ container, canvas2dOnly: true, onError: (e) => errors.push(e), ...options });
  const board = must(made);
  boards.push(board);
  return board;
}

const root = (b: Board): HTMLElement => b.element as HTMLElement;
const toolbar = (b: Board): HTMLElement | null => root(b).querySelector('.ib-tools');
const toolButton = (b: Board, id: string): HTMLButtonElement | null => root(b).querySelector(`button[data-tool="${id}"]`);
const actionButton = (b: Board, id: string): HTMLButtonElement | null => root(b).querySelector(`button[data-action="${id}"]`);
/** The ids of the buttons in the toolbar row, in order (tools by `data-tool`, others by `data-action`). */
const rowIds = (b: Board): string[] =>
  [...(toolbar(b)?.querySelectorAll<HTMLElement>('button') ?? [])]
    .filter((x) => !x.closest('.ib-more'))
    .map((x) => x.dataset['tool'] ?? x.dataset['action'] ?? '');

const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" data-mine="yes"><path d="M4 4h16v16H4z"/></svg>';

/** A tool a host writes: the same `ToolDef` the built-in tools use. */
function stamp(log: string[] = []): ToolDef {
  return {
    id: 'stamp',
    label: 'Stamp',
    key: 'x',
    create(): ToolHandlers {
      return {
        state: 'idle',
        onDown: () => void log.push('down'),
        onMove: () => void log.push('move'),
        onUp: () => void log.push('up'),
        onCancel: () => void log.push('cancel'),
      };
    },
  };
}

describe('tools (design 10; R7.1, R7.2; errors.md tool_unknown)', () => {
  const ALL = ['select', 'hand', 'pen', 'highlighter', 'eraser', 'laser', 'lasso', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'arrow', 'line', 'text', 'sticky', 'frame'];

  it('design 10 and R7.2: `defaultTools` is the list of every built-in tool, so `defaultTools.without("star")` keeps the others', () => {
    expect(defaultTools.ids()).toEqual(expect.arrayContaining(ALL));
    expect(defaultTools.without('star').ids()).toEqual(expect.arrayContaining(ALL.filter((id) => id !== 'star')));
  });

  it('lists every built-in tool as a ToolDef (id, label, create) that a host can filter', () => {
    expect(defaultTools.ids()).toEqual(expect.arrayContaining(ALL));
    for (const def of defaultTools.defs) {
      expect(typeof def.id).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(typeof def.create).toBe('function');
    }
    const filtered = defaultTools.without('star');
    expect(filtered.ids()).not.toContain('star');
    expect(defaultTools.ids()).toContain('star');
  });

  it('shows only the tools of the list: `defaultTools.without("star").with(myTool)` puts the host tool on the board and drops star', () => {
    const board = mount({ tools: defaultTools.without('star').with(stamp()) });
    expect(toolButton(board, 'stamp')).not.toBeNull();
    expect(toolButton(board, 'star')).toBeNull();
    expect(board.host.tools.map((t) => t.id)).toContain('stamp');
    expect(board.host.tools.map((t) => t.id)).not.toContain('star');
    expect(errors).toEqual([]);
  });

  it('runs a host tool through the same handlers as a built-in one (down, move, up) once it is chosen', () => {
    const log: string[] = [];
    const board = mount({ tools: defaultTools.with(stamp(log)) });
    expect(board.setTool('stamp').ok).toBe(true);
    expect(board.tool).toBe('stamp');
    board.host.sample(sample({ phase: 'down', x: 10, y: 10 }));
    board.host.sample(sample({ phase: 'move', x: 20, y: 20 }));
    board.host.sample(sample({ phase: 'up', x: 20, y: 20 }));
    expect(log).toEqual(['down', 'move', 'up']);
  });

  it('gives a host tool the key it asks for', () => {
    const board = mount({ tools: defaultTools.with(stamp()) });
    expect(press(board, 'x')).toBe(true);
    expect(board.tool).toBe('stamp');
  });

  it('setTool with an id that is not registered returns tool_unknown, tells onError, and keeps the tool', () => {
    const board = mount();
    const done = board.setTool('wand');
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.kind).toBe('tool_unknown');
      expect(typeof done.message).toBe('string');
    }
    expect(kinds(errors)).toContain('tool_unknown');
    expect(board.tool).toBe('pen');
  });

  it('a tool the list left out cannot be chosen', () => {
    const board = mount({ tools: defaultTools.without('star') });
    const done = board.setTool('star');
    expect(done.ok).toBe(false);
    if (!done.ok) expect(done.kind).toBe('tool_unknown');
  });

  it('setTool with a known id chooses it and marks its button pressed', () => {
    const board = mount();
    expect(board.setTool('eraser').ok).toBe(true);
    expect(board.tool).toBe('eraser');
    expect(toolButton(board, 'eraser')?.getAttribute('aria-pressed')).toBe('true');
    expect(toolButton(board, 'pen')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('toolbar (design 10; ui.md Layout; errors.md tool_unknown)', () => {
  it('is at the bottom by default, in the order of ui.md, with triangle, diamond and star in the More shapes menu', () => {
    const board = mount();
    expect(root(board).querySelector('.ib-tools')?.getAttribute('data-position')).toBe('bottom');
    expect(board.shell.position).toBe('bottom');
    expect(rowIds(board)).toEqual([
      'select', 'hand', 'pen', 'highlighter', 'eraser', 'laser', 'lasso',
      'rect', 'more-shapes', 'ellipse', 'arrow', 'line', 'text', 'sticky', 'frame',
      'image', 'figure', 'fix', 'ask', 'undo', 'redo',
    ]);
    for (const id of ['triangle', 'diamond', 'star']) {
      const b = toolButton(board, id);
      expect(b, id).not.toBeNull();
      expect(b?.closest('.ib-more'), id).not.toBeNull();
    }
  });

  it.each(['top', 'bottom', 'left', 'right'] as const)('can be put at %s', (position) => {
    const board = mount({ toolbar: { position } });
    expect(board.shell.position).toBe(position);
    expect(root(board).dataset['toolbar']).toBe(position);
    expect(toolbar(board)).not.toBeNull();
  });

  it('can be hidden (`none`), and the host still chooses tools with setTool', () => {
    const board = mount({ toolbar: { position: 'none' } });
    expect(toolbar(board)).toBeNull();
    expect(board.setTool('hand').ok).toBe(true);
    expect(board.tool).toBe('hand');
  });

  it('builds its buttons from `groups`, in the host order, with a separator between groups', () => {
    const board = mount({ toolbar: { groups: [['select', 'pen', 'highlighter', 'eraser'], ['rect', 'ellipse', 'arrow', 'text'], ['figure']] } });
    expect(rowIds(board)).toEqual(['select', 'pen', 'highlighter', 'eraser', 'rect', 'ellipse', 'arrow', 'text', 'figure']);
    expect(toolbar(board)?.querySelectorAll('.ib-sep').length).toBe(2);
    expect(board.shell.groups).toEqual([['select', 'pen', 'highlighter', 'eraser'], ['rect', 'ellipse', 'arrow', 'text'], ['figure']]);
    expect(errors).toEqual([]);
  });

  it('accepts the buttons image, figure, fix, undo, redo and more-shapes as ids', () => {
    const board = mount({ toolbar: { groups: [['pen', 'rect', 'more-shapes'], ['image', 'figure', 'fix', 'undo', 'redo']] } });
    expect(rowIds(board)).toEqual(['pen', 'rect', 'more-shapes', 'image', 'figure', 'fix', 'undo', 'redo']);
    expect(errors).toEqual([]);
  });

  it('reports an unknown tool id as tool_unknown, names it, and leaves it out of the toolbar', () => {
    const board = mount({ toolbar: { groups: [['pen', 'wand', 'eraser']] } });
    const e = errors.find((x) => x.kind === 'tool_unknown');
    expect(e).toBeDefined();
    expect(e?.ok).toBe(false);
    expect(JSON.stringify(e)).toContain('wand');
    expect(rowIds(board)).toEqual(['pen', 'eraser']);
    expect(board.shell.groups.flat()).not.toContain('wand');
  });

  it('keeps working after an unknown id: the board draws', () => {
    const board = mount({ toolbar: { groups: [['nope', 'pen']] } });
    board.host.sample(sample({ phase: 'down', x: 10, y: 10 }));
    for (let i = 1; i <= 10; i++) board.host.sample(sample({ phase: 'move', x: 10 + i * 10, y: 10 + i * 5, time: i * 8 }));
    board.host.sample(sample({ phase: 'up', x: 110, y: 60, time: 100 }));
    const page = board.core.pages.current as string;
    expect(board.core.store.shapesOn(page).length).toBe(1);
  });

  it('is one row that never wraps (ui.md Layout)', () => {
    mount();
    const css = [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const rule = /\.ib-tools\s*\{[^}]*\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('shows the names beside the icons only when `ui.labels` is on', () => {
    const plain = mount();
    expect(toolButton(plain, 'pen')?.textContent).toBe('');
    plain.dispose();
    boards.pop();
    container.replaceChildren();
    const labelled = mount({ ui: { labels: true } });
    expect(toolButton(labelled, 'pen')?.textContent).toContain('Pen');
  });
});

describe('icons (design 10; errors.md icon_invalid; R7.3)', () => {
  const path = (html: string): string | undefined => /<path d="([^"]+)"/.exec(html)?.[1];

  it('shows SVG text a host gives in place of the built-in icon', () => {
    const board = mount({ icons: { pen: SQUARE } });
    const svg = toolButton(board, 'pen')?.querySelector('svg');
    expect(svg?.getAttribute('data-mine')).toBe('yes');
    expect(errors).toEqual([]);
  });

  it('shows what a factory returns, and gives it the page document', () => {
    let given: Document | undefined;
    const board = mount({
      icons: {
        pen: (doc) => {
          given = doc;
          const el = doc.createElement('span');
          el.className = 'mine';
          el.textContent = 'P';
          return el;
        },
      },
    });
    expect(given).toBe(document);
    expect(toolButton(board, 'pen')?.querySelector('.mine')?.textContent).toBe('P');
  });

  it('replaces the icon of a button that is not a tool (figure) too', () => {
    const board = mount({ icons: { figure: SQUARE } });
    expect(actionButton(board, 'figure')?.querySelector('svg')?.getAttribute('data-mine')).toBe('yes');
  });

  const bad: readonly (readonly [string, string])[] = [
    ['a script element', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['an upper-case script element', '<svg><SCRIPT>alert(1)</SCRIPT></svg>'],
    ['an event attribute', '<svg onload="alert(1)"><path d="M0 0h4v4z"/></svg>'],
    ['an event attribute on a child', '<svg><path onclick="alert(1)" d="M0 0h4v4z"/></svg>'],
    ['an event attribute after a slash', '<svg/onload=alert(1)><path d="M0 0h4v4z"/></svg>'],
    ['a link to another site', '<svg><image href="https://example.com/x.png"/></svg>'],
    ['a link to another site (xlink)', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://example.com/a.svg#b"/></svg>'],
    ['a javascript link', '<svg><a href="javascript:alert(1)"><path d="M0 0h4v4z"/></a></svg>'],
    ['a url() to another site', '<svg><rect width="4" height="4" style="fill:url(https://example.com/p)"/></svg>'],
    ['a foreignObject', '<svg><foreignObject><div>hi</div></foreignObject></svg>'],
    ['text that is not an svg', 'pen'],
    ['an empty string', ''],
  ];

  it.each(bad)('reports icon_invalid for %s, names the tool, and uses the default icon', (_name, svg) => {
    const board = mount({ icons: { pen: svg } });
    const e = errors.find((x) => x.kind === 'icon_invalid');
    expect(e, 'icon_invalid').toBeDefined();
    expect(e?.ok).toBe(false);
    expect(JSON.stringify(e)).toContain('pen');
    const button = toolButton(board, 'pen') as HTMLButtonElement;
    expect(button.innerHTML).not.toMatch(/<script|onload|onclick|example\.com|javascript:/i);
    expect(path(button.innerHTML)).toBe(path(defaultIcon('pen') as string));
    expect(board.shell.icons.has('pen')).toBe(false);
  });

  it('accepts an icon that links only inside itself (a #fragment)', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><path id="a" d="M4 4h16v16H4z"/></defs><use href="#a"/></svg>';
    mount({ icons: { pen: svg } });
    expect(kinds(errors)).not.toContain('icon_invalid');
  });

  it('one bad icon does not stop the others', () => {
    const board = mount({ icons: { pen: '<svg onload="x()"></svg>', eraser: SQUARE } });
    expect(kinds(errors)).toEqual(['icon_invalid']);
    expect(toolButton(board, 'eraser')?.querySelector('svg')?.getAttribute('data-mine')).toBe('yes');
  });

  it('the built-in icons are SVG, one for each default tool', () => {
    for (const id of defaultTools.ids()) {
      const svg = defaultIcon(id);
      expect(svg, id).toBeDefined();
      expect(svg).toMatch(/^<svg[\s>]/);
    }
  });
});

describe('keys (design 10; ui.md Keys; errors.md shortcut_conflict)', () => {
  it('has the default key of every tool as ui.md lists it', () => {
    const board = mount();
    const keys = board.shell.keys;
    const expected: Readonly<Record<string, string>> = {
      select: 'v', hand: 'h', pen: 'p', highlighter: 'shift+p', eraser: 'e', laser: 'k', lasso: 'l',
      rect: 'r', ellipse: 'o', arrow: 'a', line: 'shift+l', text: 't', sticky: 'n', frame: 'f',
      triangle: 'shift+t', diamond: 'd', star: 'shift+s', figure: 'g',
    };
    for (const [action, key] of Object.entries(expected)) expect(keys.keysOf(action), action).toEqual([key]);
    expect(errors).toEqual([]);
  });

  it('has the default keys of the other actions as ui.md lists them', () => {
    const keys = mount().shell.keys;
    expect(keys.keysOf('undo')).toEqual(['mod+z']);
    expect(keys.keysOf('redo')).toEqual(expect.arrayContaining(['mod+shift+z', 'mod+y']));
    expect(keys.keysOf('duplicate')).toEqual(['mod+d']);
    expect(keys.keysOf('delete')).toEqual(expect.arrayContaining(['delete', 'backspace']));
    expect(keys.keysOf('group')).toEqual(['mod+g']);
    expect(keys.keysOf('ungroup')).toEqual(['mod+shift+g']);
    expect(keys.keysOf('forward')).toEqual([']']);
    expect(keys.keysOf('backward')).toEqual(['[']);
    expect(keys.keysOf('front')).toEqual(['mod+]']);
    expect(keys.keysOf('back')).toEqual(['mod+[']);
    expect(keys.keysOf('zoomIn')).toContain('mod+=');
    expect(keys.keysOf('zoomOut')).toEqual(['mod+-']);
    expect(keys.keysOf('zoom100')).toEqual(['shift+0']);
    expect(keys.keysOf('zoomFit')).toEqual(['shift+1']);
    expect(keys.keysOf('zoomSelection')).toEqual(['shift+2']);
    expect(keys.keysOf('nextPage')).toEqual(['mod+pagedown']);
    expect(keys.keysOf('prevPage')).toEqual(['mod+pageup']);
  });

  it('chooses a tool when its key is pressed', () => {
    const board = mount();
    expect(press(board, 'e')).toBe(true);
    expect(board.tool).toBe('eraser');
    expect(press(board, 'p', { shift: true })).toBe(true);
    expect(board.tool).toBe('highlighter');
  });

  it('moves a key: `keys: { pen: "x" }` makes x the pen, and p no longer is', () => {
    const board = mount({ keys: { pen: 'x' } });
    board.setTool('hand');
    press(board, 'p');
    expect(board.tool).toBe('hand');
    press(board, 'x');
    expect(board.tool).toBe('pen');
    expect(board.shell.keys.keysOf('pen')).toEqual(['x']);
    expect(errors).toEqual([]);
  });

  it('gives an action a list of keys', () => {
    const board = mount({ keys: { pen: ['x', 'y'] } });
    board.setTool('hand');
    press(board, 'y');
    expect(board.tool).toBe('pen');
    board.setTool('hand');
    press(board, 'x');
    expect(board.tool).toBe('pen');
  });

  it('removes an action\'s keys with false', () => {
    const board = mount({ keys: { eraser: false } });
    expect(board.shell.keys.keysOf('eraser')).toEqual([]);
    press(board, 'e');
    expect(board.tool).toBe('pen');
    expect(errors).toEqual([]);
  });

  it('removing a key frees it for another action, with no conflict', () => {
    const board = mount({ keys: { eraser: false, pen: 'e' } });
    expect(kinds(errors)).not.toContain('shortcut_conflict');
    press(board, 'e');
    expect(board.tool).toBe('pen');
  });

  it('reports a key used twice as shortcut_conflict, naming both actions, and the later action has no key', () => {
    const board = mount({ keys: { pen: 'x', eraser: 'x' } });
    const e = errors.find((x) => x.kind === 'shortcut_conflict');
    expect(e).toBeDefined();
    expect(e?.ok).toBe(false);
    expect(JSON.stringify(e)).toContain('pen');
    expect(JSON.stringify(e)).toContain('eraser');
    expect(board.shell.keys.keysOf('pen')).toEqual(['x']);
    expect(board.shell.keys.keysOf('eraser')).toEqual([]);
    board.setTool('hand');
    press(board, 'x');
    expect(board.tool).toBe('pen');
  });

  it('lets the host key beat a default: pen on "e" takes the key from the eraser, which is reported and dropped', () => {
    const board = mount({ keys: { pen: 'e' } });
    expect(board.shell.keys.keysOf('pen')).toEqual(['e']);
    expect(board.shell.keys.keysOf('eraser')).toEqual([]);
    const e = errors.find((x) => x.kind === 'shortcut_conflict');
    expect(e).toBeDefined();
    expect(JSON.stringify(e)).toContain('eraser');
  });

  it('reads a key string in any order of modifiers and case: Shift+Mod+P is mod+shift+p', () => {
    const board = mount({ keys: { pen: 'Shift+Mod+P' } });
    expect(board.shell.keys.keysOf('pen')).toEqual(['mod+shift+p']);
    board.setTool('hand');
    press(board, 'p', { mod: true, shift: true });
    expect(board.tool).toBe('pen');
  });

  it('does not throw for a key that does not parse; the key is left out and reported', () => {
    const board = mount({ keys: { pen: 'ctrl+ctrl+p' } });
    expect(errors.length).toBeGreaterThan(0);
    expect(board.shell.keys.keysOf('pen')).toEqual([]);
  });

  it('mod+pagedown and mod+pageup change the page', () => {
    const board = mount();
    const first = board.core.pages.current as string;
    expect(board.view?.addPage().ok).toBe(true);
    const second = board.core.pages.current as string;
    expect(second).not.toBe(first);
    press(board, 'PageUp', { mod: true });
    expect(board.core.pages.current).toBe(first);
    press(board, 'PageDown', { mod: true });
    expect(board.core.pages.current).toBe(second);
  });

  it('mod+pagedown on the last page and mod+pageup on the first stay where they are', () => {
    const board = mount();
    board.view?.addPage();
    const last = board.core.pages.current;
    press(board, 'PageDown', { mod: true });
    expect(board.core.pages.current).toBe(last);
    press(board, 'PageUp', { mod: true });
    press(board, 'PageUp', { mod: true });
    expect(board.core.pages.list()[0]?.id).toBe(board.core.pages.current);
  });

  it('a host can move the page keys', () => {
    const board = mount({ keys: { nextPage: 'mod+alt+n' } });
    board.view?.addPage();
    board.view?.stepPage(-1);
    const first = board.core.pages.current;
    press(board, 'PageDown', { mod: true });
    expect(board.core.pages.current).toBe(first);
    press(board, 'n', { mod: true, alt: true });
    expect(board.core.pages.current).not.toBe(first);
  });

  it('a key the host removes does nothing: undo with false', () => {
    const board = mount({ keys: { undo: false } });
    must(addFigure(board.core, { at: { x: 0, y: 0 } }));
    expect(board.core.history.canUndo).toBe(true);
    press(board, 'z', { mod: true });
    expect(board.core.history.canUndo).toBe(true);
  });

  it('undo and redo use mod+z and mod+shift+z', () => {
    const board = mount();
    const page = board.core.pages.current as string;
    must(addFigure(board.core, { at: { x: 0, y: 0 } }));
    expect(board.core.store.shapesOn(page).length).toBe(1);
    press(board, 'z', { mod: true });
    expect(board.core.store.shapesOn(page).length).toBe(0);
    press(board, 'z', { mod: true, shift: true });
    expect(board.core.store.shapesOn(page).length).toBe(1);
  });
});

describe('menus (design 10; ui.md Layout; B29; R7.1)', () => {
  const surface = (b: Board): HTMLElement => root(b).querySelector('.ib-surface') as HTMLElement;
  const open = (b: Board, kind: 'context' | 'main' | 'page'): HTMLElement | null => {
    if (kind === 'main') actionButton(b, 'main-menu')?.click();
    else if (kind === 'page') actionButton(b, 'page-menu')?.click();
    else surface(b).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    return root(b).querySelector(`[data-menu="${kind}"]`);
  };
  const itemIds = (menu: HTMLElement | null): string[] => [...(menu?.querySelectorAll<HTMLElement>('[data-item]') ?? [])].map((x) => x.dataset['item'] ?? '');

  it('the main menu holds Undo, Redo, Image, Figure, Fix, Zoom to fit and Save, in that order', () => {
    const board = mount();
    const ids = itemIds(open(board, 'main'));
    expect(ids).toEqual(['undo', 'redo', 'image', 'figure', 'fix', 'zoomFit', 'save']);
  });

  it('the page menu holds Rename, Duplicate and Delete, and the paper', () => {
    const board = mount();
    const menu = open(board, 'page');
    const ids = itemIds(menu);
    expect(ids.slice(0, 3)).toEqual(['rename', 'duplicate', 'delete']);
    expect(ids.some((id) => id.includes('grid'))).toBe(true);
    expect(ids.some((id) => id.includes('dots'))).toBe(true);
    expect(ids.some((id) => id.includes('lines'))).toBe(true);
  });

  it('Delete in the page menu is disabled on the last page', () => {
    const board = mount();
    const del = open(board, 'page')?.querySelector<HTMLButtonElement>('[data-item="delete"]');
    expect(del?.disabled).toBe(true);
  });

  it('the context menu always has Select all, Add a figure card here and Zoom to fit', () => {
    const board = mount();
    const ids = itemIds(open(board, 'context'));
    expect(ids).toEqual(expect.arrayContaining(['selectAll', 'figure', 'zoomFit']));
  });

  it('the context menu has the selection\'s commands, enabled only when something is selected', () => {
    const board = mount();
    const empty = open(board, 'context');
    const off = empty?.querySelector<HTMLButtonElement>('[data-item="duplicate"]');
    expect(off === undefined || off === null || off.disabled).toBe(true);
    board.view?.menus.close();
    const id = must(addFigure(board.core, { at: { x: 50, y: 50 } }));
    board.core.selection.set([id]);
    const menu = open(board, 'context');
    expect(menu?.querySelector<HTMLButtonElement>('[data-item="duplicate"]')?.disabled).toBe(false);
  });

  it('`menus.context` adds an item and its run gets the target', () => {
    const calls: unknown[] = [];
    const mine: MenuItem = { id: 'mine', label: 'Mine', run: (t) => void calls.push(t) };
    const board = mount({ menus: { context: (items) => [...items, mine] } });
    const menu = open(board, 'context');
    expect(itemIds(menu).at(-1)).toBe('mine');
    menu?.querySelector<HTMLButtonElement>('[data-item="mine"]')?.click();
    expect(calls.length).toBe(1);
    expect((calls[0] as { kind: string }).kind).toBe('board');
    expect(board.view?.menus.state).toBe('closed');
  });

  it('`menus.main` adds the host\'s New, Open and Export (ui.md Main menu)', () => {
    const items: MenuItem[] = ['new', 'open', 'export'].map((id) => ({ id, label: id, run: () => undefined }));
    const board = mount({ menus: { main: (defaults) => [...items, ...defaults] } });
    expect(itemIds(open(board, 'main')).slice(0, 3)).toEqual(['new', 'open', 'export']);
  });

  it('a menu function can remove and reorder items', () => {
    const board = mount({ menus: { main: (items) => items.filter((i) => i.id !== 'fix').reverse() } });
    const ids = itemIds(open(board, 'main'));
    expect(ids).not.toContain('fix');
    expect(ids[0]).toBe('save');
  });

  it('`menus.page` is built for the page it was opened on', () => {
    let target: { kind: string; page?: string } | undefined;
    const board = mount({ menus: { page: (items, t) => ((target = t), items) } });
    open(board, 'page');
    expect(target?.kind).toBe('page');
    expect(target?.page).toBe(board.core.pages.current);
  });

  it('an item whose enabled() is false is disabled and its run is never called', () => {
    const calls: string[] = [];
    const off: MenuItem = { id: 'off', label: 'Off', enabled: () => false, run: () => void calls.push('run') };
    const board = mount({ menus: { main: (items) => [...items, off] } });
    const b = open(board, 'main')?.querySelector<HTMLButtonElement>('[data-item="off"]');
    expect(b?.disabled).toBe(true);
    b?.click();
    expect(calls).toEqual([]);
  });

  it('a menu function that throws gives the default list and reports it, without throwing', () => {
    const board = mount({
      menus: {
        main: () => {
          throw new Error('boom');
        },
      },
    });
    const ids = itemIds(open(board, 'main'));
    expect(ids).toEqual(['undo', 'redo', 'image', 'figure', 'fix', 'zoomFit', 'save']);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('a menu function that returns a bad list gives the default list and reports it', () => {
    const board = mount({ menus: { main: () => 'nope' as unknown as MenuItem[] } });
    expect(itemIds(open(board, 'main'))).toContain('undo');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('a run that throws is reported and goes no further; the menu has closed', () => {
    const boom: MenuItem = {
      id: 'boom',
      label: 'Boom',
      run: () => {
        throw new Error('bad run');
      },
    };
    const board = mount({ menus: { main: (items) => [...items, boom] } });
    const b = open(board, 'main')?.querySelector<HTMLButtonElement>('[data-item="boom"]');
    expect(() => b?.click()).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(board.view?.menus.state).toBe('closed');
  });

  it('one menu is open at a time: opening the page menu closes the main menu', () => {
    const board = mount();
    open(board, 'main');
    expect(board.view?.menus.state).toBe('main');
    open(board, 'page');
    expect(board.view?.menus.state).toBe('page');
    expect(root(board).querySelectorAll('[data-menu]').length).toBe(1);
  });

  it('a second press on the button closes its menu', () => {
    const board = mount();
    open(board, 'main');
    actionButton(board, 'main-menu')?.click();
    expect(board.view?.menus.state).toBe('closed');
    expect(root(board).querySelector('[data-menu]')).toBeNull();
  });

  it('Esc and a press elsewhere close the menu', () => {
    const board = mount();
    const menu = open(board, 'main') as HTMLElement;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(board.view?.menus.state).toBe('closed');
    open(board, 'main');
    surface(board).dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(board.view?.menus.state).toBe('closed');
  });

  it('the main menu and the context menu are not there on a read-only board', () => {
    const board = mount({ readOnly: true });
    expect(actionButton(board, 'main-menu')).toBeNull();
    expect(open(board, 'context')).toBeNull();
  });
});

describe('strings (design 10)', () => {
  it('shows the host\'s string on the tool button as its name, its spoken name and its tooltip', () => {
    const board = mount({ strings: { 'tool.pen': 'Stylo' } });
    const b = toolButton(board, 'pen') as HTMLButtonElement;
    expect(b.getAttribute('aria-label')).toBe('Stylo');
    expect(b.title).toContain('Stylo');
    expect(toolButton(board, 'eraser')?.getAttribute('aria-label')).toBe('Eraser');
  });

  it('translates the labels of the bars: zoom, pages, board', () => {
    const board = mount({ strings: { 'zoom.in': 'Zoom avant', 'pages.add': 'Ajouter une page', 'board.label': 'Tableau' } });
    expect(root(board).querySelector('[aria-label="Zoom avant"]')).not.toBeNull();
    expect(root(board).querySelector('[aria-label="Ajouter une page"]')).not.toBeNull();
    expect(root(board).querySelector('.ib-surface')?.getAttribute('aria-label')).toBe('Tableau');
  });

  it('asks the translate function when the host table has no entry, and the host table wins over it', () => {
    const asked: string[] = [];
    const board = mount({
      strings: { 'tool.pen': 'Stylo' },
      translate: (key) => {
        asked.push(key);
        return key === 'tool.eraser' ? 'Gomme' : key === 'tool.pen' ? 'Translated pen' : undefined;
      },
    });
    expect(toolButton(board, 'pen')?.getAttribute('aria-label')).toBe('Stylo');
    expect(toolButton(board, 'eraser')?.getAttribute('aria-label')).toBe('Gomme');
    expect(asked).toContain('tool.eraser');
    expect(toolButton(board, 'hand')?.getAttribute('aria-label')).toBe('Hand');
  });

  it('puts a card string through the table, with its values filled in', () => {
    const board = mount();
    expect(board.shell.strings.t('card.linesFailed', undefined, { n: 3 })).toBe('3 lines have errors');
    expect(board.shell.strings.t('card.label', undefined, { mode: 'Graphing' })).toBe('Figure card, Graphing');
  });

  it('looks up the host table, then translate, then the English table, then the key (design 10 order)', () => {
    const board = mount({ strings: { 'a.host': 'H' }, translate: (k) => (k === 'a.tr' ? 'T' : undefined) });
    const s = board.shell.strings;
    expect(s.t('a.host')).toBe('H');
    expect(s.t('a.tr')).toBe('T');
    expect(s.t('tool.rect')).toBe('Rectangle');
    expect(s.t('no.such.key')).toBe('no.such.key');
  });

  it('design 10: a tool\'s own label comes after the English table, so a key the table has is not replaced by the label', () => {
    const s = mount().shell.strings;
    expect(s.t('tool.rect', 'My own label')).toBe('Rectangle');
  });

  it('a tool\'s own label is used when no table has the key', () => {
    const s = mount().shell.strings;
    expect(s.t('tool.mine', 'My own label')).toBe('My own label');
  });

  it('a translate function that throws does not stop the board', () => {
    const board = mount({
      translate: () => {
        throw new Error('bad catalogue');
      },
    });
    expect(toolButton(board, 'pen')?.getAttribute('aria-label')).toBe('Pen');
  });

  it('names a host tool by its own label when no table has it', () => {
    const board = mount({ tools: defaultTools.with(stamp()) });
    expect(toolButton(board, 'stamp')?.getAttribute('aria-label')).toBe('Stamp');
  });
});

describe('theme (design 10; ui.md Accessibility)', () => {
  const contrast = (a: string, b: string): number => {
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  it('has the three built-in themes: light, dark and high contrast', () => {
    expect(Object.keys(THEMES).sort()).toEqual(['dark', 'highContrast', 'light']);
  });

  it('light is the default and puts its variables on the board element', () => {
    const board = mount();
    expect(board.shell.theme.name).toBe('light');
    expect(root(board).dataset['theme']).toBe('light');
    for (const [name, value] of Object.entries(THEMES.light)) expect(root(board).style.getPropertyValue(name), name).toBe(value);
  });

  it.each(['light', 'dark', 'highContrast'] as const)('theme %s sets its own variables', (name) => {
    const board = mount({ theme: name });
    expect(root(board).dataset['theme']).toBe(name);
    expect(root(board).style.getPropertyValue('--ib-bg')).toBe(THEMES[name]['--ib-bg']);
    expect(root(board).style.getPropertyValue('--ib-fg')).toBe(THEMES[name]['--ib-fg']);
  });

  it('the three themes differ in background', () => {
    const bgs = new Set(Object.values(THEMES).map((t) => t['--ib-bg']));
    expect(bgs.size).toBeGreaterThanOrEqual(2);
    expect(THEMES.dark['--ib-bg']).not.toBe(THEMES.light['--ib-bg']);
  });

  it('text on the background has the contrast of its theme: 4.5 at least, 7 for high contrast', () => {
    for (const name of ['light', 'dark'] as const) expect(contrast(THEMES[name]['--ib-fg'] as string, THEMES[name]['--ib-bg'] as string), name).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THEMES.highContrast['--ib-fg'] as string, THEMES.highContrast['--ib-bg'] as string)).toBeGreaterThanOrEqual(7);
  });

  it('a host changes variables over a base theme, with or without the --ib- prefix', () => {
    const board = mount({ theme: { base: 'dark', vars: { accent: '#f59e0b', '--ib-radius': '2px' } } });
    expect(root(board).style.getPropertyValue('--ib-accent')).toBe('#f59e0b');
    expect(root(board).style.getPropertyValue('--ib-radius')).toBe('2px');
    expect(root(board).style.getPropertyValue('--ib-bg')).toBe(THEMES.dark['--ib-bg']);
    expect(root(board).dataset['theme']).toBe('dark');
  });

  it('falls back to light for a theme name it does not know, without an error thrown', () => {
    const board = mount({ theme: 'neon' as never });
    expect(board.shell.theme.name).toBe('light');
  });

  it('has the variables a host can restyle: colours, radius, font, toolbar size', () => {
    const vars = Object.keys(THEMES.light);
    for (const v of ['--ib-radius', '--ib-font', '--ib-tool-size', '--ib-accent', '--ib-bg', '--ib-fg']) expect(vars).toContain(v);
  });
});

describe('ui parts (design 10)', () => {
  it('shows every part by default: pages, zoom, style bar, main menu and the history buttons', () => {
    const board = mount();
    expect(root(board).querySelector('.ib-pages')).not.toBeNull();
    expect(root(board).querySelector('.ib-zoom')).not.toBeNull();
    expect(root(board).querySelector('.ib-style')).not.toBeNull();
    expect(actionButton(board, 'main-menu')).not.toBeNull();
    expect(actionButton(board, 'undo')).not.toBeNull();
  });

  it('`ui.pages: false` takes the page bar away', () => {
    expect(root(mount({ ui: { pages: false } })).querySelector('.ib-pages')).toBeNull();
  });

  it('`ui.zoom: false` takes the zoom bar away', () => {
    expect(root(mount({ ui: { zoom: false } })).querySelector('.ib-zoom')).toBeNull();
  });

  it('`ui.styleBar: false` takes the style bar away', () => {
    expect(root(mount({ ui: { styleBar: false } })).querySelector('.ib-style')).toBeNull();
  });

  it('`ui.selectionBar: false` takes the selection bar away', () => {
    expect(root(mount({ ui: { selectionBar: false } })).querySelector('.ib-actions')).toBeNull();
  });

  it('`ui.history: false` takes undo and redo off the toolbar', () => {
    const board = mount({ ui: { history: false } });
    expect(toolbar(board)?.querySelector('[data-action="undo"]')).toBeNull();
    expect(toolbar(board)?.querySelector('[data-action="redo"]')).toBeNull();
  });

  it('`ui.mainMenu: false` takes the main menu button away', () => {
    expect(actionButton(mount({ ui: { mainMenu: false } }), 'main-menu')).toBeNull();
  });
});

describe('read only (design 10 Read only; R7)', () => {
  it('keeps the hand and the laser and no other tool; starts on the hand', () => {
    const board = mount({ readOnly: true });
    expect(board.host.tools.map((t) => t.id).sort()).toEqual(['hand', 'laser']);
    expect(board.tool).toBe('hand');
    const pen = board.setTool('pen');
    expect(pen.ok).toBe(false);
    expect(board.tool).toBe('hand');
  });

  it('hides the style bar, the selection bar, the edit buttons and the main menu', () => {
    const board = mount({ readOnly: true });
    expect(root(board).querySelector('.ib-style')).toBeNull();
    expect(root(board).querySelector('.ib-actions')).toBeNull();
    for (const id of ['image', 'figure', 'fix', 'undo', 'redo', 'main-menu']) expect(actionButton(board, id), id).toBeNull();
  });

  it('makes no writes from input: a drag with the hand or a pen-like sample draws nothing, and the keys of the other tools do nothing', () => {
    const board = mount({ readOnly: true });
    const page = board.core.pages.current as string;
    board.host.sample(sample({ phase: 'down', x: 10, y: 10 }));
    for (let i = 1; i <= 8; i++) board.host.sample(sample({ phase: 'move', x: 10 + i * 12, y: 10 + i * 4, time: i * 8 }));
    board.host.sample(sample({ phase: 'up', x: 110, y: 50, time: 80 }));
    for (const k of ['p', 'e', 'r', 't']) press(board, k);
    press(board, 'Delete');
    press(board, 'z', { mod: true });
    expect(board.core.store.shapesOn(page).length).toBe(0);
    expect(board.core.history.canUndo).toBe(false);
    expect(board.tool).toBe('hand');
  });

  it('the figure key and the board\'s addFigure refuse on a read-only board', () => {
    const board = mount({ readOnly: true });
    const page = board.core.pages.current as string;
    press(board, 'g');
    expect(board.view?.addFigure().ok).toBe(false);
    expect(board.core.store.shapesOn(page).length).toBe(0);
  });

  it('keeps the hand: it pans the camera', () => {
    const board = mount({ readOnly: true });
    const camera = board.core.camera;
    const x0 = camera?.x ?? 0;
    board.host.sample(sample({ phase: 'down', x: 300, y: 300, device: 'mouse', buttons: 1 }));
    board.host.sample(sample({ phase: 'move', x: 200, y: 300, device: 'mouse', buttons: 1, time: 16 }));
    board.host.sample(sample({ phase: 'up', x: 200, y: 300, device: 'mouse', buttons: 0, time: 32 }));
    expect(board.core.camera?.x).not.toBe(x0);
  });
});

describe('limits (design 10; errors.md limit; R2.4)', () => {
  it('refuses a write over a lowered limit with `limit`, and changes nothing', () => {
    const board = mount({ limits: { shapesPerPage: 2 } });
    const page = board.core.pages.current as string;
    must(addFigure(board.core, { at: { x: 0, y: 0 } }));
    must(addFigure(board.core, { at: { x: 300, y: 0 } }));
    const third = addFigure(board.core, { at: { x: 600, y: 0 } });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.kind).toBe('limit');
    expect(board.core.store.shapesOn(page).length).toBe(2);
  });

  it('a lowered pages limit refuses the next page', () => {
    const board = mount({ limits: { pages: 1 } });
    const added = board.core.pages.addPage();
    expect(added.ok).toBe(false);
    if (!added.ok) expect(added.kind).toBe('limit');
    expect(board.core.pages.list().length).toBe(1);
  });

  it('opens a saved board over a lowered limit (a load never gives `limit`)', () => {
    const source = createBoard();
    const s = must(source);
    for (let i = 0; i < 3; i++) must(addFigure(s.core, { at: { x: i * 300, y: 0 } }));
    const text = must(s.save());
    s.dispose();
    const board = mount({ document: text, limits: { shapesPerPage: 2 } });
    expect(board.core.store.shapesOn(board.core.pages.current as string).length).toBe(3);
    const more = addFigure(board.core, { at: { x: 0, y: 500 } });
    expect(more.ok).toBe(false);
    if (!more.ok) expect(more.kind).toBe('limit');
  });
});

describe('headless createBoard (R7.4)', () => {
  it('returns the core with no container: no view, no element, nothing added to the page', () => {
    const before = document.body.innerHTML;
    const made = createBoard();
    const board = must(made);
    boards.push(board);
    expect(board.view).toBeUndefined();
    expect(board.element).toBeUndefined();
    expect(board.core).toBeDefined();
    expect(board.core.pages.current).not.toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  it('has the tools, the key map and the tool choice', () => {
    const board = must(createBoard());
    boards.push(board);
    expect(board.host.tools.map((t) => t.id)).toEqual(defaultTools.ids());
    expect(board.tool).toBe('pen');
    expect(board.setTool('rect').ok).toBe(true);
    expect(board.tool).toBe('rect');
    expect(board.shell.keys.keysOf('pen')).toEqual(['p']);
  });

  it('draws through the tools with no screen', () => {
    const board = must(createBoard());
    boards.push(board);
    const page = board.core.pages.current as string;
    board.host.sample(sample({ phase: 'down', x: 10, y: 10 }));
    for (let i = 1; i <= 10; i++) board.host.sample(sample({ phase: 'move', x: 10 + i * 10, y: 10 + Math.sin(i) * 20, time: i * 8 }));
    board.host.sample(sample({ phase: 'up', x: 110, y: 10, time: 100 }));
    expect(board.core.store.shapesOn(page).length).toBe(1);
  });

  it('reports a bad tool in `toolbar.groups` through onError with no container, too', () => {
    const seen: BoardError[] = [];
    const board = must(createBoard({ toolbar: { groups: [['pen', 'wand']] }, onError: (e) => seen.push(e) }));
    boards.push(board);
    expect(kinds(seen)).toContain('tool_unknown');
  });

  it('reports a shortcut conflict and an invalid icon with no container, too', () => {
    const seen: BoardError[] = [];
    const board = must(createBoard({ keys: { pen: 'x', eraser: 'x' }, icons: { pen: '<svg onload="x()"/>' }, onError: (e) => seen.push(e) }));
    boards.push(board);
    expect(kinds(seen).sort()).toEqual(['icon_invalid', 'shortcut_conflict']);
  });

  it('opens a saved board and saves it again as the same text', () => {
    const first = must(createBoard());
    must(addFigure(first.core, { at: { x: 5, y: 5 }, script: '# incantly 1\na = 1' }));
    const text = must(first.save());
    first.dispose();
    const again = must(createBoard({ document: text }));
    boards.push(again);
    expect(must(again.save())).toBe(text);
    expect(text).toBe(must(saveBoard(again.core.store)));
  });

  it('answers a bad document with an error, not a throw', () => {
    let made: ReturnType<typeof createBoard> | undefined;
    expect(() => {
      made = createBoard({ document: '{ not json' });
    }).not.toThrow();
    expect(made?.ok).toBe(false);
    if (made !== undefined && !made.ok) expect(['board_invalid', 'board_too_new']).toContain(made.kind);
  });

  it('a read-only headless board starts on the hand and has no drawing tool', () => {
    const board = must(createBoard({ readOnly: true }));
    boards.push(board);
    expect(board.tool).toBe('hand');
    expect(board.host.tools.map((t) => t.id).sort()).toEqual(['hand', 'laser']);
  });

  it('a host\'s onError that throws does not stop createBoard', () => {
    const made = createBoard({
      toolbar: { groups: [['wand']] },
      onError: () => {
        throw new Error('listener failed');
      },
    });
    expect(made.ok).toBe(true);
    if (made.ok) boards.push(made.value);
  });
});

/**
 * The key map (design 10, "Keys"; docs/state-machines.md B30): one map from an action to its key strings. `mod` is Ctrl
 * or Cmd. The host's `keys` option is applied over the defaults; `false` removes an action's keys; a key that two
 * actions ask for is `shortcut_conflict` and the later action goes without it. A map answers lookups only when it is
 * sealed. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { boardError, refusedMove } from './errors';
import type { BoardError, ErrorSink } from './errors';
import type { KeyInput } from './input';
import type { ToolList } from './tools/def';

type MapState = 'building' | 'sealed';
type MapEvent = 'bind' | 'seal' | 'rebind';

export const KEYMAP_MACHINE: MachineTable<MapState, MapEvent> = {
  building: { bind: 'building', seal: 'sealed' },
  sealed: { rebind: 'building' },
};

/** What a host writes for one action: a key string, a list of them, or `false` for none. */
export type KeyOption = string | readonly string[] | false;
export type KeyOptions = Readonly<Record<string, KeyOption>>;

/** The keys of the actions that are not tools (ui.md, Keys). Copy, cut and paste are the system clipboard's; Space, Esc and the arrows are fixed. */
export const ACTION_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  undo: ['mod+z'],
  redo: ['mod+shift+z', 'mod+y'],
  delete: ['delete', 'backspace'],
  selectAll: ['mod+a'],
  duplicate: ['mod+d'],
  group: ['mod+g'],
  ungroup: ['mod+shift+g'],
  forward: [']'],
  backward: ['['],
  front: ['mod+]'],
  back: ['mod+['],
  zoomIn: ['mod+=', 'mod++'],
  zoomOut: ['mod+-'],
  zoom100: ['shift+0'],
  zoomFit: ['shift+1'],
  zoomSelection: ['shift+2'],
  nextPage: ['mod+pagedown'],
  prevPage: ['mod+pageup'],
  figure: ['g'],
});

const ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  plus: '+',
  return: 'enter',
  pgdn: 'pagedown',
  pgup: 'pageup',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
};

const MODIFIERS: Readonly<Record<string, 'mod' | 'shift' | 'alt'>> = { mod: 'mod', ctrl: 'mod', control: 'mod', cmd: 'mod', meta: 'mod', command: 'mod', shift: 'shift', alt: 'alt', option: 'alt' };

/** The digit a shifted symbol key stands for on a US keyboard (`shift+0` arrives as `)`). */
const SHIFTED_DIGIT: Readonly<Record<string, string>> = { ')': '0', '!': '1', '@': '2', '#': '3', $: '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9' };

const combo = (mod: boolean, alt: boolean, shift: boolean, key: string): string => `${mod ? 'mod+' : ''}${shift ? 'shift+' : ''}${alt ? 'alt+' : ''}${key}`;

/** `shift+Mod+P` as `mod+shift+p`; undefined when the text names no key or a modifier twice. */
export function normaliseKey(text: string): string | undefined {
  if (typeof text !== 'string') return undefined;
  const raw = text.trim().toLowerCase();
  if (raw === '') return undefined;
  let key: string;
  let mods: string;
  if (raw === '+') {
    key = '+';
    mods = '';
  } else if (raw.endsWith('++')) {
    key = '+';
    mods = raw.slice(0, -2);
  } else {
    const at = raw.lastIndexOf('+');
    key = at < 0 ? raw : raw.slice(at + 1);
    mods = at < 0 ? '' : raw.slice(0, at);
  }
  key = ALIASES[key] ?? key;
  if (key === '') return undefined;
  let mod = false;
  let shift = false;
  let alt = false;
  for (const part of mods === '' ? [] : mods.split('+')) {
    const m = MODIFIERS[part];
    if (m === undefined) return undefined;
    if (m === 'mod') {
      if (mod) return undefined;
      mod = true;
    } else if (m === 'shift') {
      if (shift) return undefined;
      shift = true;
    } else {
      if (alt) return undefined;
      alt = true;
    }
  }
  if (MODIFIERS[key] !== undefined && key.length > 1) return undefined;
  return combo(mod, alt, shift, key);
}

/** The words for a key string (`mod+shift+z` as `Ctrl+Shift+Z`, or `⌘⇧Z` on a Mac when `mac` is true). */
export function describeKey(key: string, mac = false): string {
  const at = key.endsWith('++') ? key.length - 2 : key.lastIndexOf('+');
  const last = key === '+' ? '+' : at < 0 ? key : key.slice(at + 1) === '' ? '+' : key.slice(at + 1);
  const parts = at < 0 || key === '+' ? [] : key.slice(0, at).split('+');
  const name = last === ' ' ? 'Space' : last.length === 1 ? last.toUpperCase() : last === 'pagedown' ? 'PgDn' : last === 'pageup' ? 'PgUp' : last.charAt(0).toUpperCase() + last.slice(1);
  const out = parts.map((p) => (p === 'mod' ? (mac ? '⌘' : 'Ctrl') : p === 'shift' ? (mac ? '⇧' : 'Shift') : mac ? '⌥' : 'Alt'));
  return mac ? `${out.join('')}${name}` : [...out, name].join('+');
}

/** The default key table: each tool's own key, then `ACTION_KEYS`. */
export function defaultKeyTable(tools: ToolList): Readonly<Record<string, readonly string[]>> {
  const table: Record<string, readonly string[]> = {};
  for (const def of tools.defs) if (def.key !== undefined) table[def.id] = [def.key];
  for (const [action, keys] of Object.entries(ACTION_KEYS)) if (!(action in table)) table[action] = keys;
  return table;
}

const asList = (option: KeyOption): readonly string[] => (option === false ? [] : typeof option === 'string' ? [option] : option);

export class KeyMap {
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(KEYMAP_MACHINE, 'building', refusedMove('key map', () => this.#report));
  readonly #byKey = new Map<string, string>();
  readonly #byAction = new Map<string, string[]>();
  readonly #errors: BoardError[] = [];

  constructor(report?: ErrorSink) {
    this.#report = report;
  }

  /** `building` while bindings are added, `sealed` when the map answers. */
  get state(): MapState {
    return this.#machine.state;
  }

  /** The conflicts and bad key strings found while the map was made. */
  get errors(): readonly BoardError[] {
    return this.#errors;
  }

  /**
   * A sealed map from the defaults and the host's `keys`. The host's actions come first, in the order it wrote them,
   * so its keys beat a default's; a key string asked for twice goes to the first action and the later one is reported.
   */
  static from(defaults: Readonly<Record<string, readonly string[]>>, options: KeyOptions = {}, report?: ErrorSink): KeyMap {
    const map = new KeyMap(report);
    map.#fill(defaults, options);
    map.#machine.send('seal');
    return map;
  }

  /** Opens the map, clears it, and fills it again from new options; the map is sealed again when this returns. */
  rebind(defaults: Readonly<Record<string, readonly string[]>>, options: KeyOptions = {}): void {
    if (!this.#machine.send('rebind')) return;
    this.#byKey.clear();
    this.#byAction.clear();
    this.#errors.length = 0;
    this.#fill(defaults, options);
    this.#machine.send('seal');
  }

  #fill(defaults: Readonly<Record<string, readonly string[]>>, options: KeyOptions): void {
    const wanted = new Map<string, readonly string[]>();
    for (const [action, option] of Object.entries(options)) wanted.set(action, asList(option));
    for (const [action, keys] of Object.entries(defaults)) if (!wanted.has(action)) wanted.set(action, keys);
    for (const [action, keys] of wanted) {
      for (const text of keys) this.#bind(action, text);
      if (!this.#byAction.has(action)) this.#byAction.set(action, []);
    }
  }

  #bind(action: string, text: string): void {
    const key = normaliseKey(text);
    if (key === undefined) {
      this.#errors.push(boardError('bad_argument', `"${text}" is not a key for "${action}".`, { hint: 'Write keys as p, shift+p or mod+z.', detail: { action, key: text } }));
      return;
    }
    if (!this.#machine.send('bind')) return;
    const first = this.#byKey.get(key);
    if (first !== undefined) {
      if (first !== action) {
        this.#errors.push(
          boardError('shortcut_conflict', `The key "${key}" is used by "${first}" and "${action}"; "${action}" has no key.`, {
            hint: `Give "${action}" another key, or remove the key from "${first}".`,
            detail: { key, actions: [first, action] },
          }),
        );
      }
      return;
    }
    this.#byKey.set(key, action);
    const list = this.#byAction.get(action) ?? [];
    list.push(key);
    this.#byAction.set(action, list);
  }

  /** The action a key press stands for, or undefined. Always undefined while the map is `building`. */
  actionOf(k: KeyInput): string | undefined {
    if (!this.#machine.is('sealed')) return undefined;
    const key = k.key.toLowerCase();
    const direct = this.#byKey.get(combo(k.mod, k.alt, k.shift, key));
    if (direct !== undefined || !k.shift) return direct;
    // a symbol typed with Shift (`?`, `)`) is named by its own character or by shift and the digit
    const digit = SHIFTED_DIGIT[key];
    if (digit !== undefined) return this.#byKey.get(combo(k.mod, k.alt, true, digit)) ?? this.#byKey.get(combo(k.mod, k.alt, false, key));
    if (key.length === 1 && !/[a-z0-9]/.test(key)) return this.#byKey.get(combo(k.mod, k.alt, false, key));
    return undefined;
  }

  /** The keys an action has, in `mod+shift+z` form; none when it was removed or lost a conflict. */
  keysOf(action: string): readonly string[] {
    return this.#byAction.get(action) ?? [];
  }

  /** True when the map knows the action (it may have no key). */
  has(action: string): boolean {
    return this.#byAction.has(action);
  }

  /** The actions of the map. */
  actions(): readonly string[] {
    return [...this.#byAction.keys()];
  }
}

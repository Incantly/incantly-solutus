/**
 * The on-screen maths keyboard as data (app-modes design 3.10; ui 7; errors 6): layouts of keys, each with a spoken
 * name. A layout is filtered by the mode's command policy when it is built, so a key for a forbidden command never
 * exists. The screen that draws it lives in the studio.
 */
import type { CommandRef, CompiledPolicy } from './policy';
import type { KeyboardId, LocaleKey } from './types';

export type KeyAction =
  | { readonly kind: 'insert'; readonly text: string; readonly cursor?: number }
  | { readonly kind: 'template'; readonly template: 'fraction' | 'power' | 'square' | 'subscript' | 'root' | 'abs' | 'pair' | 'list' | 'mixed' | 'sum' }
  | { readonly kind: 'command'; readonly name: string }
  | { readonly kind: 'edit'; readonly op: 'backspace' | 'delete' | 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'enter' | 'clear' }
  | { readonly kind: 'shift' }
  | { readonly kind: 'switch'; readonly tab: string }
  | { readonly kind: 'toggle'; readonly what: 'exact' | 'angle' }
  | { readonly kind: 'close' };

export interface Key {
  readonly id: string;
  readonly label: string;
  /** The spoken name. */
  readonly aria: LocaleKey;
  readonly ariaParams?: Readonly<Record<string, string>>;
  readonly action: KeyAction;
  /** The second function, under shift. */
  readonly shifted?: { readonly label: string; readonly aria: LocaleKey; readonly ariaParams?: Readonly<Record<string, string>>; readonly action: KeyAction };
  readonly longPress?: readonly KeyAction[];
  readonly width?: number;
  readonly style?: 'normal' | 'function' | 'action' | 'primary';
}

export interface KeyboardTab {
  readonly id: string;
  readonly label: string;
  readonly aria: LocaleKey;
  readonly rows: readonly (readonly Key[])[];
}

export interface KeyboardLayout {
  readonly id: KeyboardId;
  readonly tabs: readonly KeyboardTab[];
}

/* ------------------------------ key makers ------------------------------ */

const digit = (d: string): Key => ({ id: `d${d}`, label: d, aria: 'kb.digit', ariaParams: { d }, action: { kind: 'insert', text: d } });
const ins = (id: string, label: string, text: string, aria: LocaleKey, style: Key['style'] = 'normal', extra: Partial<Key> = {}): Key => ({ id, label, aria, action: { kind: 'insert', text }, style, ...extra });
const fn = (name: string, label = name, extra: Partial<Key> = {}): Key => ({ id: `fn-${name}`, label, aria: 'kb.fn', ariaParams: { name }, action: { kind: 'insert', text: `${name}()`, cursor: name.length + 1 }, style: 'function', ...extra });
const cmd = (name: string, label = name): Key => ({ id: `cmd-${name}`, label, aria: 'kb.command', ariaParams: { name }, action: { kind: 'command', name }, style: 'function' });
const tpl = (id: string, label: string, template: Extract<KeyAction, { kind: 'template' }>['template'], aria: LocaleKey, extra: Partial<Key> = {}): Key => ({ id, label, aria, action: { kind: 'template', template }, style: 'function', ...extra });
const edit = (op: Extract<KeyAction, { kind: 'edit' }>['op'], label: string, aria: LocaleKey, style: Key['style'] = 'action', extra: Partial<Key> = {}): Key => ({ id: `e-${op}`, label, aria, action: { kind: 'edit', op }, style, ...extra });
const letter = (l: string): Key => ({ id: `l${l}`, label: l, aria: 'kb.letter', ariaParams: { l }, action: { kind: 'insert', text: l } });
const sw = (tab: string, label: string, aria: LocaleKey): Key => ({ id: `tab-${tab}`, label, aria, action: { kind: 'switch', tab }, style: 'action' });

const PLUS = ins('plus', '+', ' + ', 'kb.plus', 'function');
const MINUS = ins('minus', '−', ' - ', 'kb.minus', 'function');
const TIMES = ins('times', '×', ' * ', 'kb.times', 'function');
const DIVIDE = ins('divide', '÷', ' / ', 'kb.divide', 'function');
const OPEN = ins('open', '(', '(', 'kb.open_paren');
const CLOSE = ins('close', ')', ')', 'kb.close_paren');
const POINT = ins('point', '.', '.', 'kb.point', 'normal', { longPress: [{ kind: 'insert', text: ', ' }] });
const COMMA = ins('comma', ',', ', ', 'kb.comma');
const EQUALS = ins('equals', '=', ' = ', 'kb.equals', 'function');
const PI = ins('pi', 'π', 'pi', 'kb.pi', 'normal', { longPress: [{ kind: 'insert', text: 'tau' }, { kind: 'insert', text: 'e' }] });
const E = ins('e', 'e', 'e', 'kb.e');
const SQUARE = tpl('square', 'x²', 'square', 'kb.square', { longPress: [{ kind: 'insert', text: '^3' }, { kind: 'insert', text: '^(-1)' }] });
const POWER = tpl('power', 'xⁿ', 'power', 'kb.power');
const ROOT = tpl('root', '√', 'root', 'kb.root');
const FRACTION = tpl('fraction', 'a/b', 'fraction', 'kb.fraction');
const ABS = tpl('abs', '|a|', 'abs', 'kb.abs');
const BACK = edit('backspace', '⌫', 'kb.backspace');
const ENTER = edit('enter', '⏎', 'kb.enter', 'primary', { width: 1.5 });
const LEFT = edit('left', '←', 'kb.left');
const RIGHT = edit('right', '→', 'kb.right');

const greek = ['α', 'β', 'γ', 'δ', 'θ', 'λ', 'μ', 'σ', 'φ', 'ω'].map((g) => ({ id: `g${g}`, label: g, aria: 'kb.letter', ariaParams: { l: g }, action: { kind: 'insert', text: g } as const }));

const DIGIT_ROWS = (last: readonly Key[]): (readonly Key[])[] => [
  [digit('7'), digit('8'), digit('9'), DIVIDE],
  [digit('4'), digit('5'), digit('6'), TIMES],
  [digit('1'), digit('2'), digit('3'), MINUS],
  [digit('0'), POINT, ...last, PLUS],
];

export const LAYOUTS: Readonly<Record<KeyboardId, KeyboardLayout>> = Object.freeze({
  standard: {
    id: 'standard',
    tabs: [
      {
        id: '123', label: '123', aria: 'kb.tab.123',
        rows: [
          [digit('7'), digit('8'), digit('9'), DIVIDE, OPEN, CLOSE, ins('x', 'x', 'x', 'kb.letter', 'normal', { ariaParams: { l: 'x' } }), ins('y', 'y', 'y', 'kb.letter', 'normal', { ariaParams: { l: 'y' } }), BACK],
          [digit('4'), digit('5'), digit('6'), TIMES, ins('lt', '<', ' < ', 'kb.less'), ins('gt', '>', ' > ', 'kb.greater'), SQUARE, POWER, ROOT],
          [digit('1'), digit('2'), digit('3'), MINUS, ins('le', '≤', ' <= ', 'kb.lessEq'), ins('ge', '≥', ' >= ', 'kb.greaterEq'), PI, E, ABS],
          [digit('0'), POINT, COMMA, PLUS, EQUALS, FRACTION, LEFT, RIGHT, ENTER],
        ],
      },
      {
        id: 'fx', label: 'f(x)', aria: 'kb.tab.fx',
        rows: [
          [fn('sin'), fn('cos'), fn('tan'), fn('ln'), fn('log'), BACK],
          [fn('asin', 'sin⁻¹'), fn('acos', 'cos⁻¹'), fn('atan', 'tan⁻¹'), fn('exp', 'eˣ'), fn('abs', '|x|'), fn('sqrt', '√x')],
          [cmd('Derivative', 'd/dx'), cmd('Integral', '∫'), cmd('Limit', 'lim'), cmd('Root'), cmd('Extremum'), cmd('Tangent')],
          [fn('floor'), fn('ceil'), fn('round'), fn('min'), fn('max'), ENTER],
        ],
      },
      {
        id: 'abc', label: 'ABC', aria: 'kb.tab.abc',
        rows: [
          'qwertyuiop'.split('').map(letter),
          'asdfghjkl'.split('').map(letter),
          [...'zxcvbnm'.split('').map(letter), tpl('sub', 'x₁', 'subscript', 'kb.subscript'), BACK],
          [{ id: 'space', label: '␣', aria: 'kb.space', action: { kind: 'insert', text: ' ' }, width: 4 }, LEFT, RIGHT, ENTER],
        ],
      },
      { id: 'greek', label: 'αβγ', aria: 'kb.tab.greek', rows: [greek.slice(0, 5), greek.slice(5), [LEFT, RIGHT, BACK, ENTER]] },
    ],
  },
  scientific: {
    id: 'scientific',
    tabs: [
      {
        id: 'main', label: 'keys', aria: 'kb.tab.main',
        rows: [
          [{ id: 'shift', label: 'shift', aria: 'kb.shift', action: { kind: 'shift' }, style: 'action' }, { id: 'deg', label: 'deg', aria: 'kb.degree', action: { kind: 'toggle', what: 'angle' }, style: 'action' }, { id: 'sd', label: 'S↔D', aria: 'kb.toggleSD', action: { kind: 'toggle', what: 'exact' }, style: 'action' }, ins('ans', 'Ans', 'ans', 'kb.ans', 'function'), BACK, edit('clear', 'AC', 'kb.clear')],
          [
            fn('sin', 'sin', { shifted: { label: 'sin⁻¹', aria: 'kb.fn', ariaParams: { name: 'asin' }, action: { kind: 'insert', text: 'asin()', cursor: 5 } } }),
            fn('cos', 'cos', { shifted: { label: 'cos⁻¹', aria: 'kb.fn', ariaParams: { name: 'acos' }, action: { kind: 'insert', text: 'acos()', cursor: 5 } } }),
            fn('tan', 'tan', { shifted: { label: 'tan⁻¹', aria: 'kb.fn', ariaParams: { name: 'atan' }, action: { kind: 'insert', text: 'atan()', cursor: 5 } } }),
            fn('ln', 'ln', { shifted: { label: 'eˣ', aria: 'kb.fn', ariaParams: { name: 'exp' }, action: { kind: 'insert', text: 'exp()', cursor: 4 } } }),
            fn('log', 'log', { shifted: { label: '10ˣ', aria: 'kb.power', action: { kind: 'insert', text: '10^' } } }),
            ROOT,
          ],
          [SQUARE, POWER, FRACTION, tpl('pair', '( )', 'pair', 'kb.pair'), PI, E],
          ...DIGIT_ROWS([ins('exp', 'EXP', '*10^', 'kb.exp', 'function'), ins('neg', '(−)', '-', 'kb.negate')]),
          [OPEN, CLOSE, LEFT, RIGHT, { ...ENTER, label: '=' }],
        ],
      },
    ],
  },
  notes: {
    id: 'notes',
    tabs: [
      { id: 'abc', label: 'ABC', aria: 'kb.tab.abc', rows: ['qwertyuiop'.split('').map(letter), 'asdfghjkl'.split('').map(letter), [...'zxcvbnm'.split('').map(letter), BACK], [{ id: 'space', label: '␣', aria: 'kb.space', action: { kind: 'insert', text: ' ' }, width: 4 }, sw('maths', '∑', 'kb.tab.maths'), ENTER]] },
      { id: 'maths', label: '∑', aria: 'kb.tab.maths', rows: [...DIGIT_ROWS([COMMA]), [FRACTION, SQUARE, ROOT, PI, EQUALS, sw('abc', 'ABC', 'kb.tab.abc'), ENTER]] },
    ],
  },
  geometry: {
    id: 'geometry',
    tabs: [
      {
        id: 'main', label: 'keys', aria: 'kb.tab.main',
        rows: [
          [cmd('Point'), cmd('Segment'), cmd('Line'), cmd('Circle'), cmd('Polygon'), cmd('Midpoint')],
          [cmd('Angle', '∠'), cmd('Distance'), cmd('Rotate'), cmd('Reflect'), ...greek.slice(0, 2)],
          ...DIGIT_ROWS([COMMA]),
          [OPEN, CLOSE, ins('deg', '°', 'deg', 'kb.degree'), PI, BACK, ENTER],
        ],
      },
    ],
  },
  probability: {
    id: 'probability',
    tabs: [
      {
        id: 'main', label: 'keys', aria: 'kb.tab.main',
        rows: [
          [ins('mu', 'μ', 'μ', 'kb.letter', 'normal', { ariaParams: { l: 'μ' } }), ins('sigma', 'σ', 'σ', 'kb.letter', 'normal', { ariaParams: { l: 'σ' } }), ins('le', '≤', ' <= ', 'kb.lessEq'), ins('ge', '≥', ' >= ', 'kb.greaterEq'), cmd('Prob', 'P('), BACK],
          ...DIGIT_ROWS([COMMA]),
          [OPEN, CLOSE, FRACTION, LEFT, RIGHT, ENTER],
        ],
      },
    ],
  },
});

/* ------------------------------ checks ------------------------------ */

export interface LayoutProblem {
  readonly kind: 'layout_invalid';
  readonly layout: string;
  readonly key?: string;
  readonly why: string;
}

/** Every key has a spoken name, ids are unique per tab, command keys name commands that exist (errors 6). */
export function validateLayout(layout: KeyboardLayout, opts: { readonly commands?: readonly string[]; readonly messages?: Readonly<Record<string, unknown>> } = {}): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const tabs = new Set<string>();
  for (const tab of layout.tabs) {
    if (tabs.has(tab.id)) out.push({ kind: 'layout_invalid', layout: layout.id, why: `tab ${tab.id} appears twice` });
    tabs.add(tab.id);
    const ids = new Set<string>();
    for (const row of tab.rows) {
      for (const k of row) {
        if (ids.has(k.id)) out.push({ kind: 'layout_invalid', layout: layout.id, key: k.id, why: `key ${k.id} appears twice in tab ${tab.id}` });
        ids.add(k.id);
        for (const a of [k.aria, k.shifted?.aria]) {
          if (a === undefined) continue;
          if (!a) out.push({ kind: 'layout_invalid', layout: layout.id, key: k.id, why: 'no spoken name' });
          else if (opts.messages && !(a in opts.messages)) out.push({ kind: 'layout_invalid', layout: layout.id, key: k.id, why: `spoken name ${a} is not in the catalogue` });
        }
        if (k.action.kind === 'command' && opts.commands && !opts.commands.includes(k.action.name)) out.push({ kind: 'layout_invalid', layout: layout.id, key: k.id, why: `unknown command ${k.action.name}` });
        if (k.action.kind === 'switch' && !layout.tabs.some((t) => t.id === (k.action as { tab: string }).tab)) out.push({ kind: 'layout_invalid', layout: layout.id, key: k.id, why: 'switches to a tab that does not exist' });
      }
    }
  }
  return out;
}

/** The layout for a mode with keys for forbidden commands and functions taken out (errors 6 `key_command_forbidden`). */
export function layoutFor(id: KeyboardId | string, policy: CompiledPolicy, catalogue: readonly CommandRef[]): { readonly layout: KeyboardLayout; readonly fellBack: boolean } {
  const base = (LAYOUTS as Record<string, KeyboardLayout | undefined>)[id];
  const layout = base ?? LAYOUTS.standard;
  // a command two areas give has a group per area (Midpoint: geometry and space): its key shows when the mode allows one
  const groups = new Map<string, string[]>();
  for (const c of catalogue) groups.set(c.name, [...(groups.get(c.name) ?? []), c.group]);
  const allowed = (k: Key): boolean => {
    const a = k.action;
    if (a.kind === 'command') return (groups.get(a.name) ?? []).some((g) => policy.command(a.name, g));
    if (a.kind === 'insert' && k.id.startsWith('fn-')) return policy.fn(a.text.replace(/\(.*$/, ''));
    return true;
  };
  const tabs = layout.tabs
    .map((t) => ({ ...t, rows: t.rows.map((r) => r.filter(allowed)).filter((r) => r.length > 0) }))
    .filter((t) => t.rows.some((r) => r.some((k) => k.action.kind !== 'edit')));
  return { layout: { ...layout, tabs }, fellBack: base === undefined };
}

/**
 * What a key does to a line being edited: the new text and caret. The studio's input field calls this, so the keyboard
 * and the physical keys behave the same. Templates insert their plain-text form with the caret in the first hole.
 */
export function applyKey(action: KeyAction, text: string, caret: number, selection = 0): { text: string; caret: number } | { done: 'enter' | 'close' } | undefined {
  const at = Math.max(0, Math.min(caret, text.length));
  const end = Math.min(text.length, at + Math.max(0, selection));
  const put = (s: string, back = 0): { text: string; caret: number } => ({ text: text.slice(0, at) + s + text.slice(end), caret: at + s.length - back });
  switch (action.kind) {
    case 'insert':
      return put(action.text, action.cursor !== undefined ? action.text.length - action.cursor : 0);
    case 'command':
      return put(`${action.name}()`, 1);
    case 'template': {
      const sel = text.slice(at, end);
      switch (action.template) {
        case 'fraction':
          return sel ? put(`(${sel})/()`, 1) : put('()/()', 4);
        case 'power':
          return put(`${sel}^()`, 1);
        case 'square':
          return put(`${sel}^2`);
        case 'subscript':
          return put('_');
        case 'root':
          return put(`sqrt(${sel})`, 1);
        case 'abs':
          return put(`abs(${sel})`, 1);
        case 'pair':
          return put(`(${sel})`, 1);
        case 'list':
          return put(`[${sel}]`, 1);
        case 'mixed':
          return put(' + ()/()', 4);
        case 'sum':
          return put('Sum()', 1);
      }
      return undefined;
    }
    case 'edit':
      switch (action.op) {
        case 'backspace':
          if (end > at) return { text: text.slice(0, at) + text.slice(end), caret: at };
          return at > 0 ? { text: text.slice(0, at - 1) + text.slice(at), caret: at - 1 } : { text, caret: at };
        case 'delete':
          if (end > at) return { text: text.slice(0, at) + text.slice(end), caret: at };
          return { text: text.slice(0, at) + text.slice(at + 1), caret: at };
        case 'left':
          return { text, caret: Math.max(0, at - 1) };
        case 'right':
          return { text, caret: Math.min(text.length, at + 1) };
        case 'home':
        case 'up':
          return { text, caret: 0 };
        case 'end':
        case 'down':
          return { text, caret: text.length };
        case 'clear':
          return { text: '', caret: 0 };
        case 'enter':
          return { done: 'enter' };
      }
      return undefined;
    case 'close':
      return { done: 'close' };
    default:
      return undefined;
  }
}

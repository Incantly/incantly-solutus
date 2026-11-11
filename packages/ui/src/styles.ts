/** Colours and CSS for the language components (docs/features/language/ui.md section 2, algebra-view/ui.md section 13). */

export interface Palette {
  readonly bg: string;
  readonly ink: string;
  readonly secondary: string;
  readonly accent: string;
  readonly border: string;
  readonly error: string;
  readonly ok: string;
  readonly object: string;
  readonly unknown: string;
  readonly command: string;
  readonly fn: string;
  readonly constant: string;
  readonly number: string;
  readonly operator: string;
  readonly string: string;
  readonly comment: string;
  readonly keyword: string;
}

/** Every text colour below has a contrast ratio of at least 4.5:1 on `bg` (checked in the tests). */
export const LIGHT: Palette = {
  bg: '#ffffff',
  ink: '#1f2328',
  secondary: '#57606a',
  accent: '#0550ae',
  border: '#8c959f',
  error: '#b4232c',
  ok: '#1a7f37',
  object: '#1f2328',
  unknown: '#b4232c',
  command: '#0550ae',
  fn: '#0b6a6a',
  constant: '#6f42c1',
  number: '#953800',
  operator: '#57606a',
  string: '#116329',
  comment: '#57606a',
  keyword: '#a3226f',
};

export const DARK: Palette = {
  bg: '#1e1e24',
  ink: '#e6e6ea',
  secondary: '#a0a0aa',
  accent: '#79c0ff',
  border: '#6e7681',
  error: '#ff8a80',
  ok: '#7ee787',
  object: '#e6e6ea',
  unknown: '#ff8a80',
  command: '#79c0ff',
  fn: '#56d4dd',
  constant: '#d2a8ff',
  number: '#ffa657',
  operator: '#a0a0aa',
  string: '#7ee787',
  comment: '#a0a0aa',
  keyword: '#ff9bce',
};

function vars(p: Palette): string {
  return Object.entries(p)
    .map(([k, v]) => `--inc-${k}: ${v};`)
    .join(' ');
}

/** Custom properties for both themes. Components read `var(--inc-*)`; a page may override any of them. */
export const THEME_CSS = `
:host { ${vars(LIGHT)} color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :host { ${vars(DARK)} } }
:host([theme="light"]) { ${vars(LIGHT)} color-scheme: light; }
:host([theme="dark"]) { ${vars(DARK)} color-scheme: dark; }
`;

export const EDITOR_CSS = `
:host { display: block; position: relative; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--inc-ink); }
* { box-sizing: border-box; }
.bar { display: flex; align-items: flex-start; gap: 4px; background: var(--inc-bg); border: 1px solid var(--inc-border); border-radius: 6px; padding: 2px 4px; }
.bar:focus-within { outline: 2px solid var(--inc-accent); outline-offset: 1px; }
.gutter { width: 1.2em; min-height: 1.5em; padding-top: 6px; text-align: center; color: var(--inc-error); font-weight: 700; flex: none; }
.field { position: relative; flex: 1 1 auto; min-width: 0; }
.mirror, .input {
  margin: 0; padding: 6px 4px; border: 0; width: 100%;
  font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; tab-size: 4;
}
.mirror { color: var(--inc-ink); min-height: 1.5em; max-height: 7.5em; overflow: hidden; pointer-events: none; }
.input {
  position: absolute; inset: 0; height: 100%; resize: none; overflow: auto; background: transparent;
  color: transparent; caret-color: var(--inc-ink); outline: none;
}
.input::placeholder { color: var(--inc-secondary); opacity: 1; }
.input::selection { background: rgba(5, 80, 174, 0.28); color: transparent; }
.submit { flex: none; min-width: 32px; min-height: 32px; margin-top: 1px; border: 1px solid var(--inc-border); border-radius: 6px; background: transparent; color: var(--inc-ink); font: inherit; cursor: pointer; }
.submit:focus-visible, .strip button:focus-visible, .list li:focus-visible { outline: 2px solid var(--inc-accent); outline-offset: 1px; }
@media (pointer: coarse) { .submit, .strip button, .list li { min-height: 44px; min-width: 44px; } }

.tok-object { color: var(--inc-object); }
.tok-name { color: var(--inc-object); }
.tok-unknown { color: var(--inc-unknown); }
.tok-error { color: var(--inc-error); }
.tok-command { color: var(--inc-command); font-weight: 700; }
.tok-function { color: var(--inc-fn); }
.tok-constant { color: var(--inc-constant); }
.tok-number { color: var(--inc-number); }
.tok-operator { color: var(--inc-operator); }
.tok-string { color: var(--inc-string); }
.tok-comment { color: var(--inc-comment); font-style: italic; }
.tok-directive { color: var(--inc-command); font-weight: 700; }
.tok-keyword { color: var(--inc-keyword); }
.squiggle { text-decoration: underline wavy var(--inc-error); text-decoration-skip-ink: none; text-underline-offset: 3px; }
.pair { outline: 1px solid var(--inc-secondary); outline-offset: -1px; border-radius: 2px; }

.strip { margin-top: 4px; padding: 4px 8px; border-left: 3px solid var(--inc-border); font-size: 14px; color: var(--inc-secondary); }
.strip:empty { display: none; }
.strip .error { color: var(--inc-ink); border-left: 3px solid var(--inc-error); padding-left: 6px; margin-left: -9px; }
.strip .msg { font-weight: 600; }
.strip .msg::before { content: "✗ "; color: var(--inc-error); }
.strip .hint, .strip .expects, .strip .summary { color: var(--inc-secondary); }
.strip .more { margin: 2px 0 0 1.2em; padding: 0; list-style: none; }
.strip .preview .ok { color: var(--inc-ok); font-weight: 700; }
.strip .preview .undef { color: var(--inc-secondary); }
.strip .warn::before { content: "⚠ "; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.strip button { min-height: 28px; padding: 0 8px; border: 1px solid var(--inc-border); border-radius: 14px; background: transparent; color: var(--inc-ink); font: 13px ui-monospace, Menlo, monospace; cursor: pointer; }
.strip button.fix { border-color: var(--inc-accent); color: var(--inc-accent); }
.strip button.closest, .strip .form.active { font-weight: 700; }
.strip .form { font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: var(--inc-secondary); }
.strip .form.active { color: var(--inc-ink); }
.strip .form u { text-decoration: underline; text-underline-offset: 3px; color: var(--inc-accent); }

.list { position: absolute; z-index: 10; left: 1.2em; right: 0; margin: 2px 0 0; padding: 2px; list-style: none; max-height: 12em; overflow-y: auto; background: var(--inc-bg); border: 1px solid var(--inc-border); border-radius: 6px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); }
.list[hidden] { display: none; }
.list li { display: flex; align-items: baseline; gap: 8px; min-height: 1.5em; padding: 1px 6px; border-radius: 4px; cursor: pointer; font: 13px ui-monospace, Menlo, monospace; }
.list li[aria-selected="true"] { background: rgba(5, 80, 174, 0.16); outline: 1px solid var(--inc-accent); }
.list .icon { width: 1.4em; text-align: center; color: var(--inc-secondary); flex: none; }
.list .label { font-weight: 700; }
.list .detail { margin-left: auto; color: var(--inc-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list .kind { color: var(--inc-secondary); font-size: 11px; flex: none; }
.list li.dim { opacity: 0.75; }
.vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

export const LIST_CSS = `
:host { display: block; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--inc-ink); background: var(--inc-bg); }
* { box-sizing: border-box; }
.lines { list-style: none; margin: 0; padding: 0; }
.empty { margin: 0; padding: 12px; color: var(--inc-secondary); }
.row { padding: 6px 12px; border-left: 3px solid transparent; min-height: 32px; }
.row:hover { background: rgba(127, 127, 127, 0.1); }
.row:focus-visible { outline: 2px solid var(--inc-accent); outline-offset: -2px; background: rgba(5, 80, 174, 0.1); border-left-color: var(--inc-accent); }
.top { display: flex; align-items: baseline; gap: 8px; }
.def { flex: 1 1 auto; min-width: 0; font-family: ui-monospace, Menlo, monospace; font-size: 14px; overflow-wrap: anywhere; }
.type { flex: none; padding: 0 6px; border: 1px solid var(--inc-border); border-radius: 10px; font-size: 12px; color: var(--inc-secondary); }
.value { padding-left: 1.2em; font-family: ui-monospace, Menlo, monospace; font-size: 14px; color: var(--inc-secondary); }
.undef { padding-left: 1.2em; font-size: 14px; color: var(--inc-secondary); }
.undef .dash { font-family: ui-monospace, Menlo, monospace; }
.undef .why::before { content: "⚠ "; }
.cause { margin: 2px 0 0; padding: 0 0 0 1.2em; list-style: none; font-size: 13px; }
.cause li::before { content: "↳ "; color: var(--inc-secondary); }
.cause button { padding: 0; border: 0; background: transparent; color: var(--inc-accent); font: inherit; font-family: ui-monospace, Menlo, monospace; text-decoration: underline; cursor: pointer; }
.cause button:focus-visible { outline: 2px solid var(--inc-accent); outline-offset: 1px; }
.warn { padding-left: 1.2em; font-size: 13px; color: var(--inc-secondary); }
.warn::before { content: "⚠ "; }
.row.marked { border-left-color: var(--inc-error); background: rgba(180, 35, 44, 0.08); }
.chip { flex: none; padding: 0 6px; border-radius: 10px; font-size: 12px; border: 1px solid var(--inc-border); color: var(--inc-secondary); }
.chip.rel { color: var(--inc-error); border-color: var(--inc-error); }
.chip[hidden] { display: none; }
.acts { flex: none; display: inline-flex; gap: 4px; }
.act { padding: 0 6px; min-height: 24px; border: 1px solid var(--inc-border); border-radius: 6px; background: transparent; color: var(--inc-ink); font: inherit; font-size: 13px; cursor: pointer; }
.act:focus-visible, .control:focus-visible { outline: 2px solid var(--inc-accent); outline-offset: 1px; }
.ctl { padding: 2px 0 2px 1.2em; }
.ctl[hidden] { display: none; }
.ctl label { display: flex; align-items: center; gap: 8px; }
.ctl .lbl { flex: none; min-width: 4.5em; font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: var(--inc-secondary); }
.ctl input[type="text"] { flex: 1 1 auto; min-width: 0; max-width: 14em; padding: 2px 6px; font: 14px ui-monospace, Menlo, monospace; color: var(--inc-ink); background: var(--inc-bg); border: 1px solid var(--inc-border); border-radius: 4px; }
.ctl input[type="range"] { flex: 1 1 auto; min-width: 0; }
@media (pointer: coarse) { .row { min-height: 44px; } .cause button, .act { min-height: 44px; min-width: 44px; } .ctl input { min-height: 44px; } }
`;

export const CARD_CSS = `
:host { display: block; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--inc-ink); }
* { box-sizing: border-box; }
.card { display: flex; gap: 8px; padding: 8px 12px; border: 1px solid var(--inc-error); border-radius: 6px; background: var(--inc-bg); }
.bang { flex: none; font-weight: 700; color: var(--inc-error); }
.main { flex: 1 1 auto; min-width: 0; }
.msg { margin: 0; }
.hint { margin: 2px 0 0; color: var(--inc-secondary); }
.why { margin: 2px 0 0; padding-left: 1.2em; color: var(--inc-secondary); font-size: 13px; }
.row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; align-items: center; }
.row .lbl { color: var(--inc-secondary); font-size: 13px; }
button { padding: 2px 8px; min-height: 28px; border: 1px solid var(--inc-border); border-radius: 6px; background: transparent; color: var(--inc-ink); font: 13px ui-monospace, Menlo, monospace; cursor: pointer; }
button.close { flex: none; align-self: flex-start; font: 14px ui-sans-serif, system-ui, sans-serif; }
button:focus-visible { outline: 2px solid var(--inc-accent); outline-offset: 1px; }
.tech { color: var(--inc-secondary); font-size: 12px; }
:host([hidden]), [hidden] { display: none; }
@media (pointer: coarse) { button { min-height: 44px; min-width: 44px; } }
`;

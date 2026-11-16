/**
 * App modes in the studio (app-modes ui 1 to 4, 6, 8, 9, 10; .kiro/specs/app-modes R10): the mode record decides which
 * views show, which tools and commands are there, and which settings the sheet offers. The start screen lists the
 * modes this build has; switching asks before anything is removed; settings apply live.
 */
import {
  I18n, LOCALES, MODES, Settings, availableModes, catalogueOf, compilePolicy, getMode, makeGate, settingDef, switchMode,
} from '@incantly/modes';
import type { AppModeId, CommandRef, ModeChangeResult, ModeConfig, Rounding, SettingDef, StorageLike, ViewKind } from '@incantly/modes';
import type { KernelSession } from '../session';
import type { ToolStrip } from '../tools-ui';
import { frameStyle } from '../graph/paint';

/** The parts of the page a mode shows, hides or narrows. */
export interface ModeHostParts {
  readonly app: HTMLElement;
  readonly session: KernelSession;
  readonly tools: ToolStrip;
  /** The expression list's pane, the divider and the graph. */
  readonly panes: { readonly algebra: HTMLElement; readonly split: HTMLElement; readonly graphics: HTMLElement };
  /** Side views with open and close. */
  readonly views: Partial<Record<ViewKind, { open(): void; close(): void; isOpen(): boolean; button?: HTMLElement }>>;
  /** Top-bar buttons for features (`script` is the file dialog). */
  readonly buttons: { readonly script?: HTMLElement; readonly examples?: HTMLElement; readonly newFigure?: HTMLElement };
  /** Where the App and Settings buttons go. */
  readonly topTools: HTMLElement;
  readonly topRight: HTMLElement;
  readonly say: (text: string) => void;
  /** Repaint and refit the graph after the layout changed. */
  readonly relayout: () => void;
  /** The algebra list's decimals, from the rounding setting. */
  readonly setRounding: (r: Rounding) => void;
  /** `localStorage`, or null in tests. */
  readonly storage?: StorageLike | null;
  /** Why the app may not change now (an exam is running), or undefined. */
  readonly canSwitch?: () => string | undefined;
}

export interface AppModes {
  readonly mode: ModeConfig;
  readonly settings: Settings;
  readonly i18n: I18n;
  readonly catalogue: readonly CommandRef[];
  /** Switches mode. Without `force`, a switch that would remove objects asks first (and returns its dry run). */
  setMode(id: AppModeId | string, opts?: { readonly force?: boolean; readonly ask?: boolean }): ModeChangeResult;
  /** Opens the start screen with the mode tiles. */
  showStart(): void;
  openSettings(): void;
  closeSettings(): void;
  /** The narrowed mode in force (an exam narrows it further). */
  setNarrowed(mode: ModeConfig | undefined): void;
  onChange(fn: (mode: ModeConfig) => void): () => void;
  readonly startDialog: HTMLDialogElement;
  readonly switchDialog: HTMLDialogElement;
  readonly settingsSheet: HTMLElement;
  dispose(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
const button = (label: string, cls: string, title: string, on: () => void): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: cls, title, 'aria-label': title }, label);
  b.addEventListener('click', on);
  return b;
};
const showModal = (d: HTMLDialogElement): void => {
  if (typeof d.showModal === 'function' && !d.open) d.showModal();
  else d.setAttribute('open', '');
};
const closeModal = (d: HTMLDialogElement): void => {
  if (typeof d.close === 'function') d.close();
  d.removeAttribute('open');
};

const MODE_ICON: Record<AppModeId, string> = {
  graphing: '∿', geometry: '△', scientific: '±', probability: '⚄', cas: '∫', notes: '✎', classic: '▦', graphing3d: '⬚', figure: '◎',
};

export function mountAppModes(p: ModeHostParts, initial: AppModeId = 'classic'): AppModes {
  const catalogue = catalogueOf(p.session.registry.all());
  const first = getMode(initial);
  let mode: ModeConfig = first.ok ? first.value : MODES.classic;
  let narrowed: ModeConfig | undefined;
  const settings = new Settings({ mode, storage: p.storage ?? null });
  const i18n = new I18n({ locale: 'en' });
  const listeners = new Set<(m: ModeConfig) => void>();

  /* ------------------------------ layout ------------------------------ */

  const inForce = (): ModeConfig => narrowed ?? mode;

  const applyLayout = (): void => {
    const m = inForce();
    const v = m.views;
    p.app.dataset['mode'] = m.derivedFrom ?? m.id;
    const showAlgebra = v.initial.includes('algebra');
    const showGraphics = v.initial.includes('graphics') || (v.available.includes('graphics') && !v.initial.includes('results') && !v.initial.includes('distribution') && !v.initial.includes('cas'));
    p.panes.algebra.hidden = !showAlgebra;
    p.panes.split.hidden = !showAlgebra || !showGraphics;
    p.panes.graphics.hidden = !showGraphics;
    // a side view is the whole app when there is no graph (probability, CAS)
    p.app.classList.toggle('no-graphics', !showGraphics);
    for (const [kind, view] of Object.entries(p.views) as [ViewKind, NonNullable<ModeHostParts['views'][ViewKind]>][]) {
      const available = v.available.includes(kind);
      if (view.button) view.button.hidden = !available || !v.canToggle;
      if (!available && view.isOpen()) view.close();
      if (v.initial.includes(kind) && available && !view.isOpen()) view.open();
      view.button?.classList.toggle('on', view.isOpen());
    }
    if (p.buttons.script) p.buttons.script.hidden = !(m.features.fileOps || m.features.scripting);
    if (p.buttons.examples) p.buttons.examples.hidden = m.id === 'figure' || p.buttons.examples.childElementCount <= 1;
    const policy = compilePolicy(m);
    p.tools.setAllowed(m.tools.toolbar === 'none' ? () => false : (id, group) => policy.tool(id, group as never));
    p.tools.element.hidden = m.tools.toolbar === 'none' || !showGraphics;
    appBtn.textContent = `☰ ${i18n.t(m.title)}`;
    appBtn.title = `${i18n.t('app.app')}: ${i18n.t(m.title)}`;
    p.relayout();
  };

  const installGate = (): void => {
    p.session.setGate(makeGate({ layers: [{ policy: compilePolicy(mode), reason: 'mode' }], catalogue }));
  };

  /* ------------------------------ settings ------------------------------ */

  const applySettings = (): void => {
    const s = settings;
    // the figure's own @axes and @grid lines win over the setting
    const script = p.session.save();
    const axes = /^@axes (on|off)\b/m.exec(script)?.[1];
    const grid = /^@grid (off|major|minor|on)\b/m.exec(script)?.[1];
    frameStyle.axes = axes ? axes === 'on' : (s.get<boolean>('axes'));
    frameStyle.grid = grid ? (grid === 'off' ? 'none' : grid === 'on' ? 'major' : grid) as 'none' | 'major' | 'minor' : s.get<'none' | 'major' | 'minor'>('grid');
    frameStyle.highContrast = s.get<boolean>('highContrast');
    const root = p.app;
    root.classList.toggle('high-contrast', s.get<boolean>('highContrast'));
    const rm = s.get<string>('reducedMotion');
    const prefers = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.toggle('reduced-motion', rm === 'on' || (rm === 'system' && prefers));
    root.style.setProperty('--text-scale', String(s.get<number>('textScale') / 100));
    root.classList.toggle('screen-reader', s.get<boolean>('screenReaderMode'));
    const theme = s.get<string>('theme');
    root.dataset['theme'] = theme;
    p.setRounding(s.get<Rounding>('rounding'));
    p.relayout();
  };
  const offSettings = settings.onChange('*', (id) => {
    if (id === 'language') void setLanguage(settings.get<string>('language'));
    // file settings are lines of the figure, so scripts reproduce them (design 3.8)
    const def = settingDefOf(id);
    if (def?.scope === 'file' && def.directive && !reading) writeDirective(id);
    applySettings();
    renderSettings();
  });

  const settingDefOf = (id: string): SettingDef | undefined => settingDef(id);
  /** True while the figure's own setting lines are read: they are not written back. */
  let reading = false;

  const writeDirective = (id: string): void => {
    const lines = settings.toDirectives();
    const word = { angleUnit: '@angleunit', rounding: '@rounding', coordinates: '@coords', axes: '@axes', grid: '@grid', snapToGrid: '@snap' }[id];
    if (!word) return;
    const line = lines.find((l) => l.startsWith(word));
    if (line) p.session.applyLines([line], `Set ${id}`, 'independent', 'learner');
  };

  const setLanguage = async (lang: string): Promise<void> => {
    const want = lang === 'auto' ? (typeof navigator !== 'undefined' ? navigator.language : 'en') : lang;
    const r = await i18n.setLocale(want);
    p.app.setAttribute('lang', r.used);
    p.app.setAttribute('dir', i18n.dir);
    applyLayout();
    renderStart();
    renderSettings();
  };

  /* ------------------------------ top bar ------------------------------ */

  const appBtn = button(`☰ ${i18n.t(mode.title)}`, 'tool-btn app-btn', i18n.t('app.app'), () => api.showStart());
  appBtn.setAttribute('aria-haspopup', 'dialog');
  const gearBtn = button('⚙', 'icon-btn', i18n.t('settings.title'), () => (sheet.hidden ? api.openSettings() : api.closeSettings()));
  gearBtn.setAttribute('aria-expanded', 'false');
  p.topTools.prepend(appBtn);
  p.topRight.prepend(gearBtn);

  /* ------------------------------ start screen ------------------------------ */

  const startDialog = h('dialog', { class: 'start-dialog', 'aria-label': i18n.t('app.chooseApp') });
  const renderStart = (): void => {
    const tiles = h('div', { class: 'mode-tiles', role: 'list' });
    // modes this build cannot show are hidden, not greyed (ui 1); the teacher's figure mode has no tile
    for (const m of availableModes().filter((x) => x.id !== 'figure')) {
      const tile = button('', `mode-tile${m.id === mode.id ? ' on' : ''}`, i18n.t(m.title), () => {
        closeModal(startDialog);
        api.setMode(m.id, { ask: true });
      });
      tile.setAttribute('role', 'listitem');
      tile.dataset['mode'] = m.id;
      tile.append(h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, MODE_ICON[m.id]), h('span', { class: 'tile-title' }, i18n.t(m.title)), h('span', { class: 'tile-purpose' }, i18n.t(m.purpose)));
      tiles.append(tile);
    }
    startDialog.replaceChildren(
      h('h2', {}, i18n.t('app.chooseApp')),
      tiles,
      h('p', { class: 'muted badge-english' }, i18n.t('app.commandsEnglish')),
      h('div', { class: 'dialog-actions' }, button(i18n.t('exam.close'), 'secondary', i18n.t('exam.close'), () => closeModal(startDialog))),
    );
  };

  /* ------------------------------ switch dialog ------------------------------ */

  const switchDialog = h('dialog', { class: 'switch-dialog', 'aria-label': 'Switch app' });
  const askSwitch = (to: ModeConfig, dry: ModeChangeResult): void => {
    const names = dry.dropped.map((d) => d.name);
    const list = h('ul', { class: 'dropped' });
    const shown = names.slice(0, 6);
    for (const d of dry.dropped.slice(0, 6)) list.append(h('li', { title: d.reason }, h('b', {}, d.name), ` — ${d.reason}`));
    const more = names.length > shown.length ? button(i18n.t('app.showAll'), 'link-btn', i18n.t('app.showAll'), () => {
      list.replaceChildren(...dry.dropped.map((d) => h('li', { title: d.reason }, h('b', {}, d.name), ` — ${d.reason}`)));
      more?.remove();
    }) : undefined;
    switchDialog.replaceChildren(
      h('h2', {}, i18n.t('app.switchTitle', { mode: i18n.t(to.title) })),
      h('p', {}, i18n.t('app.switchLoses', { n: names.length })),
      list,
      ...(more ? [more] : []),
      h('div', { class: 'dialog-actions' },
        button(i18n.t('app.keep'), 'secondary', i18n.t('app.keep'), () => closeModal(switchDialog)),
        button(i18n.t('app.saveFirst'), 'secondary', i18n.t('app.saveFirst'), () => {
          closeModal(switchDialog);
          p.buttons.script?.click();
        }),
        button(i18n.t('app.switchRemove'), 'primary danger', i18n.t('app.switchRemove'), () => {
          closeModal(switchDialog);
          api.setMode(to.id, { force: true });
        })),
    );
    showModal(switchDialog);
  };

  /* ------------------------------ settings sheet ------------------------------ */

  const sheet = h('aside', { class: 'settings-sheet', 'aria-label': i18n.t('settings.title') });
  sheet.hidden = true;
  let activeGroup = 'general';
  const valueLabel = (v: string): string => {
    const k = `value.${v}`;
    const t = i18n.t(k);
    return t === k ? v : t;
  };
  const control = (d: SettingDef): HTMLElement => {
    const id = `set-${d.id}`;
    const locked = settings.lockedBy(d.id);
    const v = settings.get(d.id);
    const t = d.type;
    let input: HTMLElement;
    const set = (x: unknown): void => {
      const r = settings.set(d.id, x);
      if (!r.ok) p.say(r.message);
    };
    if (t.k === 'bool') {
      const c = h('input', { type: 'checkbox', id });
      c.checked = v === true;
      c.addEventListener('change', () => set(c.checked));
      input = c;
    } else if (t.k === 'enum' && t.values.length <= 3) {
      const g = h('div', { class: 'radio-row', role: 'radiogroup', 'aria-labelledby': `${id}-l` });
      for (const val of t.values) {
        const r = h('input', { type: 'radio', name: id, value: val, id: `${id}-${val}` });
        r.checked = v === val;
        r.addEventListener('change', () => set(val));
        g.append(h('label', { for: `${id}-${val}` }, r, ` ${valueLabel(val)}`));
      }
      input = g;
    } else if (t.k === 'enum') {
      const s = h('select', { id });
      for (const val of t.values) s.append(h('option', { value: val }, valueLabel(val)));
      s.value = String(v);
      s.addEventListener('change', () => set(s.value));
      input = s;
    } else if (t.k === 'rounding') {
      const r = v as Rounding;
      const n = h('select', { id, 'aria-label': i18n.t('setting.rounding') });
      for (let i = r.mode === 'sig' ? 1 : 0; i <= 15; i++) n.append(h('option', { value: String(i) }, String(i)));
      n.value = String(r.digits);
      const kind = h('select', { 'aria-label': 'Rounding kind' });
      kind.append(h('option', { value: 'decimals' }, valueLabel('decimals')), h('option', { value: 'sig' }, valueLabel('sig')));
      kind.value = r.mode;
      const update = (): void => set({ mode: kind.value, digits: Math.max(kind.value === 'sig' ? 1 : 0, Number(n.value)) });
      n.addEventListener('change', update);
      kind.addEventListener('change', update);
      input = h('span', { class: 'rounding' }, n, ' ', kind);
    } else if (t.k === 'string' && d.id === 'language') {
      const s = h('select', { id });
      s.append(h('option', { value: 'auto' }, valueLabel('auto')));
      for (const l of [...LOCALES].sort((a, b) => a.name.localeCompare(b.name))) s.append(h('option', { value: l.id, lang: l.id }, l.name));
      s.value = String(v);
      s.addEventListener('change', () => set(s.value));
      input = s;
    } else {
      const n = h('input', { type: 'number', id, value: String(v), ...(t.k === 'int' || t.k === 'number' ? { min: String(t.min), max: String(t.max) } : {}) });
      n.addEventListener('change', () => set(t.k === 'int' || t.k === 'number' ? Number(n.value) : n.value));
      input = n;
    }
    if (locked) for (const x of [input, ...input.querySelectorAll('input, select')]) (x as HTMLInputElement).disabled = true;
    const row = h('div', { class: `setting-row${locked ? ' locked' : ''}`, 'data-setting': d.id }, h('label', { id: `${id}-l`, for: id, class: 'setting-label' }, i18n.t(d.label)), input);
    if (locked) row.append(h('span', { class: 'lock', title: i18n.t('settings.locked', { by: locked }) }, `🔒 ${i18n.t('settings.locked', { by: locked })}`));
    else if (settings.isChanged(d.id)) row.append(button('↺', 'icon-btn reset-one', `${i18n.t('settings.reset')} ${i18n.t(d.label)}`, () => settings.resetOne(d.id)));
    return row;
  };
  const renderSettings = (): void => {
    const groups = settings.panel();
    if (!groups.some((g) => g.group === activeGroup)) activeGroup = groups[0]?.group ?? 'general';
    const tabs = h('div', { class: 'settings-tabs', role: 'tablist' });
    for (const g of groups) {
      const t = button(i18n.t(`group.${g.group}`), `tab${g.group === activeGroup ? ' on' : ''}`, i18n.t(`group.${g.group}`), () => {
        activeGroup = g.group;
        renderSettings();
      });
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', String(g.group === activeGroup));
      tabs.append(t);
    }
    const body = h('div', { class: 'settings-body', role: 'tabpanel' });
    for (const d of groups.find((g) => g.group === activeGroup)?.defs ?? []) body.append(control(d));
    sheet.replaceChildren(
      h('div', { class: 'lab-head' }, h('h2', {}, i18n.t('settings.title')), button('✕', 'icon-btn', i18n.t('exam.close'), () => api.closeSettings())),
      tabs,
      body,
      h('div', { class: 'dialog-actions' }, button(i18n.t('settings.resetGroup'), 'secondary', i18n.t('settings.resetGroup'), () => settings.reset(activeGroup as never))),
    );
  };

  p.app.append(sheet, startDialog, switchDialog);
  // a figure loaded or changed may carry its own setting lines
  let lastDirectives = -1;
  const offSession = p.session.onChange(() => {
    if (p.session.directiveVersion === lastDirectives) return;
    lastDirectives = p.session.directiveVersion;
    reading = true;
    try {
      settings.fromDirectives(p.session.save().split('\n'));
    } finally {
      reading = false;
    }
    applySettings();
  });

  const api: AppModes = {
    get mode() {
      return mode;
    },
    settings,
    i18n,
    catalogue,
    setMode(id, opts = {}) {
      const next = getMode(id);
      if (!next.ok) {
        p.say(next.message);
        return { ok: false, kept: p.session.figure.objects().length, dropped: [], viewsChanged: [], error: next };
      }
      const to = next.value;
      const why = p.canSwitch?.();
      if (why) {
        p.say(why);
        return { ok: false, kept: p.session.figure.objects().length, dropped: [], viewsChanged: [], error: { ok: false, area: 'api', kind: 'exam_blocked', message: why } };
      }
      if (to.id === mode.id && !opts.force) {
        applyLayout();
        return { ok: true, kept: p.session.figure.objects().length, dropped: [], viewsChanged: [] };
      }
      const r = switchMode(p.session.figure, mode, to, { catalogue, ...(opts.force ? { force: true } : {}) });
      if (!r.ok) {
        if (r.error?.kind === 'mode_switch_loses_objects' && opts.ask) askSwitch(to, r);
        else p.say(r.error?.message ?? 'The app did not change.');
        return r;
      }
      mode = to;
      narrowed = undefined;
      settings.setMode(mode);
      installGate();
      applyLayout();
      applySettings();
      renderSettings();
      renderStart();
      p.say(`${i18n.t(mode.title)}.${r.dropped.length > 0 ? ` ${r.dropped.length} objects removed; undo brings them back.` : ''}`);
      for (const fn of [...listeners]) fn(mode);
      return r;
    },
    showStart() {
      renderStart();
      showModal(startDialog);
    },
    openSettings() {
      renderSettings();
      sheet.hidden = false;
      gearBtn.setAttribute('aria-expanded', 'true');
      (sheet.querySelector('.settings-tabs button') as HTMLElement | null)?.focus();
    },
    closeSettings() {
      sheet.hidden = true;
      gearBtn.setAttribute('aria-expanded', 'false');
    },
    setNarrowed(m) {
      narrowed = m;
      applyLayout();
      renderSettings();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    startDialog,
    switchDialog,
    settingsSheet: sheet,
    dispose() {
      offSettings();
      offSession();
      p.session.setGate(undefined);
      listeners.clear();
    },
  };
  installGate();
  renderStart();
  applyLayout();
  applySettings();
  return api;
}

/**
 * Settings (app-modes design 3.8; errors 4): a typed registry, not a bag of booleans. Each setting has a scope: `file`
 * settings live in the figure as lines (`@angleunit degree`), `user` settings in the learner's own storage. A mode
 * gives the defaults where neither says anything. Storage is passed in, so this runs anywhere.
 */
import type { ModeConfig, SettingId, SettingValues } from './types';

export type SettingType =
  | { readonly k: 'bool' }
  | { readonly k: 'enum'; readonly values: readonly string[] }
  | { readonly k: 'int'; readonly min: number; readonly max: number }
  | { readonly k: 'number'; readonly min: number; readonly max: number }
  | { readonly k: 'color' }
  | { readonly k: 'string'; readonly max: number }
  | { readonly k: 'rounding' };

export type SettingGroup = 'general' | 'graphics' | 'algebra' | 'sheet' | 'keyboard' | 'sound' | 'accessibility' | 'language';

export interface SettingDef {
  readonly id: SettingId;
  readonly scope: 'file' | 'user';
  readonly type: SettingType;
  readonly default: string | number | boolean | Rounding | ((mode: ModeConfig) => unknown);
  readonly label: string;
  readonly help?: string;
  readonly group: SettingGroup;
  /** The directive a file setting is written as (`angleunit` for `@angleunit degree`). */
  readonly directive?: string;
}

export interface Rounding {
  readonly mode: 'decimals' | 'sig';
  readonly digits: number;
}

const D = (def: SettingDef): SettingDef => def;

/** The settings table of design 3.8. */
export const SETTINGS: readonly SettingDef[] = [
  D({ id: 'angleUnit', scope: 'file', type: { k: 'enum', values: ['radian', 'degree'] }, default: (m) => m.defaults.angleUnit, label: 'setting.angleUnit', group: 'general', directive: 'angleunit' }),
  D({ id: 'rounding', scope: 'file', type: { k: 'rounding' }, default: (m) => m.defaults.rounding, label: 'setting.rounding', group: 'general', directive: 'rounding' }),
  D({ id: 'coordinates', scope: 'file', type: { k: 'enum', values: ['cartesian', 'polar'] }, default: (m) => m.defaults.coordinates, label: 'setting.coordinates', group: 'general', directive: 'coords' }),
  D({ id: 'undoLimit', scope: 'user', type: { k: 'int', min: 10, max: 1000 }, default: 200, label: 'setting.undoLimit', group: 'general' }),
  D({ id: 'axes', scope: 'file', type: { k: 'bool' }, default: (m) => m.defaults.axes, label: 'setting.axes', group: 'graphics', directive: 'axes' }),
  D({ id: 'grid', scope: 'file', type: { k: 'enum', values: ['none', 'major', 'minor'] }, default: (m) => m.defaults.grid, label: 'setting.grid', group: 'graphics', directive: 'grid' }),
  D({ id: 'keepRatio', scope: 'file', type: { k: 'bool' }, default: (m) => m.defaults.view.keepRatio, label: 'setting.keepRatio', group: 'graphics' }),
  D({ id: 'snapToGrid', scope: 'file', type: { k: 'bool' }, default: false, label: 'setting.snapToGrid', group: 'graphics', directive: 'snap' }),
  D({ id: 'pointSnap', scope: 'file', type: { k: 'bool' }, default: true, label: 'setting.pointSnap', group: 'graphics' }),
  D({ id: 'showLabels', scope: 'file', type: { k: 'enum', values: ['all', 'points', 'none', 'new-points-only'] }, default: (m) => m.defaults.autoLabels, label: 'setting.showLabels', group: 'graphics' }),
  D({ id: 'defaultLineWidth', scope: 'file', type: { k: 'int', min: 1, max: 13 }, default: (m) => m.defaults.lineWidth, label: 'setting.defaultLineWidth', group: 'graphics' }),
  D({ id: 'defaultPointSize', scope: 'file', type: { k: 'int', min: 1, max: 9 }, default: (m) => m.defaults.pointSize, label: 'setting.defaultPointSize', group: 'graphics' }),
  D({ id: 'fontSize', scope: 'user', type: { k: 'int', min: 10, max: 40 }, default: 16, label: 'setting.fontSize', group: 'graphics' }),
  D({ id: 'sort', scope: 'user', type: { k: 'enum', values: ['creation', 'type', 'dependency', 'layer'] }, default: 'creation', label: 'setting.sort', group: 'algebra' }),
  D({ id: 'description', scope: 'user', type: { k: 'enum', values: ['value', 'definition', 'both'] }, default: 'value', label: 'setting.description', group: 'algebra' }),
  D({ id: 'keyboard', scope: 'user', type: { k: 'enum', values: ['auto', 'on', 'off'] }, default: 'auto', label: 'setting.keyboard', group: 'keyboard' }),
  D({ id: 'keyboardLayout', scope: 'user', type: { k: 'enum', values: ['auto', 'standard', 'scientific', 'notes', 'geometry', 'probability'] }, default: 'auto', label: 'setting.keyboardLayout', group: 'keyboard' }),
  D({ id: 'reducedMotion', scope: 'user', type: { k: 'enum', values: ['system', 'on', 'off'] }, default: 'system', label: 'setting.reducedMotion', group: 'accessibility' }),
  D({ id: 'highContrast', scope: 'user', type: { k: 'bool' }, default: false, label: 'setting.highContrast', group: 'accessibility' }),
  D({ id: 'textScale', scope: 'user', type: { k: 'int', min: 80, max: 200 }, default: 100, label: 'setting.textScale', group: 'accessibility' }),
  D({ id: 'screenReaderMode', scope: 'user', type: { k: 'bool' }, default: false, label: 'setting.screenReaderMode', group: 'accessibility' }),
  D({ id: 'masterVolume', scope: 'user', type: { k: 'int', min: 0, max: 100 }, default: 80, label: 'setting.masterVolume', group: 'sound' }),
  D({ id: 'soundOnStart', scope: 'user', type: { k: 'bool' }, default: false, label: 'setting.soundOnStart', group: 'sound' }),
  D({ id: 'theme', scope: 'user', type: { k: 'enum', values: ['system', 'light', 'dark'] }, default: 'system', label: 'setting.theme', group: 'accessibility' }),
  D({ id: 'language', scope: 'user', type: { k: 'string', max: 20 }, default: 'auto', label: 'setting.language', group: 'language' }),
  D({ id: 'decimalSeparator', scope: 'user', type: { k: 'enum', values: ['auto', '.', ','] }, default: 'auto', label: 'setting.decimalSeparator', group: 'language' }),
];

const BY_ID = new Map(SETTINGS.map((s) => [s.id, s]));

export function settingDef(id: SettingId): SettingDef | undefined {
  return BY_ID.get(id);
}

/** The minimal storage this needs: `localStorage` and `sessionStorage` fit. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEY = 'incantly.settings.v1';
const STORAGE_VERSION = 1;

export type SetResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly kind: 'unknown_setting' | 'setting_invalid' | 'setting_locked'; readonly message: string; readonly hint?: string; readonly allowed?: readonly string[]; readonly closest?: readonly string[] };

/** A problem with storage, reported once and never fatal (errors 4). */
export interface SettingsProblem {
  readonly kind: 'storage_unavailable' | 'storage_corrupt';
  readonly message: string;
}

/** Checks a value against a setting's type; returns the value to store, or why it is wrong. */
export function validateSetting(def: SettingDef, v: unknown): { ok: true; value: unknown } | { ok: false; why: string; allowed?: readonly string[] } {
  const t = def.type;
  switch (t.k) {
    case 'bool':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, why: 'true or false' };
    case 'enum':
      return typeof v === 'string' && t.values.includes(v) ? { ok: true, value: v } : { ok: false, why: `one of ${t.values.join(', ')}`, allowed: t.values };
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= t.min && v <= t.max ? { ok: true, value: v } : { ok: false, why: `a whole number from ${t.min} to ${t.max}` };
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= t.min && v <= t.max ? { ok: true, value: v } : { ok: false, why: `a number from ${t.min} to ${t.max}` };
    case 'color':
      return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, why: 'a colour like #2f6fdb' };
    case 'string':
      return typeof v === 'string' && v.length <= t.max ? { ok: true, value: v } : { ok: false, why: `a text of at most ${t.max} characters` };
    case 'rounding': {
      const r = v as Partial<Rounding> | null;
      const ok = r !== null && typeof r === 'object' && (r.mode === 'decimals' || r.mode === 'sig') && typeof r.digits === 'number' && Number.isInteger(r.digits) && r.digits <= 15 && r.digits >= (r.mode === 'sig' ? 1 : 0);
      return ok ? { ok: true, value: { mode: r.mode, digits: r.digits } } : { ok: false, why: '0 to 15 decimal places, or 1 to 15 significant digits' };
    }
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The text of a file setting as its directive line, or undefined when it has none. */
export function directiveLine(def: SettingDef, v: unknown): string | undefined {
  if (!def.directive) return undefined;
  switch (def.id) {
    case 'rounding': {
      const r = v as Rounding;
      return `@rounding ${r.digits}${r.mode === 'sig' ? 's' : ''}`;
    }
    case 'axes':
    case 'snapToGrid':
      return `@${def.directive} ${v ? 'on' : 'off'}`;
    case 'grid':
      return v === 'none' ? '@grid off' : `@grid ${String(v)}`;
    default:
      return `@${def.directive} ${String(v)}`;
  }
}

/** Reads a directive line back into a setting and value; undefined when it is not a setting line. */
export function settingFromDirective(line: string): { id: SettingId; value: unknown } | undefined {
  const m = /^@([a-z]+)\s+(\S+)\s*$/.exec(line.trim());
  if (!m) return undefined;
  const [, name, word] = m as unknown as [string, string, string];
  switch (name) {
    case 'angleunit':
      return { id: 'angleUnit', value: word };
    case 'coords':
      return { id: 'coordinates', value: word };
    case 'rounding': {
      const r = /^(\d+)(s?)$/.exec(word);
      return r ? { id: 'rounding', value: { mode: r[2] ? 'sig' : 'decimals', digits: Number(r[1]) } } : undefined;
    }
    case 'axes':
      return { id: 'axes', value: word === 'on' };
    case 'snap':
      return { id: 'snapToGrid', value: word === 'on' };
    case 'grid':
      return { id: 'grid', value: word === 'off' ? 'none' : word === 'on' ? 'major' : word };
    default:
      return undefined;
  }
}

type Listener = (id: SettingId, v: unknown) => void;

export interface SettingsOptions {
  readonly mode: ModeConfig;
  /** The learner's own storage (`localStorage`); none keeps user settings in memory only. */
  readonly storage?: StorageLike | null;
}

export class Settings {
  private mode: ModeConfig;
  private readonly storage: StorageLike | null;
  private readonly values = new Map<SettingId, unknown>();
  private readonly locks = new Map<SettingId, string>();
  private readonly listeners = new Map<SettingId | '*', Set<Listener>>();
  /** Storage problems found so far (each kind once). */
  readonly problems: SettingsProblem[] = [];

  constructor(opts: SettingsOptions) {
    this.mode = opts.mode;
    this.storage = opts.storage ?? null;
    if (opts.storage === undefined || opts.storage === null) this.problem('storage_unavailable', 'Settings will not be saved on this device.');
    this.load();
  }

  /** The value in force: the explicit one, or the mode's default. */
  get<T = unknown>(id: SettingId): T {
    if (this.values.has(id)) return this.values.get(id) as T;
    return this.defaultOf(id) as T;
  }

  defaultOf(id: SettingId): unknown {
    const def = BY_ID.get(id);
    if (!def) return undefined;
    return typeof def.default === 'function' ? (def.default as (m: ModeConfig) => unknown)(this.mode) : def.default;
  }

  /** True when the value differs from the default (the panel shows a reset arrow). */
  isChanged(id: SettingId): boolean {
    return this.values.has(id) && !same(this.values.get(id), this.defaultOf(id));
  }

  set(id: SettingId, value: unknown): SetResult {
    const def = BY_ID.get(id);
    if (!def) {
      const close = [...BY_ID.keys()].filter((k) => k.toLowerCase().includes(id.toLowerCase().slice(0, 4)));
      return { ok: false, kind: 'unknown_setting', message: `There is no setting called '${id}'.`, closest: close.slice(0, 3), ...(close.length > 0 ? { hint: `Did you mean ${close[0]}?` } : {}) };
    }
    const lockedBy = this.locks.get(id);
    if (lockedBy !== undefined) return { ok: false, kind: 'setting_locked', message: `${id} is locked by ${lockedBy}.`, hint: 'It can change again after the exam.' };
    const v = validateSetting(def, value);
    if (!v.ok) return { ok: false, kind: 'setting_invalid', message: `${id} must be ${v.why}.`, ...(v.allowed ? { allowed: v.allowed } : {}) };
    const before = this.get(id);
    this.values.set(id, v.value);
    if (def.scope === 'user') this.save();
    const changed = !same(before, v.value);
    if (changed) this.emit(id, v.value);
    return { ok: true, changed };
  }

  /** Back to the mode's defaults: one group, or everything. Locked settings stay. */
  reset(group?: SettingGroup): void {
    for (const def of SETTINGS) {
      if (group && def.group !== group) continue;
      if (this.locks.has(def.id) || !this.values.has(def.id)) continue;
      const before = this.get(def.id);
      this.values.delete(def.id);
      if (!same(before, this.get(def.id))) this.emit(def.id, this.get(def.id));
    }
    this.save();
  }

  resetOne(id: SettingId): void {
    if (this.locks.has(id) || !this.values.has(id)) return;
    this.values.delete(id);
    this.save();
    this.emit(id, this.get(id));
  }

  onChange(id: SettingId | '*', fn: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => set?.delete(fn);
  }

  /** Every explicit value (used by the exam). */
  snapshot(): SettingValues {
    return Object.fromEntries(this.values);
  }

  restore(s: SettingValues): void {
    const ids = new Set([...this.values.keys(), ...Object.keys(s)]);
    const before = new Map([...ids].map((id) => [id, this.get(id)]));
    this.values.clear();
    for (const [id, v] of Object.entries(s)) {
      const def = BY_ID.get(id);
      if (def && validateSetting(def, v).ok) this.values.set(id, v);
    }
    this.save();
    for (const id of ids) if (!same(before.get(id), this.get(id))) this.emit(id, this.get(id));
  }

  /** Locks settings (an exam); `by` is shown with the padlock. */
  lock(ids: readonly SettingId[], by: string): void {
    for (const id of ids) this.locks.set(id, by);
  }

  unlock(ids?: readonly SettingId[]): void {
    for (const id of ids ?? [...this.locks.keys()]) this.locks.delete(id);
  }

  lockedBy(id: SettingId): string | undefined {
    return this.locks.get(id);
  }

  /** A new mode changes the defaults; explicit values stay. */
  setMode(mode: ModeConfig): void {
    const before = new Map(SETTINGS.map((d) => [d.id, this.get(d.id)]));
    this.mode = mode;
    for (const d of SETTINGS) if (!same(before.get(d.id), this.get(d.id))) this.emit(d.id, this.get(d.id));
  }

  /** The settings the mode's panel offers, by group, in table order. */
  panel(): { group: SettingGroup; defs: SettingDef[] }[] {
    const offered = new Set(this.mode.settings);
    const groups: SettingGroup[] = ['general', 'graphics', 'algebra', 'sheet', 'keyboard', 'sound', 'accessibility', 'language'];
    return groups.map((group) => ({ group, defs: SETTINGS.filter((d) => d.group === group && offered.has(d.id)) })).filter((g) => g.defs.length > 0);
  }

  /** File settings that differ from the mode's defaults, as directive lines (design 3.8: scripts reproduce them). */
  toDirectives(): string[] {
    const out: string[] = [];
    for (const def of SETTINGS) {
      if (def.scope !== 'file' || !this.isChanged(def.id)) continue;
      const line = directiveLine(def, this.get(def.id));
      if (line) out.push(line);
    }
    return out;
  }

  /** Reads the setting lines of a script; other lines are ignored. Returns the ids read. */
  fromDirectives(lines: readonly string[]): SettingId[] {
    const read: SettingId[] = [];
    for (const l of lines) {
      const s = settingFromDirective(l);
      if (!s) continue;
      const def = BY_ID.get(s.id);
      if (!def || !validateSetting(def, s.value).ok) continue;
      const before = this.get(s.id);
      this.values.set(s.id, s.value);
      read.push(s.id);
      if (!same(before, s.value)) this.emit(s.id, s.value);
    }
    return read;
  }

  /* ------------------------------ storage ------------------------------ */

  private problem(kind: SettingsProblem['kind'], message: string): void {
    if (!this.problems.some((p) => p.kind === kind)) this.problems.push({ kind, message });
  }

  private load(): void {
    if (!this.storage) return;
    let raw: string | null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      this.problem('storage_unavailable', 'Settings will not be saved on this device.');
      return;
    }
    if (raw === null) return;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = undefined;
    }
    const rec = data as { v?: unknown; values?: Record<string, unknown> } | undefined;
    if (!rec || typeof rec !== 'object' || rec.v !== STORAGE_VERSION || typeof rec.values !== 'object' || rec.values === null) {
      // keep the bad record under another key rather than deleting it
      try {
        this.storage.setItem(`${STORAGE_KEY}.bad`, raw);
        this.storage.removeItem(STORAGE_KEY);
      } catch {
        // nothing more to do
      }
      this.problem('storage_corrupt', 'Saved settings could not be read; the defaults are used.');
      return;
    }
    for (const [id, v] of Object.entries(rec.values)) {
      const def = BY_ID.get(id);
      if (def?.scope === 'user' && validateSetting(def, v).ok) this.values.set(id, v);
    }
  }

  private save(): void {
    if (!this.storage) return;
    const values = Object.fromEntries([...this.values].filter(([id]) => BY_ID.get(id)?.scope === 'user'));
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, values }));
    } catch {
      this.problem('storage_unavailable', 'Settings will not be saved on this device.');
    }
  }

  private emit(id: SettingId, v: unknown): void {
    for (const key of [id, '*'] as const) {
      for (const fn of [...(this.listeners.get(key) ?? [])]) {
        try {
          fn(id, v);
        } catch {
          // a broken listener must not stop the others
        }
      }
    }
  }
}

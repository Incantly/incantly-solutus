/**
 * Languages (app-modes design 3.9; errors 5): UI text from a catalogue per locale with plurals and a fallback chain,
 * numbers in the locale's format, right-to-left direction, and other digit scripts read as Latin digits. Lines of the
 * figure language stay English and always use `.` for decimals.
 */
import { en } from './locales/en';

export type Message = string | { readonly one: string; readonly other: string };
export type Catalogue = Readonly<Record<string, Message>>;

/** Locales bundled with the app, by native name. `en` is always loaded; the rest load on demand. */
export const LOCALES: readonly { readonly id: string; readonly name: string; readonly dir: 'ltr' | 'rtl' }[] = [
  { id: 'ar', name: 'العربية', dir: 'rtl' },
  { id: 'en', name: 'English', dir: 'ltr' },
  { id: 'fr', name: 'Français', dir: 'ltr' },
];

const LOADERS: Record<string, () => Promise<Catalogue>> = {
  en: () => Promise.resolve(en),
  fr: () => import('./locales/fr').then((m) => m.fr),
  ar: () => import('./locales/ar').then((m) => m.ar),
};

const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

/** `fr-CA` -> `['fr-CA', 'fr', 'en']`. */
export function localeChain(locale: string): string[] {
  const out: string[] = [];
  const parts = locale.split('-');
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('-'));
  if (!out.includes('en')) out.push('en');
  return out;
}

export function directionOf(locale: string): 'ltr' | 'rtl' {
  return RTL.has(locale.split('-')[0]?.toLowerCase() ?? '') ? 'rtl' : 'ltr';
}

/** Arabic-Indic, Eastern Arabic-Indic and Devanagari digits become Latin digits; the Arabic decimal mark becomes `.`. */
export function normaliseDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/\u066B/g, '.');
}

export interface I18nOptions {
  readonly locale?: string;
  /** Told once per missing key (development builds raise it in tests). */
  readonly onMissing?: (key: string, locale: string) => void;
}

export class I18n {
  private locale = 'en';
  private chain: string[] = ['en'];
  private readonly loaded = new Map<string, Catalogue>([['en', en]]);
  private readonly warned = new Set<string>();
  private readonly onMissing: ((key: string, locale: string) => void) | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(opts: I18nOptions = {}) {
    this.onMissing = opts.onMissing;
    if (opts.locale) this.useLoaded(opts.locale);
  }

  get current(): string {
    return this.locale;
  }

  get dir(): 'ltr' | 'rtl' {
    return directionOf(this.locale);
  }

  /** Loads the locale (and its fallbacks) and switches to it. Resolves to the locale actually used. */
  async setLocale(locale: string): Promise<{ readonly used: string; readonly fellBack: boolean; readonly error?: 'locale_unavailable' | 'locale_load_failed' }> {
    const chain = localeChain(locale);
    let first: string | undefined;
    let failed = false;
    for (const id of chain) {
      if (this.loaded.has(id)) {
        first ??= id;
        continue;
      }
      const load = LOADERS[id];
      if (!load) continue;
      try {
        this.loaded.set(id, await load());
        first ??= id;
      } catch {
        failed = true;
      }
    }
    if (failed && first === 'en' && locale !== 'en') return { used: this.locale, fellBack: true, error: 'locale_load_failed' };
    const used = first ?? 'en';
    this.useLoaded(locale);
    for (const fn of [...this.listeners]) fn();
    return { used, fellBack: used !== locale, ...(used !== locale && used === 'en' ? { error: 'locale_unavailable' as const } : {}) };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private useLoaded(locale: string): void {
    this.locale = locale;
    this.chain = localeChain(locale);
  }

  /** The text of `key`, with `{name}` filled in. `n` picks the plural form. Missing keys show English, then the key. */
  t(key: string, params: Readonly<Record<string, string | number>> = {}): string {
    let msg: Message | undefined;
    let from = '';
    for (const id of this.chain) {
      const m = this.loaded.get(id)?.[key];
      if (m !== undefined) {
        msg = m;
        from = id;
        break;
      }
    }
    if (msg === undefined || (from === 'en' && this.locale.split('-')[0] !== 'en')) this.missing(key);
    if (msg === undefined) return key;
    let text: string;
    if (typeof msg === 'string') text = msg;
    else {
      const n = Number(params['n'] ?? 0);
      const rule = new Intl.PluralRules(from || 'en').select(n);
      text = rule === 'one' ? msg.one : msg.other;
    }
    return text.replace(/\{(\w+)\}/g, (all, name: string) => (params[name] !== undefined ? this.paramText(params[name] as string | number) : all));
  }

  private paramText(v: string | number): string {
    return typeof v === 'number' ? this.formatNumber(v) : v;
  }

  private missing(key: string): void {
    const tag = `${this.locale}:${key}`;
    if (this.warned.has(tag)) return;
    this.warned.add(tag);
    this.onMissing?.(key, this.locale);
  }

  /** A number in the locale's format, or with an explicit decimal separator. Display only: lines keep `.`. */
  formatNumber(x: number, opts: { readonly decimalSeparator?: 'auto' | '.' | ','; readonly maximumFractionDigits?: number } = {}): string {
    const nf = new Intl.NumberFormat(this.locale, { maximumFractionDigits: opts.maximumFractionDigits ?? 10, useGrouping: false, numberingSystem: 'latn' });
    const text = nf.format(x);
    const sep = opts.decimalSeparator ?? 'auto';
    if (sep === 'auto') return text;
    return text.replace(/[.,٫]/g, sep);
  }

  /** The decimal mark the locale uses. */
  decimalMark(): string {
    const parts = new Intl.NumberFormat(this.locale).formatToParts(1.5);
    return parts.find((p) => p.type === 'decimal')?.value ?? '.';
  }
}

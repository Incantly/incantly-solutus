/**
 * Themes (design 10, "Theme"): CSS custom properties on the board's element, so the host's own styles win. Light, dark and
 * high contrast are built in; a host gives `theme: 'dark'` or `theme: { base: 'dark', vars: { accent: '#f59e0b' } }`. A
 * variable name may be given with or without the `--ib-` prefix.
 */

export type ThemeName = 'light' | 'dark' | 'highContrast';
export type ThemeOption = ThemeName | { readonly base?: ThemeName; readonly vars?: Readonly<Record<string, string>> };

const COMMON: Readonly<Record<string, string>> = {
  '--ib-radius': '10px',
  '--ib-font': 'system-ui, sans-serif',
  '--ib-tool-size': '34px',
};

export const THEMES: Readonly<Record<ThemeName, Readonly<Record<string, string>>>> = {
  light: {
    ...COMMON,
    '--ib-bg': '#fbfbfa',
    '--ib-fg': '#1f2430',
    '--ib-panel': '#ffffff',
    '--ib-border': '#d5d7dd',
    '--ib-hover': '#eef0f4',
    '--ib-accent': '#4f46e5',
    '--ib-accent-soft': '#e0e7ff',
    '--ib-accent-line': '#a5b4fc',
    '--ib-shadow': 'rgba(15,23,42,.14)',
    '--ib-muted': '#5b6472',
  },
  dark: {
    ...COMMON,
    '--ib-bg': '#161a22',
    '--ib-fg': '#e8eaf0',
    '--ib-panel': '#232834',
    '--ib-border': '#3a4150',
    '--ib-hover': '#2f3644',
    '--ib-accent': '#8b93ff',
    '--ib-accent-soft': '#343b66',
    '--ib-accent-line': '#5560d6',
    '--ib-shadow': 'rgba(0,0,0,.5)',
    '--ib-muted': '#a3abbb',
  },
  highContrast: {
    ...COMMON,
    '--ib-bg': '#ffffff',
    '--ib-fg': '#000000',
    '--ib-panel': '#ffffff',
    '--ib-border': '#000000',
    '--ib-hover': '#ffff99',
    '--ib-accent': '#0000cc',
    '--ib-accent-soft': '#cfe0ff',
    '--ib-accent-line': '#0000cc',
    '--ib-shadow': 'rgba(0,0,0,.6)',
    '--ib-muted': '#000000',
  },
};

const NAMES = Object.keys(THEMES);

/** The name and the variables of a theme option. A name that is not one of the three is `light`; a bad variable is dropped. */
export function themeVars(option: ThemeOption | undefined): { readonly name: string; readonly vars: Readonly<Record<string, string>> } {
  const base: ThemeName = typeof option === 'string' ? (NAMES.includes(option) ? option : 'light') : option?.base !== undefined && NAMES.includes(option.base) ? option.base : 'light';
  const vars: Record<string, string> = { ...THEMES[base] };
  if (typeof option === 'object') {
    for (const [name, value] of Object.entries(option.vars ?? {})) {
      if (typeof value !== 'string' || value === '' || !/^(--)?[a-z][\w-]*$/i.test(name)) continue;
      vars[name.startsWith('--') ? name : `--ib-${name}`] = value;
    }
  }
  return { name: base, vars };
}

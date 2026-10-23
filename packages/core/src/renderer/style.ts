/**
 * How an integrator styles figures: a ready look (preset), design tokens,
 * class names per part of the figure (for utility CSS such as Tailwind),
 * trusted CSS of their own, the layout of controls around the drawing, the
 * drawing's size, and which parts show. It travels to sandboxed frames as
 * plain data and is checked again there, so it can carry nothing but names,
 * lengths and colours.
 */

/** Card looks (glass, minimal, outline, soft), a high-contrast one, and whole palettes (paper, blueprint, sepia). */
export type StylePreset = 'default' | 'glass' | 'minimal' | 'outline' | 'contrast' | 'soft' | 'paper' | 'blueprint' | 'sepia';

/** Every element of the figure an integrator can add classes to. */
export type StyleSlot =
  | 'figure'
  | 'header'
  | 'title'
  | 'hint'
  | 'idea'
  | 'body'
  | 'scene'
  | 'stage'
  | 'panel'
  | 'controls'
  | 'params'
  | 'param'
  | 'label'
  | 'slider'
  | 'number'
  | 'switch'
  | 'select'
  | 'segmented'
  | 'button'
  | 'primary'
  | 'chip'
  | 'transport'
  | 'settings'
  | 'readouts'
  | 'readout'
  | 'legend'
  | 'formula'
  | 'table'
  | 'steps'
  | 'predict'
  | 'zoombar'
  | 'description';

export const STYLE_SLOTS: readonly StyleSlot[] = [
  'figure',
  'header',
  'title',
  'hint',
  'idea',
  'body',
  'scene',
  'stage',
  'panel',
  'controls',
  'params',
  'param',
  'label',
  'slider',
  'number',
  'switch',
  'select',
  'segmented',
  'button',
  'primary',
  'chip',
  'transport',
  'settings',
  'readouts',
  'readout',
  'legend',
  'formula',
  'table',
  'steps',
  'predict',
  'zoombar',
  'description',
];

/** The CSS selector of each slot inside a figure. */
export const SLOT_SELECTORS: Readonly<Record<StyleSlot, string>> = {
  figure: ':scope',
  header: '.inc-header',
  title: '.inc-title',
  hint: '.inc-hint',
  idea: '.inc-idea',
  body: '.inc-body',
  scene: '.inc-scene',
  stage: 'svg.inc-stage',
  panel: '.inc-panel',
  controls: '.inc-controls',
  params: '.inc-params',
  param: '.inc-param',
  label: '.inc-param__label',
  slider: 'input[type=range]',
  number: 'input[type=number]',
  switch: '.inc-switch',
  select: 'select',
  segmented: '.inc-segmented',
  button: 'button',
  primary: '.inc-primary',
  chip: '.inc-chip',
  transport: '.inc-transport',
  settings: '.inc-settings',
  readouts: '.inc-readouts',
  readout: '.inc-readout',
  legend: '.inc-legend',
  formula: '.inc-formula',
  table: '.inc-table',
  steps: '.inc-steps',
  predict: '.inc-predict',
  zoombar: '.inc-zoombar',
  description: '.inc-description',
};

export type ControlsPlacement = 'below' | 'above' | 'right' | 'left' | 'overlay';

export interface FigureLayout {
  /** Where the controls and readouts sit relative to the drawing. Narrow figures stack them below. */
  readonly controls?: ControlsPlacement;
  /** Height of each drawing: a CSS length such as `360px` or `50vh`; by default it follows the drawing's shape. */
  readonly sceneHeight?: string;
  /** Widest the figure grows: a CSS length. */
  readonly maxWidth?: string;
  readonly align?: 'start' | 'center' | 'end' | 'stretch';
  readonly density?: 'compact' | 'comfortable' | 'spacious';
  /** Size of controls and text. */
  readonly size?: 'sm' | 'md' | 'lg';
  /** Width of the side panel when controls sit left or right: a CSS length. */
  readonly panelWidth?: string;
}

export type ShowPart =
  | 'header'
  | 'idea'
  | 'readouts'
  | 'legend'
  | 'controls'
  | 'transport'
  | 'speed'
  | 'settings'
  | 'undo'
  | 'fullscreen'
  | 'steps'
  | 'description'
  | 'zoom'
  | 'partInfo';

export interface FigureStyle {
  readonly preset?: StylePreset;
  /**
   * Design tokens, without the `--inc-` prefix: colours (`bg`, `fg`, `muted`,
   * `line`, `card`, `lit`, `a`, `b`, `c`, `focus`, `danger`), `radius`,
   * `radius-sm`, `font`, `font-size`, `gap`, `pad`, `control-height`,
   * `border-width`, `shadow`, `surface`, `button-bg`, `scene-bg`, and `blur`
   * (the glass preset's backdrop blur). Values are plain CSS values: colours,
   * lengths, font lists. See docs/sdk/styling.md.
   */
  readonly tokens?: Readonly<Record<string, string>>;
  /** Extra classes per slot, for utility CSS such as Tailwind. */
  readonly classNames?: Readonly<Partial<Record<StyleSlot, string>>>;
  /**
   * Trusted CSS from the host, such as its compiled Tailwind stylesheet. In
   * the sandbox it is added to the frame and allowed by its hash; nothing in
   * it can reach the network.
   */
  readonly css?: string;
  readonly layout?: FigureLayout;
  readonly show?: Readonly<Partial<Record<ShowPart, boolean>>>;
}

/** A style checked and reduced to what the renderer applies. */
export interface ResolvedStyle {
  readonly preset: StylePreset;
  readonly tokens: Readonly<Record<string, string>>;
  readonly classNames: Readonly<Partial<Record<StyleSlot, string>>>;
  readonly layout: Required<Omit<FigureLayout, 'sceneHeight' | 'maxWidth' | 'panelWidth'>> & Pick<FigureLayout, 'sceneHeight' | 'maxWidth' | 'panelWidth'>;
  readonly show: Readonly<Record<ShowPart, boolean>>;
}

const PRESETS: readonly StylePreset[] = ['default', 'glass', 'minimal', 'outline', 'contrast', 'soft', 'paper', 'blueprint', 'sepia'];
const PLACEMENTS: readonly ControlsPlacement[] = ['below', 'above', 'right', 'left', 'overlay'];
const SHOW_DEFAULTS: Readonly<Record<ShowPart, boolean>> = {
  header: true,
  idea: true,
  readouts: true,
  legend: true,
  controls: true,
  transport: true,
  speed: true,
  settings: true,
  undo: true,
  fullscreen: true,
  steps: true,
  description: true,
  zoom: true,
  partInfo: true,
};

/** Token names: lower-case words joined by hyphens. */
const TOKEN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/**
 * Token values: what colours, lengths, shadows and font lists need, and
 * nothing that can end a declaration, open a block, load a resource or
 * escape: no `;`, braces, `<`, backslash, `url(`, `image(`, `@` or `!`.
 */
const TOKEN_VALUE = /^[\w\s#%.,()'"+\-*/]{1,160}$/;
const FORBIDDEN_VALUE = /url\(|image\(|image-set\(|expression\(|attr\(|src\(|var\(--(?!inc-)/i;
/** Class lists: utility classes such as `bg-white/20`, `hover:shadow`, `[--x:1px]`, `!px-2`. */
const CLASS_TOKEN = /^[\w\-:/.[\]%#()!@,=&*+~'"]{1,120}$/;
const LENGTH = /^(?:\d+(?:\.\d+)?(?:px|rem|em|vh|vw|svh|dvh|%|ch)|auto|none)$/;

/** Checks a style and fills in defaults. Anything that does not pass is dropped, never trusted. */
export function resolveStyle(style: FigureStyle | undefined): ResolvedStyle {
  const s = isRecord(style) ? style : {};
  const preset = PRESETS.includes(s.preset as StylePreset) ? (s.preset as StylePreset) : 'default';
  const tokens: Record<string, string> = {};
  if (isRecord(s.tokens)) {
    for (const [name, value] of Object.entries(s.tokens).slice(0, 64)) {
      if (TOKEN_NAME.test(name) && typeof value === 'string' && TOKEN_VALUE.test(value) && !FORBIDDEN_VALUE.test(value)) tokens[name] = value.trim();
    }
  }
  const classNames: Partial<Record<StyleSlot, string>> = {};
  if (isRecord(s.classNames)) {
    for (const slot of STYLE_SLOTS) {
      const value = (s.classNames as Record<string, unknown>)[slot];
      if (typeof value !== 'string') continue;
      const classes = value.split(/\s+/).filter((c) => c !== '' && CLASS_TOKEN.test(c)).slice(0, 40);
      if (classes.length > 0) classNames[slot] = classes.join(' ');
    }
  }
  const layout = isRecord(s.layout) ? s.layout : {};
  const length = (value: unknown) => (typeof value === 'string' && LENGTH.test(value.trim()) ? value.trim() : undefined);
  const sceneHeight = length(layout.sceneHeight);
  const maxWidth = length(layout.maxWidth);
  const panelWidth = length(layout.panelWidth);
  const show: Record<ShowPart, boolean> = { ...SHOW_DEFAULTS };
  if (isRecord(s.show)) {
    for (const key of Object.keys(SHOW_DEFAULTS) as ShowPart[]) {
      const value = (s.show as Record<string, unknown>)[key];
      if (typeof value === 'boolean') show[key] = value;
    }
  }
  return {
    preset,
    tokens,
    classNames,
    layout: {
      controls: PLACEMENTS.includes(layout.controls as ControlsPlacement) ? (layout.controls as ControlsPlacement) : 'below',
      align: (['start', 'center', 'end', 'stretch'] as const).includes(layout.align as 'start') ? (layout.align as 'start') : 'stretch',
      density: (['compact', 'comfortable', 'spacious'] as const).includes(layout.density as 'compact') ? (layout.density as 'compact') : 'comfortable',
      size: (['sm', 'md', 'lg'] as const).includes(layout.size as 'sm') ? (layout.size as 'sm') : 'md',
      ...(sceneHeight ? { sceneHeight } : {}),
      ...(maxWidth ? { maxWidth } : {}),
      ...(panelWidth ? { panelWidth } : {}),
    },
    show,
  };
}

/**
 * Only the valid parts of a style that were actually given, without defaults
 * or CSS: what a document may store about one figure's look, since documents
 * travel between people and must not carry stylesheets.
 */
export function checkStyle(style: unknown): FigureStyle {
  if (!isRecord(style)) return {};
  const given = style as FigureStyle;
  const resolved = resolveStyle(given);
  const out: { -readonly [K in keyof FigureStyle]?: FigureStyle[K] } = {};
  if (given.preset !== undefined && resolved.preset === given.preset) out.preset = resolved.preset;
  if (Object.keys(resolved.tokens).length > 0) out.tokens = resolved.tokens;
  if (Object.keys(resolved.classNames).length > 0) out.classNames = resolved.classNames;
  if (isRecord(given.layout)) {
    const layout: Record<string, string> = {};
    for (const key of Object.keys(given.layout)) {
      const value = (resolved.layout as Record<string, string | undefined>)[key];
      if (value !== undefined && value === (given.layout as Record<string, unknown>)[key]) layout[key] = value;
    }
    if (Object.keys(layout).length > 0) out.layout = layout as FigureLayout;
  }
  if (isRecord(given.show)) {
    const show: Partial<Record<ShowPart, boolean>> = {};
    for (const key of Object.keys(SHOW_DEFAULTS) as ShowPart[]) {
      if (typeof (given.show as Record<string, unknown>)[key] === 'boolean') show[key] = resolved.show[key];
    }
    if (Object.keys(show).length > 0) out.show = show;
  }
  return out;
}

/** One style over another: the second wins field by field; classes add up; the first keeps its CSS. */
export function mergeStyles(base: FigureStyle | undefined, over: FigureStyle | undefined): FigureStyle | undefined {
  if (!over) return base;
  if (!base) return over;
  const classNames: Partial<Record<StyleSlot, string>> = { ...base.classNames };
  for (const [slot, classes] of Object.entries(over.classNames ?? {}) as Array<[StyleSlot, string]>) {
    classNames[slot] = [classNames[slot], classes].filter(Boolean).join(' ');
  }
  const preset = over.preset ?? base.preset;
  const css = over.css ?? base.css;
  return {
    ...(preset ? { preset } : {}),
    tokens: { ...base.tokens, ...over.tokens },
    classNames,
    layout: { ...base.layout, ...over.layout },
    show: { ...base.show, ...over.show },
    ...(css !== undefined ? { css } : {}),
  };
}

/**
 * The style as plain data for the bridge: everything but the host CSS, which
 * goes into the frame document itself under the content security policy.
 */
export function styleForBridge(style: FigureStyle | undefined): FigureStyle | undefined {
  if (!style) return undefined;
  const resolved = resolveStyle(style);
  const sceneHeight = hostViewportLength(resolved.layout.sceneHeight);
  const layout = sceneHeight ? { ...resolved.layout, sceneHeight } : resolved.layout;
  return { preset: resolved.preset, tokens: resolved.tokens, classNames: resolved.classNames, layout, show: resolved.show };
}

/**
 * A sandboxed frame grows to fit what it draws, so inside it a viewport
 * height is the frame's own: a scene 70vh tall makes the frame taller, which
 * makes the scene taller, up to the frame's cap. The host resolves it against
 * its own window before the style crosses into the frame.
 */
export function hostViewportLength(length: string | undefined, height = typeof globalThis.innerHeight === 'number' ? globalThis.innerHeight : 0): string | undefined {
  const match = length ? /^(\d+(?:\.\d+)?)(?:vh|svh|dvh)$/.exec(length) : null;
  if (!match || !(height > 0)) return length;
  return `${Math.round((Number(match[1]) * height) / 100)}px`;
}

/** Host CSS a frame can carry: a stylesheet with nothing that could close the style element. */
export function hostCss(style: FigureStyle | undefined): string {
  const css = typeof style?.css === 'string' ? style.css : '';
  if (css.length > 200_000 || /<\/?\s*style|<!--|-->/i.test(css)) return '';
  return css.replace(/</g, '\\3c ');
}

/** Puts a resolved style on a figure root: data attributes, CSS variables and slot classes. */
export function applyStyle(root: HTMLElement, style: ResolvedStyle): void {
  root.dataset.preset = style.preset;
  root.dataset.layout = style.layout.controls;
  root.dataset.align = style.layout.align;
  root.dataset.density = style.layout.density;
  root.dataset.size = style.layout.size;
  for (const [name, value] of Object.entries(style.tokens)) root.style.setProperty(`--inc-${name}`, value);
  if (style.layout.sceneHeight) root.style.setProperty('--inc-scene-height', style.layout.sceneHeight);
  if (style.layout.maxWidth) root.style.setProperty('--inc-max-width', style.layout.maxWidth);
  if (style.layout.panelWidth) root.style.setProperty('--inc-panel-width', style.layout.panelWidth);
  for (const [part, shown] of Object.entries(style.show)) if (!shown) root.dataset[`hide${part.charAt(0).toUpperCase()}${part.slice(1)}`] = '';
  applySlotClasses(root, style);
}

/** Takes a style off a figure root before another goes on. Classes the SDK owns (inc-…) stay. */
export function clearStyle(root: HTMLElement, style: ResolvedStyle): void {
  for (const name of Object.keys(style.tokens)) root.style.removeProperty(`--inc-${name}`);
  for (const name of ['--inc-scene-height', '--inc-max-width', '--inc-panel-width']) root.style.removeProperty(name);
  for (const part of Object.keys(style.show)) delete root.dataset[`hide${part.charAt(0).toUpperCase()}${part.slice(1)}`];
  for (const [slot, classes] of Object.entries(style.classNames) as Array<[StyleSlot, string]>) {
    const list = classes.split(' ').filter((c) => !c.startsWith('inc-'));
    const targets = slot === 'figure' ? [root] : [...root.querySelectorAll<Element>(SLOT_SELECTORS[slot])];
    for (const target of targets) target.classList.remove(...list);
  }
}

/** Adds the integrator's classes to every slot element now in the figure. Safe to call again after the DOM changes. */
export function applySlotClasses(root: HTMLElement, style: ResolvedStyle): void {
  for (const [slot, classes] of Object.entries(style.classNames) as Array<[StyleSlot, string]>) {
    const list = classes.split(' ');
    const targets = slot === 'figure' ? [root] : [...root.querySelectorAll<Element>(SLOT_SELECTORS[slot])];
    for (const target of targets) {
      if (slot === 'button' && target.closest('.inc-zoombar')) continue;
      if (!list.every((c) => target.classList.contains(c))) target.classList.add(...list);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

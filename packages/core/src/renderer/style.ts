/**
 * How an integrator styles figures: a ready look (preset), design tokens,
 * class names per part of the figure (for utility CSS such as Tailwind),
 * trusted CSS of their own, the layout of controls around the drawing, the
 * drawing's size, and which parts show. It travels to sandboxed frames as
 * plain data and is checked again there, so it can carry nothing but names,
 * lengths and colours.
 */

export type StylePreset = 'default' | 'glass' | 'minimal' | 'outline' | 'contrast' | 'soft';

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
   * `line`, `card`, `lit`, `a`, `b`, `c`, `focus`), `radius`, `font`,
   * `font-size`, `gap`, `control-height`, `shadow`, `blur`, `surface`,
   * `scene-bg`. Values are plain CSS values: colours, lengths, font lists.
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

const PRESETS: readonly StylePreset[] = ['default', 'glass', 'minimal', 'outline', 'contrast', 'soft'];
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
 * The style as plain data for the bridge: everything but the host CSS, which
 * goes into the frame document itself under the content security policy.
 */
export function styleForBridge(style: FigureStyle | undefined): FigureStyle | undefined {
  if (!style) return undefined;
  const resolved = resolveStyle(style);
  return { preset: resolved.preset, tokens: resolved.tokens, classNames: resolved.classNames, layout: resolved.layout, show: resolved.show };
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

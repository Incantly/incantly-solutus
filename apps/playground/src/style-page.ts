import { inThreadAdapter, sandboxAdapter, type FigureHandle, type FigureStyle, type ShowPart, type StylePreset } from '@incantly/core';
import { referenceScene, referenceSceneIds } from '@incantly/core/scenes';

/**
 * The figure look page: settings an integrator would expose, applied live to
 * a sandboxed figure with setStyle, and the FigureStyle they add up to, ready
 * to copy. Utility classes are shown with a few hand-written classes standing
 * in for a compiled Tailwind stylesheet; any utility CSS works the same way.
 */

const PRESETS: readonly StylePreset[] = ['default', 'glass', 'soft', 'outline', 'minimal', 'contrast', 'paper', 'blueprint', 'sepia'];
const PLACEMENTS = ['below', 'above', 'right', 'left', 'overlay'] as const;
const SIZES = ['sm', 'md', 'lg'] as const;
const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;
const FONTS: Readonly<Record<string, string>> = {
  System: '',
  Serif: "Georgia, 'Times New Roman', serif",
  Rounded: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
  Mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};
const SHOWN: readonly ShowPart[] = ['header', 'idea', 'readouts', 'legend', 'controls', 'transport', 'speed', 'settings', 'undo', 'fullscreen', 'steps', 'description', 'zoom', 'partInfo'];

/** Stand-ins for compiled utility classes, carried into the frame as the host's trusted CSS. */
const UTILITY_CSS = `
.u-pill { border-radius: 999px !important; }
.u-lift { box-shadow: 0 6px 18px rgb(0 0 0 / 0.14) !important; }
.u-ring { box-shadow: 0 0 0 1px rgb(124 58 237 / 0.35), 0 18px 40px rgb(76 29 149 / 0.18); border-radius: 22px; }
.u-violet { accent-color: #7c3aed; }
.u-caps { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.78em !important; }
.u-tint { background: rgb(124 58 237 / 0.08) !important; border-color: rgb(124 58 237 / 0.25) !important; }
`;
const UTILITY_CLASSES: FigureStyle['classNames'] = {
  figure: 'u-ring',
  button: 'u-pill u-lift',
  slider: 'u-violet',
  label: 'u-caps',
  readout: 'u-tint',
};

interface Settings {
  scene: string;
  adapter: 'sandbox' | 'in-thread';
  theme: 'auto' | 'light' | 'dark';
  preset: StylePreset;
  accent: string;
  useAccent: boolean;
  radius: number;
  font: string;
  controls: (typeof PLACEMENTS)[number];
  sceneHeight: number;
  autoHeight: boolean;
  size: (typeof SIZES)[number];
  density: (typeof DENSITIES)[number];
  utilities: boolean;
  show: Record<ShowPart, boolean>;
}

/** The FigureStyle the settings describe: what an integrator would pass. */
export function styleFrom(settings: Settings): FigureStyle {
  const tokens: Record<string, string> = { radius: `${settings.radius}px` };
  if (settings.useAccent) tokens.lit = settings.accent;
  if (FONTS[settings.font]) tokens.font = FONTS[settings.font]!;
  const hidden = Object.fromEntries(SHOWN.filter((part) => !settings.show[part]).map((part) => [part, false]));
  return {
    preset: settings.preset,
    tokens,
    layout: {
      controls: settings.controls,
      size: settings.size,
      density: settings.density,
      ...(settings.autoHeight ? {} : { sceneHeight: `${settings.sceneHeight}px` }),
    },
    ...(Object.keys(hidden).length > 0 ? { show: hidden } : {}),
    ...(settings.utilities ? { classNames: UTILITY_CLASSES, css: UTILITY_CSS.trim() } : {}),
  };
}

export function mountStylePage(root: HTMLElement, params: URLSearchParams): void {
  const settings: Settings = {
    scene: referenceScene(params.get('scene') ?? '') ? params.get('scene')! : 'projectile',
    adapter: params.get('adapter') === 'in-thread' ? 'in-thread' : 'sandbox',
    theme: 'auto',
    preset: (PRESETS as readonly string[]).includes(params.get('preset') ?? '') ? (params.get('preset') as StylePreset) : 'glass',
    accent: '#7c3aed',
    useAccent: false,
    radius: 14,
    font: 'System',
    controls: 'below',
    sceneHeight: 380,
    autoHeight: true,
    size: 'md',
    density: 'comfortable',
    utilities: false,
    show: Object.fromEntries(SHOWN.map((part) => [part, true])) as Record<ShowPart, boolean>,
  };
  root.classList.add('style-page');
  const panel = document.createElement('form');
  panel.className = 'style-panel';
  panel.setAttribute('aria-label', 'Figure look');
  const stage = document.createElement('section');
  stage.className = 'style-stage';
  const slot = document.createElement('div');
  slot.className = 'style-slot';
  slot.dataset.backdrop = 'plain';
  const code = document.createElement('pre');
  code.className = 'style-code';
  stage.append(slot, code);
  root.append(panel, stage);

  const state = { ready: false, page: 'style', figure: null as FigureHandle | null, style: styleFrom(settings), mounts: 0, restyles: 0 };
  window.__playground = state;

  // ---------------------------------------------------------------------------
  // The settings form: each control writes one setting, then the look is applied.
  // ---------------------------------------------------------------------------
  const group = (title: string) => {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    fieldset.append(legend);
    panel.append(fieldset);
    return fieldset;
  };
  const field = (parent: HTMLElement, label: string, input: HTMLElement) => {
    const wrap = document.createElement('label');
    wrap.className = 'style-field';
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(text, input);
    parent.append(wrap);
  };
  const select = <T extends string>(parent: HTMLElement, label: string, options: readonly T[], value: T, change: (value: T) => void, remount = false) => {
    const input = document.createElement('select');
    input.name = label;
    for (const option of options) input.append(new Option(option, option, false, option === value));
    input.addEventListener('change', () => {
      change(input.value as T);
      apply(remount);
    });
    field(parent, label, input);
  };
  const check = (parent: HTMLElement, label: string, value: boolean, change: (value: boolean) => void, remount = false) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = label;
    input.checked = value;
    input.addEventListener('change', () => {
      change(input.checked);
      apply(remount);
    });
    field(parent, label, input);
    return input;
  };
  const range = (parent: HTMLElement, label: string, min: number, max: number, value: number, change: (value: number) => void) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.name = label;
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.addEventListener('input', () => {
      change(Number(input.value));
      apply();
    });
    field(parent, label, input);
  };

  const figureGroup = group('Figure');
  select(figureGroup, 'Scene', referenceSceneIds(), settings.scene, (v) => (settings.scene = v), true);
  select(figureGroup, 'Runs in', ['sandbox', 'in-thread'] as const, settings.adapter, (v) => (settings.adapter = v), true);
  select(figureGroup, 'Theme', ['auto', 'light', 'dark'] as const, settings.theme, (v) => (settings.theme = v));
  // The host page behind the figure: glass shows what is under it.
  select(figureGroup, 'Page behind', ['plain', 'aurora', 'dusk'] as const, 'plain', (v) => (slot.dataset.backdrop = v));

  const lookGroup = group('Look');
  select(lookGroup, 'Preset', PRESETS, settings.preset, (v) => (settings.preset = v));
  const accent = document.createElement('input');
  accent.type = 'color';
  accent.name = 'Accent';
  accent.value = settings.accent;
  accent.addEventListener('input', () => {
    settings.accent = accent.value;
    settings.useAccent = true;
    apply();
  });
  field(lookGroup, 'Accent', accent);
  range(lookGroup, 'Corner radius', 0, 28, settings.radius, (v) => (settings.radius = v));
  select(lookGroup, 'Font', Object.keys(FONTS), settings.font, (v) => (settings.font = v));
  check(lookGroup, 'Utility classes', settings.utilities, (v) => (settings.utilities = v), true);

  const layoutGroup = group('Layout');
  select(layoutGroup, 'Controls placement', PLACEMENTS, settings.controls, (v) => (settings.controls = v));
  select(layoutGroup, 'Size', SIZES, settings.size, (v) => (settings.size = v));
  select(layoutGroup, 'Density', DENSITIES, settings.density, (v) => (settings.density = v));
  const autoHeight = check(layoutGroup, 'Drawing height follows its shape', settings.autoHeight, (v) => (settings.autoHeight = v));
  range(layoutGroup, 'Drawing height', 220, 640, settings.sceneHeight, (v) => {
    settings.sceneHeight = v;
    settings.autoHeight = autoHeight.checked = false;
  });

  const showGroup = group('Shows');
  for (const part of SHOWN) check(showGroup, part, true, (v) => (settings.show[part] = v));

  // ---------------------------------------------------------------------------
  // Applying: a live restyle when only the look changed, a new mount otherwise.
  // ---------------------------------------------------------------------------
  let applied = { scene: '', adapter: '', css: '' };
  function apply(remount = false): void {
    const style = styleFrom(settings);
    state.style = style;
    code.textContent = `// Pass this as the figure's style:\nmountSandboxed(element, fragments, { style: ${JSON.stringify({ ...style, ...(style.css ? { css: '/* your compiled utility CSS */' } : {}) }, null, 2)} });`;
    const css = style.css ?? '';
    if (remount || !state.figure || applied.scene !== settings.scene || applied.adapter !== settings.adapter || applied.css !== css) {
      state.figure?.destroy();
      slot.replaceChildren();
      const scene = referenceScene(settings.scene)!;
      const adapter = settings.adapter === 'sandbox' ? sandboxAdapter : inThreadAdapter;
      state.figure = adapter.mount(slot, scene, { style, theme: settings.theme, title: `Interactive figure: ${scene.plan.concept}`, figureNumber: 1 });
      state.mounts++;
      applied = { scene: settings.scene, adapter: settings.adapter, css };
      void state.figure.ready.then(() => (state.ready = true));
      return;
    }
    state.figure.setStyle(style);
    state.figure.setTheme(settings.theme);
    state.restyles++;
  }
  apply(true);
}

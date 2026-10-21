import { FigureRenderer, type RendererOptions } from '../renderer/renderer';
import { hostCss, type FigureStyle } from '../renderer/style';
import { THEME_CSS } from '../renderer/theme';
import { SceneRuntime, type RuntimeOptions, type SceneFunction } from '../runtime/runtime';
import { InThreadChannel } from './channel';
import type { FrameClock } from './clock';

export interface Fragments {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

export interface TrustedMountOptions extends RuntimeOptions {
  readonly theme?: 'light' | 'dark' | 'auto';
  readonly clock?: FrameClock;
  readonly figureId?: string;
  readonly visibility?: RendererOptions['visibility'];
  readonly style?: FigureStyle;
  readonly figureNumber?: number;
  readonly onValues?: RendererOptions['onValues'];
  readonly onFormulas?: RendererOptions['onFormulas'];
  readonly onStep?: RendererOptions['onStep'];
  readonly onError?: RendererOptions['onError'];
  readonly onUpdate?: RendererOptions['onUpdate'];
}

export interface MountedFigure {
  readonly root: HTMLElement;
  readonly runtime: SceneRuntime;
  readonly renderer: FigureRenderer;
  destroy(): void;
}

let figureCounter = 0;

/** Adds the bundled theme to a document once. */
export function ensureTheme(doc: Document): void {
  if (doc.querySelector('style[data-incantly-theme]')) return;
  const style = doc.createElement('style');
  style.dataset.incantlyTheme = '';
  style.textContent = THEME_CSS;
  doc.head.append(style);
}

export function prefersReducedMotion(view: Window | null): boolean {
  return Boolean(view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Compiles a TRUSTED scene: a hand-written reference scene or a test fixture.
 * Generated scenes never run through here; they run validated, in the sandbox.
 */
export function compileTrusted(js: string): SceneFunction {
  return new Function('inc', 'Math', `"use strict";\n${js}`) as SceneFunction;
}

/**
 * Mounts a trusted scene in the page, with the runtime in the same thread.
 * For reference scenes, tests and the playground only.
 */
export function mountTrusted(container: HTMLElement, fragments: Fragments, options: TrustedMountOptions = {}): MountedFigure {
  const doc = container.ownerDocument;
  ensureTheme(doc);
  const scope = options.figureId ?? `incfig${++figureCounter}`;

  const root = doc.createElement('div');
  root.dataset.figureId = scope;
  if (options.theme && options.theme !== 'auto') root.dataset.theme = options.theme;
  // Host CSS usually lives in the page already; when it is passed, the figure carries it too.
  const css = hostCss(options.style);
  if (css) {
    const style = doc.createElement('style');
    style.dataset.incantlyHost = '';
    style.textContent = css;
    root.append(style);
  }
  if (fragments.css) {
    const style = doc.createElement('style');
    style.textContent = fragments.css;
    root.append(style);
  }
  const scene = doc.createElement('div');
  scene.className = 'inc-scene';
  const template = doc.createElement('template');
  template.innerHTML = fragments.html;
  scene.append(template.content);
  root.append(scene);
  container.append(root);

  const runtime = new SceneRuntime({
    ...options,
    reducedMotion: options.reducedMotion ?? prefersReducedMotion(doc.defaultView),
  });
  const channel = new InThreadChannel(runtime);
  const renderer = new FigureRenderer({
    root,
    channel,
    scope,
    ...(options.clock ? { clock: options.clock } : {}),
    visibility: options.visibility ?? 'observe',
    ...(options.style ? { style: options.style } : {}),
    ...(options.figureNumber !== undefined ? { figureNumber: options.figureNumber } : {}),
    ...(options.onValues ? { onValues: options.onValues } : {}),
    ...(options.onFormulas ? { onFormulas: options.onFormulas } : {}),
    ...(options.onStep ? { onStep: options.onStep } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
    ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
  });
  channel.start(compileTrusted(fragments.js));

  return {
    root,
    runtime,
    renderer,
    destroy() {
      renderer.destroy();
      root.remove();
    },
  };
}

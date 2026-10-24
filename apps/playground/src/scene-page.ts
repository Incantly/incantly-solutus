import { mountTrusted, type FigureLayout, type StylePreset } from '@incantly/core';
import { referenceScene, referenceSceneIds } from '@incantly/core/scenes';
import { SCENE_FIXTURES } from './scene-fixtures';

/**
 * Mounts one reference scene, or a test fixture with `fixture=`, in the page, in trusted in-thread mode.
 * `density`, `size` and `preset` set the figure's look as an integrator would.
 */
export function mountScenePage(root: HTMLElement, params: URLSearchParams): void {
  const id = params.get('scene') ?? 'sine-wave';
  const fixture = params.get('fixture');
  const scene = fixture ? SCENE_FIXTURES[fixture] : referenceScene(id);
  if (!scene) {
    root.textContent = fixture ? `Unknown fixture "${fixture}"` : `Unknown scene "${id}". Try one of: ${referenceSceneIds().join(', ')}`;
    return;
  }
  const theme = params.get('theme');
  const layout: { -readonly [K in keyof FigureLayout]: FigureLayout[K] } = {};
  const density = params.get('density');
  if (density === 'compact' || density === 'comfortable' || density === 'spacious') layout.density = density;
  const size = params.get('size');
  if (size === 'sm' || size === 'md' || size === 'lg') layout.size = size;
  const preset = params.get('preset') as StylePreset | null;
  const container = document.createElement('div');
  root.append(container);
  const figure = mountTrusted(container, scene, {
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    autoplay: params.get('autoplay') !== '0',
    figureId: 'fig',
    ...(preset || Object.keys(layout).length > 0 ? { style: { ...(preset ? { preset } : {}), layout } } : {}),
  });

  window.__playground = {
    ready: true,
    page: 'scene',
    figure,
    stats: () => ({
      renderer: { ...figure.renderer.stats, running: figure.renderer.isRunning },
      runtime: { ...figure.runtime.stats },
      time: figure.runtime.time,
      values: figure.runtime.values(),
    }),
  };
}

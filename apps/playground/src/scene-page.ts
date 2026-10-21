import { mountTrusted } from '@incantly/core';
import { referenceScene, referenceSceneIds } from '@incantly/core/scenes';

/** Mounts one reference scene in the page, in trusted in-thread mode. */
export function mountScenePage(root: HTMLElement, params: URLSearchParams): void {
  const id = params.get('scene') ?? 'sine-wave';
  const scene = referenceScene(id);
  if (!scene) {
    root.textContent = `Unknown scene "${id}". Try one of: ${referenceSceneIds().join(', ')}`;
    return;
  }
  const theme = params.get('theme');
  const container = document.createElement('div');
  root.append(container);
  const figure = mountTrusted(container, scene, {
    theme: theme === 'light' || theme === 'dark' ? theme : 'auto',
    autoplay: params.get('autoplay') !== '0',
    figureId: 'fig',
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

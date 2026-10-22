import { sandboxAdapter, type FigureHandle, type FigureStyle } from '@incantly/core';
import { referenceScene, referenceSceneIds } from '@incantly/core/scenes';

/**
 * Every reviewed scene on one page, each in its own sandbox: a contact sheet
 * for reviewers, and what the browser checks run over (CH-2). `theme=light`
 * or `dark`, `preset=<preset>` for a look, `only=<id,id>` for a few.
 */
export function mountGalleryPage(root: HTMLElement, params: URLSearchParams): void {
  const theme = params.get('theme') === 'dark' ? 'dark' : params.get('theme') === 'light' ? 'light' : 'auto';
  const preset = params.get('preset');
  const only = params.get('only')?.split(',');
  const style: FigureStyle | undefined = preset ? ({ preset } as FigureStyle) : undefined;
  const grid = document.createElement('div');
  grid.className = 'gallery';
  if (theme !== 'auto') grid.dataset.theme = theme;
  root.append(grid);
  const figures: Array<{ id: string; handle: FigureHandle; errors: string[] }> = [];
  for (const id of referenceSceneIds().filter((s) => !only || only.includes(s))) {
    const scene = referenceScene(id)!;
    const cell = document.createElement('section');
    cell.className = 'gallery__cell';
    cell.dataset.scene = id;
    const heading = document.createElement('h2');
    heading.textContent = scene.plan.concept;
    const container = document.createElement('div');
    cell.append(heading, container);
    grid.append(cell);
    const errors: string[] = [];
    const handle = sandboxAdapter.mount(container, { html: scene.html, css: scene.css, js: scene.js }, {
      theme,
      autoplay: false,
      title: `Interactive figure: ${scene.plan.concept}`,
      ...(style ? { style } : {}),
      onError: (error) => errors.push(`${error.phase}: ${error.message}`),
    });
    figures.push({ id, handle, errors });
  }
  window.__playground = {
    ready: true,
    page: 'gallery',
    figures: () => figures.map((f) => ({ id: f.id, state: f.handle.state, errors: f.errors })),
    whenReady: () => Promise.all(figures.map((f) => f.handle.ready)),
  };
}

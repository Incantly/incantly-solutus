import { sandboxAdapter, type FigureHandle, type FigureStyle } from '@incantly/core';
import { referenceScene, referenceSceneIds } from '@incantly/core/scenes';
import { keptFigures, savedFigureFor, type SavedFigure } from './saved-chats';

/** The gallery: every generation the agent can make, as searchable boxes. */

interface GalleryCard {
  readonly title: string;
  readonly prompt: string;
  readonly tag: string;
  /** A reviewed scene mounts live in the detail panel; prompt-only cards generate first. */
  readonly sceneId?: string;
}

/**
 * The gallery cards. Real generations join here as implementations land —
 * each entry needs a short title, a tag for the search, and the exact
 * learner prompt.
 */
const PROMPT_CARDS: readonly GalleryCard[] = [
  {
    title: 'Bicycle chain and derailleur',
    tag: 'Mechanics',
    prompt: 'I want to learn the way a bicycle works, like the chains. Some bicycles have the back chain and two extra knobs underneath. How does that work? Can you show me a representation of it?',
  },
  { title: 'Fibonacci sequence', tag: 'Sequences', prompt: 'Show me the Fibonacci sequence: each term is the sum of the two before it, and how fast the terms grow.' },
  { title: 'Golden ratio', tag: 'Sequences', prompt: 'Show me the golden ratio: how the ratio of consecutive Fibonacci numbers settles on φ, and the golden rectangle and spiral it makes.' },
];

/** Generated from packages/core/scenes by scripts/generate.mjs. */
/** Figures the dev server keeps for the chat, by prompt; filled when the page loads. */
let kept: ReadonlyMap<string, SavedFigure> = new Map();

/**
 * What a card draws: its reviewed scene, or else the latest figure the chat
 * built for its prompt, as the dev server keeps it or this browser saved it.
 * A prompt card nobody has generated yet has none.
 */
function figureFor(card: GalleryCard): { readonly concept: string; readonly html: string; readonly css: string; readonly js: string } | null {
  const scene = card.sceneId ? referenceScene(card.sceneId) : undefined;
  if (scene) return { concept: scene.plan.concept, html: scene.html, css: scene.css, js: scene.js };
  const saved = kept.get(card.prompt.trim()) ?? savedFigureFor(card.prompt);
  return saved ? { concept: saved.concept, ...saved.fragments } : null;
}

function reviewedCards(): GalleryCard[] {
  return referenceSceneIds().flatMap((sceneId) => {
    const scene = referenceScene(sceneId);
    if (!scene) return [];
    return [{
      sceneId,
      title: scene.plan.concept,
      tag: `Reviewed ${scene.plan.kind}`,
      prompt: `Show me ${scene.plan.concept}. ${scene.plan.idea}`.slice(0, 500),
    }];
  });
}

export function mountGenerationsPage(root: HTMLElement): void {
  root.className = 'gallery-page';

  const header = document.createElement('header');
  header.className = 'gallery-header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'gallery-back';
  backBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg><span>Back to chat</span>';
  backBtn.addEventListener('click', () => {
    location.href = '/?page=generate';
  });
  const heading = document.createElement('div');
  heading.className = 'gallery-heading';
  const h1 = document.createElement('h1');
  h1.textContent = 'Gallery of generations';
  const sub = document.createElement('p');
  sub.textContent = 'Every figure the agent can build. Search, then tap one to generate it in the chat.';
  heading.append(h1, sub);
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'gallery-search';
  search.placeholder = 'Search generations…';
  search.setAttribute('aria-label', 'Search generations');
  header.append(backBtn, heading, search);

  const grid = document.createElement('section');
  grid.className = 'gallery-grid';
  grid.setAttribute('aria-label', 'Generations');

  const catalog = [...PROMPT_CARDS, ...reviewedCards()];
  // A prompt card's figure may be on the dev server: thumbnails mount once it has answered.
  const figuresReady = keptFigures().then((figures) => {
    kept = figures;
  });
  const cards: Array<{ el: HTMLElement; card: GalleryCard }> = [];
  const previews: FigureHandle[] = [];
  let preview: FigureHandle | null = null;
  /** The card thumbnail shows the drawing only, no header or controls. */
  const thumbnailStyle: FigureStyle = {
    show: {
      header: false,
      idea: false,
      readouts: false,
      legend: false,
      controls: false,
      transport: false,
      speed: false,
      settings: false,
      undo: false,
      fullscreen: false,
      steps: false,
      description: false,
      zoom: false,
    },
  };

  // The detail panel that slides in from the side when a card is picked.
  const overlay = document.createElement('div');
  overlay.className = 'gallery-overlay';
  overlay.hidden = true;
  const detail = document.createElement('aside');
  detail.className = 'gallery-detail';
  detail.hidden = true;
  detail.setAttribute('aria-label', 'Generation detail');
  detail.innerHTML = `
    <div class="gallery-detail__head">
      <span class="gallery-detail__tag"></span>
      <button type="button" class="gallery-detail__close" aria-label="Close panel">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="gallery-detail__visual"></div>
    <h2 class="gallery-detail__title"></h2>
    <p class="gallery-detail__prompt"></p>
    <button type="button" class="gallery-detail__generate">Generate in chat</button>
  `;

  const openDetail = (card: GalleryCard): void => {
    (detail.querySelector('.gallery-detail__tag') as HTMLElement).textContent = card.tag;
    detail.querySelector('.gallery-detail__title')!.textContent = card.title;
    detail.querySelector('.gallery-detail__prompt')!.textContent = card.prompt;
    detail.dataset.prompt = card.prompt;
    preview?.destroy();
    preview = null;
    const visual = detail.querySelector('.gallery-detail__visual') as HTMLElement;
    visual.replaceChildren();
    const scene = figureFor(card);
    if (scene) {
      // Controls beside the drawing, so the whole figure fits the screen at once.
      preview = sandboxAdapter.mount(visual, { html: scene.html, css: scene.css, js: scene.js }, {
        autoplay: false,
        title: `Interactive figure: ${scene.concept}`,
        style: { layout: { controls: 'right', panelWidth: '340px', sceneHeight: '70vh' } },
      });
    } else {
      const shimmer = document.createElement('span');
      shimmer.className = 'gallery-card__shimmer';
      visual.append(shimmer);
    }
    overlay.hidden = false;
    detail.hidden = false;
    (detail.querySelector('.gallery-detail__generate') as HTMLButtonElement).focus();
  };
  const closeDetail = (): void => {
    preview?.destroy();
    preview = null;
    overlay.hidden = true;
    detail.hidden = true;
    for (const { el } of cards) el.classList.remove('is-picked');
  };

  (detail.querySelector('.gallery-detail__close') as HTMLButtonElement).addEventListener('click', closeDetail);
  overlay.addEventListener('click', closeDetail);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !detail.hidden) closeDetail();
  });
  detail.querySelector('.gallery-detail__generate')!.addEventListener('click', () => {
    const prompt = detail.dataset.prompt ?? '';
    if (prompt) location.href = `/?page=generate&prompt=${encodeURIComponent(prompt)}`;
  });

  // Each card mounts its own live drawing as the learner scrolls to it, so a
  // preview beats a shimmer and pages with many cards still load fast.
  const byVisual = new Map<HTMLElement, { card: GalleryCard; errors: string[] }>();
  const mountThumbnail = (visual: HTMLElement): void => {
    const entry = byVisual.get(visual);
    if (!entry) return;
    const scene = figureFor(entry.card);
    if (!scene) return;
    visual.replaceChildren();
    // A thumbnail stays paused and alone in its box: the drawing, not the whole figure.
    previews.push(
      sandboxAdapter.mount(visual, { html: scene.html, css: scene.css, js: scene.js }, {
        autoplay: false,
        title: `Interactive figure: ${scene.concept}`,
        style: thumbnailStyle,
        onError: (error) => entry.errors.push(`${error.phase}: ${error.message}`),
      }),
    );
  };
  const cardPreviews = 'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            cardPreviews!.unobserve(entry.target);
            mountThumbnail(entry.target as HTMLElement);
          }
        },
        { rootMargin: '300px 0px 0px' },
      )
    : undefined;

  for (const card of catalog) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'gallery-card';
    el.innerHTML = `
      <span class="gallery-card__visual" aria-hidden="true"><span class="gallery-card__shimmer"></span></span>
      <span class="gallery-card__tag"></span>
      <span class="gallery-card__title"></span>
      <span class="gallery-card__prompt"></span>
      <span class="gallery-card__action">View →</span>
    `;
    (el.querySelector('.gallery-card__tag') as HTMLElement).textContent = card.tag;
    (el.querySelector('.gallery-card__title') as HTMLElement).textContent = card.title;
    (el.querySelector('.gallery-card__prompt') as HTMLElement).textContent = card.prompt;
    const visual = el.querySelector('.gallery-card__visual') as HTMLElement;
    const errors: string[] = [];
    byVisual.set(visual, { card, errors });
    void figuresReady.then(() => (cardPreviews ? cardPreviews.observe(visual) : mountThumbnail(visual)));
    el.addEventListener('click', () => {
      for (const other of cards) other.el.classList.remove('is-picked');
      el.classList.add('is-picked');
      openDetail(card);
    });
    cards.push({ el, card });
    grid.append(el);
  }

  search.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const { el, card } of cards) {
      const hit = !query || card.title.toLowerCase().includes(query) || card.prompt.toLowerCase().includes(query) || card.tag.toLowerCase().includes(query);
      el.hidden = !hit;
      if (hit) visible++;
    }
    empty.hidden = visible > 0;
  });

  const empty = document.createElement('p');
  empty.className = 'gallery-empty';
  empty.hidden = true;
  empty.textContent = 'Nothing matches that search.';

  root.append(header, grid, empty, overlay, detail);
  window.__playground = {
    ready: true,
    page: 'generations',
    cards: catalog.map((card) => ({ title: card.title, tag: card.tag, prompt: card.prompt, sceneId: card.sceneId ?? null })),
  };
  window.addEventListener('pagehide', () => {
    preview?.destroy();
    for (const handle of previews) handle.destroy();
  }, { once: true });
}

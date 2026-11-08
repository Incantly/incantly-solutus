import { FILM_LENGTH_PRESETS, sandboxAdapter, type FigureHandle, type FigureStyle } from '@incantly/core';
import { referenceScene, referenceSceneIds } from '@incantly/core/scenes';
import { formatFilmTimings, GenerationClient, type FilmGenerateEvent } from '@incantly/generation/client';
import { recordDebug, recordingFetch } from './debug-log';
import { keptFigures, savedFigureFor, type SavedFigure } from './saved-chats';

/** The gallery: every generation the agent can make, as searchable boxes. */

interface GalleryCard {
  readonly title: string;
  readonly prompt: string;
  readonly tag: string;
  /** A reviewed scene mounts live in the detail panel; prompt-only cards generate first. */
  readonly sceneId?: string;
  /** A film card opens its film in the player instead of generating in chat. */
  readonly playerFilm?: string;
}

/**
 * The gallery cards. Real generations join here as implementations land —
 * each entry needs a short title, a tag for the search, and the exact
 * learner prompt.
 */
const PROMPT_CARDS: readonly GalleryCard[] = [
  // Gears drawn with inc.shapes.gear and turned with rotate(deg, { about }).
  { title: 'Meshing gears', tag: 'Mechanics', prompt: 'Show me two gears meshing: a small gear driving a big one. How does the number of teeth change how fast each one turns?' },
  // Forces drawn with inc.path.arrow({ from, by }).
  {
    title: 'Forces on a ramp',
    tag: 'Forces',
    prompt: 'Show me the forces on a block on a ramp: its weight, the normal force and friction as arrows, and how tilting the ramp changes them.',
  },
  // A loop as long as the learner asks, which the validator caps itself.
  { title: 'Area under a curve', tag: 'Calculus', prompt: 'Show me how rectangles under a curve add up to its area, and how the estimate gets closer as I use more rectangles.' },
  // Animals grown from a skeleton with inc.anatomy, their gait read from their bones and speed.
  { title: 'A dog running', tag: 'Animals', prompt: 'Show me a dog running. How do its legs move as it speeds up from a walk to a gallop?' },
  { title: 'A mouse running', tag: 'Animals', prompt: "Show me a mouse running. Why do its legs move so much faster than a horse's?" },
  { title: 'A cheetah at full speed', tag: 'Animals', prompt: 'Show me a cheetah running at full speed, and how its back bends with each stride.' },
  { title: 'An ape standing up', tag: 'Animals', prompt: 'Show me an ape walking on all fours, then standing up and walking on two legs.' },
  // Films a learner can play, scrub, question and export in the player (PRD 28).
  { title: 'How a pendulum keeps time', tag: 'Film · 30 s', prompt: 'Show me a 30-second film about how a pendulum keeps time.', playerFilm: 'thirty' },
  { title: 'What a wave carries', tag: 'Film · 1 min', prompt: 'Show me a one-minute film about what a wave carries.', playerFilm: 'sixty' },
  { title: 'Pythagoras: talk to the teacher', tag: 'Film · Live voice', prompt: 'Talk to the teacher in a one-minute film about Pythagoras theorem: a right triangle with squares on each side.', playerFilm: 'pythagoras' },
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

export function mountGenerationsPage(root: HTMLElement, params: URLSearchParams = new URLSearchParams()): void {
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

  const filmBox = buildFilmGenerateBox(params);
  root.append(header, filmBox.element);

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
    if (card.playerFilm) detail.dataset.film = card.playerFilm;
    else delete detail.dataset.film;
    (detail.querySelector('.gallery-detail__generate') as HTMLButtonElement).textContent = card.playerFilm ? 'Open in player' : 'Generate in chat';
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
    const film = detail.dataset.film;
    if (film) {
      location.href = `/?page=player&film=${encodeURIComponent(film)}`;
      return;
    }
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

  root.append(grid, empty, overlay, detail);
  // Film cards link to the generate-film box instead of duplicating it: a
  // secondary action prefills the box with the card's prompt.
  const generateLink = document.createElement('button');
  generateLink.type = 'button';
  generateLink.className = 'gallery-detail__film-generate';
  generateLink.textContent = 'Generate a film like this';
  generateLink.hidden = true;
  detail.append(generateLink);
  generateLink.addEventListener('click', () => {
    const prompt = detail.dataset.prompt ?? '';
    closeDetail();
    filmBox.prefill(prompt);
    filmBox.element.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  const showGenerateLink = (): void => {
    generateLink.hidden = !detail.dataset.film;
  };
  const observer = new MutationObserver(showGenerateLink);
  observer.observe(detail, { attributes: true, attributeFilter: ['data-film'] });
  showGenerateLink();
  window.__playground = {
    ready: true,
    page: 'generations',
    cards: catalog.map((card) => ({ title: card.title, tag: card.tag, prompt: card.prompt, sceneId: card.sceneId ?? null, playerFilm: card.playerFilm ?? null })),
    filmGenerate: filmBox.state,
  };
  window.addEventListener('pagehide', () => {
    preview?.destroy();
    for (const handle of previews) handle.destroy();
    filmBox.dispose();
    observer.disconnect();
  }, { once: true });
}

interface FilmBoxState {
  status: 'idle' | 'generating' | 'done' | 'fallback';
  prompt: string;
  lengthTarget: number;
  skeleton: { lengthTarget: number; scenes: number } | null;
  scenes: string[];
  firstSceneMs: number | null;
  timings: string | null;
  reason: string | null;
  filmId: string | null;
}

/** The generate-film prompt box: prompt text, length preset and Generate, streaming progress like figures. */
function buildFilmGenerateBox(params: URLSearchParams): { element: HTMLElement; state: () => FilmBoxState; prefill(prompt: string): void; dispose(): void } {
  const state: FilmBoxState = { status: 'idle', prompt: '', lengthTarget: 60, skeleton: null, scenes: [], firstSceneMs: null, timings: null, reason: null, filmId: null };
  const section = document.createElement('section');
  section.className = 'film-generate';
  section.id = 'film-generate';
  section.setAttribute('aria-label', 'Generate a film');
  const heading = document.createElement('h2');
  heading.className = 'film-generate__heading';
  heading.textContent = 'Generate a film';
  const sub = document.createElement('p');
  sub.className = 'film-generate__sub';
  sub.textContent = 'Type a prompt, pick a length, and play the film in the player.';
  const promptLabel = document.createElement('label');
  promptLabel.className = 'film-generate__label';
  promptLabel.textContent = 'Film prompt';
  const promptInput = document.createElement('textarea');
  promptInput.className = 'film-generate__prompt';
  promptInput.rows = 2;
  promptInput.placeholder = 'Show me a 30-second film about how a pendulum keeps time.';
  promptInput.setAttribute('aria-label', 'Film prompt');
  promptLabel.append(promptInput);
  const lengthLabel = document.createElement('label');
  lengthLabel.className = 'film-generate__label';
  lengthLabel.textContent = 'Length';
  const lengthSelect = document.createElement('select');
  lengthSelect.className = 'film-generate__length';
  lengthSelect.setAttribute('aria-label', 'Length');
  for (const seconds of FILM_LENGTH_PRESETS) {
    const option = document.createElement('option');
    option.value = String(seconds);
    option.textContent = seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`;
    if (seconds === 60) option.selected = true;
    lengthSelect.append(option);
  }
  lengthLabel.append(lengthSelect);
  const generateBtn = document.createElement('button');
  generateBtn.type = 'button';
  generateBtn.className = 'film-generate__generate';
  generateBtn.textContent = 'Generate film';
  const progress = document.createElement('div');
  progress.className = 'film-generate__progress';
  progress.setAttribute('aria-live', 'polite');
  const previewsBox = document.createElement('div');
  previewsBox.className = 'film-generate__previews';
  const previewHandles: FigureHandle[] = [];
  section.append(heading, sub, promptLabel, lengthLabel, generateBtn, progress, previewsBox);

  let sessionId: string | null = null;
  let token: string | null = null;
  let aborted = false;
  const fetcher = recordingFetch();

  const setProgress = (text: string): void => {
    progress.textContent = text;
  };

  const clientFor = async (): Promise<GenerationClient> => {
    const fault = params.get('fault');
    if (params.get('reference') === '1') {
      return new GenerationClient({ baseUrl: '/api/v1', token: async () => (token ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token), fetch: fetcher });
    }
    if (fault && /^[a-z-]+$/.test(fault)) {
      return new GenerationClient({ baseUrl: `/api/fault/${fault}/v1`, token: async () => (token ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token), fetch: fetcher });
    }
    if (!sessionId) {
      let saved: { provider?: string; planModel?: string; sceneModel?: string } | null;
      try {
        saved = JSON.parse(localStorage.getItem('incantly-playground-models') ?? 'null') as { provider?: string; planModel?: string; sceneModel?: string } | null;
      } catch {
        saved = null;
      }
      const answer = await fetch('/api/dev/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: saved?.provider ?? 'anthropic',
          planModel: saved?.planModel ?? 'claude-haiku-5-5',
          sceneModel: saved?.sceneModel ?? 'claude-sonnet-5-5',
        }),
      });
      const body = (await answer.json()) as { id?: string; baseUrl?: string; message?: string };
      if (!answer.ok || !body.id || !body.baseUrl) throw new Error(body.message ?? 'The model session did not start. Pick a provider and key in chat Settings first.');
      sessionId = body.id;
      return new GenerationClient({ baseUrl: body.baseUrl, token: async () => (token ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token), fetch: fetcher });
    }
    return new GenerationClient({ baseUrl: `/api/session/${sessionId}/v1`, token: async () => (token ??= ((await (await fetch('/api/dev/token')).json()) as { token: string }).token), fetch: fetcher });
  };

  const mountPreview = (sceneId: string, fragments: { html: string; css: string; js: string }): void => {
    const box = document.createElement('div');
    box.className = 'film-generate__preview';
    box.dataset.scene = sceneId;
    const label = document.createElement('p');
    label.className = 'film-generate__preview-label';
    label.textContent = `Scene ${sceneId} — playable`;
    const visual = document.createElement('div');
    visual.className = 'film-generate__preview-visual';
    box.append(label, visual);
    previewsBox.append(box);
    try {
      previewHandles.push(
        sandboxAdapter.mount(visual, fragments, {
          autoplay: false,
          title: `Generated film scene ${sceneId}`,
          style: { show: { header: false, idea: false, readouts: false, legend: false, controls: false, transport: false, speed: false, settings: false, undo: false, fullscreen: false, steps: false, description: false, zoom: false } },
        }),
      );
    } catch {
      label.textContent = `Scene ${sceneId} — preview failed`;
    }
  };

  generateBtn.addEventListener('click', () => {
    void (async () => {
      const prompt = promptInput.value.trim();
      if (!prompt || state.status === 'generating') return;
      const lengthTarget = Number(lengthSelect.value);
      state.status = 'generating';
      state.prompt = prompt;
      state.lengthTarget = lengthTarget;
      state.skeleton = null;
      state.scenes = [];
      state.firstSceneMs = null;
      state.timings = null;
      state.reason = null;
      state.filmId = null;
      for (const handle of previewHandles.splice(0)) handle.destroy();
      previewsBox.replaceChildren();
      progress.replaceChildren();
      generateBtn.disabled = true;
      const started = performance.now();
      recordDebug({ kind: 'prompt', label: 'film', body: { prompt, lengthTarget } });
      setProgress('Starting… (skeleton within 1s)');
      try {
        const client = await clientFor();
        let planScenes: ReadonlyArray<{ scene: string }> = [];
        const kept: Array<{ sceneId: string; fragments: { html: string; css: string; js: string } }> = [];
        let storyboard: FilmGenerateEvent & { type: 'film' } extends never ? never : unknown = null;
        let fullStoryboard: { film: { title: string }; scenes: unknown } | null = null;
        const stream: AsyncGenerator<FilmGenerateEvent> = client.generateFilm({ prompt, lengthTarget });
        for await (const event of stream) {
          if (aborted) break;
          if (event.type === 'skeleton') {
            state.skeleton = { lengthTarget: event.lengthTarget, scenes: event.scenes };
            setProgress(`Skeleton: ${event.scenes} scene${event.scenes === 1 ? '' : 's'} for ${event.lengthTarget}s (deadline ${(event.deadlineMs / 1000).toFixed(0)}s)`);
          } else if (event.type === 'plan') {
            planScenes = event.scenes;
            setProgress(`Plan: ${event.scenes.length} scene${event.scenes.length === 1 ? '' : 's'} (${event.scenes.map((s) => s.scene).join(', ')})`);
          } else if (event.type === 'scene') {
            if (event.fragments) {
              state.scenes.push(event.scene);
              kept.push({ sceneId: event.scene, fragments: event.fragments });
              if (state.firstSceneMs === null) {
                state.firstSceneMs = performance.now() - started;
                setProgress(`Scene ${event.scene} playable in ${(state.firstSceneMs / 1000).toFixed(1)}s (budget 10s)${planScenes.length > 1 ? ` — ${planScenes.length - 1} more joining…` : ''}`);
              } else {
                setProgress(`Scene ${event.scene} joined (${state.scenes.length}/${planScenes.length || state.scenes.length})`);
              }
              mountPreview(event.scene, event.fragments);
            } else {
              setProgress(`Scene ${event.scene} failed (${event.failed ?? 'scene'}) — kept ${kept.length}`);
            }
          } else if (event.type === 'film') {
            fullStoryboard = event.storyboard as unknown as { film: { title: string }; scenes: unknown };
            storyboard = event.storyboard;
            state.timings = formatFilmTimings(event.timings);
            const scenes = event.scenes.map((s) => ({ id: s.sceneId, ...s.fragments }));
            const saved = await fetch('/api/dev/films', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: event.generationId, storyboard: event.storyboard, scenes }),
            });
            if (saved.ok) state.filmId = event.generationId;
            state.status = 'done';
            void fullStoryboard;
            void storyboard;
            const timingsLine = document.createElement('p');
            timingsLine.className = 'film-generate__timings';
            timingsLine.textContent = `Done in ${(event.timings.totalMs / 1000).toFixed(1)}s: ${state.timings} · ${event.speechChars} speech chars${event.partial ? ' · partial' : ''}`;
            const open = document.createElement('a');
            open.className = 'film-generate__open';
            open.href = `/?page=player&film=${encodeURIComponent(event.generationId)}`;
            open.textContent = 'Open in player';
            progress.replaceChildren(timingsLine, open);
            recordDebug({ kind: 'done', label: 'film', body: { generationId: event.generationId, timings: event.timings } });
          } else if (event.type === 'fallback') {
            state.status = 'fallback';
            state.reason = event.reason;
            for (const scene of event.keptScenes) {
              if (!state.scenes.includes(scene.sceneId)) {
                state.scenes.push(scene.sceneId);
                mountPreview(scene.sceneId, scene.fragments);
              }
            }
            const reasonLine = document.createElement('p');
            reasonLine.className = 'film-generate__reason';
            reasonLine.textContent = `Fell back like a figure: ${event.reason} — kept ${event.keptScenes.length} scene${event.keptScenes.length === 1 ? '' : 's'}.`;
            progress.replaceChildren(reasonLine);
            if (event.standard) {
              const standardLine = document.createElement('p');
              standardLine.className = 'film-generate__standard';
              standardLine.textContent = `Reviewed figure: ${event.standard.concept}`;
              progress.append(standardLine);
            }
            recordDebug({ kind: 'failed', label: 'film', message: event.reason });
          }
        }
      } catch (error) {
        state.status = 'fallback';
        state.reason = error instanceof Error ? error.message : String(error);
        setProgress(`The film could not start: ${state.reason}`);
        recordDebug({ kind: 'error', label: 'film', message: state.reason });
      } finally {
        generateBtn.disabled = false;
      }
    })();
  });

  return {
    element: section,
    state: () => ({ ...state, scenes: [...state.scenes] }),
    prefill(prompt: string): void {
      promptInput.value = prompt;
      promptInput.focus();
    },
    dispose(): void {
      aborted = true;
      for (const handle of previewHandles.splice(0)) handle.destroy();
      if (sessionId) void fetch(`/api/dev/session/${sessionId}`, { method: 'DELETE', keepalive: true });
      sessionId = null;
    },
  };
}

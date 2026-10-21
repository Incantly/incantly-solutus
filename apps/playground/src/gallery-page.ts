/** The gallery: every generation the agent can make, as searchable boxes. */

interface GalleryCard {
  readonly title: string;
  readonly prompt: string;
  readonly tag: string;
}

/** The four showcase prompts first, then the launch set from the PRD (17.8). */
const CARDS: readonly GalleryCard[] = [
  { title: 'Bicycle drive', tag: '3D mechanism', prompt: 'A highly detailed 3D animation of a bicycle, showing how the pedals, chain, gears and wheels work together.' },
  { title: 'How a PC works', tag: '3D', prompt: 'A 3D figure that explains the way a PC works: the CPU, RAM, storage and data flow between them.' },
  { title: 'Tones into one waveform', tag: 'Waves', prompt: 'How several pure tones with different frequencies combine into one waveform, with a control for how many tones are added.' },
  { title: 'Car engine in detail', tag: '3D mechanism', prompt: 'A complex 3D animation of a car engine in detail: pistons, crankshaft, cylinders, valves and the four-stroke cycle, in order.' },
  { title: 'Projectile motion', tag: 'Physics', prompt: 'Explain projectile motion for a physics student.' },
  { title: 'Buoyancy', tag: 'Physics', prompt: 'Explain why some things float and others sink, for a physics student.' },
  { title: 'Bar magnets', tag: 'Physics', prompt: 'Show the magnetic field of two bar magnets attracting and repelling each other.' },
  { title: 'Sine wave', tag: 'Maths', prompt: 'Draw a sine wave whose amplitude, frequency and phase I can control.' },
  { title: 'Simple pendulum', tag: 'Physics', prompt: 'Explain the motion of a simple pendulum and how its period depends on length.' },
  { title: 'Spring-mass oscillator', tag: 'Physics', prompt: 'Explain a spring-mass oscillator: displacement, velocity and energy over time.' },
  { title: "Ohm's law circuit", tag: 'Electricity', prompt: "Show Ohm's law on a simple circuit: change voltage and resistance, watch the current." },
  { title: 'Lens ray diagram', tag: 'Optics', prompt: 'Explain how a convex lens forms an image with a ray diagram I can change.' },
  { title: 'Titration curve', tag: 'Chemistry', prompt: 'Draw a titration curve and show how the pH changes as acid is added to a base.' },
  { title: 'Ideal gas particles', tag: 'Physics', prompt: 'Show ideal gas particles bouncing in a box as I change temperature and volume.' },
  { title: 'Normal distribution', tag: 'Statistics', prompt: 'Explain the normal distribution and what its mean and standard deviation do.' },
  { title: 'Derivative as slope', tag: 'Maths', prompt: 'Explain the derivative as the slope of a curve at a point.' },
];

export function mountGalleryPage(root: HTMLElement): void {
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

  const cards: Array<{ el: HTMLElement; card: GalleryCard }> = [];

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
    <span class="gallery-detail__visual" aria-hidden="true"><span class="gallery-card__shimmer"></span></span>
    <h2 class="gallery-detail__title"></h2>
    <p class="gallery-detail__prompt"></p>
    <button type="button" class="gallery-detail__generate">Generate in chat</button>
  `;

  const openDetail = (card: GalleryCard): void => {
    (detail.querySelector('.gallery-detail__tag') as HTMLElement).textContent = card.tag;
    detail.querySelector('.gallery-detail__title')!.textContent = card.title;
    detail.querySelector('.gallery-detail__prompt')!.textContent = card.prompt;
    detail.dataset.prompt = card.prompt;
    overlay.hidden = false;
    detail.hidden = false;
    (detail.querySelector('.gallery-detail__generate') as HTMLButtonElement).focus();
  };
  const closeDetail = (): void => {
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

  for (const card of CARDS) {
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
}

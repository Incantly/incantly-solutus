/**
 * The first page of the studio (`.kiro/specs/studio-landing`). Each part shows that app itself, running one of the
 * studio's examples. A `?mode=`, `?start`, or shared `#f=` address never shows this page: `main.ts` opens the studio.
 */
import type { AppModeId } from '@incantly/modes';
import { onCasEngine } from '@incantly/kernel';
import { createApp } from '@incantly/sdk';
import type { MountedApp, UiOptions } from '@incantly/sdk';
import { createBoard } from '@incantly/board';
import { EXAMPLES } from './examples';
import { loadCasEngine, onCasAnswer } from './registry';

export interface LandingOptions {
  /** Opens the studio. With no mode, the whole studio (Classic). */
  onStart(mode?: AppModeId): void;
}

interface Part {
  readonly title: string;
  readonly purpose: string;
  readonly text: string;
  readonly mode?: AppModeId;
  /** The app the stage runs. The Board stage is the board, not a figure. */
  readonly show: AppModeId | 'board';
  readonly example?: string;
  readonly script?: string;
  /** Geometry's tool strip would cover the figure, so that stage only shows the construction. */
  readonly readOnly?: boolean;
  /** Exact algebra waits for the engine, then the figure is drawn again. */
  readonly algebra?: boolean;
}

const QUIET: Partial<UiOptions> = {
  menu: false,
  undoRedo: false,
  clockBar: false,
  zoomButtons: false,
  resetButton: false,
  dragPoints: true,
  panAndZoom: true,
  fileFeatures: false,
  borderColor: 'none',
  background: '#ffffff',
};

/** A circle and its tangent: the figure a spoken lesson draws (the embed demo's first figure). */
const LESSON = ['@view -5 5 -3.5 3.5', 'c = Circle((0, 0), 2)', 'P = PointOn(c, 0.6)', 'T = Tangent(P, c)'].join('\n');
/** The algebra example's visible lines: the factor, the roots, and the circle. The heavy factorisations stay out of this page. */
const ALGEBRA = [
  'p = Expr(x^2 - 5x + 6)',
  'fp = Factor(p)',
  'label = FormulaText(fp) with at = (-6, 4), anchor = nw, size = 22',
  'circ = Expr(x^2 + y^2 == 9) with plot = true',
].join('\n');

const linesOf = (id: string): string => EXAMPLES.find((e) => e.id === id)?.lines.join('\n') ?? '';

/** The algebra engine arrives after the figure. Recompute what was waiting, and paint. */
const settleAlgebra = (app: MountedApp): (() => void) => {
  let dead = false;
  const refresh = (): void => {
    if (dead) return;
    const ids = app.figure.objects().filter((o) => !o.cell.defined && o.cell.reason === 'pending').map((o) => o.id);
    if (ids.length === 0) return;
    app.figure.recompute(ids);
    app.figure.flush();
    app.screen.paint();
  };
  const stop = onCasAnswer(refresh);
  onCasEngine(refresh);
  return () => {
    dead = true;
    stop();
  };
};

const PARTS: readonly Part[] = [
  {
    title: 'A spoken lesson',
    purpose: 'talk, and the figure is drawn',
    text: 'Ask in words. The teacher draws the figure as it speaks, then asks you a question.',
    show: 'geometry',
    script: LESSON,
    readOnly: true,
  },
  {
    title: 'Graphing',
    purpose: 'draw functions',
    text: 'The curve, its derivative, and the shaded area. Drag a slider and the picture moves.',
    show: 'graphing',
    example: 'functions',
    mode: 'graphing',
  },
  {
    title: 'Geometry',
    purpose: 'build and measure',
    text: 'A triangle, the circle on one side, and the height. Drag a corner and the measures follow.',
    show: 'geometry',
    example: 'geometry',
    readOnly: true,
    mode: 'geometry',
  },
  {
    title: 'Scientific',
    purpose: 'calculate with keys',
    text: 'Each row keeps what you typed and the result, as a fraction or a decimal.',
    show: 'scientific',
    example: 'sci-fractions',
    mode: 'scientific',
  },
  {
    title: 'Probability',
    purpose: 'explore chance',
    text: 'A distribution with the chance shaded, and a chart of a sample beside it.',
    show: 'probability',
    example: 'probability',
    mode: 'probability',
  },
  {
    title: 'Board',
    purpose: 'write and draw',
    text: 'The page and the pen. Open it to write and to put a live graph on the page.',
    show: 'board',
    mode: 'notes',
  },
  {
    title: '3D',
    purpose: 'space and surfaces',
    text: 'A solid you can turn, and the face where a plane cuts it.',
    show: 'graphing3d',
    example: 'cube-slice',
    mode: 'graphing3d',
  },
  {
    title: 'CAS',
    purpose: 'exact algebra',
    text: 'Factor and solve, and the result stays exact.',
    show: 'classic',
    script: ALGEBRA,
    algebra: true,
    mode: 'cas',
  },
  {
    title: 'Classic',
    purpose: 'everything',
    text: 'The list and the graph together. This is the studio Start opens.',
    show: 'classic',
    example: 'functions',
    mode: 'classic',
  },
];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...kids);
  return node;
};

interface Live {
  destroy(): void;
}

/** Fills `root` with the landing page. Start and Open close these views and call `onStart`. */
export function mountLanding(root: HTMLElement, options: LandingOptions): void {
  const { onStart } = options;
  const live: Live[] = [];
  let closed = false;
  const close = (mode?: AppModeId): void => {
    if (closed) return;
    closed = true;
    for (const one of live) one.destroy();
    onStart(mode);
  };
  const open = (slot: HTMLElement, part: Part): void => {
    if (part.show === 'board') {
      const made = createBoard({ container: slot, canvas2dOnly: true, onError: () => undefined });
      if (!made.ok) return;
      const board = made.value;
      if (closed) board.dispose();
      else live.push({ destroy: () => board.dispose() });
      return;
    }
    const script = part.script ?? (part.example === undefined ? '' : linesOf(part.example));
    if (part.algebra === true) void loadCasEngine();
    void createApp({
      container: slot,
      mode: part.show,
      script,
      readOnly: part.readOnly === true,
      size: { width: 'fill', height: 'fill' },
      ui: QUIET,
    }).then((app) => {
      if (closed) {
        app.destroy();
        return;
      }
      const stop = part.algebra === true ? settleAlgebra(app) : undefined;
      live.push({ destroy: () => { stop?.(); app.destroy(); } });
    }, () => undefined);
  };
  const stage = (part: Part, now: boolean): HTMLElement => {
    const slot = h('div', { class: 'land-slot' });
    const box = h('div', { class: 'land-stage' }, slot);
    box.setAttribute('aria-label', part.title);
    const run = (): void => open(slot, part);
    if (now) run();
    else {
      const watch = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        watch.disconnect();
        run();
      }, { rootMargin: '240px' });
      watch.observe(box);
    }
    return box;
  };
  const sections = h('div', { class: 'land-sections' });
  PARTS.forEach((part, i) => {
    const button = h('button', { type: 'button', class: 'land-open' }, part.mode === undefined ? 'Open the studio' : `Open ${part.title}`);
    if (part.mode !== undefined) button.dataset['mode'] = part.mode;
    button.addEventListener('click', () => close(part.mode));
    const row = h('article', { class: i % 2 === 1 ? 'land-row flip' : 'land-row' }, h('div', { class: 'land-copy' }, h('p', { class: 'land-kicker' }, part.purpose), h('h2', {}, part.title), h('p', {}, part.text), button), stage(part, false));
    sections.append(row);
  });
  const hero = PARTS[1] as Part;
  const page = h(
    'div',
    { class: 'landing' },
    h(
      'header',
      { class: 'land-bar' },
      h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, '∿'), h('span', { class: 'brand-name' }, 'Incantly'), h('span', { class: 'brand-sub' }, 'Studio')),
      startButton(() => close()),
    ),
    h(
      'section',
      { class: 'land-hero' },
      h('div', { class: 'land-copy' }, h('h1', {}, 'A live blackboard for maths and science'), h('p', {}, 'Write a line and the figure is drawn. Each part below is that app, running one of its examples. Start opens the whole studio.'), startButton(() => close())),
      stage(hero, true),
    ),
    sections,
  );
  root.replaceChildren(page);
}

const startButton = (run: () => void): HTMLButtonElement => {
  const button = h('button', { type: 'button', class: 'land-start' }, 'Start');
  button.addEventListener('click', run);
  return button;
};

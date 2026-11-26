/**
 * The first page of the studio (`.kiro/specs/studio-landing`). It explains each part and opens the studio on Start.
 * A `?mode=`, `?start`, or shared `#f=` address never shows it: `main.ts` opens the studio directly.
 */
import type { AppModeId } from '@incantly/modes';

export interface LandingOptions {
  /** Opens the studio. With no mode, the whole studio (Classic). */
  onStart(mode?: AppModeId): void;
}

interface Part {
  readonly title: string;
  readonly purpose: string;
  readonly text: string;
  readonly example: readonly string[];
  readonly mode?: AppModeId;
}

const PARTS: readonly Part[] = [
  {
    title: 'A spoken lesson',
    purpose: 'talk, and the figure is drawn',
    text: 'Ask in words. The teacher draws the figure as it speaks, then asks you a question. The same lesson can run on the board.',
    example: ['You: Take a circle of radius 2.', 'c = Circle((0, 0), 2)', 'P = PointOn(c)', 'tg = Tangent(P, c)'],
  },
  {
    title: 'Graphing',
    purpose: 'draw functions',
    text: 'A function, its derivative, and the area under it. A slider moves the curve while you drag.',
    example: ['a = 1 in -3..3 step 0.1', 'f(x) = x^3 / 4 - a*x + 1', 'g = Derivative(f)', 'R = AreaUnder(f, -2, 2)'],
    mode: 'graphing',
  },
  {
    title: 'Geometry',
    purpose: 'build and measure',
    text: 'Points, a polygon, and the circle and height that belong to it. Drag a point and the measures follow.',
    example: ['A = (-3, -1)', 'B = (4, -2)', 'C = (1, 4)', 'tri = Polygon(A, B, C)', 'area = Area(tri)'],
    mode: 'geometry',
  },
  {
    title: 'Scientific',
    purpose: 'calculate with keys',
    text: 'One column of calculations. Each row keeps what you typed and the result, as a fraction or a decimal.',
    example: ['3/5 + 1/4', 'Ans * 2'],
    mode: 'scientific',
  },
  {
    title: 'Probability',
    purpose: 'explore chance',
    text: 'A distribution, the shaded chance between two values, and a chart of a sample. Drag the mean and the curve moves.',
    example: ['d = Normal(0, 1)', 'p = Prob(d, -1, 1)', 'rolls = Sample(DiscreteUniform(1, 6), 60)', 'tally = BarChart(rolls, 1)'],
    mode: 'probability',
  },
  {
    title: 'Board',
    purpose: 'write and draw',
    text: 'An endless page for pen, shapes, and handwriting. A figure card on the page is a live graph, calculator, or construction. The agent writes by hand and keeps new work on screen.',
    example: ['f(x) = (x - 1)^2 - 2', 'a card, an arrow, and a note beside it'],
    mode: 'notes',
  },
  {
    title: '3D',
    purpose: 'space and surfaces',
    text: 'Solids, planes, and a cut you can move. Press play and a point can climb a path, or a body can fall.',
    example: ['A = (0, 0, 0)', 'B = (3, 0, 0)', 'C = (0, 1, 0)', 'k = Cube(A, B, C)', 'p = Plane((1.5, 1.5, 1.5), Vector(1, 1, 1))', 'cut = Intersect(p, k)'],
    mode: 'graphing3d',
  },
  {
    title: 'CAS',
    purpose: 'exact algebra',
    text: 'Factor, solve, and rewrite, and the result stays exact. The same line can become a function on the graph.',
    example: ['p = Expr(x^2 - 5x + 6)', 'fp = Factor(p)', 's = Solve(Expr(p == 0), x)'],
    mode: 'cas',
  },
  {
    title: 'Classic',
    purpose: 'everything',
    text: 'Algebra, the graph, statistics, lists, and motion together. This is the studio Start opens.',
    example: ['xs = Seq(k, k, 1, 8)', 'M = Matrix([[2, 1], [1, 3]])', 'det = Determinant(M)', 'f(x) = sin(x - t)'],
    mode: 'classic',
  },
];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...kids);
  return node;
};

const startButton = (onStart: LandingOptions['onStart'], label: string): HTMLButtonElement => {
  const button = h('button', { type: 'button', class: 'land-start' }, label);
  button.addEventListener('click', () => onStart());
  return button;
};

/** Fills `root` with the landing page. Start and Open call `onStart`. */
export function mountLanding(root: HTMLElement, options: LandingOptions): void {
  const { onStart } = options;
  const sections = h('div', { class: 'land-sections' });
  for (const part of PARTS) {
    const open = h('button', { type: 'button', class: 'land-open' }, part.mode === undefined ? 'Open the studio' : `Open ${part.title}`);
    if (part.mode !== undefined) open.dataset['mode'] = part.mode;
    open.addEventListener('click', () => onStart(part.mode));
    const example = h('pre', { class: 'land-example' });
    example.append(h('code', {}, part.example.join('\n')));
    sections.append(
      h(
        'article',
        { class: 'land-card' },
        h('p', { class: 'land-kicker' }, part.purpose),
        h('h2', {}, part.title),
        h('p', {}, part.text),
        example,
        open,
      ),
    );
  }
  const page = h(
    'div',
    { class: 'landing' },
    h(
      'header',
      { class: 'land-bar' },
      h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, '∿'), h('span', { class: 'brand-name' }, 'Incantly'), h('span', { class: 'brand-sub' }, 'Studio')),
      startButton(onStart, 'Start'),
    ),
    h(
      'section',
      { class: 'land-hero' },
      h('h1', {}, 'A live blackboard for maths and science'),
      h('p', {}, 'Write a line and the figure is drawn. Drag a point, play a motion, or ask the teacher to draw it while it speaks. Each part below is one way in. Start opens the whole studio.'),
      startButton(onStart, 'Start'),
    ),
    sections,
  );
  root.replaceChildren(page);
}

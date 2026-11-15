/** Example figures, one per area built so far, so each can be tried in the studio. */

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'geometry',
    title: 'Geometry: a triangle and its circles',
    lines: [
      'A = (-3, -1)',
      'B = (4, -2)',
      'C = (1, 4)',
      'tri = Polygon(A, B, C)',
      'M = Midpoint(A, B)',
      'c = Circle(M, A)',
      'h = Perpendicular(C, Line(A, B))',
      'area = Area(tri)',
    ],
  },
  {
    id: 'functions',
    title: 'Functions: a cubic, its derivative and area',
    lines: [
      'a = 1 in -3..3 step 0.1',
      'f(x) = x^3 / 4 - a*x + 1',
      'g = Derivative(f)',
      'R = AreaUnder(f, -2, 2)',
      'r = Roots(f, -5, 5)',
    ],
  },
  {
    id: 'animation',
    title: 'Animation: a point on a moving wave',
    lines: [
      'f(x) = sin(x - t)',
      'P = (2, sin(2 - t))',
      'k = 0.5 in 0..2',
      'w(x) = k*cos(2x + t)',
    ],
  },
  {
    id: 'lists',
    title: 'Lists and matrices',
    lines: [
      'xs = Seq(k, k, 1, 8)',
      'P = Map(xs, k, (k / 2, sin(k) + 2))',
      'M = Matrix([[2, 1], [1, 3]])',
      'det = Determinant(M)',
      'ev = Eigenvalues(M)',
      'Q = Map(P, p, M * p)',
    ],
  },
  {
    id: 'one',
    title: 'Statistics: one variable',
    lines: [
      'data = [4, 7, 8, 8, 9, 10, 12, 12, 13, 15, 15, 16, 18, 21, 24]',
      'h = Histogram(data)',
      'b = BoxPlot(-1.5, 0.6, data, whisker = "tukey")',
      'd = Describe(data)',
      'm = Mean(data)',
      'q = Quantile(data, 0.9)',
    ],
  },
  {
    id: 'regression',
    title: 'Statistics: regression',
    lines: [
      'P = [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1), (6, 11.7), (7, 14.2)]',
      'fit = FitLine(P)',
      'band = FitBand(fit, 0.95, "prediction")',
      'sq = Squares(P, fit.f)',
      'r = Correlation(P)',
    ],
  },
  {
    id: 'tests',
    title: 'Statistics: tests and intervals',
    lines: [
      's = [5.1, 4.9, 5.6, 5.8, 6.0, 5.4, 5.2, 5.9]',
      'test = TTest(s, 5, "right")',
      'interval = TInterval(s, 0.95)',
      'chi = ChiSquaredTest([18, 22, 20, 40], [25, 25, 25, 25])',
      'g = ANOVA([[1, 2, 3], [4, 5, 6], [7, 8, 10]])',
    ],
  },
  {
    id: 'probability',
    title: 'Probability: distributions',
    lines: [
      'mu = 0 in -3..3 step 0.1',
      'sigma = 1 in 0.3..3 step 0.1',
      'd = Normal(mu, sigma)',
      'area = Shade(d, mu - sigma, mu + sigma)',
      'p = Prob(d, mu - sigma, mu + sigma)',
      'b = Shade(Binomial(10, 0.4), 3, 6)',
    ],
  },
  {
    id: 'random',
    title: 'Probability: dice, samples and seeds',
    lines: [
      '@seed 7',
      'n = 60 in 1..600 step 1',
      'die = DiscreteUniform(1, 6)',
      'rolls = Sample(die, n)',
      'tally = BarChart(rolls, 1)',
      'avg = Mean(rolls)',
    ],
  },
  {
    id: 'charts',
    title: 'Charts: pie, dots and stems',
    lines: [
      'votes = [12, 7, 5, 3]',
      'pie = PieChart(votes, ["Blue", "Orange", "Green", "Purple"], (5, 6), 2.5)',
      'scores = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 7, 9]',
      'dots = DotPlot(scores, 0.5)',
      'ages = [21, 23, 23, 24, 25, 25, 25, 27, 29, 31, 34]',
      'stem = StemPlot(ages)',
    ],
  },
  {
    id: 'selection',
    title: 'Selection: click rows or shapes (Shift adds)',
    lines: [
      'A = (-3, -1)',
      'B = (3, -1)',
      'C = (0, 3)',
      'tri = Polygon(A, B, C)',
      'c = Circle(C, 2)',
      'xs = Sample(Normal(0, 1), 20)',
    ],
  },
  {
    id: 'big-list',
    title: 'Big list: 2,500 rows that follow one slider',
    lines: ['a = 1 in 0..10 step 0.1', 'f(x) = sin(a*x)', 'P = (a, f(a))', ...Array.from({ length: 2497 }, (_, i) => `b${i} = a + ${i}`)],
  },
  {
    id: 'tools-keys',
    title: 'Tools: Ctrl+8 Angle, Alt for the reflex angle, arrows and Enter',
    lines: ['A = (-4, 0)', 'V = (0, 0)', 'B = (3, 3)', 'P = (-2, -3)', 'Q = (0, -3)', 'R = (2, -3)'],
  },
  {
    id: 'anim-lissajous',
    title: 'Animation: a Lissajous curve drawn by a traced point',
    lines: ['@clock 0..12.6', 'a = 3 in 1..5 step 1', 'P = (4*cos(a*t), 3*sin(2*t))', 'Trace(P)', 'frame = Polygon((-4.5, -3.5), (4.5, -3.5), (4.5, 3.5), (-4.5, 3.5))'],
  },
  {
    id: 'anim-spirograph',
    title: 'Animation: a spirograph (move r, then press play)',
    lines: [
      '@clock 0..40',
      'R = 5',
      'r = 1.6 in 0.5..4 step 0.1',
      'd = 2.2 in 0..4 step 0.1',
      'C = ((R - r)*cos(t), (R - r)*sin(t))',
      'P = ((R - r)*cos(t) + d*cos((R - r)*t/r), (R - r)*sin(t) - d*sin((R - r)*t/r))',
      'rim = Circle((0, 0), R)',
      'wheel = Circle(C, r)',
      'arm = Segment(C, P)',
      'Trace(P)',
    ],
  },
  {
    id: 'anim-pendulum',
    title: 'Animation: a swinging pendulum and its path',
    lines: [
      '@clock 0..20',
      'amp = 0.9 in 0..1.5 step 0.05',
      'θ = amp*cos(2*t)',
      'pivot = (0, 4)',
      'bob = (3*sin(θ), 4 - 3*cos(θ))',
      'rod = Segment(pivot, bob)',
      'Trace(bob)',
    ],
  },
  {
    id: 'anim-slider',
    title: 'Animation: a slider that plays itself (Animate)',
    lines: ['a = 1 in -2..2 step 0.01', 'f(x) = a*x^2 - 2', 'g(x) = -a*x + 1', 'V = (0, -2)', 'Animate(a)'],
  },
  {
    id: 'anim-tangent',
    title: 'Animation: a tangent sliding along a curve',
    lines: [
      'f(x) = sin(x) + 0.3*x',
      'x0 = pingpong(2*t, 12) - 6',
      'P = (x0, f(x0))',
      'm = cos(x0) + 0.3',
      'T = Line(P, (x0 + 1, f(x0) + m))',
    ],
  },
  {
    id: 'anim-fire',
    title: 'Particles: a fire',
    lines: [
      '@clock 0..30',
      'fire = Particles(count = 1500, life = 1.2, pos = (0.4 (u - 0.5) + 0.15 noise(i, 3 age), 2.2 age - 0.6 age^2), color = rgb(255, 120 + 100 (1 - ph), 30), size = 0.08 (1 - ph), alpha = 1 - ph, blend = add)',
      'ground = Segment((-4, 0), (4, 0))',
      'top = (0, 3)',
    ],
  },
  {
    id: 'anim-fountain',
    title: 'Particles: a fountain with a colour fade',
    lines: [
      '@clock 0..30',
      'jet = Particles(count = 2500, life = 2, pos = (3 (u - 0.5)*age, 6 age - 3 age^2 - 3), color = Gradient(ph, rgb(80, 170, 255), rgb(20, 60, 200)), size = 0.07, alpha = 1 - ph)',
      'pool = Segment((-4, -3), (4, -3))',
      'top = (0, 0.5)',
    ],
  },
  {
    id: 'anim-galaxy',
    title: 'Particles: a turning spiral galaxy',
    lines: [
      '@clock 0..60',
      'spin = 0.4 in 0..2 step 0.05',
      'stars = Particles(count = 4000, life = 6, pos = ((0.5 + 5 u)*cos(7 u + spin*t + 0.3 v), (0.5 + 5 u)*sin(7 u + spin*t + 0.3 v)), color = Gradient(u, rgb(255, 150, 30), rgb(70, 60, 200)), size = 0.07, alpha = 0.95 - 0.5 u)',
      'edge = Circle((0, 0), 5.5)',
    ],
  },
  {
    id: 'text-logic',
    title: 'Text and logic: live text, fractions, surds, tests',
    lines: [
      'a = 0.75 in 0..2 step 0.05',
      'A = (0, 0)',
      'B = (4, 2)',
      'M = Midpoint(A, B)',
      'c = Circle(A, 3)',
      'f(x) = x^2/2 - 3*x',
      'info = "a = {a:2}, as a fraction {a:frac}, as a percent {a:pct}"',
      'frac = FractionText(a)',
      'root = SurdText(sqrt(8)/3)',
      'big = ScientificText(123456, sig = 3)',
      'place = Ordinal(21)',
      'how = Text(M, show = "definition")',
      'formula = FormulaText(f)',
      'L = [1, 2, 3, 4, 5, 6, 7, 8]',
      'evens = KeepIf(L, k, k / 2 == floor(k / 2))',
      'inside = IsInRegion(M, c)',
      'onLine = Related(M, Line(A, B), "on")',
    ],
  },
];


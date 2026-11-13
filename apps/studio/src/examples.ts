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
];

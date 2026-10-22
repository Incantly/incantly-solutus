/**
 * The size of an equation drawn as maths (DG-5), estimated from its source in
 * stage units. The runtime checks it against the stage and the renderer sizes
 * the equation's box by it, so the two agree without measuring. Stacked
 * fractions take about the width of their wider part and two lines.
 */

/** Words that show as one letter. */
const ONE_GLYPH = /\b(?:alpha|beta|gamma|delta|epsilon|zeta|eta|theta|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Sigma|Phi|Omega|sqrt|cbrt|abs)\b/g;

export interface EquationExtent {
  readonly width: number;
  readonly height: number;
}

export function equationExtent(source: string, size: number): EquationExtent {
  const stacked = source.includes('/');
  const raised = source.includes('^');
  const shown = source.replace(ONE_GLYPH, 'x').replace(/[*()\s]/g, '').length;
  const width = Math.max(1, (stacked ? 0.7 : 1) * shown) * size * 0.55;
  const height = size * (stacked ? 2.4 : raised ? 1.6 : 1.3);
  return { width, height };
}

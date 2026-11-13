/**
 * Least squares for the fit commands (docs/features/statistics/design.md 7.2, 7.3): linear least squares by Householder
 * QR, polynomials on a Chebyshev basis, and Levenberg–Marquardt for models nonlinear in their parameters.
 */

/** Linear least squares `A c ≈ b` with row weights. `A` is n × k, row-major. */
export interface LinearSolution {
  readonly c: Float64Array;
  /** `(AᵀWA)⁻¹`, k × k row-major, for standard errors. */
  readonly inv: Float64Array;
  /** `max |R_ii| / min |R_ii|`: Infinity when a column is dependent. */
  readonly cond: number;
}

export function linearLS(a: Float64Array, n: number, k: number, b: Float64Array, w?: Float64Array): LinearSolution {
  const A = Float64Array.from(a);
  const y = Float64Array.from(b);
  if (w) {
    for (let i = 0; i < n; i++) {
      const s = Math.sqrt(w[i] as number);
      for (let j = 0; j < k; j++) A[i * k + j] = (A[i * k + j] as number) * s;
      y[i] = (y[i] as number) * s;
    }
  }
  const diag = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    let norm = 0;
    for (let i = j; i < n; i++) norm = Math.hypot(norm, A[i * k + j] as number);
    if (norm === 0) {
      diag[j] = 0;
      continue;
    }
    const alpha = (A[j * k + j] as number) > 0 ? -norm : norm;
    // v = x - alpha e1, stored in the column
    A[j * k + j] = (A[j * k + j] as number) - alpha;
    let vv = 0;
    for (let i = j; i < n; i++) vv += (A[i * k + j] as number) ** 2;
    if (vv > 0) {
      for (let c = j + 1; c < k; c++) {
        let d = 0;
        for (let i = j; i < n; i++) d += (A[i * k + j] as number) * (A[i * k + c] as number);
        const f = (2 * d) / vv;
        for (let i = j; i < n; i++) A[i * k + c] = (A[i * k + c] as number) - f * (A[i * k + j] as number);
      }
      let d = 0;
      for (let i = j; i < n; i++) d += (A[i * k + j] as number) * (y[i] as number);
      const f = (2 * d) / vv;
      for (let i = j; i < n; i++) y[i] = (y[i] as number) - f * (A[i * k + j] as number);
    }
    diag[j] = alpha;
  }
  // R: diagonal in `diag`, above in A
  const R = (i: number, j: number): number => (i === j ? (diag[i] as number) : (A[i * k + j] as number));
  let big = 0;
  let small = Infinity;
  for (let j = 0; j < k; j++) {
    big = Math.max(big, Math.abs(diag[j] as number));
    small = Math.min(small, Math.abs(diag[j] as number));
  }
  const cond = small === 0 ? Infinity : big / small;
  const c = new Float64Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let s = y[i] as number;
    for (let j = i + 1; j < k; j++) s -= R(i, j) * (c[j] as number);
    c[i] = s / R(i, i);
  }
  // R⁻¹ (upper), then inv = R⁻¹ R⁻ᵀ
  const Ri = new Float64Array(k * k);
  for (let col = 0; col < k; col++) {
    for (let i = k - 1; i >= 0; i--) {
      let s = i === col ? 1 : 0;
      for (let j = i + 1; j < k; j++) s -= R(i, j) * (Ri[j * k + col] as number);
      Ri[i * k + col] = s / R(i, i);
    }
  }
  const inv = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let m = 0; m < k; m++) s += (Ri[i * k + m] as number) * (Ri[j * k + m] as number);
      inv[i * k + j] = s;
    }
  }
  return { c, inv, cond };
}

/* ------------------------------ polynomials ------------------------------ */

/**
 * Polynomial least squares (design 7.2): x mapped to [-1, 1], a Chebyshev basis, then the coefficients and their
 * covariance converted to powers of x. Returns ascending power coefficients.
 */
export function polyLS(xs: Float64Array, ys: Float64Array, degree: number, w?: Float64Array): { coef: Float64Array; cov: Float64Array; cond: number } {
  const n = xs.length;
  const k = degree + 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of xs) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  const mid = (lo + hi) / 2;
  const half = hi > lo ? (hi - lo) / 2 : 1;
  const A = new Float64Array(n * k);
  for (let i = 0; i < n; i++) {
    const u = ((xs[i] as number) - mid) / half;
    let t0 = 1;
    let t1 = u;
    for (let j = 0; j < k; j++) {
      if (j === 0) A[i * k] = 1;
      else if (j === 1) A[i * k + 1] = u;
      else {
        const t2 = 2 * u * t1 - t0;
        A[i * k + j] = t2;
        t0 = t1;
        t1 = t2;
      }
    }
  }
  const sol = linearLS(A, n, k, ys, w);
  // M maps Chebyshev coefficients to power-of-x coefficients: column j holds T_j((x - mid) / half) in powers of x
  const M = new Float64Array(k * k);
  // Chebyshev in powers of u
  const cheb: Float64Array[] = [];
  for (let j = 0; j < k; j++) {
    const t = new Float64Array(k);
    if (j === 0) t[0] = 1;
    else if (j === 1) t[1] = 1;
    else {
      const a = cheb[j - 1] as Float64Array;
      const b = cheb[j - 2] as Float64Array;
      for (let m = 0; m < k; m++) t[m] = (m > 0 ? 2 * (a[m - 1] as number) : 0) - (b[m] as number);
    }
    cheb.push(t);
  }
  // u^m = ((x - mid) / half)^m in powers of x, by the binomial theorem
  const binom = (a: number, b: number): number => {
    let r = 1;
    for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
    return r;
  };
  for (let j = 0; j < k; j++) {
    const t = cheb[j] as Float64Array;
    for (let m = 0; m < k; m++) {
      const tm = t[m] as number;
      if (tm === 0) continue;
      for (let q = 0; q <= m; q++) {
        M[q * k + j] = (M[q * k + j] as number) + (tm * binom(m, q) * (-mid) ** (m - q)) / half ** m;
      }
    }
  }
  const coef = new Float64Array(k);
  for (let q = 0; q < k; q++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += (M[q * k + j] as number) * (sol.c[j] as number);
    coef[q] = s;
  }
  // cov = M inv Mᵀ
  const tmp = new Float64Array(k * k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    let s = 0;
    for (let m = 0; m < k; m++) s += (M[i * k + m] as number) * (sol.inv[m * k + j] as number);
    tmp[i * k + j] = s;
  }
  const cov = new Float64Array(k * k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
    let s = 0;
    for (let m = 0; m < k; m++) s += (tmp[i * k + m] as number) * (M[j * k + m] as number);
    cov[i * k + j] = s;
  }
  return { coef, cov, cond: sol.cond };
}

/* ------------------------------ Levenberg–Marquardt ------------------------------ */

export type Model = (x: number, p: Float64Array) => number;

export interface LMResult {
  readonly ok: boolean;
  readonly p: Float64Array;
  readonly sse: number;
  readonly iterations: number;
  /** `(JᵀWJ)⁻¹` at the solution, k × k, or undefined when singular. */
  readonly inv: Float64Array | undefined;
  /** Why it stopped, when not ok. */
  readonly why?: string;
}

/** Solves a small symmetric system by Gaussian elimination with partial pivoting; undefined when singular. */
function solve(A: Float64Array, b: Float64Array, k: number): Float64Array | undefined {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r * k + c] as number) > Math.abs(M[piv * k + c] as number)) piv = r;
    if (!((Math.abs(M[piv * k + c] as number)) > 0)) return undefined;
    if (piv !== c) {
      for (let j = 0; j < k; j++) {
        const t = M[c * k + j] as number;
        M[c * k + j] = M[piv * k + j] as number;
        M[piv * k + j] = t;
      }
      const t = x[c] as number;
      x[c] = x[piv] as number;
      x[piv] = t;
    }
    for (let r = c + 1; r < k; r++) {
      const f = (M[r * k + c] as number) / (M[c * k + c] as number);
      if (f === 0) continue;
      for (let j = c; j < k; j++) M[r * k + j] = (M[r * k + j] as number) - f * (M[c * k + j] as number);
      x[r] = (x[r] as number) - f * (x[c] as number);
    }
  }
  for (let r = k - 1; r >= 0; r--) {
    let s = x[r] as number;
    for (let j = r + 1; j < k; j++) s -= (M[r * k + j] as number) * (x[j] as number);
    x[r] = s / (M[r * k + r] as number);
  }
  return x.every(Number.isFinite) ? x : undefined;
}

function invert(A: Float64Array, k: number): Float64Array | undefined {
  const out = new Float64Array(k * k);
  for (let c = 0; c < k; c++) {
    const e = new Float64Array(k);
    e[c] = 1;
    const col = solve(A, e, k);
    if (!col) return undefined;
    for (let r = 0; r < k; r++) out[r * k + c] = col[r] as number;
  }
  return out;
}

const CBRT_EPS = Math.cbrt(Number.EPSILON);

/**
 * Levenberg–Marquardt (design 7.3): damping from `1e-3 · max diag(JᵀJ)`, ×10 on a rejected step, ÷3 on an accepted
 * one; the Jacobian by central differences with step `cbrt(eps) · max(1, |p|)`. Stops when the relative drop in the sum
 * of squares is below 1e-14 on two steps, the scaled gradient is below 1e-10, or after 200 iterations.
 */
export function levenberg(model: Model, xs: Float64Array, ys: Float64Array, start: Float64Array, w: Float64Array | undefined, spend: (n: number) => boolean): LMResult {
  const n = xs.length;
  const k = start.length;
  let p = Float64Array.from(start);
  const sseOf = (q: Float64Array): number => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const r = (ys[i] as number) - model(xs[i] as number, q);
      s += (w ? (w[i] as number) : 1) * r * r;
    }
    return s;
  };
  let sse = sseOf(p);
  if (!Number.isFinite(sse)) return { ok: false, p, sse, iterations: 0, inv: undefined, why: 'the model is undefined at the start values' };
  const J = new Float64Array(n * k);
  const r = new Float64Array(n);
  const JtJ = new Float64Array(k * k);
  const Jtr = new Float64Array(k);
  const jacobian = (q: Float64Array): boolean => {
    for (let i = 0; i < n; i++) r[i] = (ys[i] as number) - model(xs[i] as number, q);
    const h = new Float64Array(q);
    for (let j = 0; j < k; j++) {
      const step = CBRT_EPS * Math.max(1, Math.abs(q[j] as number));
      const keep = h[j] as number;
      h[j] = keep + step;
      const up = Float64Array.from(xs, (x) => model(x, h));
      h[j] = keep - step;
      const dn = Float64Array.from(xs, (x) => model(x, h));
      h[j] = keep;
      for (let i = 0; i < n; i++) J[i * k + j] = ((up[i] as number) - (dn[i] as number)) / (2 * step);
    }
    JtJ.fill(0);
    Jtr.fill(0);
    for (let i = 0; i < n; i++) {
      const wi = w ? (w[i] as number) : 1;
      for (let a = 0; a < k; a++) {
        const ja = J[i * k + a] as number;
        Jtr[a] = (Jtr[a] as number) + wi * ja * (r[i] as number);
        for (let b = 0; b <= a; b++) JtJ[a * k + b] = (JtJ[a * k + b] as number) + wi * ja * (J[i * k + b] as number);
      }
    }
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) JtJ[a * k + b] = JtJ[b * k + a] as number;
    return J.every(Number.isFinite);
  };
  if (!jacobian(p)) return { ok: false, p, sse, iterations: 0, inv: undefined, why: 'the model has no slope at the start values' };
  let maxDiag = 0;
  for (let j = 0; j < k; j++) maxDiag = Math.max(maxDiag, JtJ[j * k + j] as number);
  let lambda = 1e-3 * (maxDiag || 1);
  let small = 0;
  let it = 0;
  for (; it < 200; it++) {
    if (!spend(1 + Math.floor((n * k) / 1000))) return { ok: false, p, sse, iterations: it, inv: undefined, why: `stopped after ${it} steps: the work budget ran out` };
    // gradient test, scaled by the parameters and the residual size
    let g = 0;
    for (let j = 0; j < k; j++) g = Math.max(g, Math.abs(Jtr[j] as number) * Math.max(1, Math.abs(p[j] as number)));
    if (g <= 1e-10 * Math.max(sse, 1e-300) || sse === 0) break;
    let accepted = false;
    for (let tries = 0; tries < 40; tries++) {
      const A = Float64Array.from(JtJ);
      for (let j = 0; j < k; j++) A[j * k + j] = (A[j * k + j] as number) + lambda * Math.max(JtJ[j * k + j] as number, 1e-300);
      const d = solve(A, Jtr, k);
      if (d) {
        const q = p.map((v, j) => v + (d[j] as number));
        const s = sseOf(q);
        if (Number.isFinite(s) && s < sse) {
          const drop = (sse - s) / sse;
          p = q;
          sse = s;
          lambda /= 3;
          accepted = true;
          small = drop < 1e-14 ? small + 1 : 0;
          break;
        }
      }
      lambda *= 10;
      if (lambda > 1e30) break;
    }
    if (!accepted || small >= 2) break;
    if (!jacobian(p)) return { ok: false, p, sse, iterations: it, inv: undefined, why: 'the model lost its slope' };
  }
  if (it >= 200) return { ok: false, p, sse, iterations: it, inv: undefined, why: `stopped after 200 steps; sse ${sse.toPrecision(4)}, still falling` };
  jacobian(p);
  return { ok: true, p, sse, iterations: it, inv: invert(JtJ, k) };
}

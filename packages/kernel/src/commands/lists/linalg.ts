/**
 * Floating-point linear algebra (design 8.3). Plain loops on row-major `Float64Array`s; every routine returns a reason
 * text instead of throwing when it cannot finish.
 */

const EPS = 2.220446049250313e-16;

export type Dense = Float64Array;

export function normInf(a: Dense, r: number, c: number): number {
  let m = 0;
  for (let i = 0; i < r; i++) {
    let s = 0;
    for (let j = 0; j < c; j++) s += Math.abs(a[i * c + j] as number);
    if (s > m) m = s;
  }
  return m;
}

export function norm1(a: Dense, r: number, c: number): number {
  let m = 0;
  for (let j = 0; j < c; j++) {
    let s = 0;
    for (let i = 0; i < r; i++) s += Math.abs(a[i * c + j] as number);
    if (s > m) m = s;
  }
  return m;
}

export function normFro(a: Dense): number {
  let s = 0;
  let scale = 0;
  for (const x of a) scale = Math.max(scale, Math.abs(x));
  if (scale === 0) return 0;
  for (const x of a) s += (x / scale) ** 2;
  return scale * Math.sqrt(s);
}

/** The tolerance of design 8.3: `max(m, n) * eps * ‖M‖`. */
export function tolOf(a: Dense, r: number, c: number): number {
  return Math.max(r, c) * EPS * Math.max(normInf(a, r, c), Number.MIN_VALUE);
}

export function matMul(a: Dense, ar: number, ac: number, b: Dense, bc: number): Dense {
  const out = new Float64Array(ar * bc);
  // i-k-j order: the inner loop runs along rows of b and out
  for (let i = 0; i < ar; i++) {
    for (let k = 0; k < ac; k++) {
      const aik = a[i * ac + k] as number;
      if (aik === 0) continue;
      const bo = k * bc;
      const oo = i * bc;
      for (let j = 0; j < bc; j++) out[oo + j] = (out[oo + j] as number) + aik * (b[bo + j] as number);
    }
  }
  return out;
}

export function transpose(a: Dense, r: number, c: number): Dense {
  const out = new Float64Array(r * c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j * r + i] = a[i * c + j] as number;
  return out;
}

/* ------------------------------ LU ------------------------------ */

export interface LUResult {
  readonly lu: Dense;
  readonly perm: Int32Array;
  readonly sign: number;
  /** True when a pivot fell below the tolerance. */
  readonly singular: boolean;
  readonly smallest: number;
}

/** LU with partial pivoting, in place on a copy: `P A = L U`, L unit lower (below the diagonal of `lu`). */
export function lu(a: Dense, n: number): LUResult {
  const m = Float64Array.from(a);
  const perm = new Int32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  let sign = 1;
  let singular = false;
  let smallest = Infinity;
  const tol = n * EPS * Math.max(normInf(a, n, n), Number.MIN_VALUE);
  for (let k = 0; k < n; k++) {
    let p = k;
    let best = Math.abs(m[k * n + k] as number);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(m[i * n + k] as number);
      if (v > best) {
        best = v;
        p = i;
      }
    }
    smallest = Math.min(smallest, best);
    if (best <= tol) {
      singular = true;
      continue;
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = m[k * n + j] as number;
        m[k * n + j] = m[p * n + j] as number;
        m[p * n + j] = t;
      }
      const t = perm[k] as number;
      perm[k] = perm[p] as number;
      perm[p] = t;
      sign = -sign;
    }
    const piv = m[k * n + k] as number;
    for (let i = k + 1; i < n; i++) {
      const f = (m[i * n + k] as number) / piv;
      m[i * n + k] = f;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) m[i * n + j] = (m[i * n + j] as number) - f * (m[k * n + j] as number);
    }
  }
  return { lu: m, perm, sign, singular, smallest };
}

export function detFromLU(f: LUResult, n: number): number {
  let d = f.sign;
  for (let i = 0; i < n; i++) d *= f.lu[i * n + i] as number;
  return d;
}

/** Determinant by LU (a singular matrix gives exactly 0 only when a pivot is exactly 0). */
export function det(a: Dense, n: number): number {
  if (n === 0) return 1;
  const m = Float64Array.from(a);
  let d = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(m[i * n + k] as number) > Math.abs(m[p * n + k] as number)) p = i;
    const piv = m[p * n + k] as number;
    if (piv === 0) return 0;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = m[k * n + j] as number;
        m[k * n + j] = m[p * n + j] as number;
        m[p * n + j] = t;
      }
      d = -d;
    }
    d *= piv;
    for (let i = k + 1; i < n; i++) {
      const f = (m[i * n + k] as number) / piv;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) m[i * n + j] = (m[i * n + j] as number) - f * (m[k * n + j] as number);
    }
  }
  return d;
}

/** Solves `L U x = P b` for each column of b (`n × k`). */
export function luSolve(f: LUResult, n: number, b: Dense, k: number): Dense {
  const x = new Float64Array(n * k);
  for (let col = 0; col < k; col++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = b[(f.perm[i] as number) * k + col] as number;
      for (let j = 0; j < i; j++) s -= (f.lu[i * n + j] as number) * (y[j] as number);
      y[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i] as number;
      for (let j = i + 1; j < n; j++) s -= (f.lu[i * n + j] as number) * (x[j * k + col] as number);
      x[i * k + col] = s / (f.lu[i * n + i] as number);
    }
  }
  return x;
}

/** Solves `A X = B` (square) with one step of iterative refinement. Undefined when singular. */
export function solveSquare(a: Dense, n: number, b: Dense, k: number): Dense | undefined {
  const f = lu(a, n);
  if (f.singular) return undefined;
  const x = luSolve(f, n, b, k);
  // one refinement step: r = B - A X, X += A⁻¹ r
  const ax = matMul(a, n, n, x, k);
  const r = new Float64Array(n * k);
  for (let i = 0; i < r.length; i++) r[i] = (b[i] as number) - (ax[i] as number);
  const dx = luSolve(f, n, r, k);
  for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) + (dx[i] as number);
  return x;
}

export function inverse(a: Dense, n: number): Dense | undefined {
  const id = new Float64Array(n * n);
  for (let i = 0; i < n; i++) id[i * n + i] = 1;
  return solveSquare(a, n, id, n);
}

/* ------------------------------ QR ------------------------------ */

/** Householder QR of an `r × c` matrix: Q is `r × c` with orthonormal columns (thin), R is `c × c` upper (r ≥ c). */
export function qr(a: Dense, r: number, c: number): { q: Dense; r: Dense } {
  const m = Float64Array.from(a);
  const vs: Float64Array[] = [];
  const kmax = Math.min(r - 1, c);
  for (let k = 0; k < Math.min(r, c); k++) {
    let norm = 0;
    for (let i = k; i < r; i++) norm = Math.hypot(norm, m[i * c + k] as number);
    const v = new Float64Array(r);
    if (norm === 0 || k >= kmax) {
      vs.push(v);
      continue;
    }
    const alpha = (m[k * c + k] as number) > 0 ? -norm : norm;
    for (let i = k; i < r; i++) v[i] = m[i * c + k] as number;
    v[k] = (v[k] as number) - alpha;
    let vn = 0;
    for (let i = k; i < r; i++) vn += (v[i] as number) ** 2;
    if (vn === 0) {
      vs.push(new Float64Array(r));
      continue;
    }
    for (let j = 0; j < c; j++) {
      let s = 0;
      for (let i = k; i < r; i++) s += (v[i] as number) * (m[i * c + j] as number);
      const f = (2 * s) / vn;
      for (let i = k; i < r; i++) m[i * c + j] = (m[i * c + j] as number) - f * (v[i] as number);
    }
    for (let i = k; i < r; i++) v[i] = (v[i] as number) / Math.sqrt(vn);
    vs.push(v);
  }
  const p = Math.min(r, c);
  // R: the top p rows
  const R = new Float64Array(p * c);
  for (let i = 0; i < p; i++) for (let j = i; j < c; j++) R[i * c + j] = m[i * c + j] as number;
  // Q = H_0 H_1 ... applied to the first p columns of I
  const Q = new Float64Array(r * p);
  for (let i = 0; i < p; i++) Q[i * p + i] = 1;
  for (let k = vs.length - 1; k >= 0; k--) {
    const v = vs[k] as Float64Array;
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let i = 0; i < r; i++) s += (v[i] as number) * (Q[i * p + j] as number);
      if (s === 0) continue;
      for (let i = 0; i < r; i++) Q[i * p + j] = (Q[i * p + j] as number) - 2 * s * (v[i] as number);
    }
  }
  return { q: Q, r: R };
}

/** Least squares `min ‖A x − b‖` by QR (r ≥ c, full column rank). Undefined when rank-deficient. */
export function leastSquares(a: Dense, r: number, c: number, b: Dense, k: number): Dense | undefined {
  const { q, r: R } = qr(a, r, c);
  const tol = tolOf(a, r, c);
  for (let i = 0; i < c; i++) if (Math.abs(R[i * c + i] as number) <= tol) return undefined;
  const qtb = matMul(transpose(q, r, c), c, r, b, k);
  const x = new Float64Array(c * k);
  for (let col = 0; col < k; col++) {
    for (let i = c - 1; i >= 0; i--) {
      let s = qtb[i * k + col] as number;
      for (let j = i + 1; j < c; j++) s -= (R[i * c + j] as number) * (x[j * k + col] as number);
      x[i * k + col] = s / (R[i * c + i] as number);
    }
  }
  return x;
}

/* ------------------------------ Cholesky ------------------------------ */

/** `L` with `L Lᵀ = A`, or the 1-based index of the first leading minor that is not positive. */
export function cholesky(a: Dense, n: number): { l: Dense } | { minor: number } {
  const l = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let s = a[j * n + j] as number;
    for (let k = 0; k < j; k++) s -= (l[j * n + k] as number) ** 2;
    if (!(s > 0)) return { minor: j + 1 };
    const d = Math.sqrt(s);
    l[j * n + j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = a[i * n + j] as number;
      for (let k = 0; k < j; k++) t -= (l[i * n + k] as number) * (l[j * n + k] as number);
      l[i * n + j] = t / d;
    }
  }
  return { l };
}

/* ------------------------------ SVD ------------------------------ */

/**
 * One-sided Jacobi SVD (design 8.3): rotate column pairs of a copy of A until they are orthogonal. Returns `U` (`r × p`),
 * the singular values (descending) and `V` (`c × p`), `p = min(r, c)`; a wide matrix is handled through its transpose.
 */
export function svd(a: Dense, r: number, c: number): { u: Dense; s: Float64Array; v: Dense } | { reason: string } {
  if (r < c) {
    const t = svd(transpose(a, r, c), c, r);
    if ('reason' in t) return t;
    return { u: t.v, s: t.s, v: t.u };
  }
  const u = Float64Array.from(a);
  const v = new Float64Array(c * c);
  for (let i = 0; i < c; i++) v[i * c + i] = 1;
  const tol = EPS * Math.max(normFro(a), Number.MIN_VALUE);
  let converged = false;
  for (let sweep = 0; sweep < 60 && !converged; sweep++) {
    converged = true;
    for (let p = 0; p < c - 1; p++) {
      for (let q = p + 1; q < c; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < r; i++) {
          const x = u[i * c + p] as number;
          const y = u[i * c + q] as number;
          alpha += x * x;
          beta += y * y;
          gamma += x * y;
        }
        if (Math.abs(gamma) <= tol * tol || Math.abs(gamma) <= EPS * Math.sqrt(alpha * beta)) continue;
        converged = false;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const cs = 1 / Math.sqrt(1 + t * t);
        const sn = cs * t;
        for (let i = 0; i < r; i++) {
          const x = u[i * c + p] as number;
          const y = u[i * c + q] as number;
          u[i * c + p] = cs * x - sn * y;
          u[i * c + q] = sn * x + cs * y;
        }
        for (let i = 0; i < c; i++) {
          const x = v[i * c + p] as number;
          const y = v[i * c + q] as number;
          v[i * c + p] = cs * x - sn * y;
          v[i * c + q] = sn * x + cs * y;
        }
      }
    }
  }
  if (!converged) return { reason: 'Jacobi SVD did not settle in 60 sweeps' };
  const s = new Float64Array(c);
  for (let j = 0; j < c; j++) {
    let n = 0;
    for (let i = 0; i < r; i++) n = Math.hypot(n, u[i * c + j] as number);
    s[j] = n;
    if (n > 0) for (let i = 0; i < r; i++) u[i * c + j] = (u[i * c + j] as number) / n;
  }
  // sort descending
  const order = Array.from({ length: c }, (_, i) => i).sort((x, y) => (s[y] as number) - (s[x] as number));
  const U = new Float64Array(r * c);
  const V = new Float64Array(c * c);
  const S = new Float64Array(c);
  order.forEach((from, to) => {
    S[to] = s[from] as number;
    for (let i = 0; i < r; i++) U[i * c + to] = u[i * c + from] as number;
    for (let i = 0; i < c; i++) V[i * c + to] = v[i * c + from] as number;
  });
  // a zero singular value has a zero column in U: complete it so U keeps orthonormal columns
  for (let j = 0; j < c; j++) {
    if ((S[j] as number) > 0) continue;
    for (let e = 0; e < r; e++) {
      const w = new Float64Array(r);
      w[e] = 1;
      for (let k = 0; k < c; k++) {
        if (k === j || ((S[k] as number) === 0 && k > j)) continue;
        let d = 0;
        for (let i = 0; i < r; i++) d += (w[i] as number) * (U[i * c + k] as number);
        for (let i = 0; i < r; i++) w[i] = (w[i] as number) - d * (U[i * c + k] as number);
      }
      let n = 0;
      for (let i = 0; i < r; i++) n = Math.hypot(n, w[i] as number);
      if (n > 0.5) {
        for (let i = 0; i < r; i++) U[i * c + j] = (w[i] as number) / n;
        break;
      }
    }
  }
  return { u: U, s: S, v: V };
}

/** Rank from singular values with the tolerance `max(r, c) * eps * σ_max` (or a given one). */
export function rankOf(s: Float64Array, r: number, c: number, tol?: number): number {
  const smax = s.length > 0 ? (s[0] as number) : 0;
  const t = tol ?? Math.max(r, c) * EPS * smax;
  let k = 0;
  for (const x of s) if (x > t) k++;
  return k;
}

/* ------------------------------ RREF ------------------------------ */

export function rref(a: Dense, r: number, c: number, tolIn?: number): { m: Dense; pivots: number[] } {
  const m = Float64Array.from(a);
  const tol = tolIn ?? tolOf(a, r, c);
  const pivots: number[] = [];
  let row = 0;
  for (let col = 0; col < c && row < r; col++) {
    let p = row;
    for (let i = row + 1; i < r; i++) if (Math.abs(m[i * c + col] as number) > Math.abs(m[p * c + col] as number)) p = i;
    if (Math.abs(m[p * c + col] as number) <= tol) {
      for (let i = row; i < r; i++) m[i * c + col] = 0;
      continue;
    }
    if (p !== row) {
      for (let j = 0; j < c; j++) {
        const t = m[row * c + j] as number;
        m[row * c + j] = m[p * c + j] as number;
        m[p * c + j] = t;
      }
    }
    const piv = m[row * c + col] as number;
    for (let j = 0; j < c; j++) m[row * c + j] = (m[row * c + j] as number) / piv;
    for (let i = 0; i < r; i++) {
      if (i === row) continue;
      const f = m[i * c + col] as number;
      if (f === 0) continue;
      for (let j = 0; j < c; j++) m[i * c + j] = (m[i * c + j] as number) - f * (m[row * c + j] as number);
    }
    pivots.push(col);
    row++;
  }
  for (let i = 0; i < m.length; i++) if (Math.abs(m[i] as number) <= tol) m[i] = 0;
  return { m, pivots };
}

/* ------------------------------ eigenvalues ------------------------------ */

export const isSymmetric = (a: Dense, n: number): boolean => {
  const tol = 64 * EPS * Math.max(normInf(a, n, n), Number.MIN_VALUE);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs((a[i * n + j] as number) - (a[j * n + i] as number)) > tol) return false;
  return true;
};

/** Cyclic Jacobi for a symmetric matrix: eigenvalues and orthonormal eigenvectors (columns). */
export function symEigen(a: Dense, n: number): { values: Float64Array; vectors: Dense } | { reason: string } {
  const m = Float64Array.from(a);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  const scale = Math.max(normFro(a), Number.MIN_VALUE);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += (m[i * n + j] as number) ** 2;
    if (Math.sqrt(off) <= EPS * scale) {
      const values = new Float64Array(n);
      for (let i = 0; i < n; i++) values[i] = m[i * n + i] as number;
      return { values, vectors: v };
    }
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p * n + q] as number;
        if (apq === 0) continue;
        const app = m[p * n + p] as number;
        const aqq = m[q * n + q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = m[k * n + p] as number;
          const akq = m[k * n + q] as number;
          m[k * n + p] = c * akp - s * akq;
          m[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = m[p * n + k] as number;
          const aqk = m[q * n + k] as number;
          m[p * n + k] = c * apk - s * aqk;
          m[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k * n + p] as number;
          const vkq = v[k * n + q] as number;
          v[k * n + p] = c * vkp - s * vkq;
          v[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { reason: 'Jacobi did not settle in 100 sweeps' };
}

/** Reduces a copy to upper Hessenberg form by Householder reflections. */
function hessenberg(a: Dense, n: number): Dense {
  const h = Float64Array.from(a);
  for (let k = 0; k < n - 2; k++) {
    let alpha = 0;
    for (let i = k + 1; i < n; i++) alpha = Math.hypot(alpha, h[i * n + k] as number);
    if (alpha === 0) continue;
    if ((h[(k + 1) * n + k] as number) > 0) alpha = -alpha;
    const v = new Float64Array(n);
    for (let i = k + 1; i < n; i++) v[i] = h[i * n + k] as number;
    v[k + 1] = (v[k + 1] as number) - alpha;
    let vn = 0;
    for (let i = k + 1; i < n; i++) vn += (v[i] as number) ** 2;
    if (vn === 0) continue;
    // H = (I - 2vvᵀ/vn) H (I - 2vvᵀ/vn)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = k + 1; i < n; i++) s += (v[i] as number) * (h[i * n + j] as number);
      const f = (2 * s) / vn;
      for (let i = k + 1; i < n; i++) h[i * n + j] = (h[i * n + j] as number) - f * (v[i] as number);
    }
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = k + 1; j < n; j++) s += (h[i * n + j] as number) * (v[j] as number);
      const f = (2 * s) / vn;
      for (let j = k + 1; j < n; j++) h[i * n + j] = (h[i * n + j] as number) - f * (v[j] as number);
    }
  }
  return h;
}

/**
 * Eigenvalues of a general real matrix: Hessenberg reduction, then the shifted QR iteration with Francis double steps on
 * the active block until it splits into 1×1 and 2×2 blocks (real Schur form). Returns `(re, im)` pairs.
 */
export function eigenvalues(a: Dense, n: number): { re: Float64Array; im: Float64Array } | { reason: string } {
  const h = hessenberg(a, n);
  const H = (i: number, j: number): number => h[i * n + j] as number;
  const set = (i: number, j: number, x: number): void => {
    h[i * n + j] = x;
  };
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let nn = n - 1;
  let t = 0;
  let its = 0;
  let total = 0;
  const anorm = Math.max(normInf(h, n, n), Number.MIN_VALUE);
  while (nn >= 0) {
    let l = nn;
    // look for a small subdiagonal element
    for (; l >= 1; l--) {
      const s = Math.abs(H(l - 1, l - 1)) + Math.abs(H(l, l)) || anorm;
      if (Math.abs(H(l, l - 1)) <= EPS * s) {
        set(l, l - 1, 0);
        break;
      }
    }
    const x = H(nn, nn);
    if (l === nn) {
      re[nn] = x + t;
      im[nn] = 0;
      nn--;
      its = 0;
      continue;
    }
    const y = H(nn - 1, nn - 1);
    const w = H(nn, nn - 1) * H(nn - 1, nn);
    if (l === nn - 1) {
      const p = 0.5 * (y - x);
      const q = p * p + w;
      const z = Math.sqrt(Math.abs(q));
      const xx = x + t;
      if (q >= 0) {
        const zz = p + (p >= 0 ? z : -z);
        re[nn - 1] = xx + zz;
        re[nn] = zz !== 0 ? xx - w / zz : xx + zz;
        im[nn - 1] = 0;
        im[nn] = 0;
      } else {
        re[nn - 1] = xx + p;
        re[nn] = xx + p;
        im[nn - 1] = -z;
        im[nn] = z;
      }
      nn -= 2;
      its = 0;
      continue;
    }
    if (total >= 60 * n) return { reason: `the QR iteration did not settle in ${60 * n} steps` };
    let xs = x;
    let ys = y;
    let ws = w;
    if (its === 10 || its === 20) {
      // exceptional shift
      t += xs;
      for (let i = 0; i <= nn; i++) set(i, i, H(i, i) - xs);
      const s = Math.abs(H(nn, nn - 1)) + Math.abs(H(nn - 1, nn - 2));
      xs = 0.75 * s;
      ys = xs;
      ws = -0.4375 * s * s;
    }
    its++;
    total++;
    // find two consecutive small subdiagonal elements
    let m = nn - 2;
    let p = 0;
    let q = 0;
    let r = 0;
    for (; m >= l; m--) {
      const z = H(m, m);
      const rr = xs - z;
      const ss = ys - z;
      p = (rr * ss - ws) / H(m + 1, m) + H(m, m + 1);
      q = H(m + 1, m + 1) - z - rr - ss;
      r = H(m + 2, m + 1);
      const s = Math.abs(p) + Math.abs(q) + Math.abs(r);
      p /= s;
      q /= s;
      r /= s;
      if (m === l) break;
      const u = Math.abs(H(m, m - 1)) * (Math.abs(q) + Math.abs(r));
      const v = Math.abs(p) * (Math.abs(H(m - 1, m - 1)) + Math.abs(z) + Math.abs(H(m + 1, m + 1)));
      if (u <= EPS * v) break;
    }
    for (let i = m + 2; i <= nn; i++) {
      set(i, i - 2, 0);
      if (i !== m + 2) set(i, i - 3, 0);
    }
    // the double QR step on rows l..nn and columns m..nn
    for (let k = m; k <= nn - 1; k++) {
      // the size of the column before it is scaled to 1: the new subdiagonal entry is −s times it
      let colScale = 0;
      if (k !== m) {
        p = H(k, k - 1);
        q = H(k + 1, k - 1);
        r = k !== nn - 1 ? H(k + 2, k - 1) : 0;
        colScale = Math.abs(p) + Math.abs(q) + Math.abs(r);
        if (colScale !== 0) {
          p /= colScale;
          q /= colScale;
          r /= colScale;
        }
      }
      const sgn = Math.sqrt(p * p + q * q + r * r);
      const s = p >= 0 ? sgn : -sgn;
      if (s === 0) continue;
      if (k === m) {
        if (l !== m) set(k, k - 1, -H(k, k - 1));
      } else set(k, k - 1, -s * colScale);
      p += s;
      const xx = p / s;
      const yy = q / s;
      const zz = r / s;
      q /= p;
      r /= p;
      for (let j = k; j <= nn; j++) {
        let pp = H(k, j) + q * H(k + 1, j);
        if (k !== nn - 1) {
          pp += r * H(k + 2, j);
          set(k + 2, j, H(k + 2, j) - pp * zz);
        }
        set(k + 1, j, H(k + 1, j) - pp * yy);
        set(k, j, H(k, j) - pp * xx);
      }
      const mmin = nn < k + 3 ? nn : k + 3;
      for (let i = l; i <= mmin; i++) {
        let pp = xx * H(i, k) + yy * H(i, k + 1);
        if (k !== nn - 1) {
          pp += zz * H(i, k + 2);
          set(i, k + 2, H(i, k + 2) - pp * r);
        }
        set(i, k + 1, H(i, k + 1) - pp * q);
        set(i, k, H(i, k) - pp);
      }
    }
  }
  return { re, im };
}

/**
 * A unit eigenvector for a real eigenvalue λ by inverse iteration on `A − (λ + δ) I`; undefined when it does not settle.
 */
export function eigenvector(a: Dense, n: number, lambda: number): Float64Array | undefined {
  const scale = Math.max(normInf(a, n, n), 1);
  const shift = lambda + scale * 1e-10;
  const m = Float64Array.from(a);
  for (let i = 0; i < n; i++) m[i * n + i] = (m[i * n + i] as number) - shift;
  const f = lu(m, n);
  // replace exactly-zero pivots by a tiny one so the solve still points along the null direction
  for (let i = 0; i < n; i++) if (Math.abs(f.lu[i * n + i] as number) < EPS * scale) f.lu[i * n + i] = EPS * scale;
  let v: Float64Array = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = 1 / Math.sqrt(n) + (i % 2 === 0 ? 1e-3 : -1e-3) * (i + 1);
  for (let it = 0; it < 8; it++) {
    const w = luSolve({ ...f, singular: false }, n, v, 1);
    let nrm = 0;
    for (const x of w) nrm = Math.hypot(nrm, x);
    if (!(nrm > 0) || !Number.isFinite(nrm)) return undefined;
    for (let i = 0; i < n; i++) w[i] = (w[i] as number) / nrm;
    v = w;
  }
  // a sign convention: the largest component positive
  let big = 0;
  for (let i = 1; i < n; i++) if (Math.abs(v[i] as number) > Math.abs(v[big] as number)) big = i;
  if ((v[big] as number) < 0) for (let i = 0; i < n; i++) v[i] = -(v[i] as number);
  return v;
}

export { EPS };

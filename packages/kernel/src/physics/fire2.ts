/**
 * Fire in the plane (docs/features/physics/design.md 9.7; Fedkiw, Stam and Jensen 2001, Nguyen, Fedkiw and Jensen 2002,
 * FlameForge 2024): the steps a fire grid adds to the smoke step of `smoke2.ts`, and the swirl (vorticity confinement)
 * that smoke too may ask for.
 *
 * A fire grid is a `Smoke2` that also holds, in each cell, a temperature `T` (°C above the air) and fuel `F`. They are
 * carried along the flow like smoke; heat lifts the flow; fuel burns into heat and smoke where it is hot enough; the
 * source makes fuel; cooling goes by T⁴. Water (drops in a cell) takes heat and fuel away.
 *
 * Exact maths only (`+ - * /` and `Math.sqrt`), no memory made in a step, every loop in a fixed order.
 */
import type { Smoke2 } from './smoke2';

/** The fire's own settings (design 9.7). */
export interface FireParams {
  /** Fuel made at the source, per second (0 to 10). */
  fuel: number;
  /** How fast fuel burns (0.1 to 10). */
  burn: number;
  /** The hottest a flame gets, °C. */
  heat: number;
  /** Smoke made per unit of fuel burnt. */
  smoke: number;
}

/** Where burning starts, °C above the air (design 9.7 step 4). */
export const IGNITE_AT = 150;
/** Burning is full at this temperature above the ignite point: the smoothstep runs 150 to 400 °C. */
const RAMP = 250;
/** Lift of the hottest flame is `heat / 100` m/s²: α = 0.01 per °C (plan 11A). */
const LIFT_PER_DEGREE = 0.01;
/** Smoke sinks: β m/s² per unit of density. */
const SINK_PER_SMOKE = 0.5;
/** Black-body cooling per second (Nguyen 2002). */
const COOLING = 3;
/** The most heat a drop takes from a cell in one step. */
export const DROP_COOLS = 50;
/** A fire with less fuel than this (Σ F dx dy, m²) has none left: the notice `fire_out`. */
export const FUEL_GONE = 1e-4;
/** A cell above this is a flame (the readout `burning`, the crackle). */
export const FLAME_AT = 500;

/** The drops of a liquid as the grid reads them. */
export interface DropsView {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
}

/**
 * Two fields at a point (temperature into `out[0]`, fuel into `out[1]`), from the air cells round it only: a solid's
 * cells hold none and would thin what is beside it.
 */
function carry(g: Smoke2, x: number, y: number, ta: Float64Array, fa: Float64Array, out: Float64Array): void {
  const n = g.n;
  let fx = (x - g.x0) / g.dx - 0.5;
  let fy = (y - g.y0) / g.dy - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > n - 1) fx = n - 1;
  if (fy < 0) fy = 0;
  else if (fy > n - 1) fy = n - 1;
  let i = Math.floor(fx);
  let j = Math.floor(fy);
  if (i > n - 2) i = n - 2;
  if (j > n - 2) j = n - 2;
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  const tx = fx - i;
  const ty = fy - j;
  const own = g.own;
  const c = j * n + i;
  const wa = (own[c] as number) < 0 ? (1 - tx) * (1 - ty) : 0;
  const wb = (own[c + 1] as number) < 0 ? tx * (1 - ty) : 0;
  const wc = (own[c + n] as number) < 0 ? (1 - tx) * ty : 0;
  const wd = (own[c + n + 1] as number) < 0 ? tx * ty : 0;
  const sum = wa + wb + wc + wd;
  if (!(sum > 0)) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  out[0] = (wa * (ta[c] as number) + wb * (ta[c + 1] as number) + wc * (ta[c + n] as number) + wd * (ta[c + n + 1] as number)) / sum;
  out[1] = (wa * (fa[c] as number) + wb * (fa[c + 1] as number) + wc * (fa[c + n] as number) + wd * (fa[c + n + 1] as number)) / sum;
}

/** Temperature and fuel are carried back along the flow, as smoke is (no mass rescaling: only smoke keeps its mass). */
export function advectFire(g: Smoke2, h: number): void {
  const n = g.n;
  const W = n + 1;
  const u = g.u;
  const v = g.v;
  const own = g.own;
  const { T, F, T2, F2 } = g;
  const two = g.pair;
  for (let j = 0; j < n; j++) {
    const y = g.y0 + (j + 0.5) * g.dy;
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if ((own[c] as number) >= 0) {
        T2[c] = 0;
        F2[c] = 0;
        continue;
      }
      const uu = 0.5 * ((u[j * W + i] as number) + (u[j * W + i + 1] as number));
      const vv = 0.5 * ((v[j * n + i] as number) + (v[(j + 1) * n + i] as number));
      if (uu === 0 && vv === 0) {
        T2[c] = T[c] as number;
        F2[c] = F[c] as number;
        continue;
      }
      const x = g.x0 + (i + 0.5) * g.dx;
      const bx = x - h * uu;
      const by = y - h * vv;
      if (bx < g.x0 || bx > g.x1 || by < g.y0 || by > g.y1) {
        T2[c] = 0;
        F2[c] = 0;
        continue;
      }
      carry(g, bx, by, T, F, two);
      T2[c] = two[0] as number;
      // fuel blended thinner than a millionth of a unit is gone, so a fire with nothing left to burn really holds none
      const f = two[1] as number;
      F2[c] = f > 1e-6 ? f : 0;
    }
  }
  g.T = T2;
  g.T2 = T;
  g.F = F2;
  g.F2 = F;
}

/** Heat lifts and smoke sinks: a = 0.01 T − 0.5 s on each horizontal face, from the mean of the two cells beside it. */
export function fireLift(g: Smoke2, h: number): void {
  const n = g.n;
  const { T, s, v } = g;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i < n; i++) {
      const lo = j > 0 ? j - 1 : -1;
      const hi = j < n ? j : -1;
      let t = 0;
      let d = 0;
      if (lo >= 0) {
        t += T[lo * n + i] as number;
        d += s[lo * n + i] as number;
      }
      if (hi >= 0) {
        t += T[hi * n + i] as number;
        d += s[hi * n + i] as number;
      }
      // a face at the edge of the box has one cell beside it: it takes that cell's value, as the smoke lift does
      if (lo >= 0 && hi >= 0) {
        t *= 0.5;
        d *= 0.5;
      }
      const a = LIFT_PER_DEGREE * t - SINK_PER_SMOKE * d;
      if (a !== 0) v[j * n + i] = (v[j * n + i] as number) + h * a;
    }
  }
}

/**
 * Vorticity confinement (Fedkiw, Stam and Jensen 2001): the curls the grid smears are put back. ω is the curl at each
 * cell centre (0 in solid cells and at the box edge), N the unit gradient of |ω|, and the force
 * `swirl × min(dx, dy) × (N_y ω, −N_x ω)` is added to the faces beside each cell, each face taking the mean of its two
 * cells; faces next to a solid take nothing.
 */
export function confine(g: Smoke2, h: number): void {
  const n = g.n;
  if (n < 3) return;
  const W = n + 1;
  const { u, v, own, om, fcx, fcy } = g;
  const hx = 0.5 / g.dx;
  const hy = 0.5 / g.dy;
  om.fill(0);
  fcx.fill(0);
  fcy.fill(0);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      if ((own[c] as number) >= 0) continue;
      const vr = 0.5 * ((v[j * n + i + 1] as number) + (v[(j + 1) * n + i + 1] as number));
      const vl = 0.5 * ((v[j * n + i - 1] as number) + (v[(j + 1) * n + i - 1] as number));
      const uu = 0.5 * ((u[(j + 1) * W + i] as number) + (u[(j + 1) * W + i + 1] as number));
      const ud = 0.5 * ((u[(j - 1) * W + i] as number) + (u[(j - 1) * W + i + 1] as number));
      om[c] = (vr - vl) * hx - (uu - ud) * hy;
    }
  }
  const k = g.swirl * Math.min(g.dx, g.dy);
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const c = j * n + i;
      const w = om[c] as number;
      if (w === 0) continue;
      const gx = (Math.abs(om[c + 1] as number) - Math.abs(om[c - 1] as number)) * hx;
      const gy = (Math.abs(om[c + n] as number) - Math.abs(om[c - n] as number)) * hy;
      const m = Math.sqrt(gx * gx + gy * gy) + 1e-9;
      fcx[c] = k * (gy / m) * w;
      fcy[c] = -k * (gx / m) * w;
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 1; i < n; i++) {
      const c = j * n + i;
      if ((own[c - 1] as number) >= 0 || (own[c] as number) >= 0) continue;
      u[j * W + i] = (u[j * W + i] as number) + h * 0.5 * ((fcx[c - 1] as number) + (fcx[c] as number));
    }
  }
  for (let j = 1; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const c = j * n + i;
      if ((own[c - n] as number) >= 0 || (own[c] as number) >= 0) continue;
      v[j * n + i] = (v[j * n + i] as number) + h * 0.5 * ((fcy[c - n] as number) + (fcy[c] as number));
    }
  }
}

/** Fuel burns where it is hot enough: it makes heat and smoke (design 9.7 step 4). */
export function burnFuel(g: Smoke2, h: number): void {
  const fire = g.fire as FireParams;
  const { T, F, s, own } = g;
  const rate = fire.burn * h;
  const heat = fire.heat;
  const heat2 = 2 * heat;
  const smoke = fire.smoke;
  for (let c = 0; c < T.length; c++) {
    const f = F[c] as number;
    const t = T[c] as number;
    if (!(f > 0) || !(t > IGNITE_AT) || (own[c] as number) >= 0) continue;
    let x = (t - IGNITE_AT) / RAMP;
    if (x > 1) x = 1;
    const xi = x * x * (3 - 2 * x);
    let r = rate * xi;
    if (r > f) r = f;
    F[c] = f - r;
    const nt = t + heat2 * r;
    T[c] = nt < heat ? nt : heat;
    s[c] = (s[c] as number) + smoke * r;
  }
}

/** The source puts in fuel and keeps its cells at `heat`, while the film time is under `until` (`making`). */
export function fireSource(g: Smoke2, h: number): void {
  if (!g.sourced || !g.making) return;
  const fire = g.fire as FireParams;
  const { T, F, src, own } = g;
  const add = fire.fuel * h;
  const heat = fire.heat;
  for (let c = 0; c < T.length; c++) {
    if (src[c] !== 1 || (own[c] as number) >= 0) continue;
    const f = (F[c] as number) + add;
    F[c] = f < 1 ? f : 1;
    T[c] = heat;
  }
}

/** Black-body cooling, `T −= 3 T⁴ / heat³ h`, never below 0 (Nguyen 2002). */
export function coolFire(g: Smoke2, h: number): void {
  const heat = (g.fire as FireParams).heat;
  const k = (COOLING * h) / (heat * heat * heat);
  const T = g.T;
  for (let c = 0; c < T.length; c++) {
    const t = T[c] as number;
    if (!(t > 0)) {
      if (t < 0) T[c] = 0;
      continue;
    }
    const t2 = t * t;
    const nt = t - k * t2 * t2;
    T[c] = nt > 0 ? nt : 0;
  }
}

/**
 * Water puts fire out: each drop in the box, in drop order, takes up to 50 °C and all the fuel of the cell it is in. The
 * cells that held a drop are marked in `wet`, which the burnable things read right after the step.
 */
export function quench(g: Smoke2, drops: DropsView | undefined): void {
  const wet = g.wet;
  wet.fill(0);
  if (!drops || drops.n === 0) return;
  const n = g.n;
  const { T, F, own } = g;
  const ix = 1 / g.dx;
  const iy = 1 / g.dy;
  for (let k = 0; k < drops.n; k++) {
    const x = drops.x[k] as number;
    const y = drops.y[k] as number;
    if (!(x >= g.x0 && x < g.x1 && y >= g.y0 && y < g.y1)) continue;
    let i = Math.floor((x - g.x0) * ix);
    let j = Math.floor((y - g.y0) * iy);
    if (i > n - 1) i = n - 1;
    if (j > n - 1) j = n - 1;
    const c = j * n + i;
    if ((own[c] as number) >= 0) continue;
    wet[c] = 1;
    const t = T[c] as number;
    T[c] = t - (t < DROP_COOLS ? t : DROP_COOLS);
    F[c] = 0;
  }
}

/** The hottest cell, °C. */
export function hottest(T: Float64Array): number {
  let m = 0;
  for (let c = 0; c < T.length; c++) if ((T[c] as number) > m) m = T[c] as number;
  return m;
}

/** The fuel in the grid: Σ F × dx × dy. */
export function fuelSum(g: Smoke2): number {
  let m = 0;
  const F = g.F;
  for (let c = 0; c < F.length; c++) m += F[c] as number;
  return m * g.dx * g.dy;
}

/** Cells above 500 °C. */
export function flameCells(T: Float64Array): number {
  let k = 0;
  for (let c = 0; c < T.length; c++) if ((T[c] as number) > FLAME_AT) k++;
  return k;
}

/**
 * Fire in space (docs/features/physics/design.md 9.7, 9.8): the steps a fire grid in space adds to the smoke step of
 * `smoke3.ts`, the plane's (`fire2.ts`) with a third axis. Every number is the plane's: lift 0.01 °C⁻¹ and 0.5 per unit of
 * smoke, ignite 150 °C with the smoothstep to 400 °C, cooling 3 T⁴ / heat³, a drop takes 50 °C and all the fuel of its
 * cell. Heat lifts along +z; swirl is vorticity confinement with `ω` a vector.
 *
 * Exact maths only, no memory made in a step, every loop in a fixed order.
 */
import { COOLING, DROP_COOLS, FLAME_AT, IGNITE_AT, LIFT_PER_DEGREE, RAMP, SINK_PER_SMOKE } from './fire2';
import type { FireParams } from './fire2';
import type { Smoke3 } from './smoke3';
import { GF, GI, GRID_OF } from './wasm/kernels';

/*
 * The plane's numbers, held in constants of this file: the loops below read them in every cell, and a binding imported
 * from another module is looked up each time by some module loaders (the test runner's), which cost a tenth of the lift
 * loop's time alone.
 */
const LIFT = LIFT_PER_DEGREE;
const SINK = SINK_PER_SMOKE;
const IGNITE = IGNITE_AT;
const RAMP_UP = RAMP;
const COOL = COOLING;
const WATER_TAKES = DROP_COOLS;
const FLAME = FLAME_AT;

/** The drops of a liquid in space as the grid reads them. */
export interface DropsView3 {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
}

/** `T` and `F` are carried back along the flow, as smoke is, from the air cells round the point only (no mass rescaling). */
export function advectFire3(g: Smoke3, h: number): void {
  const kn = g.kn;
  if (kn) {
    kn.fn.grid3_advect_fire(kn.gi, kn.gf);
    g.swapFire();
    return;
  }
  const n = g.n;
  const nn = n * n;
  const W1 = n + 1;
  const { u, v, w, own, T, F, T2, F2 } = g;
  const kx = h / g.dx;
  const ky = h / g.dy;
  const kz = h / g.dz;
  const lim = n - 0.5;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = (k * n + j) * n + i;
        if ((own[c] as number) >= 0) {
          T2[c] = 0;
          F2[c] = 0;
          continue;
        }
        const uu = 0.5 * ((u[(k * n + j) * W1 + i] as number) + (u[(k * n + j) * W1 + i + 1] as number));
        const vv = 0.5 * ((v[(k * W1 + j) * n + i] as number) + (v[(k * W1 + j + 1) * n + i] as number));
        const ww = 0.5 * ((w[c] as number) + (w[c + nn] as number));
        if (uu === 0 && vv === 0 && ww === 0) {
          T2[c] = T[c] as number;
          F2[c] = F[c] as number;
          continue;
        }
        let fx = i - kx * uu;
        let fy = j - ky * vv;
        let fz = k - kz * ww;
        if (!(fx >= -0.5 && fx <= lim && fy >= -0.5 && fy <= lim && fz >= -0.5 && fz <= lim)) {
          T2[c] = 0;
          F2[c] = 0;
          continue;
        }
        if (fx < 0) fx = 0;
        else if (fx > n - 1) fx = n - 1;
        if (fy < 0) fy = 0;
        else if (fy > n - 1) fy = n - 1;
        if (fz < 0) fz = 0;
        else if (fz > n - 1) fz = n - 1;
        let a = fx | 0;
        let b = fy | 0;
        let e = fz | 0;
        if (a > n - 2) a = n - 2;
        if (b > n - 2) b = n - 2;
        if (e > n - 2) e = n - 2;
        const tx = fx - a;
        const ty = fy - b;
        const tz = fz - e;
        const q = e * nn + b * n + a;
        const m0 = (own[q] as number) < 0 ? (1 - tx) * (1 - ty) * (1 - tz) : 0;
        const m1 = (own[q + 1] as number) < 0 ? tx * (1 - ty) * (1 - tz) : 0;
        const m2 = (own[q + n] as number) < 0 ? (1 - tx) * ty * (1 - tz) : 0;
        const m3 = (own[q + n + 1] as number) < 0 ? tx * ty * (1 - tz) : 0;
        const m4 = (own[q + nn] as number) < 0 ? (1 - tx) * (1 - ty) * tz : 0;
        const m5 = (own[q + nn + 1] as number) < 0 ? tx * (1 - ty) * tz : 0;
        const m6 = (own[q + nn + n] as number) < 0 ? (1 - tx) * ty * tz : 0;
        const m7 = (own[q + nn + n + 1] as number) < 0 ? tx * ty * tz : 0;
        const sum = m0 + m1 + m2 + m3 + m4 + m5 + m6 + m7;
        if (!(sum > 0)) {
          T2[c] = 0;
          F2[c] = 0;
          continue;
        }
        T2[c] = (m0 * (T[q] as number) + m1 * (T[q + 1] as number) + m2 * (T[q + n] as number) + m3 * (T[q + n + 1] as number) + m4 * (T[q + nn] as number) + m5 * (T[q + nn + 1] as number) + m6 * (T[q + nn + n] as number) + m7 * (T[q + nn + n + 1] as number)) / sum;
        // fuel blended thinner than a millionth of a unit is gone, so a fire with nothing left to burn really holds none
        const f = (m0 * (F[q] as number) + m1 * (F[q + 1] as number) + m2 * (F[q + n] as number) + m3 * (F[q + n + 1] as number) + m4 * (F[q + nn] as number) + m5 * (F[q + nn + 1] as number) + m6 * (F[q + nn + n] as number) + m7 * (F[q + nn + n + 1] as number)) / sum;
        F2[c] = f > 1e-6 ? f : 0;
      }
    }
  }
  g.T = T2;
  g.T2 = T;
  g.F = F2;
  g.F2 = F;
}

/** Heat lifts and smoke sinks along +z: a = 0.01 T − 0.5 s on each face across z, from the mean of the two cells beside it. */
export function fireLift3(g: Smoke3, h: number): void {
  const kn = g.kn;
  if (kn) {
    kn.fn.grid3_fire_lift(kn.gi, kn.gf);
    return;
  }
  const n = g.n;
  const nn = n * n;
  const { T, s, w } = g;
  // a face at the edge of the box has one cell beside it: it takes that cell's value
  for (let c = 0; c < nn; c++) {
    const a = LIFT * (T[c] as number) - SINK * (s[c] as number);
    w[c] = (w[c] as number) + h * a;
    const e = n * nn + c;
    const b = LIFT * (T[e - nn] as number) - SINK * (s[e - nn] as number);
    w[e] = (w[e] as number) + h * b;
  }
  for (let k = 1; k < n; k++) {
    const hi = k * nn;
    const lo = hi - nn;
    for (let c = 0; c < nn; c++) {
      const a = LIFT * (0.5 * ((T[lo + c] as number) + (T[hi + c] as number))) - SINK * (0.5 * ((s[lo + c] as number) + (s[hi + c] as number)));
      w[hi + c] = (w[hi + c] as number) + h * a;
    }
  }
}

/**
 * Vorticity confinement (Fedkiw, Stam and Jensen 2001) in space: `ω` is the curl of the centre speeds (0 in solid cells
 * and at the box edge), `N` the unit gradient of `|ω|`, and the force `swirl × min(dx, dy, dz) × (N × ω)` is added to the faces
 * beside each cell, each face taking the mean of its two cells; faces next to a solid take nothing, and a face takes at
 * most half a cell's worth of speed a step.
 */
export function confine3(g: Smoke3, h: number): void {
  const n = g.n;
  if (n < 3) return;
  const kn = g.kn;
  if (kn) {
    kn.fn.grid3_swirl(kn.gi, kn.gf);
    return;
  }
  const nn = n * n;
  const W1 = n + 1;
  const { u, v, w, own, ca, cb, cc, oa, ob, oc, om } = g;
  const hx = 0.5 / g.dx;
  const hy = 0.5 / g.dy;
  const hz = 0.5 / g.dz;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = (k * n + j) * n + i;
        ca[c] = 0.5 * ((u[(k * n + j) * W1 + i] as number) + (u[(k * n + j) * W1 + i + 1] as number));
        cb[c] = 0.5 * ((v[(k * W1 + j) * n + i] as number) + (v[(k * W1 + j + 1) * n + i] as number));
        cc[c] = 0.5 * ((w[c] as number) + (w[c + nn] as number));
      }
    }
  }
  oa.fill(0);
  ob.fill(0);
  oc.fill(0);
  om.fill(0);
  for (let k = 1; k < n - 1; k++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const c = (k * n + j) * n + i;
        if ((own[c] as number) >= 0) continue;
        const wx = ((cc[c + n] as number) - (cc[c - n] as number)) * hy - ((cb[c + nn] as number) - (cb[c - nn] as number)) * hz;
        const wy = ((ca[c + nn] as number) - (ca[c - nn] as number)) * hz - ((cc[c + 1] as number) - (cc[c - 1] as number)) * hx;
        const wz = ((cb[c + 1] as number) - (cb[c - 1] as number)) * hx - ((ca[c + n] as number) - (ca[c - n] as number)) * hy;
        oa[c] = wx;
        ob[c] = wy;
        oc[c] = wz;
        om[c] = Math.sqrt(wx * wx + wy * wy + wz * wz);
      }
    }
  }
  // the centre speeds are done with: ca, cb, cc now hold the force on each cell
  ca.fill(0);
  cb.fill(0);
  cc.fill(0);
  const kf = g.swirl * Math.min(g.dx, g.dy, g.dz);
  for (let k = 1; k < n - 1; k++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const c = (k * n + j) * n + i;
        if (!((om[c] as number) > 0)) continue;
        const gx = ((om[c + 1] as number) - (om[c - 1] as number)) * hx;
        const gy = ((om[c + n] as number) - (om[c - n] as number)) * hy;
        const gz = ((om[c + nn] as number) - (om[c - nn] as number)) * hz;
        const m = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-9;
        const Nx = gx / m;
        const Ny = gy / m;
        const Nz = gz / m;
        const wx = oa[c] as number;
        const wy = ob[c] as number;
        const wz = oc[c] as number;
        ca[c] = kf * (Ny * wz - Nz * wy);
        cb[c] = kf * (Nz * wx - Nx * wz);
        cc[c] = kf * (Nx * wy - Ny * wx);
      }
    }
  }
  const cap = (0.5 * Math.min(g.dx, g.dy, g.dz)) / h;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 1; i < n; i++) {
        const c = (k * n + j) * n + i;
        if ((own[c - 1] as number) >= 0 || (own[c] as number) >= 0) continue;
        let dv = h * 0.5 * ((ca[c - 1] as number) + (ca[c] as number));
        if (dv > cap) dv = cap;
        else if (dv < -cap) dv = -cap;
        u[(k * n + j) * W1 + i] = (u[(k * n + j) * W1 + i] as number) + dv;
      }
    }
  }
  for (let k = 0; k < n; k++) {
    for (let j = 1; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = (k * n + j) * n + i;
        if ((own[c - n] as number) >= 0 || (own[c] as number) >= 0) continue;
        let dv = h * 0.5 * ((cb[c - n] as number) + (cb[c] as number));
        if (dv > cap) dv = cap;
        else if (dv < -cap) dv = -cap;
        v[(k * W1 + j) * n + i] = (v[(k * W1 + j) * n + i] as number) + dv;
      }
    }
  }
  for (let k = 1; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = (k * n + j) * n + i;
        if ((own[c - nn] as number) >= 0 || (own[c] as number) >= 0) continue;
        let dv = h * 0.5 * ((cc[c - nn] as number) + (cc[c] as number));
        if (dv > cap) dv = cap;
        else if (dv < -cap) dv = -cap;
        w[c] = (w[c] as number) + dv;
      }
    }
  }
}

/**
 * Burning, the source, cooling and water, in the step's order. With the Rust loops they are one call: each cell's burning,
 * source and cooling read and write that cell only, so one pass over the cells gives the bits of three; the cells the drops
 * are in go to it as a list, and it takes them in drop order.
 */
export function fireStep3(g: Smoke3, h: number, drops: DropsView3 | undefined): void {
  const kn = g.kn;
  const cells = g.dropCells;
  if (kn && (!drops || drops.n <= cells.length)) {
    let m = 0;
    if (drops) {
      for (; m < drops.n; m++) cells[m] = g.cellOfDrop(drops.x, drops.y, drops.z, m);
    }
    kn.I[GI.ndrops] = m;
    kn.fn.grid3_fire(kn.gi, kn.gf);
    return;
  }
  burnFuel3(g, h);
  fireSource3(g, h);
  coolFire3(g, h);
  quench3(g, drops);
}

/** Fuel burns where it is hot enough: it makes heat and smoke (design 9.7 step 4). */
export function burnFuel3(g: Smoke3, h: number): void {
  const fire = g.fire as FireParams;
  const { T, F, s, own } = g;
  const rate = fire.burn * h;
  const heat = fire.heat;
  const heat2 = 2 * heat;
  const smoke = fire.smoke;
  for (let c = 0; c < T.length; c++) {
    const f = F[c] as number;
    const t = T[c] as number;
    if (!(f > 0) || !(t > IGNITE) || (own[c] as number) >= 0) continue;
    let x = (t - IGNITE) / RAMP_UP;
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
export function fireSource3(g: Smoke3, h: number): void {
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
export function coolFire3(g: Smoke3, h: number): void {
  const heat = (g.fire as FireParams).heat;
  const k = (COOL * h) / (heat * heat * heat);
  const { T, src, own } = g;
  // the source keeps its cells at `heat`: they do not cool this step (design 9.8)
  const keep = g.sourced && g.making;
  for (let c = 0; c < T.length; c++) {
    if (keep && src[c] === 1 && (own[c] as number) < 0) continue;
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
export function quench3(g: Smoke3, drops: DropsView3 | undefined): void {
  const wet = g.wet;
  wet.fill(0);
  if (!drops || drops.n === 0) return;
  const { T, F, own } = g;
  for (let m = 0; m < drops.n; m++) {
    const c = g.cellOfDrop(drops.x, drops.y, drops.z, m);
    if (c < 0 || (own[c] as number) >= 0) continue;
    wet[c] = 1;
    const t = T[c] as number;
    T[c] = t - (t < WATER_TAKES ? t : WATER_TAKES);
    F[c] = 0;
  }
}

/** The hottest cell, °C. */
export function hottest3(T: Float32Array): number {
  const kn = GRID_OF.get(T);
  if (kn) {
    kn.fn.grid3_hottest(kn.gi, kn.gf);
    return kn.F[GF.out] as number;
  }
  let m = 0;
  for (let c = 0; c < T.length; c++) if ((T[c] as number) > m) m = T[c] as number;
  return m;
}

/** The fuel in the grid: Σ F × dx × dy × dz. */
export function fuelSum3(g: Smoke3): number {
  const kn = g.kn;
  if (kn) {
    kn.fn.grid3_fuel_sum(kn.gi, kn.gf);
    return (kn.F[GF.out] as number) * g.dx * g.dy * g.dz;
  }
  let m = 0;
  const F = g.F;
  for (let c = 0; c < F.length; c++) m += F[c] as number;
  return m * g.dx * g.dy * g.dz;
}

/** Cells above 500 °C. */
export function flameCells3(T: Float32Array): number {
  const kn = GRID_OF.get(T);
  if (kn) {
    kn.fn.grid3_flames(kn.gi, kn.gf);
    return kn.F[GF.out] as number;
  }
  let k = 0;
  for (let c = 0; c < T.length; c++) if ((T[c] as number) > FLAME) k++;
  return k;
}

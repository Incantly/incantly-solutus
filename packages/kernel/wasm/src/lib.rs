//! The hot loops of the cloth and liquid solvers (docs/features/physics/design.md 11.6).
//!
//! Every function here is a line-by-line copy of a TypeScript loop in `packages/kernel/src/physics/` (named in each
//! comment), so a film is the same bits with or without WebAssembly (design 10.2):
//!
//! - the same operations in the same order, with every `(a + b) + c` grouping as written there;
//! - `f64` only, no fused multiply-add (WebAssembly has none), no SIMD, no fast-math;
//! - `f64::sqrt`, `floor` and `abs` compile to the `f64.sqrt`, `f64.floor` and `f64.abs` instructions, which round
//!   exactly as `Math.sqrt`, `Math.floor` and `Math.abs` do.
//!
//! The functions take byte offsets into the module's own memory (the TypeScript side owns the memory and cuts the arrays
//! from it) and counts. Nothing here allocates, and nothing reads past what the caller says is there.
#![allow(
    clippy::missing_safety_doc,
    clippy::too_many_arguments,
    clippy::neg_cmp_op_on_partial_ord,
    clippy::manual_range_contains,
    clippy::collapsible_else_if,
    clippy::collapsible_if,
    clippy::needless_range_loop,
    clippy::excessive_precision
)]

/// Air density, kg/m³, and the skin drag of air along a face, as a part of its push through it (`cloth.ts`).
const AIR: f64 = 1.2;
const SKIN: f64 = 0.1;
/// The width of a thread in the plane that the air pushes on, m (`cloth.ts`).
const THREAD_WIDTH: f64 = 0.05;
/// The most neighbours one drop keeps (`grid3.ts`).
const MAX_NEIGHBOURS3: i32 = 64;

/// The numbers a cloth call takes are not passed as arguments: a call with a floating-point argument makes the caller
/// box it unless the engine has inlined the call, and a step must make no garbage (design 11.4). The caller writes them
/// to a block of its own in the memory, and passes where it is: the small step, gravity, the cloth's damping,
/// 1 / step², and the wind. The caller does no arithmetic on them (before the engine optimises the caller, every result
/// would be a heap number); the products and the speeds' factor are worked out here, as the TypeScript loops do.
const P_HS: i32 = 0;
const P_GX: i32 = 1;
const P_GY: i32 = 2;
const P_GZ: i32 = 3;
const P_DAMP: i32 = 4;
const P_INV2: i32 = 5;
const P_WX: i32 = 6;
const P_WY: i32 = 7;
const P_WZ: i32 = 8;

type F = *mut f64;
type I = *mut i32;

#[inline(always)]
unsafe fn ld(p: *const f64, i: i32) -> f64 {
    *p.offset(i as isize)
}
#[inline(always)]
unsafe fn st(p: *mut f64, i: i32, v: f64) {
    *p.offset(i as isize) = v;
}
#[inline(always)]
unsafe fn li(p: *const i32, i: i32) -> i32 {
    *p.offset(i as isize)
}
#[inline(always)]
unsafe fn si(p: *mut i32, i: i32, v: i32) {
    *p.offset(i as isize) = v;
}
#[inline(always)]
unsafe fn lb(p: *const u8, i: i32) -> u8 {
    *p.offset(i as isize)
}

/// JavaScript's `ToInt32` of a number (what a store into an `Int32Array` does).
#[inline(always)]
fn to_i32(v: f64) -> i32 {
    if !(v > -2147483649.0 && v < 2147483648.0) {
        if v.is_nan() || v == f64::INFINITY || v == f64::NEG_INFINITY {
            return 0;
        }
        let t = v.trunc();
        let m = t - (t / 4294967296.0).floor() * 4294967296.0;
        return (m as i64) as u32 as i32;
    }
    v as i32
}

/// JavaScript's `Math.max` and `Math.min` (a NaN wins).
#[inline(always)]
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}
#[inline(always)]
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/* ------------------------------ cloth.ts ------------------------------ */

/// `ClothSet.solveLinks`, the fast loop over links [l0, l1): the links with `q < 0` move nothing here.
#[no_mangle]
pub unsafe extern "C" fn solve_links(
    x: F,
    y: F,
    z: F,
    w0: *const f64,
    la: *const i32,
    lb_: *const i32,
    lq: *const f64,
    lr2: *const f64,
    l0: i32,
    l1: i32,
) {
    let mut k = l0;
    while k < l1 {
        let q = ld(lq, k);
        let a = li(la, k);
        let b = li(lb_, k);
        let dx = ld(x, a) - ld(x, b);
        let dy = ld(y, a) - ld(y, b);
        let dz = ld(z, a) - ld(z, b);
        let d2 = dx * dx + dy * dy + dz * dz;
        let r2 = ld(lr2, k);
        let mut s = (r2 - d2) * q;
        if !(d2 < 1.21 * r2 && d2 > 0.81 * r2) {
            s = if d2 > 1e-24 { ((r2 / d2).sqrt() - 1.0) * 2.0 * r2 * q } else { 0.0 };
        }
        if q > 0.0 {
            let sa = ld(w0, a) * s;
            let sb = ld(w0, b) * s;
            st(x, a, ld(x, a) + sa * dx);
            st(y, a, ld(y, a) + sa * dy);
            st(z, a, ld(z, a) + sa * dz);
            st(x, b, ld(x, b) - sb * dx);
            st(y, b, ld(y, b) - sb * dy);
            st(z, b, ld(z, b) - sb * dz);
        }
        k += 1;
    }
}

/// `ClothSet.solveTethers` over tethers [t0, t1).
#[no_mangle]
pub unsafe extern "C" fn solve_tethers(
    x: F,
    y: F,
    z: F,
    w0: *const f64,
    te_point: *const i32,
    te_j: *const i32,
    te_l2: *const f64,
    te_pin: *const i32,
    pin_fx: F,
    pin_fy: F,
    pin_fz: F,
    taut: *mut u8,
    t0: i32,
    t1: i32,
) {
    let mut k = t0;
    while k < t1 {
        let i = li(te_point, k);
        let j = li(te_j, k);
        let dx = ld(x, i) - ld(x, j);
        let dy = ld(y, i) - ld(y, j);
        let dz = ld(z, i) - ld(z, j);
        let d2 = dx * dx + dy * dy + dz * dz;
        let l2 = ld(te_l2, k);
        if d2 <= l2 {
            k += 1;
            continue;
        }
        *taut.offset(i as isize) = 1;
        let f = 1.0 - (l2 / d2).sqrt();
        st(x, i, ld(x, i) - f * dx);
        st(y, i, ld(y, i) - f * dy);
        st(z, i, ld(z, i) - f * dz);
        let q = li(te_pin, k);
        let m = f / ld(w0, i);
        st(pin_fx, q, ld(pin_fx, q) + m * dx);
        st(pin_fy, q, ld(pin_fy, q) + m * dy);
        st(pin_fz, q, ld(pin_fz, q) + m * dz);
        k += 1;
    }
}

/// The speeds' factor of a small step, `1 / (hs (1 + damping hs))`, the damping kept within 0 and 1 (`ClothSet.speeds`).
#[inline(always)]
fn speeds_k(hs: f64, damping: f64) -> f64 {
    1.0 / (hs * (1.0 + js_min(1.0, js_max(0.0, damping)) * hs))
}

/// `ClothSet.advance` over points [p0, e). The block holds the small step and gravity; `gx` is `hs * gravity.x`, as there.
#[no_mangle]
pub unsafe extern "C" fn advance(
    x: F,
    y: F,
    z: F,
    px: F,
    py: F,
    pz: F,
    vx: F,
    vy: F,
    vz: F,
    pin_of: *const i32,
    afx: *const f64,
    afy: *const f64,
    afz: *const f64,
    p: *const f64,
    p0: i32,
    e: i32,
) {
    let hs = ld(p, P_HS);
    let gx = hs * ld(p, P_GX);
    let gy = hs * ld(p, P_GY);
    let gz = hs * ld(p, P_GZ);
    let mut i = p0;
    while i < e {
        let xi = ld(x, i);
        let yi = ld(y, i);
        let zi = ld(z, i);
        st(px, i, xi);
        st(py, i, yi);
        st(pz, i, zi);
        if li(pin_of, i) >= 0 {
            i += 1;
            continue;
        }
        let ux = ld(vx, i) + gx + ld(afx, i);
        let uy = ld(vy, i) + gy + ld(afy, i);
        let uz = ld(vz, i) + gz + ld(afz, i);
        st(vx, i, ux);
        st(vy, i, uy);
        st(vz, i, uz);
        st(x, i, xi + hs * ux);
        st(y, i, yi + hs * uy);
        st(z, i, zi + hs * uz);
        i += 1;
    }
}

/// `ClothSet.speedsAdvance` over points [p0, e). The block holds the small step, gravity and the damping.
#[no_mangle]
pub unsafe extern "C" fn speeds_advance(
    x: F,
    y: F,
    z: F,
    px: F,
    py: F,
    pz: F,
    vx: F,
    vy: F,
    vz: F,
    pin_of: *const i32,
    afx: *const f64,
    afy: *const f64,
    afz: *const f64,
    p: *const f64,
    p0: i32,
    e: i32,
) {
    let hs = ld(p, P_HS);
    let gx = hs * ld(p, P_GX);
    let gy = hs * ld(p, P_GY);
    let gz = hs * ld(p, P_GZ);
    let k = speeds_k(hs, ld(p, P_DAMP));
    let mut i = p0;
    while i < e {
        let xi = ld(x, i);
        let yi = ld(y, i);
        let zi = ld(z, i);
        let mut ux = (xi - ld(px, i)) * k;
        let mut uy = (yi - ld(py, i)) * k;
        let mut uz = (zi - ld(pz, i)) * k;
        st(px, i, xi);
        st(py, i, yi);
        st(pz, i, zi);
        if li(pin_of, i) < 0 {
            ux += gx + ld(afx, i);
            uy += gy + ld(afy, i);
            uz += gz + ld(afz, i);
            st(x, i, xi + hs * ux);
            st(y, i, yi + hs * uy);
            st(z, i, zi + hs * uz);
        }
        st(vx, i, ux);
        st(vy, i, uy);
        st(vz, i, uz);
        i += 1;
    }
}

/// `ClothSet.speeds` over points [p0, e).
#[no_mangle]
pub unsafe extern "C" fn speeds(
    x: *const f64,
    y: *const f64,
    z: *const f64,
    px: *const f64,
    py: *const f64,
    pz: *const f64,
    vx: F,
    vy: F,
    vz: F,
    p: *const f64,
    p0: i32,
    e: i32,
) {
    let k = speeds_k(ld(p, P_HS), ld(p, P_DAMP));
    let mut i = p0;
    while i < e {
        st(vx, i, (ld(x, i) - ld(px, i)) * k);
        st(vy, i, (ld(y, i) - ld(py, i)) * k);
        st(vz, i, (ld(z, i) - ld(pz, i)) * k);
        i += 1;
    }
}

/// `ClothSet.solveChain` for one rope of `n` points from `p0`. `chain` points at the rope's first entry of the chain
/// table. The pull on a point held by a world pin goes straight into `pin_fx`, `pin_fy` and `pin_fz` (`pinForce`).
#[no_mangle]
pub unsafe extern "C" fn solve_chain(
    x: F,
    y: F,
    z: F,
    w: *const f64,
    rest: *const f64,
    alpha: *const f64,
    broken: *const u8,
    chain: *const i32,
    nx: F,
    ny: F,
    nz: F,
    dg: F,
    up: F,
    rhs: F,
    p0: i32,
    n: i32,
    p: *const f64,
    pin_of: *const i32,
    pin_fx: F,
    pin_fy: F,
    pin_fz: F,
) {
    let inv2 = ld(p, P_INV2);
    let m = n - 1;
    if m < 1 {
        return;
    }
    let mut k = 0;
    while k < m {
        let l = li(chain, k);
        let a = p0 + k;
        let b = a + 1;
        let dx = ld(x, b) - ld(x, a);
        let dy = ld(y, b) - ld(y, a);
        let dz = ld(z, b) - ld(z, a);
        let d = (dx * dx + dy * dy + dz * dz).sqrt();
        let ws = ld(w, a) + ld(w, b);
        if lb(broken, l) == 1 || !(d > 1e-12) || ws == 0.0 {
            st(nx, k, 0.0);
            st(ny, k, 0.0);
            st(nz, k, 0.0);
            st(dg, k, 1.0);
            st(rhs, k, 0.0);
            k += 1;
            continue;
        }
        st(nx, k, dx / d);
        st(ny, k, dy / d);
        st(nz, k, dz / d);
        st(dg, k, ws + ld(alpha, l) * inv2);
        st(rhs, k, ld(rest, l) - d);
        k += 1;
    }
    k = 0;
    while k + 1 < m {
        let wb = ld(w, p0 + k + 1);
        st(
            up,
            k,
            -wb * (ld(nx, k) * ld(nx, k + 1) + ld(ny, k) * ld(ny, k + 1) + ld(nz, k) * ld(nz, k + 1)),
        );
        k += 1;
    }
    k = 1;
    while k < m {
        let f = ld(up, k - 1) / ld(dg, k - 1);
        st(dg, k, ld(dg, k) - f * ld(up, k - 1));
        st(rhs, k, ld(rhs, k) - f * ld(rhs, k - 1));
        k += 1;
    }
    st(rhs, m - 1, ld(rhs, m - 1) / ld(dg, m - 1));
    k = m - 2;
    while k >= 0 {
        st(rhs, k, (ld(rhs, k) - ld(up, k) * ld(rhs, k + 1)) / ld(dg, k));
        k -= 1;
    }
    k = 0;
    while k <= m {
        let i = p0 + k;
        let lbk = if k > 0 { ld(rhs, k - 1) } else { 0.0 };
        let lak = if k < m { ld(rhs, k) } else { 0.0 };
        let ex = (if k > 0 { ld(nx, k - 1) * lbk } else { 0.0 }) - (if k < m { ld(nx, k) * lak } else { 0.0 });
        let ey = (if k > 0 { ld(ny, k - 1) * lbk } else { 0.0 }) - (if k < m { ld(ny, k) * lak } else { 0.0 });
        let ez = (if k > 0 { ld(nz, k - 1) * lbk } else { 0.0 }) - (if k < m { ld(nz, k) * lak } else { 0.0 });
        let wi = ld(w, i);
        if wi > 0.0 {
            st(x, i, ld(x, i) + wi * ex);
            st(y, i, ld(y, i) + wi * ey);
            st(z, i, ld(z, i) + wi * ez);
        } else {
            let q = li(pin_of, i);
            if q >= 0 {
                st(pin_fx, q, ld(pin_fx, q) + ex);
                st(pin_fy, q, ld(pin_fy, q) + ey);
                st(pin_fz, q, ld(pin_fz, q) + ez);
            }
        }
        k += 1;
    }
}

/// `ClothSet.airForces` for a world with a steady wind (the caller keeps the cases where the air's speed depends on the
/// place), over the faces [t0, t1) of one cloth. `afx`, `afy` and `afz` are zeroed by the caller.
#[no_mangle]
pub unsafe extern "C" fn air_forces(
    x: *const f64,
    y: *const f64,
    z: *const f64,
    vx: *const f64,
    vy: *const f64,
    vz: *const f64,
    w: *const f64,
    ta: *const i32,
    tb: *const i32,
    tc: *const i32,
    tri_cut: *const u8,
    pin_of: *const i32,
    afx: F,
    afy: F,
    afz: F,
    t0: i32,
    t1: i32,
    p: *const f64,
) {
    let hs = ld(p, P_HS);
    let wind_x = ld(p, P_WX);
    let wind_y = ld(p, P_WY);
    let wind_z = ld(p, P_WZ);
    let mut t = t0;
    while t < t1 {
        if lb(tri_cut, t) == 1 {
            t += 1;
            continue;
        }
        let a = li(ta, t);
        let b = li(tb, t);
        let e = li(tc, t);
        let nx: f64;
        let ny: f64;
        let nz: f64;
        let ux: f64;
        let uy: f64;
        let uz: f64;
        let share: f64;
        let mut q: i32 = -1;
        if e >= 0 && ((t - t0) & 1) == 0 && t + 1 < t1 && lb(tri_cut, t + 1) != 1 {
            q = li(tc, t + 1);
            let dax = ld(x, e) - ld(x, a);
            let day = ld(y, e) - ld(y, a);
            let daz = ld(z, e) - ld(z, a);
            let dbx = ld(x, q) - ld(x, b);
            let dby = ld(y, q) - ld(y, b);
            let dbz = ld(z, q) - ld(z, b);
            nx = 0.5 * (day * dbz - daz * dby);
            ny = 0.5 * (daz * dbx - dax * dbz);
            nz = 0.5 * (dax * dby - day * dbx);
            ux = wind_x - 0.25 * (ld(vx, a) + ld(vx, b) + ld(vx, e) + ld(vx, q));
            uy = wind_y - 0.25 * (ld(vy, a) + ld(vy, b) + ld(vy, e) + ld(vy, q));
            uz = wind_z - 0.25 * (ld(vz, a) + ld(vz, b) + ld(vz, e) + ld(vz, q));
            share = 0.25;
            t += 1;
        } else if e < 0 {
            let dx = ld(x, b) - ld(x, a);
            let dy = ld(y, b) - ld(y, a);
            nx = -dy * THREAD_WIDTH;
            ny = dx * THREAD_WIDTH;
            nz = 0.0;
            ux = wind_x - 0.5 * (ld(vx, a) + ld(vx, b));
            uy = wind_y - 0.5 * (ld(vy, a) + ld(vy, b));
            uz = 0.0;
            share = 0.5;
        } else {
            let abx = ld(x, b) - ld(x, a);
            let aby = ld(y, b) - ld(y, a);
            let abz = ld(z, b) - ld(z, a);
            let acx = ld(x, e) - ld(x, a);
            let acy = ld(y, e) - ld(y, a);
            let acz = ld(z, e) - ld(z, a);
            nx = 0.5 * (aby * acz - abz * acy);
            ny = 0.5 * (abz * acx - abx * acz);
            nz = 0.5 * (abx * acy - aby * acx);
            ux = wind_x - (ld(vx, a) + ld(vx, b) + ld(vx, e)) / 3.0;
            uy = wind_y - (ld(vy, a) + ld(vy, b) + ld(vy, e)) / 3.0;
            uz = wind_z - (ld(vz, a) + ld(vz, b) + ld(vz, e)) / 3.0;
            share = 1.0 / 3.0;
        }
        let a2 = nx * nx + ny * ny + nz * nz;
        if !(a2 > 1e-20) {
            t += 1;
            continue;
        }
        let un = ux * nx + uy * ny + uz * nz;
        let k = (0.5 * AIR * un * un.abs()) / a2;
        let mut fx = k * nx;
        let mut fy = k * ny;
        let mut fz = k * nz;
        let area = a2.sqrt();
        let s = un / a2;
        let tx = ux - s * nx;
        let ty = uy - s * ny;
        let tz = uz - s * nz;
        let tl = (tx * tx + ty * ty + tz * tz).sqrt();
        let ks = 0.5 * AIR * SKIN * area * tl;
        fx += ks * tx;
        fy += ks * ty;
        fz += ks * tz;
        fx *= share * hs;
        fy *= share * hs;
        fz *= share * hs;
        let mut c = 0;
        while c < 4 {
            let i = if c == 0 {
                a
            } else if c == 1 {
                b
            } else if c == 2 {
                e
            } else {
                q
            };
            c += 1;
            if i < 0 {
                continue;
            }
            let wi = ld(w, i);
            if wi == 0.0 || li(pin_of, i) >= 0 {
                continue;
            }
            st(afx, i, ld(afx, i) + wi * fx);
            st(afy, i, ld(afy, i) + wi * fy);
            st(afz, i, ld(afz, i) + wi * fz);
        }
        t += 1;
    }
}

/* ------------------------------ cloth3.ts ------------------------------ */

/// `Cloth3.hitHull`'s test of the candidate points `idx[start..count]` against one hull whose face planes (four numbers a
/// face) are at `planes`, for the points of one cloth: it stops at the first point that is inside the hull (writes
/// n.x, n.y, n.z and the depth into `out[1..5]`, `out[0] = 1`) or when the cloth changes, and returns the index after the
/// last point tested. `par` holds the body's offset (0..2) and the body's move this step (3..5).
#[no_mangle]
pub unsafe extern "C" fn hull_hits(
    idx: *const i32,
    start: i32,
    count: i32,
    x: *const f64,
    y: *const f64,
    z: *const f64,
    sx: *const f64,
    sy: *const f64,
    sz: *const f64,
    owner: *const i32,
    pin_of: *const i32,
    pin_body: *const i32,
    body: i32,
    planes: *const f64,
    nf: i32,
    par: *const f64,
    out: F,
) -> i32 {
    st(out, 0, 0.0);
    let own = li(owner, li(idx, start));
    let ob0 = ld(par, 0);
    let ob1 = ld(par, 1);
    let ob2 = ld(par, 2);
    let dp0 = ld(par, 3);
    let dp1 = ld(par, 4);
    let dp2 = ld(par, 5);
    let mut q = start;
    while q < count {
        let i = li(idx, q);
        if li(owner, i) != own {
            return q;
        }
        q += 1;
        let pq = li(pin_of, i);
        if pq >= 0 && li(pin_body, pq) == body {
            continue;
        }
        let x = ld(x, i) - ob0;
        let y = ld(y, i) - ob1;
        let z = ld(z, i) - ob2;
        let mut sep = f64::NEG_INFINITY;
        let mut best: i32 = 0;
        let mut inside = true;
        let mut f = 0;
        while f < nf {
            let o = f * 4;
            let s = ld(planes, o) * x + ld(planes, o + 1) * y + ld(planes, o + 2) * z - ld(planes, o + 3);
            if s >= 0.0 {
                inside = false;
                break;
            }
            if s > sep {
                sep = s;
                best = f;
            }
            f += 1;
        }
        if !inside {
            continue;
        }
        let ax = ld(sx, i) + dp0;
        let ay = ld(sy, i) + dp1;
        let az = ld(sz, i) + dp2;
        let ux = x - ax;
        let uy = y - ay;
        let uz = z - az;
        let mut t_in = f64::NEG_INFINITY;
        let mut in_face: i32 = -1;
        f = 0;
        while f < nf {
            let o = f * 4;
            let nx = ld(planes, o);
            let ny = ld(planes, o + 1);
            let nz = ld(planes, o + 2);
            let s0 = nx * ax + ny * ay + nz * az - ld(planes, o + 3);
            let du = nx * ux + ny * uy + nz * uz;
            if du < 0.0 {
                let t = -s0 / du;
                if t > t_in {
                    t_in = t;
                    in_face = f;
                }
            }
            f += 1;
        }
        let face = (if in_face >= 0 && t_in >= -1e-9 { in_face } else { best }) * 4;
        let nx = ld(planes, face);
        let ny = ld(planes, face + 1);
        let nz = ld(planes, face + 2);
        let depth = -(nx * x + ny * y + nz * z - ld(planes, face + 3));
        if !(depth > 0.0) {
            continue;
        }
        st(out, 0, 1.0);
        st(out, 1, nx);
        st(out, 2, ny);
        st(out, 3, nz);
        st(out, 4, depth);
        return q;
    }
    count
}

/* ------------------------------ grid3.ts ------------------------------ */

/// The 13 cells of one half of the 26 around a cell (`grid3.ts`).
const HX: [i32; 13] = [1, -1, 0, 1, -1, 0, 1, -1, 0, 1, -1, 0, 1];
const HY: [i32; 13] = [0, 1, 1, 1, -1, -1, -1, 0, 0, 0, 1, 1, 1];
const HZ: [i32; 13] = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1];

/// The grid's numbers, kept in two small arrays the caller owns: `mf` holds the table's origin and size as numbers
/// (ox, oy, oz, nx, ny, nz) and `mi` the dense flag, the hash mask, the number of slots and the number of pairs.
const MF_OX: i32 = 0;
const MF_OY: i32 = 1;
const MF_OZ: i32 = 2;
const MF_NX: i32 = 3;
const MF_NY: i32 = 4;
const MF_NZ: i32 = 5;
/// The numbers a call takes (see `P_HS`): 1 / cell width, the reach of a pair, and the box of `grid_in_box`.
const MF_INV: i32 = 8;
const MF_REACH: i32 = 9;
const MF_BOX: i32 = 10;
const MI_DENSE: i32 = 0;
const MI_MASK: i32 = 1;
const MI_SLOTS: i32 = 2;
const MI_PAIRS: i32 = 3;

#[inline(always)]
fn hash(cx: i32, cy: i32, cz: i32, mask: i32) -> i32 {
    (cx.wrapping_mul(0x5bd1e995u32 as i32) ^ cy.wrapping_mul(0x27d4eb2fu32 as i32) ^ cz.wrapping_mul(0x165667b1u32 as i32)) & mask
}

/// `NeighbourGrid3.slotOf` for cell numbers given as numbers (as `inBox` has them) or as stored integers.
#[inline(always)]
unsafe fn slot_of(cx: f64, cy: f64, cz: f64, mf: *const f64, mi: *const i32) -> i32 {
    if li(mi, MI_DENSE) == 0 {
        return hash(to_i32(cx), to_i32(cy), to_i32(cz), li(mi, MI_MASK));
    }
    let nx = ld(mf, MF_NX);
    let ny = ld(mf, MF_NY);
    let nz = ld(mf, MF_NZ);
    let a = cx - ld(mf, MF_OX);
    let b = cy - ld(mf, MF_OY);
    let c = cz - ld(mf, MF_OZ);
    if a < 0.0 || a >= nx || b < 0.0 || b >= ny || c < 0.0 || c >= nz {
        return -1;
    }
    ((c * ny + b) * nx + a) as i32
}

/// `NeighbourGrid3.build`: sorts the `n` drops at x, y and z into their cells by a counting sort.
#[no_mangle]
pub unsafe extern "C" fn grid_build(
    x: *const f64,
    y: *const f64,
    z: *const f64,
    n: i32,
    cx: I,
    cy: I,
    cz: I,
    slot: I,
    start: I,
    count: I,
    sorted: I,
    mf: F,
    mi: I,
) {
    let inv = ld(mf, MF_INV);
    let mut x0: f64 = 0.0;
    let mut x1: f64 = -1.0;
    let mut y0: f64 = 0.0;
    let mut y1: f64 = -1.0;
    let mut z0: f64 = 0.0;
    let mut z1: f64 = -1.0;
    let mut i = 0;
    while i < n {
        let fx = (ld(x, i) * inv).floor();
        let fy = (ld(y, i) * inv).floor();
        let fz = (ld(z, i) * inv).floor();
        si(cx, i, to_i32(fx));
        si(cy, i, to_i32(fy));
        si(cz, i, to_i32(fz));
        if i == 0 {
            x0 = fx;
            x1 = fx;
            y0 = fy;
            y1 = fy;
            z0 = fz;
            z1 = fz;
            i += 1;
            continue;
        }
        if fx < x0 {
            x0 = fx;
        } else if fx > x1 {
            x1 = fx;
        }
        if fy < y0 {
            y0 = fy;
        } else if fy > y1 {
            y1 = fy;
        }
        if fz < z0 {
            z0 = fz;
        } else if fz > z1 {
            z1 = fz;
        }
        i += 1;
    }
    let nx = x1 - x0 + 3.0;
    let ny = y1 - y0 + 3.0;
    let nz = z1 - z0 + 3.0;
    let nf = n as f64;
    let dense = n > 0 && nx * ny * nz <= js_max(32768.0, 16.0 * nf);
    let slots: i32 = if dense {
        si(mi, MI_DENSE, 1);
        st(mf, MF_OX, x0 - 1.0);
        st(mf, MF_OY, y0 - 1.0);
        st(mf, MF_OZ, z0 - 1.0);
        st(mf, MF_NX, nx);
        st(mf, MF_NY, ny);
        st(mf, MF_NZ, nz);
        (nx * ny * nz) as i32
    } else {
        si(mi, MI_DENSE, 0);
        let mut t: i32 = 16;
        while t < 2 * n {
            t *= 2;
        }
        si(mi, MI_MASK, t - 1);
        t
    };
    si(mi, MI_SLOTS, slots);
    let t = slots;
    let mut s = 0;
    while s < t {
        si(count, s, 0);
        s += 1;
    }
    i = 0;
    while i < n {
        let sl = slot_of(li(cx, i) as f64, li(cy, i) as f64, li(cz, i) as f64, mf, mi);
        si(slot, i, sl);
        if sl >= 0 {
            si(count, sl, li(count, sl) + 1);
        }
        i += 1;
    }
    let mut acc = 0;
    s = 0;
    while s < t {
        si(start, s, acc);
        acc += li(count, s);
        s += 1;
    }
    si(start, t, acc);
    s = 0;
    while s < t {
        si(count, s, li(start, s));
        s += 1;
    }
    i = 0;
    while i < n {
        let sl = li(slot, i);
        if sl >= 0 {
            let k = li(count, sl);
            si(sorted, k, i);
            si(count, sl, k + 1);
        }
        i += 1;
    }
}

/// `NeighbourGrid3.findPairs`: lists the pairs of drops closer than `reach`, each once, into `pi` and `pj`; returns how many
/// (also in `mi[MI_PAIRS]`). `sx`, `sy` and `sz` are scratch for the drops' places in table order, `group` for a hashed cell.
#[no_mangle]
pub unsafe extern "C" fn grid_pairs(
    x: *const f64,
    y: *const f64,
    z: *const f64,
    n: i32,
    cxs: *const i32,
    cys: *const i32,
    czs: *const i32,
    start: *const i32,
    sorted: *const i32,
    sx: F,
    sy: F,
    sz: F,
    nbr_n: I,
    pi: I,
    pj: I,
    group: I,
    mf: *const f64,
    mi: I,
) -> i32 {
    let mut k = 0;
    while k < n {
        si(nbr_n, k, 0);
        k += 1;
    }
    k = 0;
    while k < n {
        let i = li(sorted, k);
        st(sx, k, ld(x, i));
        st(sy, k, ld(y, i));
        st(sz, k, ld(z, i));
        k += 1;
    }
    let reach = ld(mf, MF_REACH);
    let r2 = reach * reach;
    let np = if li(mi, MI_DENSE) != 0 {
        pairs_dense(r2, start, sorted, sx, sy, sz, nbr_n, pi, pj, mf, mi)
    } else {
        pairs_hashed(r2, start, sorted, sx, sy, sz, cxs, cys, czs, nbr_n, pi, pj, group, mi)
    };
    si(mi, MI_PAIRS, np);
    np
}

unsafe fn pairs_dense(
    r2: f64,
    start: *const i32,
    sorted: *const i32,
    sx: *const f64,
    sy: *const f64,
    sz: *const f64,
    nbr_n: I,
    pi: I,
    pj: I,
    mf: *const f64,
    mi: *const i32,
) -> i32 {
    let m = MAX_NEIGHBOURS3;
    let nx = ld(mf, MF_NX) as i32;
    let nxy = nx * (ld(mf, MF_NY) as i32);
    let mut off = [0i32; 13];
    let mut c = 0;
    while c < 13 {
        off[c] = HX[c] + HY[c] * nx + HZ[c] * nxy;
        c += 1;
    }
    let t = li(mi, MI_SLOTS);
    let mut np = 0;
    let mut s = 0;
    while s < t {
        let a = li(start, s);
        let b = li(start, s + 1);
        if a == b {
            s += 1;
            continue;
        }
        let mut u = a;
        while u < b {
            let xi = ld(sx, u);
            let yi = ld(sy, u);
            let zi = ld(sz, u);
            let i = li(sorted, u);
            let mut v = u + 1;
            while v < b {
                let ex = ld(sx, v) - xi;
                let ey = ld(sy, v) - yi;
                let ez = ld(sz, v) - zi;
                if ex * ex + ey * ey + ez * ez >= r2 {
                    v += 1;
                    continue;
                }
                let j = li(sorted, v);
                let mi_ = li(nbr_n, i);
                let mj = li(nbr_n, j);
                if mi_ >= m || mj >= m {
                    v += 1;
                    continue;
                }
                si(nbr_n, i, mi_ + 1);
                si(nbr_n, j, mj + 1);
                si(pi, np, i);
                si(pj, np, j);
                np += 1;
                v += 1;
            }
            u += 1;
        }
        c = 0;
        while c < 13 {
            let ns = s + off[c];
            c += 1;
            let na = li(start, ns);
            let nb = li(start, ns + 1);
            if na == nb {
                continue;
            }
            let mut q = na;
            while q < nb {
                let xj = ld(sx, q);
                let yj = ld(sy, q);
                let zj = ld(sz, q);
                let j = li(sorted, q);
                let mut u = a;
                while u < b {
                    let ex = xj - ld(sx, u);
                    let ey = yj - ld(sy, u);
                    let ez = zj - ld(sz, u);
                    if ex * ex + ey * ey + ez * ez >= r2 {
                        u += 1;
                        continue;
                    }
                    let i = li(sorted, u);
                    let mi_ = li(nbr_n, i);
                    let mj = li(nbr_n, j);
                    if mi_ >= m || mj >= m {
                        u += 1;
                        continue;
                    }
                    si(nbr_n, i, mi_ + 1);
                    si(nbr_n, j, mj + 1);
                    si(pi, np, i);
                    si(pj, np, j);
                    np += 1;
                    u += 1;
                }
                q += 1;
            }
        }
        s += 1;
    }
    np
}

#[inline(always)]
unsafe fn add_pair(nbr_n: I, pi: I, pj: I, i: i32, j: i32, np: i32) -> i32 {
    let mi_ = li(nbr_n, i);
    let mj = li(nbr_n, j);
    if mi_ >= MAX_NEIGHBOURS3 || mj >= MAX_NEIGHBOURS3 {
        return np;
    }
    si(nbr_n, i, mi_ + 1);
    si(nbr_n, j, mj + 1);
    si(pi, np, i);
    si(pj, np, j);
    np + 1
}

unsafe fn pairs_hashed(
    r2: f64,
    start: *const i32,
    sorted: *const i32,
    sx: *const f64,
    sy: *const f64,
    sz: *const f64,
    cxs: *const i32,
    cys: *const i32,
    czs: *const i32,
    nbr_n: I,
    pi: I,
    pj: I,
    group: I,
    mi: *const i32,
) -> i32 {
    let t = li(mi, MI_SLOTS);
    let mask = li(mi, MI_MASK);
    let mut np = 0;
    let mut s = 0;
    while s < t {
        let a = li(start, s);
        let b = li(start, s + 1);
        let mut k = a;
        while k < b {
            let first = li(sorted, k);
            let cx = li(cxs, first);
            let cy = li(cys, first);
            let cz = li(czs, first);
            let mut seen = false;
            let mut q = a;
            while q < k && !seen {
                let o = li(sorted, q);
                if li(cxs, o) == cx && li(cys, o) == cy && li(czs, o) == cz {
                    seen = true;
                }
                q += 1;
            }
            if seen {
                k += 1;
                continue;
            }
            let mut g = 0;
            q = k;
            while q < b {
                let o = li(sorted, q);
                if li(cxs, o) == cx && li(cys, o) == cy && li(czs, o) == cz {
                    si(group, g, q);
                    g += 1;
                }
                q += 1;
            }
            let mut u = 0;
            while u < g {
                let pu = li(group, u);
                let mut v = u + 1;
                while v < g {
                    let pv = li(group, v);
                    let ex = ld(sx, pv) - ld(sx, pu);
                    let ey = ld(sy, pv) - ld(sy, pu);
                    let ez = ld(sz, pv) - ld(sz, pu);
                    if ex * ex + ey * ey + ez * ez < r2 {
                        np = add_pair(nbr_n, pi, pj, li(sorted, pu), li(sorted, pv), np);
                    }
                    v += 1;
                }
                u += 1;
            }
            let mut c = 0;
            while c < 13 {
                let ncx = cx.wrapping_add(HX[c]);
                let ncy = cy.wrapping_add(HY[c]);
                let ncz = cz.wrapping_add(HZ[c]);
                c += 1;
                let ns = hash(ncx, ncy, ncz, mask);
                let nb = li(start, ns + 1);
                let mut q = li(start, ns);
                while q < nb {
                    let j = li(sorted, q);
                    if li(cxs, j) != ncx || li(cys, j) != ncy || li(czs, j) != ncz {
                        q += 1;
                        continue;
                    }
                    let mut u = 0;
                    while u < g {
                        let pu = li(group, u);
                        let ex = ld(sx, q) - ld(sx, pu);
                        let ey = ld(sy, q) - ld(sy, pu);
                        let ez = ld(sz, q) - ld(sz, pu);
                        if ex * ex + ey * ey + ez * ez < r2 {
                            np = add_pair(nbr_n, pi, pj, li(sorted, pu), j, np);
                        }
                        u += 1;
                    }
                    q += 1;
                }
            }
            k += 1;
        }
        s += 1;
    }
    np
}

/// `NeighbourGrid3.inBox`: the drops whose cell overlaps the box, each once, into `found`; returns how many.
#[no_mangle]
pub unsafe extern "C" fn grid_in_box(
    n: i32,
    cxs: *const i32,
    cys: *const i32,
    czs: *const i32,
    start: *const i32,
    sorted: *const i32,
    found: I,
    mf: *const f64,
    mi: *const i32,
) -> i32 {
    let dense = li(mi, MI_DENSE) != 0;
    let inv = ld(mf, MF_INV);
    let bx0 = ld(mf, MF_BOX);
    let by0 = ld(mf, MF_BOX + 1);
    let bz0 = ld(mf, MF_BOX + 2);
    let bx1 = ld(mf, MF_BOX + 3);
    let by1 = ld(mf, MF_BOX + 4);
    let bz1 = ld(mf, MF_BOX + 5);
    let mut cx0 = (bx0 * inv).floor();
    let mut cy0 = (by0 * inv).floor();
    let mut cz0 = (bz0 * inv).floor();
    let mut cx1 = (bx1 * inv).floor();
    let mut cy1 = (by1 * inv).floor();
    let mut cz1 = (bz1 * inv).floor();
    if dense {
        let ox = ld(mf, MF_OX);
        let oy = ld(mf, MF_OY);
        let oz = ld(mf, MF_OZ);
        cx0 = js_max(cx0, ox);
        cy0 = js_max(cy0, oy);
        cz0 = js_max(cz0, oz);
        cx1 = js_min(cx1, ox + ld(mf, MF_NX) - 1.0);
        cy1 = js_min(cy1, oy + ld(mf, MF_NY) - 1.0);
        cz1 = js_min(cz1, oz + ld(mf, MF_NZ) - 1.0);
    }
    if !(cx1 >= cx0 && cy1 >= cy0 && cz1 >= cz0) {
        return 0;
    }
    let cells = (cx1 - cx0 + 1.0) * (cy1 - cy0 + 1.0) * (cz1 - cz0 + 1.0);
    let mut m = 0;
    if !(cells <= n as f64) {
        let mut i = 0;
        while i < n {
            let cx = li(cxs, i) as f64;
            let cy = li(cys, i) as f64;
            let cz = li(czs, i) as f64;
            if cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1 && cz >= cz0 && cz <= cz1 {
                si(found, m, i);
                m += 1;
            }
            i += 1;
        }
        return m;
    }
    let mut cz = cz0;
    while cz <= cz1 {
        let mut cy = cy0;
        while cy <= cy1 {
            let mut cx = cx0;
            while cx <= cx1 {
                let s = slot_of(cx, cy, cz, mf, mi);
                if s >= 0 {
                    let end = li(start, s + 1);
                    let mut k = li(start, s);
                    while k < end {
                        let j = li(sorted, k);
                        if dense || ((li(cxs, j) as f64) == cx && (li(cys, j) as f64) == cy && (li(czs, j) as f64) == cz) {
                            si(found, m, j);
                            m += 1;
                        }
                        k += 1;
                    }
                }
                cx += 1.0;
            }
            cy += 1.0;
        }
        cz += 1.0;
    }
    m
}

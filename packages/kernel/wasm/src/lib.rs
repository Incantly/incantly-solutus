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

/* ------------------------------ smoke3.ts and fire3.ts: the grid in space ------------------------------ */

// The grid's loops (design 9.8, 11.6). Each is one call on the whole grid. A call takes two byte offsets: `gi`, a block of
// integers (the grid's size, flags and where each array is) and `gf`, a block of numbers (the cell sizes, the step, the
// wind, the fire's settings). The caller writes both blocks, so a call has integer arguments only and makes no garbage.
// The grid's values are `Float32Array`s: a value is read as an `f32`, widened to `f64`, worked out in `f64` exactly as
// the TypeScript loop does, and stored with `as f32` (round to nearest, ties to even, as a `Float32Array` store does).

const G_N: i32 = 0;
const G_U: i32 = 2;
const G_V: i32 = 3;
const G_W: i32 = 4;
const G_U2: i32 = 5;
const G_V2: i32 = 6;
const G_W2: i32 = 7;
const G_S: i32 = 8;
const G_S2: i32 = 9;
const G_P: i32 = 10;
const G_DIV: i32 = 11;
const G_WL: i32 = 12;
const G_WR: i32 = 13;
const G_WD: i32 = 14;
const G_WU: i32 = 15;
const G_WB: i32 = 16;
const G_WF: i32 = 17;
const G_INV: i32 = 18;
const G_FIX: i32 = 19;
const G_FIXED: i32 = 20;
const G_ROWLO: i32 = 21;
const G_ROWHI: i32 = 22;
const G_OWN: i32 = 23;
const G_SRC: i32 = 24;
const G_T: i32 = 25;
const G_F: i32 = 26;
const G_T2: i32 = 27;
const G_F2: i32 = 28;
const G_WET: i32 = 29;
const G_CA: i32 = 30;
const G_CB: i32 = 31;
const G_CC: i32 = 32;
const G_OA: i32 = 33;
const G_OB: i32 = 34;
const G_OC: i32 = 35;
const G_OM: i32 = 36;
const G_SB: i32 = 37;
const G_STILL: i32 = 38;
const G_DROPS: i32 = 39;
const G_NDROPS: i32 = 41;
const G_SRCON: i32 = 42;
const G_HOLD: i32 = 43;

const F_X0: i32 = 0;
const F_Y0: i32 = 1;
const F_Z0: i32 = 2;
const F_DX: i32 = 3;
const F_DY: i32 = 4;
const F_DZ: i32 = 5;
const F_H: i32 = 6;
const F_WINDX: i32 = 7;
const F_WINDY: i32 = 8;
const F_WINDZ: i32 = 9;
const F_LIFT: i32 = 10;
const F_SWIRL: i32 = 11;
const F_BURN: i32 = 12;
const F_FHEAT: i32 = 13;
const F_FSMOKE: i32 = 14;
const F_FUEL: i32 = 15;
const F_LAST: i32 = 16;
const F_OUT: i32 = 17;

/// The pressure solve's over-relaxation, the passes a step, and what the smoke step may scale the mass by (`smoke3.ts`).
const OMEGA: f64 = 1.8;
const KEEP: f64 = 1.0 - OMEGA;
const PASSES: i32 = 20;
const SCALE_CAP: f64 = 0.005;
/// The fire's numbers (`fire2.ts`).
const IGNITE: f64 = 150.0;
const RAMP: f64 = 250.0;
const LIFT_PER_DEGREE: f64 = 0.01;
const SINK_PER_SMOKE: f64 = 0.5;
const COOLING: f64 = 3.0;
const DROP_COOLS: f64 = 50.0;
const FLAME_AT: f64 = 500.0;
/// A speed beyond this is a blown-up grid (`smoke3.ts`).
const BLOW_UP: f64 = 1e6;

#[inline(always)]
unsafe fn lf(p: *const f32, i: i32) -> f64 {
    *p.offset(i as isize) as f64
}
#[inline(always)]
unsafe fn sf(p: *mut f32, i: i32, v: f64) {
    *p.offset(i as isize) = v as f32;
}
/// The array whose byte offset is in slot `slot` of the integer block.
#[inline(always)]
unsafe fn at(gi: *const i32, slot: i32) -> usize {
    li(gi, slot) as usize
}
#[inline(always)]
unsafe fn zero_f32(p: *mut f32, from: i32, to: i32) {
    let mut c = from;
    while c < to {
        *p.offset(c as isize) = 0.0;
        c += 1;
    }
}

#[cfg(target_feature = "simd128")]
use core::arch::wasm32::*;

/// Two neighbouring `f32` at `p + i`, widened to `f64x2`.
#[cfg(target_feature = "simd128")]
#[inline(always)]
unsafe fn ld2(p: *const f32, i: i32) -> v128 {
    f64x2_promote_low_f32x4(v128_load64_zero(p.offset(i as isize) as *const u64))
}

/// Two neighbouring `f32` stored at `p + i`, each rounded as an `f32` store rounds.
#[cfg(target_feature = "simd128")]
#[inline(always)]
unsafe fn st2(p: *mut f32, i: i32, v: v128) {
    v128_store64_lane::<0>(f32x4_demote_f64x2_zero(v), p.offset(i as isize) as *mut u64);
}

/// `tri` for two lanes, the corners of lane A at `qa` and of lane B at `qb`: each lane does the scalar operations of its face.
#[cfg(target_feature = "simd128")]
#[inline(always)]
unsafe fn tri2(a: *const f32, qa: i32, qb: i32, s1: i32, p: i32, tx: v128, ty: v128, tz: v128) -> v128 {
    let one = f64x2_splat(1.0);
    let corner = |o: i32| -> v128 {
        let x = ld2(a, qa + o);
        let y = ld2(a, qb + o);
        let lo = i64x2_shuffle::<0, 2>(x, y);
        let hi = i64x2_shuffle::<1, 3>(x, y);
        f64x2_add(lo, f64x2_mul(f64x2_sub(hi, lo), tx))
    };
    let x00 = corner(0);
    let x10 = corner(s1);
    let x01 = corner(p);
    let x11 = corner(p + s1);
    f64x2_add(
        f64x2_mul(f64x2_add(x00, f64x2_mul(f64x2_sub(x10, x00), ty)), f64x2_sub(one, tz)),
        f64x2_mul(f64x2_add(x01, f64x2_mul(f64x2_sub(x11, x01), ty)), tz),
    )
}

/// The back-trace and blend of two neighbouring faces (`FACE`: 0, 1 or 2, the coordinate that is the face's own: it is kept
/// in `[0, n]` and not clamped; the other two are kept in `[-½, n - ½]` and clamped to `[0, n - 1]`). Returns false, writing
/// nothing, when a lane is outside the box: the caller does those faces one by one.
#[cfg(target_feature = "simd128")]
#[inline(always)]
unsafe fn face_pair<const FACE: usize>(
    src: *const f32,
    dst: *mut f32,
    di: i32,
    fx: v128,
    fy: v128,
    fz: v128,
    n: i32,
    s1: i32,
    p: i32,
) -> bool {
    let nf = n as f64;
    let zero = f64x2_splat(0.0);
    let lo_edge = f64x2_splat(-0.5);
    let limv = f64x2_splat(nf - 0.5);
    let nfv = f64x2_splat(nf);
    let nm1v = f64x2_splat((n - 1) as f64);
    let inside = |f: v128, own: bool| -> v128 {
        if own {
            v128_and(f64x2_ge(f, zero), f64x2_le(f, nfv))
        } else {
            v128_and(f64x2_ge(f, lo_edge), f64x2_le(f, limv))
        }
    };
    let ok = v128_and(v128_and(inside(fx, FACE == 0), inside(fy, FACE == 1)), inside(fz, FACE == 2));
    if !i64x2_all_true(ok) {
        return false;
    }
    let clamp = |f: v128, own: bool| -> v128 {
        if own {
            f
        } else {
            let g = v128_bitselect(zero, f, f64x2_lt(f, zero));
            v128_bitselect(nm1v, g, f64x2_gt(g, nm1v))
        }
    };
    let fx = clamp(fx, FACE == 0);
    let fy = clamp(fy, FACE == 1);
    let fz = clamp(fz, FACE == 2);
    let a = i32x4_min(i32x4_trunc_sat_f64x2_zero(fx), i32x4_splat(if FACE == 0 { n - 1 } else { n - 2 }));
    let b = i32x4_min(i32x4_trunc_sat_f64x2_zero(fy), i32x4_splat(if FACE == 1 { n - 1 } else { n - 2 }));
    let c = i32x4_min(i32x4_trunc_sat_f64x2_zero(fz), i32x4_splat(if FACE == 2 { n - 1 } else { n - 2 }));
    let tx = f64x2_sub(fx, f64x2_convert_low_i32x4(a));
    let ty = f64x2_sub(fy, f64x2_convert_low_i32x4(b));
    let tz = f64x2_sub(fz, f64x2_convert_low_i32x4(c));
    let qa = i32x4_extract_lane::<0>(c) * p + i32x4_extract_lane::<0>(b) * s1 + i32x4_extract_lane::<0>(a);
    let qb = i32x4_extract_lane::<1>(c) * p + i32x4_extract_lane::<1>(b) * s1 + i32x4_extract_lane::<1>(a);
    st2(dst, di, tri2(src, qa, qb, s1, p, tx, ty, tz));
    true
}

/// The trilinear blend of the four corners `q`, `q + s1`, `q + p` and `q + p + s1`, each with its x neighbour at +1 (the
/// same operations as the loops of `advectFlow`).
#[inline(always)]
unsafe fn tri(a: *const f32, q: i32, s1: i32, p: i32, tx: f64, ty: f64, tz: f64) -> f64 {
    let p0 = lf(a, q);
    let p1 = lf(a, q + s1);
    let p2 = lf(a, q + p);
    let p3 = lf(a, q + p + s1);
    let x00 = p0 + (lf(a, q + 1) - p0) * tx;
    let x10 = p1 + (lf(a, q + s1 + 1) - p1) * tx;
    let x01 = p2 + (lf(a, q + p + 1) - p2) * tx;
    let x11 = p3 + (lf(a, q + p + s1 + 1) - p3) * tx;
    (x00 + (x10 - x00) * ty) * (1.0 - tz) + (x01 + (x11 - x01) * ty) * tz
}

/// `Smoke3.advectFlow`: the three speeds carried back along the flow, into the second set of arrays (the caller swaps).
#[no_mangle]
pub unsafe extern "C" fn grid3_advect_flow(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let w1 = n + 1;
    let nn = n * n;
    let u = at(gi, G_U) as *const f32;
    let v = at(gi, G_V) as *const f32;
    let w = at(gi, G_W) as *const f32;
    let u2 = at(gi, G_U2) as *mut f32;
    let v2 = at(gi, G_V2) as *mut f32;
    let w2 = at(gi, G_W2) as *mut f32;
    let h = ld(gf, F_H);
    let kx = h / ld(gf, F_DX);
    let ky = h / ld(gf, F_DY);
    let kz = h / ld(gf, F_DZ);
    let wind_x = ld(gf, F_WINDX);
    let wind_y = ld(gf, F_WINDY);
    let wind_z = ld(gf, F_WINDZ);
    let nf = n as f64;
    let nm1 = (n - 1) as f64;
    let lim = nf - 0.5;
    #[cfg(target_feature = "simd128")]
    let (kxv, kyv, kzv, quarter) = (f64x2_splat(kx), f64x2_splat(ky), f64x2_splat(kz), f64x2_splat(0.25));
    // x speeds
    let mut k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let vb = (k * w1 + j) * n;
            let wb = (k * n + j) * n;
            let ub = (k * n + j) * w1;
            let mut i = 0;
            while i <= n {
                // two faces at once where both have a face on each side across the row
                #[cfg(target_feature = "simd128")]
                {
                    if i >= 1 && i + 1 < n {
                        let vv = f64x2_mul(
                            quarter,
                            f64x2_add(
                                f64x2_add(f64x2_add(ld2(v, vb + i - 1), ld2(v, vb + i)), ld2(v, vb + n + i - 1)),
                                ld2(v, vb + n + i),
                            ),
                        );
                        let ww = f64x2_mul(
                            quarter,
                            f64x2_add(
                                f64x2_add(f64x2_add(ld2(w, wb + i - 1), ld2(w, wb + i)), ld2(w, wb + nn + i - 1)),
                                ld2(w, wb + nn + i),
                            ),
                        );
                        let fx = f64x2_sub(f64x2(i as f64, (i + 1) as f64), f64x2_mul(kxv, ld2(u, ub + i)));
                        let fy = f64x2_sub(f64x2_splat(j as f64), f64x2_mul(kyv, vv));
                        let fz = f64x2_sub(f64x2_splat(k as f64), f64x2_mul(kzv, ww));
                        if face_pair::<0>(u, u2, ub + i, fx, fy, fz, n, w1, w1 * n) {
                            i += 2;
                            continue;
                        }
                    }
                }
                let il = if i > 0 { i - 1 } else { 0 };
                let ir = if i < n { i } else { n - 1 };
                let vv = 0.25 * (lf(v, vb + il) + lf(v, vb + ir) + lf(v, vb + n + il) + lf(v, vb + n + ir));
                let ww = 0.25 * (lf(w, wb + il) + lf(w, wb + ir) + lf(w, wb + nn + il) + lf(w, wb + nn + ir));
                let fx = i as f64 - kx * lf(u, ub + i);
                let mut fy = j as f64 - ky * vv;
                let mut fz = k as f64 - kz * ww;
                if !(fx >= 0.0 && fx <= nf && fy >= -0.5 && fy <= lim && fz >= -0.5 && fz <= lim) {
                    sf(u2, ub + i, wind_x);
                    i += 1;
                    continue;
                }
                if fy < 0.0 {
                    fy = 0.0;
                } else if fy > nm1 {
                    fy = nm1;
                }
                if fz < 0.0 {
                    fz = 0.0;
                } else if fz > nm1 {
                    fz = nm1;
                }
                let mut a = fx as i32;
                let mut b = fy as i32;
                let mut c = fz as i32;
                if a > n - 1 {
                    a = n - 1;
                }
                if b > n - 2 {
                    b = n - 2;
                }
                if c > n - 2 {
                    c = n - 2;
                }
                let tx = fx - a as f64;
                let ty = fy - b as f64;
                let tz = fz - c as f64;
                let q = c * w1 * n + b * w1 + a;
                sf(u2, ub + i, tri(u, q, w1, w1 * n, tx, ty, tz));
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    // y speeds
    k = 0;
    while k < n {
        let mut j = 0;
        while j <= n {
            let jb = if j > 0 { j - 1 } else { 0 };
            let jt = if j < n { j } else { n - 1 };
            let vb = (k * w1 + j) * n;
            let mut i = 0;
            while i < n {
                #[cfg(target_feature = "simd128")]
                {
                    if i + 1 < n {
                        let uu = f64x2_mul(
                            quarter,
                            f64x2_add(
                                f64x2_add(
                                    f64x2_add(ld2(u, (k * n + jb) * w1 + i), ld2(u, (k * n + jb) * w1 + i + 1)),
                                    ld2(u, (k * n + jt) * w1 + i),
                                ),
                                ld2(u, (k * n + jt) * w1 + i + 1),
                            ),
                        );
                        let ww = f64x2_mul(
                            quarter,
                            f64x2_add(
                                f64x2_add(
                                    f64x2_add(ld2(w, (k * n + jb) * n + i), ld2(w, (k * n + jt) * n + i)),
                                    ld2(w, ((k + 1) * n + jb) * n + i),
                                ),
                                ld2(w, ((k + 1) * n + jt) * n + i),
                            ),
                        );
                        let fx = f64x2_sub(f64x2(i as f64, (i + 1) as f64), f64x2_mul(kxv, uu));
                        let fy = f64x2_sub(f64x2_splat(j as f64), f64x2_mul(kyv, ld2(v, vb + i)));
                        let fz = f64x2_sub(f64x2_splat(k as f64), f64x2_mul(kzv, ww));
                        if face_pair::<1>(v, v2, vb + i, fx, fy, fz, n, n, n * w1) {
                            i += 2;
                            continue;
                        }
                    }
                }
                let uu = 0.25
                    * (lf(u, (k * n + jb) * w1 + i)
                        + lf(u, (k * n + jb) * w1 + i + 1)
                        + lf(u, (k * n + jt) * w1 + i)
                        + lf(u, (k * n + jt) * w1 + i + 1));
                let ww = 0.25
                    * (lf(w, (k * n + jb) * n + i)
                        + lf(w, (k * n + jt) * n + i)
                        + lf(w, ((k + 1) * n + jb) * n + i)
                        + lf(w, ((k + 1) * n + jt) * n + i));
                let mut fx = i as f64 - kx * uu;
                let fy = j as f64 - ky * lf(v, vb + i);
                let mut fz = k as f64 - kz * ww;
                if !(fx >= -0.5 && fx <= lim && fy >= 0.0 && fy <= nf && fz >= -0.5 && fz <= lim) {
                    sf(v2, vb + i, wind_y);
                    i += 1;
                    continue;
                }
                if fx < 0.0 {
                    fx = 0.0;
                } else if fx > nm1 {
                    fx = nm1;
                }
                if fz < 0.0 {
                    fz = 0.0;
                } else if fz > nm1 {
                    fz = nm1;
                }
                let mut a = fx as i32;
                let mut b = fy as i32;
                let mut c = fz as i32;
                if a > n - 2 {
                    a = n - 2;
                }
                if b > n - 1 {
                    b = n - 1;
                }
                if c > n - 2 {
                    c = n - 2;
                }
                let tx = fx - a as f64;
                let ty = fy - b as f64;
                let tz = fz - c as f64;
                let p = n * w1;
                let q = c * p + b * n + a;
                sf(v2, vb + i, tri(v, q, n, p, tx, ty, tz));
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    // z speeds
    k = 0;
    while k <= n {
        let kb = if k > 0 { k - 1 } else { 0 };
        let kt = if k < n { k } else { n - 1 };
        let mut j = 0;
        while j < n {
            let wb = (k * n + j) * n;
            let mut i = 0;
            while i < n {
                #[cfg(target_feature = "simd128")]
                {
                    if i + 1 < n {
                        let uu = f64x2_mul(
                            quarter,
                            f64x2_add(
                                f64x2_add(
                                    f64x2_add(ld2(u, (kb * n + j) * w1 + i), ld2(u, (kb * n + j) * w1 + i + 1)),
                                    ld2(u, (kt * n + j) * w1 + i),
                                ),
                                ld2(u, (kt * n + j) * w1 + i + 1),
                            ),
                        );
                        let vv = f64x2_mul(
                            quarter,
                            f64x2_add(
                                f64x2_add(
                                    f64x2_add(ld2(v, (kb * w1 + j) * n + i), ld2(v, (kb * w1 + j + 1) * n + i)),
                                    ld2(v, (kt * w1 + j) * n + i),
                                ),
                                ld2(v, (kt * w1 + j + 1) * n + i),
                            ),
                        );
                        let fx = f64x2_sub(f64x2(i as f64, (i + 1) as f64), f64x2_mul(kxv, uu));
                        let fy = f64x2_sub(f64x2_splat(j as f64), f64x2_mul(kyv, vv));
                        let fz = f64x2_sub(f64x2_splat(k as f64), f64x2_mul(kzv, ld2(w, wb + i)));
                        if face_pair::<2>(w, w2, wb + i, fx, fy, fz, n, n, nn) {
                            i += 2;
                            continue;
                        }
                    }
                }
                let uu = 0.25
                    * (lf(u, (kb * n + j) * w1 + i)
                        + lf(u, (kb * n + j) * w1 + i + 1)
                        + lf(u, (kt * n + j) * w1 + i)
                        + lf(u, (kt * n + j) * w1 + i + 1));
                let vv = 0.25
                    * (lf(v, (kb * w1 + j) * n + i)
                        + lf(v, (kb * w1 + j + 1) * n + i)
                        + lf(v, (kt * w1 + j) * n + i)
                        + lf(v, (kt * w1 + j + 1) * n + i));
                let mut fx = i as f64 - kx * uu;
                let mut fy = j as f64 - ky * vv;
                let fz = k as f64 - kz * lf(w, wb + i);
                if !(fx >= -0.5 && fx <= lim && fy >= -0.5 && fy <= lim && fz >= 0.0 && fz <= nf) {
                    sf(w2, wb + i, wind_z);
                    i += 1;
                    continue;
                }
                if fx < 0.0 {
                    fx = 0.0;
                } else if fx > nm1 {
                    fx = nm1;
                }
                if fy < 0.0 {
                    fy = 0.0;
                } else if fy > nm1 {
                    fy = nm1;
                }
                let mut a = fx as i32;
                let mut b = fy as i32;
                let mut c = fz as i32;
                if a > n - 2 {
                    a = n - 2;
                }
                if b > n - 2 {
                    b = n - 2;
                }
                if c > n - 1 {
                    c = n - 1;
                }
                let tx = fx - a as f64;
                let ty = fy - b as f64;
                let tz = fz - c as f64;
                let q = c * nn + b * n + a;
                sf(w2, wb + i, tri(w, q, n, nn, tx, ty, tz));
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
}

/// `Smoke3.lift` (a smoke with no fire): heat lifts the z speeds where there is smoke.
#[no_mangle]
pub unsafe extern "C" fn grid3_lift(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let nn = n * n;
    let s = at(gi, G_S) as *const f32;
    let w = at(gi, G_W) as *mut f32;
    let k0 = ld(gf, F_H) * ld(gf, F_LIFT);
    let mut k = 0;
    while k <= n {
        let mut c = 0;
        while c < nn {
            let below = if k > 0 { lf(s, (k - 1) * nn + c) } else { 0.0 };
            let above = if k < n { lf(s, k * nn + c) } else { 0.0 };
            let d = if k > 0 && k < n { 0.5 * (below + above) } else { below + above };
            if d != 0.0 {
                sf(w, k * nn + c, lf(w, k * nn + c) + k0 * d);
            }
            c += 1;
        }
        k += 1;
    }
}

/// `fireLift3`: heat lifts and smoke sinks along +z, from the mean of the two cells beside each face.
#[no_mangle]
pub unsafe extern "C" fn grid3_fire_lift(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let nn = n * n;
    let t = at(gi, G_T) as *const f32;
    let s = at(gi, G_S) as *const f32;
    let w = at(gi, G_W) as *mut f32;
    let h = ld(gf, F_H);
    let mut c = 0;
    while c < nn {
        let a = LIFT_PER_DEGREE * lf(t, c) - SINK_PER_SMOKE * lf(s, c);
        sf(w, c, lf(w, c) + h * a);
        let e = n * nn + c;
        let b = LIFT_PER_DEGREE * lf(t, e - nn) - SINK_PER_SMOKE * lf(s, e - nn);
        sf(w, e, lf(w, e) + h * b);
        c += 1;
    }
    let mut k = 1;
    while k < n {
        let hi = k * nn;
        let lo = hi - nn;
        let mut c = 0;
        while c < nn {
            let a = LIFT_PER_DEGREE * (0.5 * (lf(t, lo + c) + lf(t, hi + c))) - SINK_PER_SMOKE * (0.5 * (lf(s, lo + c) + lf(s, hi + c)));
            sf(w, hi + c, lf(w, hi + c) + h * a);
            c += 1;
        }
        k += 1;
    }
}

/// `confine3`: vorticity confinement (swirl).
#[no_mangle]
pub unsafe extern "C" fn grid3_swirl(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    if n < 3 {
        return;
    }
    let nn = n * n;
    let w1 = n + 1;
    let total = n * nn;
    let u = at(gi, G_U) as *mut f32;
    let v = at(gi, G_V) as *mut f32;
    let w = at(gi, G_W) as *mut f32;
    let own = at(gi, G_OWN) as *const i32;
    let ca = at(gi, G_CA) as *mut f32;
    let cb = at(gi, G_CB) as *mut f32;
    let cc = at(gi, G_CC) as *mut f32;
    let oa = at(gi, G_OA) as *mut f32;
    let ob = at(gi, G_OB) as *mut f32;
    let oc = at(gi, G_OC) as *mut f32;
    let om = at(gi, G_OM) as *mut f32;
    let h = ld(gf, F_H);
    let dx = ld(gf, F_DX);
    let dy = ld(gf, F_DY);
    let dz = ld(gf, F_DZ);
    let hx = 0.5 / dx;
    let hy = 0.5 / dy;
    let hz = 0.5 / dz;
    let mut k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let mut i = 0;
            while i < n {
                let c = (k * n + j) * n + i;
                sf(ca, c, 0.5 * (lf(u, (k * n + j) * w1 + i) + lf(u, (k * n + j) * w1 + i + 1)));
                sf(cb, c, 0.5 * (lf(v, (k * w1 + j) * n + i) + lf(v, (k * w1 + j + 1) * n + i)));
                sf(cc, c, 0.5 * (lf(w, c) + lf(w, c + nn)));
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    zero_f32(oa, 0, total);
    zero_f32(ob, 0, total);
    zero_f32(oc, 0, total);
    zero_f32(om, 0, total);
    k = 1;
    while k < n - 1 {
        let mut j = 1;
        while j < n - 1 {
            let mut i = 1;
            while i < n - 1 {
                let c = (k * n + j) * n + i;
                if li(own, c) >= 0 {
                    i += 1;
                    continue;
                }
                let wx = (lf(cc, c + n) - lf(cc, c - n)) * hy - (lf(cb, c + nn) - lf(cb, c - nn)) * hz;
                let wy = (lf(ca, c + nn) - lf(ca, c - nn)) * hz - (lf(cc, c + 1) - lf(cc, c - 1)) * hx;
                let wz = (lf(cb, c + 1) - lf(cb, c - 1)) * hx - (lf(ca, c + n) - lf(ca, c - n)) * hy;
                sf(oa, c, wx);
                sf(ob, c, wy);
                sf(oc, c, wz);
                sf(om, c, (wx * wx + wy * wy + wz * wz).sqrt());
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    zero_f32(ca, 0, total);
    zero_f32(cb, 0, total);
    zero_f32(cc, 0, total);
    let dmin = js_min(js_min(dx, dy), dz);
    let kf = ld(gf, F_SWIRL) * dmin;
    k = 1;
    while k < n - 1 {
        let mut j = 1;
        while j < n - 1 {
            let mut i = 1;
            while i < n - 1 {
                let c = (k * n + j) * n + i;
                if !(lf(om, c) > 0.0) {
                    i += 1;
                    continue;
                }
                let gx = (lf(om, c + 1) - lf(om, c - 1)) * hx;
                let gy = (lf(om, c + n) - lf(om, c - n)) * hy;
                let gz = (lf(om, c + nn) - lf(om, c - nn)) * hz;
                let m = (gx * gx + gy * gy + gz * gz).sqrt() + 1e-9;
                let nx = gx / m;
                let ny = gy / m;
                let nz = gz / m;
                let wx = lf(oa, c);
                let wy = lf(ob, c);
                let wz = lf(oc, c);
                sf(ca, c, kf * (ny * wz - nz * wy));
                sf(cb, c, kf * (nz * wx - nx * wz));
                sf(cc, c, kf * (nx * wy - ny * wx));
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    let cap = (0.5 * dmin) / h;
    k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let mut i = 1;
            while i < n {
                let c = (k * n + j) * n + i;
                if li(own, c - 1) >= 0 || li(own, c) >= 0 {
                    i += 1;
                    continue;
                }
                let mut dv = h * 0.5 * (lf(ca, c - 1) + lf(ca, c));
                if dv > cap {
                    dv = cap;
                } else if dv < -cap {
                    dv = -cap;
                }
                sf(u, (k * n + j) * w1 + i, lf(u, (k * n + j) * w1 + i) + dv);
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    k = 0;
    while k < n {
        let mut j = 1;
        while j < n {
            let mut i = 0;
            while i < n {
                let c = (k * n + j) * n + i;
                if li(own, c - n) >= 0 || li(own, c) >= 0 {
                    i += 1;
                    continue;
                }
                let mut dv = h * 0.5 * (lf(cb, c - n) + lf(cb, c));
                if dv > cap {
                    dv = cap;
                } else if dv < -cap {
                    dv = -cap;
                }
                sf(v, (k * w1 + j) * n + i, lf(v, (k * w1 + j) * n + i) + dv);
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    k = 1;
    while k < n {
        let mut j = 0;
        while j < n {
            let mut i = 0;
            while i < n {
                let c = (k * n + j) * n + i;
                if li(own, c - nn) >= 0 || li(own, c) >= 0 {
                    i += 1;
                    continue;
                }
                let mut dv = h * 0.5 * (lf(cc, c - nn) + lf(cc, c));
                if dv > cap {
                    dv = cap;
                } else if dv < -cap {
                    dv = -cap;
                }
                sf(w, c, lf(w, c) + dv);
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
}

/// The weights of the eight cells round a back-traced point, 0 for a solid cell (`advectSmoke`, `advectFire3`).
#[inline(always)]
unsafe fn air_weights(own: *const i32, q: i32, n: i32, nn: i32, tx: f64, ty: f64, tz: f64) -> [f64; 8] {
    [
        if li(own, q) < 0 {
            (1.0 - tx) * (1.0 - ty) * (1.0 - tz)
        } else {
            0.0
        },
        if li(own, q + 1) < 0 { tx * (1.0 - ty) * (1.0 - tz) } else { 0.0 },
        if li(own, q + n) < 0 { (1.0 - tx) * ty * (1.0 - tz) } else { 0.0 },
        if li(own, q + n + 1) < 0 { tx * ty * (1.0 - tz) } else { 0.0 },
        if li(own, q + nn) < 0 { (1.0 - tx) * (1.0 - ty) * tz } else { 0.0 },
        if li(own, q + nn + 1) < 0 { tx * (1.0 - ty) * tz } else { 0.0 },
        if li(own, q + nn + n) < 0 { (1.0 - tx) * ty * tz } else { 0.0 },
        if li(own, q + nn + n + 1) < 0 { tx * ty * tz } else { 0.0 },
    ]
}

#[inline(always)]
fn weight_sum(m: &[f64; 8]) -> f64 {
    m[0] + m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7]
}

#[inline(always)]
unsafe fn weighted(m: &[f64; 8], a: *const f32, q: i32, n: i32, nn: i32) -> f64 {
    m[0] * lf(a, q)
        + m[1] * lf(a, q + 1)
        + m[2] * lf(a, q + n)
        + m[3] * lf(a, q + n + 1)
        + m[4] * lf(a, q + nn)
        + m[5] * lf(a, q + nn + 1)
        + m[6] * lf(a, q + nn + n)
        + m[7] * lf(a, q + nn + n + 1)
}

/// Where a cell's air came from: the cell `(i, j, k)` traced back by `(uu, vv, ww) h` over cell sizes. `None` when that is
/// outside the box (by more than half a cell); else the corner cell `q` and the fractions.
struct Back {
    q: i32,
    tx: f64,
    ty: f64,
    tz: f64,
}

#[inline(always)]
fn back(i: i32, j: i32, k: i32, uu: f64, vv: f64, ww: f64, kx: f64, ky: f64, kz: f64, n: i32, nn: i32) -> Option<Back> {
    let lim = n as f64 - 0.5;
    let nm1 = (n - 1) as f64;
    let mut fx = i as f64 - kx * uu;
    let mut fy = j as f64 - ky * vv;
    let mut fz = k as f64 - kz * ww;
    if !(fx >= -0.5 && fx <= lim && fy >= -0.5 && fy <= lim && fz >= -0.5 && fz <= lim) {
        return None;
    }
    if fx < 0.0 {
        fx = 0.0;
    } else if fx > nm1 {
        fx = nm1;
    }
    if fy < 0.0 {
        fy = 0.0;
    } else if fy > nm1 {
        fy = nm1;
    }
    if fz < 0.0 {
        fz = 0.0;
    } else if fz > nm1 {
        fz = nm1;
    }
    let mut a = fx as i32;
    let mut b = fy as i32;
    let mut e = fz as i32;
    if a > n - 2 {
        a = n - 2;
    }
    if b > n - 2 {
        b = n - 2;
    }
    if e > n - 2 {
        e = n - 2;
    }
    Some(Back {
        q: e * nn + b * n + a,
        tx: fx - a as f64,
        ty: fy - b as f64,
        tz: fz - e as f64,
    })
}

/// What a pair of neighbouring air cells (i, i + 1) of a row gather from, in the fire's and the smoke's carrying: the corner
/// cell of each lane and the eight weights of each (a lane's weights are the scalar `air_weights`), with their sum.
#[cfg(target_feature = "simd128")]
struct CentrePair {
    qa: i32,
    qb: i32,
    m: [v128; 8],
    sum: v128,
}

/// The back-trace of two neighbouring cells, each lane doing the scalar operations of its cell. `None` unless both cells are
/// air, both have air moving in them, both trace back inside the box and both gather from air (the caller then does the cells
/// one at a time, whatever they need).
#[cfg(target_feature = "simd128")]
#[inline(always)]
unsafe fn centre_pair(
    u: *const f32,
    v: *const f32,
    w: *const f32,
    own: *const i32,
    i: i32,
    j: i32,
    k: i32,
    n: i32,
    nn: i32,
    w1: i32,
    kx: v128,
    ky: v128,
    kz: v128,
) -> Option<CentrePair> {
    let c = (k * n + j) * n + i;
    if li(own, c) >= 0 || li(own, c + 1) >= 0 {
        return None;
    }
    let half = f64x2_splat(0.5);
    let uu = f64x2_mul(half, f64x2_add(ld2(u, (k * n + j) * w1 + i), ld2(u, (k * n + j) * w1 + i + 1)));
    let vv = f64x2_mul(half, f64x2_add(ld2(v, (k * w1 + j) * n + i), ld2(v, (k * w1 + j + 1) * n + i)));
    let ww = f64x2_mul(half, f64x2_add(ld2(w, c), ld2(w, c + nn)));
    let zero = f64x2_splat(0.0);
    let still = v128_and(v128_and(f64x2_eq(uu, zero), f64x2_eq(vv, zero)), f64x2_eq(ww, zero));
    if v128_any_true(still) {
        return None;
    }
    let fx = f64x2_sub(f64x2(i as f64, (i + 1) as f64), f64x2_mul(kx, uu));
    let fy = f64x2_sub(f64x2_splat(j as f64), f64x2_mul(ky, vv));
    let fz = f64x2_sub(f64x2_splat(k as f64), f64x2_mul(kz, ww));
    let lo = f64x2_splat(-0.5);
    let hi = f64x2_splat(n as f64 - 0.5);
    let inside = |f: v128| v128_and(f64x2_ge(f, lo), f64x2_le(f, hi));
    if !i64x2_all_true(v128_and(v128_and(inside(fx), inside(fy)), inside(fz))) {
        return None;
    }
    let nm1 = f64x2_splat((n - 1) as f64);
    let clamp = |f: v128| {
        let g = v128_bitselect(zero, f, f64x2_lt(f, zero));
        v128_bitselect(nm1, g, f64x2_gt(g, nm1))
    };
    let (fx, fy, fz) = (clamp(fx), clamp(fy), clamp(fz));
    let lim = i32x4_splat(n - 2);
    let a = i32x4_min(i32x4_trunc_sat_f64x2_zero(fx), lim);
    let b = i32x4_min(i32x4_trunc_sat_f64x2_zero(fy), lim);
    let e = i32x4_min(i32x4_trunc_sat_f64x2_zero(fz), lim);
    let tx = f64x2_sub(fx, f64x2_convert_low_i32x4(a));
    let ty = f64x2_sub(fy, f64x2_convert_low_i32x4(b));
    let tz = f64x2_sub(fz, f64x2_convert_low_i32x4(e));
    let qa = i32x4_extract_lane::<0>(e) * nn + i32x4_extract_lane::<0>(b) * n + i32x4_extract_lane::<0>(a);
    let qb = i32x4_extract_lane::<1>(e) * nn + i32x4_extract_lane::<1>(b) * n + i32x4_extract_lane::<1>(a);
    let one = f64x2_splat(1.0);
    let (ox, oy, oz) = (f64x2_sub(one, tx), f64x2_sub(one, ty), f64x2_sub(one, tz));
    let offs = [0, 1, n, n + 1, nn, nn + 1, nn + n, nn + n + 1];
    // the weight of each corner, 0 where that cell is solid (the same products, in the same order, as `air_weights`)
    let raw = [
        f64x2_mul(f64x2_mul(ox, oy), oz),
        f64x2_mul(f64x2_mul(tx, oy), oz),
        f64x2_mul(f64x2_mul(ox, ty), oz),
        f64x2_mul(f64x2_mul(tx, ty), oz),
        f64x2_mul(f64x2_mul(ox, oy), tz),
        f64x2_mul(f64x2_mul(tx, oy), tz),
        f64x2_mul(f64x2_mul(ox, ty), tz),
        f64x2_mul(f64x2_mul(tx, ty), tz),
    ];
    let mut m = [zero; 8];
    let mut t = 0;
    while t < 8 {
        let ma = if li(own, qa + offs[t]) < 0 { -1i64 } else { 0 };
        let mb = if li(own, qb + offs[t]) < 0 { -1i64 } else { 0 };
        m[t] = v128_and(raw[t], i64x2(ma, mb));
        t += 1;
    }
    let sum = f64x2_add(
        f64x2_add(
            f64x2_add(f64x2_add(f64x2_add(f64x2_add(f64x2_add(m[0], m[1]), m[2]), m[3]), m[4]), m[5]),
            m[6],
        ),
        m[7],
    );
    if !i64x2_all_true(f64x2_gt(sum, zero)) {
        return None;
    }
    Some(CentrePair { qa, qb, m, sum })
}

/// `weighted` for two lanes: the same eight products added in the same order, divided by the sum.
#[cfg(target_feature = "simd128")]
#[inline(always)]
unsafe fn blend_pair(p: &CentrePair, a: *const f32, n: i32, nn: i32) -> v128 {
    let rows = [0, n, nn, nn + n];
    let mut lo = [f64x2_splat(0.0); 4];
    let mut hi = [f64x2_splat(0.0); 4];
    let mut t = 0;
    while t < 4 {
        let x = ld2(a, p.qa + rows[t]);
        let y = ld2(a, p.qb + rows[t]);
        lo[t] = i64x2_shuffle::<0, 2>(x, y);
        hi[t] = i64x2_shuffle::<1, 3>(x, y);
        t += 1;
    }
    let m = &p.m;
    let num = f64x2_add(
        f64x2_add(
            f64x2_add(
                f64x2_add(
                    f64x2_add(
                        f64x2_add(f64x2_add(f64x2_mul(m[0], lo[0]), f64x2_mul(m[1], hi[0])), f64x2_mul(m[2], lo[1])),
                        f64x2_mul(m[3], hi[1]),
                    ),
                    f64x2_mul(m[4], lo[2]),
                ),
                f64x2_mul(m[5], hi[2]),
            ),
            f64x2_mul(m[6], lo[3]),
        ),
        f64x2_mul(m[7], hi[3]),
    );
    f64x2_div(num, p.sum)
}

/// `advectFire3`: `T` and `F` carried back along the flow, into `T2` and `F2` (the caller swaps).
#[no_mangle]
pub unsafe extern "C" fn grid3_advect_fire(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let nn = n * n;
    let w1 = n + 1;
    let u = at(gi, G_U) as *const f32;
    let v = at(gi, G_V) as *const f32;
    let w = at(gi, G_W) as *const f32;
    let own = at(gi, G_OWN) as *const i32;
    let t = at(gi, G_T) as *const f32;
    let f = at(gi, G_F) as *const f32;
    let t2 = at(gi, G_T2) as *mut f32;
    let f2 = at(gi, G_F2) as *mut f32;
    let h = ld(gf, F_H);
    let kx = h / ld(gf, F_DX);
    let ky = h / ld(gf, F_DY);
    let kz = h / ld(gf, F_DZ);
    #[cfg(target_feature = "simd128")]
    let (kxv, kyv, kzv) = (f64x2_splat(kx), f64x2_splat(ky), f64x2_splat(kz));
    let mut k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let mut i = 0;
            while i < n {
                let c = (k * n + j) * n + i;
                #[cfg(target_feature = "simd128")]
                {
                    if i + 1 < n {
                        if let Some(pr) = centre_pair(u, v, w, own, i, j, k, n, nn, w1, kxv, kyv, kzv) {
                            st2(t2, c, blend_pair(&pr, t, n, nn));
                            let fv = blend_pair(&pr, f, n, nn);
                            st2(f2, c, v128_and(fv, f64x2_gt(fv, f64x2_splat(1e-6))));
                            i += 2;
                            continue;
                        }
                    }
                }
                if li(own, c) >= 0 {
                    sf(t2, c, 0.0);
                    sf(f2, c, 0.0);
                    i += 1;
                    continue;
                }
                let uu = 0.5 * (lf(u, (k * n + j) * w1 + i) + lf(u, (k * n + j) * w1 + i + 1));
                let vv = 0.5 * (lf(v, (k * w1 + j) * n + i) + lf(v, (k * w1 + j + 1) * n + i));
                let ww = 0.5 * (lf(w, c) + lf(w, c + nn));
                if uu == 0.0 && vv == 0.0 && ww == 0.0 {
                    sf(t2, c, lf(t, c));
                    sf(f2, c, lf(f, c));
                    i += 1;
                    continue;
                }
                match back(i, j, k, uu, vv, ww, kx, ky, kz, n, nn) {
                    None => {
                        sf(t2, c, 0.0);
                        sf(f2, c, 0.0);
                    }
                    Some(b) => {
                        let m = air_weights(own, b.q, n, nn, b.tx, b.ty, b.tz);
                        let sum = weight_sum(&m);
                        if !(sum > 0.0) {
                            sf(t2, c, 0.0);
                            sf(f2, c, 0.0);
                        } else {
                            sf(t2, c, weighted(&m, t, b.q, n, nn) / sum);
                            // fuel blended thinner than a millionth of a unit is gone
                            let fv = weighted(&m, f, b.q, n, nn) / sum;
                            sf(f2, c, if fv > 1e-6 { fv } else { 0.0 });
                        }
                    }
                }
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
}

/// `burnFuel3`, `fireSource3` and `coolFire3`, cell by cell (each cell's three steps read and write that cell only, so one
/// pass over the cells gives the bits of three), then `quench3`: each drop in order, from the list of the cells they are in.
#[no_mangle]
pub unsafe extern "C" fn grid3_fire(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let total = n * n * n;
    let t = at(gi, G_T) as *mut f32;
    let f = at(gi, G_F) as *mut f32;
    let s = at(gi, G_S) as *mut f32;
    let own = at(gi, G_OWN) as *const i32;
    let src = at(gi, G_SRC) as *const u8;
    let wet = at(gi, G_WET) as *mut u8;
    let h = ld(gf, F_H);
    let rate = ld(gf, F_BURN) * h;
    let heat = ld(gf, F_FHEAT);
    let heat2 = 2.0 * heat;
    let smoke = ld(gf, F_FSMOKE);
    let sourced = li(gi, G_SRCON) != 0;
    let add = ld(gf, F_FUEL) * h;
    let k = (COOLING * h) / (heat * heat * heat);
    let mut c = 0;
    while c < total {
        // burnFuel3
        let fv = lf(f, c);
        let tv = lf(t, c);
        if fv > 0.0 && tv > IGNITE && li(own, c) < 0 {
            let mut x = (tv - IGNITE) / RAMP;
            if x > 1.0 {
                x = 1.0;
            }
            let xi = x * x * (3.0 - 2.0 * x);
            let mut r = rate * xi;
            if r > fv {
                r = fv;
            }
            sf(f, c, fv - r);
            let nt = tv + heat2 * r;
            sf(t, c, if nt < heat { nt } else { heat });
            sf(s, c, lf(s, c) + smoke * r);
        }
        // fireSource3
        if sourced && lb(src, c) == 1 && li(own, c) < 0 {
            let fs = lf(f, c) + add;
            sf(f, c, if fs < 1.0 { fs } else { 1.0 });
            sf(t, c, heat);
        }
        // coolFire3
        let tc = lf(t, c);
        if !(tc > 0.0) {
            if tc < 0.0 {
                sf(t, c, 0.0);
            }
        } else {
            let t2 = tc * tc;
            let nt = tc - k * t2 * t2;
            sf(t, c, if nt > 0.0 { nt } else { 0.0 });
        }
        c += 1;
    }
    // quench3
    c = 0;
    while c < total {
        *wet.offset(c as isize) = 0;
        c += 1;
    }
    let drops = at(gi, G_DROPS) as *const i32;
    let nd = li(gi, G_NDROPS);
    let mut m = 0;
    while m < nd {
        let c = li(drops, m);
        if c < 0 || li(own, c) >= 0 {
            m += 1;
            continue;
        }
        *wet.offset(c as isize) = 1;
        let tv = lf(t, c);
        sf(t, c, tv - (if tv < DROP_COOLS { tv } else { DROP_COOLS }));
        sf(f, c, 0.0);
        m += 1;
    }
}

/// `Smoke3.solidFaces`: faces next to a solid cell take the solid's speed there. `sb` holds nine numbers a body: its place,
/// speed and spin; `still` is 1 for a body that is not moving at all.
#[no_mangle]
pub unsafe extern "C" fn grid3_solid_faces(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let w1 = n + 1;
    let u = at(gi, G_U) as *mut f32;
    let v = at(gi, G_V) as *mut f32;
    let w = at(gi, G_W) as *mut f32;
    let own = at(gi, G_OWN) as *const i32;
    let sb = at(gi, G_SB) as *const f64;
    let still = at(gi, G_STILL) as *const u8;
    let x0 = ld(gf, F_X0);
    let y0 = ld(gf, F_Y0);
    let z0 = ld(gf, F_Z0);
    let dx = ld(gf, F_DX);
    let dy = ld(gf, F_DY);
    let dz = ld(gf, F_DZ);
    let mut k = 0;
    while k < n {
        let z = z0 + (k as f64 + 0.5) * dz;
        let mut j = 0;
        while j < n {
            let y = y0 + (j as f64 + 0.5) * dy;
            let c0 = (k * n + j) * n;
            let mut i = 0;
            while i <= n {
                let l = if i > 0 { li(own, c0 + i - 1) } else { -1 };
                let r = if i < n { li(own, c0 + i) } else { -1 };
                let b = if l >= 0 { l } else { r };
                if b < 0 {
                    i += 1;
                    continue;
                }
                if lb(still, b) == 1 {
                    sf(u, (k * n + j) * w1 + i, 0.0);
                    i += 1;
                    continue;
                }
                let o = b * 9;
                let ry = y - ld(sb, o + 1);
                let rz = z - ld(sb, o + 2);
                let cvx = ld(sb, o + 3) + ld(sb, o + 7) * rz - ld(sb, o + 8) * ry;
                sf(u, (k * n + j) * w1 + i, cvx);
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    k = 0;
    while k < n {
        let z = z0 + (k as f64 + 0.5) * dz;
        let mut j = 0;
        while j <= n {
            let mut i = 0;
            while i < n {
                let lo = if j > 0 { li(own, (k * n + j - 1) * n + i) } else { -1 };
                let hi = if j < n { li(own, (k * n + j) * n + i) } else { -1 };
                let b = if lo >= 0 { lo } else { hi };
                if b < 0 {
                    i += 1;
                    continue;
                }
                if lb(still, b) == 1 {
                    sf(v, (k * w1 + j) * n + i, 0.0);
                    i += 1;
                    continue;
                }
                let o = b * 9;
                let x = x0 + (i as f64 + 0.5) * dx;
                let rx = x - ld(sb, o);
                let rz = z - ld(sb, o + 2);
                let cvy = ld(sb, o + 4) + ld(sb, o + 8) * rx - ld(sb, o + 6) * rz;
                sf(v, (k * w1 + j) * n + i, cvy);
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    k = 0;
    while k <= n {
        let mut j = 0;
        while j < n {
            let y = y0 + (j as f64 + 0.5) * dy;
            let mut i = 0;
            while i < n {
                let lo = if k > 0 { li(own, ((k - 1) * n + j) * n + i) } else { -1 };
                let hi = if k < n { li(own, (k * n + j) * n + i) } else { -1 };
                let b = if lo >= 0 { lo } else { hi };
                if b < 0 {
                    i += 1;
                    continue;
                }
                if lb(still, b) == 1 {
                    sf(w, (k * n + j) * n + i, 0.0);
                    i += 1;
                    continue;
                }
                let o = b * 9;
                let x = x0 + (i as f64 + 0.5) * dx;
                let rx = x - ld(sb, o);
                let ry = y - ld(sb, o + 1);
                let cvz = ld(sb, o + 5) + ld(sb, o + 6) * ry - ld(sb, o + 7) * rx;
                sf(w, (k * n + j) * n + i, cvz);
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
}

/// `Smoke3.project`: the pressure solve (the rows' air spans, the cells off the plain stencil, 20 red-black passes) and the
/// gradient taken off the faces.
#[no_mangle]
pub unsafe extern "C" fn grid3_project(gi: *const i32, gf: *const f64) {
    let n = li(gi, G_N);
    let nn = n * n;
    let w1 = n + 1;
    let s = n + 2;
    let ss = s * s;
    let own = at(gi, G_OWN) as *const i32;
    let p = at(gi, G_P) as *mut f32;
    let div = at(gi, G_DIV) as *mut f32;
    let wl = at(gi, G_WL) as *mut f32;
    let wr = at(gi, G_WR) as *mut f32;
    let wd = at(gi, G_WD) as *mut f32;
    let wu = at(gi, G_WU) as *mut f32;
    let wb = at(gi, G_WB) as *mut f32;
    let wf = at(gi, G_WF) as *mut f32;
    let inv = at(gi, G_INV) as *mut f32;
    let fix = at(gi, G_FIX) as *mut i32;
    let fixed = at(gi, G_FIXED) as *mut f32;
    let row_lo = at(gi, G_ROWLO) as *mut i32;
    let row_hi = at(gi, G_ROWHI) as *mut i32;
    let u = at(gi, G_U) as *mut f32;
    let v = at(gi, G_V) as *mut f32;
    let w = at(gi, G_W) as *mut f32;
    let dx = ld(gf, F_DX);
    let dy = ld(gf, F_DY);
    let dz = ld(gf, F_DZ);
    let wx = 1.0 / (dx * dx);
    let wy = 1.0 / (dy * dy);
    let wz = 1.0 / (dz * dz);
    let ip = 1.0 / (2.0 * wx + 2.0 * wy + 2.0 * wz);
    let ax = OMEGA * ip * wx;
    let ay = OMEGA * ip * wy;
    let az = OMEGA * ip * wz;
    let idx = 1.0 / dx;
    let idy = 1.0 / dy;
    let idz = 1.0 / dz;
    let mut nf0 = 0;
    let mut nf1 = 0;
    let half = n * nn;
    let mut k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            // the span of air in this row: the solid cells outside it (a floor, a wall) are not solved, only held at p = 0
            let c0 = (k * n + j) * n;
            let mut lo = 0;
            while lo < n && li(own, c0 + lo) >= 0 {
                lo += 1;
            }
            let mut hi = n;
            while hi > lo && li(own, c0 + hi - 1) >= 0 {
                hi -= 1;
            }
            si(row_lo, k * n + j, lo);
            si(row_hi, k * n + j, hi);
            let qrow = ((k + 1) * s + (j + 1)) * s + 1;
            if lo > 0 {
                zero_f32(p, qrow, qrow + lo);
            }
            if hi < n {
                zero_f32(p, qrow + hi, qrow + n);
            }
            let mut i = lo;
            while i < hi {
                let c = c0 + i;
                let q = qrow + i;
                let odd = (i + j + k) & 1;
                if li(own, c) >= 0 {
                    sf(inv, q, 0.0);
                    sf(div, q, 0.0);
                    sf(p, q, 0.0);
                    if odd == 0 {
                        si(fix, nf0, q);
                        nf0 += 1;
                    } else {
                        si(fix, half + nf1, q);
                        nf1 += 1;
                    }
                    i += 1;
                    continue;
                }
                let l = if i == 0 || li(own, c - 1) < 0 { wx } else { 0.0 };
                let r = if i == n - 1 || li(own, c + 1) < 0 { wx } else { 0.0 };
                let d = if j == 0 || li(own, c - n) < 0 { wy } else { 0.0 };
                let t = if j == n - 1 || li(own, c + n) < 0 { wy } else { 0.0 };
                let b = if k == 0 || li(own, c - nn) < 0 { wz } else { 0.0 };
                let f = if k == n - 1 || li(own, c + nn) < 0 { wz } else { 0.0 };
                let dv = (lf(u, (k * n + j) * w1 + i + 1) - lf(u, (k * n + j) * w1 + i)) * idx
                    + (lf(v, (k * w1 + j + 1) * n + i) - lf(v, (k * w1 + j) * n + i)) * idy
                    + (lf(w, c + nn) - lf(w, c)) * idz;
                // a cell a body has just left held p = 0: start it from the mean of its neighbours (read from the pressure alone)
                if lf(p, q) == 0.0 {
                    let s6 = lf(p, q - 1) + lf(p, q + 1) + lf(p, q - s) + lf(p, q + s) + lf(p, q - ss) + lf(p, q + ss);
                    if s6 != 0.0 {
                        sf(p, q, s6 / 6.0);
                    }
                }
                if l != 0.0 && r != 0.0 && d != 0.0 && t != 0.0 && b != 0.0 && f != 0.0 {
                    sf(div, q, OMEGA * ip * dv);
                    i += 1;
                    continue;
                }
                let sum = l + r + d + t + b + f;
                let iq = if sum > 0.0 { OMEGA / sum } else { 0.0 };
                sf(wl, q, if i == 0 { 0.0 } else { l * iq });
                sf(wr, q, if i == n - 1 { 0.0 } else { r * iq });
                sf(wd, q, if j == 0 { 0.0 } else { d * iq });
                sf(wu, q, if j == n - 1 { 0.0 } else { t * iq });
                sf(wb, q, if k == 0 { 0.0 } else { b * iq });
                sf(wf, q, if k == n - 1 { 0.0 } else { f * iq });
                sf(inv, q, iq);
                sf(div, q, iq * dv);
                if odd == 0 {
                    si(fix, nf0, q);
                    nf0 += 1;
                } else {
                    si(fix, half + nf1, q);
                    nf1 += 1;
                }
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    let mut pass = 0;
    while pass < PASSES {
        let mut colour = 0;
        while colour < 2 {
            let f0 = if colour == 0 { 0 } else { half };
            let f1 = f0 + if colour == 0 { nf0 } else { nf1 };
            let mut m = f0;
            while m < f1 {
                let q = li(fix, m);
                let iq = lf(inv, q);
                if iq == 0.0 {
                    sf(fixed, m, 0.0);
                    m += 1;
                    continue;
                }
                sf(
                    fixed,
                    m,
                    KEEP * lf(p, q)
                        + lf(wl, q) * lf(p, q - 1)
                        + lf(wr, q) * lf(p, q + 1)
                        + lf(wd, q) * lf(p, q - s)
                        + lf(wu, q) * lf(p, q + s)
                        + lf(wb, q) * lf(p, q - ss)
                        + lf(wf, q) * lf(p, q + ss)
                        - lf(div, q),
                );
                m += 1;
            }
            let mut k = 0;
            while k < n {
                let mut j = 0;
                while j < n {
                    let row = ((k + 1) * s + (j + 1)) * s + 1;
                    let lo = li(row_lo, k * n + j);
                    let end = row + li(row_hi, k * n + j);
                    let mut q = row + lo + ((colour + j + k + lo) & 1);
                    while q < end {
                        sf(
                            p,
                            q,
                            KEEP * lf(p, q)
                                + ax * (lf(p, q - 1) + lf(p, q + 1))
                                + ay * (lf(p, q - s) + lf(p, q + s))
                                + az * (lf(p, q - ss) + lf(p, q + ss))
                                - lf(div, q),
                        );
                        q += 2;
                    }
                    j += 1;
                }
                k += 1;
            }
            m = f0;
            while m < f1 {
                sf(p, li(fix, m), lf(fixed, m));
                m += 1;
            }
            colour += 1;
        }
        pass += 1;
    }
    // take the gradient off every face between two air cells, or an air cell and the open air outside (p = 0 there)
    k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let row = ((k + 1) * s + (j + 1)) * s;
            let c0 = (k * n + j) * n;
            let mut i = 0;
            while i <= n {
                if (i > 0 && li(own, c0 + i - 1) >= 0) || (i < n && li(own, c0 + i) >= 0) {
                    i += 1;
                    continue;
                }
                sf(
                    u,
                    (k * n + j) * w1 + i,
                    lf(u, (k * n + j) * w1 + i) - (lf(p, row + i + 1) - lf(p, row + i)) * idx,
                );
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    k = 0;
    while k < n {
        let mut j = 0;
        while j <= n {
            let mut i = 0;
            while i < n {
                if (j > 0 && li(own, (k * n + j - 1) * n + i) >= 0) || (j < n && li(own, (k * n + j) * n + i) >= 0) {
                    i += 1;
                    continue;
                }
                sf(
                    v,
                    (k * w1 + j) * n + i,
                    lf(v, (k * w1 + j) * n + i) - (lf(p, ((k + 1) * s + j + 1) * s + i + 1) - lf(p, ((k + 1) * s + j) * s + i + 1)) * idy,
                );
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    k = 0;
    while k <= n {
        let mut j = 0;
        while j < n {
            let mut i = 0;
            while i < n {
                if (k > 0 && li(own, ((k - 1) * n + j) * n + i) >= 0) || (k < n && li(own, (k * n + j) * n + i) >= 0) {
                    i += 1;
                    continue;
                }
                sf(
                    w,
                    (k * n + j) * n + i,
                    lf(w, (k * n + j) * n + i) - (lf(p, ((k + 1) * s + j + 1) * s + i + 1) - lf(p, (k * s + j + 1) * s + i + 1)) * idz,
                );
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
}

/// `Smoke3.outflow`: smoke (density times area per second) leaving through the open faces of the box, by the flow now.
unsafe fn outflow(gi: *const i32, gf: *const f64) -> f64 {
    let n = li(gi, G_N);
    let w1 = n + 1;
    let u = at(gi, G_U) as *const f32;
    let v = at(gi, G_V) as *const f32;
    let w = at(gi, G_W) as *const f32;
    let s = at(gi, G_S) as *const f32;
    let dy = ld(gf, F_DY);
    let dz = ld(gf, F_DZ);
    let dx = ld(gf, F_DX);
    let mut f = 0.0;
    let ayz = dy * dz;
    let axz = dx * dz;
    let axy = dx * dy;
    let mut k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let l = -lf(u, (k * n + j) * w1);
            let r = lf(u, (k * n + j) * w1 + n);
            if l > 0.0 {
                f += l * lf(s, (k * n + j) * n) * ayz;
            }
            if r > 0.0 {
                f += r * lf(s, (k * n + j) * n + n - 1) * ayz;
            }
            j += 1;
        }
        k += 1;
    }
    k = 0;
    while k < n {
        let mut i = 0;
        while i < n {
            let d = -lf(v, k * w1 * n + i);
            let t = lf(v, (k * w1 + n) * n + i);
            if d > 0.0 {
                f += d * lf(s, k * n * n + i) * axz;
            }
            if t > 0.0 {
                f += t * lf(s, (k * n + n - 1) * n + i) * axz;
            }
            i += 1;
        }
        k += 1;
    }
    let mut j = 0;
    while j < n {
        let mut i = 0;
        while i < n {
            let d = -lf(w, j * n + i);
            let t = lf(w, n * n * n + j * n + i);
            if d > 0.0 {
                f += d * lf(s, j * n + i) * axy;
            }
            if t > 0.0 {
                f += t * lf(s, (n - 1) * n * n + j * n + i) * axy;
            }
            i += 1;
        }
        j += 1;
    }
    f
}

/// `Smoke3.advectSmoke`: smoke carried back along the flow into `s2` (the caller swaps), scaled so a closed box keeps its
/// mass (the scale is left in `gf[F_LAST]`, 1 when none).
#[no_mangle]
pub unsafe extern "C" fn grid3_advect_smoke(gi: *const i32, gf: *mut f64) {
    let n = li(gi, G_N);
    let nn = n * n;
    let w1 = n + 1;
    let u = at(gi, G_U) as *const f32;
    let v = at(gi, G_V) as *const f32;
    let w = at(gi, G_W) as *const f32;
    let s = at(gi, G_S) as *const f32;
    let s2 = at(gi, G_S2) as *mut f32;
    let own = at(gi, G_OWN) as *const i32;
    let h = ld(gf, F_H);
    let dx = ld(gf, F_DX);
    let dy = ld(gf, F_DY);
    let dz = ld(gf, F_DZ);
    let kx = h / dx;
    let ky = h / dy;
    let kz = h / dz;
    let total = n * nn;
    #[cfg(target_feature = "simd128")]
    let (kxv, kyv, kzv) = (f64x2_splat(kx), f64x2_splat(ky), f64x2_splat(kz));
    let mut k = 0;
    while k < n {
        let mut j = 0;
        while j < n {
            let mut i = 0;
            while i < n {
                let c = (k * n + j) * n + i;
                #[cfg(target_feature = "simd128")]
                {
                    if i + 1 < n {
                        if let Some(pr) = centre_pair(u, v, w, own, i, j, k, n, nn, w1, kxv, kyv, kzv) {
                            st2(s2, c, blend_pair(&pr, s, n, nn));
                            i += 2;
                            continue;
                        }
                    }
                }
                if li(own, c) >= 0 {
                    sf(s2, c, 0.0);
                    i += 1;
                    continue;
                }
                let uu = 0.5 * (lf(u, (k * n + j) * w1 + i) + lf(u, (k * n + j) * w1 + i + 1));
                let vv = 0.5 * (lf(v, (k * w1 + j) * n + i) + lf(v, (k * w1 + j + 1) * n + i));
                let ww = 0.5 * (lf(w, c) + lf(w, c + nn));
                if uu == 0.0 && vv == 0.0 && ww == 0.0 {
                    sf(s2, c, lf(s, c));
                    i += 1;
                    continue;
                }
                match back(i, j, k, uu, vv, ww, kx, ky, kz, n, nn) {
                    None => sf(s2, c, 0.0),
                    Some(b) => {
                        // only the air cells round the point count: a solid's cells hold none and would thin the smoke beside it
                        let m = air_weights(own, b.q, n, nn, b.tx, b.ty, b.tz);
                        let sum = weight_sum(&m);
                        sf(s2, c, if sum > 0.0 { weighted(&m, s, b.q, n, nn) / sum } else { 0.0 });
                    }
                }
                i += 1;
            }
            j += 1;
        }
        k += 1;
    }
    let mut before = 0.0;
    let mut after = 0.0;
    let mut c = 0;
    while c < total {
        before += lf(s, c);
        after += lf(s2, c);
        c += 1;
    }
    // while the source makes smoke the mass is not kept anyway; otherwise scale to what there was less what flowed out
    st(gf, F_LAST, 1.0);
    if after > 1e-12 && before > 1e-12 && li(gi, G_HOLD) == 0 {
        let out = (h * outflow(gi, gf)) / (dx * dy * dz);
        let mut f = (before - out) / after;
        let swirl = ld(gf, F_SWIRL);
        let cap = if swirl > 0.0 { SCALE_CAP * (1.0 + swirl) } else { SCALE_CAP };
        if f > 1.0 + cap {
            f = 1.0 + cap;
        } else if f < 1.0 - cap {
            f = 1.0 - cap;
        }
        if f != 1.0 {
            c = 0;
            while c < total {
                sf(s2, c, lf(s2, c) * f);
                c += 1;
            }
        }
        st(gf, F_LAST, f);
    }
}

/// `Smoke3.checkHealth`: 1 when a speed is not between -1e6 and 1e6 (or is not a number), else 0.
#[no_mangle]
pub unsafe extern "C" fn grid3_health(gi: *const i32) -> i32 {
    let n = li(gi, G_N);
    let lens = [(n + 1) * n * n, n * (n + 1) * n, n * n * (n + 1)];
    let arrays = [at(gi, G_U) as *const f32, at(gi, G_V) as *const f32, at(gi, G_W) as *const f32];
    let mut a = 0;
    while a < 3 {
        let x = arrays[a];
        let mut k = 0;
        while k < lens[a] {
            let v = lf(x, k);
            if !(v > -BLOW_UP && v < BLOW_UP) {
                return 1;
            }
            k += 1;
        }
        a += 1;
    }
    0
}

/// `hottest3`: the largest `T` (0 when none is above 0), left in `gf[F_OUT]`.
#[no_mangle]
pub unsafe extern "C" fn grid3_hottest(gi: *const i32, gf: *mut f64) {
    let t = at(gi, G_T) as *const f32;
    let total = li(gi, G_N) * li(gi, G_N) * li(gi, G_N);
    let mut m = 0.0;
    let mut c = 0;
    while c < total {
        if lf(t, c) > m {
            m = lf(t, c);
        }
        c += 1;
    }
    st(gf, F_OUT, m);
}

/// `flameCells3`: the number of cells above 500 degrees, left in `gf[F_OUT]`.
#[no_mangle]
pub unsafe extern "C" fn grid3_flames(gi: *const i32, gf: *mut f64) {
    let t = at(gi, G_T) as *const f32;
    let total = li(gi, G_N) * li(gi, G_N) * li(gi, G_N);
    let mut k = 0;
    let mut c = 0;
    while c < total {
        if lf(t, c) > FLAME_AT {
            k += 1;
        }
        c += 1;
    }
    st(gf, F_OUT, k as f64);
}

/// The sum of an array of cells in index order (`fuelSum3` and `Smoke3.mass` multiply it by the cell volume), left in
/// `gf[F_OUT]`: `slot` is `G_F` or `G_S`.
unsafe fn sum_cells(gi: *const i32, gf: *mut f64, slot: i32) {
    let a = at(gi, slot) as *const f32;
    let total = li(gi, G_N) * li(gi, G_N) * li(gi, G_N);
    let mut m = 0.0;
    let mut c = 0;
    while c < total {
        m += lf(a, c);
        c += 1;
    }
    st(gf, F_OUT, m);
}

#[no_mangle]
pub unsafe extern "C" fn grid3_fuel_sum(gi: *const i32, gf: *mut f64) {
    sum_cells(gi, gf, G_F);
}

#[no_mangle]
pub unsafe extern "C" fn grid3_smoke_sum(gi: *const i32, gf: *mut f64) {
    sum_cells(gi, gf, G_S);
}

/// `Smoke3.maxSpeed`: the fastest air speed, `Math.max` over `Math.abs` of every face (a NaN wins), left in `gf[F_OUT]`.
#[no_mangle]
pub unsafe extern "C" fn grid3_max_speed(gi: *const i32, gf: *mut f64) {
    let n = li(gi, G_N);
    let lens = [(n + 1) * n * n, n * (n + 1) * n, n * n * (n + 1)];
    let arrays = [at(gi, G_U) as *const f32, at(gi, G_V) as *const f32, at(gi, G_W) as *const f32];
    // `Math.max(m, |x|)` over every face: the largest, or NaN when any is NaN. A largest does not depend on the order, so
    // four running maxima break the chain of compares.
    let mut m = [0.0f64; 4];
    let mut nan = false;
    let mut a = 0;
    while a < 3 {
        let x = arrays[a];
        let len = lens[a];
        let mut k = 0;
        while k + 4 <= len {
            let mut r = 0usize;
            while r < 4 {
                let v = lf(x, k + r as i32).abs();
                if v > m[r] {
                    m[r] = v;
                }
                nan |= v.is_nan();
                r += 1;
            }
            k += 4;
        }
        while k < len {
            let v = lf(x, k).abs();
            if v > m[0] {
                m[0] = v;
            }
            nan |= v.is_nan();
            k += 1;
        }
        a += 1;
    }
    let mut best = m[0];
    let mut r = 1usize;
    while r < 4 {
        if m[r] > best {
            best = m[r];
        }
        r += 1;
    }
    st(gf, F_OUT, if nan { f64::NAN } else { best });
}

/**
 * Cloth (docs/features/physics/design.md 9.5, 9.6, 10.3, 11.3): sheets, ropes and nets of points joined by links,
 * stepped by extended position-based dynamics (XPBD) with small steps.
 *
 * One world step of `h` is 3 small steps of `h / 3` (4 when a cloth has `self = true`). Each small step moves the points by their speed, gravity and the
 * air, pulls every link back toward its length once in a fixed order (stretch links in red-black order, then shear,
 * then bend), holds the pins, pulls points back within reach of their pins (tethers, below), pushes the points out of
 * solids and bodies with friction, and sets each point's speed from how far it moved, less the damping. After the small
 * steps the links that stretched past `tears` break in id order, the cloth meets itself and other cloths once, and the
 * cloth may fall asleep.
 *
 * Bodies and cloth push each other both ways (design 9.6): a pin to a body and a touch between a point and a body are
 * constraints between the point and the body, with the body's inverse mass at that point. What the body would have
 * moved is added up over the small steps and given to it at the start of the next step, as a push and as a move (the
 * position-based rule: the place and the speed both change), so a ball rests on a sheet and a rope holds a weight.
 *
 * Tethers (round 9): with no `tears`, every point keeps within its start distance (times the stretch's slack) of its
 * two nearest pins. A one-way length limit per point and pin, found by builders of games for a long time, it stops a
 * hanging sheet from stretching under its own weight with one pass a small step; links still carry the shape.
 *
 * Everything is plain arithmetic on typed arrays made when the cloth is built: a step makes no garbage. Every loop runs
 * in index order, so the film is the same on every computer.
 *
 * The hot loops (the links, the tethers, the moves and speeds, a rope's chain, the air, the neighbour grid and a hull's
 * test) have a Rust twin compiled to WebAssembly (`./wasm`, design 11.6). The arrays they read live in one `KernelArena`,
 * sized when the set is built; each ported method calls its twin when there is one and otherwise runs the TypeScript loop
 * below it, which stays as the reference. Both give the same bits (design 10.2).
 */
import { NeighbourGrid3 } from './grid3';
import type { Allocator, KernelExports } from './wasm/kernels';
import { KernelArena, KP, PLAIN } from './wasm/kernels';

/** Small steps per world step (design 9.5). */
export const SUBSTEPS = 4;
/** Small steps per world step when no cloth hits itself (design 9.5): the folds of a cloth on itself need all four. */
export const SUBSTEPS_FAST = 3;
/** The most points of one sheet, of one rope, and of every cloth of a figure (design 11.3). */
export const MAX_SHEET_U = 64;
export const MAX_SHEET_V = 32;
export const MAX_SHEET = MAX_SHEET_U * MAX_SHEET_V;
export const MAX_ROPE = 400;
export const MAX_CLOTH_POINTS = 4096;
export const MAX_PINS = 64;
/** Defaults of the named arguments (design 2.4). */
export const CLOTH_DEFAULTS = Object.freeze({ mass: 1, stretch: 1, bend: 0.1, damping: 0.02, thickness: 0.02, friction: 0.4 });
/** A sheet's or net's point tether is at least this times the start distance: the 2% every check of a length allows. */
const SHEET_TETHER_MIN = 1.02;
/** A cloth whose points all move under 1 mm/s for 0.5 s sleeps (design 9.5). */
const SLEEP_SPEED = 0.001;
const SLEEP_TIME = 0.5;
const BLOW_UP = 1e6;
/** Air density, kg/m³, and the skin drag of air along a face, as a part of its push through it. */
const AIR = 1.2;
const SKIN = 0.1;
/** The width of a thread in the plane that the air pushes on, m (a rope or a net seen from the side). */
const THREAD_WIDTH = 0.05;
/** How fast stretch and bend stiffness rise with `stretch` and `bend`: rad/s of a point between two links. */
const STRETCH_OMEGA = 400;
const BEND_OMEGA = 200;
/** The grab's pull per small step: part of the way to the pointer (a stiff spring, as for bodies). */
const GRAB_PULL = 0.35;
const MAX_GRABS = 8;

export type ClothKind = 'sheet' | 'rope' | 'net';

/** The drops as the cloth meets them: the liquid's particle store, its drops' radius and their masses. */
export interface LiquidView {
  readonly ps: {
    readonly n: number;
    readonly x: Float64Array;
    readonly y: Float64Array;
    readonly z: Float64Array;
    readonly x0: Float64Array;
    readonly y0: Float64Array;
    readonly z0: Float64Array;
    readonly vx: Float64Array;
    readonly vy: Float64Array;
    readonly vz: Float64Array;
    readonly owner: Int32Array;
  };
  readonly r: number;
  /** Each owner's drop mass, kg (read from here: a call that returns a number makes a heap number). */
  readonly mass: Float64Array;
  massOf(owner: number): number;
}
export const LinkKind = { stretch: 0, shear: 1, bend: 2 } as const;

/** A pin: a point held still (body −1) or held to a body, at a point of the body's own frame. */
export interface PinDef {
  readonly point: number;
  readonly body: number;
}

/** What one cloth is made of. Points are row by row: index j × nu + i, i along u (or along the rope). */
export interface ClothDef {
  readonly kind: ClothKind;
  readonly nu: number;
  readonly nv: number;
  /** Start places, x y z for each point (z is 0 in the plane). */
  readonly pos: Float64Array;
  readonly mass: number;
  readonly stretch: number;
  readonly bend: number;
  readonly damping: number;
  /** A link breaks past this many times its length; 0: never. */
  readonly tears: number;
  readonly self: boolean;
  readonly thickness: number;
  readonly friction: number;
  readonly pins: readonly PinDef[];
}

/** One cloth's place in the shared arrays and its state. */
export interface ClothInfo {
  readonly def: ClothDef;
  readonly p0: number;
  readonly n: number;
  readonly l0: number;
  readonly ln: number;
  readonly t0: number;
  readonly tn: number;
  readonly pin0: number;
  readonly pinN: number;
  readonly te0: number;
  readonly teN: number;
  /** The first of this cloth's body tethers and how many (design 9.5). */
  readonly bt0: number;
  readonly btN: number;
  /** The first bend link (they come last). */
  readonly bend0: number;
  /** The first shear link (they come after the stretch links). */
  readonly sh0: number;
  /** A rope's first entry in the chain table. */
  readonly ch0: number;
  readonly mPt: number;
  asleep: boolean;
  sleepTime: number;
  torn: number;
  unstable: boolean;
  /** Wind seen when it fell asleep: a change wakes it. */
  windX: number;
  windY: number;
  windZ: number;
}

export class ClothSet {
  readonly dim: 2 | 3;
  readonly cloths: ClothInfo[] = [];
  /** Points: place, place at the start of the small step, place at the start of the world step, speed, inverse mass. */
  n = 0;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  sz: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  w: Float64Array;
  /** The inverse mass of each point when free (a pinned point has w = 0 or its body's). */
  w0: Float64Array;
  owner: Int32Array;
  /** Links: ends, length, compliance, kind, broken. In solve order. */
  la: Int32Array;
  lb: Int32Array;
  rest: Float64Array;
  alpha: Float64Array;
  kind: Uint8Array;
  broken: Uint8Array;
  /** The link's id (row order in its cloth), for tearing in id order and for checkpoints. */
  lid: Int32Array;
  /** Triangles (in the plane, segments: tc = −1) and the stretch links on their sides (−1 when none). */
  ta: Int32Array;
  tb: Int32Array;
  tc: Int32Array;
  te: Int32Array;
  /** Pins: point, body (−1 the world), where it is held (the world) or the point in the body's frame. */
  pinPoint: Int32Array;
  pinBody: Int32Array;
  pinX: Float64Array;
  pinY: Float64Array;
  pinZ: Float64Array;
  /** The force each pin carried in the last step (N), averaged over the small steps. */
  pinFx: Float64Array;
  pinFy: Float64Array;
  pinFz: Float64Array;
  /** The pin each point is held by, or −1. */
  pinOf: Int32Array;
  /** Points a tether held back in this small step (they pass a push on to their pins, as a pinned point does). */
  taut: Uint8Array;
  /** The air's push on each point in each small step of this step, as a change of speed. */
  afx: Float64Array;
  afy: Float64Array;
  afz: Float64Array;
  /** Tethers: point, pin, length. */
  tePoint: Int32Array;
  tePin: Int32Array;
  teRest: Float64Array;
  /** Each tether's held point and its length squared; each point's first tether (−1: none) and how many (at most 2). */
  teJ: Int32Array;
  teL2: Float64Array;
  teOf: Int32Array;
  teCnt: Uint8Array;
  /** Body tethers: the body's pin, the world pin it keeps within reach of, and the length (m). */
  btBody: Int32Array;
  btWorld: Int32Array;
  btRest: Float64Array;
  /** Small steps per world step: 4 when a cloth hits itself, else 3 (decided when the set is built, so it never changes). */
  readonly subs: number;
  /** A rope's bend links are solved every this many small steps (every second one, or once a step when the number is odd). */
  readonly ropeBendEvery: number;
  gx = 0;
  gy = 0;
  gz = -9.8;
  windX = 0;
  windY = 0;
  windZ = 0;
  /** Pushes owed to bodies (applied at the start of the next step), their turning parts and the moves. */
  bjx = new Float64Array(0);
  bjy = new Float64Array(0);
  bjz = new Float64Array(0);
  btx = new Float64Array(0);
  bty = new Float64Array(0);
  btz = new Float64Array(0);
  /** The moves bodies made in this step's small steps: tests see the body there. */
  bdx = new Float64Array(0);
  bdy = new Float64Array(0);
  bdz = new Float64Array(0);
  /** The change of speed the bodies took from the cloth in this step: they drift by it over the small steps left. */
  /** The part of the pushes owed to bodies that came through pins (the bodies took it in the small steps already). */
  pjx = new Float64Array(0);
  pjy = new Float64Array(0);
  pjz = new Float64Array(0);
  bvx = new Float64Array(0);
  bvy = new Float64Array(0);
  bvz = new Float64Array(0);
  /** The push given at the start of this step, for the force count. */
  applied = new Float64Array(0);
  /** Which bodies each cloth touched in the last step (a mark per cloth and body). */
  touched = new Uint8Array(0);
  /** Grabbed points and where the pointer is (at most MAX_GRABS at once). */
  nGrab = 0;
  readonly grabI = new Int32Array(MAX_GRABS);
  readonly grabX = new Float64Array(MAX_GRABS);
  readonly grabY = new Float64Array(MAX_GRABS);
  readonly grabZ = new Float64Array(MAX_GRABS);
  /** How far a point may move in this step (its speed, the grabs), for the searches of `prepare`. */
  protected pad = 0;
  /** Links that tore in the last step, per cloth. */
  tornNow: Int32Array;
  steps = 0;
  readonly grid = new NeighbourGrid3();
  /** Scratch for the drops' pass. */
  protected scratch = new Float64Array(16);
  /** The memory of the Rust loops, and their functions when this set runs them (undefined: the TypeScript loops run). */
  protected readonly arena: KernelArena | undefined;
  protected readonly kfn: KernelExports | undefined;

  /** True when this set runs the Rust loops (false: the TypeScript loops, because they are off, missing or the arena was too small). */
  get usesKernels(): boolean {
    return this.kfn !== undefined;
  }

  /** Where the arrays are in the arena (byte offsets), made once the set is built. */
  protected readonly ko: KOffsets;
  /** A hull's candidate points, its planes, its answer and its numbers, for the Rust test (`Cloth3`). */
  protected readonly hullIdx: Int32Array;
  protected readonly hullPl: Float64Array;
  protected readonly hullOut: Float64Array;
  protected readonly hullPar: Float64Array;
  /** The numbers a Rust call takes, written before it (`KP`): no call has a floating-point argument. */
  protected readonly kp: Float64Array;

  constructor(defs: readonly ClothDef[], dim: 2 | 3) {
    this.dim = dim;
    this.subs = defs.some((d) => d.self) ? SUBSTEPS : SUBSTEPS_FAST;
    this.ropeBendEvery = this.subs % 2 === 0 ? 2 : this.subs;
    let np = 0;
    let nl = 0;
    let nt = 0;
    let npin = 0;
    let nte = 0;
    let nbt = 0;
    let ropeTotal = 0;
    let ropeLongest = 0;
    for (const d of defs) {
      const n = d.nu * d.nv;
      np += n;
      nl += countLinks(d);
      nt += dim === 2 ? d.nv * (d.nu - 1) + d.nu * (d.nv - 1) : 2 * (d.nu - 1) * (d.nv - 1);
      npin += d.pins.length;
      if (d.tears === 0 && d.pins.length > 0) nte += n * Math.min(2, d.pins.length);
      if (d.tears === 0) {
        const nb = d.pins.filter((pd) => pd.body >= 0).length;
        nbt += nb * (d.pins.length - nb);
      }
      if (d.kind === 'rope') {
        ropeTotal += n - 1;
        ropeLongest = Math.max(ropeLongest, n);
      }
    }
    // the arrays the Rust loops touch go in one arena (design 11.6); without one they are ordinary typed arrays
    const arena = KernelArena.create(arenaBytes(np, nl, nt, npin, nte, ropeTotal, ropeLongest, dim));
    this.arena = arena;
    const M: Allocator = arena ?? PLAIN;
    if (arena) this.grid.useArena(arena, Math.max(16, np), false);
    const F = (k: number): Float64Array => new Float64Array(k);
    const I = (k: number): Int32Array => new Int32Array(k);
    // the arrays read together in the small steps are cut from one buffer, staggered (see `Stagger`)
    const P = new Stagger(np, 19, arena);
    this.x = P.f();
    this.y = P.f();
    this.z = P.f();
    this.px = P.f();
    this.py = P.f();
    this.pz = P.f();
    this.sx = P.f();
    this.sy = P.f();
    this.sz = P.f();
    this.vx = P.f();
    this.vy = P.f();
    this.vz = P.f();
    this.w = P.f();
    this.w0 = P.f();
    this.owner = M.i32(np);
    this.pinOf = P.i().fill(-1);
    this.taut = M.u8(np);
    this.afx = P.f();
    this.afy = P.f();
    this.afz = P.f();
    const L = new Stagger(nl, 6, arena);
    this.la = L.i();
    this.lb = L.i();
    this.rest = L.f();
    this.alpha = M.f64(nl);
    this.kind = new Uint8Array(nl);
    this.broken = M.u8(nl);
    this.lid = I(nl);
    this.lq = L.f();
    this.lr2 = L.f();
    this.ta = M.i32(nt);
    this.tb = M.i32(nt);
    this.tc = M.i32(nt);
    this.te = I(nt * 3).fill(-1);
    this.triCut = M.u8(nt);
    this.pinPoint = I(npin);
    this.pinBody = M.i32(npin);
    this.pinX = F(npin);
    this.pinY = F(npin);
    this.pinZ = F(npin);
    this.pinFx = M.f64(npin);
    this.pinFy = M.f64(npin);
    this.pinFz = M.f64(npin);
    this.tePoint = M.i32(nte);
    this.tePin = M.i32(nte);
    this.teRest = F(nte);
    this.teJ = M.i32(nte);
    this.teL2 = M.f64(nte);
    this.teOf = I(np).fill(-1);
    this.teCnt = new Uint8Array(np);
    this.btBody = I(nbt);
    this.btWorld = I(nbt);
    this.btRest = F(nbt);
    this.tornNow = I(defs.length);
    let p = 0;
    let l = 0;
    let t = 0;
    let pin = 0;
    let te = 0;
    defs.forEach((d, c) => {
      const n = d.nu * d.nv;
      const mPt = d.mass / n;
      const info: ClothInfo = {
        def: d, p0: p, n, l0: l, ln: 0, t0: t, tn: 0, pin0: pin, pinN: d.pins.length, te0: te, teN: 0, bt0: 0, btN: 0, ch0: 0, bend0: 0, sh0: 0, mPt,
        asleep: false, sleepTime: 0, torn: 0, unstable: false, windX: 0, windY: 0, windZ: 0,
      };
      for (let k = 0; k < n; k++) {
        const i = p + k;
        this.x[i] = d.pos[k * 3] as number;
        this.y[i] = d.pos[k * 3 + 1] as number;
        this.z[i] = d.pos[k * 3 + 2] as number;
        this.w[i] = 1 / mPt;
        this.w0[i] = 1 / mPt;
        this.owner[i] = c;
      }
      l = this.buildLinks(d, p, l, mPt);
      let b0 = info.l0;
      while (b0 < l && this.kind[b0] !== LinkKind.bend) b0++;
      (info as { bend0: number }).bend0 = b0;
      let s0 = info.l0;
      while (s0 < b0 && this.kind[s0] === LinkKind.stretch) s0++;
      (info as { sh0: number }).sh0 = s0;
      (info as { ln: number }).ln = l - info.l0;
      t = this.buildTris(d, p, t, info.l0, l);
      (info as { tn: number }).tn = t - info.t0;
      for (const pd of d.pins) {
        const i = p + pd.point;
        this.pinPoint[pin] = i;
        this.pinBody[pin] = pd.body;
        this.pinX[pin] = this.x[i] as number;
        this.pinY[pin] = this.y[i] as number;
        this.pinZ[pin] = this.z[i] as number;
        this.pinOf[i] = pin;
        if (pd.body < 0) this.w[i] = 0;
        pin++;
      }
      if (d.tears === 0 && d.pins.length > 0) {
        // each free point keeps within reach of its two nearest pins (by the start distance)
        // a sheet or net with a body pin at stretch 1 would sit at the limit of its tethers all over (flat and taut), so every
        // point is held and the body takes all the push; 2% of play stops that (a rope keeps its slack)
        const base = 1 + 2 * (1 - Math.min(1, Math.max(0, d.stretch)));
        const slack = d.kind !== 'rope' && d.pins.some((pd) => pd.body >= 0) ? Math.max(base, SHEET_TETHER_MIN) : base;
        for (let k = 0; k < n; k++) {
          const i = p + k;
          // only free points
          if (this.pinOf[i] !== -1) continue;
          let b1 = -1;
          let b2 = -1;
          let d1 = Infinity;
          let d2 = Infinity;
          for (let q = info.pin0; q < info.pin0 + info.pinN; q++) {
            const j = this.pinPoint[q] as number;
            if (j === i) continue;
            const dd = dist(this.x, this.y, this.z, i, j);
            if (dd < d1) {
              d2 = d1;
              b2 = b1;
              d1 = dd;
              b1 = q;
            } else if (dd < d2) {
              d2 = dd;
              b2 = q;
            }
          }
          for (const [q, dd] of [[b1, d1], [b2, d2]] as const) {
            if (q < 0) continue;
            this.tePoint[te] = i;
            this.tePin[te] = q;
            this.teRest[te] = dd * slack;
            this.teJ[te] = this.pinPoint[q] as number;
            this.teL2[te] = dd * slack * (dd * slack);
            if (this.teOf[i] === -1) this.teOf[i] = te;
            this.teCnt[i] = (this.teCnt[i] as number) + 1;
            te++;
          }
        }
      }
      (info as { teN: number }).teN = te - info.te0;
      this.cloths.push(info);
      p += n;
    });
    this.n = p;
    this.buildChains(M);
    this.buildBodyTethers();
    this.px.set(this.x);
    this.py.set(this.y);
    this.pz.set(this.z);
    this.sx.set(this.x);
    this.sy.set(this.y);
    this.sz.set(this.z);
    let longest = 0;
    for (let k = 0; k < l; k++) if (this.kind[k] === LinkKind.stretch) longest = Math.max(longest, this.rest[k] as number);
    this.grid.setSize(Math.max(0.02, 1.5 * longest));
    this.hullIdx = M.i32(dim === 3 ? np : 0);
    this.hullPl = M.f64(dim === 3 ? HULL_PLANES : 0);
    this.hullOut = M.f64(8);
    this.hullPar = M.f64(8);
    this.kp = M.f64(KP.size);
    // a set that did not fit its arena (it is sized with room to spare, so this does not happen) runs the TypeScript loops
    if (arena && arena.overflow) this.grid.dropArena();
    this.kfn = arena && !arena.overflow ? arena.fn : undefined;
    const at = (a: ArrayBufferView): number => a.byteOffset;
    this.ko = {
          x: at(this.x), y: at(this.y), z: at(this.z), px: at(this.px), py: at(this.py), pz: at(this.pz), sx: at(this.sx), sy: at(this.sy), sz: at(this.sz),
          vx: at(this.vx), vy: at(this.vy), vz: at(this.vz), w: at(this.w), w0: at(this.w0), pinOf: at(this.pinOf), afx: at(this.afx), afy: at(this.afy), afz: at(this.afz),
          owner: at(this.owner), taut: at(this.taut), la: at(this.la), lb: at(this.lb), rest: at(this.rest), alpha: at(this.alpha), broken: at(this.broken),
          lq: at(this.lq), lr2: at(this.lr2), ta: at(this.ta), tb: at(this.tb), tc: at(this.tc), triCut: at(this.triCut), pinBody: at(this.pinBody),
          pinFx: at(this.pinFx), pinFy: at(this.pinFy), pinFz: at(this.pinFz), tePoint: at(this.tePoint), tePin: at(this.tePin), teJ: at(this.teJ), teL2: at(this.teL2),
          chain: at(this.chain), chNx: at(this.chNx), chNy: at(this.chNy), chNz: at(this.chNz), chD: at(this.chD), chU: at(this.chU), chR: at(this.chR),
          hullIdx: at(this.hullIdx), hullPl: at(this.hullPl), hullOut: at(this.hullOut), hullPar: at(this.hullPar), kp: at(this.kp),
    };
  }

  /**
   * A body held by a pin of a cloth with no `tears` keeps within reach of each of that cloth's world pins (design 9.5, "A
   * body's tether"): along a rope, the sum of the rest lengths of the links between the two pinned points; on a sheet or
   * net, their start distance times the slack of a point's tether.
   */
  private buildBodyTethers(): void {
    let bt = 0;
    for (const info of this.cloths) {
      (info as { bt0: number }).bt0 = bt;
      if (info.def.tears === 0) {
        const slack = 1 + 2 * (1 - Math.min(1, Math.max(0, info.def.stretch)));
        const rope = info.def.kind === 'rope';
        for (let q = info.pin0; q < info.pin0 + info.pinN; q++) {
          if ((this.pinBody[q] as number) < 0) continue;
          for (let q0 = info.pin0; q0 < info.pin0 + info.pinN; q0++) {
            if ((this.pinBody[q0] as number) >= 0) continue;
            const a = this.pinPoint[q] as number;
            const c = this.pinPoint[q0] as number;
            if (a === c) continue;
            let len = 0;
            if (rope) {
              const lo = Math.min(a, c) - info.p0;
              const hi = Math.max(a, c) - info.p0;
              for (let k = lo; k < hi; k++) len += this.rest[this.chain[info.ch0 + k] as number] as number;
            } else len = dist(this.x, this.y, this.z, a, c) * slack;
            this.btBody[bt] = q;
            this.btWorld[bt] = q0;
            this.btRest[bt] = len;
            bt++;
          }
        }
      }
      (info as { btN: number }).btN = bt - info.bt0;
    }
  }

  /** The chain table of every rope: its stretch links in order along it. */
  private buildChains(M: Allocator): void {
    let total = 0;
    let longest = 0;
    for (const c of this.cloths) {
      if (c.def.kind !== 'rope') continue;
      (c as { ch0: number }).ch0 = total;
      total += c.n - 1;
      longest = Math.max(longest, c.n);
    }
    this.chain = M.i32(total);
    for (const c of this.cloths) {
      if (c.def.kind !== 'rope') continue;
      for (let l = c.l0; l < c.l0 + c.ln; l++) {
        if (this.kind[l] !== LinkKind.stretch) continue;
        const a = Math.min(this.la[l] as number, this.lb[l] as number);
        this.chain[c.ch0 + a - c.p0] = l;
      }
    }
    const F = (): Float64Array<ArrayBuffer> => M.f64(longest);
    this.chNx = F();
    this.chNy = F();
    this.chNz = F();
    this.chD = F();
    this.chU = F();
    this.chR = F();
  }

  /** The links of a cloth, in the order they are solved: stretch red-black, then shear, then bend. */
  private buildLinks(d: ClothDef, p: number, l: number, mPt: number): number {
    const { nu, nv } = d;
    const s = Math.min(1, Math.max(0, d.stretch));
    const b = Math.min(1, Math.max(0, d.bend));
    const aS = s >= 1 ? 0 : (1 - s) / (Math.max(s, 0.01) * mPt * STRETCH_OMEGA * STRETCH_OMEGA);
    const aB = b >= 1 ? 0 : (1 - b) / (Math.max(b, 1e-3) * mPt * BEND_OMEGA * BEND_OMEGA);
    const at = (i: number, j: number): number => p + j * nu + i;
    let id = 0;
    const add = (a: number, c: number, kind: number, alpha: number): void => {
      this.la[l] = a;
      this.lb[l] = c;
      this.rest[l] = dist(this.x, this.y, this.z, a, c);
      this.alpha[l] = alpha;
      this.kind[l] = kind;
      this.lid[l] = id++;
      l++;
    };
    // stretch along u, even then odd; then along v, even then odd: no two links of one batch share a point
    for (let par = 0; par < 2; par++) for (let j = 0; j < nv; j++) for (let i = par; i + 1 < nu; i += 2) add(at(i, j), at(i + 1, j), LinkKind.stretch, aS);
    for (let par = 0; par < 2; par++) for (let j = par; j + 1 < nv; j += 2) for (let i = 0; i < nu; i++) add(at(i, j), at(i, j + 1), LinkKind.stretch, aS);
    if (nv > 1) {
      // one diagonal a cell, the two kinds in a checkerboard so the cloth skews alike both ways (half the links of
      // both diagonals, for the same feel at our stiffness)
      for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) {
        if ((i + j) % 2 === 0) add(at(i, j), at(i + 1, j + 1), LinkKind.shear, aS);
        else add(at(i + 1, j), at(i, j + 1), LinkKind.shear, aS);
      }
    }
    if (b > 0) {
      for (let j = 0; j < nv; j++) for (let i = 0; i + 2 < nu; i++) add(at(i, j), at(i + 2, j), LinkKind.bend, aB);
      for (let j = 0; j + 2 < nv; j++) for (let i = 0; i < nu; i++) add(at(i, j), at(i, j + 2), LinkKind.bend, aB);
    }
    return l;
  }

  /** Triangles of a sheet (two a cell) or segments of a rope, with the stretch links on their sides. */
  private buildTris(d: ClothDef, p: number, t: number, l0: number, l1: number): number {
    const { nu, nv } = d;
    const linkOf = new Map<number, number>();
    for (let k = l0; k < l1; k++) {
      if (this.kind[k] === LinkKind.bend) continue;
      const a = this.la[k] as number;
      const b = this.lb[k] as number;
      linkOf.set(Math.min(a, b) * 8192 + Math.max(a, b), k);
    }
    const edge = (a: number, b: number): number => linkOf.get(Math.min(a, b) * 8192 + Math.max(a, b)) ?? -1;
    for (const [k, v] of linkOf) if (this.kind[v] === LinkKind.stretch) this.stretchAt.set(k, v);
    if (this.dim === 2) {
      // in the plane, the threads: every stretch link is a segment the air and the drops meet
      for (let k = l0; k < l1; k++) {
        if (this.kind[k] !== LinkKind.stretch) continue;
        this.ta[t] = this.la[k] as number;
        this.tb[t] = this.lb[k] as number;
        this.tc[t] = -1;
        this.te[t * 3] = k;
        t++;
      }
      return t;
    }
    for (let j = 0; j + 1 < nv; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const a = p + j * nu + i;
        const b = a + 1;
        const c = a + nu + 1;
        const e = a + nu;
        // two triangles a cell, split along the diagonal a–c
        this.ta[t] = a;
        this.tb[t] = b;
        this.tc[t] = c;
        this.te[t * 3] = edge(a, b);
        this.te[t * 3 + 1] = edge(b, c);
        this.te[t * 3 + 2] = edge(a, c);
        t++;
        this.ta[t] = a;
        this.tb[t] = c;
        this.tc[t] = e;
        this.te[t * 3] = edge(a, c);
        this.te[t * 3 + 1] = edge(c, e);
        this.te[t * 3 + 2] = edge(e, a);
        t++;
      }
    }
    return t;
  }

  /** True when the triangle (or segment) t has a torn side. */
  triTorn(t: number): boolean {
    return this.triCut[t] === 1;
  }

  /** Which triangles have a torn side, kept when links tear or a checkpoint loads. */
  private triCut: Uint8Array;

  private markCuts(t0: number, t1: number): void {
    for (let t = t0; t < t1; t++) {
      let cut = 0;
      for (let k = 0; k < 3; k++) {
        const e = this.te[t * 3 + k] as number;
        if (e >= 0 && this.broken[e] === 1) cut = 1;
      }
      this.triCut[t] = cut;
    }
  }

  /** Makes room for pushes owed to `nb` bodies. */
  protected sizeBodies(nb: number): void {
    if (this.bjx.length === nb) return;
    this.bjx = f64(nb);
    this.bjy = f64(nb);
    this.bjz = f64(nb);
    this.btx = f64(nb);
    this.bty = f64(nb);
    this.btz = f64(nb);
    this.bdx = f64(nb);
    this.bdy = f64(nb);
    this.bdz = f64(nb);
    this.bvx = f64(nb);
    this.bvy = f64(nb);
    this.bvz = f64(nb);
    this.pjx = f64(nb);
    this.pjy = f64(nb);
    this.pjz = f64(nb);
    this.applied = new Float64Array(nb * 3);
    this.touched = new Uint8Array(nb * Math.max(1, this.cloths.length));
    this.pinned = new Uint8Array(nb);
    for (let q = 0; q < this.pinBody.length; q++) {
      const b = this.pinBody[q] as number;
      if (b >= 0 && b < nb) this.pinned[b] = 1;
    }
  }

  /** 1 for each body that a pin holds (from the defs, so it does not depend on the last step). */
  private pinned = new Uint8Array(0);


  /* ------------------------------ hooks for the world (in the plane or in space) ------------------------------ */

  /** Where a body pin holds its point now (the body at its pose plus what it moved this step), into `out`. */
  protected anchor(_pin: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }

  /** The inverse mass of body b felt at the point `ar[11..13]` (its turn included), or 0 for a wall, into `ar[21]`. */
  protected bodyW(_b: number): void {
    this.ar[21] = 0;
  }

  /** The body's speed at the point `ar[11..13]`, into `out`. */
  protected bodyV(_b: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }

  /** Before the small steps: which points may touch which shapes this step. */
  protected prepare(): void {}

  /** Pushes the points of awake cloths out of solids and bodies, with friction (one small step). */
  protected collide(): void {}

  /** Is any body near cloth c awake and moving (it wakes the cloth)? */
  protected bodiesStir(_c: number): boolean {
    return false;
  }

  /** The air's speed at the point `ar[0..1]`: the world's wind (in the plane, smoke's flow too), into `out`. */
  protected airAt(out: Float64Array): void {
    out[0] = this.windX;
    out[1] = this.windY;
    out[2] = this.windZ;
  }

  /**
   * A point and a body met (or a pin pulled): the body takes the push J (`ar[8..10]`) at the point (x, y, z)
   * (`ar[11..13]`) at the start of the next step, moves by im J dt now (`ar[14]`: a pin or a held point moves it with
   * dt = hs; a free point, dt = 0) and drifts by im J over the small steps left, so the next small steps see it where it
   * would be. `c` is the cloth that touched it, or -1.
   */
  protected give(b: number, c: number): void {
    const a = this.ar;
    const jx = a[8] as number;
    const jy = a[9] as number;
    const jz = a[10] as number;
    const dt = a[14] as number;
    this.bjx[b] = (this.bjx[b] as number) + jx;
    this.bjy[b] = (this.bjy[b] as number) + jy;
    this.bjz[b] = (this.bjz[b] as number) + jz;
    const r = this.scratch;
    this.bodyArm(b, r);
    const rx = r[0] as number;
    const ry = r[1] as number;
    const rz = r[2] as number;
    this.btx[b] = (this.btx[b] as number) + ry * jz - rz * jy;
    this.bty[b] = (this.bty[b] as number) + rz * jx - rx * jz;
    this.btz[b] = (this.btz[b] as number) + rx * jy - ry * jx;
    this.bodyInvMass(b);
    const im = a[23] as number;
    this.bdx[b] = (this.bdx[b] as number) + im * jx * dt;
    this.bdy[b] = (this.bdy[b] as number) + im * jy * dt;
    this.bdz[b] = (this.bdz[b] as number) + im * jz * dt;
    if (this.inPins) {
      this.pjx[b] = (this.pjx[b] as number) + jx;
      this.pjy[b] = (this.pjy[b] as number) + jy;
      this.pjz[b] = (this.pjz[b] as number) + jz;
    }
    this.bvx[b] = (this.bvx[b] as number) + im * jx;
    this.bvy[b] = (this.bvy[b] as number) + im * jy;
    this.bvz[b] = (this.bvz[b] as number) + im * jz;
    if (c >= 0) this.touched[c * this.bjx.length + b] = 1;
  }

  /** The arm from body b's centre to the point `ar[11..13]`, into `out`. */
  protected bodyArm(_b: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }

  /** The inverse mass of body b (0 for a body that does not move), into `ar[23]`. */
  protected bodyInvMass(_b: number): void {
    this.ar[23] = 0;
  }

  /* ------------------------------ the step ------------------------------ */

  private anyAwake(): boolean {
    for (let c = 0; c < this.cloths.length; c++) {
      const ci = this.cloths[c] as ClothInfo;
      if (!ci.asleep && !ci.unstable) return true;
    }
    return false;
  }

  /** One world step of h: 3 (or 4) small steps of the cloth against the bodies where they are now (design 9.5, 9.6). */
  stepCloth(h: number): void {
    this.hStep = h;
    this.stepNow();
  }

  /** The same step, of `hStep` (the caller sets it: a number passed in a call is a heap number, garbage). */
  stepNow(): void {
    const h = this.hStep;
    this.steps++;
    this.bdx.fill(0);
    this.bdy.fill(0);
    this.bdz.fill(0);
    this.bvx.fill(0);
    this.bvy.fill(0);
    this.bvz.fill(0);
    this.touched.fill(0);
    this.tornNow.fill(0);
    this.pinFx.fill(0);
    this.pinFy.fill(0);
    this.pinFz.fill(0);
    const n = this.n;
    // the arrays hold exactly `n` points (`subarray(0, n)` would make a view, a garbage object, in every step)
    this.sx.set(this.x);
    this.sy.set(this.y);
    this.sz.set(this.z);
    this.wakeCheck();
    if (!this.anyAwake() && !(this.liquid && this.liquid.ps.n > 0)) {
      if (this.wet.length === this.cloths.length) this.wet.fill(0);
      return;
    }
    // how far a point may go this step: its speed, and a grab's pull
    let v2 = 0;
    let lx = Infinity;
    let ly = Infinity;
    let lz = Infinity;
    let hx = -Infinity;
    let hy = -Infinity;
    let hz = -Infinity;
    {
      const { x, y, z, vx, vy, vz } = this;
      for (let i = 0; i < n; i++) {
        const a = vx[i] as number;
        const b = vy[i] as number;
        const d = vz[i] as number;
        const s2 = a * a + b * b + d * d;
        if (s2 > v2) v2 = s2;
        const xi = x[i] as number;
        const yi = y[i] as number;
        const zi = z[i] as number;
        if (xi < lx) lx = xi;
        if (xi > hx) hx = xi;
        if (yi < ly) ly = yi;
        if (yi > hy) hy = yi;
        if (zi < lz) lz = zi;
        if (zi > hz) hz = zi;
      }
    }
    this.pad = 1.5 * h * Math.sqrt(v2) + 9.8 * h * h + (this.nGrab > 0 ? 0.5 : 0);
    // the box of every point this step (a shape outside it meets no point), and the grid, built when first asked
    this.bx0 = lx - this.pad;
    this.by0 = ly - this.pad;
    this.bz0 = lz - this.pad;
    this.bx1 = hx + this.pad;
    this.by1 = hy + this.pad;
    this.bz1 = hz + this.pad;
    this.gridOk = false;
    // drops that came near wake the cloth they meet
    this.prepareDrops();
    if (!this.anyAwake()) {
      this.nCD = 0;
      this.nDP = 0;
      return;
    }
    this.prepare();
    // (a cloth that does not hit itself, alone: nothing to find; checked here, in the code the engine has optimised, since a
    // method of its own that returns at once stays slow and boxes numbers; `subs` is SUBSTEPS only when a cloth has `self`)
    if (this.subs === SUBSTEPS || this.cloths.length > 1) this.prepareSelf();
    else this.nSelf = 0;
    const hs = h / this.subs;
    this.hsub = hs;
    // (checked here, where the engine has optimised the code: a method of its own that returns at once stays slow)
    if (this.lqHs !== hs) this.prepLinks();
    this.beginSub();
    // the air's push, once a step from the speeds at its start, felt in each small step
    for (let c = 0; c < this.cloths.length; c++) {
      const ci = this.cloths[c] as ClothInfo;
      if (!ci.asleep && !ci.unstable) this.airForces(ci);
    }
    for (let s = 0; s < this.subs; s++) {
      this.subFrac = (s + 1) / this.subs;
      this.substep(s === 0, s === this.subs - 1);
    }
    this.endSub();
    this.endDrops();
    this.keepFixed();
    // the forces on the pins, averaged over the small steps
    const inv = 1 / (this.subs * hs * hs);
    for (let q = 0; q < this.pinFx.length; q++) {
      this.pinFx[q] = (this.pinFx[q] as number) * inv;
      this.pinFy[q] = (this.pinFy[q] as number) * inv;
      this.pinFz[q] = (this.pinFz[q] as number) * inv;
    }
    this.tear();
    this.settle();
  }

  /** Moves the points of cloth c by their speed, gravity and the air (the first small step of a world step). */
  private advance(c: ClothInfo): void {
    const hs = this.hsub;
    const e = c.p0 + c.n;
    const kf = this.kfn;
    if (kf) {
      // no number is worked out here: before the engine optimises this function, every one would be a heap number
      // (garbage); the Rust loop multiplies the step by gravity itself, the same product (`hs * this.gx`)
      const o = this.ko;
      const p = this.kp;
      p[KP.hs] = hs;
      p[KP.gx] = this.gx;
      p[KP.gy] = this.gy;
      p[KP.gz] = this.gz;
      kf.advance(o.x, o.y, o.z, o.px, o.py, o.pz, o.vx, o.vy, o.vz, o.pinOf, o.afx, o.afy, o.afz, o.kp, c.p0, e);
      return;
    }
    const gx = hs * this.gx;
    const gy = hs * this.gy;
    const gz = hs * this.gz;
    const { x, y, z, px, py, pz, vx, vy, vz, pinOf, afx, afy, afz } = this;
    for (let i = c.p0; i < e; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      const zi = z[i] as number;
      px[i] = xi;
      py[i] = yi;
      pz[i] = zi;
      if ((pinOf[i] as number) >= 0) continue;
      const ux = (vx[i] as number) + gx + (afx[i] as number);
      const uy = (vy[i] as number) + gy + (afy[i] as number);
      const uz = (vz[i] as number) + gz + (afz[i] as number);
      vx[i] = ux;
      vy[i] = uy;
      vz[i] = uz;
      x[i] = xi + hs * ux;
      y[i] = yi + hs * uy;
      z[i] = zi + hs * uz;
    }
  }

  /** The speeds from the last small step's moves, less damping, then the move of this one: one pass over the points. */
  private speedsAdvance(c: ClothInfo): void {
    const hs = this.hsub;
    const e = c.p0 + c.n;
    const kf = this.kfn;
    if (kf) {
      // the Rust loop works out the step times gravity and the speeds' factor from these (see `advance`)
      const o = this.ko;
      const p = this.kp;
      p[KP.hs] = hs;
      p[KP.gx] = this.gx;
      p[KP.gy] = this.gy;
      p[KP.gz] = this.gz;
      p[KP.damp] = c.def.damping;
      kf.speeds_advance(o.x, o.y, o.z, o.px, o.py, o.pz, o.vx, o.vy, o.vz, o.pinOf, o.afx, o.afy, o.afz, o.kp, c.p0, e);
      return;
    }
    const gx = hs * this.gx;
    const gy = hs * this.gy;
    const gz = hs * this.gz;
    const k = 1 / (hs * (1 + Math.min(1, Math.max(0, c.def.damping)) * hs));
    const { x, y, z, px, py, pz, vx, vy, vz, pinOf, afx, afy, afz } = this;
    for (let i = c.p0; i < e; i++) {
      const xi = x[i] as number;
      const yi = y[i] as number;
      const zi = z[i] as number;
      let ux = (xi - (px[i] as number)) * k;
      let uy = (yi - (py[i] as number)) * k;
      let uz = (zi - (pz[i] as number)) * k;
      px[i] = xi;
      py[i] = yi;
      pz[i] = zi;
      if ((pinOf[i] as number) < 0) {
        ux += gx + (afx[i] as number);
        uy += gy + (afy[i] as number);
        uz += gz + (afz[i] as number);
        x[i] = xi + hs * ux;
        y[i] = yi + hs * uy;
        z[i] = zi + hs * uz;
      }
      vx[i] = ux;
      vy[i] = uy;
      vz[i] = uz;
    }
  }

  /** The speeds of cloth c from the moves of the small step, less damping. */
  private speeds(c: ClothInfo): void {
    const hs = this.hsub;
    const e = c.p0 + c.n;
    const kf = this.kfn;
    if (kf) {
      const o = this.ko;
      this.kp[KP.hs] = hs;
      this.kp[KP.damp] = c.def.damping;
      kf.speeds(o.x, o.y, o.z, o.px, o.py, o.pz, o.vx, o.vy, o.vz, o.kp, c.p0, e);
      return;
    }
    const k = 1 / (hs * (1 + Math.min(1, Math.max(0, c.def.damping)) * hs));
    const { x, y, z, px, py, pz, vx, vy, vz } = this;
    for (let i = c.p0; i < e; i++) {
      vx[i] = ((x[i] as number) - (px[i] as number)) * k;
      vy[i] = ((y[i] as number) - (py[i] as number)) * k;
      vz[i] = ((z[i] as number) - (pz[i] as number)) * k;
    }
  }

  private substep(first: boolean, last: boolean): void {
    const hs = this.hsub;
    const { x, y, z, w } = this;
    this.taut.fill(0);
    if (this.nCD > 0) this.moveDrops();
    // bodies held by pins take the small steps too: the world's change of their speed this step, a quarter each
    for (let k = 0; k < this.nSub; k++) {
      this.sqx[k] = this.spx[k] as number;
      this.sqy[k] = this.spy[k] as number;
      this.sqz[k] = this.spz[k] as number;
      this.svx[k] = (this.svx[k] as number) + (this.sdx[k] as number);
      this.svy[k] = (this.svy[k] as number) + (this.sdy[k] as number);
      this.svz[k] = (this.svz[k] as number) + (this.sdz[k] as number);
      this.swvx[k] = (this.swvx[k] as number) + (this.sdx[k] as number);
      this.swvy[k] = (this.swvy[k] as number) + (this.sdy[k] as number);
      this.swvz[k] = (this.swvz[k] as number) + (this.sdz[k] as number);
      // the world's own move this small step (its contacts and push-outs included), then what the cloth added to the speed
      this.spx[k] = (this.spx[k] as number) + (this.swx[k] as number) + ((this.svx[k] as number) - (this.swvx[k] as number)) * hs;
      this.spy[k] = (this.spy[k] as number) + (this.swy[k] as number) + ((this.svy[k] as number) - (this.swvy[k] as number)) * hs;
      this.spz[k] = (this.spz[k] as number) + (this.swz[k] as number) + ((this.svz[k] as number) - (this.swvz[k] as number)) * hs;
    }
    const out = this.scratch;
    // 1. the speeds from the last small step's moves (less damping), then move by speed, gravity and the air
    for (let ck = 0; ck < this.cloths.length; ck++) {
      const c = this.cloths[ck] as ClothInfo;
      if (c.asleep || c.unstable) continue;
      if (first) this.advance(c);
      else this.speedsAdvance(c);
    }
    // the pins: a world pin holds its place, a body pin goes where the body is now
    for (let q = 0; q < this.pinPoint.length; q++) {
      const i = this.pinPoint[q] as number;
      const c = this.cloths[this.owner[i] as number] as ClothInfo;
      if (c.asleep || c.unstable) continue;
      if ((this.pinBody[q] as number) < 0) {
        x[i] = this.pinX[q] as number;
        y[i] = this.pinY[q] as number;
        z[i] = this.pinZ[q] as number;
      } else {
        this.anchor(q, out);
        x[i] = out[0] as number;
        y[i] = out[1] as number;
        z[i] = out[2] as number;
        // the point stands for the body in the links: it moves as the body would
        const ab = this.ar;
        ab[11] = out[0] as number;
        ab[12] = out[1] as number;
        ab[13] = out[2] as number;
        this.bodyW(this.pinBody[q] as number);
        w[i] = ab[21] as number;
      }
    }
    // grabbed points are pulled toward the pointer
    for (let g = 0; g < this.nGrab; g++) {
      const i = this.grabI[g] as number;
      if ((w[i] as number) === 0) continue;
      x[i] = (x[i] as number) + ((this.grabX[g] as number) - (x[i] as number)) * GRAB_PULL;
      y[i] = (y[i] as number) + ((this.grabY[g] as number) - (y[i] as number)) * GRAB_PULL;
      z[i] = (z[i] as number) + ((this.grabZ[g] as number) - (z[i] as number)) * GRAB_PULL;
    }
    // 2. the links, once each, in order
    const inv2 = 1 / (hs * hs);
    for (let ck = 0; ck < this.cloths.length; ck++) {
      const c = this.cloths[ck] as ClothInfo;
      if (c.asleep || c.unstable) continue;
      if (c.def.kind === 'rope') {
        // a rope's stretch links are one chain: solved together along it, then its bend links once each
        this.linkInv2 = inv2;
        this.solveChain(c);
        if (Math.round(this.subFrac * this.subs) % this.ropeBendEvery === 0) {
          this.linkInv2 = inv2 / (this.ropeBendEvery * this.ropeBendEvery);
          this.solveLinks(c.l0 + c.n - 1, c.l0 + c.ln);
        }
      } else {
        const k = Math.round(this.subFrac * this.subs);
        // bend links once a world step, as over a small step as long as the whole step: the same stiffness for a fraction
        // of the work (shear links stay in every small step: a sheet crumpled on a post folds its cells flat without them)
        this.linkInv2 = inv2;
        this.solveLinks(c.l0, c.bend0);
        if (k === this.subs) {
          this.linkInv2 = inv2 / (this.subs * this.subs);
          this.solveLinks(c.bend0, c.l0 + c.ln);
        }
      }
      this.solveTethers(c.te0, c.te0 + c.teN);
      if (c.btN > 0) this.solveBodyTethers(c);
    }
    // 3. body pins: what the point moved, the body moves (a push now, a move at the next step)
    this.inPins = true;
    for (let q = 0; q < this.pinPoint.length; q++) {
      const b = this.pinBody[q] as number;
      if (b < 0) continue;
      const i = this.pinPoint[q] as number;
      const c = this.owner[i] as number;
      const ci = this.cloths[c] as ClothInfo;
      if (ci.asleep || ci.unstable) continue;
      this.anchor(q, out);
      const dx = (x[i] as number) - (out[0] as number);
      const dy = (y[i] as number) - (out[1] as number);
      const dz = (z[i] as number) - (out[2] as number);
      const wb = w[i] as number;
      if (wb > 0 && (dx !== 0 || dy !== 0 || dz !== 0)) {
        // Δx = w Δλ: the body takes the small steps with the cloth, so it moves with its point now (its centre by
        // Δλ / m, its turn by the push Δλ / hs about its centre at the next step), and the move counts as tension
        const sk = this.subOf[b] as number;
        const k = 1 / (wb * hs);
        this.bodyInvMass(b);
        const im = this.ar[23] as number;
        if (sk >= 0) {
          this.spx[sk] = (this.spx[sk] as number) + (dx * im) / wb;
          this.spy[sk] = (this.spy[sk] as number) + (dy * im) / wb;
          this.spz[sk] = (this.spz[sk] as number) + (dz * im) / wb;
        }
        const ar = this.ar;
        ar[8] = dx * k;
        ar[9] = dy * k;
        ar[10] = dz * k;
        ar[11] = out[0] as number;
        ar[12] = out[1] as number;
        ar[13] = out[2] as number;
        ar[14] = 0;
        this.give(b, c);
        this.pinFx[q] = (this.pinFx[q] as number) + dx / wb;
        this.pinFy[q] = (this.pinFy[q] as number) + dy / wb;
        this.pinFz[q] = (this.pinFz[q] as number) + dz / wb;
      }
      this.anchor(q, out);
      x[i] = out[0] as number;
      y[i] = out[1] as number;
      z[i] = out[2] as number;
      w[i] = 0;
    }
    this.inPins = false;
    // 4. solids and bodies, then the cloth against itself and other cloths
    this.collide();
    if (this.nDP > 0) this.solveDrops();
    if (this.nSelf > 0) this.solveSelf();
    // 5. after the last small step, the speeds from the moves, less damping (the others take theirs in step 1 of the next)
    if (last) {
      for (let ck = 0; ck < this.cloths.length; ck++) {
        const c = this.cloths[ck] as ClothInfo;
        if (c.asleep || c.unstable) continue;
        this.speeds(c);
      }
    }
    if (this.nCD > 0) this.dropSpeeds();
    for (let k = 0; k < this.nSub; k++) {
      this.svx[k] = (this.swvx[k] as number) + ((this.spx[k] as number) - (this.sqx[k] as number) - (this.swx[k] as number)) / hs;
      this.svy[k] = (this.swvy[k] as number) + ((this.spy[k] as number) - (this.sqy[k] as number) - (this.swy[k] as number)) / hs;
      this.svz[k] = (this.swvz[k] as number) + ((this.spz[k] as number) - (this.sqz[k] as number) - (this.swz[k] as number)) / hs;
    }
  }

  /* ------------------------------ bodies held by pins take the small steps (design 9.6) ------------------------------ */

  /**
   * A body held by a pin moves in the cloth's small steps, so the cloth and the body push each other with the same
   * momentum at the same moments (a heavy ball on a light rope stays on its length): it starts the step where it started
   * the world's step, with the speed it started with, gains a quarter of the world's change of its speed each small step,
   * and is moved by its pins. At the end its place and speed go back to the world.
   */
  protected nSub = 0;
  protected subOf = new Int32Array(0);
  private subB = new Int32Array(0);
  private spx = new Float64Array(0);
  private spy = new Float64Array(0);
  private spz = new Float64Array(0);
  private sqx = new Float64Array(0);
  private sqy = new Float64Array(0);
  private sqz = new Float64Array(0);
  private svx = new Float64Array(0);
  private svy = new Float64Array(0);
  private svz = new Float64Array(0);
  private sdx = new Float64Array(0);
  private sdy = new Float64Array(0);
  private sdz = new Float64Array(0);
  /** The world's move of the body in each small step (a quarter of its move in the world step) and its speed without the cloth. */
  private swx = new Float64Array(0);
  private swy = new Float64Array(0);
  private swz = new Float64Array(0);
  private swvx = new Float64Array(0);
  private swvy = new Float64Array(0);
  private swvz = new Float64Array(0);

  /** Body b's place and speed at the start of the world step, and after it (the world's hook): into out[0..11]. */
  protected bodyStep(_b: number, out: Float64Array): void {
    out.fill(0);
  }

  /** Puts body b's place (`ar[0..2]`) and speed (`ar[3..5]`) back into the world. */
  protected setBody(_b: number): void {}

  private beginSub(): void {
    const nb = this.bjx.length;
    if (this.subOf.length !== nb) {
      this.subOf = new Int32Array(nb);
      this.subB = new Int32Array(nb);
      this.spx = f64(nb);
      this.spy = f64(nb);
      this.spz = f64(nb);
      this.sqx = f64(nb);
      this.sqy = f64(nb);
      this.sqz = f64(nb);
      this.svx = f64(nb);
      this.svy = f64(nb);
      this.svz = f64(nb);
      this.sdx = f64(nb);
      this.sdy = f64(nb);
      this.sdz = f64(nb);
      this.swx = f64(nb);
      this.swy = f64(nb);
      this.swz = f64(nb);
      this.swvx = f64(nb);
      this.swvy = f64(nb);
      this.swvz = f64(nb);
    }
    this.subOf.fill(-1);
    this.nSub = 0;
    const o = this.sub12;
    for (let q = 0; q < this.pinBody.length; q++) {
      const b = this.pinBody[q] as number;
      if (b < 0 || this.subOf[b] !== -1) continue;
      this.bodyInvMass(b);
      if (!((this.ar[23] as number) > 0)) continue;
      const ci = this.cloths[this.owner[this.pinPoint[q] as number] as number] as ClothInfo;
      if (ci.asleep || ci.unstable) continue;
      const k = this.nSub++;
      this.subOf[b] = k;
      this.subB[k] = b;
      this.bodyStep(b, o);
      this.spx[k] = o[0] as number;
      this.spy[k] = o[1] as number;
      this.spz[k] = o[2] as number;
      this.svx[k] = o[3] as number;
      this.svy[k] = o[4] as number;
      this.svz[k] = o[5] as number;
      this.sdx[k] = ((o[9] as number) - (o[3] as number)) / this.subs;
      this.sdy[k] = ((o[10] as number) - (o[4] as number)) / this.subs;
      this.sdz[k] = ((o[11] as number) - (o[5] as number)) / this.subs;
      this.swx[k] = ((o[6] as number) - (o[0] as number)) / this.subs;
      this.swy[k] = ((o[7] as number) - (o[1] as number)) / this.subs;
      this.swz[k] = ((o[8] as number) - (o[2] as number)) / this.subs;
      this.swvx[k] = o[3] as number;
      this.swvy[k] = o[4] as number;
      this.swvz[k] = o[5] as number;
    }
  }

  private endSub(): void {
    const o = this.sub12;
    const io = this.keepIo;
    for (let k = 0; k < this.nSub; k++) {
      const b = this.subB[k] as number;
      // the cloth's move and speed change of the body this step, less the part that pushes it into a fixed shape it touches
      this.bodyStep(b, o);
      io[0] = (this.spx[k] as number) - (o[6] as number);
      io[1] = (this.spy[k] as number) - (o[7] as number);
      io[2] = (this.spz[k] as number) - (o[8] as number);
      io[3] = this.svx[k] as number;
      io[4] = this.svy[k] as number;
      io[5] = this.svz[k] as number;
      if (this.keepOut(b, io)) {
        this.spx[k] = (o[6] as number) + (io[0] as number);
        this.spy[k] = (o[7] as number) + (io[1] as number);
        this.spz[k] = (o[8] as number) + (io[2] as number);
        this.svx[k] = io[3] as number;
        this.svy[k] = io[4] as number;
        this.svz[k] = io[5] as number;
      }
      const as = this.ar;
      as[0] = this.spx[k] as number;
      as[1] = this.spy[k] as number;
      as[2] = this.spz[k] as number;
      as[3] = this.svx[k] as number;
      as[4] = this.svy[k] as number;
      as[5] = this.svz[k] as number;
      this.setBody(b);
    }
  }

  private sub12 = new Float64Array(12);
  protected keepIo = new Float64Array(6);

  /**
   * Keeps body b's move by the cloth out of the fixed shapes (ground, terrain, static bodies) it touches: `io` holds the
   * move (0..2) and the speed (3..5); the world's hook takes out of each the part that goes into a touching fixed shape.
   * Returns true if it changed `io`.
   */
  protected keepOut(_b: number, _io: Float64Array): boolean {
    return false;
  }

  /** Adds (dx, dy, dz) (`ar[0..2]`) to body b's speed in the world. */
  protected shiftSpeed(_b: number): void {}

  /**
   * What the cloth gave each held body this step and the world applies at the next one (a move, and a push as a change of
   * speed) goes into no fixed shape the body touches. Done here, with this step's contacts, not at the next step's start
   * (after a seek the world has no contact list until it steps), so seeking and playing give the same film. The part taken
   * out of the push is taken from the body's speed now; the next step adds the whole push back.
   */
  private keepFixed(): void {
    const io = this.keepIo;
    for (let b = 0; b < this.bjx.length; b++) {
      if (this.pinned[b] !== 1) continue;
      this.bodyInvMass(b);
      const im = this.ar[23] as number;
      if (!(im > 0)) continue;
      const dvx = im * ((this.bjx[b] as number) - (this.pjx[b] as number));
      const dvy = im * ((this.bjy[b] as number) - (this.pjy[b] as number));
      const dvz = im * ((this.bjz[b] as number) - (this.pjz[b] as number));
      io[0] = this.bdx[b] as number;
      io[1] = this.bdy[b] as number;
      io[2] = this.bdz[b] as number;
      io[3] = dvx;
      io[4] = dvy;
      io[5] = dvz;
      if (!this.keepOut(b, io)) continue;
      this.bdx[b] = io[0] as number;
      this.bdy[b] = io[1] as number;
      this.bdz[b] = io[2] as number;
      const as = this.ar;
      as[0] = (io[3] as number) - dvx;
      as[1] = (io[4] as number) - dvy;
      as[2] = (io[5] as number) - dvz;
      this.shiftSpeed(b);
    }
  }

  /** Where a body that takes the small steps is now, or undefined. */
  protected subAt(b: number, out: Float64Array): boolean {
    const k = this.subOf[b] as number;
    if (k === undefined || k < 0) return false;
    out[0] = this.spx[k] as number;
    out[1] = this.spy[k] as number;
    out[2] = this.spz[k] as number;
    return true;
  }

  /**
   * A rope's stretch links in one pass along the whole rope: the links' equations, made linear about the places now,
   * form a three-band system (each link shares a point with the one before and the one after), solved exactly in linear
   * time. One pass then reaches from one end to the other, so a rope of 400 points holds its length as a short one does
   * and carries a body a hundred times heavier than itself (a pass link by link needs hundreds of passes for both).
   */
  private solveChain(c: ClothInfo): void {
    const inv2 = this.linkInv2;
    const kf = this.kfn;
    if (kf && c.n >= 2) {
      const o = this.ko;
      this.kp[KP.inv2] = inv2;
      kf.solve_chain(o.x, o.y, o.z, o.w, o.rest, o.alpha, o.broken, o.chain + c.ch0 * 4, o.chNx, o.chNy, o.chNz, o.chD, o.chU, o.chR, c.p0, c.n, o.kp, o.pinOf, o.pinFx, o.pinFy, o.pinFz);
      return;
    }
    const { x, y, z, w, rest, alpha, broken } = this;
    const m = c.n - 1;
    const ch = this.chain;
    const nx = this.chNx;
    const ny = this.chNy;
    const nz = this.chNz;
    const dg = this.chD;
    const up = this.chU;
    const rhs = this.chR;
    const p0 = c.p0;
    for (let k = 0; k < m; k++) {
      const l = ch[c.ch0 + k] as number;
      const a = p0 + k;
      const b = a + 1;
      const dx = (x[b] as number) - (x[a] as number);
      const dy = (y[b] as number) - (y[a] as number);
      const dz = (z[b] as number) - (z[a] as number);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ws = (w[a] as number) + (w[b] as number);
      if (broken[l] === 1 || !(d > 1e-12) || ws === 0) {
        // a torn (or unmovable) link: its row stands alone and moves nothing
        nx[k] = 0;
        ny[k] = 0;
        nz[k] = 0;
        dg[k] = 1;
        rhs[k] = 0;
        continue;
      }
      nx[k] = dx / d;
      ny[k] = dy / d;
      nz[k] = dz / d;
      dg[k] = ws + (alpha[l] as number) * inv2;
      rhs[k] = (rest[l] as number) - d;
    }
    // the band beside the diagonal: links k and k + 1 share point k + 1
    for (let k = 0; k + 1 < m; k++) {
      const wb = w[p0 + k + 1] as number;
      up[k] = -wb * ((nx[k] as number) * (nx[k + 1] as number) + (ny[k] as number) * (ny[k + 1] as number) + (nz[k] as number) * (nz[k + 1] as number));
    }
    // forward sweep, then back (the Thomas method); the system is symmetric and diagonally dominant
    for (let k = 1; k < m; k++) {
      const f = (up[k - 1] as number) / (dg[k - 1] as number);
      dg[k] = (dg[k] as number) - f * (up[k - 1] as number);
      rhs[k] = (rhs[k] as number) - f * (rhs[k - 1] as number);
    }
    rhs[m - 1] = (rhs[m - 1] as number) / (dg[m - 1] as number);
    for (let k = m - 2; k >= 0; k--) rhs[k] = ((rhs[k] as number) - (up[k] as number) * (rhs[k + 1] as number)) / (dg[k] as number);
    // each point moves by its links' Δλ along their directions: Δx_k = w_k (n_{k−1} Δλ_{k−1} − n_k Δλ_k)
    for (let k = 0; k <= m; k++) {
      const i = p0 + k;
      const lb = k > 0 ? (rhs[k - 1] as number) : 0;
      const la = k < m ? (rhs[k] as number) : 0;
      const ex = (k > 0 ? (nx[k - 1] as number) * lb : 0) - (k < m ? (nx[k] as number) * la : 0);
      const ey = (k > 0 ? (ny[k - 1] as number) * lb : 0) - (k < m ? (ny[k] as number) * la : 0);
      const ez = (k > 0 ? (nz[k - 1] as number) * lb : 0) - (k < m ? (nz[k] as number) * la : 0);
      const wi = w[i] as number;
      if (wi > 0) {
        x[i] = (x[i] as number) + wi * ex;
        y[i] = (y[i] as number) + wi * ey;
        z[i] = (z[i] as number) + wi * ez;
      } else {
        const ap = this.ar;
        ap[15] = ex;
        ap[16] = ey;
        ap[17] = ez;
        this.pinForce(i);
      }
    }
  }

  /** The `inv2` (1 / h² of the small step, less for the bend links) the links in hand are solved with. */
  private linkInv2 = 0;

  /** Each rope's stretch links by place along it (segment k joins points k and k + 1), and the chain solve's scratch. */
  private chain = new Int32Array(0);
  private chNx = new Float64Array(0);
  private chNy = new Float64Array(0);
  private chNz = new Float64Array(0);
  private chD = new Float64Array(0);
  private chU = new Float64Array(0);
  private chR = new Float64Array(0);

  /**
   * Each link's factor for the fast pass: 1 / (2 r² (w_a + w_b + α / h²)) for a link between two free points, 0 for a
   * torn link or one between two held points, −1 for a link with a pinned end (the full pass, which counts the pins'
   * pulls and reads a body pin's mass now). Worked out again when the small step's length changes, a link tears or a
   * checkpoint is loaded.
   */
  private lq: Float64Array;
  private lr2: Float64Array;
  private lqHs = 0;

  private prepLinks(): void {
    const hs = this.hsub;
    this.lqHs = hs;
    const { la, lb, rest, alpha, broken, kind, pinOf, w0, lq, lr2 } = this;
    const inv2 = 1 / (hs * hs);
    let ns = 0;
    for (let k = 0; k < la.length; k++) if (broken[k] !== 1 && ((pinOf[la[k] as number] as number) >= 0 || (pinOf[lb[k] as number] as number) >= 0)) ns++;
    if (this.slowL.length < ns) this.slowL = new Int32Array(ns);
    this.nSlow = 0;
    for (let k = 0; k < la.length; k++) {
      const r = rest[k] as number;
      lr2[k] = r * r;
      const a = la[k] as number;
      const b = lb[k] as number;
      if (broken[k] === 1) lq[k] = 0;
      else if ((pinOf[a] as number) >= 0 || (pinOf[b] as number) >= 0) {
        lq[k] = -1;
        this.slowL[this.nSlow++] = k;
      }
      else {
        // as solved: a sheet's bend links once a world step, a rope's every second small step (once a step with an odd number)
        const rope = (this.cloths[this.owner[a] as number] as ClothInfo).def.kind === 'rope';
        const ev = rope ? this.ropeBendEvery : this.subs;
        const i2 = kind[k] === LinkKind.bend ? inv2 / (ev * ev) : inv2;
        const ws = (w0[a] as number) + (w0[b] as number);
        lq[k] = ws > 0 && r > 0 ? 1 / (2 * r * r * (ws + (alpha[k] as number) * i2)) : 0;
      }
    }
  }

  /**
   * One pass over links [l0, l1): XPBD with the multiplier started at 0 each small step. Between two free points the
   * length is taken to first order about the rest length, C ≈ (d² − r²) / 2r with ∇C ≈ d / r: no root and no division,
   * the same rest state (C = 0 exactly when d = r), and within 2% of the exact step while a link is within 1% of its
   * length (a cloth's links are within 2%); past 10% either way the exact step is used.
   */
  private solveLinks(l0: number, l1: number): void {
    const kf = this.kfn;
    if (kf) {
      const o = this.ko;
      kf.solve_links(o.x, o.y, o.z, o.w0, o.la, o.lb, o.lq, o.lr2, l0, l1);
    } else this.linksTs(l0, l1);
    const sl = this.slowL;
    for (let k = 0; k < this.nSlow; k++) {
      const l = sl[k] as number;
      if (l >= l0 && l < l1) this.solveLink(l);
    }
  }

  /** The fast loop of `solveLinks` in TypeScript, the reference of the Rust twin (`solve_links`). */
  private linksTs(l0: number, l1: number): void {
    const { x, y, z, w0, la, lb, lq, lr2 } = this;
    // links with a pinned end have q < 0 here and move nothing (s ≤ 0 · … is skipped below); they follow in full
    for (let k = l0; k < l1; k++) {
      const q = lq[k] as number;
      const a = la[k] as number;
      const b = lb[k] as number;
      const dx = (x[a] as number) - (x[b] as number);
      const dy = (y[a] as number) - (y[b] as number);
      const dz = (z[a] as number) - (z[b] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      const r2 = lr2[k] as number;
      let s = (r2 - d2) * q;
      if (!(d2 < 1.21 * r2 && d2 > 0.81 * r2)) s = d2 > 1e-24 ? (Math.sqrt(r2 / d2) - 1) * 2 * r2 * q : 0;
      if (!(q > 0)) continue;
      const sa = (w0[a] as number) * s;
      const sb = (w0[b] as number) * s;
      x[a] = (x[a] as number) + sa * dx;
      y[a] = (y[a] as number) + sa * dy;
      z[a] = (z[a] as number) + sa * dz;
      x[b] = (x[b] as number) - sb * dx;
      y[b] = (y[b] as number) - sb * dy;
      z[b] = (z[b] as number) - sb * dz;
    }
  }

  /** Links with a pinned end (the full pass), in id order. */
  private slowL = new Int32Array(0);
  private nSlow = 0;

  /** One link with a pinned end, in full. */
  private solveLink(k: number): void {
    const inv2 = this.linkInv2;
    const { x, y, z, w, la, lb, rest, alpha, broken } = this;
    {
      if (broken[k] === 1) return;
      const a = la[k] as number;
      const b = lb[k] as number;
      const wa = w[a] as number;
      const wb = w[b] as number;
      const ws = wa + wb;
      if (ws === 0) return;
      const dx = (x[a] as number) - (x[b] as number);
      const dy = (y[a] as number) - (y[b] as number);
      const dz = (z[a] as number) - (z[b] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 > 1e-24)) return;
      const d = Math.sqrt(d2);
      const C = d - (rest[k] as number);
      const dl = -C / (ws + (alpha[k] as number) * inv2);
      const s = dl / d;
      const ex = dx * s;
      const ey = dy * s;
      const ez = dz * s;
      if (wa > 0) {
        x[a] = (x[a] as number) + wa * ex;
        y[a] = (y[a] as number) + wa * ey;
        z[a] = (z[a] as number) + wa * ez;
      } else {
        const ap = this.ar;
        ap[15] = ex;
        ap[16] = ey;
        ap[17] = ez;
        this.pinForce(a);
      }
      if (wb > 0) {
        x[b] = (x[b] as number) - wb * ex;
        y[b] = (y[b] as number) - wb * ey;
        z[b] = (z[b] as number) - wb * ez;
      } else {
        const ap = this.ar;
        ap[15] = -ex;
        ap[16] = -ey;
        ap[17] = -ez;
        this.pinForce(b);
      }
    }
  }

  /** The pull Δλ ∇C on a point held by a world pin, added up (a force once over hs²). */
  private pinForce(i: number): void {
    const q = this.pinOf[i] as number;
    if (q < 0) return;
    const a = this.ar;
    const ex = a[15] as number;
    const ey = a[16] as number;
    const ez = a[17] as number;
    this.pinFx[q] = (this.pinFx[q] as number) + ex;
    this.pinFy[q] = (this.pinFy[q] as number) + ey;
    this.pinFz[q] = (this.pinFz[q] as number) + ez;
  }

  /**
   * Each point keeps within its tether of its pins: a one-way limit that moves only the point (the pins hold whatever
   * holds them). Tethers are only on free points, so a point's mass is its own; the held point and the length squared are
   * kept with each tether.
   */
  private solveTethers(t0: number, t1: number): void {
    const kf = this.kfn;
    if (kf) {
      const o = this.ko;
      kf.solve_tethers(o.x, o.y, o.z, o.w0, o.tePoint, o.teJ, o.teL2, o.tePin, o.pinFx, o.pinFy, o.pinFz, o.taut, t0, t1);
      return;
    }
    const { x, y, z, w0, tePoint, teJ, teL2, tePin, pinFx, pinFy, pinFz, taut } = this;
    for (let k = t0; k < t1; k++) {
      const i = tePoint[k] as number;
      const j = teJ[k] as number;
      const dx = (x[i] as number) - (x[j] as number);
      const dy = (y[i] as number) - (y[j] as number);
      const dz = (z[i] as number) - (z[j] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      const L2 = teL2[k] as number;
      if (d2 <= L2) continue;
      taut[i] = 1;
      const f = 1 - Math.sqrt(L2 / d2);
      x[i] = (x[i] as number) - f * dx;
      y[i] = (y[i] as number) - f * dy;
      z[i] = (z[i] as number) - f * dz;
      const q = tePin[k] as number;
      const m = f / (w0[i] as number);
      pinFx[q] = (pinFx[q] as number) + m * dx;
      pinFy[q] = (pinFy[q] as number) + m * dy;
      pinFz[q] = (pinFz[q] as number) + m * dz;
    }
  }

  /**
   * A body that takes the small steps keeps within its tether of the world pins: past it, its centre moves back toward the
   * pin in one move, and the move counts as the pull on that pin (a link-by-link solve cannot hold a body thousands of
   * times heavier than a point when a slack rope snaps taut). The body's pinned point goes with it, so the pull of the
   * links on the point still reaches the body at step 3.
   */
  private solveBodyTethers(c: ClothInfo): void {
    const out = this.scratch;
    const { x, y, z, pinX, pinY, pinZ, pinFx, pinFy, pinFz, spx, spy, spz } = this;
    for (let k = c.bt0; k < c.bt0 + c.btN; k++) {
      const q = this.btBody[k] as number;
      const b = this.pinBody[q] as number;
      const sk = this.subOf[b] as number;
      if (sk < 0) continue;
      const q0 = this.btWorld[k] as number;
      this.anchor(q, out);
      const dx = (pinX[q0] as number) - (out[0] as number);
      const dy = (pinY[q0] as number) - (out[1] as number);
      const dz = (pinZ[q0] as number) - (out[2] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      const L = this.btRest[k] as number;
      if (d2 <= L * L) continue;
      const f = 1 - L / Math.sqrt(d2);
      const mx = f * dx;
      const my = f * dy;
      const mz = f * dz;
      spx[sk] = (spx[sk] as number) + mx;
      spy[sk] = (spy[sk] as number) + my;
      spz[sk] = (spz[sk] as number) + mz;
      const i = this.pinPoint[q] as number;
      x[i] = (x[i] as number) + mx;
      y[i] = (y[i] as number) + my;
      z[i] = (z[i] as number) + mz;
      this.bodyInvMass(b);
      const m = 1 / (this.ar[23] as number);
      pinFx[q0] = (pinFx[q0] as number) - m * mx;
      pinFy[q0] = (pinFy[q0] as number) - m * my;
      pinFz[q0] = (pinFz[q0] as number) - m * mz;
    }
  }

  /**
   * The air on each face (in the plane, each thread): a push along its normal from how fast the air goes through it,
   * ½ ρ A (u·n)|u·n|, plus a little skin drag along it, shared by its corners. u is the air's speed less the face's.
   */
  private airForces(c: ClothInfo): void {
    const { x, y, z, vx, vy, vz, w, ta, tb, tc, afx, afy, afz } = this;
    afx.fill(0, c.p0, c.p0 + c.n);
    afy.fill(0, c.p0, c.p0 + c.n);
    afz.fill(0, c.p0, c.p0 + c.n);
    const air = this.scratch;
    const ar = this.ar;
    const t1 = c.t0 + c.tn;
    const calm = this.windX === 0 && this.windY === 0 && this.windZ === 0 && !this.hasFlow();
    if (calm && !this.stillAir) return;
    const hs = this.hsub;
    const kf = this.kfn;
    if (kf && !this.hasFlow()) {
      // a steady wind (the same at every face): the Rust loop; the air's speed that depends on the place stays below
      const o = this.ko;
      const p = this.kp;
      p[KP.hs] = hs;
      p[KP.windX] = this.windX;
      p[KP.windY] = this.windY;
      p[KP.windZ] = this.dim === 2 ? 0 : this.windZ;
      kf.air_forces(o.x, o.y, o.z, o.vx, o.vy, o.vz, o.w, o.ta, o.tb, o.tc, o.triCut, o.pinOf, o.afx, o.afy, o.afz, c.t0, t1, o.kp);
      return;
    }
    for (let t = c.t0; t < t1; t++) {
      if (this.triTorn(t)) continue;
      const a = ta[t] as number;
      const b = tb[t] as number;
      const e = tc[t] as number;
      let nx: number;
      let ny: number;
      let nz: number;
      let ux: number;
      let uy: number;
      let uz: number;
      let share: number;
      let q = -1;
      if (e >= 0 && ((t - c.t0) & 1) === 0 && t + 1 < t1 && !this.triTorn(t + 1)) {
        // a whole cell (its two faces): the area along its normal is half the cross of its diagonals
        q = tc[t + 1] as number;
        const dax = (x[e] as number) - (x[a] as number);
        const day = (y[e] as number) - (y[a] as number);
        const daz = (z[e] as number) - (z[a] as number);
        const dbx = (x[q] as number) - (x[b] as number);
        const dby = (y[q] as number) - (y[b] as number);
        const dbz = (z[q] as number) - (z[b] as number);
        nx = 0.5 * (day * dbz - daz * dby);
        ny = 0.5 * (daz * dbx - dax * dbz);
        nz = 0.5 * (dax * dby - day * dbx);
        ar[0] = x[a] as number;
        ar[1] = y[a] as number;
        this.airAt(air);
        ux = (air[0] as number) - 0.25 * ((vx[a] as number) + (vx[b] as number) + (vx[e] as number) + (vx[q] as number));
        uy = (air[1] as number) - 0.25 * ((vy[a] as number) + (vy[b] as number) + (vy[e] as number) + (vy[q] as number));
        uz = (air[2] as number) - 0.25 * ((vz[a] as number) + (vz[b] as number) + (vz[e] as number) + (vz[q] as number));
        share = 0.25;
        t++;
      } else if (e < 0) {
        // a thread in the plane: its normal in the plane, as long as it is, as wide as a thread
        const dx = (x[b] as number) - (x[a] as number);
        const dy = (y[b] as number) - (y[a] as number);
        nx = -dy * THREAD_WIDTH;
        ny = dx * THREAD_WIDTH;
        nz = 0;
        ar[0] = 0.5 * ((x[a] as number) + (x[b] as number));
        ar[1] = 0.5 * ((y[a] as number) + (y[b] as number));
        this.airAt(air);
        ux = (air[0] as number) - 0.5 * ((vx[a] as number) + (vx[b] as number));
        uy = (air[1] as number) - 0.5 * ((vy[a] as number) + (vy[b] as number));
        uz = 0;
        share = 0.5;
      } else {
        const abx = (x[b] as number) - (x[a] as number);
        const aby = (y[b] as number) - (y[a] as number);
        const abz = (z[b] as number) - (z[a] as number);
        const acx = (x[e] as number) - (x[a] as number);
        const acy = (y[e] as number) - (y[a] as number);
        const acz = (z[e] as number) - (z[a] as number);
        // twice the area, along the normal
        nx = 0.5 * (aby * acz - abz * acy);
        ny = 0.5 * (abz * acx - abx * acz);
        nz = 0.5 * (abx * acy - aby * acx);
        ar[0] = x[a] as number;
        ar[1] = y[a] as number;
        this.airAt(air);
        ux = (air[0] as number) - ((vx[a] as number) + (vx[b] as number) + (vx[e] as number)) / 3;
        uy = (air[1] as number) - ((vy[a] as number) + (vy[b] as number) + (vy[e] as number)) / 3;
        uz = (air[2] as number) - ((vz[a] as number) + (vz[b] as number) + (vz[e] as number)) / 3;
        share = 1 / 3;
      }
      // N = A n̂: the push is ½ ρ (u·N)|u·N| N / |N|³ × |N|² ... = ½ ρ (u·N)|u·N| / |N|² × N
      const A2 = nx * nx + ny * ny + nz * nz;
      if (!(A2 > 1e-20)) continue;
      const un = ux * nx + uy * ny + uz * nz;
      const k = (0.5 * AIR * un * Math.abs(un)) / A2;
      let fx = k * nx;
      let fy = k * ny;
      let fz = k * nz;
      // skin drag along the face: ½ ρ SKIN A |u_t| u_t
      const A = Math.sqrt(A2);
      const s = un / A2;
      const tx = ux - s * nx;
      const ty = uy - s * ny;
      const tz = uz - s * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const ks = 0.5 * AIR * SKIN * A * tl;
      fx += ks * tx;
      fy += ks * ty;
      fz += ks * tz;
      fx *= share * hs;
      fy *= share * hs;
      fz *= share * hs;
      for (let k = 0; k < 4; k++) {
        const i = k === 0 ? a : k === 1 ? b : k === 2 ? e : q;
        if (i < 0) continue;
        const wi = w[i] as number;
        if (wi === 0 || (this.pinOf[i] as number) >= 0) continue;
        afx[i] = (afx[i] as number) + wi * fx;
        afy[i] = (afy[i] as number) + wi * fy;
        afz[i] = (afz[i] as number) + wi * fz;
      }
    }
  }

  /* ------------------------------ the cloth against itself and other cloths (design 9.6) ------------------------------ */

  /** Point and face pairs that may meet this step (found once a step on the grid), and the side each point was on. */
  protected nSelf = 0;
  private selfP = new Int32Array(0);
  private selfT = new Int32Array(0);
  private selfS = new Float64Array(0);
  private selfH = new Float64Array(0);

  private pushSelf(i: number, t: number, side: number, th: number): void {
    if (this.nSelf >= this.selfP.length) {
      const cap = Math.max(256, this.selfP.length * 2);
      const P = new Int32Array(cap);
      P.set(this.selfP);
      const T = new Int32Array(cap);
      T.set(this.selfT);
      const S = new Float64Array(cap);
      S.set(this.selfS);
      const Th = new Float64Array(cap);
      Th.set(this.selfH);
      this.selfP = P;
      this.selfT = T;
      this.selfS = S;
      this.selfH = Th;
    }
    this.selfP[this.nSelf] = i;
    this.selfT[this.nSelf] = t;
    this.selfS[this.nSelf] = side;
    this.selfH[this.nSelf] = th;
    this.nSelf++;
  }

  /** Each point's place in its cloth's grid (i along u, j along v), for telling neighbours apart by index. */
  private pu = new Int32Array(0);
  private pv = new Int32Array(0);
  /**
   * Tiles: blocks of 8 × 8 points of a cloth (8 points of a rope), each with the box of its points at the start of the
   * step. Faces of one cloth look for points of another only where a tile of it is near, so two cloths apart cost a box
   * test a face pair.
   */
  private tileOf = new Int32Array(0);
  private tile0 = new Int32Array(0);
  private tileN = new Int32Array(0);
  private tileBox = new Float64Array(0);
  /** The other cloths' tiles near the cloth whose faces are being searched. */
  private near = new Int32Array(0);

  private buildTiles(): void {
    const n = this.n;
    this.pu = new Int32Array(n);
    this.pv = new Int32Array(n);
    this.tileOf = new Int32Array(n);
    const count = this.cloths.length;
    this.tile0 = new Int32Array(count);
    this.tileN = new Int32Array(count);
    let nt = 0;
    for (let c = 0; c < count; c++) {
      const ci = this.cloths[c] as ClothInfo;
      const { nu, nv } = ci.def;
      const tu = Math.ceil(nu / 8);
      const tv = Math.ceil(nv / 8);
      this.tile0[c] = nt;
      this.tileN[c] = tu * tv;
      for (let k = 0; k < ci.n; k++) {
        const i = k % nu;
        const j = (k - i) / nu;
        this.pu[ci.p0 + k] = i;
        this.pv[ci.p0 + k] = j;
        this.tileOf[ci.p0 + k] = nt + ((j >> 3) * tu + (i >> 3));
      }
      nt += tu * tv;
    }
    this.tileBox = new Float64Array(nt * 6);
    this.near = new Int32Array(nt);
  }

  private tilesAt = -1;

  /** The tiles, and their boxes for this step (once a step). */
  private ensureTiles(): void {
    if (this.pu.length !== this.n) this.buildTiles();
    if (this.tilesAt === this.steps) return;
    this.tilesAt = this.steps;
    this.tileBoxes();
  }

  /** The tiles' boxes from the points now. */
  private tileBoxes(): void {
    const b = this.tileBox;
    for (let k = 0; k < b.length; k += 6) {
      b[k] = Infinity;
      b[k + 1] = Infinity;
      b[k + 2] = Infinity;
      b[k + 3] = -Infinity;
      b[k + 4] = -Infinity;
      b[k + 5] = -Infinity;
    }
    const { x, y, z, tileOf } = this;
    for (let i = 0; i < this.n; i++) {
      const k = (tileOf[i] as number) * 6;
      const xi = x[i] as number;
      const yi = y[i] as number;
      const zi = z[i] as number;
      if (xi < (b[k] as number)) b[k] = xi;
      if (yi < (b[k + 1] as number)) b[k + 1] = yi;
      if (zi < (b[k + 2] as number)) b[k + 2] = zi;
      if (xi > (b[k + 3] as number)) b[k + 3] = xi;
      if (yi > (b[k + 4] as number)) b[k + 4] = yi;
      if (zi > (b[k + 5] as number)) b[k + 5] = zi;
    }
  }

  /** Does tile k's box come within m of the box (lx..hx)? */
  private tileMeets(k: number, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, m: number): boolean {
    const b = this.tileBox;
    const o = k * 6;
    return (b[o] as number) <= hx + m && (b[o + 3] as number) >= lx - m && (b[o + 1] as number) <= hy + m && (b[o + 4] as number) >= ly - m && (b[o + 2] as number) <= hz + m && (b[o + 5] as number) >= lz - m;
  }

  /**
   * The point and face pairs of this step: self hits on a cloth with `self`, and every pair of different cloths. A
   * sheet's two faces of a cell share one search of the grid, made only when the cloth hits itself or a tile of another
   * cloth is near; a point of the same cloth beside the cell (one point round it, by index) never counts.
   */
  private prepareSelf(): void {
    this.nSelf = 0;
    const count = this.cloths.length;
    let any = false;
    for (let c = 0; c < count; c++) if ((this.cloths[c] as ClothInfo).def.self) any = true;
    if (!any && count < 2) return;
    this.ensureTiles();
    const { x, y, z, sx, sy, sz, pu, pv, ta, tb, tc, owner, w } = this;
    const fn = this.faceN;
    const tb6 = this.tileBox;
    for (let c = 0; c < count; c++) {
      const A = this.cloths[c] as ClothInfo;
      if (A.unstable) continue;
      const t1 = A.t0 + A.tn;
      const reach = A.def.thickness + this.pad;
      const self = A.def.self;
      // the other cloths' tiles near this cloth (its own tiles' boxes, joined)
      let nNear = 0;
      const k0 = this.tile0[c] as number;
      const k1 = k0 + (this.tileN[c] as number);
      let lx = Infinity;
      let ly = Infinity;
      let lz = Infinity;
      let hx = -Infinity;
      let hy = -Infinity;
      let hz = -Infinity;
      for (let k = k0; k < k1; k++) {
        lx = Math.min(lx, tb6[k * 6] as number);
        ly = Math.min(ly, tb6[k * 6 + 1] as number);
        lz = Math.min(lz, tb6[k * 6 + 2] as number);
        hx = Math.max(hx, tb6[k * 6 + 3] as number);
        hy = Math.max(hy, tb6[k * 6 + 4] as number);
        hz = Math.max(hz, tb6[k * 6 + 5] as number);
      }
      const m = 2 * reach + 0.01;
      for (let oc = 0; oc < count; oc++) {
        if (oc === c) continue;
        const B = this.cloths[oc] as ClothInfo;
        if (B.unstable || (A.asleep && B.asleep)) continue;
        const q0 = this.tile0[oc] as number;
        const q1 = q0 + (this.tileN[oc] as number);
        for (let k = q0; k < q1; k++) if (this.tileMeets(k, lx, ly, lz, hx, hy, hz, m)) this.near[nNear++] = k;
      }
      if (!self && nNear === 0) continue;
      const sheet = A.def.kind === 'sheet';
      for (let t = A.t0; t < t1; t += sheet ? 2 : 1) {
        const tt = sheet && t + 1 < t1 ? 2 : 1;
        let fx0 = Infinity;
        let fy0 = Infinity;
        let fz0 = Infinity;
        let fx1 = -Infinity;
        let fy1 = -Infinity;
        let fz1 = -Infinity;
        let i0 = 1 << 30;
        let i1 = -1;
        let j0 = 1 << 30;
        let j1 = -1;
        for (let f = 0; f < tt; f++) {
          const u = t + f;
          for (let k = 0; k < 3; k++) {
            const v = k === 0 ? (ta[u] as number) : k === 1 ? (tb[u] as number) : (tc[u] as number);
            if (v < 0) continue;
            const xv = x[v] as number;
            const yv = y[v] as number;
            const zv = z[v] as number;
            if (xv < fx0) fx0 = xv;
            if (yv < fy0) fy0 = yv;
            if (zv < fz0) fz0 = zv;
            if (xv > fx1) fx1 = xv;
            if (yv > fy1) fy1 = yv;
            if (zv > fz1) fz1 = zv;
            const iv = pu[v] as number;
            const jv = pv[v] as number;
            if (iv < i0) i0 = iv;
            if (iv > i1) i1 = iv;
            if (jv < j0) j0 = jv;
            if (jv > j1) j1 = jv;
          }
        }
        if (!self) {
          let meets = false;
          for (let q = 0; q < nNear && !meets; q++) meets = this.tileMeets(this.near[q] as number, fx0, fy0, fz0, fx1, fy1, fz1, reach);
          if (!meets) continue;
        }
        let live = 0;
        for (let f = 0; f < tt; f++) {
          const u = t + f;
          if (this.triTorn(u)) {
            fn[f * 4] = 0;
            fn[f * 4 + 1] = 0;
            fn[f * 4 + 2] = 0;
            continue;
          }
          // the face's plane at the start of the step, once for all the points near it
          const ah = this.ar;
          ah[18] = 0;
          ah[19] = 0;
          ah[20] = 0;
          this.faceHeight(u, sx, sy, sz);
          fn[f * 4 + 3] = this.scratch[6] as number;
          fn[f * 4] = this.scratch[0] as number;
          fn[f * 4 + 1] = this.scratch[1] as number;
          fn[f * 4 + 2] = this.scratch[2] as number;
          if (fn[f * 4] !== 0 || fn[f * 4 + 1] !== 0 || fn[f * 4 + 2] !== 0) live++;
        }
        if (live === 0) continue;
        i0--;
        i1++;
        j0--;
        j1++;
        const ag = this.ar;
        ag[0] = fx0 - reach;
        ag[1] = fy0 - reach;
        ag[2] = fz0 - reach;
        ag[3] = fx1 + reach;
        ag[4] = fy1 + reach;
        ag[5] = fz1 + reach;
        const mm = this.inGrid();
        const found = this.grid.found;
        for (let q = 0; q < mm; q++) {
          const i = found[q] as number;
          const oc = owner[i] as number;
          if (oc === c) {
            if (!self) continue;
            // beside the cell by index: a neighbour, never a hit
            const pi = pu[i] as number;
            const pj = pv[i] as number;
            if (pi >= i0 && pi <= i1 && pj >= j0 && pj <= j1) continue;
          }
          const B = this.cloths[oc] as ClothInfo;
          if ((A.asleep && B.asleep) || B.unstable) continue;
          const th = 0.5 * (A.def.thickness + B.def.thickness);
          const sxi = sx[i] as number;
          const syi = sy[i] as number;
          const szi = sz[i] as number;
          for (let f = 0; f < tt; f++) {
            const u = t + f;
            const fnx = fn[f * 4] as number;
            const fny = fn[f * 4 + 1] as number;
            const fnz = fn[f * 4 + 2] as number;
            if (fnx === 0 && fny === 0 && fnz === 0) continue;
            // the side of the face the point was on at the start of the step, near its plane and over it
            const s0 = fnx * sxi + fny * syi + fnz * szi + (fn[f * 4 + 3] as number);
            if (Math.abs(s0) > th + 2 * this.pad + 0.01) continue;
            const a = ta[u] as number;
            const b = tb[u] as number;
            const e = tc[u] as number;
            if ((w[i] as number) === 0 && (w[a] as number) === 0 && (w[b] as number) === 0 && (e < 0 || (w[e] as number) === 0)) continue;
            const af = this.ar;
            af[18] = sxi - s0 * fnx;
            af[19] = syi - s0 * fny;
            af[20] = szi - s0 * fnz;
            af[22] = 0.25;
            if (!this.footOn(u)) continue;
            this.pushSelf(i, u, s0 >= 0 ? 1 : -1, th);
          }
        }
      }
    }
  }

  /** The box of every point at the start of this step, padded by how far a point may go in it. */
  protected bx0 = 0;
  protected by0 = 0;
  protected bz0 = 0;
  protected bx1 = 0;
  protected by1 = 0;
  protected bz1 = 0;
  private gridOk = false;

  /**
   * The points whose grid cell meets the box, into `grid.found`: none when the box misses every point's box (the grid is
   * then never built this step), else from the grid, built on the first ask of the step.
   */
  protected inGrid(): number {
    const a = this.ar;
    const x0 = a[0] as number;
    const y0 = a[1] as number;
    const z0 = a[2] as number;
    const x1 = a[3] as number;
    const y1 = a[4] as number;
    const z1 = a[5] as number;
    if (x0 > this.bx1 || x1 < this.bx0 || y0 > this.by1 || y1 < this.by0 || z0 > this.bz1 || z1 < this.bz0) return 0;
    if (!this.gridOk) {
      this.grid.build(this.x, this.y, this.z, this.n);
      this.gridOk = true;
    }
    const box = this.grid.box;
    box[0] = x0;
    box[1] = y0;
    box[2] = z0;
    box[3] = x1;
    box[4] = y1;
    box[5] = z1;
    return this.grid.inBox(this.n);
  }

  /** The planes of the faces of one search (scratch for prepareSelf). */
  private faceN = new Float64Array(8);

  /**
   * Face t's unit normal (a segment's, in the plane) into scratch 0..2, and the height of the point `ar[18..20]` over it
   * (as the places X, Y, Z have the face) into scratch 6.
   */
  protected faceHeight(t: number, X: Float64Array, Y: Float64Array, Z: Float64Array): void {
    const q = this.ar;
    const px = q[18] as number;
    const py = q[19] as number;
    const pz = q[20] as number;
    const a = this.ta[t] as number;
    const b = this.tb[t] as number;
    const e = this.tc[t] as number;
    const o = this.scratch;
    const ax = X[a] as number;
    const ay = Y[a] as number;
    const az = Z[a] as number;
    let nx: number;
    let ny: number;
    let nz: number;
    if (e < 0) {
      nx = -((Y[b] as number) - ay);
      ny = (X[b] as number) - ax;
      nz = 0;
    } else {
      const ux = (X[b] as number) - ax;
      const uy = (Y[b] as number) - ay;
      const uz = (Z[b] as number) - az;
      const vx = (X[e] as number) - ax;
      const vy = (Y[e] as number) - ay;
      const vz = (Z[e] as number) - az;
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(l > 1e-18)) {
      o[0] = 0;
      o[1] = 0;
      o[2] = 0;
      o[6] = 0;
      return;
    }
    o[0] = nx / l;
    o[1] = ny / l;
    o[2] = nz / l;
    o[6] = (o[0] as number) * (px - ax) + (o[1] as number) * (py - ay) + (o[2] as number) * (pz - az);
  }

  /** The corners' weights of the point `ar[18..20]` on face t's plane (into scratch 3..5), true when it is on the face (with the margin `ar[22]`). */
  protected footOn(t: number): boolean {
    const { x, y, z } = this;
    const q = this.ar;
    const px = q[18] as number;
    const py = q[19] as number;
    const pz = q[20] as number;
    const margin = q[22] as number;
    const o = this.scratch;
    const a = this.ta[t] as number;
    const b = this.tb[t] as number;
    const e = this.tc[t] as number;
    const qx = px - (x[a] as number);
    const qy = py - (y[a] as number);
    const qz = pz - (z[a] as number);
    const ux = (x[b] as number) - (x[a] as number);
    const uy = (y[b] as number) - (y[a] as number);
    const uz = (z[b] as number) - (z[a] as number);
    if (e < 0) {
      const l2 = ux * ux + uy * uy + uz * uz;
      if (!(l2 > 0)) return false;
      const f = (qx * ux + qy * uy + qz * uz) / l2;
      o[3] = 1 - f;
      o[4] = f;
      o[5] = 0;
      return f >= -margin && f <= 1 + margin;
    }
    const vx = (x[e] as number) - (x[a] as number);
    const vy = (y[e] as number) - (y[a] as number);
    const vz = (z[e] as number) - (z[a] as number);
    const d00 = ux * ux + uy * uy + uz * uz;
    const d01 = ux * vx + uy * vy + uz * vz;
    const d11 = vx * vx + vy * vy + vz * vz;
    const d20 = qx * ux + qy * uy + qz * uz;
    const d21 = qx * vx + qy * vy + qz * vz;
    const den = d00 * d11 - d01 * d01;
    if (!(den > 0)) return false;
    const fb = (d11 * d20 - d01 * d21) / den;
    const fe = (d00 * d21 - d01 * d20) / den;
    o[3] = 1 - fb - fe;
    o[4] = fb;
    o[5] = fe;
    return fb >= -margin && fe >= -margin && fb + fe <= 1 + margin;
  }

  /**
   * Each point keeps `thickness` from the faces near it, on the side it started the step on, so a falling sheet folds
   * over itself instead of passing through: the point and the face's corners move apart by their masses.
   */
  private solveSelf(): void {
    const { x, y, z, w } = this;
    const o = this.scratch;
    for (let k = 0; k < this.nSelf; k++) {
      const i = this.selfP[k] as number;
      const t = this.selfT[k] as number;
      const side = this.selfS[k] as number;
      const th = this.selfH[k] as number;
      const ah = this.ar;
      ah[18] = x[i] as number;
      ah[19] = y[i] as number;
      ah[20] = z[i] as number;
      this.faceHeight(t, x, y, z);
      const s = o[6] as number;
      const nx = o[0] as number;
      const ny = o[1] as number;
      const nz = o[2] as number;
      if (nx === 0 && ny === 0 && nz === 0) continue;
      // a point found on the other side by more than the thickness was not this face's to hold (it went round an edge,
      // or the face swung past it): it is left alone, so a wrong side can never fling the cloth
      if (s * side < -th) continue;
      const C = th - s * side;
      if (!(C > 0)) continue;
      // the foot of the point must be on the face (a neighbouring face takes it otherwise)
      ah[18] = (x[i] as number) - s * nx;
      ah[19] = (y[i] as number) - s * ny;
      ah[20] = (z[i] as number) - s * nz;
      ah[22] = 1e-9;
      if (!this.footOn(t)) continue;
      const a = this.ta[t] as number;
      const b = this.tb[t] as number;
      const e = this.tc[t] as number;
      const ba = o[3] as number;
      const bb = o[4] as number;
      const be = o[5] as number;
      const wi = w[i] as number;
      const W = wi + ba * ba * (w[a] as number) + bb * bb * (w[b] as number) + (e >= 0 ? be * be * (w[e] as number) : 0);
      if (!(W > 0)) continue;
      const dl = (C / W) * side;
      if (wi > 0) {
        x[i] = (x[i] as number) + wi * dl * nx;
        y[i] = (y[i] as number) + wi * dl * ny;
        z[i] = (z[i] as number) + wi * dl * nz;
      }
      for (let q = 0; q < 3; q++) {
        const j = q === 0 ? a : q === 1 ? b : e;
        const bj = q === 0 ? ba : q === 1 ? bb : be;
        if (j < 0) continue;
        const wj = w[j] as number;
        if (wj === 0) continue;
        x[j] = (x[j] as number) - wj * bj * dl * nx;
        y[j] = (y[j] as number) - wj * bj * dl * ny;
        z[j] = (z[j] as number) - wj * bj * dl * nz;
      }
    }
  }

  /* ------------------------------ liquid drops against the cloth (design 9.6) ------------------------------ */

  /**
   * Drops meet the cloth inside its small steps (round 9C). After the liquid's step, the drops near a face are found once
   * (the nearest cloth point to the drop, then its faces), and each such drop takes the cloth's small steps with it: it
   * goes back to where the liquid step began it and moves along that step's path in four parts, and in each small step
   * the drop and the face's corners share the push that keeps the drop `r + thickness` from the face, on the side it
   * started on, by their masses. A face with a held corner (a pin, or a tether at its length) does not give: the drop
   * takes the whole push and the pins carry it. So a sheet holds water, and the water's weight reaches the pins in the
   * same small steps as the sheet's own. At the end a drop still across its face goes back whole, so none passes.
   */
  private liquid: LiquidView | undefined;
  /** Which cloths drops met in this step (it wakes them). */
  private wet = new Uint8Array(0);
  /** How many drop and face pairs the cloth has met since the world began (for tests). */
  meets = 0;
  /** Drops taking the small steps: the drop, its place, its place at the start of the small step, its speed, 1 / mass. */
  private nCD = 0;
  private cdI = new Int32Array(0);
  private cpx = new Float64Array(0);
  private cpy = new Float64Array(0);
  private cpz = new Float64Array(0);
  private cqx = new Float64Array(0);
  private cqy = new Float64Array(0);
  private cqz = new Float64Array(0);
  private cvx = new Float64Array(0);
  private cvy = new Float64Array(0);
  private cvz = new Float64Array(0);
  private cw = new Float64Array(0);
  /** Pairs: the drop (its place in the lists above), the face, the side, the corners' weights, the normal, the reach. */
  private nDP = 0;
  private dpK = new Int32Array(0);
  private dpT = new Int32Array(0);
  private dpS = new Float64Array(0);
  private dpB = new Float64Array(0);
  private dpN = new Float64Array(0);
  private dpR = new Float64Array(0);
  /** Each drop's place in the lists, valid when its mark is this step's. */
  private dropMark = new Int32Array(0);
  private dropSlot = new Int32Array(0);
  private dropStamp = 0;
  /** Faces seen for the drop being searched (a mark per face). */
  private faceSeen = new Int32Array(0);
  private faceStamp = 0;
  /** Each face's plane and the numbers for the foot of a point on it, at the start of the step (14 a face). */
  private faceTab = new Float64Array(0);
  private faceTabOk = new Uint8Array(0);
  /** Each point's faces (the triangles, or in the plane the threads, it is a corner of). */
  private pf0 = new Int32Array(0);
  private pfT = new Int32Array(0);

  /** The liquid the cloth meets this step (the drivers set it before each cloth step), or none. */
  useDrops(liquid: LiquidView | undefined): void {
    this.liquid = liquid;
  }

  private buildPointFaces(): void {
    const n = this.n;
    const nt = this.ta.length;
    const cnt = new Int32Array(n + 1);
    for (let t = 0; t < nt; t++) {
      cnt[this.ta[t] as number] = (cnt[this.ta[t] as number] as number) + 1;
      cnt[this.tb[t] as number] = (cnt[this.tb[t] as number] as number) + 1;
      const e = this.tc[t] as number;
      if (e >= 0) cnt[e] = (cnt[e] as number) + 1;
    }
    this.pf0 = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) this.pf0[i + 1] = (this.pf0[i] as number) + (cnt[i] as number);
    this.pfT = new Int32Array(this.pf0[n] as number);
    const fill = Int32Array.from(this.pf0.subarray(0, n));
    for (let t = 0; t < nt; t++) {
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? (this.ta[t] as number) : k === 1 ? (this.tb[t] as number) : (this.tc[t] as number);
        if (v < 0) continue;
        this.pfT[fill[v] as number] = t;
        fill[v] = (fill[v] as number) + 1;
      }
    }
    this.faceSeen = new Int32Array(nt);
    this.faceTab = new Float64Array(nt * 14);
    this.faceTabOk = new Uint8Array(this.cloths.length);
  }

  /** Cloth c's faces' planes and foot numbers from the points now: normal, offset, the two sides from the first corner, d00 d01 d11 and 1 / det. */
  private faceTable(c: number): void {
    const ci = this.cloths[c] as ClothInfo;
    const { x, y, z, ta, tb, tc } = this;
    const F = this.faceTab;
    for (let t = ci.t0; t < ci.t0 + ci.tn; t++) {
      const o = t * 14;
      const a = ta[t] as number;
      const b = tb[t] as number;
      const e = tc[t] as number;
      const ax = x[a] as number;
      const ay = y[a] as number;
      const az = z[a] as number;
      const ux = (x[b] as number) - ax;
      const uy = (y[b] as number) - ay;
      const uz = (z[b] as number) - az;
      F[o] = 0;
      F[o + 1] = 0;
      F[o + 2] = 0;
      if (this.triTorn(t)) continue;
      if (e < 0) {
        const l2 = ux * ux + uy * uy;
        if (!(l2 > 1e-24)) continue;
        const l = Math.sqrt(l2);
        F[o] = -uy / l;
        F[o + 1] = ux / l;
        F[o + 3] = (F[o] as number) * ax + (F[o + 1] as number) * ay;
        F[o + 4] = ux;
        F[o + 5] = uy;
        F[o + 6] = 0;
        F[o + 13] = 1 / l2;
        continue;
      }
      const vx = (x[e] as number) - ax;
      const vy = (y[e] as number) - ay;
      const vz = (z[e] as number) - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const d00 = ux * ux + uy * uy + uz * uz;
      const d01 = ux * vx + uy * vy + uz * vz;
      const d11 = vx * vx + vy * vy + vz * vz;
      const den = d00 * d11 - d01 * d01;
      if (!(l > 1e-18) || !(den > 0)) continue;
      F[o] = nx / l;
      F[o + 1] = ny / l;
      F[o + 2] = nz / l;
      F[o + 3] = (F[o] as number) * ax + (F[o + 1] as number) * ay + (F[o + 2] as number) * az;
      F[o + 4] = ux;
      F[o + 5] = uy;
      F[o + 6] = uz;
      F[o + 7] = vx;
      F[o + 8] = vy;
      F[o + 9] = vz;
      F[o + 10] = d00;
      F[o + 11] = d01;
      F[o + 12] = d11;
      F[o + 13] = 1 / den;
    }
  }

  /** Room for `k` more pairs and drops. */
  private roomDrops(n: number): void {
    if (this.dropMark.length < n) {
      let c = Math.max(256, this.dropMark.length);
      while (c < n) c *= 2;
      this.dropMark = new Int32Array(c);
      this.dropSlot = new Int32Array(c);
      this.dropStamp = 0;
    }
  }

  private pushDrop(d: number): number {
    if (this.nCD >= this.cdI.length) {
      const c = Math.max(256, this.cdI.length * 2);
      const I = new Int32Array(c);
      I.set(this.cdI);
      this.cdI = I;
      this.cpx = grow(this.cpx, c);
      this.cpy = grow(this.cpy, c);
      this.cpz = grow(this.cpz, c);
      this.cqx = grow(this.cqx, c);
      this.cqy = grow(this.cqy, c);
      this.cqz = grow(this.cqz, c);
      this.cvx = grow(this.cvx, c);
      this.cvy = grow(this.cvy, c);
      this.cvz = grow(this.cvz, c);
      this.cw = grow(this.cw, c);
    }
    const k = this.nCD++;
    this.cdI[k] = d;
    this.dropMark[d] = this.dropStamp;
    this.dropSlot[d] = k;
    return k;
  }

  /** A pair's numbers are in `ar[0..7]`: side, the corners' weights, the normal, the reach. */
  private pushPair(k: number, t: number): void {
    const q = this.ar;
    const side = q[0] as number;
    const ba = q[1] as number;
    const bb = q[2] as number;
    const be = q[3] as number;
    const nx = q[4] as number;
    const ny = q[5] as number;
    const nz = q[6] as number;
    const reach = q[7] as number;
    if (this.nDP >= this.dpK.length) {
      const c = Math.max(512, this.dpK.length * 2);
      const K = new Int32Array(c);
      K.set(this.dpK);
      const T = new Int32Array(c);
      T.set(this.dpT);
      const S = new Float64Array(c);
      S.set(this.dpS);
      const B = new Float64Array(c * 3);
      B.set(this.dpB);
      const N = new Float64Array(c * 3);
      N.set(this.dpN);
      const R = new Float64Array(c);
      R.set(this.dpR);
      this.dpK = K;
      this.dpT = T;
      this.dpS = S;
      this.dpB = B;
      this.dpN = N;
      this.dpR = R;
    }
    const p = this.nDP++;
    this.dpK[p] = k;
    this.dpT[p] = t;
    this.dpS[p] = side;
    this.dpB[p * 3] = ba;
    this.dpB[p * 3 + 1] = bb;
    this.dpB[p * 3 + 2] = be;
    this.dpN[p * 3] = nx;
    this.dpN[p * 3 + 1] = ny;
    this.dpN[p * 3 + 2] = nz;
    this.dpR[p] = reach;
  }

  /**
   * The drop and face pairs of this step, from the liquid's step just made: for each drop whose path comes near the
   * cloth, the cloth points round it on the grid, the nearest of them (to where the drop ends, and to where it began when
   * it went far), and that point's faces whose plane the drop is near or crossed and whose face is under it.
   */
  private prepareDrops(): void {
    this.nDP = 0;
    this.nCD = 0;
    const L = this.liquid;
    if (this.wet.length !== this.cloths.length) this.wet = new Uint8Array(this.cloths.length);
    this.wet.fill(0);
    if (!L || L.ps.n === 0 || this.ta.length === 0) return;
    const ps = L.ps;
    const n = ps.n;
    if (this.pf0.length !== this.n + 1) this.buildPointFaces();
    this.faceTabOk.fill(0);
    this.roomDrops(n);
    this.dropStamp++;
    if (this.dropStamp > 1 << 29) {
      this.dropStamp = 1;
      this.dropMark.fill(0);
    }
    let thick = 0;
    for (let ck = 0; ck < this.cloths.length; ck++) {
      const tc = (this.cloths[ck] as ClothInfo).def.thickness;
      if (tc > thick) thick = tc;
    }
    const r = L.r;
    const reachMax = r + thick;
    const pad = reachMax + this.pad + 0.01;
    const { x, y, z, owner, pfT, pf0 } = this;
    const F = this.faceTab;
    const cell = this.grid.size;
    this.ensureTiles();
    const tb6 = this.tileBox;
    const nTiles = tb6.length / 6;
    for (let d = 0; d < n; d++) {
      const x1 = ps.x[d] as number;
      const y1 = ps.y[d] as number;
      const z1 = ps.z[d] as number;
      const x0 = ps.x0[d] as number;
      const y0 = ps.y0[d] as number;
      const z0 = ps.z0[d] as number;
      const lx = Math.min(x0, x1) - pad;
      const ly = Math.min(y0, y1) - pad;
      const lz = Math.min(z0, z1) - pad;
      const hx = Math.max(x0, x1) + pad;
      const hy = Math.max(y0, y1) + pad;
      const hz = Math.max(z0, z1) + pad;
      if (lx > this.bx1 || hx < this.bx0 || ly > this.by1 || hy < this.by0 || lz > this.bz1 || hz < this.bz0) continue;
      // a tile of cloth near the drop's path (a face within reach has a corner within half a cell more)
      const g = 0.5 * cell;
      let nearTile = false;
      for (let k = 0; k < nTiles && !nearTile; k++) {
        const o = k * 6;
        nearTile = (tb6[o] as number) <= hx + g && (tb6[o + 3] as number) >= lx - g && (tb6[o + 1] as number) <= hy + g && (tb6[o + 4] as number) >= ly - g && (tb6[o + 2] as number) <= hz + g && (tb6[o + 5] as number) >= lz - g;
      }
      if (!nearTile) continue;
      const ag = this.ar;
      ag[0] = lx - g;
      ag[1] = ly - g;
      ag[2] = lz - g;
      ag[3] = hx + g;
      ag[4] = hy + g;
      ag[5] = hz + g;
      const m = this.inGrid();
      if (m === 0) continue;
      const found = this.grid.found;
      // the nearest cloth point to where the drop ends, and to where it began
      let j1 = -1;
      let j0 = -1;
      let e1 = Infinity;
      let e0 = Infinity;
      const far = (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0) > 0.25 * cell * cell;
      for (let q = 0; q < m; q++) {
        const i = found[q] as number;
        if ((this.cloths[owner[i] as number] as ClothInfo).unstable) continue;
        const dx = (x[i] as number) - x1;
        const dy = (y[i] as number) - y1;
        const dz = (z[i] as number) - z1;
        const q1 = dx * dx + dy * dy + dz * dz;
        if (q1 < e1) {
          e1 = q1;
          j1 = i;
        }
        if (far) {
          const fx = (x[i] as number) - x0;
          const fy = (y[i] as number) - y0;
          const fz = (z[i] as number) - z0;
          const q0 = fx * fx + fy * fy + fz * fz;
          if (q0 < e0) {
            e0 = q0;
            j0 = i;
          }
        }
      }
      if (j1 < 0) continue;
      this.faceStamp++;
      if (this.faceStamp > 1 << 29) {
        this.faceStamp = 1;
        this.faceSeen.fill(0);
      }
      for (let pass = 0; pass < 2; pass++) {
        const j = pass === 0 ? j1 : j0;
        if (j < 0) continue;
        const c = owner[j] as number;
        const ci = this.cloths[c] as ClothInfo;
        if (this.faceTabOk[c] === 0) {
          this.faceTable(c);
          this.faceTabOk[c] = 1;
        }
        const reach = r + ci.def.thickness;
        for (let f = pf0[j] as number; f < (pf0[j + 1] as number); f++) {
          const t = pfT[f] as number;
          if (this.faceSeen[t] === this.faceStamp) continue;
          this.faceSeen[t] = this.faceStamp;
          const o = t * 14;
          const nx = F[o] as number;
          const ny = F[o + 1] as number;
          const nz = F[o + 2] as number;
          if (nx === 0 && ny === 0 && nz === 0) continue;
          const off = F[o + 3] as number;
          const s1 = nx * x1 + ny * y1 + nz * z1 - off;
          const s0 = nx * x0 + ny * y0 + nz * z0 - off;
          const side = s0 >= 0 ? 1 : -1;
          const crossed = s0 * s1 < 0;
          if (!crossed && (s1 * side > reach + 2 * this.pad + 0.01 || s1 * side < -reach)) continue;
          // the foot: where the path crossed the plane, or straight below where the drop ends
          let px: number;
          let py: number;
          let pz: number;
          if (crossed) {
            const u = s0 / (s0 - s1);
            px = x0 + u * (x1 - x0);
            py = y0 + u * (y1 - y0);
            pz = z0 + u * (z1 - z0);
          } else {
            px = x1 - s1 * nx;
            py = y1 - s1 * ny;
            pz = z1 - s1 * nz;
          }
          const a = this.ta[t] as number;
          const qx = px - (x[a] as number);
          const qy = py - (y[a] as number);
          const qz = pz - (z[a] as number);
          let fb: number;
          let fe: number;
          if ((this.tc[t] as number) < 0) {
            fb = (qx * (F[o + 4] as number) + qy * (F[o + 5] as number)) * (F[o + 13] as number);
            fe = 0;
            if (fb < -0.15 || fb > 1.15) continue;
          } else {
            const d20 = qx * (F[o + 4] as number) + qy * (F[o + 5] as number) + qz * (F[o + 6] as number);
            const d21 = qx * (F[o + 7] as number) + qy * (F[o + 8] as number) + qz * (F[o + 9] as number);
            const d00 = F[o + 10] as number;
            const d01 = F[o + 11] as number;
            const d11 = F[o + 12] as number;
            const inv = F[o + 13] as number;
            fb = (d11 * d20 - d01 * d21) * inv;
            fe = (d00 * d21 - d01 * d20) * inv;
            // a margin over the edges: a drop in the fold between two faces is held by both
            if (fb < -0.15 || fe < -0.15 || fb + fe > 1.15) continue;
          }
          // the weights of the corners at the foot, kept on the face
          fb = Math.min(1, Math.max(0, fb));
          fe = Math.min(1 - fb, Math.max(0, fe));
          let k: number;
          if (this.dropMark[d] === this.dropStamp) k = this.dropSlot[d] as number;
          else {
            k = this.pushDrop(d);
            this.cw[k] = 1 / (L.mass[ps.owner[d] as number] as number);
          }
          const ap = this.ar;
          ap[0] = side;
          ap[1] = 1 - fb - fe;
          ap[2] = fb;
          ap[3] = fe;
          ap[4] = nx;
          ap[5] = ny;
          ap[6] = nz;
          ap[7] = reach;
          this.pushPair(k, t);
          this.wet[c] = 1;
          if (ci.asleep) this.wake(c);
          this.meets++;
        }
      }
    }
    // the drops that take the small steps start where the liquid began them, moving along its step
    const ih = 1 / this.hStep;
    for (let k = 0; k < this.nCD; k++) {
      const d = this.cdI[k] as number;
      this.cpx[k] = ps.x0[d] as number;
      this.cpy[k] = ps.y0[d] as number;
      this.cpz[k] = ps.z0[d] as number;
      this.cvx[k] = ((ps.x[d] as number) - (ps.x0[d] as number)) * ih;
      this.cvy[k] = ((ps.y[d] as number) - (ps.y0[d] as number)) * ih;
      this.cvz[k] = ((ps.z[d] as number) - (ps.z0[d] as number)) * ih;
    }
  }

  /** The drops that take the small steps move by their speed (at the start of a small step). */
  private moveDrops(): void {
    const hs = this.hsub;
    for (let k = 0; k < this.nCD; k++) {
      this.cqx[k] = this.cpx[k] as number;
      this.cqy[k] = this.cpy[k] as number;
      this.cqz[k] = this.cpz[k] as number;
      this.cpx[k] = (this.cpx[k] as number) + (this.cvx[k] as number) * hs;
      this.cpy[k] = (this.cpy[k] as number) + (this.cvy[k] as number) * hs;
      this.cpz[k] = (this.cpz[k] as number) + (this.cvz[k] as number) * hs;
    }
  }

  /** Each drop keeps its reach from its faces, on its side: the drop and the corners share the push by their masses. */
  private solveDrops(): void {
    const { x, y, z, w, taut, ta, tb, tc, dpK, dpT, dpS, dpB, dpN, dpR, cpx, cpy, cpz, cw } = this;
    for (let p = 0; p < this.nDP; p++) {
      const k = dpK[p] as number;
      const t = dpT[p] as number;
      const a = ta[t] as number;
      const b = tb[t] as number;
      const e = tc[t] as number;
      const ba = dpB[p * 3] as number;
      const bb = dpB[p * 3 + 1] as number;
      const be = dpB[p * 3 + 2] as number;
      const nx = dpN[p * 3] as number;
      const ny = dpN[p * 3 + 1] as number;
      const nz = dpN[p * 3 + 2] as number;
      const side = dpS[p] as number;
      let fx = ba * (x[a] as number) + bb * (x[b] as number);
      let fy = ba * (y[a] as number) + bb * (y[b] as number);
      let fz = ba * (z[a] as number) + bb * (z[b] as number);
      if (e >= 0) {
        fx += be * (x[e] as number);
        fy += be * (y[e] as number);
        fz += be * (z[e] as number);
      }
      const s = nx * ((cpx[k] as number) - fx) + ny * ((cpy[k] as number) - fy) + nz * ((cpz[k] as number) - fz);
      const C = (dpR[p] as number) - s * side;
      if (!(C > 0)) continue;
      const wd = cw[k] as number;
      const held = w[a] === 0 || w[b] === 0 || (e >= 0 && w[e] === 0) || taut[a] === 1 || taut[b] === 1 || (e >= 0 && taut[e] === 1);
      if (held) {
        // the face does not give: the drop goes out whole, and the pins carry its push (Δλ = m C)
        cpx[k] = (cpx[k] as number) + C * side * nx;
        cpy[k] = (cpy[k] as number) + C * side * ny;
        cpz[k] = (cpz[k] as number) + C * side * nz;
        const L = (C / wd) * side;
        const ar = this.ar;
        ar[15] = -L * ba * nx;
        ar[16] = -L * ba * ny;
        ar[17] = -L * ba * nz;
        this.holdPush(a);
        ar[15] = -L * bb * nx;
        ar[16] = -L * bb * ny;
        ar[17] = -L * bb * nz;
        this.holdPush(b);
        if (e >= 0) {
          ar[15] = -L * be * nx;
          ar[16] = -L * be * ny;
          ar[17] = -L * be * nz;
          this.holdPush(e);
        }
        continue;
      }
      const W = wd + ba * ba * (w[a] as number) + bb * bb * (w[b] as number) + (e >= 0 ? be * be * (w[e] as number) : 0);
      const dl = (C / W) * side;
      cpx[k] = (cpx[k] as number) + wd * dl * nx;
      cpy[k] = (cpy[k] as number) + wd * dl * ny;
      cpz[k] = (cpz[k] as number) + wd * dl * nz;
      for (let q = 0; q < 3; q++) {
        const j = q === 0 ? a : q === 1 ? b : e;
        if (j < 0) continue;
        const m = (w[j] as number) * (q === 0 ? ba : q === 1 ? bb : be) * dl;
        x[j] = (x[j] as number) - m * nx;
        y[j] = (y[j] as number) - m * ny;
        z[j] = (z[j] as number) - m * nz;
      }
    }
  }

  /** The speeds of the drops that take the small steps, from their moves (at the end of a small step). */
  private dropSpeeds(): void {
    const hs = this.hsub;
    const ih = 1 / hs;
    for (let k = 0; k < this.nCD; k++) {
      this.cvx[k] = ((this.cpx[k] as number) - (this.cqx[k] as number)) * ih;
      this.cvy[k] = ((this.cpy[k] as number) - (this.cqy[k] as number)) * ih;
      this.cvz[k] = ((this.cpz[k] as number) - (this.cqz[k] as number)) * ih;
    }
  }

  /** After the small steps: a drop still across its face goes back whole; the drops' places and speeds go to the liquid. */
  private endDrops(): void {
    const L = this.liquid;
    if (!L || this.nCD === 0) return;
    const { x, y, z, ta, tb, tc, dpK, dpT, dpS, dpB, dpN, dpR, cpx, cpy, cpz } = this;
    for (let p = 0; p < this.nDP; p++) {
      const k = dpK[p] as number;
      const t = dpT[p] as number;
      const a = ta[t] as number;
      const b = tb[t] as number;
      const e = tc[t] as number;
      const ba = dpB[p * 3] as number;
      const bb = dpB[p * 3 + 1] as number;
      const be = dpB[p * 3 + 2] as number;
      const nx = dpN[p * 3] as number;
      const ny = dpN[p * 3 + 1] as number;
      const nz = dpN[p * 3 + 2] as number;
      const side = dpS[p] as number;
      const fx = ba * (x[a] as number) + bb * (x[b] as number) + (e >= 0 ? be * (x[e] as number) : 0);
      const fy = ba * (y[a] as number) + bb * (y[b] as number) + (e >= 0 ? be * (y[e] as number) : 0);
      const fz = ba * (z[a] as number) + bb * (z[b] as number) + (e >= 0 ? be * (z[e] as number) : 0);
      const s = nx * ((cpx[k] as number) - fx) + ny * ((cpy[k] as number) - fy) + nz * ((cpz[k] as number) - fz);
      if (s * side >= 0) continue;
      const C = (dpR[p] as number) - s * side;
      cpx[k] = (cpx[k] as number) + C * side * nx;
      cpy[k] = (cpy[k] as number) + C * side * ny;
      cpz[k] = (cpz[k] as number) + C * side * nz;
    }
    const ps = L.ps;
    for (let k = 0; k < this.nCD; k++) {
      const d = this.cdI[k] as number;
      ps.x[d] = this.cpx[k] as number;
      ps.y[d] = this.cpy[k] as number;
      ps.z[d] = this.cpz[k] as number;
      ps.vx[d] = this.cvx[k] as number;
      ps.vy[d] = this.cvy[k] as number;
      ps.vz[d] = this.cvz[k] as number;
    }
  }

  /** A push (in the pins' Δλ units, `ar[15..17]`) a held point passes on: to its own world pin, or shared by the pins its tethers reach. */
  protected holdPush(i: number): void {
    const a = this.ar;
    const ex = a[15] as number;
    const ey = a[16] as number;
    const ez = a[17] as number;
    const q = this.pinOf[i] as number;
    if (q >= 0 && (this.pinBody[q] as number) < 0) {
      this.pinFx[q] = (this.pinFx[q] as number) + ex;
      this.pinFy[q] = (this.pinFy[q] as number) + ey;
      this.pinFz[q] = (this.pinFz[q] as number) + ez;
      return;
    }
    const n = this.teCnt[i] as number;
    if (n === 0) return;
    const k0 = this.teOf[i] as number;
    for (let k = k0; k < k0 + n; k++) {
      const p = this.tePin[k] as number;
      this.pinFx[p] = (this.pinFx[p] as number) + ex / n;
      this.pinFy[p] = (this.pinFy[p] as number) + ey / n;
      this.pinFz[p] = (this.pinFz[p] as number) + ez / n;
    }
  }

  /** Smoke's flow blows cloth in the plane (design 9.5): the world in the plane says when it has smoke. */
  protected hasFlow(): boolean {
    return false;
  }

  /** Still air slows the faces too (set when the world has `air` over 0). */
  stillAir = false;

  /** Links stretched past `tears` times their length break for good, in id order (design 9.5). */
  private tear(): void {
    const { x, y, z, la, lb, rest, broken } = this;
    for (let ci = 0; ci < this.cloths.length; ci++) {
      const c = this.cloths[ci] as ClothInfo;
      const k = c.def.tears;
      if (!(k > 0) || c.asleep || c.unstable) continue;
      const k2 = k * k;
      let torn = 0;
      for (let l = c.l0; l < c.l0 + c.ln; l++) {
        if (broken[l] === 1 || this.kind[l] === LinkKind.bend) continue;
        const a = la[l] as number;
        const b = lb[l] as number;
        const dx = (x[a] as number) - (x[b] as number);
        const dy = (y[a] as number) - (y[b] as number);
        const dz = (z[a] as number) - (z[b] as number);
        const r = rest[l] as number;
        if (dx * dx + dy * dy + dz * dz > k2 * r * r) {
          broken[l] = 1;
          torn++;
        }
      }
      if (torn === 0) continue;
      // a bend link across a torn stretch link goes too, so the torn edge hangs free
      for (let l = c.l0; l < c.l0 + c.ln; l++) {
        if (this.kind[l] !== LinkKind.bend || broken[l] === 1) continue;
        if (this.bendCrossesTorn(l, c)) broken[l] = 1;
      }
      c.torn += torn;
      this.tornNow[ci] = torn;
      this.lqHs = 0;
      this.markCuts(c.t0, c.t0 + c.tn);
    }
  }

  /**
   * Burnt cells tear their links (design 9.7): `burnt` has one byte a cell of cloth `ci` (a sheet or net: (nu − 1) ×
   * (nv − 1) cells row by row, a rope: nu − 1 segments), 1 where the cell burnt away. A stretch or shear link that lies on
   * a burnt cell breaks, then the bend links across a broken stretch link, as `tear` does; the count goes to `torn` and
   * `tornNow`, and a sleeping cloth wakes. Nothing is replaced: the arrays are written in place. Returns the links broken.
   */
  burnCells(ci: number, burnt: Uint8Array): number {
    const c = this.cloths[ci];
    if (!c) return 0;
    const nu = c.def.nu;
    const nv = c.def.nv;
    const cu = nu - 1;
    const cv = nv > 1 ? nv - 1 : 1;
    const at = (i: number, j: number): boolean => i >= 0 && i < cu && j >= 0 && j < cv && burnt[j * cu + i] === 1;
    const { la, lb, broken } = this;
    let torn = 0;
    for (let l = c.l0; l < c.l0 + c.ln; l++) {
      if (broken[l] === 1) continue;
      const k = this.kind[l];
      if (k === LinkKind.bend) continue;
      const pa = Math.min(la[l] as number, lb[l] as number) - c.p0;
      const pb = Math.max(la[l] as number, lb[l] as number) - c.p0;
      const d = pb - pa;
      const i = pa % nu;
      const j = (pa - i) / nu;
      let hit: boolean;
      if (nv === 1) hit = d === 1 && at(i, 0);
      else if (k === LinkKind.stretch) hit = d === 1 ? at(i, j) || at(i, j - 1) : at(i, j) || at(i - 1, j);
      else hit = d === nu + 1 ? at(i, j) : at(i - 1, j);
      if (hit) {
        broken[l] = 1;
        torn++;
      }
    }
    if (torn === 0) return 0;
    for (let l = c.l0; l < c.l0 + c.ln; l++) {
      if (this.kind[l] !== LinkKind.bend || broken[l] === 1) continue;
      if (this.bendCrossesTorn(l, c)) broken[l] = 1;
    }
    c.torn += torn;
    this.tornNow[ci] = (this.tornNow[ci] as number) + torn;
    this.lqHs = 0;
    this.markCuts(c.t0, c.t0 + c.tn);
    this.wake(ci);
    return torn;
  }

  /** A bend link joins a, m, b along a thread: is either stretch link a–m or m–b torn? */
  private bendCrossesTorn(l: number, _c: ClothInfo): boolean {
    const a = this.la[l] as number;
    const b = this.lb[l] as number;
    const m = (a + b) / 2;
    const k1 = this.stretchAt.get(Math.min(a, m) * 8192 + Math.max(a, m));
    const k2 = this.stretchAt.get(Math.min(m, b) * 8192 + Math.max(m, b));
    return (k1 !== undefined && this.broken[k1] === 1) || (k2 !== undefined && this.broken[k2] === 1);
  }

  /** Stretch links by their two points (a × 8192 + b, a < b), for tearing. */
  private readonly stretchAt = new Map<number, number>();


  /** Sleep: a cloth whose points all move under 1 mm/s for 0.5 s; blow-up: a place or a speed not finite or over 1e6. */
  private settle(): void {
    const h = this.hStep;
    const { x, y, z, vx, vy, vz, sx, sy, sz } = this;
    for (let ck = 0; ck < this.cloths.length; ck++) {
      const c = this.cloths[ck] as ClothInfo;
      if (c.asleep || c.unstable) continue;
      let fast = false;
      let bad = false;
      const e = c.p0 + c.n;
      // still means the step's move: a point resting on a solid trades a little with its links in the small steps (its
      // last small step's speed is that trade), but over the whole step it goes nowhere
      const s2 = SLEEP_SPEED * SLEEP_SPEED * h * h;
      for (let i = c.p0; i < e; i++) {
        const a = vx[i] as number;
        const b = vy[i] as number;
        const d = vz[i] as number;
        const v2 = a * a + b * b + d * d;
        const mx = (x[i] as number) - (sx[i] as number);
        const my = (y[i] as number) - (sy[i] as number);
        const mz = (z[i] as number) - (sz[i] as number);
        if (mx * mx + my * my + mz * mz > s2) fast = true;
        if (!(v2 < BLOW_UP * BLOW_UP) || !(Math.abs(x[i] as number) < BLOW_UP && Math.abs(y[i] as number) < BLOW_UP && Math.abs(z[i] as number) < BLOW_UP)) bad = true;
      }
      if (bad) {
        c.unstable = true;
        continue;
      }
      if (fast || this.grabsOn(c)) c.sleepTime = 0;
      else c.sleepTime += h;
      if (c.sleepTime >= SLEEP_TIME && this.sleeping) {
        c.asleep = true;
        c.windX = this.windX;
        c.windY = this.windY;
        c.windZ = this.windZ;
        for (let i = c.p0; i < e; i++) {
          vx[i] = 0;
          vy[i] = 0;
          vz[i] = 0;
        }
      }
    }
  }

  /** How far through the world step this small step ends (1/4, 1/2, 3/4, 1): a body pin follows its body there. */
  protected subFrac = 1;

  /** The world step now (a driver sets it, then calls `stepWorld`: a number passed in a call is a heap number, garbage). */
  hStep = 1 / 120;

  /** The small step now (`hStep / subs`). Methods read it here: a number passed in a call is a heap number, garbage. */
  protected hsub = 1 / 360;

  /**
   * Numbers handed from one method to the next in the collision code. A double passed as an argument or returned is boxed
   * on the heap unless the engine inlines the call, and a step must make no garbage (design 11.4), so a caller writes its
   * numbers to these places and the callee reads them there. The slots each method uses are named at the method.
   */
  protected readonly ar = new Float64Array(24);

  /**
   * Is point i near (on the cloth as it was made) a point pinned to body b, within `reach`? Such a point lies on the body
   * by construction (a rope tied to a ball): it does not hit that body, or the pin and the touch would fight.
   */
  /** True when some pin holds a point to a body. */
  protected get hasBodyPins(): boolean {
    for (let q = 0; q < this.pinBody.length; q++) if ((this.pinBody[q] as number) >= 0) return true;
    return false;
  }

  /** `reach` is `ar[6]`. */
  protected nearBodyPin(i: number, b: number): boolean {
    const reach = this.ar[6] as number;
    const c = this.cloths[this.owner[i] as number];
    if (!c) return false;
    const pos = c.def.pos;
    const k = i - c.p0;
    const r2 = reach * reach;
    for (let q = c.pin0; q < c.pin0 + c.pinN; q++) {
      if (this.pinBody[q] !== b) continue;
      const j = (this.pinPoint[q] as number) - c.p0;
      const dx = (pos[k * 3] as number) - (pos[j * 3] as number);
      const dy = (pos[k * 3 + 1] as number) - (pos[j * 3 + 1] as number);
      const dz = (pos[k * 3 + 2] as number) - (pos[j * 3 + 2] as number);
      if (dx * dx + dy * dy + dz * dz <= r2) return true;
    }
    return false;
  }

  /** True while the body pins give their pushes (a world counts them as tension). */
  protected inPins = false;

  /** The world's `sleep` setting. */
  sleeping = true;

  private grabsOn(c: ClothInfo): boolean {
    for (let g = 0; g < this.nGrab; g++) {
      const i = this.grabI[g] as number;
      if (i >= c.p0 && i < c.p0 + c.n) return true;
    }
    return false;
  }

  /** A sleeping cloth wakes when the wind changes, a body near it moves, it is grabbed, or a drop comes near. */
  private wakeCheck(): void {
    for (let ci = 0; ci < this.cloths.length; ci++) {
      const c = this.cloths[ci] as ClothInfo;
      if (!c.asleep) continue;
      if (c.windX !== this.windX || c.windY !== this.windY || c.windZ !== this.windZ || this.grabsOn(c) || this.bodiesStir(ci) || this.dropsNear(ci)) this.wake(ci);
    }
  }

  /** Did drops meet cloth c in the last liquid step? */
  protected dropsNear(c: number): boolean {
    return this.wet[c] === 1;
  }

  wake(c: number): void {
    const ci = this.cloths[c];
    if (!ci) return;
    ci.asleep = false;
    ci.sleepTime = 0;
  }

  /** Before the next step: wakes sleeping cloths that something stirs (called by the world before stepping). */
  wakeIfStirred(): void {
    this.wakeCheck();
  }

  /* ------------------------------ readouts ------------------------------ */

  /** The most stretched link of cloth c, as its length over its rest length (stretch and shear links). */
  stretchMax(c: number): number {
    const ci = this.cloths[c] as ClothInfo;
    let bestD2 = 0;
    let bestR2 = 1;
    const { x, y, z } = this;
    // the stretch links come first ([l0, sh0))
    for (let l = ci.l0; l < ci.sh0; l++) {
      if (this.broken[l] === 1) continue;
      const a = this.la[l] as number;
      const b = this.lb[l] as number;
      const dx = (x[a] as number) - (x[b] as number);
      const dy = (y[a] as number) - (y[b] as number);
      const dz = (z[a] as number) - (z[b] as number);
      // the largest d² / r², compared without dividing: d² r_best² > d_best² r²
      const r = this.rest[l] as number;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r2 = r * r;
      if (d2 * bestR2 > bestD2 * r2) {
        bestD2 = d2;
        bestR2 = r2;
      }
    }
    return bestR2 > 0 ? Math.sqrt(bestD2 / bestR2) : 0;
  }

  /**
   * The torn threads of cloth c by place, for drawing: first along u, (nu − 1) × nv, index j (nu − 1) + i for the
   * thread from (i, j) to (i + 1, j); then along v, nu × (nv − 1), index j nu + i for (i, j) to (i, j + 1). 1 is torn.
   */
  threadCuts(c: number): Uint8Array {
    const ci = this.cloths[c] as ClothInfo;
    const { nu, nv } = ci.def;
    const out = new Uint8Array((nu - 1) * nv + nu * (nv - 1));
    if (ci.torn === 0) return out;
    for (let l = ci.l0; l < ci.l0 + ci.ln; l++) {
      if (this.kind[l] !== LinkKind.stretch || this.broken[l] !== 1) continue;
      const a = Math.min(this.la[l] as number, this.lb[l] as number) - ci.p0;
      const b = Math.max(this.la[l] as number, this.lb[l] as number) - ci.p0;
      const i = a % nu;
      const j = Math.floor(a / nu);
      if (b - a === 1) out[j * (nu - 1) + i] = 1;
      else out[(nu - 1) * nv + j * nu + i] = 1;
    }
    return out;
  }

  /** Kinetic plus potential energy of cloth c (the potential from gravity, 0 at the origin). */
  energy(c: number): number {
    const ci = this.cloths[c] as ClothInfo;
    const m = ci.mPt;
    let e = 0;
    for (let i = ci.p0; i < ci.p0 + ci.n; i++) {
      const a = this.vx[i] as number;
      const b = this.vy[i] as number;
      const d = this.vz[i] as number;
      e += 0.5 * m * (a * a + b * b + d * d) - m * (this.gx * (this.x[i] as number) + this.gy * (this.y[i] as number) + this.gz * (this.z[i] as number));
    }
    return e;
  }

  /** The sum of the forces the world pins of cloth c carry (N). */
  pinForce3(c: number): { x: number; y: number; z: number } {
    const ci = this.cloths[c] as ClothInfo;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let q = ci.pin0; q < ci.pin0 + ci.pinN; q++) {
      fx += this.pinFx[q] as number;
      fy += this.pinFy[q] as number;
      fz += this.pinFz[q] as number;
    }
    return { x: fx, y: fy, z: fz };
  }

  /** The bodies cloth c touched in the last step (world indices, in order). */
  touching(c: number): number[] {
    const nb = this.bjx.length;
    const out: number[] = [];
    for (let b = 0; b < nb; b++) if (this.touched[c * nb + b] === 1) out.push(b);
    return out;
  }

  /** Takes hold of a point (or moves the hold) and pulls it toward (x, y, z). */
  grab(i: number, x: number, y: number, z: number): void {
    let g = 0;
    while (g < this.nGrab && this.grabI[g] !== i) g++;
    if (g === this.nGrab) {
      if (g >= MAX_GRABS) return;
      this.nGrab++;
    }
    this.grabI[g] = i;
    this.grabX[g] = x;
    this.grabY[g] = y;
    this.grabZ[g] = z;
    this.wake(this.owner[i] as number);
  }

  release(i: number): void {
    for (let g = 0; g < this.nGrab; g++) {
      if (this.grabI[g] !== i) continue;
      this.nGrab--;
      this.grabI[g] = this.grabI[this.nGrab] as number;
      this.grabX[g] = this.grabX[this.nGrab] as number;
      this.grabY[g] = this.grabY[this.nGrab] as number;
      this.grabZ[g] = this.grabZ[this.nGrab] as number;
      return;
    }
  }

  /** Lets go of every point. */
  releaseAll(): void {
    this.nGrab = 0;
  }

  /** The point of cloth c nearest (x, y, z). */
  nearest(c: number, x: number, y: number, z: number): number {
    const ci = this.cloths[c] as ClothInfo;
    let best = ci.p0;
    let bd = Infinity;
    for (let i = ci.p0; i < ci.p0 + ci.n; i++) {
      const dx = (this.x[i] as number) - x;
      const dy = (this.y[i] as number) - y;
      const dz = (this.z[i] as number) - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /* ------------------------------ checkpoints (design 10.3) ------------------------------ */

  /**
   * Everything the next step reads: each point's place and speed, the torn links as bits, the pins, each cloth's sleep,
   * and the pushes still owed to bodies.
   */
  save(): Float64Array {
    const n = this.n;
    const nl = this.la.length;
    const words = Math.ceil(nl / 32);
    const nb = this.bjx.length;
    const np = this.pinPoint.length;
    const nc = this.cloths.length;
    const per = this.dim === 3 ? 6 : 4;
    const out = new Float64Array(3 + nc * 7 + np * 3 + 1 + 12 * nb + words + per * n);
    let k = 0;
    out[k++] = n;
    out[k++] = this.steps;
    out[k++] = nb;
    for (const c of this.cloths) {
      out[k++] = c.asleep ? 1 : 0;
      out[k++] = c.sleepTime;
      out[k++] = c.torn;
      out[k++] = c.unstable ? 1 : 0;
      out[k++] = c.windX;
      out[k++] = c.windY;
      out[k++] = c.windZ;
    }
    for (let q = 0; q < np; q++) {
      out[k++] = this.pinX[q] as number;
      out[k++] = this.pinY[q] as number;
      out[k++] = this.pinZ[q] as number;
    }
    out[k++] = words;
    for (const a of [this.bjx, this.bjy, this.bjz, this.btx, this.bty, this.btz, this.bdx, this.bdy, this.bdz, this.pjx, this.pjy, this.pjz]) {
      out.set(a, k);
      k += nb;
    }
    // the torn links, 32 to a number
    for (let wd = 0; wd < words; wd++) {
      let bits = 0;
      let bit = 1;
      for (let b = 0; b < 32; b++) {
        const l = wd * 32 + b;
        if (l < nl && this.broken[l] === 1) bits += bit;
        bit *= 2;
      }
      out[k++] = bits;
    }
    const arrays = this.dim === 3 ? [this.x, this.y, this.z, this.vx, this.vy, this.vz] : [this.x, this.y, this.vx, this.vy];
    for (const a of arrays) {
      out.set(a.subarray(0, n), k);
      k += n;
    }
    return out;
  }

  load(s: Float64Array): void {
    let k = 0;
    const n = s[k++] as number;
    this.steps = s[k++] as number;
    const nb = s[k++] as number;
    this.sizeBodies(nb);
    for (const c of this.cloths) {
      c.asleep = s[k++] === 1;
      c.sleepTime = s[k++] as number;
      c.torn = s[k++] as number;
      c.unstable = s[k++] === 1;
      c.windX = s[k++] as number;
      c.windY = s[k++] as number;
      c.windZ = s[k++] as number;
    }
    for (let q = 0; q < this.pinPoint.length; q++) {
      this.pinX[q] = s[k++] as number;
      this.pinY[q] = s[k++] as number;
      this.pinZ[q] = s[k++] as number;
    }
    const words = s[k++] as number;
    for (const a of [this.bjx, this.bjy, this.bjz, this.btx, this.bty, this.btz, this.bdx, this.bdy, this.bdz, this.pjx, this.pjy, this.pjz]) {
      a.set(s.subarray(k, k + nb));
      k += nb;
    }
    const nl = this.la.length;
    for (let wd = 0; wd < words; wd++) {
      let bits = s[k++] as number;
      for (let b = 0; b < 32; b++) {
        const l = wd * 32 + b;
        const on = bits % 2;
        bits = (bits - on) / 2;
        if (l < nl) this.broken[l] = on === 1 ? 1 : 0;
      }
    }
    const arrays = this.dim === 3 ? [this.x, this.y, this.z, this.vx, this.vy, this.vz] : [this.x, this.y, this.vx, this.vy];
    for (const a of arrays) {
      a.set(s.subarray(k, k + n));
      k += n;
    }
    this.sx.set(this.x.subarray(0, n));
    this.sy.set(this.y.subarray(0, n));
    this.sz.set(this.z.subarray(0, n));
    this.tornNow.fill(0);
    this.lqHs = 0;
    this.markCuts(0, this.ta.length);
    this.tilesAt = -1;
  }
}

/**
 * Typed arrays of one length cut from one buffer, each starting three cache lines past a multiple of 4 KB from the one
 * before. Arrays of a power-of-two size made one by one start at the same place in the processor's cache sets, so a loop
 * that reads and writes a dozen of them at once (a 64 × 32 cloth has 2,048 points: 16 KB an array) keeps evicting its
 * own lines; staggered, the same loop runs about twice as fast.
 */
class Stagger {
  private readonly buf: ArrayBuffer;
  private off = 0;
  private readonly n: number;

  /** With an arena the arrays are cut from a region of its memory (a multiple of 64 bytes from its start), else from a buffer of their own. */
  constructor(n: number, count: number, arena?: KernelArena) {
    this.n = n;
    const bytes = Stagger.bytes(n, count);
    const at = arena ? arena.take(bytes) : -1;
    if (arena && at >= 0) {
      this.buf = arena.buffer;
      this.off = at;
    } else this.buf = new ArrayBuffer(bytes);
  }

  /** The bytes `count` arrays of `n` numbers take. */
  static bytes(n: number, count: number): number {
    return count * (Stagger.span(n) + 192);
  }

  private static span(n: number): number {
    return Math.ceil((n * 8) / 64) * 64;
  }

  private take(): number {
    const o = this.off;
    this.off += Stagger.span(this.n) + 192;
    return o;
  }

  f(): Float64Array {
    return new Float64Array(this.buf, this.take(), this.n);
  }

  i(): Int32Array {
    return new Int32Array(this.buf, this.take(), this.n);
  }
}

/** Room for a hull's face planes, numbers (four a face) in the Rust test; a hull with more faces is tested in TypeScript. */
const HULL_PLANES = 1024;

/** Where the arrays the Rust loops touch are in the arena (byte offsets; 0 without one). */
interface KOffsets {
  readonly x: number; readonly y: number; readonly z: number; readonly px: number; readonly py: number; readonly pz: number;
  readonly sx: number; readonly sy: number; readonly sz: number; readonly vx: number; readonly vy: number; readonly vz: number;
  readonly w: number; readonly w0: number; readonly pinOf: number; readonly afx: number; readonly afy: number; readonly afz: number;
  readonly owner: number; readonly taut: number; readonly la: number; readonly lb: number; readonly rest: number; readonly alpha: number;
  readonly broken: number; readonly lq: number; readonly lr2: number; readonly ta: number; readonly tb: number; readonly tc: number;
  readonly triCut: number; readonly pinBody: number; readonly pinFx: number; readonly pinFy: number; readonly pinFz: number;
  readonly tePoint: number; readonly tePin: number; readonly teJ: number; readonly teL2: number; readonly chain: number;
  readonly chNx: number; readonly chNy: number; readonly chNz: number; readonly chD: number; readonly chU: number; readonly chR: number;
  readonly hullIdx: number; readonly hullPl: number; readonly hullOut: number; readonly hullPar: number; readonly kp: number;
}

/** The bytes of arena a set of these sizes takes (every region rounded up to 64 bytes, and room to spare). */
function arenaBytes(np: number, nl: number, nt: number, npin: number, nte: number, ropeTotal: number, ropeLongest: number, dim: 2 | 3): number {
  const b = (n: number, w: number): number => Math.ceil((n * w) / 64) * 64;
  return (
    Stagger.bytes(np, 19) + Stagger.bytes(nl, 6) + 128 +
    b(np, 4) + b(np, 1) + b(nl, 8) + b(nl, 1) + 3 * b(nt, 4) + b(nt, 1) + b(npin, 4) + 3 * b(npin, 8) + 3 * b(nte, 4) + b(nte, 8) +
    b(ropeTotal, 4) + 6 * b(ropeLongest, 8) +
    (dim === 3 ? b(np, 4) + b(HULL_PLANES, 8) : 0) + 2 * b(8, 8) + b(KP.size, 8) +
    NeighbourGrid3.arenaBytes(Math.max(16, np), false) + 8192
  );
}

/** How many links a cloth has. */
export function countLinks(d: { readonly nu: number; readonly nv: number; readonly bend: number }): number {
  const { nu, nv } = d;
  let n = nv * (nu - 1) + nu * (nv - 1);
  if (nv > 1) n += (nu - 1) * (nv - 1);
  if (d.bend > 0) n += nv * Math.max(0, nu - 2) + nu * Math.max(0, nv - 2);
  return n;
}

/**
 * A zeroed array of `n` places. A closure that makes these inside a method puts a context on the heap at every call of
 * the method, even when the closure is never made, so the methods a step runs call this instead (design 11.4).
 */
function f64(n: number): Float64Array<ArrayBuffer> {
  return new Float64Array(n);
}

/** `a` copied into a new array of `n` places. */
function grow(a: Float64Array, n: number): Float64Array<ArrayBuffer> {
  const b = new Float64Array(n);
  b.set(a);
  return b;
}

function dist(x: Float64Array, y: Float64Array, z: Float64Array, a: number, b: number): number {
  const dx = (x[a] as number) - (x[b] as number);
  const dy = (y[a] as number) - (y[b] as number);
  const dz = (z[a] as number) - (z[b] as number);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The points of a cloth's grid at the start, row by row (design 2.4). */
export function sheetPoints(cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, nu: number, nv: number): Float64Array {
  const out = new Float64Array(nu * nv * 3);
  for (let j = 0; j < nv; j++) {
    const r = nv > 1 ? j / (nv - 1) : 0;
    for (let i = 0; i < nu; i++) {
      const s = nu > 1 ? i / (nu - 1) : 0;
      const k = (j * nu + i) * 3;
      out[k] = cx + s * ux + r * vx;
      out[k + 1] = cy + s * uy + r * vy;
      out[k + 2] = cz + s * uz + r * vz;
    }
  }
  return out;
}

/**
 * The points a `pins` word names (design 2.4): `"top"` the edge highest up, `"left"` the edge furthest to −x,
 * `"corners"` the four corners (a rope's two ends), `"top corners"` the ends of the top edge. Indices into the grid.
 */
export function pinWord(word: string, pos: Float64Array, nu: number, nv: number, dim: 2 | 3): number[] | undefined {
  const up = dim === 3 ? 2 : 1;
  const at = (i: number, j: number): number => j * nu + i;
  const edges: { pts: number[]; ends: [number, number] }[] = [];
  if (nv === 1) {
    edges.push({ pts: [0], ends: [0, 0] }, { pts: [nu - 1], ends: [nu - 1, nu - 1] });
  } else {
    const row = (j: number): number[] => Array.from({ length: nu }, (_, i) => at(i, j));
    const col = (i: number): number[] => Array.from({ length: nv }, (_, j) => at(i, j));
    edges.push({ pts: row(0), ends: [at(0, 0), at(nu - 1, 0)] }, { pts: row(nv - 1), ends: [at(0, nv - 1), at(nu - 1, nv - 1)] }, { pts: col(0), ends: [at(0, 0), at(0, nv - 1)] }, { pts: col(nu - 1), ends: [at(nu - 1, 0), at(nu - 1, nv - 1)] });
  }
  const mean = (pts: number[], k: number): number => pts.reduce((s, p) => s + (pos[p * 3 + k] as number), 0) / pts.length;
  const pick = (score: (e: { pts: number[] }) => number): { pts: number[]; ends: [number, number] } => {
    let best = edges[0] as { pts: number[]; ends: [number, number] };
    let bs = -Infinity;
    for (const e of edges) {
      const s = score(e);
      if (s > bs + 1e-9) {
        bs = s;
        best = e;
      }
    }
    return best;
  };
  const w = word.trim().toLowerCase().replace(/\s+/g, ' ');
  if (w === 'top') return nv === 1 ? [pick((e) => mean(e.pts, up)).pts[0] as number] : pick((e) => mean(e.pts, up)).pts;
  if (w === 'left') return nv === 1 ? [pick((e) => -mean(e.pts, 0)).pts[0] as number] : pick((e) => -mean(e.pts, 0)).pts;
  if (w === 'corners') return nv === 1 ? [0, nu - 1] : [at(0, 0), at(nu - 1, 0), at(0, nv - 1), at(nu - 1, nv - 1)];
  if (w === 'top corners') {
    if (nv === 1) return [0, nu - 1];
    const e = pick((x) => mean(x.pts, up));
    return e.ends[0] === e.ends[1] ? [e.ends[0]] : [...e.ends];
  }
  return undefined;
}

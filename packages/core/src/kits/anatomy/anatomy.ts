import type {
  Anatomy,
  AnatomyLayer,
  AnatomyMode,
  AnatomyOptions,
  AnatomyPiece,
  Animal,
  ExampleSkeleton,
  FootPosture,
  Gait,
  Handle,
  MoveOptions,
  PartOptions,
  PathHandle,
  SkeletonSpec,
  Tone,
  Vec2,
  ViewBox,
} from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import { fmt } from '../../scene/format';
import type { StageHandle } from '../../scene/handles';
import { planGait, type GaitPlan } from './gait';
import { fail, readSkeleton, type Build, type Limb } from './skeleton';

export const DEFAULT_ANATOMY_VIEWBOX: ViewBox = [0, 0, 800, 400];
const MAX_ANIMALS = 6;
/** The fixed step the stride moves in, seconds. */
const STEP = 1 / 60;
/** Metres a second; faster than any animal runs. */
const MAX_SPEED = 40;
/** Seconds to change between four legs and two. */
const TRANSITION = 1.2;

function checkBox(value: unknown): ViewBox {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number' && Number.isFinite(v))) fail('viewBox is [x, y, width, height]');
  if (!(value[2] >= 120 && value[3] >= 80)) fail('the view box is too small; make it at least 120 by 80');
  return [value[0], value[1], value[2], value[3]];
}

/** Checks the anatomy stage's options and returns its view box (the kit's layout step). */
export function anatomyLayout(options: unknown): { readonly viewBox: ViewBox } {
  const o = (options ?? {}) as AnatomyOptions;
  return { viewBox: o.viewBox === undefined ? DEFAULT_ANATOMY_VIEWBOX : checkBox(o.viewBox) };
}

// ---------------------------------------------------------------------------
// Geometry, in metres with y up
// ---------------------------------------------------------------------------

type P = readonly [number, number];

/** A body shape: a capsule that tapers from one end to the other, or an ellipse. */
type Shape = { readonly k: 'cap'; readonly a: P; readonly ra: number; readonly b: P; readonly rb: number } | { readonly k: 'ell'; readonly c: P; readonly rx: number; readonly ry: number; readonly angle: number };

const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const mul = (a: P, k: number): P => [a[0] * k, a[1] * k];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const len = (a: P) => Math.hypot(a[0], a[1]);
const polar = (angle: number, r = 1): P => [Math.cos(angle) * r, Math.sin(angle) * r];
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const cap = (a: P, ra: number, b: P, rb: number): Shape => ({ k: 'cap', a, ra, b, rb });
const ell = (c: P, rx: number, ry: number, angle = 0): Shape => ({ k: 'ell', c, rx, ry, angle });

/** A shape's outline, counter-clockwise, grown by `grow`, so overlapping shapes fill as one body. */
function outline(shape: Shape, grow: number): P[] {
  const pts: P[] = [];
  if (shape.k === 'ell') {
    const [cx, cy] = shape.c;
    const cos = Math.cos(shape.angle);
    const sin = Math.sin(shape.angle);
    const rx = shape.rx + grow;
    const ry = shape.ry + grow;
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * 2 * Math.PI;
      const x = rx * Math.cos(t);
      const y = ry * Math.sin(t);
      pts.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
    }
    return pts;
  }
  const ra = shape.ra + grow;
  const rb = shape.rb + grow;
  const d = len(sub(shape.b, shape.a));
  if (d <= Math.abs(ra - rb) + 1e-9) return outline(ra >= rb ? ell(shape.a, ra, ra) : ell(shape.b, rb, rb), 0);
  const a = Math.atan2(shape.b[1] - shape.a[1], shape.b[0] - shape.a[0]);
  // The tangent lines touch each end circle this far round from the line between the centres.
  const phi = Math.acos(clamp((ra - rb) / d, -1, 1));
  const nb = Math.max(4, Math.round((18 * phi) / Math.PI));
  for (let i = 0; i <= nb; i++) pts.push(add(shape.b, polar(a - phi + (2 * phi * i) / nb, rb)));
  const na = Math.max(4, Math.round((18 * (Math.PI - phi)) / Math.PI));
  for (let i = 0; i <= na; i++) pts.push(add(shape.a, polar(a + phi + (2 * (Math.PI - phi) * i) / na, ra)));
  return pts;
}

/** Two-bone inverse kinematics: the middle joint for a limb from `root` reaching `target`, bending to `bend` (+1 forward, -1 back). */
function reachTo(root: P, target: P, l1: number, l2: number, bend: number): { joint: P; end: P; reached: boolean } {
  const to = sub(target, root);
  const want = len(to);
  const d = clamp(want, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const base = Math.atan2(to[1], to[0]);
  const inner = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const joint = add(root, polar(base + bend * inner, l1));
  return { joint, end: add(root, polar(base, d)), reached: want <= l1 + l2 + 1e-6 };
}

/**
 * Where foot `leg` is along the ground at stride phase `p`, relative to the
 * body: planted, it sweeps back exactly as fast as the ground passes, so it
 * never slides; lifted, it swings forward to land ahead again. `progress`
 * runs from 0 to 1 through each half, and `lift` is the share of the swing's
 * height.
 */
export function placeFoot(plan: GaitPlan, leg: number, p: number, neutralX: number): { x: number; lift: number; planted: boolean; progress: number } {
  if (plan.duty >= 1) return { x: neutralX, lift: 0, planted: true, progress: 0.5 };
  const local = (((p - plan.phases[leg]!) % 1) + 1) % 1;
  const half = (plan.stride * plan.duty) / 2;
  if (local < plan.duty) {
    const s = local / plan.duty;
    return { x: neutralX + half * (1 - 2 * s), lift: 0, planted: true, progress: s };
  }
  const w = (local - plan.duty) / (1 - plan.duty);
  return { x: neutralX - half + 2 * half * smooth(w), lift: Math.sin(Math.PI * w), planted: false, progress: w };
}

/** How steep each posture holds the foot, radians from the ground. */
const FOOT_ANGLE: Readonly<Record<FootPosture, number>> = { plantigrade: 0.17, digitigrade: 0.9, unguligrade: 1.25 };

const ankleHeight = (limb: Limb) => Math.max(limb.foot * Math.sin(FOOT_ANGLE[limb.posture]), 0.12 * limb.foot);

/** A seeded generator (mulberry32), so spots fall in the same places every run. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The body read from the bones
// ---------------------------------------------------------------------------

/**
 * Muscle bulk and body depth, read from the bones as a reconstruction does:
 * each muscle group sized from the bone it attaches to, runners with heavy
 * upper limbs and thin lower ones, and the heavier end where the limbs drive.
 */
export interface Body {
  readonly thighR: number;
  readonly kneeR: number;
  readonly hockR: number;
  readonly shoulderR: number;
  readonly elbowR: number;
  readonly wristR: number;
  readonly chestR: number;
  readonly pelvisR: number;
  readonly waistR: number;
  readonly neckR: number;
  readonly craniumR: number;
  readonly tailR: number;
  /** Lower over upper hindlimb: high for runners. */
  readonly runner: number;
}

export function readBody(build: Build): Body {
  const { hind, fore } = build;
  const S = build.spine.length;
  const runner = hind.lower / hind.upper;
  const hindLength = hind.upper + hind.lower + hind.foot;
  const foreLength = fore ? fore.upper + fore.lower + fore.foot : hindLength * 0.7;
  const drive = clamp(hindLength / foreLength, 0.7, 1.5);
  // Muscle grows with the bone it sits on, but a long, slender bone (a human thigh) does not carry a horse's.
  const thighR = Math.min(0.3 * hind.upper, 0.08 * build.size) * (0.8 + 0.4 * drive);
  const kneeR = thighR * (0.5 - 0.12 * clamp(runner - 1, 0, 1));
  const shoulderR = fore ? Math.min(0.3 * fore.upper, 0.07 * build.size) * (0.8 + 0.4 / drive) : thighR * 0.6;
  const foreRunner = fore ? fore.lower / fore.upper : 1;
  // Diggers and climbers, with short forearms for their upper arms, have thick ones.
  const elbowR = shoulderR * (0.55 - 0.12 * clamp(foreRunner - 1, 0, 1)) * (foreRunner < 0.85 ? 1.3 : 1);
  const chestR = Math.max(0.26 * S + 0.5 * shoulderR, shoulderR * 1.3);
  const pelvisR = Math.max(0.15 * S + 0.5 * thighR, thighR * 1.05);
  const waistR = Math.min(chestR, pelvisR) * (0.85 - 0.6 * clamp(runner - 1, 0, 0.5));
  const craniumR = build.skull.depth / 2;
  return {
    thighR,
    kneeR,
    hockR: kneeR * 0.55,
    shoulderR,
    elbowR,
    wristR: elbowR * 0.55,
    chestR,
    pelvisR,
    waistR,
    neckR: 0.32 * build.skull.depth + 0.08 * build.neck,
    craniumR,
    tailR: 0.26 * pelvisR * (0.6 + 0.6 * build.tail.stiffness),
    runner,
  };
}

interface Rig {
  /** Leg extension standing: small animals crouch. */
  readonly extension: number;
  readonly hipQ: number;
  readonly thetaQ: number;
  readonly hipB: number;
  readonly thetaB: number;
  readonly neckQ: number;
  readonly neckB: number;
}

function readRig(build: Build, body: Body): Rig {
  const { hind, fore } = build;
  const S = build.spine.length;
  const extension = build.stance === 'sprawl' ? 0.5 : clamp(0.95 + 0.12 * Math.log10(build.size), 0.72, 0.97);
  const hipQ = ankleHeight(hind) + extension * (hind.upper + hind.lower);
  const shoulderQ = fore ? ankleHeight(fore) + extension * (fore.upper + fore.lower) : hipQ;
  const thetaQ = Math.asin(clamp((shoulderQ + 0.55 * body.chestR - (hipQ + 0.7 * body.pelvisR)) / S, -0.7, 0.7));
  // On two legs the body pitches until it balances over the hips: a heavy tail holds it level, no tail stands it up.
  const stoop = fore ? clamp((1.6 - (hind.upper + hind.lower) / S) / 0.8, 0, 1) : 0;
  const tail = build.tail.length * body.tailR;
  const front = (build.neck + build.skull.length) * body.neckR + S * body.chestR * 0.5;
  const thetaB = build.hints.wings ? 0.5 : (Math.PI / 2) * (1 - clamp((2.2 * tail) / (tail + front), 0, 0.8)) - 0.45 * stoop;
  const hipB = ankleHeight(hind) + (extension - 0.12 * stoop) * (hind.upper + hind.lower);
  const neckQ = 0.7 + 0.5 * clamp(build.neck / S - 0.3, 0, 0.5);
  return { extension, hipQ, thetaQ, hipB, thetaB, neckQ, neckB: Math.max(thetaB - 0.1, 1.05) };
}

/** Where the body is on one frame. */
interface Pose {
  readonly far: Shape[];
  readonly farHooves: Shape[];
  readonly body: Shape[];
  readonly neck: Shape[];
  readonly head: Shape[];
  readonly ears: Shape[];
  readonly tail: Shape[];
  readonly fore: Shape[];
  readonly hind: Shape[];
  readonly horns: Shape[];
  readonly mane: Shape[];
  readonly hooves: Shape[];
  readonly marks: Shape[];
  readonly muscles: Shape[];
  readonly bones: Shape[];
  readonly lines: Array<[P, P]>;
  eye: P;
  eyeR: number;
  nose: P | null;
  shadow: { readonly x0: number; readonly x1: number };
  reached: boolean;
}

interface Motion {
  readonly p: number;
  readonly blend: number;
  readonly plan: GaitPlan;
  readonly speed: number;
  readonly clock: number;
  readonly stepMode: AnatomyMode;
}

type Piece = 'ground' | 'shadow' | 'farOutline' | 'far' | 'farHooves' | 'outline' | 'tail' | 'body' | 'neck' | 'head' | 'hindOutline' | 'hind' | 'foreOutline' | 'fore' | 'earOutline' | 'ears' | 'horns' | 'mane' | 'marks' | 'hooves' | 'lines' | 'muscles' | 'bones';

// ---------------------------------------------------------------------------
// One animal
// ---------------------------------------------------------------------------

class AnimalFigure implements Animal {
  readonly handle: Handle;
  private readonly body: Body;
  private readonly rig: Rig;
  private readonly spots: Array<readonly [number, number, number]>;
  private readonly el: Record<Piece, PathHandle>;
  private readonly eyeEl: Handle;
  private readonly noseEl: Handle;
  private readonly scale: number;
  private readonly origin: P;
  private readonly cx: number;
  private readonly groundWidth: number;
  private readonly neutral: { hind: [number, number]; fore: [number, number] };
  private speedOf: () => number = () => 0;
  private modeOf: (() => AnatomyMode) | null = null;
  private schedule: Array<{ at: number; mode: AnatomyMode }> = [];
  private phase = 0;
  private groundX = 0;
  private clock = 0;
  private blend: number;
  private settling = false;
  private layer: AnatomyLayer;
  private warned = false;
  private cache: { key: string; plan: GaitPlan } | null = null;

  constructor(
    private readonly ctx: KitContext,
    private readonly stage: StageHandle,
    private readonly build: Build,
    viewBox: ViewBox,
  ) {
    this.body = readBody(build);
    this.rig = readRig(build, this.body);
    this.blend = build.modes[0] === 'bipedal' ? 1 : 0;
    this.layer = build.show;
    const random = seeded(4099);
    this.spots = Array.from({ length: 16 }, () => [random(), random(), random()] as const);
    // Where a planted foot stands, under its hip or shoulder at rest, for four legs and for two.
    this.neutral = { hind: [0, 0], fore: [0, 0] };
    for (const b of [0, 1] as const) {
      const rest = this.pose({ p: 0, blend: b, plan: planGait(build, b ? 'bipedal' : 'quadruped', 0, 1), speed: 0, clock: 0, stepMode: b ? 'bipedal' : 'quadruped' }, true);
      this.neutral.hind[b] = rest.hindRoot[0] + build.hind.foot * Math.cos(FOOT_ANGLE[build.hind.posture]) * 0.6;
      this.neutral.fore[b] = build.fore ? rest.foreRoot[0] + build.fore.foot * Math.cos(FOOT_ANGLE[build.fore.posture]) * 0.35 : 0;
    }
    // The animal is scaled to fit the room it is given, standing in every way it can move.
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const b of build.modes.map((m) => (m === 'bipedal' ? 1 : 0))) {
      const rest = this.pose({ p: 0, blend: b, plan: planGait(build, b ? 'bipedal' : 'quadruped', 0, 1), speed: 0, clock: 0, stepMode: b ? 'bipedal' : 'quadruped' });
      for (const shape of [...rest.body, ...rest.head, ...rest.neck, ...rest.tail, ...rest.fore, ...rest.hind, ...rest.far, ...rest.horns]) {
        for (const [x, y] of outline(shape, 0)) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    const [vx, vy, vw, vh] = viewBox;
    const at: P = build.at ?? [vx + vw / 2, vy + vh * 0.86];
    const width = build.width ?? vw * 0.7;
    const room = Math.max(10, at[1] - vy - vh * 0.06);
    this.scale = Math.min(width / ((maxX - minX) * 1.15), room / (maxY * 1.12));
    this.origin = at;
    this.cx = (minX + maxX) / 2;
    this.groundWidth = (width * 1.1) / this.scale;

    const group = stage.group();
    this.handle = group;
    const path = (tone: Tone, fill = true) => stage.path('', { parent: group, tone, fill });
    const tone = build.tone;
    this.el = {
      ground: path('mid', false),
      shadow: path('faint'),
      farOutline: path('hi'),
      far: path(tone),
      farHooves: path('hi'),
      outline: path('hi'),
      tail: path(tone),
      body: path(tone),
      neck: path(tone),
      head: path(tone),
      horns: path('lo'),
      mane: path('hi'),
      marks: path('hi'),
      hindOutline: path('hi'),
      hind: path(tone),
      foreOutline: path('hi'),
      fore: path(tone),
      hooves: path('hi'),
      earOutline: path('hi'),
      ears: path(tone),
      lines: path('hi', false),
      muscles: path('a'),
      bones: path('hi'),
    };
    this.el.far.set({ opacity: 0.72 });
    this.el.mane.set({ opacity: 0.6 });
    this.el.marks.set({ opacity: 0.5 });
    this.el.shadow.set({ opacity: 0.8 });
    this.el.lines.set({ 'stroke-width': 1 });
    this.eyeEl = stage.circle(0, 0, 2, { parent: group, tone: 'hi' });
    this.noseEl = stage.circle(0, 0, 2, { parent: group, tone: 'hi' });
    if (!build.ground) this.el.ground.hide();
    this.applyLayer();
    ctx.simulate((dt) => this.step(dt), STEP);
    this.draw();
    ctx.onRedraw(() => this.draw());
  }

  // -------------------------------------------------------------------------
  // Motion
  // -------------------------------------------------------------------------

  move(options: MoveOptions): this {
    if (typeof options !== 'object' || options === null) fail('move takes { speed, mode, at }');
    for (const key of Object.keys(options)) if (!['speed', 'mode', 'at'].includes(key)) fail(`move has no "${key}"; it takes speed, mode and at`);
    const { speed, mode, at } = options;
    if (speed !== undefined) {
      if (typeof speed === 'number') {
        if (!(Number.isFinite(speed) && speed >= 0 && speed <= MAX_SPEED)) fail(`speed is metres a second, from 0 to ${MAX_SPEED}`);
        this.speedOf = () => speed;
      } else if (typeof speed === 'function') this.speedOf = speed as () => number;
      else if (typeof speed === 'object' && speed !== null && typeof (speed as { value?: unknown }).value === 'number') this.speedOf = () => (speed as { value: number }).value;
      else fail('speed is a number of metres a second, a parameter, or a function');
    }
    if (mode !== undefined) {
      if (typeof mode === 'function') this.modeOf = mode;
      else {
        if (!this.build.modes.includes(mode)) fail(`this skeleton moves ${this.build.modes.join(' or ')}, not ${String(mode)}; give it modes: [...] to allow more`);
        const when = at === undefined ? this.ctx.time() : at;
        if (!(Number.isFinite(when) && when >= 0)) fail('at is a scene time in seconds, 0 or more');
        this.schedule.push({ at: when, mode });
        this.schedule.sort((a, b) => a.at - b.at);
      }
    } else if (at !== undefined) fail('at says when to change mode; give a mode with it');
    this.ctx.markTimeUse();
    return this;
  }

  private currentSpeed(): number {
    const v = this.speedOf();
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, MAX_SPEED) : 0;
  }

  private wantedMode(): AnatomyMode {
    if (this.modeOf) {
      const m = this.modeOf();
      if (this.build.modes.includes(m)) return m;
    }
    let mode = this.build.modes[0]!;
    const now = this.ctx.time();
    for (const s of this.schedule) if (s.at <= now + 1e-9) mode = s.mode;
    return mode;
  }

  private hipNow(): number {
    return lerp(this.rig.hipQ, this.rig.hipB, this.blend);
  }

  private plan(): GaitPlan {
    const mode = this.wantedMode();
    const speed = this.currentSpeed();
    const hip = this.hipNow();
    const key = `${speed}|${mode}|${hip.toFixed(5)}`;
    if (this.cache?.key !== key) this.cache = { key, plan: planGait(this.build, mode, speed, hip) };
    return this.cache.plan;
  }

  private step(dt: number): void {
    this.clock += dt;
    if (this.ctx.reducedMotion()) return;
    const plan = this.plan();
    this.phase = (this.phase + plan.frequency * dt) % 1;
    this.groundX += this.currentSpeed() * dt;
  }

  // -------------------------------------------------------------------------
  // Readouts, from the same model that moves it
  // -------------------------------------------------------------------------

  get gait(): Gait {
    return this.plan().gait;
  }
  get mode(): AnatomyMode {
    return this.wantedMode();
  }
  get speed(): number {
    return this.currentSpeed();
  }
  get stride(): number {
    return round(this.plan().stride, 3);
  }
  get frequency(): number {
    return round(this.plan().frequency, 2);
  }
  get airborne(): number {
    return round(this.plan().airborne, 2);
  }
  get duty(): number {
    return round(this.plan().duty, 2);
  }
  get froude(): number {
    return round(this.plan().froude, 2);
  }
  get hipHeight(): number {
    return round(this.hipNow(), 3);
  }
  get posture(): FootPosture {
    return this.build.hind.posture;
  }

  // -------------------------------------------------------------------------
  // Showing and naming
  // -------------------------------------------------------------------------

  show(layer: AnatomyLayer): this {
    if (layer !== 'skin' && layer !== 'muscles' && layer !== 'bones') fail('show takes skin, muscles or bones');
    this.layer = layer;
    this.applyLayer();
    return this;
  }

  private applyLayer(): void {
    const skin = this.layer === 'skin' ? 1 : this.layer === 'muscles' ? 0.3 : 0.18;
    for (const key of ['outline', 'tail', 'body', 'hindOutline', 'hind', 'neck', 'head', 'earOutline', 'ears', 'foreOutline', 'fore', 'horns', 'hooves', 'farOutline', 'farHooves'] as const) this.el[key]!.set({ opacity: skin });
    this.el.far!.set({ opacity: 0.72 * skin });
    this.el.mane!.set({ opacity: 0.6 * skin });
    this.el.marks!.set({ opacity: 0.5 * skin });
    this.el.muscles!.show(this.layer === 'muscles');
    this.el.bones!.show(this.layer === 'bones');
  }

  piece(name: AnatomyPiece): Handle {
    const map: Record<AnatomyPiece, Piece> = { body: 'body', head: 'head', neck: 'neck', tail: 'tail', forelimbs: 'fore', hindlimbs: 'hind', muscles: 'muscles', bones: 'bones' };
    if (!Object.hasOwn(map, name)) fail(`there is no piece "${String(name)}"; the pieces are ${Object.keys(map).join(', ')}`);
    if (name === 'forelimbs' && !this.build.fore && !this.build.hints.wings) fail('this skeleton has no forelimbs');
    if (name === 'tail' && this.build.tail.length === 0) fail('this skeleton has no tail');
    return this.el[map[name]]!;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  private map(p: P): Vec2 {
    return [this.origin[0] + this.build.facing * (p[0] - this.cx) * this.scale, this.origin[1] - p[1] * this.scale];
  }

  private path(shapes: readonly Shape[], grow = 0): string {
    let d = '';
    for (const shape of shapes) {
      const pts = outline(shape, grow);
      if (pts.length < 3) continue;
      d += 'M';
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = this.map(pts[i]!);
        d += `${i ? 'L' : ''}${fmt(x)} ${fmt(y)}`;
      }
      d += 'Z';
    }
    return d;
  }

  /**
   * Starts the change between four legs and two when the wanted mode differs
   * from the pose. It runs on the engine's motion hook, playing or paused, so
   * a learner who switches posture while paused sees it happen (PRD 21.1).
   */
  private settleMode(): void {
    const target = this.wantedMode() === 'bipedal' ? 1 : 0;
    if (this.blend === target || this.settling) return;
    if (this.ctx.reducedMotion()) {
      this.blend = target;
      return;
    }
    this.settling = true;
    this.ctx.motion((dt) => {
      const goal = this.wantedMode() === 'bipedal' ? 1 : 0;
      this.blend = goal > this.blend ? Math.min(goal, this.blend + dt / TRANSITION) : Math.max(goal, this.blend - dt / TRANSITION);
      this.settling = this.blend !== goal;
      return this.settling;
    });
  }

  private draw(): void {
    this.settleMode();
    const plan = this.plan();
    const reduced = this.ctx.reducedMotion();
    const motion: Motion = { p: this.phase, blend: this.blend, plan, speed: reduced ? 0 : this.currentSpeed(), clock: this.clock, stepMode: this.wantedMode() };
    const pose = this.pose(motion);
    if (!pose.reached && !this.warned) {
      this.warned = true;
      this.ctx.warn('anatomy: a foot could not reach its place on the ground; the legs are short for this speed');
    }
    // A pixel or two of outline, whatever the scale.
    const grow = clamp(0.006 * this.scale * this.build.size + 0.8, 1.2, 2.6) / this.scale;
    const near = [...pose.body, ...pose.neck, ...pose.head, ...pose.tail, ...pose.horns, ...pose.mane];
    this.el.farOutline!.d(this.path(pose.far, grow));
    this.el.far!.d(this.path(pose.far));
    this.el.farHooves!.d(this.path(pose.farHooves));
    this.el.outline!.d(this.path(near, grow));
    this.el.tail!.d(this.path(pose.tail));
    this.el.body!.d(this.path(pose.body));
    // The near limbs lie over the body, each with its own outline, as a drawing shows them.
    this.el.hindOutline!.d(this.path(pose.hind, grow));
    this.el.hind!.d(this.path(pose.hind));
    this.el.foreOutline!.d(this.path(pose.fore, grow));
    this.el.neck!.d(this.path(pose.neck));
    this.el.head!.d(this.path(pose.head));
    this.el.earOutline!.d(this.path(pose.ears, grow));
    this.el.ears!.d(this.path(pose.ears));
    this.el.fore!.d(this.path(pose.fore));
    this.el.horns!.d(this.path(pose.horns));
    this.el.mane!.d(this.path(pose.mane));
    this.el.marks!.d(this.path(pose.marks));
    this.el.hooves!.d(this.path(pose.hooves));
    this.el.muscles!.d(this.path(pose.muscles));
    this.el.bones!.d(this.path(pose.bones));
    let lines = '';
    for (const [a, b] of pose.lines) {
      const [x0, y0] = this.map(a);
      const [x1, y1] = this.map(b);
      lines += `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}`;
    }
    this.el.lines!.d(lines);
    const [ex, ey] = this.map(pose.eye);
    this.eyeEl.set({ cx: Number(fmt(ex)), cy: Number(fmt(ey)), r: Number(fmt(Math.max(1.3, pose.eyeR * this.scale))) });
    if (pose.nose) {
      const [nx, ny] = this.map(pose.nose);
      this.noseEl.set({ cx: Number(fmt(nx)), cy: Number(fmt(ny)), r: Number(fmt(Math.max(1.2, pose.eyeR * 0.85 * this.scale))) }).show();
    } else this.noseEl.hide();
    const shadowY = this.origin[1];
    const [sx0] = this.map([pose.shadow.x0, 0]);
    const [sx1] = this.map([pose.shadow.x1, 0]);
    const rx = Math.abs(sx1 - sx0) / 2;
    const mid = (sx0 + sx1) / 2;
    const ry = Math.max(1.5, rx * 0.06);
    this.el.shadow!.d(`M${fmt(mid - rx)} ${fmt(shadowY)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(mid + rx)} ${fmt(shadowY)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(mid - rx)} ${fmt(shadowY)}Z`);
    if (this.build.ground) {
      const W = this.groundWidth;
      const spacing = W / 9;
      const x0 = this.cx - W / 2;
      let g = '';
      const [gx0, gy] = this.map([x0, 0]);
      const [gx1] = this.map([x0 + W, 0]);
      g += `M${fmt(gx0)} ${fmt(gy)}L${fmt(gx1)} ${fmt(gy)}`;
      const shift = this.groundX % spacing;
      for (let i = 0; i < 10; i++) {
        const x = x0 + i * spacing - shift;
        if (x < x0 || x > x0 + W - spacing * 0.3) continue;
        const [ax, ay] = this.map([x, 0]);
        const [bx, by] = this.map([x - spacing * 0.25, -spacing * 0.18]);
        g += `M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`;
      }
      this.el.ground!.d(g);
    }
  }

  /**
   * The whole body for one moment: the spine from the hips, the limbs placed
   * by their feet, the head and tail hung on the spine, and the shapes of
   * muscle and skin round each bone.
   */
  private pose(m: Motion): Pose;
  private pose(m: Motion, roots: true): { hindRoot: P; foreRoot: P };
  private pose(m: Motion, roots?: true): Pose | { hindRoot: P; foreRoot: P } {
    const { build, body, rig } = this;
    const { hind, fore, hints } = build;
    const S = build.spine.length;
    const { plan, p } = m;
    const b = build.modes.includes('quadruped') ? (build.modes.includes('bipedal') ? m.blend : 0) : 1;
    const twoLegs = m.stepMode === 'bipedal';
    const flex = build.spine.flex;
    const tau = 2 * Math.PI;
    // The body rises and falls with the stride: twice a stride walking and trotting, once galloping.
    const h = lerp(rig.hipQ, rig.hipB, b);
    const bob = plan.gait === 'stand' ? 0 : plan.bends ? 0.05 * h * Math.cos(tau * p) : (plan.gait === 'walk' ? 0.015 : 0.03) * h * Math.cos(2 * tau * p);
    const theta = lerp(rig.thetaQ, rig.thetaB, b) + (plan.bends ? flex * 0.06 * Math.sin(tau * p) : 0);
    const dir: P = polar(theta);
    const down: P = [Math.sin(theta), -Math.cos(theta)];
    const up: P = mul(down, -1);
    const hipJoint: P = [0, h + bob];
    const hipSpine = sub(hipJoint, mul(down, 0.7 * body.pelvisR));
    // Galloping, the back gathers as the hind feet reach forward and stretches in the air.
    const bendAngle = plan.bends ? flex * 0.45 * Math.cos(tau * p) : 0;
    const shoulderSpine = add(hipSpine, mul(dir, S * (1 - (bendAngle * bendAngle) / 8)));
    const midSpine = add(add(hipSpine, mul(dir, S / 2)), mul(up, (S * bendAngle) / 4));
    const shoulderJoint = add(shoulderSpine, mul(down, 0.55 * body.chestR));
    if (roots) return { hindRoot: hipJoint, foreRoot: shoulderJoint };

    const out: Pose = {
      far: [],
      farHooves: [],
      body: [],
      neck: [],
      head: [],
      ears: [],
      tail: [],
      fore: [],
      hind: [],
      horns: [],
      mane: [],
      hooves: [],
      marks: [],
      muscles: [],
      bones: [],
      lines: [],
      eye: [0, 0],
      eyeR: 0,
      nose: null,
      shadow: { x0: 0, x1: 0 },
      reached: true,
    };
    const bone = (a: P, c: P, r: number) => out.bones.push(cap(a, r, c, r * 0.8));

    // Trunk: pelvis, waist and chest hang below the spine.
    // The chest is deep and the haunch rounded; the waist between them tucks up in runners.
    const pelvisC = add(add(hipSpine, mul(down, 0.72 * body.pelvisR)), mul(dir, 0.25 * body.pelvisR));
    const waistC = add(midSpine, mul(down, 0.8 * body.waistR));
    const chestC = add(add(shoulderSpine, mul(down, 0.88 * body.chestR)), mul(dir, -0.5 * body.chestR));
    out.body.push(
      ell(pelvisC, body.pelvisR * 0.95, body.pelvisR * 0.85, theta),
      ell(chestC, body.chestR * 0.95, body.chestR, theta),
      cap(pelvisC, body.pelvisR * 0.8, waistC, body.waistR),
      cap(waistC, body.waistR, chestC, body.chestR * 0.85),
      cap(hipSpine, body.waistR * 0.35, midSpine, body.waistR * 0.35),
      cap(midSpine, body.waistR * 0.35, shoulderSpine, body.waistR * 0.4),
    );
    if (hints.hump) out.body.push(ell(add(midSpine, mul(up, body.waistR * 0.35)), S * 0.18, body.waistR * 0.55, theta));
    if (hints.wings) out.fore.push(cap(add(shoulderSpine, mul(down, body.chestR * 0.3)), body.chestR * 0.75, add(add(hipSpine, mul(dir, -body.pelvisR * 0.8)), mul(down, body.pelvisR * 0.1)), body.chestR * 0.12));
    out.muscles.push(cap(hipSpine, body.waistR * 0.3, shoulderSpine, body.waistR * 0.3));
    bone(hipSpine, midSpine, body.waistR * 0.09);
    bone(midSpine, shoulderSpine, body.waistR * 0.09);
    for (let i = 0; i < 5; i++) {
      const at = lerpP(midSpine, shoulderSpine, 0.1 + i * 0.2);
      bone(at, add(add(at, mul(down, body.chestR * 1.45)), mul(dir, -body.chestR * 0.35)), body.waistR * 0.045);
    }
    bone(hipSpine, hipJoint, body.waistR * 0.08);

    // Coat: spots and stripes fall on the trunk, where they are always inside the body.
    if (hints.coat === 'spotted') {
      for (const [u, v, s] of this.spots) {
        const c = lerpP(pelvisC, chestC, u);
        const r = lerp(body.pelvisR, body.chestR, u);
        out.marks.push(ell(add(c, mul(down, (v - 0.4) * r * 1.2)), r * (0.09 + 0.06 * s), r * (0.08 + 0.05 * s)));
      }
    } else if (hints.coat === 'striped') {
      for (let i = 0; i < 7; i++) {
        const t = 0.06 + i * 0.14;
        const top = lerpP(hipSpine, shoulderSpine, t);
        const r = lerp(body.pelvisR, body.chestR, t);
        out.marks.push(cap(add(top, mul(down, r * 0.2)), r * 0.09, add(add(top, mul(down, r * 1.2)), mul(dir, -r * 0.2)), r * 0.03));
      }
    }

    // Neck and head, hung from the front of the spine.
    const nod = plan.gait === 'stand' ? 0.02 * Math.sin(m.clock * 0.8) : 0.05 * Math.sin(2 * tau * p);
    const neckAngle = lerp(rig.neckQ, rig.neckB, b) + nod;
    const neckBase = add(add(shoulderSpine, mul(dir, body.chestR * 0.1)), mul(down, body.neckR * 0.3));
    const neckEnd = add(neckBase, polar(neckAngle, Math.max(build.neck, body.neckR * 0.5)));
    out.neck.push(cap(neckBase, Math.max(body.neckR * 1.15, body.chestR * 0.6), neckEnd, body.neckR));
    out.muscles.push(cap(neckBase, body.neckR * 0.8, neckEnd, body.neckR * 0.6));
    bone(shoulderSpine, neckEnd, body.waistR * 0.07);
    if (hints.mane) {
      const top = polar(neckAngle + Math.PI / 2);
      out.mane.push(cap(add(neckBase, mul(top, body.neckR * 0.9)), body.neckR * 0.5, add(neckEnd, mul(top, body.neckR * 0.85)), body.neckR * 0.35));
    }
    const psi = lerp(-0.45, hints.wings ? 0 : -0.1, b) - nod * 0.5;
    const hd = polar(psi);
    const hu = polar(psi + Math.PI / 2);
    const cr = body.craniumR;
    const sk = build.skull.length;
    const cranium = add(add(neckEnd, mul(hd, cr * 0.5)), mul(hu, cr * 0.35));
    const back = sub(cranium, mul(hd, cr));
    const face = Math.max(cr * 1.2, sk * (1 - build.skull.snout));
    const snoutStart = add(add(back, mul(hd, face)), mul(hu, -cr * 0.15));
    const tip = add(add(back, mul(hd, sk)), mul(hu, -cr * 0.25));
    out.head.push(ell(cranium, cr, cr * 0.92, psi));
    if (len(sub(tip, snoutStart)) > 0.02 * sk) out.head.push(cap(snoutStart, cr * 0.62, tip, hints.beak ? cr * 0.05 : cr * 0.32));
    out.muscles.push(ell(add(add(cranium, mul(hd, cr * 0.35)), mul(hu, -cr * 0.35)), cr * 0.5, cr * 0.36, psi));
    out.bones.push(ell(cranium, cr * 0.75, cr * 0.65, psi), cap(snoutStart, cr * 0.3, tip, cr * 0.12));
    out.eye = add(add(cranium, mul(hd, cr * 0.55 + clamp(face - cr * 1.2, 0, cr * 0.6))), mul(hu, cr * 0.25));
    out.eyeR = cr * 0.15;
    if (!hints.beak && len(sub(tip, snoutStart)) > cr * 0.4) {
      out.nose = add(tip, mul(hd, cr * 0.22));
      out.lines.push([add(tip, mul(hu, -cr * 0.2)), add(lerpP(snoutStart, tip, 0.35), mul(hu, -cr * 0.42))]);
    }
    if (hints.whiskers) {
      const root = add(tip, mul(hd, -cr * 0.1));
      for (const a of [0.3, 0, -0.3]) out.lines.push([root, add(root, polar(psi + a, cr * 1.3))]);
    }
    const earRoot = add(add(cranium, mul(hu, cr * 0.72)), mul(hd, -cr * 0.35));
    const earDir = polar(psi + Math.PI / 2 + 0.45);
    const swing = plan.gait === 'stand' ? 0 : 0.15 * Math.sin(tau * p * 2);
    switch (hints.ears) {
      case 'small':
        out.ears.push(cap(earRoot, cr * 0.22, add(earRoot, mul(earDir, cr * 0.45)), cr * 0.09));
        break;
      case 'pointed':
        out.ears.push(cap(earRoot, cr * 0.28, add(earRoot, mul(earDir, cr * 0.9)), cr * 0.04));
        break;
      case 'round':
        out.ears.push(ell(add(earRoot, mul(earDir, cr * 0.38)), cr * 0.42, cr * 0.38, psi));
        break;
      case 'floppy':
        out.ears.push(cap(add(earRoot, mul(hd, -cr * 0.05)), cr * 0.26, add(add(earRoot, mul(hu, -cr * 0.95)), mul(hd, -cr * (0.3 + swing))), cr * 0.22));
        break;
      case 'long':
        out.ears.push(cap(earRoot, cr * 0.2, add(earRoot, mul(polar(psi + Math.PI / 2 + 0.6 + swing), cr * 2.2)), cr * 0.17));
        break;
      default:
        break;
    }
    if (hints.horns) {
      const base = add(cranium, mul(hu, cr * 0.75));
      const mid = add(base, mul(polar(psi + Math.PI / 2 - 0.35), cr * 0.9));
      out.horns.push(cap(base, cr * 0.16, mid, cr * 0.1), cap(mid, cr * 0.1, add(mid, mul(polar(psi + 0.5), cr * 0.6)), cr * 0.02));
    }
    if (hints.trunk) {
      let at = tip;
      let a = psi - 0.9;
      for (let i = 0; i < 4; i++) {
        const next = add(at, polar(a, sk * 0.42));
        out.head.push(cap(at, cr * (0.32 - i * 0.05), next, cr * (0.27 - i * 0.05)));
        at = next;
        a -= 0.25 + 0.08 * Math.sin(m.clock + i);
      }
    }

    // Tail: a chain from the pelvis that droops as it softens and swings with the stride.
    if (build.tail.length > 0.001) {
      const stiff = build.tail.stiffness;
      let at = add(add(hipSpine, mul(dir, -body.pelvisR * 0.35)), mul(down, body.pelvisR * 0.1));
      let a = theta + Math.PI + 0.3 + 0.6 * (1 - stiff) - Math.min(0.35, 0.05 * m.speed);
      const segments = 5;
      const sway = (1 - stiff) * 0.3 * Math.min(1, m.speed / (0.5 + build.size));
      for (let i = 0; i < segments; i++) {
        const r0 = body.tailR * (1 - (0.7 * i) / segments);
        const r1 = body.tailR * (1 - (0.7 * (i + 1)) / segments);
        a += (1 - stiff) * 0.12 + sway * Math.sin(tau * p - i * 0.8) + 0.04 * (1 - stiff) * Math.sin(m.clock * 1.1 + i * 0.5);
        let next = add(at, polar(a, build.tail.length / segments));
        // A long tail that reaches the ground trails along it.
        if (next[1] < r1) {
          a = Math.PI + 0.05;
          next = [at[0] - build.tail.length / segments, Math.max(r1, at[1] - 0.2 * r1)];
        }
        out.tail.push(cap(at, r0, next, r1));
        bone(at, next, Math.max(r1 * 0.25, body.waistR * 0.03));
        at = next;
      }
    }

    // Limbs. Each foot is placed on the ground by the gait, and the leg reaches it.
    const legs = [0, 1, 2, 3] as const;
    for (const k of legs) {
      const isHind = k === 0 || k === 2;
      const near = k < 2;
      const limb = isHind ? hind : fore;
      if (!limb) continue;
      const root = isHind ? hipJoint : shoulderJoint;
      const toeR = isHind ? body.hockR * 0.95 : body.wristR * 0.95;
      const angle = FOOT_ANGLE[limb.posture];
      let toe: P;
      let footAngle = angle;
      const placed = (neutralX: number): P => {
        const foot = placeFoot(plan, k, p, neutralX);
        footAngle = Math.min(1.45, angle + (foot.planted ? 0.6 * smooth((foot.progress - 0.6) / 0.4) : 0.7 * Math.sin(Math.PI * foot.progress)));
        const lift = 0.12 * (limb.upper + limb.lower) * (0.6 + Math.min(plan.froude, 4) * 0.15);
        return [foot.x, toeR + lift * foot.lift];
      };
      let bend = isHind ? 1 : -1;
      let ankle: P;
      if (isHind) {
        toe = placed(lerp(this.neutral.hind[0], this.neutral.hind[1], b));
        ankle = add(toe, [-limb.foot * Math.cos(footAngle), limb.foot * Math.sin(footAngle)]);
      } else {
        // Forelimbs stand in the gait on four legs and hang and swing as arms on two.
        const standing = twoLegs ? ([this.neutral.fore[0], toeR] as P) : placed(this.neutral.fore[0]);
        const standAnkle = add(standing, [-limb.foot * Math.cos(footAngle), limb.foot * Math.sin(footAngle)]);
        const armSwing = 0.35 * Math.min(1, m.speed / 1.5) * Math.sin(tau * (p + (k === 1 ? 0.5 : 0)));
        const hang = add(root, polar(-Math.PI / 2 + armSwing + 0.15, 0.9 * (limb.upper + limb.lower)));
        ankle = lerpP(standAnkle, hang, b);
        const handAngle = -Math.PI / 2 + armSwing + 0.35;
        toe = lerpP(standing, add(hang, polar(handAngle, limb.foot)), b);
        bend = -1;
      }
      const reach = reachTo(root, ankle, limb.upper, limb.lower, bend);
      if (!reach.reached && (isHind || b < 0.5)) out.reached = false;
      if (len(sub(reach.end, ankle)) > 1e-6) toe = add(toe, sub(reach.end, ankle));
      ankle = reach.end;
      const knee = reach.joint;
      const upperR0 = isHind ? body.thighR * 0.85 : body.shoulderR * 0.85;
      const midR = isHind ? body.kneeR : body.elbowR;
      const lowR = isHind ? body.hockR : body.wristR;
      const bodyRoot = isHind ? pelvisC : chestC;
      const shapes: Shape[] = [
        cap(bodyRoot, (isHind ? body.pelvisR : body.chestR) * 0.8, root, upperR0),
        cap(root, upperR0, knee, midR),
        cap(knee, midR, ankle, lowR),
        cap(ankle, lowR, toe, toeR),
        ell(lerpP(root, knee, 0.42), 0.55 * limb.upper, isHind ? body.thighR : body.shoulderR, Math.atan2(knee[1] - root[1], knee[0] - root[0])),
      ];
      const hoof = limb.posture === 'unguligrade' ? [cap(lerpP(ankle, toe, 0.7), lowR * 0.95, toe, toeR * 1.1)] : [];
      if (near) {
        (isHind ? out.hind : out.fore).push(...shapes.slice(1));
        out.hooves.push(...hoof);
        out.muscles.push(
          ell(lerpP(root, knee, 0.42), 0.5 * limb.upper, (isHind ? body.thighR : body.shoulderR) * 0.85, Math.atan2(knee[1] - root[1], knee[0] - root[0])),
          ell(lerpP(knee, ankle, 0.35), 0.38 * limb.lower, midR * 0.9, Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0])),
        );
        const r = body.waistR * 0.07;
        bone(isHind ? hipJoint : add(shoulderSpine, mul(dir, -body.chestR * 0.3)), root, r);
        bone(root, knee, r);
        bone(knee, ankle, r * 0.8);
        bone(ankle, toe, r * 0.6);
        for (const j of [root, knee, ankle]) out.bones.push(ell(j, r * 1.6, r * 1.6));
      } else {
        out.far.push(...shapes.slice(1));
        out.farHooves.push(...hoof);
      }
    }
    const xs = [hipJoint[0] - body.pelvisR, shoulderJoint[0] + body.chestR];
    out.shadow = { x0: Math.min(...xs), x1: Math.max(...xs) };
    return out;
  }
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

export class AnatomyKit implements Anatomy {
  readonly stage: StageHandle;
  private readonly viewBox: ViewBox;
  private animals = 0;

  constructor(
    private readonly ctx: KitContext,
    options: AnatomyOptions,
  ) {
    this.stage = ctx.stage;
    this.viewBox = anatomyLayout(options).viewBox;
  }

  skeleton(spec: SkeletonSpec | ExampleSkeleton, changes?: SkeletonSpec): Animal {
    if (this.animals >= MAX_ANIMALS) fail(`a stage draws at most ${MAX_ANIMALS} animals`);
    this.animals++;
    return new AnimalFigure(this.ctx, this.stage, readSkeleton(spec, changes), this.viewBox);
  }

  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T {
    this.stage.part(name, item as unknown as Handle, options);
    return item;
  }
}

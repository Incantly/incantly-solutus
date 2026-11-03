import type {
  Anatomy,
  AnatomyLayer,
  AnatomyMode,
  AnatomyOptions,
  AnatomyPiece,
  Animal,
  FootPosture,
  Gait,
  Handle,
  MoveOptions,
  PartOptions,
  PathHandle,
  SkeletonSpec,
  SkinBone,
  SkinShape,
  Tone,
  Vec2,
  ViewBox,
} from '../../api/types';
import type { KitContext } from '../../runtime/kit';
import { fmt } from '../../scene/format';
import { TONES, type StageHandle } from '../../scene/handles';
import { planGait, type GaitPlan } from './gait';
import { fail, readSkeleton, type Build, type Limb } from './skeleton';

export const DEFAULT_ANATOMY_VIEWBOX: ViewBox = [0, 0, 800, 400];
const MAX_ANIMALS = 6;
const GAITS: readonly Gait[] = ['stand', 'walk', 'trot', 'gallop', 'bound', 'run'];
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
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * 2 * Math.PI;
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
  const nb = Math.max(3, Math.round((10 * phi) / Math.PI));
  for (let i = 0; i <= nb; i++) pts.push(add(shape.b, polar(a - phi + (2 * phi * i) / nb, rb)));
  const na = Math.max(3, Math.round((10 * (Math.PI - phi)) / Math.PI));
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
  // A bird carries its body nearly level over its legs, its tail and neck balancing each other.
  const thetaB = build.wings ? 0.3 : (Math.PI / 2) * (1 - clamp((2.2 * tail) / (tail + front), 0, 0.8)) - 0.45 * stoop;
  const hipB = ankleHeight(hind) + (extension - 0.12 * stoop) * (hind.upper + hind.lower);
  const neckQ = 0.7 + 0.5 * clamp(build.neck / S - 0.3, 0, 0.5);
  return { extension, hipQ, thetaQ, hipB, thetaB, neckQ, neckB: Math.max(thetaB - 0.1, 1.05) };
}

// ---------------------------------------------------------------------------
// Bone frames: where skin is drawn
// ---------------------------------------------------------------------------

export const SKIN_BONES: readonly SkinBone[] = ['spine', 'neck', 'skull', 'ear', 'tail', 'wing', 'hindleg', 'thigh', 'shin', 'hindfoot', 'foreleg', 'upperArm', 'forearm', 'forefoot'];
/** Bones on a leg, whose skin is drawn on the near and the far side. */
const LIMB_BONES: ReadonlySet<SkinBone> = new Set(['hindleg', 'thigh', 'shin', 'hindfoot', 'foreleg', 'upperArm', 'forearm', 'forefoot']);
const HIND_BONES: ReadonlySet<SkinBone> = new Set(['hindleg', 'thigh', 'shin', 'hindfoot']);
/** Each bone of a leg belongs to its chain: replacing the chain's skin replaces theirs. */
const CHAIN: Readonly<Partial<Record<SkinBone, SkinBone>>> = { thigh: 'hindleg', shin: 'hindleg', hindfoot: 'hindleg', upperArm: 'foreleg', forearm: 'foreleg', forefoot: 'foreleg' };
const SKIN_KINDS = ['flesh', 'part', 'mark', 'line'] as const;
type SkinKind = (typeof SKIN_KINDS)[number];
/** Pieces of skin an animal may carry. */
const MAX_SKIN = 40;
const MAX_POINTS = 48;
/** How far from its bone, in bone lengths, a point of skin may be before it would float off. */
const SKIN_REACH = 3;

/** A bone as the skin sees it: the line it runs along, and whether across points to its right rather than its left. */
interface Frame {
  readonly points: readonly P[];
  readonly flip: boolean;
  /** The kit's skin's half-width at each point, in metres, where it is round the bone (legs and tail), to hold marks inside it. */
  readonly radii?: readonly number[];
}

const unit = (v: P): P => {
  const l = len(v);
  return l > 1e-12 ? [v[0] / l, v[1] / l] : [0, 1];
};

/**
 * Maps [along, across], in lengths of the frame, to the body's metres. The
 * normal blends between the segments at each joint, so skin drawn across a
 * knee or along a bending back bends with it instead of cracking.
 */
export function onFrame(frame: Frame, along: number, across: number): P {
  const pts = frame.points;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    segs.push(len(sub(pts[i + 1]!, pts[i]!)));
    total += segs[i]!;
  }
  if (segs.length === 0 || total < 1e-12) return pts[0] ?? [0, 0];
  const d = along * total;
  let i = 0;
  let start = 0;
  while (i < segs.length - 1 && start + segs[i]! < d) {
    start += segs[i]!;
    i++;
  }
  const u = (d - start) / Math.max(segs[i]!, 1e-12);
  const point = lerpP(pts[i]!, pts[i + 1]!, u);
  const left = (k: number): P => {
    const v = unit(sub(pts[k + 1]!, pts[k]!));
    return [-v[1], v[0]];
  };
  const a = i > 0 ? unit(add(left(i - 1), left(i))) : left(i);
  const b = i < segs.length - 1 ? unit(add(left(i), left(i + 1))) : left(i);
  const n = unit(lerpP(a, b, clamp(u, 0, 1)));
  return add(point, mul(n, (frame.flip ? -across : across) * total));
}

/** The skin's half-width at `along`, in lengths of the frame, or null where the frame does not know it. */
export function halfWidth(frame: Frame, along: number): number | null {
  const { points: pts, radii } = frame;
  if (!radii || radii.length !== pts.length || pts.length < 2) return null;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    segs.push(len(sub(pts[i + 1]!, pts[i]!)));
    total += segs[i]!;
  }
  if (total < 1e-12) return null;
  let d = clamp(along, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i]! || i === segs.length - 1) return lerp(radii[i]!, radii[i + 1]!, clamp(d / Math.max(segs[i]!, 1e-12), 0, 1)) / total;
    d -= segs[i]!;
  }
  return null;
}

/** Twice the signed area: positive when the points run counter-clockwise. */
function area(pts: readonly P[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

/** A path through stage points: a smooth Catmull-Rom curve or straight sides, closed or open. */
function curve(pts: readonly Vec2[], closed: boolean, smoothly: boolean): string {
  const n = pts.length;
  if (n < 2) return '';
  let d = `M${fmt(pts[0]![0])} ${fmt(pts[0]![1])}`;
  if (!smoothly) {
    for (let i = 1; i < n; i++) d += `L${fmt(pts[i]![0])} ${fmt(pts[i]![1])}`;
    return closed ? `${d}Z` : d;
  }
  const at = (i: number): Vec2 => (closed ? pts[((i % n) + n) % n]! : pts[clamp(i, 0, n - 1)]!);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Vec2 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Vec2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

/** A shape of the kit's own skin, and the bone it belongs to, so a scene can replace it. */
type Skin = Shape & { readonly bone: SkinBone };
const on = (bone: SkinBone, ...shapes: Shape[]): Skin[] => shapes.map((shape) => ({ ...shape, bone }));

/** Where the body is on one frame. */
interface Pose {
  readonly far: Skin[];
  readonly farHooves: Skin[];
  readonly body: Skin[];
  readonly neck: Skin[];
  readonly head: Skin[];
  readonly ears: Skin[];
  readonly tail: Skin[];
  readonly fore: Skin[];
  readonly hind: Skin[];
  readonly hooves: Skin[];
  readonly muscles: Shape[];
  readonly bones: Shape[];
  readonly mouth: Array<[P, P]>;
  readonly frames: Partial<Record<SkinBone, Frame>>;
  readonly farFrames: Partial<Record<SkinBone, Frame>>;
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
  /** Radians the neck is raised. */
  readonly neck?: number;
}

/** The layers an animal is drawn in, back to front: each its outlines, then its fills. */
type LayerName = 'far' | 'body' | 'hind' | 'fore' | 'ear';
interface Layer {
  readonly group: Handle;
  readonly line: PathHandle;
  readonly fills: Handle;
  readonly flesh: PathHandle;
}

/** A piece of skin a scene drew, in its bone's frame. */
interface SkinPiece {
  readonly bone: SkinBone;
  readonly kind: SkinKind;
  readonly local: readonly P[];
  readonly closed: boolean;
  readonly smooth: boolean;
  /** Its own elements, near and far: an outline and a fill for a part, a fill for a mark, a stroke for a line. */
  readonly near: { readonly line?: PathHandle; readonly fill: PathHandle } | null;
  readonly far: { readonly line?: PathHandle; readonly fill: PathHandle } | null;
}

/**
 * The piece a name means. Besides the pieces' own names it takes the skin's
 * bone names (spine, skull, hindleg, upperArm…) and the words a scene uses
 * for them ("front left leg", "back legs", "trunk", "mane"): one side of a
 * pair is the pair, as the near and far legs are drawn as one piece.
 */
export function pieceNamed(name: unknown): AnatomyPiece | null {
  if (typeof name !== 'string') return null;
  const n = name.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!n) return null;
  const exact: Record<string, AnatomyPiece> = { body: 'body', head: 'head', neck: 'neck', tail: 'tail', forelimbs: 'forelimbs', hindlimbs: 'hindlimbs', muscles: 'muscles', bones: 'bones' };
  if (Object.hasOwn(exact, n)) return exact[n]!;
  if (/\b(muscle|muscles)\b/.test(n)) return 'muscles';
  if (/\b(bone|bones|skeleton|ribs)\b/.test(n)) return 'bones';
  if (/\btail\b/.test(n)) return 'tail';
  if (/\b(neck|mane|throat)\b/.test(n)) return 'neck';
  if (/\b(head|skull|face|muzzle|snout|ear|ears|eye|eyes|nose|mouth|jaw|beak|trunk|horn|horns|tusk|tusks)\b/.test(n)) return 'head';
  if (/\b(fore|front|arm|arms|upperarm|forearm|forefoot|foreleg|forelegs|forelimb|hand|hands|wing|wings|shoulder)\b/.test(n)) return 'forelimbs';
  if (/\b(hind|back leg|back legs|rear|thigh|shin|hindfoot|hindleg|hindlegs|hindlimb|leg|legs|foot|feet|paw|paws|hoof|hooves|hip|hips)\b/.test(n)) return 'hindlimbs';
  if (/\b(spine|back|torso|trunk|chest|belly|barrel|haunch|coat)\b/.test(n)) return 'body';
  return null;
}

// ---------------------------------------------------------------------------
// One animal
// ---------------------------------------------------------------------------

class AnimalFigure implements Animal {
  readonly handle: Handle;
  private readonly body: Body;
  private readonly rig: Rig;
  private readonly layers: Record<LayerName, Layer>;
  private readonly pieces: Record<'tail' | 'body' | 'neck' | 'head' | 'hind' | 'fore' | 'ears' | 'far' | 'hooves' | 'foreHooves' | 'farHooves', PathHandle>;
  private readonly face: { readonly group: Handle; readonly eye: Handle; readonly nose: Handle; readonly mouth: PathHandle };
  private readonly ground: PathHandle;
  private readonly shadow: PathHandle;
  private readonly muscles: PathHandle;
  private readonly bones: PathHandle;
  private readonly skins: SkinPiece[] = [];
  /** Pieces handed out, by the name asked for, and the clear copies that trace a piece under a second name. */
  private readonly asked = new Map<string, Handle>();
  private readonly handedOut = new Set<AnatomyPiece>();
  private readonly mirrors: Array<{ readonly piece: AnatomyPiece; readonly el: PathHandle }> = [];
  private readonly replaced = new Set<SkinBone>();
  private readonly outlinePx: number;
  private readonly ink: Tone;
  private readonly cx: number;
  private readonly slot: number;
  private readonly neutral: { hind: [number, number]; fore: [number, number] };
  private speedOf: () => number = () => 0;
  private gaitOf: (() => Gait) | null = null;
  private neckOf: () => number = () => 0;
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
    private readonly layout: Layout,
  ) {
    this.body = readBody(build);
    this.rig = readRig(build, this.body);
    this.blend = build.modes[0] === 'bipedal' ? 1 : 0;
    this.layer = build.show;
    const rest = (b: 0 | 1) => ({ p: 0, blend: b, plan: planGait(build, b ? 'bipedal' : 'quadruped', 0, 1), speed: 0, clock: 0, stepMode: (b ? 'bipedal' : 'quadruped') as AnatomyMode });
    // Where a planted foot stands, under its hip or shoulder at rest, for four legs and for two.
    this.neutral = { hind: [0, 0], fore: [0, 0] };
    for (const b of [0, 1] as const) {
      const roots = this.pose(rest(b), true);
      this.neutral.hind[b] = roots.hindRoot[0] + build.hind.foot * Math.cos(FOOT_ANGLE[build.hind.posture]) * 0.6;
      this.neutral.fore[b] = build.fore ? roots.foreRoot[0] + build.fore.foot * Math.cos(FOOT_ANGLE[build.fore.posture]) * 0.35 : 0;
    }
    // The animal is scaled to fit the room it is given, standing in every way it can move.
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const b of build.modes.map((m) => (m === 'bipedal' ? 1 : 0) as 0 | 1)) {
      const pose = this.pose(rest(b));
      for (const shape of [...pose.body, ...pose.head, ...pose.ears, ...pose.neck, ...pose.tail, ...pose.fore, ...pose.hind, ...pose.far]) {
        for (const [x, y] of outline(shape, 0)) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    this.cx = (minX + maxX) / 2;
    // The stage places every animal together, at one scale, so their sizes compare as they do in life.
    this.slot = layout.add({ span: maxX - minX, height: maxY, ...(build.at ? { at: build.at } : {}), ...(build.width !== undefined ? { width: build.width } : {}) });
    // A pixel or two of outline, whatever the scale.
    this.outlinePx = clamp(0.006 * this.scale * build.size + 0.8, 1.2, 2.6);

    const group = stage.group();
    this.handle = group;
    const tone = build.tone;
    this.ground = stage.path('', { parent: group, tone: 'mid' });
    this.shadow = stage.path('', { parent: group, tone: 'faint', fill: true });
    this.shadow.set({ opacity: 0.8 });
    // A dark body is outlined in a lighter tone, so its near legs still stand out from it.
    const ink: Tone = tone === 'hi' ? 'mid' : 'hi';
    this.ink = ink;
    // Outlines are strokes drawn behind the fills: where shapes overlap, the fills cover the strokes between them, so the body has one outline.
    const layer = (): Layer => {
      const g = stage.group({ parent: group });
      const line = stage.path('', { parent: g, tone: ink });
      line.set({ 'stroke-width': Number(fmt(2 * this.outlinePx)) });
      const fills = stage.group({ parent: g });
      return { group: g, line, fills, flesh: null as unknown as PathHandle };
    };
    const fill = (l: Layer, t = tone) => stage.path('', { parent: l.fills, tone: t, fill: true });
    const far = layer();
    const bodyLayer = layer();
    const hindLayer = layer();
    const foreLayer = layer();
    const earLayer = layer();
    this.pieces = {
      far: fill(far),
      farHooves: fill(far, 'hi'),
      tail: fill(bodyLayer),
      body: fill(bodyLayer),
      neck: fill(bodyLayer),
      head: fill(bodyLayer),
      hind: fill(hindLayer),
      hooves: fill(hindLayer, 'hi'),
      fore: fill(foreLayer),
      foreHooves: fill(foreLayer, 'hi'),
      ears: fill(earLayer),
    };
    // A scene's flesh joins each layer's own fills, under the parts and marks it adds later.
    const withFlesh = (l: Layer): Layer => ({ ...l, flesh: fill(l) });
    this.layers = { far: withFlesh(far), body: withFlesh(bodyLayer), hind: withFlesh(hindLayer), fore: withFlesh(foreLayer), ear: withFlesh(earLayer) };
    const faceGroup = stage.group({ parent: group });
    this.face = {
      group: faceGroup,
      eye: stage.circle(0, 0, 2, { parent: faceGroup, tone: 'hi' }),
      nose: stage.circle(0, 0, 2, { parent: faceGroup, tone: 'hi' }),
      mouth: stage.path('', { parent: faceGroup, tone: 'hi' }),
    };
    this.face.mouth.set({ 'stroke-width': 1 });
    this.muscles = stage.path('', { parent: group, tone: 'a', fill: true });
    this.bones = stage.path('', { parent: group, tone: 'hi', fill: true });
    if (!build.ground) this.ground.hide();
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
    for (const key of Object.keys(options)) if (!['speed', 'mode', 'at', 'gait', 'neck'].includes(key)) fail(`move has no "${key}"; it takes speed, mode, at, gait and neck`);
    const { speed, mode, at, gait, neck } = options;
    if (gait !== undefined) {
      if (typeof gait === 'function') this.gaitOf = gait;
      else {
        if (!GAITS.includes(gait)) fail(`gait is ${GAITS.join(', ')}`);
        this.gaitOf = () => gait;
      }
    }
    if (neck !== undefined) {
      if (typeof neck === 'number') {
        if (!(Number.isFinite(neck) && Math.abs(neck) <= 60)) fail('neck is degrees, from -60 to 60');
        this.neckOf = () => neck;
      } else if (typeof neck === 'function') this.neckOf = neck as () => number;
      else if (typeof neck === 'object' && neck !== null && typeof (neck as { value?: unknown }).value === 'number') this.neckOf = () => (neck as { value: number }).value;
      else fail('neck is degrees: a number, a parameter, or a function');
    }
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
        // A new instruction replaces any for later; of those already past, only the latest still counts.
        // So a scene may call move every frame without the schedule growing.
        const now = this.ctx.time();
        const kept = this.schedule.filter((s) => s.at < when);
        const past = kept.filter((s) => s.at <= now);
        this.schedule = [...past.slice(-1), ...kept.filter((s) => s.at > now), { at: when, mode }];
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
    const asked = this.gaitOf?.();
    const gait = typeof asked === 'string' && GAITS.includes(asked) ? asked : undefined;
    const key = `${speed}|${mode}|${hip.toFixed(5)}|${gait ?? ''}`;
    if (this.cache?.key !== key) this.cache = { key, plan: planGait(this.build, mode, speed, hip, gait) };
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
  // Skin the scene draws
  // -------------------------------------------------------------------------

  /** Whether a bone exists on this skeleton, to draw skin on. */
  private hasBone(bone: SkinBone): boolean {
    if (bone === 'tail') return this.build.tail.length > 0;
    if (bone === 'wing') return this.build.wings;
    if (LIMB_BONES.has(bone) && !HIND_BONES.has(bone)) return this.build.fore !== null;
    return true;
  }

  skin(bone: SkinBone, shape: SkinShape): Handle {
    if (!SKIN_BONES.includes(bone)) fail(`there is no bone "${String(bone)}" to draw skin on; the bones are ${SKIN_BONES.join(', ')}`);
    if (!this.hasBone(bone)) fail(`this skeleton has no ${bone}`);
    if (typeof shape !== 'object' || shape === null) fail('skin takes a shape: { points } or { at, r }, with as, tone, smooth and replace');
    for (const key of Object.keys(shape)) if (!['points', 'at', 'r', 'smooth', 'as', 'tone', 'replace'].includes(key)) fail(`a skin shape has no "${key}"; it takes points, at, r, smooth, as, tone and replace`);
    if (this.skins.length >= MAX_SKIN) fail(`an animal carries at most ${MAX_SKIN} pieces of skin`);
    const kind: SkinKind = shape.as ?? 'flesh';
    if (!SKIN_KINDS.includes(kind)) fail(`as is ${SKIN_KINDS.join(', ')}`);
    const coord = (v: unknown, what: string): number => {
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} is a number of bone lengths`);
      if (Math.abs(v) > SKIN_REACH) fail(`${what} is ${v} bone lengths from the ${bone}; skin that far away would float off it, so keep within ${SKIN_REACH}`);
      return v;
    };
    let local: P[];
    let closed = kind !== 'line';
    if (shape.points !== undefined) {
      if (shape.at !== undefined || shape.r !== undefined) fail('give points, or at and r, not both');
      const least = kind === 'line' ? 2 : 3;
      if (!Array.isArray(shape.points) || shape.points.length < least || shape.points.length > MAX_POINTS) fail(`points is a list of ${least} to ${MAX_POINTS} [along, across] pairs`);
      local = shape.points.map((p, i) => {
        if (!Array.isArray(p) || p.length !== 2) fail(`points[${i}] is [along, across]`);
        return [coord(p[0], `points[${i}][0]`), coord(p[1], `points[${i}][1]`)] as P;
      });
    } else if (shape.at !== undefined) {
      if (kind === 'line') fail('a line takes points');
      if (!Array.isArray(shape.at) || shape.at.length !== 2) fail('at is [along, across]');
      const c: P = [coord(shape.at[0], 'at[0]'), coord(shape.at[1], 'at[1]')];
      const r = shape.r;
      const [rx, ry] = typeof r === 'number' ? [r, r] : Array.isArray(r) && r.length === 2 ? [r[0], r[1]] : [NaN, NaN];
      if (!(Number.isFinite(rx) && Number.isFinite(ry) && rx > 0 && ry > 0 && rx <= SKIN_REACH && ry <= SKIN_REACH)) fail('r is a radius in bone lengths, or [along, across] radii, above 0');
      local = Array.from({ length: 20 }, (_, i) => {
        const t = (i / 20) * 2 * Math.PI;
        return [c[0] + rx! * Math.cos(t), c[1] + ry! * Math.sin(t)] as P;
      });
      closed = true;
    } else fail('skin takes points, or at and r');
    if (shape.tone !== undefined && (typeof shape.tone !== 'string' || !TONES.has(shape.tone))) fail(`unknown tone "${String(shape.tone)}"`);
    if (shape.replace !== undefined && typeof shape.replace !== 'boolean') fail('replace is true or false');
    if (shape.smooth !== undefined && typeof shape.smooth !== 'boolean') fail('smooth is true or false');
    if (shape.replace) this.replaced.add(bone);
    const tone: Tone = shape.tone ?? (kind === 'mark' || kind === 'line' ? 'hi' : this.build.tone);
    const limb = LIMB_BONES.has(bone);
    const home = this.layers[this.layerOf(bone)];
    const make = (l: Layer) => {
      if (kind === 'flesh') return null;
      if (kind === 'line') {
        const stroke = this.stage.path('', { parent: l.fills, tone });
        stroke.set({ 'stroke-width': Number(fmt(Math.max(1, this.outlinePx * 0.7))) });
        return { fill: stroke };
      }
      const line = kind === 'part' ? this.stage.path('', { parent: l.fills, tone: this.ink }) : undefined;
      line?.set({ 'stroke-width': Number(fmt(2 * this.outlinePx)) });
      return { line, fill: this.stage.path('', { parent: l.fills, tone, fill: true }) };
    };
    const piece: SkinPiece = { bone, kind, local, closed, smooth: shape.smooth !== false, near: make(home), far: limb ? make(this.layers.far) : null };
    this.skins.push(piece);
    this.draw();
    return piece.near?.fill ?? home.flesh;
  }

  private layerOf(bone: SkinBone): LayerName {
    if (bone === 'ear') return 'ear';
    if (bone === 'wing') return 'fore';
    if (HIND_BONES.has(bone)) return 'hind';
    if (LIMB_BONES.has(bone)) return 'fore';
    return 'body';
  }

  private isReplaced(bone: SkinBone): boolean {
    const chain = CHAIN[bone];
    return this.replaced.has(bone) || (chain !== undefined && this.replaced.has(chain));
  }

  // -------------------------------------------------------------------------
  // Showing and naming
  // -------------------------------------------------------------------------

  show(layer: AnatomyLayer): this {
    if (layer !== 'skin' && layer !== 'muscles' && layer !== 'bones') fail('show takes skin, muscles or bones');
    this.layer = layer;
    this.applyLayer();
    // Muscles and bones are drawn only while they show: draw them now, playing or not.
    this.draw();
    return this;
  }

  private applyLayer(): void {
    const skin = this.layer === 'skin' ? 1 : this.layer === 'muscles' ? 0.3 : 0.18;
    for (const name of ['body', 'hind', 'fore', 'ear'] as const) this.layers[name].group.set({ opacity: skin });
    this.layers.far.group.set({ opacity: Number((0.72 * skin).toFixed(3)) });
    this.face.group.set({ opacity: skin });
    this.muscles.show(this.layer === 'muscles');
    this.bones.show(this.layer === 'bones');
  }

  piece(name: AnatomyPiece | SkinBone | (string & {})): Handle {
    const map: Record<AnatomyPiece, Handle> = {
      body: this.pieces.body,
      head: this.pieces.head,
      neck: this.pieces.neck,
      tail: this.pieces.tail,
      forelimbs: this.pieces.fore,
      hindlimbs: this.pieces.hind,
      muscles: this.muscles,
      bones: this.bones,
    };
    const key = String(name);
    const known = this.asked.get(key);
    if (known) return known;
    const piece = pieceNamed(name);
    if (!piece) fail(`there is no piece "${String(name)}"; the pieces are ${Object.keys(map).join(', ')}`);
    if (piece === 'forelimbs' && !this.build.fore && !this.build.wings) fail('this skeleton has no forelimbs');
    if (piece === 'tail' && this.build.tail.length === 0) fail('this skeleton has no tail');
    // A second name for a piece ("left leg" and "left foot" are both the near hind leg) gets an element of its own,
    // a clear copy that traces the piece, so each name can be a part a step focuses: one element holds one part name.
    if (!this.handedOut.has(piece)) {
      this.handedOut.add(piece);
      this.asked.set(key, map[piece]);
      return map[piece];
    }
    if (this.mirrors.length >= 16) fail('an animal hands out at most 16 more names for its pieces');
    const copy = this.stage.path('', { parent: this.handle, tone: this.build.tone, fill: true });
    copy.set({ 'fill-opacity': 0 });
    this.mirrors.push({ piece, el: copy });
    this.asked.set(key, copy);
    this.draw();
    return copy;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /** Pixels a metre, shared by every animal on the stage. */
  private get scale(): number {
    return this.layout.scale();
  }
  /** Where the middle of the animal stands on the ground. */
  private get origin(): P {
    return this.layout.place(this.slot).at;
  }
  private get groundWidth(): number {
    return (this.layout.place(this.slot).width * 1.1) / this.scale;
  }

  private map(p: P): Vec2 {
    return [this.origin[0] + this.build.facing * (p[0] - this.cx) * this.scale, this.origin[1] - p[1] * this.scale];
  }

  private path(shapes: readonly Shape[]): string {
    let d = '';
    for (const shape of shapes) {
      const pts = outline(shape, 0);
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

  /** A piece of the scene's skin on one side, as a stage path. */
  private skinPath(piece: SkinPiece, frame: Frame | undefined): string {
    if (!frame) return '';
    // A mark is paint on the skin: on a leg or a tail, where the kit knows the skin's width, it is held inside it.
    const hold = (a: number, c: number): number => {
      if (piece.kind !== 'mark') return c;
      const w = halfWidth(frame, a);
      return w === null ? c : clamp(c, -0.92 * w, 0.92 * w);
    };
    let pts = piece.local.map(([a, c]) => onFrame(frame, a, hold(a, c)));
    // Every closed piece winds the same way, so pieces that overlap in one path fill as one.
    if (piece.closed && area(pts) < 0) pts = pts.reverse();
    return curve(
      pts.map((p) => this.map(p)),
      piece.closed,
      piece.smooth,
    );
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
    const lift = this.neckOf();
    const neck = typeof lift === 'number' && Number.isFinite(lift) ? (clamp(lift, -60, 60) * Math.PI) / 180 : 0;
    const motion: Motion = { p: this.phase, blend: this.blend, plan, speed: reduced ? 0 : this.currentSpeed(), clock: this.clock, stepMode: this.wantedMode(), neck };
    const pose = this.pose(motion);
    if (!pose.reached && !this.warned) {
      this.warned = true;
      this.ctx.warn('anatomy: a foot could not reach its place on the ground; the legs are short for this speed');
    }
    const keep = (shapes: readonly Skin[]) => shapes.filter((s) => !this.isReplaced(s.bone));
    const far = keep(pose.far);
    const body = { tail: keep(pose.tail), body: keep(pose.body), neck: keep(pose.neck), head: keep(pose.head) };
    const hind = keep(pose.hind);
    const fore = keep(pose.fore);
    const ears = keep(pose.ears);
    // The scene's flesh on each layer, near and far.
    const flesh: Record<LayerName, string> = { far: '', body: '', hind: '', fore: '', ear: '' };
    for (const piece of this.skins) {
      const near = this.skinPath(piece, pose.frames[piece.bone]);
      const away = piece.far ? this.skinPath(piece, pose.farFrames[piece.bone]) : '';
      if (piece.kind === 'flesh') {
        flesh[this.layerOf(piece.bone)] += near;
        flesh.far += away;
        continue;
      }
      piece.near?.line?.d(near);
      piece.near?.fill.d(near);
      piece.far?.line?.d(away);
      piece.far?.fill.d(away);
    }
    // Each piece's path is built once: its layer's outline is the same paths joined.
    const d = {
      far: this.path(far),
      tail: this.path(body.tail),
      body: this.path(body.body),
      neck: this.path(body.neck),
      head: this.path(body.head),
      hind: this.path(hind),
      fore: this.path(fore),
      ears: this.path(ears),
    };
    const layerDraw = (name: LayerName, outline: string) => {
      const l = this.layers[name];
      l.line.d(outline + flesh[name]);
      l.flesh.d(flesh[name]);
    };
    layerDraw('far', d.far);
    layerDraw('body', d.tail + d.body + d.neck + d.head);
    layerDraw('hind', d.hind);
    layerDraw('fore', d.fore);
    layerDraw('ear', d.ears);
    this.pieces.far.d(d.far);
    this.pieces.farHooves.d(this.path(keep(pose.farHooves)));
    this.pieces.tail.d(d.tail);
    this.pieces.body.d(d.body);
    this.pieces.neck.d(d.neck);
    this.pieces.head.d(d.head);
    this.pieces.hind.d(d.hind);
    this.pieces.fore.d(d.fore);
    const hooves = keep(pose.hooves);
    this.pieces.hooves.d(this.path(hooves.filter((s) => HIND_BONES.has(s.bone))));
    this.pieces.foreHooves.d(this.path(hooves.filter((s) => !HIND_BONES.has(s.bone))));
    this.pieces.ears.d(d.ears);
    // The muscle and bone layers are drawn only while they show.
    const muscles = this.layer === 'muscles' ? this.path(pose.muscles) : '';
    const bones = this.layer === 'bones' ? this.path(pose.bones) : '';
    this.muscles.d(muscles);
    this.bones.d(bones);
    const traced: Record<AnatomyPiece, string> = { body: d.body, head: d.head, neck: d.neck, tail: d.tail, forelimbs: d.fore, hindlimbs: d.hind, muscles, bones };
    for (const mirror of this.mirrors) mirror.el.d(traced[mirror.piece]);
    // The face belongs to the skull: a scene that redraws the skull draws its own.
    const face = !this.isReplaced('skull');
    this.face.group.show(face);
    if (face) {
      let mouth = '';
      for (const [a, b] of pose.mouth) {
        const [x0, y0] = this.map(a);
        const [x1, y1] = this.map(b);
        mouth += `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}`;
      }
      this.face.mouth.d(mouth);
      const [ex, ey] = this.map(pose.eye);
      this.face.eye.set({ cx: Number(fmt(ex)), cy: Number(fmt(ey)), r: Number(fmt(Math.max(1.3, pose.eyeR * this.scale))) });
      if (pose.nose) {
        const [nx, ny] = this.map(pose.nose);
        this.face.nose.set({ cx: Number(fmt(nx)), cy: Number(fmt(ny)), r: Number(fmt(Math.max(1.2, pose.eyeR * 0.85 * this.scale))) }).show();
      } else this.face.nose.hide();
    }
    const shadowY = this.origin[1];
    const [sx0] = this.map([pose.shadow.x0, 0]);
    const [sx1] = this.map([pose.shadow.x1, 0]);
    const rx = Math.abs(sx1 - sx0) / 2;
    const mid = (sx0 + sx1) / 2;
    const ry = Math.max(1.5, rx * 0.06);
    this.shadow.d(`M${fmt(mid - rx)} ${fmt(shadowY)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(mid + rx)} ${fmt(shadowY)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(mid - rx)} ${fmt(shadowY)}Z`);
    if (this.build.ground) {
      const W = this.groundWidth;
      const spacing = W / 9;
      const x0 = this.cx - W / 2;
      const [gx0, gy] = this.map([x0, 0]);
      const [gx1] = this.map([x0 + W, 0]);
      let g = `M${fmt(gx0)} ${fmt(gy)}L${fmt(gx1)} ${fmt(gy)}`;
      const shift = this.groundX % spacing;
      for (let i = 0; i < 10; i++) {
        const x = x0 + i * spacing - shift;
        if (x < x0 || x > x0 + W - spacing * 0.3) continue;
        const [ax, ay] = this.map([x, 0]);
        const [bx, by] = this.map([x - spacing * 0.25, -spacing * 0.18]);
        g += `M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`;
      }
      this.ground.d(g);
    }
  }

  /**
   * The whole body for one moment: the spine from the hips, the limbs placed
   * by their feet, the head and tail hung on the spine, the kit's plain skin
   * on each bone, and each bone's frame for the scene's own skin.
   */
  private pose(m: Motion): Pose;
  private pose(m: Motion, roots: true): { hindRoot: P; foreRoot: P };
  private pose(m: Motion, roots?: true): Pose | { hindRoot: P; foreRoot: P } {
    const { build, body, rig } = this;
    const { hind, fore } = build;
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
      hooves: [],
      muscles: [],
      bones: [],
      mouth: [],
      frames: {},
      farFrames: {},
      eye: [0, 0],
      eyeR: 0,
      nose: null,
      shadow: { x0: 0, x1: 0 },
      reached: true,
    };
    const bone = (a: P, c: P, r: number) => out.bones.push(cap(a, r, c, r * 0.8));
    out.frames.spine = { points: [hipSpine, midSpine, shoulderSpine], flip: false };

    // Trunk: pelvis, waist and chest hang below the spine.
    // The chest is deep and the haunch rounded; the waist between them tucks up in runners.
    const pelvisC = add(add(hipSpine, mul(down, 0.72 * body.pelvisR)), mul(dir, 0.25 * body.pelvisR));
    const waistC = add(midSpine, mul(down, 0.8 * body.waistR));
    const chestC = add(add(shoulderSpine, mul(down, 0.88 * body.chestR)), mul(dir, -0.5 * body.chestR));
    out.body.push(
      ...on(
        'spine',
        ell(pelvisC, body.pelvisR * 0.95, body.pelvisR * 0.85, theta),
        ell(chestC, body.chestR * 0.95, body.chestR, theta),
        cap(pelvisC, body.pelvisR * 0.8, waistC, body.waistR),
        cap(waistC, body.waistR, chestC, body.chestR * 0.85),
        cap(hipSpine, body.waistR * 0.35, midSpine, body.waistR * 0.35),
        cap(midSpine, body.waistR * 0.35, shoulderSpine, body.waistR * 0.4),
      ),
    );
    if (build.wings) {
      const root = add(shoulderSpine, mul(down, body.chestR * 0.3));
      const tip = add(add(hipSpine, mul(dir, -body.pelvisR * 0.8)), mul(down, body.pelvisR * 0.1));
      out.fore.push(...on('wing', cap(root, body.chestR * 0.75, tip, body.chestR * 0.12)));
      out.frames.wing = { points: [root, tip], flip: false };
    }
    out.muscles.push(cap(hipSpine, body.waistR * 0.3, shoulderSpine, body.waistR * 0.3));
    bone(hipSpine, midSpine, body.waistR * 0.09);
    bone(midSpine, shoulderSpine, body.waistR * 0.09);
    for (let i = 0; i < 5; i++) {
      const at = lerpP(midSpine, shoulderSpine, 0.1 + i * 0.2);
      bone(at, add(add(at, mul(down, body.chestR * 1.45)), mul(dir, -body.chestR * 0.35)), body.waistR * 0.045);
    }
    bone(hipSpine, hipJoint, body.waistR * 0.08);

    // Neck and head, hung from the front of the spine.
    const nod = plan.gait === 'stand' ? 0.02 * Math.sin(m.clock * 0.8) : 0.05 * Math.sin(2 * tau * p);
    const neckAngle = lerp(rig.neckQ, rig.neckB, b) + nod + (m.neck ?? 0);
    const neckBase = add(add(shoulderSpine, mul(dir, body.chestR * 0.1)), mul(down, body.neckR * 0.3));
    const neckEnd = add(neckBase, polar(neckAngle, Math.max(build.neck, body.neckR * 0.5)));
    out.neck.push(...on('neck', cap(neckBase, Math.max(body.neckR * 1.15, body.chestR * 0.6), neckEnd, body.neckR)));
    out.frames.neck = { points: [neckBase, neckEnd], flip: false };
    out.muscles.push(cap(neckBase, body.neckR * 0.8, neckEnd, body.neckR * 0.6));
    bone(shoulderSpine, neckEnd, body.waistR * 0.07);
    const psi = lerp(-0.45, build.wings ? 0 : -0.1, b) - nod * 0.5 + 0.5 * (m.neck ?? 0);
    const hd = polar(psi);
    const hu = polar(psi + Math.PI / 2);
    const cr = body.craniumR;
    const sk = build.skull.length;
    const cranium = add(add(neckEnd, mul(hd, cr * 0.5)), mul(hu, cr * 0.35));
    const back = sub(cranium, mul(hd, cr));
    const face = Math.max(cr * 1.2, sk * (1 - build.skull.snout));
    const snoutStart = add(add(back, mul(hd, face)), mul(hu, -cr * 0.15));
    const tip = add(add(back, mul(hd, sk)), mul(hu, -cr * 0.25));
    out.frames.skull = { points: [back, add(back, mul(hd, sk))], flip: false };
    out.head.push(...on('skull', ell(cranium, cr, cr * 0.92, psi)));
    if (len(sub(tip, snoutStart)) > 0.02 * sk) out.head.push(...on('skull', cap(snoutStart, cr * 0.62, tip, cr * 0.32)));
    out.muscles.push(ell(add(add(cranium, mul(hd, cr * 0.35)), mul(hu, -cr * 0.35)), cr * 0.5, cr * 0.36, psi));
    out.bones.push(ell(cranium, cr * 0.75, cr * 0.65, psi), cap(snoutStart, cr * 0.3, tip, cr * 0.12));
    out.eye = add(add(cranium, mul(hd, cr * 0.55 + clamp(face - cr * 1.2, 0, cr * 0.6))), mul(hu, cr * 0.25));
    out.eyeR = cr * 0.15;
    if (len(sub(tip, snoutStart)) > cr * 0.4) {
      out.nose = add(tip, mul(hd, cr * 0.22));
      out.mouth.push([add(tip, mul(hu, -cr * 0.2)), add(lerpP(snoutStart, tip, 0.35), mul(hu, -cr * 0.42))]);
    }
    // A plain small ear, for the scene to replace with the ear its animal has.
    const earRoot = add(add(cranium, mul(hu, cr * 0.72)), mul(hd, -cr * 0.35));
    out.frames.ear = { points: [earRoot, add(earRoot, mul(hd, sk))], flip: false };
    out.ears.push(...on('ear', cap(earRoot, cr * 0.22, add(earRoot, mul(polar(psi + Math.PI / 2 + 0.45), cr * 0.45)), cr * 0.09)));

    // Tail: a chain from the pelvis that droops as it softens and swings with the stride.
    if (build.tail.length > 0.001) {
      const stiff = build.tail.stiffness;
      let at = add(add(hipSpine, mul(dir, -body.pelvisR * 0.35)), mul(down, body.pelvisR * 0.1));
      const chain: P[] = [at];
      const widths: number[] = [body.tailR];
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
        out.tail.push(...on('tail', cap(at, r0, next, r1)));
        bone(at, next, Math.max(r1 * 0.25, body.waistR * 0.03));
        chain.push(next);
        widths.push(r1);
        at = next;
      }
      // The tail runs backwards, so across is turned to keep pointing up.
      out.frames.tail = { points: chain, flip: true, radii: widths };
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
      const [chainBone, upperBone, lowerBone, footBone]: readonly SkinBone[] = isHind ? ['hindleg', 'thigh', 'shin', 'hindfoot'] : ['foreleg', 'upperArm', 'forearm', 'forefoot'];
      const shapes: Skin[] = [
        ...on(upperBone!, cap(root, upperR0, knee, midR), ell(lerpP(root, knee, 0.42), 0.55 * limb.upper, isHind ? body.thighR : body.shoulderR, Math.atan2(knee[1] - root[1], knee[0] - root[0]))),
        ...on(lowerBone!, cap(knee, midR, ankle, lowR)),
        ...on(footBone!, cap(ankle, lowR, toe, toeR)),
      ];
      const hoof = limb.posture === 'unguligrade' ? on(footBone!, cap(lerpP(ankle, toe, 0.7), lowR * 0.95, toe, toeR * 1.1)) : [];
      const frames = near ? out.frames : out.farFrames;
      frames[chainBone!] = { points: [root, knee, ankle, toe], flip: false, radii: [upperR0, midR, lowR, toeR] };
      frames[upperBone!] = { points: [root, knee], flip: false, radii: [upperR0, midR] };
      frames[lowerBone!] = { points: [knee, ankle], flip: false, radii: [midR, lowR] };
      frames[footBone!] = { points: [ankle, toe], flip: false, radii: [lowR, toeR] };
      if (near) {
        (isHind ? out.hind : out.fore).push(...shapes);
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
        out.far.push(...shapes);
        out.farHooves.push(...hoof);
      }
    }
    const xs = [hipJoint[0] - body.pelvisR, shoulderJoint[0] + body.chestR];
    out.shadow = { x0: Math.min(...xs), x1: Math.max(...xs) };
    return out;
  }
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

/** One animal's room on the stage: its size in metres standing, and where the scene put it, if it did. */
interface Room {
  readonly span: number;
  readonly height: number;
  readonly at?: P;
  readonly width?: number;
}

/**
 * Places a stage's animals. They share one scale, the largest at which every
 * one fits the room it has, so a horse beside a mouse is drawn as much
 * bigger as it is. Animals the scene gives no place stand side by side on
 * one ground line, sharing the stage's width.
 */
export class Layout {
  private readonly rooms: Room[] = [];
  private cache: { scale: number; places: Array<{ at: P; width: number }> } | null = null;

  constructor(private readonly viewBox: ViewBox) {}

  add(room: Room): number {
    this.rooms.push(room);
    this.cache = null;
    return this.rooms.length - 1;
  }

  private solve(): { scale: number; places: Array<{ at: P; width: number }> } {
    if (this.cache) return this.cache;
    const [vx, vy, vw, vh] = this.viewBox;
    const free = this.rooms.filter((r) => !r.at);
    const places = this.rooms.map((room) => {
      if (room.at) return { at: room.at, width: room.width ?? vw * 0.7 };
      const i = free.indexOf(room);
      const share = vw / free.length;
      return { at: [vx + share * (i + 0.5), vy + vh * 0.86] as P, width: room.width ?? (free.length === 1 ? vw * 0.7 : share * 0.9) };
    });
    const fits = this.rooms.map((room, i) => {
      const { at, width } = places[i]!;
      const above = Math.max(10, at[1] - vy - vh * 0.06);
      return Math.min(width / (room.span * 1.15), above / (room.height * 1.12));
    });
    this.cache = { scale: Math.min(...fits), places };
    return this.cache;
  }

  scale(): number {
    return this.solve().scale;
  }

  place(slot: number): { at: P; width: number } {
    return this.solve().places[slot]!;
  }
}

export class AnatomyKit implements Anatomy {
  readonly stage: StageHandle;
  private readonly viewBox: ViewBox;
  private readonly layout: Layout;
  private animals = 0;

  constructor(
    private readonly ctx: KitContext,
    options: AnatomyOptions,
  ) {
    this.stage = ctx.stage;
    this.viewBox = anatomyLayout(options).viewBox;
    this.layout = new Layout(this.viewBox);
  }

  skeleton(spec: SkeletonSpec): Animal {
    if (this.animals >= MAX_ANIMALS) fail(`a stage draws at most ${MAX_ANIMALS} animals`);
    this.animals++;
    return new AnimalFigure(this.ctx, this.stage, readSkeleton(spec), this.layout);
  }

  part<T extends Handle | { readonly handle: Handle }>(name: string, item: T, options?: PartOptions): T {
    this.stage.part(name, item as unknown as Handle, options);
    return item;
  }
}

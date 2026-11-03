import type { AnatomyLayer, AnatomyMode, FootPosture, SkeletonSpec, Tone, Vec2 } from '../../api/types';
import { SceneApiError } from '../../scene/errors';
import { TONES } from '../../scene/handles';

export function fail(message: string): never {
  throw new SceneApiError(`anatomy: ${message}`);
}

/** A limb in metres, with the posture it stands in. */
export interface Limb {
  readonly upper: number;
  readonly lower: number;
  readonly foot: number;
  readonly posture: FootPosture;
}

/** A skeleton read and checked, in metres. */
export interface Build {
  readonly size: number;
  readonly skull: { readonly length: number; readonly depth: number; readonly snout: number };
  readonly neck: number;
  readonly spine: { readonly length: number; readonly flex: number };
  readonly fore: Limb | null;
  readonly hind: Limb;
  readonly tail: { readonly length: number; readonly stiffness: number };
  readonly stance: 'upright' | 'sprawl';
  readonly modes: readonly AnatomyMode[];
  /** The forelimbs are folded wings. */
  readonly wings: boolean;
  readonly at?: Vec2;
  readonly width?: number;
  readonly facing: 1 | -1;
  readonly tone: Tone;
  readonly ground: boolean;
  readonly show: AnatomyLayer;
}

const POSTURES: readonly FootPosture[] = ['plantigrade', 'digitigrade', 'unguligrade'];
const LAYERS: readonly AnatomyLayer[] = ['skin', 'muscles', 'bones'];
const SPEC_KEYS = new Set(['size', 'skull', 'neck', 'spine', 'forelimb', 'hindlimb', 'tail', 'stance', 'modes', 'wings', 'at', 'width', 'facing', 'tone', 'ground', 'show']);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function number(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${what} is a number from ${min} to ${max}`);
  return value;
}

function only(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${what} has no "${key}"; it takes ${keys.join(', ')}`);
}

/** Reads a foot's posture from how long it is against the whole limb, as fossil feet are read. */
export function readPosture(upper: number, lower: number, foot: number): FootPosture {
  const share = foot / (upper + lower + foot);
  return share < 0.2 ? 'plantigrade' : share < 0.3 ? 'digitigrade' : 'unguligrade';
}

function limb(value: unknown, what: string, size: number): Limb {
  if (!isObject(value)) fail(`${what} is { upper, lower, foot }, each a fraction of the body length`);
  only(value, ['upper', 'lower', 'foot', 'posture'], what);
  const upper = number(value.upper, `${what}.upper`, 0.02, 1.5);
  const lower = number(value.lower, `${what}.lower`, 0.02, 1.5);
  const foot = number(value.foot, `${what}.foot`, 0.01, 1);
  let posture = readPosture(upper, lower, foot);
  if (value.posture !== undefined) {
    if (!POSTURES.includes(value.posture as FootPosture)) fail(`${what}.posture is ${POSTURES.join(', ')}`);
    posture = value.posture as FootPosture;
  }
  return { upper: upper * size, lower: lower * size, foot: foot * size, posture };
}

/** Reads and checks a skeleton. The kit holds no animals: a scene always gives the bones. */
export function readSkeleton(spec: SkeletonSpec): Build {
  if (typeof spec === 'string') fail(`give the bones, not a name: skeleton({ size, skull, neck, spine, forelimb, hindlimb, tail }), measured from the real ${String(spec)}'s skeleton`);
  if (!isObject(spec)) fail('skeleton takes the bones: { size, skull, neck, spine, forelimb, hindlimb, tail }');
  const raw = spec as Record<string, unknown>;
  if (raw.hints !== undefined) fail('a skeleton has no hints: draw ears, coats, manes and markings yourself with animal.skin(bone, shape)');
  for (const key of Object.keys(raw)) if (!SPEC_KEYS.has(key)) fail(`a skeleton has no "${key}"`);
  const size = raw.size === undefined ? 1 : number(raw.size, 'size (body length in metres)', 0.01, 30);
  const part = (key: string, keys: readonly string[]): Record<string, unknown> => {
    const value = raw[key];
    if (!isObject(value)) fail(`${key} is { ${keys.join(', ')} }`);
    only(value, keys, key);
    return value;
  };
  const skull = raw.skull === undefined ? { length: 0.22 } : part('skull', ['length', 'depth', 'snout']);
  const neck = raw.neck === undefined ? { length: 0.15 } : part('neck', ['length']);
  const spine = raw.spine === undefined ? { length: 0.6 } : part('spine', ['length', 'flex']);
  const tail = raw.tail === undefined ? { length: 0.4 } : part('tail', ['length', 'stiffness']);
  if (raw.wings !== undefined && typeof raw.wings !== 'boolean') fail('wings is true or false');
  const wings = raw.wings === true;
  if (raw.hindlimb === undefined) fail('a skeleton needs a hindlimb: { upper, lower, foot }');
  const hind = limb(raw.hindlimb, 'hindlimb', size);
  const fore = raw.forelimb === undefined || wings ? null : limb(raw.forelimb, 'forelimb', size);
  const stance = raw.stance ?? 'upright';
  if (stance !== 'upright' && stance !== 'sprawl') fail('stance is upright or sprawl');
  const spineLength = number(spine.length, 'spine.length', 0.1, 2) * size;
  const skullLength = number(skull.length, 'skull.length', 0.03, 1) * size;
  const neckLength = number(neck.length, 'neck.length', 0, 1.5) * size;
  let modes: AnatomyMode[];
  if (raw.modes === undefined) modes = fore ? ['quadruped'] : ['bipedal'];
  else {
    if (!Array.isArray(raw.modes) || raw.modes.length === 0 || !raw.modes.every((m) => m === 'quadruped' || m === 'bipedal')) fail('modes is a list of quadruped and bipedal');
    modes = [...new Set(raw.modes as AnatomyMode[])];
  }
  if (modes.includes('quadruped') && !fore) fail('this skeleton has no forelimbs to stand on, so it cannot walk on four legs');
  if (modes.includes('bipedal') && fore && hind.upper + hind.lower < 0.4 * (spineLength + neckLength + skullLength)) {
    fail("this skeleton's hindlimbs are too short to walk on two legs");
  }
  const tone = raw.tone ?? 'mid';
  if (typeof tone !== 'string' || !TONES.has(tone)) fail(`unknown tone "${String(tone)}"`);
  const show = raw.show ?? 'skin';
  if (!LAYERS.includes(show as AnatomyLayer)) fail(`show is ${LAYERS.join(', ')}`);
  if (raw.facing !== undefined && raw.facing !== 'right' && raw.facing !== 'left') fail('facing is right or left');
  let at: Vec2 | undefined;
  if (raw.at !== undefined) {
    if (!Array.isArray(raw.at) || raw.at.length !== 2) fail('at is [x, y], the stage point it stands on');
    at = [number(raw.at[0], 'at[0]', -1e6, 1e6), number(raw.at[1], 'at[1]', -1e6, 1e6)];
  }
  if (raw.ground !== undefined && typeof raw.ground !== 'boolean') fail('ground is true or false');
  return {
    size,
    skull: {
      length: skullLength,
      depth: (skull.depth === undefined ? 0.55 : number(skull.depth, 'skull.depth', 0.15, 1.5)) * skullLength,
      snout: skull.snout === undefined ? 0.45 : number(skull.snout, 'skull.snout', 0, 0.9),
    },
    neck: neckLength,
    spine: { length: spineLength, flex: spine.flex === undefined ? 0.4 : number(spine.flex, 'spine.flex', 0, 1) },
    fore,
    hind,
    tail: { length: number(tail.length, 'tail.length', 0, 3) * size, stiffness: tail.stiffness === undefined ? 0.5 : number(tail.stiffness, 'tail.stiffness', 0, 1) },
    stance,
    modes,
    wings,
    at,
    width: raw.width === undefined ? undefined : number(raw.width, 'width', 10, 1e5),
    facing: raw.facing === 'left' ? -1 : 1,
    tone: tone as Tone,
    ground: raw.ground !== false,
    show: show as AnatomyLayer,
  };
}

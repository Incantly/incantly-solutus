import type { AnatomyHints, AnatomyLayer, AnatomyMode, ExampleSkeleton, FootPosture, SkeletonSpec, Tone, Vec2 } from '../../api/types';
import { SceneApiError } from '../../scene/errors';
import { TONES } from '../../scene/handles';

export function fail(message: string): never {
  throw new SceneApiError(`anatomy: ${message}`);
}

/**
 * Reviewed example skeletons, as data: a scene may start from one and change
 * what differs. Lengths are fractions of `size`, the body length in metres
 * from the nose to the root of the tail.
 */
export const EXAMPLES: Readonly<Record<ExampleSkeleton, SkeletonSpec>> = Object.freeze({
  dog: {
    size: 0.9,
    skull: { length: 0.24, depth: 0.5, snout: 0.5 },
    neck: { length: 0.2 },
    spine: { length: 0.56, flex: 0.45 },
    forelimb: { upper: 0.2, lower: 0.22, foot: 0.12 },
    hindlimb: { upper: 0.23, lower: 0.24, foot: 0.14 },
    tail: { length: 0.45, stiffness: 0.5 },
    hints: { ears: 'floppy' },
  },
  cat: {
    size: 0.5,
    skull: { length: 0.17, depth: 0.7, snout: 0.3 },
    neck: { length: 0.13 },
    spine: { length: 0.7, flex: 0.7 },
    forelimb: { upper: 0.2, lower: 0.2, foot: 0.11 },
    hindlimb: { upper: 0.24, lower: 0.26, foot: 0.15 },
    tail: { length: 0.8, stiffness: 0.35 },
    hints: { ears: 'pointed', whiskers: true },
  },
  horse: {
    size: 2.4,
    skull: { length: 0.26, depth: 0.38, snout: 0.65 },
    neck: { length: 0.3 },
    spine: { length: 0.44, flex: 0.15 },
    forelimb: { upper: 0.16, lower: 0.2, foot: 0.2 },
    hindlimb: { upper: 0.2, lower: 0.22, foot: 0.24 },
    tail: { length: 0.35, stiffness: 0.3 },
    hints: { ears: 'pointed', mane: true },
  },
  mouse: {
    size: 0.09,
    skull: { length: 0.3, depth: 0.6, snout: 0.5 },
    neck: { length: 0.08 },
    spine: { length: 0.62, flex: 0.8 },
    forelimb: { upper: 0.12, lower: 0.12, foot: 0.08, posture: 'plantigrade' },
    hindlimb: { upper: 0.17, lower: 0.2, foot: 0.2, posture: 'plantigrade' },
    tail: { length: 1, stiffness: 0.2 },
    hints: { ears: 'round', whiskers: true },
  },
  cheetah: {
    size: 1.3,
    skull: { length: 0.16, depth: 0.6, snout: 0.35 },
    neck: { length: 0.17 },
    spine: { length: 0.67, flex: 0.95 },
    forelimb: { upper: 0.21, lower: 0.25, foot: 0.13 },
    hindlimb: { upper: 0.25, lower: 0.3, foot: 0.17 },
    tail: { length: 0.6, stiffness: 0.6 },
    tone: 'lit',
    hints: { ears: 'small', coat: 'spotted' },
  },
  bear: {
    size: 1.9,
    skull: { length: 0.22, depth: 0.6, snout: 0.45 },
    neck: { length: 0.16 },
    spine: { length: 0.62, flex: 0.3 },
    forelimb: { upper: 0.2, lower: 0.17, foot: 0.08 },
    hindlimb: { upper: 0.2, lower: 0.17, foot: 0.13, posture: 'plantigrade' },
    tail: { length: 0.05, stiffness: 1 },
    hints: { ears: 'round' },
  },
  ape: {
    size: 0.85,
    skull: { length: 0.2, depth: 0.9, snout: 0.25 },
    neck: { length: 0.07 },
    spine: { length: 0.6, flex: 0.2 },
    forelimb: { upper: 0.36, lower: 0.33, foot: 0.14, posture: 'digitigrade' },
    hindlimb: { upper: 0.28, lower: 0.26, foot: 0.16, posture: 'plantigrade' },
    tail: { length: 0 },
    modes: ['quadruped', 'bipedal'],
    hints: { ears: 'small' },
  },
  human: {
    size: 0.85,
    skull: { length: 0.27, depth: 0.95, snout: 0.1 },
    neck: { length: 0.08 },
    spine: { length: 0.55, flex: 0.1 },
    forelimb: { upper: 0.38, lower: 0.32, foot: 0.12 },
    hindlimb: { upper: 0.52, lower: 0.5, foot: 0.17, posture: 'plantigrade' },
    tail: { length: 0 },
    modes: ['bipedal'],
    hints: { ears: 'small' },
  },
  bird: {
    size: 0.3,
    skull: { length: 0.22, depth: 0.7, snout: 0.45 },
    neck: { length: 0.22 },
    spine: { length: 0.48, flex: 0.1 },
    hindlimb: { upper: 0.2, lower: 0.3, foot: 0.2 },
    tail: { length: 0.35, stiffness: 0.8 },
    modes: ['bipedal'],
    hints: { ears: 'none', beak: true, wings: true },
  },
  lizard: {
    size: 0.3,
    skull: { length: 0.22, depth: 0.45, snout: 0.5 },
    neck: { length: 0.1 },
    spine: { length: 0.68, flex: 0.5 },
    forelimb: { upper: 0.12, lower: 0.12, foot: 0.08, posture: 'plantigrade' },
    hindlimb: { upper: 0.14, lower: 0.14, foot: 0.12, posture: 'plantigrade' },
    tail: { length: 1.3, stiffness: 0.4 },
    stance: 'sprawl',
    hints: { ears: 'none' },
  },
});

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
  readonly hints: Required<AnatomyHints>;
  readonly at?: Vec2;
  readonly width?: number;
  readonly facing: 1 | -1;
  readonly tone: Tone;
  readonly ground: boolean;
  readonly show: AnatomyLayer;
}

const EARS = ['small', 'pointed', 'round', 'floppy', 'long', 'none'];
const COATS = ['plain', 'spotted', 'striped'];
const POSTURES: readonly FootPosture[] = ['plantigrade', 'digitigrade', 'unguligrade'];
const LAYERS: readonly AnatomyLayer[] = ['skin', 'muscles', 'bones'];
const HINT_FLAGS = ['mane', 'horns', 'trunk', 'hump', 'whiskers', 'beak', 'wings'] as const;
const SPEC_KEYS = new Set(['size', 'skull', 'neck', 'spine', 'forelimb', 'hindlimb', 'tail', 'stance', 'modes', 'hints', 'at', 'width', 'facing', 'tone', 'ground', 'show']);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function number(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${what} is a number from ${min} to ${max}`);
  return value;
}

function only(value: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${what} has no "${key}"; it takes ${keys.join(', ')}`);
}

/** Example first, then the scene's changes, one level deep. */
function merge(base: SkeletonSpec, changes: SkeletonSpec | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  if (changes === undefined) return out;
  if (!isObject(changes)) fail('the changes to an example skeleton are an object, such as { size: 1.2 }');
  for (const [key, value] of Object.entries(changes)) {
    const old = out[key];
    out[key] = isObject(old) && isObject(value) ? { ...old, ...value } : value;
  }
  return out;
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

/** Reads and checks a skeleton, from an example with changes or on its own. */
export function readSkeleton(spec: SkeletonSpec | ExampleSkeleton, changes?: SkeletonSpec): Build {
  let raw: Record<string, unknown>;
  if (typeof spec === 'string') {
    if (!Object.hasOwn(EXAMPLES, spec)) fail(`there is no example skeleton "${spec}"; the examples are ${Object.keys(EXAMPLES).join(', ')}, or give the bones`);
    raw = merge(EXAMPLES[spec], changes);
  } else {
    if (!isObject(spec)) fail('skeleton takes the bones, such as { size, skull, neck, spine, forelimb, hindlimb, tail }, or an example name');
    raw = merge(spec, changes);
  }
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
  const hintsRaw = raw.hints === undefined ? {} : part('hints', ['ears', 'coat', ...HINT_FLAGS]);
  if (hintsRaw.ears !== undefined && !EARS.includes(hintsRaw.ears as string)) fail(`hints.ears is ${EARS.join(', ')}`);
  if (hintsRaw.coat !== undefined && !COATS.includes(hintsRaw.coat as string)) fail(`hints.coat is ${COATS.join(', ')}`);
  for (const flag of HINT_FLAGS) if (hintsRaw[flag] !== undefined && typeof hintsRaw[flag] !== 'boolean') fail(`hints.${flag} is true or false`);
  const hints: Required<AnatomyHints> = {
    ears: (hintsRaw.ears as AnatomyHints['ears']) ?? 'small',
    coat: (hintsRaw.coat as AnatomyHints['coat']) ?? 'plain',
    mane: hintsRaw.mane === true,
    horns: hintsRaw.horns === true,
    trunk: hintsRaw.trunk === true,
    hump: hintsRaw.hump === true,
    whiskers: hintsRaw.whiskers === true,
    beak: hintsRaw.beak === true,
    wings: hintsRaw.wings === true,
  } as Required<AnatomyHints>;
  if (raw.hindlimb === undefined) fail('a skeleton needs a hindlimb: { upper, lower, foot }');
  const hind = limb(raw.hindlimb, 'hindlimb', size);
  const fore = raw.forelimb === undefined || hints.wings ? null : limb(raw.forelimb, 'forelimb', size);
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
    hints,
    at,
    width: raw.width === undefined ? undefined : number(raw.width, 'width', 10, 1e5),
    facing: raw.facing === 'left' ? -1 : 1,
    tone: tone as Tone,
    ground: raw.ground !== false,
    show: show as AnatomyLayer,
  };
}

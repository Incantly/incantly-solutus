import type { AnatomyMode, Gait } from '../../api/types';
import type { Build } from './skeleton';

export const G = 9.81;

/** Where each foot is in the stride when it lands: left hind, left fore, right hind, right fore. */
export type Phases = readonly [number, number, number, number];

export interface GaitPlan {
  readonly gait: Gait;
  readonly phases: Phases;
  /** Share of the stride each foot is on the ground. */
  readonly duty: number;
  /** Metres. */
  readonly stride: number;
  /** Strides a second. */
  readonly frequency: number;
  readonly froude: number;
  /** Share of the stride with no foot down. */
  readonly airborne: number;
  /** The back bends in time with the stride. */
  readonly bends: boolean;
}

const WALK: Phases = [0, 0.25, 0.5, 0.75];
const TROT: Phases = [0, 0.5, 0.5, 0];
/** A horse's gallop: the fore feet land in the same order as the hind. */
const TRANSVERSE: Phases = [0, 0.5, 0.12, 0.62];
/** A cheetah's or a dog's: the fore feet land in the opposite order, round the body. */
const ROTARY: Phases = [0, 0.62, 0.12, 0.5];
/** Small animals bound: the hind feet land almost together, then the fore. */
const BOUND: Phases = [0, 0.5, 0.05, 0.55];
const TWO_LEGS: Phases = [0, 0, 0.5, 0.5];
/** The least share of a stride a foot is down, at any speed. */
const MIN_DUTY = 0.12;

/** Starting values from studies of animal gaits (dynamic similarity), to be tuned on the bench. */
export const GAIT_RULES = Object.freeze({
  /** Froude numbers where animals of every size change gait. */
  walkToRun: 0.5,
  trotToGallop: 2.5,
  /** Bodies shorter than this (metres) bound rather than gallop. */
  smallBody: 0.3,
  /** A spine this flexible gallops round the body (rotary). */
  flexibleSpine: 0.6,
  /** A foot on the ground may sweep at most this share of the leg's reach, so it never slides. */
  stanceReach: 1.1,
});

/** A foot's duty factor falls as speed rises. */
function runningDuty(froude: number): number {
  return Math.min(0.62, Math.max(0.16, 0.62 / (1 + 0.45 * froude ** 0.6)));
}

/** Share of a stride with no foot in contact, for the legs in use. */
export function airborneShare(phases: Phases, duty: number, legs: readonly number[]): number {
  if (duty >= 1) return 0;
  const samples = 200;
  let none = 0;
  for (let i = 0; i < samples; i++) {
    const p = i / samples;
    if (legs.every((leg) => (((p - phases[leg]!) % 1) + 1) % 1 >= duty)) none++;
  }
  return none / samples;
}

/**
 * The gait an animal of this build uses at `speed` m/s: the gait from its
 * Froude number, its stride from dynamic similarity (stride over hip height
 * = 2.3 Froude^0.3), its stride rate from speed over stride, and a duty
 * factor short enough that a planted foot never has to slide.
 */
export function planGait(build: Build, mode: AnatomyMode, speed: number, hipHeight: number, force?: Gait): GaitPlan {
  const legs = mode === 'bipedal' ? [0, 2] : [0, 1, 2, 3];
  if (!(speed > 0.01)) {
    return { gait: 'stand', phases: mode === 'bipedal' ? TWO_LEGS : WALK, duty: 1, stride: 0, frequency: 0, froude: 0, airborne: 0, bends: false };
  }
  const froude = (speed * speed) / (G * hipHeight);
  let gait: Gait;
  let phases: Phases;
  let duty: number;
  let bends = false;
  // A gait the scene asks for wins over the one the speed would pick, where the legs can make it.
  const wanted = force && force !== 'stand' && (mode === 'bipedal' ? force === 'walk' || force === 'run' : force !== 'run') ? force : null;
  if (mode === 'bipedal') {
    phases = TWO_LEGS;
    if (wanted ? wanted === 'walk' : froude < GAIT_RULES.walkToRun) {
      gait = 'walk';
      duty = 0.65 - 0.1 * froude;
    } else {
      gait = 'run';
      duty = Math.min(0.45, runningDuty(froude));
    }
  } else if (wanted ? wanted === 'walk' : froude < GAIT_RULES.walkToRun) {
    gait = 'walk';
    phases = WALK;
    duty = Math.max(0.55, 0.75 - 0.3 * froude);
  } else {
    const small = wanted ? wanted === 'bound' : build.size < GAIT_RULES.smallBody;
    const fast = wanted ? wanted !== 'trot' : froude >= GAIT_RULES.trotToGallop || (small && froude >= 1);
    duty = runningDuty(froude);
    if (!fast) {
      gait = 'trot';
      phases = TROT;
    } else if (small) {
      gait = 'bound';
      phases = BOUND;
      bends = true;
    } else {
      gait = 'gallop';
      phases = build.spine.flex >= GAIT_RULES.flexibleSpine ? ROTARY : TRANSVERSE;
      bends = true;
    }
  }
  // A foot sweeps duty × stride while planted; past the leg's reach it would slide, so the foot lifts sooner,
  // and past what the shortest stance can cover the strides grow no longer, only quicker.
  const reaches = [build.hind.upper + build.hind.lower];
  if (mode === 'quadruped' && build.fore) reaches.push(build.fore.upper + build.fore.lower);
  const reach = Math.min(...reaches) * GAIT_RULES.stanceReach;
  const stride = Math.min(hipHeight * 2.3 * froude ** 0.3, reach / MIN_DUTY);
  duty = Math.max(MIN_DUTY, Math.min(duty, reach / stride));
  return { gait, phases, duty, stride, frequency: speed / stride, froude, airborne: airborneShare(phases, duty, legs), bends };
}

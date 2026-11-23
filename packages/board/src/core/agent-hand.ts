/**
 * The hand animation (docs/state-machines.md B34): a `stroke`, or a `write` in the hand style, is drawn as if by hand on
 * the live layer, about 400 characters a second, and stored as normal ink at the end. This file holds the plan, the
 * progress and the partial shape of each frame; the web layer gives it the frame time and shows the frames. It has no
 * clock of its own and never writes the store. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { sendIfAble } from './machine';
import { refusedMove } from './errors';
import type { ErrorSink } from './errors';
import { shapeGeometry } from './geometry';
import type { KindRegistry } from './kinds/def';
import type { InkProps } from './kinds/ink';
import type { TextProps } from './kinds/texts';
import type { ShapeRecord } from './types';

/** Characters drawn a second. */
export const HAND_CPS = 400;
/** A stroke counts one character for each this many page units of its length. */
export const STROKE_UNITS_PER_CHAR = 4;
/** No action takes longer than this, in milliseconds. */
export const HAND_MAX_MS = 3000;
/** The least time an action takes, so a short one can still be seen. */
export const HAND_MIN_MS = 180;

type AnimationState = 'idle' | 'playing' | 'landing';
type AnimationEvent = 'begin' | 'step' | 'finish' | 'cancel' | 'settle';

export const ANIMATION_MACHINE: MachineTable<AnimationState, AnimationEvent> = {
  idle: { begin: 'playing' },
  playing: { step: 'playing', finish: 'landing', cancel: 'landing' },
  landing: { settle: 'idle' },
};

/** What the hand is to draw: the finished shape (not in the store) and how it is revealed. */
export interface HandPlan {
  readonly how: 'stroke' | 'text';
  /** The finished shape, with its place; a `stroke` is an `ink` shape and a `text` is a `text` shape. */
  readonly shape: ShapeRecord;
}

/** One frame: the part of the shape drawn so far, and the page point the hand is at. */
export interface HandFrame {
  readonly shape: ShapeRecord;
  readonly progress: number;
  readonly tip: { readonly x: number; readonly y: number };
}

/** What a player does for the runner (the web layer's frame loop is one). */
export interface HandPlayer {
  /** Plays one drawing. Resolves with the progress reached: 1 when it was drawn whole, less when it was cancelled. */
  play(plan: HandPlan): Promise<number>;
  /** Ends what plays now at once. */
  cancel(): void;
}

/** The number of characters a plan takes to draw. */
export function planLength(plan: HandPlan): number {
  if (plan.how === 'text') return Array.from((plan.shape.props as TextProps).text).length;
  const { points, stride } = plan.shape.props as InkProps;
  let length = 0;
  const n = Math.floor(points.length / stride);
  for (let i = 1; i < n; i++) length += Math.hypot((points[i * stride] as number) - (points[(i - 1) * stride] as number), (points[i * stride + 1] as number) - (points[(i - 1) * stride + 1] as number));
  return Math.max(1, Math.ceil(length / STROKE_UNITS_PER_CHAR));
}

/** How long a plan takes, in milliseconds. */
export const planMs = (plan: HandPlan): number => Math.min(HAND_MAX_MS, Math.max(HAND_MIN_MS, (planLength(plan) / HAND_CPS) * 1000));

/**
 * The text up to `chars` characters. A `$…$` formula is one piece: it shows whole or not at all, so a half-typed formula
 * never flashes on the board.
 */
export function revealText(text: string, chars: number): string {
  const all = Array.from(text);
  let out = '';
  let i = 0;
  let count = 0;
  while (i < all.length && count < chars) {
    if (all[i] === '$') {
      const close = all.indexOf('$', i + 1);
      if (close > i) {
        const length = close - i + 1;
        if (count + length > chars) break;
        out += all.slice(i, close + 1).join('');
        i = close + 1;
        count += length;
        continue;
      }
    }
    out += all[i];
    i++;
    count++;
  }
  return out;
}

/** The shape of the plan drawn up to `progress` (0 to 1). */
export function partOf(plan: HandPlan, progress: number): ShapeRecord {
  const p = Math.min(1, Math.max(0, progress));
  if (plan.how === 'text') {
    const props = plan.shape.props as TextProps;
    const chars = Math.ceil(planLength(plan) * p);
    return { ...plan.shape, props: { ...props, text: revealText(props.text, chars) } };
  }
  const props = plan.shape.props as InkProps;
  const total = Math.floor(props.points.length / props.stride);
  const n = Math.min(total, Math.max(2, Math.ceil(total * p)));
  return { ...plan.shape, props: { ...props, points: props.points.subarray(0, n * props.stride) } };
}

/** One animation at a time. */
export class HandAnimation {
  readonly #kinds: KindRegistry;
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(ANIMATION_MACHINE, 'idle', refusedMove('hand animation', () => this.#report));
  #plan: HandPlan | undefined;
  /** The time of the first frame; -1 until a frame comes. */
  #t0 = -1;
  #progress = 0;
  #ms = 0;

  constructor(kinds: KindRegistry, report?: ErrorSink) {
    this.#kinds = kinds;
    this.#report = report;
  }

  get state(): AnimationState {
    return this.#machine.state;
  }

  /** The progress reached, 0 to 1. */
  get progress(): number {
    return this.#progress;
  }

  /** The plan being drawn (or landing), or undefined when idle. */
  get plan(): HandPlan | undefined {
    return this.#plan;
  }

  /** Starts a drawing. False when one is already going on. */
  begin(plan: HandPlan): boolean {
    if (!this.#machine.can('begin')) return false;
    this.#machine.send('begin');
    this.#plan = plan;
    this.#t0 = -1;
    this.#progress = 0;
    this.#ms = planMs(plan);
    return true;
  }

  /** The frame at time `now`; undefined when nothing is playing. The drawing ends at progress 1. */
  step(now: number): HandFrame | undefined {
    const plan = this.#plan;
    if (plan === undefined || !this.#machine.is('playing') || !Number.isFinite(now)) return undefined;
    if (this.#t0 < 0) this.#t0 = now;
    this.#progress = Math.max(this.#progress, Math.min(1, (now - this.#t0) / this.#ms));
    this.#machine.send('step');
    if (this.#progress >= 1) this.#machine.send('finish');
    return this.#frame(plan);
  }

  /** The last frame, for the frames of `landing`. */
  last(): HandFrame | undefined {
    return this.#plan === undefined ? undefined : this.#frame(this.#plan);
  }

  /** Ends the drawing where it is; gives the progress reached. */
  cancel(): number {
    sendIfAble(this.#machine, 'cancel');
    return this.#progress;
  }

  /** The stored shape has been drawn by a tile: the hand's picture can go. */
  settle(): void {
    if (sendIfAble(this.#machine, 'settle')) this.#plan = undefined;
  }

  #frame(plan: HandPlan): HandFrame {
    const shape = partOf(plan, this.#progress);
    const g = shapeGeometry(shape, this.#kinds);
    let tip = { x: shape.x, y: shape.y };
    if (plan.how === 'stroke') {
      const { points, stride } = shape.props as InkProps;
      const n = Math.floor(points.length / stride);
      if (n > 0) tip = { x: shape.x + (points[(n - 1) * stride] as number), y: shape.y + (points[(n - 1) * stride + 1] as number) };
    } else if (g !== undefined) {
      tip = { x: g.bounds.maxX, y: g.bounds.maxY };
    }
    return { shape, progress: this.#progress, tip };
  }
}

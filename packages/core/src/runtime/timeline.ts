import type { Ease, TimelineOptions } from '../api/types';
import { EASES, LOOP_MODES, type LoopMode } from '../protocol/runtime-messages';
import type { TimingView } from '../protocol/ui';
import { SceneApiError } from '../scene/errors';
import { EASINGS } from './tween';

/**
 * The timeline behind the timing panel (CT-4): a cycle of `duration` seconds
 * that loops, plays once or ping-pongs, with an easing. Scenes read it as
 * `frame.progress`; learners change it in the settings panel.
 */
export class Timeline {
  duration: number;
  loop: LoopMode;
  ease: Ease;

  constructor(options: TimelineOptions) {
    if (!(typeof options?.duration === 'number' && Number.isFinite(options.duration) && options.duration > 0 && options.duration <= 600)) {
      throw new SceneApiError('inc.timeline needs a duration in seconds, from 0 to 600');
    }
    const loop = options.loop ?? 'loop';
    if (!LOOP_MODES.includes(loop)) throw new SceneApiError(`Unknown loop mode "${String(loop)}"; use loop, once or pingpong`);
    const ease = options.ease ?? 'linear';
    if (!EASES.includes(ease)) throw new SceneApiError(`Unknown easing "${String(ease)}"`);
    this.duration = options.duration;
    this.loop = loop;
    this.ease = ease;
  }

  /** Eased position in the cycle at scene time `time`. */
  progress(time: number): number {
    const cycle = time / this.duration;
    let raw: number;
    if (this.loop === 'once') raw = Math.min(1, Math.max(0, cycle));
    else if (this.loop === 'pingpong') {
      const phase = cycle % 2;
      raw = phase <= 1 ? phase : 2 - phase;
    } else raw = cycle - Math.floor(cycle);
    return EASINGS[this.ease](raw);
  }

  /** A once-through timeline has finished. */
  finished(time: number): boolean {
    return this.loop === 'once' && time >= this.duration;
  }

  view(): TimingView {
    return { duration: this.duration, loop: this.loop, ease: this.ease };
  }

  /** Applies learner settings; returns whether anything changed. */
  apply(settings: { readonly duration?: number; readonly loop?: LoopMode; readonly ease?: Ease }): boolean {
    let changed = false;
    if (settings.duration !== undefined && Number.isFinite(settings.duration)) {
      const duration = Math.min(600, Math.max(0.1, settings.duration));
      if (duration !== this.duration) {
        this.duration = duration;
        changed = true;
      }
    }
    if (settings.loop !== undefined && LOOP_MODES.includes(settings.loop) && settings.loop !== this.loop) {
      this.loop = settings.loop;
      changed = true;
    }
    if (settings.ease !== undefined && EASES.includes(settings.ease) && settings.ease !== this.ease) {
      this.ease = settings.ease;
      changed = true;
    }
    return changed;
  }

  /** The settings as persisted values, under names no parameter can have. */
  encode(): Record<string, number> {
    return { $duration: this.duration, $loop: LOOP_MODES.indexOf(this.loop), $ease: EASES.indexOf(this.ease) };
  }

  /** Reads persisted settings back; unknown or out-of-range numbers are ignored. */
  static decode(values: Readonly<Record<string, number>> | undefined): { duration?: number; loop?: LoopMode; ease?: Ease } {
    if (!values) return {};
    const out: { duration?: number; loop?: LoopMode; ease?: Ease } = {};
    if (typeof values.$duration === 'number') out.duration = values.$duration;
    const loop = LOOP_MODES[values.$loop ?? -1];
    if (loop) out.loop = loop;
    const ease = EASES[values.$ease ?? -1];
    if (ease) out.ease = ease;
    return out;
  }
}

/** Persisted names that hold settings rather than parameters. */
export const isSettingName = (name: string) => name.startsWith('$');

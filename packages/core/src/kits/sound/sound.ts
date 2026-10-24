import type { NoiseColor, NoteOptions, Sound, Waveform } from '../../api/types';
import type { SoundState } from '../../protocol/scene-commands';
import { SOUND_LIMITS as L } from './limits';
import { SceneApiError } from '../../scene/errors';
import type { SceneGraph } from '../../scene/graph';

const WAVES: readonly Waveform[] = ['sine', 'square', 'sawtooth', 'triangle'];
const COLORS: readonly NoiseColor[] = ['white', 'pink', 'brown'];

type Options = { readonly frequency?: number; readonly gain?: number; readonly wave?: Waveform; readonly color?: NoiseColor; readonly duration?: number };

function pick<T extends string>(list: readonly T[], value: unknown, before: T | undefined, name: string): T {
  if (value === undefined) return before ?? list[0]!;
  if (list.includes(value as T)) return value as T;
  throw new SceneApiError(`inc.sound: ${name} is one of ${list.join(', ')}`);
}

/** A number held to its range; one that is not finite is reported, as an attribute's is, and the last good value stays. */
function num(graph: SceneGraph, value: unknown, before: number, min: number, max: number, name: string): number {
  if (value === undefined) return before;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(max, Math.max(min, value));
  graph.reportValue(`Sound ${name} received ${String(value)}`);
  return before;
}

function tone(graph: SceneGraph, o: Options, before?: SoundState): SoundState {
  const was = before?.kind === 'tone' ? before : undefined;
  if (!was && o.frequency === undefined) throw new SceneApiError('inc.sound needs a frequency in hertz, such as { frequency: 440 }');
  return {
    kind: 'tone',
    wave: pick(WAVES, o.wave, was?.wave, 'wave'),
    frequency: num(graph, o.frequency, was?.frequency ?? Number.NaN, L.minFrequency, L.maxFrequency, 'frequency'),
    gain: num(graph, o.gain, was?.gain ?? 0.5, 0, 1, 'gain'),
  };
}

function noise(graph: SceneGraph, o: Options, before?: SoundState): SoundState {
  const was = before?.kind === 'noise' ? before : undefined;
  return { kind: 'noise', color: pick(COLORS, o.color, was?.color, 'color'), gain: num(graph, o.gain, was?.gain ?? 0.5, 0, 1, 'gain') };
}

/** inc.sound, over the scene graph the runtime has now; each sound keeps the graph it began in. */
export function createSound(current: () => SceneGraph): Sound {
  const start = (make: typeof tone, options: Options | undefined) => {
    const graph = current();
    const id = graph.newId();
    let state: SoundState | undefined;
    let stopped = false;
    const send = (o: Options | undefined) => {
      state = make(graph, o ?? {}, state);
      // A frequency that is not a number sounds nothing until a good one arrives; a stopped sound stays stopped.
      if (stopped || (state.kind === 'tone' && !Number.isFinite(state.frequency))) return;
      if (!graph.sounds.has(id) && graph.sounds.size >= L.voices) throw new SceneApiError(`inc.sound: at most ${L.voices} tones and noises at once`);
      graph.setSound(id, state);
    };
    send(options);
    const handle = {
      set(o: Options) {
        send(o);
        return handle;
      },
      stop() {
        stopped = true;
        graph.silence(id);
      },
    };
    return Object.freeze(handle);
  };
  return Object.freeze({
    voice: (options: Options) => start(tone, options),
    noise: (options?: Options) => start(noise, options),
    note(options: NoteOptions) {
      const graph = current();
      const { wave, frequency, gain } = tone(graph, options ?? {}) as Extract<SoundState, { kind: 'tone' }>;
      if (Number.isFinite(frequency)) graph.note({ wave, frequency, gain, duration: num(graph, options.duration, 0.2, L.minNote, L.maxNote, 'duration') });
    },
  }) as Sound;
}

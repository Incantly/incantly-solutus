/**
 * The Tone.js backend (sound design 4): one context, a master gain and one limiter for the page. A tone is an
 * oscillator, a noise is a noise source; each goes through its own panner and gain, which start at silence. This file is
 * its own chunk: it loads when sound is first turned on.
 */
import * as Tone from 'tone';
import type { PlayingSound } from '@incantly/kernel';
import type { Backend, Voice, VoiceParams } from './engine';

export async function createToneBackend(): Promise<Backend> {
  const limiter = new Tone.Limiter(-3).toDestination();
  const master = new Tone.Gain(0).connect(limiter);
  const meter = new Tone.Meter({ normalRange: true, smoothing: 0.8 });
  master.connect(meter);

  const voice = (s: PlayingSound): Voice => {
    const gain = new Tone.Gain(0).connect(master);
    const panner = new Tone.Panner(s.pan).connect(gain);
    const src = s.kind === 'noise'
      ? new Tone.Noise(s.color ?? 'white').connect(panner)
      : new Tone.Oscillator(s.frequency ?? 440, s.wave ?? 'sine').connect(panner);
    src.start();
    let wave = s.wave;
    let stopped = false;
    return {
      set(p: VoiceParams, rampS: number) {
        if (stopped) return;
        gain.gain.rampTo(p.gain, rampS);
        panner.pan.rampTo(p.pan, rampS);
        if (src instanceof Tone.Oscillator) {
          if (p.frequency !== undefined) src.frequency.rampTo(p.frequency, rampS);
          if (p.wave && p.wave !== wave) {
            src.type = p.wave;
            wave = p.wave;
          }
        }
      },
      stop(fadeS: number) {
        if (stopped) return;
        stopped = true;
        gain.gain.rampTo(0, fadeS);
        const at = Tone.now() + fadeS + 0.02;
        src.stop(at);
        setTimeout(() => {
          src.dispose();
          panner.dispose();
          gain.dispose();
        }, (fadeS + 0.1) * 1000);
      },
    };
  };

  return {
    async start() {
      await Tone.start();
      if (Tone.getContext().state !== 'running') throw new Error('audio blocked');
    },
    voice,
    setMaster(g: number, rampS: number) {
      master.gain.rampTo(g, rampS);
    },
    level() {
      const v = meter.getValue();
      return Math.min(1, Math.max(0, typeof v === 'number' ? v : 0));
    },
    close() {
      master.dispose();
      limiter.dispose();
      meter.dispose();
    },
  };
}

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock, mountTrusted, type MountedFigure } from '../src';
import type { Inc } from '../src/api/types';
import { kit } from '../src/kits/sound';
import { SOUND_LIMITS } from '../src/kits/sound/limits';
import { probeScene } from '../src/probe/probe';
import { resetSoundOutput, SoundPlayer, MASTER_GAIN } from '../src/renderer/sound';
import { SceneRuntime } from '../src/runtime/runtime';
import { validateSceneJs } from '../src/validation/js';

// ---------------------------------------------------------------------------
// A stand-in for Web Audio that records what the player asks of it
// ---------------------------------------------------------------------------

class FakeParam {
  value = 0;
  readonly targets: number[] = [];
  setTargetAtTime(value: number) {
    this.value = value;
    this.targets.push(value);
  }
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connected = true;
  connect(node: FakeNode) {
    this.outputs.push(node);
    return node;
  }
  disconnect() {
    this.connected = false;
  }
}

class FakeSource extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  buffer: unknown = null;
  loop = false;
  started = false;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start() {
    this.started = true;
  }
  stop(at = 0) {
    this.stoppedAt = at;
  }
}

class FakeContext {
  state = 'running';
  currentTime = 0;
  readonly sampleRate = 100;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: Array<FakeNode & { gain: FakeParam }> = [];
  buffers = 0;
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: new FakeParam() });
    node.gain.value = 1;
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number) {
    this.buffers++;
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}

function fakeAudio() {
  const context = new FakeContext();
  return { context, factory: () => context as unknown as AudioContext };
}

afterEach(() => resetSoundOutput());

// ---------------------------------------------------------------------------
// The scene side: inc.sound in the runtime
// ---------------------------------------------------------------------------

function run(scene: (inc: Inc) => void) {
  const runtime = new SceneRuntime({ autoplay: false, kits: { sound: kit } });
  const first = runtime.mount(scene);
  return { runtime, first };
}

describe('inc.sound in the scene', () => {
  it('sends a tone, its changes and its end as commands, and a change that is the same again as nothing', () => {
    let voice: ReturnType<Inc['sound']['voice']> | null = null;
    const { runtime, first } = run((inc) => {
      voice = inc.sound.voice({ frequency: 440, wave: 'square' });
    });
    expect(first.commands.filter((c) => c.op === 'sound')).toEqual([{ op: 'sound', id: expect.any(Number), sound: { kind: 'tone', wave: 'square', frequency: 440, gain: 0.5 } }]);
    voice!.set({ frequency: 660 });
    expect(runtime.graph.flush()).toEqual([{ op: 'sound', id: expect.any(Number), sound: { kind: 'tone', wave: 'square', frequency: 660, gain: 0.5 } }]);
    voice!.set({ frequency: 660 });
    expect(runtime.graph.flush()).toEqual([]);
    voice!.stop();
    expect(runtime.graph.flush()).toEqual([{ op: 'silence', id: expect.any(Number) }]);
    voice!.set({ frequency: 300 });
    expect(runtime.graph.flush()).toEqual([]);
  });

  it('holds frequencies and gains to their range, and reports a number that is not finite instead of sounding it', () => {
    let voice: ReturnType<Inc['sound']['voice']> | null = null;
    const { runtime } = run((inc) => {
      voice = inc.sound.voice({ frequency: 99_999, gain: 4 });
    });
    expect([...runtime.graph.sounds.values()]).toEqual([{ kind: 'tone', wave: 'sine', frequency: SOUND_LIMITS.maxFrequency, gain: 1 }]);
    voice!.set({ frequency: Number.NaN });
    expect(runtime.graph.flush()).toEqual([]);
    expect(runtime.graph.diagnostics).toEqual([{ kind: 'non-finite', message: 'Sound frequency received NaN' }]);
  });

  it('makes noise in three colours, and short notes that a snapshot does not replay', () => {
    const { runtime, first } = run((inc) => {
      inc.sound.noise({ color: 'pink', gain: 0.2 });
      inc.sound.note({ frequency: 523.25, duration: 5 });
    });
    expect(first.commands.filter((c) => c.op === 'sound' || c.op === 'note')).toEqual([
      { op: 'sound', id: expect.any(Number), sound: { kind: 'noise', color: 'pink', gain: 0.2 } },
      { op: 'note', wave: 'sine', frequency: 523.25, duration: SOUND_LIMITS.maxNote, gain: 0.5 },
    ]);
    const snapshot = runtime.graph.snapshotCommands();
    expect(snapshot.filter((c) => c.op === 'sound')).toHaveLength(1);
    expect(snapshot.filter((c) => c.op === 'note')).toHaveLength(0);
  });

  it('allows at most eight sounds at once, and names the waves and colours it knows', () => {
    const tooMany = new SceneRuntime({ autoplay: false, kits: { sound: kit } });
    tooMany.mount((inc) => {
      for (let i = 0; i <= SOUND_LIMITS.voices; i++) inc.sound.voice({ frequency: 200 + i });
    });
    expect(tooMany.errors[0]?.message).toContain('at most 8');
    const badWave = new SceneRuntime({ autoplay: false, kits: { sound: kit } });
    badWave.mount((inc) => {
      inc.sound.voice({ frequency: 200, wave: 'buzz' as 'sine' });
    });
    expect(badWave.errors[0]?.message).toContain('wave is one of sine, square, sawtooth, triangle');
  });

  it('says the sound kit is missing on a page that did not load it', () => {
    const runtime = new SceneRuntime({ autoplay: false });
    runtime.mount((inc) => {
      inc.sound.voice({ frequency: 440 });
    });
    expect(runtime.errors[0]?.message).toContain('needs the sound kit');
  });
});

describe('sound in the validator and the probe', () => {
  it('accepts inc.sound and records its kit, and rejects what is not part of it', () => {
    const ok = validateSceneJs("const v = inc.sound.voice({ frequency: 440 }); inc.onFrame(() => { v.set({ gain: 0.3 }); }); inc.sound.noise({ color: 'white' });");
    expect(ok.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
    expect(ok.info.kits).toEqual(['sound']);
    const bad = validateSceneJs('inc.sound.beep({ frequency: 440 });');
    expect(bad.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    // A colour is still a colour to draw everywhere else.
    expect(validateSceneJs("const s = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'T' }); s.circle(1, 1, 1, { color: 'white' });").diagnostics.map((d) => d.rule)).toContain('hard-coded-colour');
  });

  it('fails the numbers check when a frequency is not a number at some value of a control', () => {
    const report = probeScene(
      (inc) => {
        const k = inc.param('k', { min: 0, max: 2, value: 1 });
        const v = inc.sound.voice({ frequency: 440 });
        inc.onFrame(() => {
          v.set({ frequency: 440 / (k.value - 2) + (k.value === 2 ? Number.NaN : 0) });
        });
        inc.describe(() => 'A tone.');
      },
      { runtime: { kits: { sound: kit } } },
    );
    expect(report.failures.map((f) => f.check)).toContain('numbers');
  });
});

// ---------------------------------------------------------------------------
// The host side: the player and the sound button
// ---------------------------------------------------------------------------

describe('the sound player', () => {
  it('stays silent and makes no audio context until it is switched on', () => {
    const audio = fakeAudio();
    let made = 0;
    const player = new SoundPlayer(() => {
      made++;
      return audio.factory();
    });
    player.apply([{ op: 'sound', id: 1, sound: { kind: 'tone', wave: 'sine', frequency: 440, gain: 0.5 } }]);
    expect(made).toBe(0);
    expect(player.hasSound).toBe(true);
    player.setEnabled(true);
    expect(made).toBe(1);
    const oscillator = audio.context.sources[0]!;
    expect(oscillator).toMatchObject({ type: 'sine', started: true });
    expect(oscillator.frequency.value).toBe(440);
  });

  it('glides a change rather than jumping, and fades a silenced tone before it stops', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer(audio.factory);
    player.setEnabled(true);
    player.apply([{ op: 'sound', id: 1, sound: { kind: 'tone', wave: 'sine', frequency: 440, gain: 0.5 } }]);
    player.apply([{ op: 'sound', id: 1, sound: { kind: 'tone', wave: 'triangle', frequency: 880, gain: 0.5 } }]);
    const oscillator = audio.context.sources[0]!;
    expect(audio.context.sources).toHaveLength(1);
    expect(oscillator.type).toBe('triangle');
    expect(oscillator.frequency.targets).toEqual([880]);
    player.apply([{ op: 'silence', id: 1 }]);
    expect(oscillator.stoppedAt).toBeGreaterThan(0);
  });

  it('plays noise from a buffer made once per colour, looped', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer(audio.factory);
    player.setEnabled(true);
    player.apply([
      { op: 'sound', id: 1, sound: { kind: 'noise', color: 'white', gain: 0.5 } },
      { op: 'sound', id: 2, sound: { kind: 'noise', color: 'white', gain: 0.2 } },
    ]);
    expect(audio.context.buffers).toBe(1);
    expect(audio.context.sources.every((s) => s.loop && s.started)).toBe(true);
  });

  it('limits notes to a few dozen a second, so a note on every frame cannot become a buzz', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer(audio.factory);
    player.setEnabled(true);
    for (let i = 0; i < 100; i++) player.apply([{ op: 'note', wave: 'sine', frequency: 440, duration: 0.1, gain: 0.5 }]);
    expect(audio.context.sources).toHaveLength(SOUND_LIMITS.notesPerSecond);
  });

  it('keeps everything behind one limiter and a quiet master gain', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer(audio.factory);
    player.setEnabled(true);
    const master = audio.context.gains[0]!;
    expect(master.gain.value).toBe(MASTER_GAIN);
    expect(master.outputs).toEqual([audio.context.destination]);
  });

  it('fades the figure out while it may not sound, and back in', () => {
    const audio = fakeAudio();
    const player = new SoundPlayer(audio.factory);
    player.setEnabled(true);
    const bus = audio.context.gains[1]!;
    player.setAudible(false);
    player.setAudible(true);
    expect(bus.gain.targets).toEqual([1, 0, 1]);
  });
});

const TONE_SCENE = {
  html: "<div id='stage'></div>",
  css: '',
  js: `
    const freq = inc.param('freq', { min: 110, max: 880, value: 440, unit: 'Hz', label: 'Frequency' });
    const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Tone', description: 'A tone.' });
    stage.circle(50, 50, 4, { tone: 'hi' });
    const voice = inc.sound.voice({ frequency: freq.value });
    inc.onFrame(() => { voice.set({ frequency: freq.value }); });
    inc.describe(() => 'A tone at ' + freq.value + ' Hz.');
  `,
};

describe('the sound button', () => {
  const mounted: MountedFigure[] = [];
  afterEach(() => {
    while (mounted.length) mounted.pop()?.destroy();
    document.body.replaceChildren();
  });

  it('appears once the figure has sound, starts off, and switches the sound on with a tap', () => {
    const audio = fakeAudio();
    const clock = new ManualClock();
    const container = document.createElement('div');
    document.body.append(container);
    const figure = mountTrusted(container, TONE_SCENE, { clock, visibility: 'external', kits: { sound: kit }, audio: audio.factory });
    mounted.push(figure);
    clock.advance();
    const button = figure.root.querySelector<HTMLButtonElement>('button[data-action=sound]')!;
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(audio.context.sources).toHaveLength(0);
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toBe('Sound on');
    expect(audio.context.sources[0]?.frequency.value).toBe(440);
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(audio.context.sources[0]?.stoppedAt).not.toBeNull();
  });

  it('is not offered on a figure without sound', () => {
    const clock = new ManualClock();
    const container = document.createElement('div');
    document.body.append(container);
    const figure = mountTrusted(container, { ...TONE_SCENE, js: TONE_SCENE.js.replace(/const voice[^\n]*\n[^\n]*onFrame[^\n]*\n/, '') }, { clock, visibility: 'external', kits: { sound: kit } });
    mounted.push(figure);
    clock.advance();
    expect(figure.root.querySelector<HTMLButtonElement>('button[data-action=sound]')!.hidden).toBe(true);
  });
});

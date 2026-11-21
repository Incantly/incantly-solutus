/** Sound in the studio (.kiro/specs/sound R5), with a recording engine backend. */
import { afterEach, describe, expect, it } from 'vitest';
import { SoundEngine } from '@incantly/audio';
import type { Backend, VoiceParams } from '@incantly/audio';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

class Recorder implements Backend {
  readonly live = new Map<string, VoiceParams>();
  master = 0;
  start(): Promise<void> {
    return Promise.resolve();
  }
  voice(s: { key: string }) {
    return {
      set: (p: VoiceParams) => void this.live.set(s.key, p),
      stop: () => void this.live.delete(s.key),
    };
  }
  setMaster(g: number): void {
    this.master = g;
  }
  level(): number {
    return this.live.size > 0 ? 0.6 : 0;
  }
  close(): void {}
}

describe('sound in the studio', () => {
  let root: HTMLElement;
  let m: Mounted;
  let rec: Recorder;
  const mount = (mode: 'graphing' | 'geometry' = 'graphing'): Mounted => {
    root = document.createElement('div');
    document.body.append(root);
    rec = new Recorder();
    const engine = new SoundEngine(() => Promise.resolve(rec));
    m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, mode, soundEngine: () => Promise.resolve(engine) });
    return m;
  };
  afterEach(() => {
    m.dispose();
    root.remove();
  });

  it('the speaker shows only for a figure with sound, off by default (R5.1)', () => {
    mount();
    expect(m.sound.button.hidden).toBe(true);
    m.session.applyLines(['a = Tone(440, 0.3)'], 'test');
    expect(m.sound.button.hidden).toBe(false);
    expect(m.sound.isOn()).toBe(false);
    expect(m.sound.button.getAttribute('aria-label')).toBe('Sound off: click to hear this figure');
    m.sound.frame(0);
    expect(rec.live.size).toBe(0);
  });

  it('a click turns it on; each frame the engine gets what plays (R5.1)', async () => {
    mount();
    m.session.applyLines(['f = 440 in 200..900', 'a = Tone(f, 0.3)'], 'test');
    await m.sound.enable();
    expect(m.sound.isOn()).toBe(true);
    m.sound.frame(0);
    expect([...rec.live.values()]).toEqual([{ frequency: 440, gain: 0.3, pan: 0, wave: 'sine' }]);
    m.session.slide('f', 660, true);
    m.sound.frame(16);
    expect([...rec.live.values()][0]?.frequency).toBe(660);
    expect(m.sound.button.classList.contains('on')).toBe(true);
    m.sound.disable();
    expect(rec.live.size).toBe(0);
  });

  it('the master volume setting reaches the engine (R5.3)', async () => {
    mount();
    m.session.applyLines(['a = Tone(440)'], 'test');
    await m.sound.enable();
    expect(rec.master).toBe(0.8);
    m.modes.settings.set('masterVolume', 30);
    expect(rec.master).toBeCloseTo(0.3);
    m.modes.openSettings();
    const tabs = [...m.modes.settingsSheet.querySelectorAll('.settings-tabs .tab')].map((t) => t.textContent);
    expect(tabs).toContain('Sound');
  });

  it('a sound row has a mute toggle (R5.2)', async () => {
    mount();
    m.session.applyLines(['a = Tone(440, 0.3)'], 'test');
    const row = (): HTMLElement => root.querySelector('.expr[data-name="a"]') as HTMLElement;
    expect(row().textContent).toMatch(/tone 440 Hz, gain 0\.3/);
    const toggle = row().querySelector('.sound-mute') as HTMLButtonElement;
    expect(toggle.textContent).toBe('🔊 mute');
    await m.sound.enable();
    m.sound.frame(0);
    expect(rec.live.size).toBe(1);
    toggle.click();
    expect(m.session.isMuted('a')).toBe(true);
    m.sound.frame(16);
    expect(rec.live.size).toBe(0);
    expect((row().querySelector('.sound-mute') as HTMLElement).textContent).toBe('🔇 muted');
    expect(m.session.undoState().label).not.toMatch(/mute/i);
  });

  it('a note while the clock stands still ends after its length', async () => {
    mount();
    m.session.applyLines(['a = Tone(440, 0)'], 'test');
    await m.sound.enable();
    m.session.submit('Note(500, 0.5)');
    m.sound.frame(1000);
    expect([...rec.live.values()].map((p) => p.frequency)).toEqual([500]);
    m.sound.frame(1300);
    expect(rec.live.size).toBe(1);
    m.sound.frame(1600);
    expect(rec.live.size).toBe(0);
  });

  it('the sound examples load in their modes (R5.4)', () => {
    mount('graphing');
    for (const id of ['sound-beats', 'sound-scale', 'sound-sonify']) {
      m.loadExample(id);
      expect(m.status.textContent).not.toMatch(/Could not|is not available/);
      expect(m.sound.button.hidden).toBe(false);
    }
  });
});

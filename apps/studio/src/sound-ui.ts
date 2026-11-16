/**
 * Sound in the studio (sound ui; .kiro/specs/sound R5): a speaker button on a figure that has a sound, off by default.
 * A click turns sound on for the page (it is the browser's gesture) and starts feeding the engine what plays now, once a
 * frame. While playing, three bars move with the level, so a reader who cannot hear sees that sound is happening.
 * The engine and Tone.js load only when the speaker is first pressed.
 */
import { soundsAt } from '@incantly/kernel';
import type { Channel, SoundEngine } from '@incantly/audio';
import type { KernelSession } from './session';

export interface SoundUi {
  readonly button: HTMLButtonElement;
  /** The figure changed: show or hide the speaker. */
  refresh(): void;
  /** Turns sound on, as the click does. */
  enable(): Promise<void>;
  disable(): void;
  isOn(): boolean;
  setVolume(v: number): void;
  /** One frame: hands the engine what plays now (tests call it; the page calls it each animation frame). */
  frame(nowMs: number): void;
  dispose(): void;
}

export interface SoundUiOptions {
  readonly session: KernelSession;
  readonly say: (text: string) => void;
  /** The page's engine; a test passes its own. Default: `pageEngine()` from `@incantly/audio`, loaded on first press. */
  readonly engine?: () => Promise<SoundEngine>;
  readonly raf?: (cb: (now: number) => void) => number;
  readonly caf?: (h: number) => void;
}

const SPEAKER_OFF = '🔇';
const SPEAKER_ON = '🔊';

export function mountSoundUi(o: SoundUiOptions): SoundUi {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'graph-btn sound-btn';
  button.hidden = true;
  const icon = document.createElement('span');
  icon.className = 'sound-icon';
  icon.textContent = SPEAKER_OFF;
  const bars = document.createElement('span');
  bars.className = 'sound-bars';
  bars.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) bars.append(document.createElement('i'));
  button.append(icon, bars);

  let engine: SoundEngine | undefined;
  let channel: Channel | undefined;
  let on = false;
  let loop = 0;
  let volume = 0.8;
  // the film clock time last seen, and when (wall time): a note heard while the clock stands still still ends
  let lastT = Number.NaN;
  let anchor = 0;
  const raf = o.raf ?? ((cb: (n: number) => void) => requestAnimationFrame(cb));
  const caf = o.caf ?? ((h: number) => cancelAnimationFrame(h));

  const label = (): void => {
    const blocked = engine?.state === 'blocked';
    icon.textContent = on ? SPEAKER_ON : SPEAKER_OFF;
    button.classList.toggle('on', on);
    const t = blocked ? 'Tap to hear' : on ? 'Sound on: click to turn it off' : 'Sound off: click to hear this figure';
    button.title = t;
    button.setAttribute('aria-label', t);
    button.setAttribute('aria-pressed', String(on));
  };
  label();

  const loadEngine = o.engine ?? (async () => (await import('@incantly/audio')).pageEngine());

  const api: SoundUi = {
    button,
    refresh() {
      // a figure has sound when it has sound objects or notes, or a handler that plays one (`on go click: Sonify(…)`)
      const has = soundsAt(o.session.figure).hasSound || o.session.handlers().some((h) => h.steps.some((s) => /^\s*(Note|Sonify)\(/.test(s.text)));
      button.hidden = !has || engine?.state === 'unavailable';
      if (!has && on) api.disable();
    },
    async enable() {
      engine ??= await loadEngine();
      const state = await engine.enable();
      if (state === 'on') {
        engine.setVolume(volume);
        channel ??= engine.channel();
        on = true;
        o.say('Sound on.');
        const tick = (now: number): void => {
          api.frame(now);
          loop = raf(tick);
        };
        if (!loop) loop = raf(tick);
      } else if (engine.problem) {
        o.say(engine.problem.message);
        if (state === 'unavailable') button.hidden = true;
      }
      label();
    },
    disable() {
      on = false;
      engine?.disable();
      if (loop) caf(loop);
      loop = 0;
      bars.style.removeProperty('--level');
      label();
      o.say('Sound off.');
    },
    isOn: () => on,
    setVolume(v) {
      volume = v;
      engine?.setVolume(v);
    },
    frame(nowMs) {
      if (!channel || !on) return;
      const f = o.session.figure;
      const t = f.clockState.t;
      if (t !== lastT) {
        lastT = t;
        anchor = nowMs;
      }
      // while the clock plays, notes follow it; while it stands, they follow the wall clock from that moment
      const eventsAt = o.session.playing() ? t : t + (nowMs - anchor) / 1000;
      channel.update(soundsAt(f, t, eventsAt));
      bars.style.setProperty('--level', String(engine?.level() ?? 0));
    },
    dispose() {
      if (loop) caf(loop);
      channel?.dispose();
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
  // a hidden page fades its sounds out (design 4.6)
  const onVisible = (): void => {
    if (document.visibilityState === 'hidden') channel?.pause();
    else channel?.resume();
  };
  document.addEventListener('visibilitychange', onVisible);
  button.addEventListener('click', () => {
    if (on) api.disable();
    else void api.enable();
  });
  return api;
}

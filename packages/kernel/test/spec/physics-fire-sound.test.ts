/**
 * The crackle of a fire (.kiro/specs/physics R11.6; docs/features/physics design 9.7 "The crackle", agent.md `Fire(…, sound?)`).
 *
 * `sound = true` plays brown noise (key `fire:<id>`) while some cell is above 500 °C, as loud as
 * `0.3 min(1, flames / (0.05 n²)) (0.7 + 0.3 q)`; it is off unless asked; `soundsAt` reports it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, physics, physicsOf, registerAnimation, registerFunctions, registerLists, registerNumbers, registerPhysics, registerSound, soundsAt } from '../../src/index';

const REG = (() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
  registerSound(r);
  registerPhysics(r);
  return r;
})();

let f: Figure;
beforeEach(() => {
  f = new Figure({ commands: REG });
});

const all = (lines: readonly string[], fig = f): void => {
  for (const l of lines) {
    const r = fig.apply(l);
    if (!r.ok) throw new Error(`${l}: ${(r as { message: string }).message}`);
  }
};
const make = (lines: readonly string[]): Figure => {
  const g = new Figure({ commands: REG });
  all(lines, g);
  return g;
};
const play = (t: number, fig = f): void => {
  const now = fig.clock().t;
  const frames = Math.round((t - now) * 60);
  for (let k = 1; k <= frames; k++) fig.setClock(now + k / 60);
};
const seek = (fig: Figure, t: number): void => {
  fig.setClock(t);
  for (let k = 0; k < 200 && fig.driversNeedFrames(); k++) fig.flush(true);
};
const fire = (name: string, fig = f): physics.FireValue => {
  const v = fig.value(name);
  if (!physics.isFireValue(v)) throw new Error(`${name} is not a fire now`);
  return v;
};
const fireSounds = (fig: Figure, t: number): ReturnType<typeof soundsAt>['sounds'] => soundsAt(fig, t).sounds.filter((s) => s.key.startsWith('fire:'));

const SOURCE = 'source = Circle((0, 0.3), 0.3)';
const LOUD = `fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, sound = true)`;
const QUIET = `fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE})`;

describe('the crackle of a fire (design 9.7)', () => {
  it('with sound = true a burning fire plays brown noise: soundsAt has one noise with key fire:<id>, and hasSound is true', () => {
    all([LOUD]);
    play(1);
    expect(fire('fire').flames).toBeGreaterThan(0);
    const frame = soundsAt(f);
    expect(frame.hasSound).toBe(true);
    const s = fireSounds(f, f.clock().t);
    expect(s.length).toBe(1);
    expect(s[0]).toMatchObject({ kind: 'noise', color: 'brown' });
    expect(s[0]?.key).toBe(`fire:${f.get('fire')?.id}`);
    expect(s[0]?.gain).toBeGreaterThan(0);
  });

  it('it is soft: the loudness is at most 0.3, and it follows how much burns: a fire with a bigger source is louder than a small one', () => {
    const big = make([`fire = Fire(Box((0, 2), 4, 4), 48, source = Circle((0, 0.4), 0.4), sound = true)`]);
    const small = make([`fire = Fire(Box((0, 2), 4, 4), 48, source = Circle((0, 0.1), 0.05), sound = true)`]);
    play(2, big);
    play(2, small);
    let sumBig = 0;
    let sumSmall = 0;
    for (let k = 0; k < 40; k++) {
      const t = 2 + k / 20;
      const gb = fireSounds(big, t)[0]?.gain ?? 0;
      const gs = fireSounds(small, t)[0]?.gain ?? 0;
      expect(gb).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(gs).toBeLessThanOrEqual(0.3 + 1e-9);
      sumBig += gb;
      sumSmall += gs;
    }
    expect(fire('fire', big).flames).toBeGreaterThan(fire('fire', small).flames);
    expect(sumBig).toBeGreaterThan(sumSmall);
  });

  it('the loudness is 0.3 min(1, flames / (0.05 n²)) times a factor from 0.7 to 1 that pops with the film time', () => {
    all([LOUD]);
    play(2);
    const v = fire('fire');
    const base = 0.3 * Math.min(1, v.flames / (0.05 * v.spec.n * v.spec.n));
    expect(base).toBeGreaterThan(0);
    const gains = new Set<number>();
    for (let k = 0; k < 60; k++) {
      const g = fireSounds(f, 2 + k / 20)[0]?.gain as number;
      expect(g).toBeGreaterThanOrEqual(base * 0.7 - 1e-9);
      expect(g).toBeLessThanOrEqual(base + 1e-9);
      gains.add(g);
    }
    // pops: not one steady level
    expect(gains.size).toBeGreaterThan(5);
  });

  it('the pops are fixed by the figure: the same time gives the same gain twice, in two figures and after a seek', () => {
    all([LOUD]);
    play(2);
    const other = make([LOUD]);
    play(2, other);
    const sought = make([LOUD]);
    seek(sought, 2);
    for (const t of [2, 2.05, 2.5, 3.14]) {
      const g = fireSounds(f, t)[0]?.gain;
      expect(g).toBeDefined();
      expect(fireSounds(f, t)[0]?.gain).toBe(g);
      expect(fireSounds(other, t)[0]?.gain).toBe(g);
      expect(fireSounds(sought, t)[0]?.gain).toBe(g);
    }
  });

  it('the pop holds for a twentieth of a second: two times in one 1/20 s give one gain', () => {
    all([LOUD]);
    play(2);
    expect(fireSounds(f, 2.01)[0]?.gain).toBe(fireSounds(f, 2.04)[0]?.gain);
  });

  it('without sound = true there is no crackle, and the figure has no sound at all', () => {
    all([QUIET]);
    play(2);
    expect(fire('fire').flames).toBeGreaterThan(0);
    expect(fireSounds(f, 2)).toEqual([]);
    expect(soundsAt(f).sounds).toEqual([]);
    expect(soundsAt(f).hasSound).toBe(false);
    const off = make([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, sound = false)`]);
    play(2, off);
    expect(soundsAt(off).sounds).toEqual([]);
    expect(soundsAt(off).hasSound).toBe(false);
  });

  it('a figure with sound = true has the speaker (hasSound) even before the fire burns, with nothing playing while it is cold', () => {
    all(['fire = Fire(Box((0, 2), 4, 4), 16, sound = true)']);
    play(1);
    const frame = soundsAt(f);
    expect(frame.hasSound).toBe(true);
    expect(frame.sounds.filter((s) => s.key.startsWith('fire:'))).toEqual([]);
  });

  it('the crackle stops when the fire goes out, and a fire that is out is silent', () => {
    all([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, until = 1, sound = true)`]);
    play(0.8);
    expect(fireSounds(f, 0.8).length).toBe(1);
    play(60);
    expect(fire('fire').out).toBe(true);
    expect(fireSounds(f, 60)).toEqual([]);
    expect(soundsAt(f).hasSound).toBe(true);
  });

  it('it is silent at a time when no cell is above 500 °C: a fire that only smoulders makes no noise', () => {
    all([`fire = Fire(Box((0, 2), 4, 4), 48, ${SOURCE}, heat = 400, sound = true)`]);
    play(2);
    expect(Math.max(...Array.from(fire('fire').temp))).toBeLessThan(500);
    expect(fireSounds(f, 2)).toEqual([]);
  });

  it('it is the same with the sound objects of the sound area: a Noise next to a loud fire plays too, fire after the sound objects', () => {
    all(['wind = Noise("pink", 0.1)', LOUD]);
    play(1);
    const s = soundsAt(f).sounds;
    expect(s.map((x) => x.key.startsWith('fire:'))).toEqual([false, true]);
    expect(s[0]).toMatchObject({ kind: 'noise', color: 'pink' });
  });

  it('two loud fires make two sounds with their own keys', () => {
    all([`a = Fire(Box((0, 2), 4, 4), 32, ${SOURCE}, sound = true)`, `b = Fire(Box((10, 2), 4, 4), 32, source = Circle((10, 0.3), 0.3), sound = true)`]);
    play(1);
    const s = fireSounds(f, 1);
    expect(s.length).toBe(2);
    expect(new Set(s.map((x) => x.key)).size).toBe(2);
  });

  it('a burning body and its fire: the crackle follows the fire, and the physics world is not changed by the sound', () => {
    const quiet = make(['g = Ground()', QUIET, 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 3)']);
    const loud = make(['g = Ground()', LOUD, 'wood = Body(Box((0, 0.1), 1.2, 0.2), mass = 1, burns = 3)']);
    play(5, quiet);
    play(5, loud);
    expect(Array.from(fire('fire', loud).temp)).toEqual(Array.from(fire('fire', quiet).temp));
    expect(physicsOf(loud).worldHash === undefined).toBe(false);
  });
});

/**
 * Slider animation as a pure function of the clock (numbers-sliders/design.md 3.4, 4; errors.md 2 and 3), the pure helper
 * functions, and the figure-level start, stop, tick, drag and resume behaviour.
 *
 * Silent-doc choices (written down):
 *  - `down` with the anchor at the bottom (p0 = 0, s = 0) follows the formula as written: 1 - frac(1) = 1, so it starts at the top.
 *  - `Animate` on a dependent number is `not_animatable` with reason `dependent` (design 4), not `not_free` (errors.md 2 lists both).
 *  - A `once` slider reports finished from `t0 + period * (1 - p0)` on.
 */
import { describe, expect, it } from 'vitest';
import { animFraction, animRandom, animateAll, animateSlider, animationValueAt, getAnchor, isAnimating, onceEndTime, onceFinished, pauseAnimation, resumeAnimation, startDir, tickAnimations } from '@incantly/kernel';
import type { AnimationValueOpts, FigureEvent, LoopMode } from '@incantly/kernel';
import { T, bad, build, fig, newFigure, num, oid, ok, prng, reasonOf, reject, within, each } from './helpers';

const anim = (over: Partial<AnimationValueOpts> = {}): number => {
  const r = animationValueAt({
    loop: 'up',
    lo: 0,
    hi: 10,
    period: 10,
    anchor: { t0: 0, v0: 0, dir: 1 },
    seed: 1,
    step: 'auto',
    unit: 'none',
    t: 0,
    ...over,
  });
  if (!r.ok) throw new Error(`animationValueAt failed: ${r.reason}`);
  return r.value;
};

describe('3.4 fraction table', () => {
  each([
    ['up', 0, 0.25, 0.25],
    ['up', 0, 1, 0],
    ['up', 0, 1.5, 0.5],
    ['up', 0.5, 0.75, 0.25],
    ['up', 0.25, 0, 0.25],
    ['up', 0.5, 0.5, 0],
    ['down', 1, 0, 1],
    ['down', 1, 0.25, 0.75],
    ['down', 0.5, 0, 0.5],
    ['down', 0.5, 0.25, 0.25],
    ['down', 0.5, 0.5, 1],
    ['down', 0.5, 0.75, 0.75],
    ['once', 0, 0.5, 0.5],
    ['once', 0.25, 0.5, 0.75],
    ['once', 0.25, 2, 1],
    ['once', 1, 0, 1],
    ['once', 1, 5, 1],
  ] as [LoopMode, number, number, number][])('%s with p0 %s after %s sweeps is %s', (loop, p0, s, want) => {
    expect(animFraction(loop, p0, s, 1)).toBeCloseTo(want, 12);
  });

  each([
    [0, 0.5, 0.5],
    [0, 1, 1],
    [0, 1.5, 0.5],
    [0, 2, 0],
    [0, 2.5, 0.5],
    [0.5, 0, 0.5],
    [0.5, 0.5, 1],
    [0.5, 1, 0.5],
  ])('bounce going up from p0 %s after %s sweeps is %s', (p0, s, want) => {
    expect(animFraction('bounce', p0, s, 1)).toBeCloseTo(want, 12);
  });

  each([
    [0.5, 0, 0.5],
    [0.5, 0.25, 0.25],
    [0.5, 0.5, 0],
    [0.5, 0.75, 0.25],
    [1, 0, 1],
    [1, 0.5, 0.5],
  ])('bounce going down from p0 %s after %s sweeps is %s', (p0, s, want) => {
    expect(animFraction('bounce', p0, s, -1)).toBeCloseTo(want, 12);
  });

  each(['up', 'down', 'bounce', 'once'] as LoopMode[])('%s: a negative number of sweeps clamps to the anchor value', (loop) => {
    expect(animFraction(loop, 0.3, -5, 1)).toBeCloseTo(0.3, 12);
  });
  each(['up', 'down', 'bounce', 'once'] as LoopMode[])('%s stays inside 0..1 for any p0 and s', (loop) => {
    const r = prng(5);
    for (let i = 0; i < 500; i++) {
      const f = animFraction(loop, r(), r() * 1000, r() < 0.5 ? 1 : -1);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('3.4 once, start direction, random draws', () => {
  it('onceFinished is true once p0 + s reaches 1', () => {
    expect(onceFinished(0.25, 0.75)).toBe(true);
    expect(onceFinished(0.25, 0.74)).toBe(false);
    expect(onceFinished(0, 5)).toBe(true);
  });
  it('onceEndTime is t0 + period * (1 - p0)', () => {
    expect(onceEndTime(4, 2, 0.25)).toBe(5);
    expect(onceEndTime(10, 0, 0)).toBe(10);
    expect(onceEndTime(10, 3, 1)).toBe(3);
  });
  it('startDir is up unless the value is at the top', () => {
    expect(startDir(3, 0, 10)).toBe(1);
    expect(startDir(0, 0, 10)).toBe(1);
    expect(startDir(10, 0, 10)).toBe(-1);
  });
  it('animRandom stays in [0, 1)', () => {
    for (let i = 0; i < 2000; i++) {
      const r = animRandom(3, i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
  });
  it('animRandom differs between periods and between seeds', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(animRandom(3, i));
    expect(seen.size).toBeGreaterThan(990);
    expect(animRandom(1, 5)).not.toBe(animRandom(2, 5));
  });
});

describe('3.4 animationValueAt: the slider value at time t', () => {
  each([
    [0, 0],
    [2.5, 2.5],
    [10, 0],
    [15, 5],
    [25, 5],
  ])('up, period 10, from 0: t = %s gives %s', (t, want) => {
    expect(anim({ t })).toBeCloseTo(want, 9);
  });
  each([
    [5, 5],
    [10, 10],
    [15, 5],
    [20, 0],
    [25, 5],
  ])('bounce from 0: t = %s gives %s', (t, want) => {
    expect(anim({ loop: 'bounce', t })).toBeCloseTo(want, 9);
  });
  it('down from the top: t = 2 gives 8', () => {
    expect(anim({ loop: 'down', anchor: { t0: 0, v0: 10, dir: -1 }, t: 2 })).toBeCloseTo(8, 9);
  });
  it('once stops at the top', () => {
    expect(anim({ loop: 'once', t: 5 })).toBeCloseTo(5, 9);
    expect(anim({ loop: 'once', t: 30 })).toBe(10);
  });
  it('before the anchor the slider shows the anchor value', () => {
    expect(anim({ anchor: { t0: 4, v0: 5, dir: 1 }, t: -3 })).toBe(5);
    expect(anim({ anchor: { t0: 4, v0: 5, dir: 1 }, t: 3 })).toBe(5);
  });
  it('a shorter period sweeps faster', () => {
    expect(anim({ period: 4, t: 1 })).toBeCloseTo(2.5, 9);
  });
  it('an anchor in the middle continues from its value', () => {
    expect(anim({ anchor: { t0: 4, v0: 5, dir: 1 }, t: 4 })).toBeCloseTo(5, 9);
    expect(anim({ anchor: { t0: 4, v0: 5, dir: 1 }, t: 6 })).toBeCloseTo(7, 9);
  });
  it('a fixed step quantises the animation (a counter)', () => {
    expect(anim({ step: 0.5, t: 3.7 })).toBe(3.5);
    expect(anim({ step: 1, t: 3.7 })).toBe(4);
  });
  it('an angle slider animates in radians', () => {
    expect(anim({ lo: 0, hi: 2 * Math.PI, anchor: { t0: 0, v0: 0, dir: 1 }, period: 8, unit: 'deg', t: 2 })).toBeCloseTo(Math.PI / 2, 9);
  });
  it('the result is always between lo and hi', () => {
    const r = prng(9);
    for (const loop of ['up', 'down', 'bounce', 'once', 'random'] as LoopMode[]) {
      for (let i = 0; i < 200; i++) {
        const v = anim({ loop, t: r() * 500, anchor: { t0: 0, v0: r() * 10, dir: 1 }, seed: 3 });
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(10);
      }
    }
  });
  it('is a pure function: the same t gives the same value whatever was asked before', () => {
    const direct = anim({ loop: 'bounce', t: 7.3 });
    for (let i = 0; i < 50; i++) anim({ loop: 'bounce', t: i * 0.37 });
    expect(anim({ loop: 'bounce', t: 7.3 })).toBe(direct);
  });
});

describe('3.4 random mode', () => {
  const rnd = (t: number, seed = 3, v0 = 2) => anim({ loop: 'random', seed, anchor: { t0: 0, v0, dir: 1 }, t });
  it('shows the anchor value during the first period', () => {
    expect(rnd(0)).toBe(2);
    expect(rnd(5)).toBe(2);
    expect(rnd(9.99)).toBe(2);
  });
  it('holds one value for the whole of each later period', () => {
    expect(rnd(10)).toBe(rnd(15));
    expect(rnd(10)).toBe(rnd(19.99));
    expect(rnd(20)).toBe(rnd(29));
  });
  it('draws a new value each period, inside the range', () => {
    const vals = new Set<number>();
    for (let k = 1; k <= 30; k++) {
      const v = rnd(k * 10 + 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
      vals.add(v);
    }
    expect(vals.size).toBeGreaterThan(25);
  });
});

describe('3.4 on a figure: start, tick, stop', () => {
  const slider = (extra = 'a with loop = up, period = 10') => fig(['a = 0 in 0..10', extra]);
  const start = (f = slider(), t = 0) => {
    ok(f.apply('SetValue(a, 0)')); // keep the value at 0 whatever the figure did before
    const r = animateSlider(f, 'a', true, { t });
    expect(r.ok).toBe(true);
    return f;
  };

  it('Animate(a) through animateSlider makes the slider animating', () => {
    const f = start();
    expect(isAnimating(f, 'a')).toBe(true);
  });
  it('a tick writes the animation value', () => {
    const f = start();
    tickAnimations(f, 2.5);
    expect(num(f, 'a')).toBeCloseTo(2.5, 9);
  });
  it('the value is a function of t only: ticking t = 7 straight equals ticking 70 small frames', () => {
    const f1 = start();
    tickAnimations(f1, 7);
    const f2 = start();
    for (let i = 1; i <= 70; i++) tickAnimations(f2, i / 10);
    expect(num(f2, 'a')).toBeCloseTo(num(f1, 'a'), 9);
  });
  it('seeking back shows the earlier value (replay safe)', () => {
    const f = start();
    tickAnimations(f, 9);
    tickAnimations(f, 2);
    expect(num(f, 'a')).toBeCloseTo(2, 9);
  });
  it('seeking before the anchor shows the anchor value', () => {
    const f = start(slider(), 4);
    tickAnimations(f, 1);
    expect(num(f, 'a')).toBe(0);
  });
  it('animation writes skip undo: 50 ticks add no undo entry', () => {
    const f = start();
    const depth = f.undoInfo().depth;
    for (let i = 1; i <= 50; i++) tickAnimations(f, i * 0.1);
    expect(f.undoInfo().depth).toBe(depth);
  });
  it('animation writes skip undo: undo after ticks undoes the earlier edit, not the animation', () => {
    const f = fig(['a = 0 in 0..10', 'a with loop = up, period = 10', 'b = 1']);
    animateSlider(f, 'a', true, { t: 0 });
    tickAnimations(f, 3);
    ok(f.apply('b = 2'));
    tickAnimations(f, 4);
    ok(f.undo());
    expect(num(f, 'b')).toBe(1);
    expect(f.undoInfo().redoDepth).toBe(1);
  });
  it('a tick tells listeners the slider changed (a value event)', () => {
    const f = start();
    const evs: FigureEvent[] = [];
    f.on((e) => evs.push(e));
    tickAnimations(f, 2);
    const ids = evs.flatMap((e) => (e.ev === 'value' ? [...e.ids] : []));
    expect(ids).toContain(oid(f, 'a'));
  });
  it('Animate(a, false) freezes the slider at its current computed value', () => {
    const f = start();
    animateSlider(f, 'a', false, { t: 4 });
    expect(isAnimating(f, 'a')).toBe(false);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
    tickAnimations(f, 8);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
  });
  it('starting anchors at the current value: from 3 at t = 2, one second later it is 4', () => {
    const f = fig(['a = 3 in 0..10', 'a with loop = up, period = 10']);
    animateSlider(f, 'a', true, { t: 2 });
    tickAnimations(f, 3);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
  });
  it('the anchor holds t0, v0 and dir', () => {
    const f = fig(['a = 3 in 0..10', 'a with loop = up, period = 10']);
    animateSlider(f, 'a', true, { t: 2 });
    expect(getAnchor(f, oid(f, 'a'))).toEqual({ t0: 2, v0: 3, dir: 1 });
  });
  it('a bounce slider started at the top goes down', () => {
    const f = fig(['a = 10 in 0..10', 'a with loop = bounce, period = 10']);
    animateSlider(f, 'a', true, { t: 0 });
    expect(getAnchor(f, oid(f, 'a'))?.dir).toBe(-1);
    tickAnimations(f, 2.5);
    expect(num(f, 'a')).toBeCloseTo(7.5, 9);
  });
  it('bounce goes up, turns at the top, comes back, and turns at the bottom', () => {
    const f = start(slider('a with loop = bounce, period = 10'));
    const at = (t: number) => {
      tickAnimations(f, t);
      return num(f, 'a');
    };
    expect(at(5)).toBeCloseTo(5, 9);
    expect(at(10)).toBeCloseTo(10, 9);
    expect(at(15)).toBeCloseTo(5, 9);
    expect(at(20)).toBeCloseTo(0, 9);
  });
  it('once moves up and stops at the top, and stops being animating', () => {
    const f = start(slider('a with loop = once, period = 10'));
    tickAnimations(f, 4);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
    expect(isAnimating(f, 'a')).toBe(true);
    const rep = tickAnimations(f, 10);
    expect(num(f, 'a')).toBe(10);
    expect(isAnimating(f, 'a')).toBe(false);
    expect(rep.finished).toContain('a');
    tickAnimations(f, 50);
    expect(num(f, 'a')).toBe(10);
  });
  it('once is a function of t: seeking back past the end shows the running state again', () => {
    const f = start(slider('a with loop = once, period = 10'));
    tickAnimations(f, 50);
    tickAnimations(f, 3);
    expect(num(f, 'a')).toBeCloseTo(3, 9);
    expect(isAnimating(f, 'a')).toBe(true);
  });
  it('once at the top already does not move and is not animating', () => {
    const f = fig(['a = 10 in 0..10', 'a with loop = once, period = 10']);
    animateSlider(f, 'a', true, { t: 0 });
    tickAnimations(f, 5);
    expect(num(f, 'a')).toBe(10);
    expect(isAnimating(f, 'a')).toBe(false);
  });
  it('a fixed step keeps every animated value on the grid', () => {
    const f = fig(['a = 0 in 0..10 step 0.5', 'a with loop = up, period = 10']);
    animateSlider(f, 'a', true, { t: 0 });
    const r = prng(2);
    for (let i = 0; i < 100; i++) {
      tickAnimations(f, r() * 30);
      const v = num(f, 'a');
      expect(Math.abs(v * 2 - Math.round(v * 2))).toBeLessThan(1e-9);
    }
  });
  it('random mode holds the anchor value during the first period and is the same on two figures', () => {
    const mk = () => {
      const f = fig(['a = 4 in 0..10', 'a with loop = random, period = 10, seed = 3']);
      animateSlider(f, 'a', true, { t: 0 });
      return f;
    };
    const f1 = mk();
    const f2 = mk();
    tickAnimations(f1, 5);
    expect(num(f1, 'a')).toBe(4);
    tickAnimations(f1, 25);
    tickAnimations(f2, 25);
    expect(num(f1, 'a')).toBe(num(f2, 'a'));
    expect(num(f1, 'a')).toBeGreaterThanOrEqual(0);
    expect(num(f1, 'a')).toBeLessThanOrEqual(10);
  });
  it('the value on the figure matches the pure function for the same anchor', () => {
    const f = start(slider('a with loop = bounce, period = 7'));
    const anchor = getAnchor(f, oid(f, 'a'));
    expect(anchor).toBeDefined();
    const r = prng(12);
    for (let i = 0; i < 40; i++) {
      const t = r() * 60;
      tickAnimations(f, t);
      expect(num(f, 'a')).toBe(anim({ loop: 'bounce', period: 7, anchor: anchor ?? { t0: 0, v0: 0, dir: 1 }, t }));
    }
  });
  it('Animate(a) through the draw channel anchors at the last tick', () => {
    const f = slider();
    tickAnimations(f, 5);
    ok(f.apply('Animate(a)'));
    expect(getAnchor(f, oid(f, 'a'))?.t0).toBe(5);
    expect(isAnimating(f, 'a')).toBe(true);
  });
  it('Animate(true) starts every animatable slider; Animate(false) stops them', () => {
    const f = fig(['a = 0 in 0..10', 'b = 1 in 0..5', 'c = 3', 'd = 2 * c']);
    ok(f.apply('Animate(true)'));
    expect(isAnimating(f, 'a')).toBe(true);
    expect(isAnimating(f, 'b')).toBe(true);
    expect(isAnimating(f, 'c')).toBe(false);
    ok(f.apply('Animate(false)'));
    expect(isAnimating(f, 'a')).toBe(false);
    expect(isAnimating(f, 'b')).toBe(false);
  });
  it('sliders started in one draw call share the same t0', () => {
    const f = fig(['a = 0 in 0..10', 'b = 1 in 0..5']);
    tickAnimations(f, 6);
    const r = f.applyBatch(['Animate(a)', 'Animate(b)'], { group: 'start' });
    expect(r.ok).toBe(true);
    expect(getAnchor(f, oid(f, 'a'))?.t0).toBe(6);
    expect(getAnchor(f, oid(f, 'b'))?.t0).toBe(6);
  });
  it('tickAnimations never throws on odd times', () => {
    const f = start();
    for (const t of [NaN, Infinity, -Infinity, -1, 1e300]) expect(() => tickAnimations(f, t)).not.toThrow();
  });
  it('20 animating sliders cost little: 1000 frames in under a second', { retry: 2, timeout: T }, () => {
    const f = newFigure();
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push(`s${i} = 0 in 0..10`);
    build(f, lines);
    for (let i = 0; i < 20; i++) animateSlider(f, `s${i}`, true, { t: 0 });
    within(1000, () => {
      for (let k = 1; k <= 1000; k++) tickAnimations(f, k / 60);
    });
  });
});

describe('3.4 dragging an animating slider', () => {
  const running = () => {
    const f = fig(['a = 0 in 0..10', 'a with loop = up, period = 10']);
    animateSlider(f, 'a', true, { t: 0 });
    tickAnimations(f, 4);
    return f;
  };
  it('pointer down drops the anchor and keeps the value', () => {
    const f = running();
    expect(pauseAnimation(f, oid(f, 'a'))).toBe(true);
    expect(getAnchor(f, oid(f, 'a'))).toBeUndefined();
    expect(isAnimating(f, 'a')).toBe(false);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
    tickAnimations(f, 8);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
  });
  it('on release a new anchor is set at the current t and value', () => {
    const f = running();
    pauseAnimation(f, oid(f, 'a'));
    ok(f.apply('SetValue(a, 6)'));
    expect(resumeAnimation(f, oid(f, 'a'), 5)).toBe(true);
    expect(getAnchor(f, oid(f, 'a'))).toMatchObject({ t0: 5, v0: 6 });
    tickAnimations(f, 6);
    expect(num(f, 'a')).toBeCloseTo(7, 9);
  });
  it('with resume = false the animation stays stopped after the release', () => {
    const f = running();
    ok(f.apply('a with resume = false'));
    pauseAnimation(f, oid(f, 'a'));
    expect(resumeAnimation(f, oid(f, 'a'), 5)).toBe(false);
    expect(isAnimating(f, 'a')).toBe(false);
  });
  it('a bounce slider resumes in the direction of the last pointer movement', () => {
    const f = fig(['a = 5 in 0..10', 'a with loop = bounce, period = 10']);
    animateSlider(f, 'a', true, { t: 0 });
    pauseAnimation(f, oid(f, 'a'));
    resumeAnimation(f, oid(f, 'a'), 2, -1);
    expect(getAnchor(f, oid(f, 'a'))?.dir).toBe(-1);
    tickAnimations(f, 3);
    expect(num(f, 'a')).toBeCloseTo(4, 9);
  });
});

describe('4 and errors.md: Animate needs a free Number with a range', () => {
  it('Animate of a dependent number is not_animatable with reason dependent', () => {
    const f = fig(['a = 3 in 0..10', 'b = 2 * a']);
    const e = bad(animateSlider(f, 'b', true, { t: 0 }), 'not_animatable');
    expect(String(e.params['reason'])).toBe('dependent');
  });
  it('Animate of a number with no range is not_animatable with reason no_range', () => {
    const f = fig('r = 3');
    const e = bad(animateSlider(f, 'r', true, { t: 0 }), 'not_animatable');
    expect(String(e.params['reason'])).toBe('no_range');
  });
  it('Animate of a Bool is not_animatable with reason wrong_type', () => {
    const f = fig('chk = true');
    const e = bad(animateSlider(f, 'chk', true, { t: 0 }), 'not_animatable');
    expect(String(e.params['reason'])).toBe('wrong_type');
  });
  it('Animate of an unknown name is unknown_name', () => {
    bad(animateSlider(fig([]), 'zz', true, { t: 0 }), 'unknown_name');
  });
  it('through the draw channel: Animate(b) on a dependent number is an error result', () => {
    const f = fig(['a = 3 in 0..10', 'b = 2 * a']);
    bad(f.apply('Animate(b)'), 'not_animatable');
  });
  it('through the draw channel: Animate(r) on a number with no range is an error result', () => {
    bad(fig('r = 3').apply('Animate(r)'), 'not_animatable');
  });
});

describe('3.4 sliders whose range is undefined', () => {
  const setup = () => {
    const f = fig(['m = 2', 'n = 10 / m', 'a = 1 in 0..n', 'a with loop = up, period = 10']);
    animateSlider(f, 'a', true, { t: 0 });
    return f;
  };
  it('an undefined bound makes the slider undefined with reason range_undefined', () => {
    const f = setup();
    f.setFree('m', 0, 'api');
    f.flush();
    expect(reasonOf(f, 'a')).toBe('range_undefined');
  });
  it('the tick skips the slider and says why', () => {
    const f = setup();
    f.setFree('m', 0, 'api');
    f.flush();
    const rep = tickAnimations(f, 3);
    expect(rep.skipped.map((s) => s.name)).toContain('a');
    expect(rep.ticked).not.toContain('a');
  });
  it('the animation resumes when the range is defined again', () => {
    const f = setup();
    f.setFree('m', 0, 'api');
    f.flush();
    tickAnimations(f, 3);
    f.setFree('m', 2, 'api');
    f.flush();
    const rep = tickAnimations(f, 4);
    expect(rep.ticked).toContain('a');
    expect(num(f, 'a')).toBeGreaterThan(0);
  });
  it('a bound that crosses (min >= max) makes the slider undefined with reason empty_range', () => {
    const f = fig(['n = 5', 'a = 1 in 0..n']);
    f.setFree('n', 0, 'api');
    f.flush();
    expect(reasonOf(f, 'a')).toBe('empty_range');
  });
  it('the slider returns to its last defined value, clamped, when the bound returns', () => {
    const f = fig(['m = 2', 'n = 10 / m', 'a = 3 in 0..n']);
    f.setFree('m', 0, 'api');
    f.flush();
    expect(reasonOf(f, 'a')).toBe('range_undefined');
    f.setFree('m', 2, 'api');
    f.flush();
    expect(num(f, 'a')).toBe(3);
  });
  it('a bound that shrinks re-commits the current value (clamps it again)', () => {
    const f = fig(['n = 10', 'a = 8 in 0..n']);
    f.setFree('n', 5, 'api');
    f.flush();
    expect(num(f, 'a')).toBe(5);
  });
  it('a dynamic step re-snaps the value', () => {
    const f = fig(['s = 0.5', 'a = 3.5 in 0..10 step s']);
    f.setFree('s', 2, 'api');
    f.flush();
    expect(num(f, 'a')).toBe(4);
  });
});

describe('errors.md 2: animated_input', () => {
  it('a rate that reads a slider set to animate is animated_input', () => {
    const f = fig(['w = state(1)', 'k = 1 in 0..2']);
    animateSlider(f, 'k', true, { t: 0 });
    const e = reject(f, "w' = -k * w", 'animated_input');
    expect(String(e.params['slider'])).toBe('k');
    expect(String(e.params['rate'])).toBe('w');
  });
  it('animating a slider that a rate already reads is animated_input', () => {
    const f = fig(['w = state(1)', 'k = 1 in 0..2', "w' = -k * w"]);
    bad(animateSlider(f, 'k', true, { t: 0 }), 'animated_input');
  });
  it('the same refusal through the draw channel', () => {
    const f = fig(['w = state(1)', 'k = 1 in 0..2', "w' = -k * w"]);
    bad(f.apply('Animate(k)'), 'animated_input');
  });
  it('a slider that is not animating can drive a rate', () => {
    ok(fig(['w = state(1)', 'k = 1 in 0..2']).apply("w' = -k * w"));
  });
  it('a drag and release of a slider a rate reads is fine', () => {
    const f = fig(['w = state(1)', 'k = 1 in 0..2', "w' = -k * w"]);
    expect(f.setFree('k', 1.5, 'slider')).toMatchObject({ ok: true });
    expect(f.commitDrag().committed).toBe(1);
  });
});

describe('errors.md 2: limit on sliders animating at once', () => {
  it('501 animating sliders is a limit error with the limit and the actual count', () => {
    const f = newFigure();
    const lines: string[] = [];
    for (let i = 0; i < 501; i++) lines.push(`s${i} = 0 in 0..10`);
    build(f, lines);
    const r = animateAll(f, true, { t: 0 });
    const e = bad(r, 'limit');
    expect(JSON.stringify(e.params)).toContain('500');
  }, T);
});

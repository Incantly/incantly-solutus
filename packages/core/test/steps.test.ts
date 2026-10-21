import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import type { RuntimeUpdate } from '../src/protocol/runtime-messages';
import { STEP_TRANSITION_SECONDS, SceneRuntime, type RuntimeOptions } from '../src/runtime/runtime';

/** Two parameters, two parts and three steps; the middle step holds time. */
function teachingScene(inc: Inc) {
  const a = inc.param('a', { min: 0, max: 10, step: 0.5, value: 2 });
  const b = inc.param('b', { min: 0, max: 10, step: 0.5, value: 4 });
  const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Bars' });
  const barA = stage.line(10, 90, 10, 90, { tone: 'a' });
  const barB = stage.line(30, 90, 30, 90, { tone: 'b' });
  stage.part('A', barA, { label: 'Bar A', info: 'Its height is a.' });
  stage.part('B', barB, { label: 'Bar B', info: 'Its height is b.' });
  inc.onFrame(() => {
    barA.set({ y2: 90 - a.value * 8 });
    barB.set({ y2: 90 - b.value * 8 });
  });
  inc.steps([
    { say: 'Bar A grows with a.', focus: 'A', set: { a: 6 } },
    { say: 'Time holds while you look at bar B.', focus: 'B', set: { b: 8 }, hold: true },
    { say: 'Both together.', set: { a: 10 } },
  ]);
}

function start(options: RuntimeOptions = {}) {
  const runtime = new SceneRuntime(options);
  const first = runtime.mount(teachingScene);
  return { runtime, first };
}

/** Runs one transition to its end while paused. */
function finish(runtime: SceneRuntime): RuntimeUpdate[] {
  const updates: RuntimeUpdate[] = [];
  const ticks = Math.ceil(STEP_TRANSITION_SECONDS / 0.05) + 1;
  for (let i = 0; i < ticks; i++) updates.push(runtime.tick(0.05));
  return updates;
}

describe('teaching steps: navigation', () => {
  it('publishes the walkthrough outside step mode with no current step', () => {
    const { first } = start();
    expect(first.ui.steps).toEqual({ count: 3, index: null, say: null, focus: null });
    expect(first.ui.focus).toBeNull();
    expect(first.ui.parts?.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('enters at the first step, focuses its part and reports the position', () => {
    const { runtime } = start({ autoplay: false });
    runtime.tick(0);
    runtime.step('enter');
    const update = runtime.flush();
    expect(update.ui.steps).toEqual({ count: 3, index: 0, say: 'Bar A grows with a.', focus: 'A' });
    expect(update.ui.focus).toBe('A');
    expect(update.step).toBe(0);
    expect(runtime.currentStep).toBe(0);
  });

  it('moves next and back, and stops at either end', () => {
    const { runtime } = start({ autoplay: false });
    runtime.step('next');
    expect(runtime.currentStep).toBe(0);
    runtime.step('prev');
    expect(runtime.currentStep).toBe(0);
    runtime.step('next');
    runtime.step('next');
    expect(runtime.currentStep).toBe(2);
    runtime.step('next');
    expect(runtime.currentStep).toBe(2);
    runtime.step('prev');
    expect(runtime.currentStep).toBe(1);
  });

  it('jumps with goto and clamps out-of-range indices', () => {
    const { runtime } = start({ autoplay: false });
    runtime.step('goto', 9);
    expect(runtime.currentStep).toBe(2);
    runtime.step('goto', -4);
    expect(runtime.currentStep).toBe(0);
    runtime.step('goto', Number.NaN);
    expect(runtime.currentStep).toBe(0);
  });

  it('ignores step messages when the scene has no steps', () => {
    const runtime = new SceneRuntime();
    const first = runtime.mount((inc) => {
      inc.param('a', { min: 0, max: 1, value: 0 });
    });
    expect(first.ui.steps).toBeNull();
    runtime.step('enter');
    expect(runtime.currentStep).toBeNull();
    expect(runtime.flush().step).toBeUndefined();
  });
});

describe('teaching steps: parameter changes', () => {
  it('animates to the step values over the transition instead of jumping', () => {
    const { runtime } = start({ autoplay: false });
    runtime.tick(0);
    runtime.step('enter');
    expect(runtime.values().a).toBe(2);
    // Half the transition is half the change (the ease is symmetric); values stay on the slider's step.
    for (let i = 0; i < 6; i++) runtime.tick(STEP_TRANSITION_SECONDS / 12);
    expect(runtime.values().a).toBe(4);
    finish(runtime);
    expect(runtime.values()).toEqual({ a: 6, b: 4 });
    expect(runtime.needsFrame()).toBe(false);
    expect(runtime.time).toBe(0);
  });

  it('jumps straight to the step values under reduced motion', () => {
    const { runtime } = start({ reducedMotion: true });
    runtime.step('enter');
    expect(runtime.values()).toEqual({ a: 6, b: 4 });
    runtime.tick(0.05);
    expect(runtime.needsFrame()).toBe(false);
  });

  it('builds each step on the earlier ones, so going back is exact', () => {
    const { runtime } = start({ reducedMotion: true });
    runtime.step('goto', 2);
    expect(runtime.values()).toEqual({ a: 10, b: 8 });
    runtime.step('prev');
    expect(runtime.values()).toEqual({ a: 6, b: 8 });
    runtime.step('prev');
    expect(runtime.values()).toEqual({ a: 6, b: 4 });
  });

  it('never persists step values as the learner own', () => {
    const { runtime } = start({ autoplay: false });
    runtime.step('enter');
    const updates = [runtime.flush(), ...finish(runtime)];
    runtime.step('next');
    updates.push(runtime.flush(), ...finish(runtime));
    expect(updates.some((u) => u.values !== undefined)).toBe(false);
  });

  it('lets the learner take over mid-transition without the transition fighting back', () => {
    const { runtime } = start({ autoplay: false });
    runtime.step('enter');
    runtime.tick(0.05);
    runtime.setParam('a', 1);
    finish(runtime);
    expect(runtime.values().a).toBe(1);
  });
});

describe('teaching steps: time and restoring the learner', () => {
  it('holds time on a hold step and resumes the learner play state after it', () => {
    const { runtime } = start({ autoplay: true });
    expect(runtime.playing).toBe(true);
    runtime.step('enter');
    expect(runtime.playing).toBe(true);
    runtime.step('next');
    expect(runtime.playing).toBe(false);
    const time = runtime.time;
    finish(runtime);
    expect(runtime.time).toBe(time);
    runtime.step('next');
    expect(runtime.playing).toBe(true);
  });

  it('keeps redrawing on a hold step when a value changes', () => {
    const { runtime } = start({ autoplay: true });
    runtime.step('goto', 1);
    finish(runtime);
    const before = runtime.stats.pausedRedraws;
    runtime.setParam('a', 3);
    runtime.tick(0.05);
    expect(runtime.stats.pausedRedraws).toBe(before + 1);
  });

  it('restores the learner values and play state on exit, even after exploring inside a step', () => {
    const { runtime } = start({ autoplay: false });
    runtime.setParam('a', 3);
    expect(runtime.flush().values).toEqual({ a: 3 });
    runtime.step('enter');
    finish(runtime);
    runtime.setParam('b', 9.5);
    expect(runtime.learnerValues()).toEqual({ a: 3, b: 4 });
    runtime.step('exit');
    const update = runtime.flush();
    expect(runtime.values()).toEqual({ a: 3, b: 4 });
    expect(update.step).toBeNull();
    expect(update.values).toBeUndefined();
    expect(update.ui.steps?.index).toBeNull();
    expect(update.ui.focus).toBeNull();
    expect(runtime.playing).toBe(false);
  });

  it('exits in the middle of a transition without leaving it running', () => {
    const { runtime } = start({ autoplay: false });
    runtime.step('enter');
    runtime.tick(0.05);
    runtime.step('exit');
    finish(runtime);
    expect(runtime.values()).toEqual({ a: 2, b: 4 });
    expect(runtime.needsFrame()).toBe(false);
  });

  it('restores a saved step on mount without animating or re-reporting it', () => {
    const { runtime, first } = start({ step: 1, autoplay: false });
    expect(first.ui.steps?.index).toBe(1);
    expect(first.step).toBeUndefined();
    expect(runtime.values()).toEqual({ a: 6, b: 8 });
    runtime.step('exit');
    expect(runtime.values()).toEqual({ a: 2, b: 4 });
  });

  it('restores a saved step on top of saved learner values', () => {
    const { runtime } = start({ step: 0, values: { a: 1, b: 1 }, autoplay: false });
    expect(runtime.values()).toEqual({ a: 6, b: 1 });
    runtime.step('exit');
    expect(runtime.values()).toEqual({ a: 1, b: 1 });
  });

  it.each([5, -1, 1.5, Number.NaN])('ignores an invalid saved step %s', (step) => {
    const { runtime, first } = start({ step });
    expect(first.ui.steps?.index).toBeNull();
    expect(runtime.currentStep).toBeNull();
    expect(runtime.values()).toEqual({ a: 2, b: 4 });
  });

  it('leaves step mode on restart, keeping the learner values', () => {
    const { runtime } = start({ autoplay: false, values: { a: 3 } });
    runtime.step('enter');
    finish(runtime);
    const update = runtime.restart();
    expect(update.reset).toBe(true);
    expect(update.step).toBeNull();
    expect(update.ui.steps?.index).toBeNull();
    expect(runtime.values()).toEqual({ a: 3, b: 4 });
  });

  it('leaves step mode on reset, returning to the authored defaults', () => {
    const { runtime } = start({ autoplay: false, values: { a: 3 } });
    runtime.step('goto', 2);
    const update = runtime.reset();
    expect(update.step).toBeNull();
    expect(update.values).toEqual({ a: 2, b: 4 });
    expect(runtime.values()).toEqual({ a: 2, b: 4 });
  });
});

describe('teaching steps: part focus', () => {
  it('highlights a registered part for the learner and ignores unknown names', () => {
    const { runtime } = start({ autoplay: false });
    runtime.focusPart('B');
    expect(runtime.flush().ui.focus).toBe('B');
    runtime.focusPart('Nope');
    expect(runtime.flush().ui.focus).toBeUndefined();
    runtime.focusPart(null);
    expect(runtime.flush().ui.focus).toBeNull();
  });

  it('lets learner focus override the step focus, which returns when it clears', () => {
    const { runtime } = start({ autoplay: false });
    runtime.step('enter');
    expect(runtime.flush().ui.focus).toBe('A');
    runtime.focusPart('B');
    expect(runtime.flush().ui.focus).toBe('B');
    runtime.focusPart(null);
    expect(runtime.flush().ui.focus).toBe('A');
  });

  it('publishes element ids so the renderer can highlight parts', () => {
    const { first } = start();
    for (const part of first.ui.parts ?? []) expect(Number.isInteger(part.id)).toBe(true);
    expect(first.ui.parts?.[0]).toMatchObject({ name: 'A', label: 'Bar A', info: 'Its height is a.' });
  });
});

describe('teaching steps: authoring checks', () => {
  it.each([
    [[{ say: 'Look.', focus: 'C' }], 'Step 1 focuses on "C", which is not a registered part'],
    [[{ say: 'Move.', set: { c: 1 } }], 'Step 1 sets "c", which is not a parameter'],
    [[{ say: '' }], 'Step 1 needs something to say'],
    [[], 'inc.steps needs a non-empty list'],
    [Array.from({ length: 9 }, () => ({ say: 'x' })), 'A figure has at most 8 steps'],
  ])('rejects %j', (steps, message) => {
    const runtime = new SceneRuntime();
    const first = runtime.mount((inc) => {
      inc.param('a', { min: 0, max: 1, value: 0 });
      const stage = inc.svg('#s', { viewBox: [0, 0, 10, 10], title: 'S' });
      stage.part('A', stage.circle(5, 5, 1));
      inc.steps(steps as never);
    });
    expect(first.ui.error?.message).toBe(message);
    expect(runtime.isMounted).toBe(false);
  });
});

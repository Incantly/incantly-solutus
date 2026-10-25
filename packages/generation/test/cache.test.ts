import { SDK_VERSION } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { ConceptCache, planKey, requestKey, type CachedFigure } from '../src/cache';

const sine = REFERENCE_SCENES['sine-wave']!;
const figure: CachedFigure = { plan: sine.plan, fragments: { html: sine.html, css: sine.css, js: sine.js }, sdkVersion: SDK_VERSION };

describe('the concept cache keys', () => {
  it('reads a request by its meaningful words, leaving out how it asks', () => {
    expect(requestKey('I want a sine wave')).toBe(requestKey('Show me a sine wave'));
    expect(requestKey('Could you help me see a sine wave?')).toBe(requestKey('sine wave'));
    expect(requestKey('A sine wave from Euler’s formula')).not.toBe(requestKey('A sine wave'));
  });

  it('keys a plan by all of it: what it teaches and how it moves, not only its concept and controls', () => {
    expect(planKey({ ...sine.plan, idea: sine.plan.idea.toUpperCase() })).toBe(planKey(sine.plan));
    expect(planKey({ ...sine.plan, idea: 'Circles turning at different speeds add up to a sine wave, as Euler’s formula says.' })).not.toBe(planKey(sine.plan));
    expect(planKey({ ...sine.plan, moves: 'A point circles and its shadow traces the wave.' })).not.toBe(planKey(sine.plan));
    expect(planKey({ ...sine.plan, steps: [...sine.plan.steps.slice(0, -1), 'Now add a second circle.'] })).not.toBe(planKey(sine.plan));
  });
});

describe('figures offered for reuse', () => {
  const cache = new ConceptCache();
  cache.put([requestKey('Show me a sine wave'), planKey(sine.plan)], figure, 'Show me a sine wave');

  it('never offers a figure that lacks something the learner named', () => {
    expect(cache.candidates('I want a sine wave that has Euler’s formula, showing different sine waves using circles')).toEqual([]);
    expect(cache.candidates('sine wave with a damping slider')).toEqual([]);
  });

  it('offers one whose words take in the whole request, once, under a short id', () => {
    const offered = cache.candidates('a sine wave please');
    expect(offered).toHaveLength(1);
    expect(offered[0]).toEqual({ id: 'f1', figure });
  });

  it('offers nothing for a request with no meaningful words, or after the kit changed', () => {
    expect(cache.candidates('show me please')).toEqual([]);
    const old = new ConceptCache();
    old.put([planKey(sine.plan)], { ...figure, sdkVersion: '0.0.0' }, 'a sine wave');
    expect(old.candidates('a sine wave')).toEqual([]);
  });
});

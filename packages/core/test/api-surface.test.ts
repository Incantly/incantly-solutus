import { describe, expect, it } from 'vitest';
import {
  ALLOWED_GLOBALS,
  ALLOWED_MATH,
  HANDLES,
  INC_FUNCTIONS,
  INC_NAMESPACES,
  referencedKinds,
} from '../src/api/surface';

describe('v0.1 API surface', () => {
  it('declares every handle kind it references', () => {
    for (const kind of referencedKinds()) {
      expect(HANDLES[kind], `missing handle spec for ${kind}`).toBeDefined();
    }
  });

  it('exposes the calls named in the SDK contracts', () => {
    expect(Object.keys(INC_FUNCTIONS).sort()).toEqual(
      [
        'describe',
        'explain',
        'formula',
        'graph2d',
        'idea',
        'model',
        'onFrame',
        'param',
        'random',
        'readout',
        'steps',
        'svg',
        'tween',
      ].sort(),
    );
    expect(Object.keys(INC_NAMESPACES).sort()).toEqual(['geom', 'path']);
  });

  it('keeps Math.random out so scenes stay deterministic', () => {
    expect(ALLOWED_MATH).not.toContain('random');
    expect(ALLOWED_GLOBALS).not.toContain('window');
    expect(ALLOWED_GLOBALS).toContain('inc');
  });

  it('marks the model as an open handle and formulas as callable', () => {
    expect(HANDLES.Model.open).toBe(true);
    expect(HANDLES.Formula.callable).toBe(true);
  });
});

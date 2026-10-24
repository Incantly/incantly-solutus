import { describe, expect, it } from 'vitest';
import { SceneRuntime } from '../src/runtime/runtime';
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

  it('describes exactly the members the runtime gives scenes', () => {
    const inc = new SceneRuntime().inc as unknown as Record<string, unknown>;
    const functions = Object.keys(inc).filter((key) => typeof inc[key] === 'function');
    const namespaces = Object.keys(inc).filter((key) => typeof inc[key] === 'object');
    expect(Object.keys(INC_FUNCTIONS).sort()).toEqual(functions.sort());
    expect(Object.keys(INC_NAMESPACES).sort()).toEqual(namespaces.sort());
    for (const [ns, members] of Object.entries(INC_NAMESPACES)) {
      const object = inc[ns] as Record<string, unknown>;
      expect(Object.keys(members).sort(), ns).toEqual(Object.keys(object).filter((k) => typeof object[k] === 'function').sort());
    }
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

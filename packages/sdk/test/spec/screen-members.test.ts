/**
 * The names the screen puts on a mounted app never hide a member of the core app, except `export` and `destroy`, which
 * wrap the core's own (embed-files-export design 3.2). Private members count: `in` sees them on the prototype.
 */
import { describe, expect, it } from 'vitest';
import { SCREEN_MEMBERS, createHeadlessApp } from '../../src/index';

describe('screen members', () => {
  it('hide no member of the core app but export and destroy', () => {
    const core = createHeadlessApp();
    try {
      for (const k of SCREEN_MEMBERS) expect(k in core, k).toBe(k === 'export' || k === 'destroy');
    } finally {
      core.destroy();
    }
  });
});

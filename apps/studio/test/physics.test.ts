/** Physics in the studio (.kiro/specs/physics R4; docs/features/physics ui.md 2, 4, 5, 7). */
import { describe, expect, it } from 'vitest';
import { sceneOf } from '@incantly/sdk/screen';
import { KernelSession } from '../src/session';
import { EXAMPLES } from '../src/examples';

const load = (lines: readonly string[]): KernelSession => {
  const s = new KernelSession();
  const r = s.applyLines([...lines], 'test', 'independent', 'host');
  if (!r.ok) throw new Error(r.error.message);
  return s;
};

describe('the studio and physics', () => {
  it('a figure with a body has a clock, and opens at the start', () => {
    const s = load(['g = Ground()', 'b = Body(Box((0, 2), 1, 1))']);
    expect(s.hasClock()).toBe(true);
    expect(s.time()).toBe(0);
  });

  it('solid shapes are hatched and bodies show the arrows asked for', () => {
    const s = load(['g = Ground()', 'p = Polygon((0, 0), (2, 0), (0, 2))', 'p with solid = true', 'b = Body(Box((5, 2), 1, 1))', 'b with show = forces', 'world with show = contacts']);
    s.setTime(1);
    const items = sceneOf(s.figure);
    expect(items.find((i) => i.name === 'p')?.solid).toBe(true);
    expect(items.find((i) => i.name === 'g')?.solid).toBe(true);
    expect(items.find((i) => i.name === 'b')?.arrows).toBe('forces');
    expect(items.find((i) => i.type === 'Contacts')).toBeDefined();
  });

  it('dragging a body at the start moves where it starts; later it grabs', () => {
    const s = load(['g = Ground()', 'p = Box((0, 3), 1, 1)', 'b = Body(p)']);
    expect(s.dragPoint('b', 0, 3, false).ok).toBe(true);
    expect(s.dragPoint('b', 1, 3, true).ok).toBe(true);
    expect(s.figure.get('p')?.definition).toBe('p = Box((1, 3), 1, 1)');
    s.setTime(2);
    const r = s.dragPoint('b', 1, 0.5, false);
    expect(r.ok).toBe(true);
    s.dragPoint('b', 1, 2, true);
    expect(s.save()).toMatch(/@input physics grab b/);
  });

  it('every physics example opens with all its lines and moves when the film runs', () => {
    for (const ex of EXAMPLES.filter((e) => e.id.startsWith('physics-'))) {
      const s = new KernelSession();
      const r = s.applyLines([...ex.lines], ex.id, 'independent', 'host');
      expect(r.ok, ex.id).toBe(true);
      const bodies = s.figure.objects().filter((o) => o.type === 'Body' || o.typeText === 'List<Body>');
      expect(bodies.length, ex.id).toBeGreaterThan(0);
      const before = JSON.stringify(bodies.map((o) => s.figure.value(o.id)));
      for (let k = 1; k <= 60; k++) s.setTime(k / 60);
      const after = JSON.stringify(bodies.map((o) => s.figure.value(o.id)));
      expect(after, ex.id).not.toBe(before);
    }
  });
});

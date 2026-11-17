/** The 3D app in the studio (.kiro/specs/space-3d R4.5, R4.6; docs/features/space-3d ui.md 2). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { space } from '@incantly/kernel';
import { EXAMPLES } from '../src/examples';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

let root: HTMLElement;
let m: Mounted;

beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
  m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, mode: 'graphing3d' });
});
afterEach(() => {
  m.dispose();
  root.remove();
});

describe('the 3D app (R4.5)', () => {
  it('is available, and shows the list and the Space view in place of the graph', () => {
    expect(m.modes.mode.id).toBe('graphing3d');
    expect(m.space.element.hidden).toBe(false);
    expect(m.graph.element.hidden).toBe(true);
    expect(root.querySelector('.space-view .space-bar')).not.toBeNull();
  });

  it('another app hides the Space view and shows the graph again', () => {
    expect(m.modes.setMode('classic', { force: true }).ok).toBe(true);
    expect(m.space.element.hidden).toBe(true);
    expect(m.graph.element.hidden).toBe(false);
  });

  it('has seventeen examples, fourteen of them moving, which open with every line', () => {
    const own = EXAMPLES.filter((e) => e.modes.includes('graphing3d'));
    expect(own.map((e) => e.id)).toEqual([
      'cube-slice', 'sphere-cut', 'pyramid-volume',
      'space-helix', 'space-cube', 'space-wave', 'space-sweep', 'space-fountain', 'space-orbit', 'space-saddle', 'space-slice', 'space-galaxy',
      'physics-dice', 'physics-dominoes-3d', 'physics-bowl', 'physics-car-terrain', 'physics-car-crash',
    ]);
    for (const e of own) {
      m.loadExample(e.id);
      expect(root.querySelector('.status')?.textContent).toContain(`${e.lines.length} of ${e.lines.length} lines`);
    }
  });

  it('the pyramid example shows a third, and the sphere cut a circle', () => {
    m.loadExample('pyramid-volume');
    const ratio = m.session.figure.get('ratio');
    expect(ratio?.cell.defined && (ratio.cell as { value: number }).value).toBeCloseTo(1 / 3, 12);
    m.loadExample('sphere-cut');
    const r = m.session.figure.get('r');
    expect(r?.cell.defined && (r.cell as { value: number }).value).toBeCloseTo(Math.sqrt(9 - 2.25), 12);
  });

  it('every moving example has a clock bar, and moves when the film runs (R4.1)', () => {
    for (const e of EXAMPLES.filter((x) => x.id.startsWith('space-'))) {
      m.loadExample(e.id);
      expect(m.session.hasClock()).toBe(true);
      m.space.paint();
      const before = JSON.stringify(m.space.last()?.hits.slice(0, 40).map((h) => ('x' in h ? h.x : h.k === 'line' ? h.x0 : h.pts[0]?.x)));
      m.session.setTime(1.7);
      m.space.paint();
      const after = JSON.stringify(m.space.last()?.hits.slice(0, 40).map((h) => ('x' in h ? h.x : h.k === 'line' ? h.x0 : h.pts[0]?.x)));
      expect(after, e.id).not.toBe(before);
      m.session.setTime(0);
    }
  });

  it('a camera key writes the camera line into the figure, and undo takes it back', () => {
    m.loadExample('cube-slice');
    m.space.paint();
    m.space.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
    expect(space.viewOf(m.session.figure).elevation).toBeCloseTo(Math.PI / 2, 6);
    m.undo();
    expect(space.viewOf(m.session.figure)).toEqual(space.DEFAULT_VIEW3);
  });

  it('the screen-reader list names what the view shows (R4.6)', () => {
    m.loadExample('cube-slice');
    m.space.paint();
    const items = [...root.querySelectorAll('.space-sr li')].map((li) => li.textContent);
    expect(items[0]).toBe('A, (0, 0, 0)');
    expect(items).toContain('k, cube, 6 faces, volume 27');
  });

  it('a car in space: the arrow keys drive it through its sliders (logged while playing), Follow keeps the camera behind it (physics ui.md 9)', () => {
    m.loadExample('physics-car-terrain');
    m.session.setTime(1);
    m.space.paint();
    // wheels are drawn as tyres
    expect(m.space.last()?.hits.length).toBeGreaterThan(0);
    const key = (type: string, k: string): void => {
      m.space.canvas.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    };
    key('keydown', 'ArrowLeft');
    expect(m.session.figure.value('turn')).toBe(0.5);
    key('keyup', 'ArrowLeft');
    expect(m.session.figure.value('turn')).toBe(0);
    key('keydown', ' ');
    expect(m.session.figure.value('stop')).toBe(1);
    key('keyup', ' ');
    key('keydown', 'ArrowDown');
    expect(m.session.figure.value('gas')).toBe(-1);
    expect(m.session.save()).toMatch(/@input physics set gas -1 at 1/);
    const follow = root.querySelector('.space-follow') as HTMLButtonElement;
    expect(follow).not.toBeNull();
    follow.click();
    expect(m.space.following()).toBe(true);
    m.space.paint();
    expect(follow.getAttribute('aria-pressed')).toBe('true');
  });
});

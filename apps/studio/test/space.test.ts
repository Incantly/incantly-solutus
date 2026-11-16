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

  it('has three examples, which open with every line', () => {
    const own = EXAMPLES.filter((e) => e.modes.includes('graphing3d'));
    expect(own.map((e) => e.id)).toEqual(['cube-slice', 'sphere-cut', 'pyramid-volume']);
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
});

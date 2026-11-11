import { describe, expect, it } from 'vitest';
import { Figure3D, buildBvh, pick } from '@incantly/view';
import type { Pickable } from '@incantly/view';
import { head, oid, stubKernel, stubStyles } from './helpers';

describe('rprobe', () => {
  it('mesh scene kinds', () => {
    for (const kind of ['point', 'region', 'curve', 'line', 'text', 'image'] as const) {
      const objects = [{
        head: head(1, 'M'), value: { k: 'mesh', pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), nor: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), idx: new Uint32Array([0, 1, 2]), closed: true }, kind,
      }];
      const fig = new Figure3D(stubKernel(objects as never), stubStyles(objects as never), { get: () => undefined });
      fig.applyEvents([{ kind: 'add', ids: [oid(1)] }]);
      // eslint-disable-next-line no-console
      console.log(`kind=${kind} sceneSize=${String(fig.scene.size)} items=${fig.scene.all().map((i) => i.k).join(',')}`);
      fig.dispose();
    }
    expect(true).toBe(true);
  });
  it('multipick contents', () => {
    const ray = { o: { x: 0, y: 0, z: 5 }, d: { x: 0, y: 0, z: -1 } };
    const project = (p: { x: number; y: number; z: number }): { x: number; y: number } | null =>
      ({ x: 400 + p.x * 50, y: 300 - p.y * 50 });
    const pos = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const items: Pickable[] = [
      { k: 'surface', objId: oid(5), bvh: buildBvh(pos, new Uint32Array([0, 1, 2, 3, 4, 5])), transparent: false },
      { k: 'path', objId: oid(4), pts: new Float32Array([-1, 0, 0, 1, 0, 0]), closed: false },
      { k: 'point', objId: oid(3), at: { x: 0, y: 0, z: 0 } },
      { k: 'label', objId: oid(2), at: { x: 0, y: 0, z: 0 }, radiusPx: 10 },
      { k: 'gizmo', objId: oid(1), at: { x: 0, y: 0, z: 0 }, radiusPx: 10 },
    ];
    const hits = pick(items, ray as never, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    // eslint-disable-next-line no-console
    console.log('multi=' + hits.map((h) => `${h.kind}:o${String(h.objId)}`).join(' '));
    const pathOnly = pick([items[1] as Pickable], ray as never, project, 400, 300, { tolerancePx: 10, includeTransparent: true });
    // eslint-disable-next-line no-console
    console.log('pathOnly=' + JSON.stringify(pathOnly));
    expect(true).toBe(true);
  });
});

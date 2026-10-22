import { describe, expect, it } from 'vitest';
import type { Chart, Inc } from '../src/api/types';
import type { KitModule } from '../src/runtime/kits';
import { KIT_NAMES, kitsFor } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import { validateScene } from '../src/validation';
import { validateSceneJs } from '../src/validation/js';

/** A stand-in kit: draws one circle, so the dispatch itself can be tested apart from any real kit. */
const testKit: KitModule = {
  name: 'chart',
  calls: {
    chart: {
      layout: (options) => {
        const { viewBox } = options as { viewBox?: [number, number, number, number] };
        return { viewBox: viewBox ?? [0, 0, 300, 200] };
      },
      create: (ctx) => {
        ctx.stage.circle(150, 100, 20, { tone: 'a' });
        return { stage: ctx.stage };
      },
    },
  },
};

describe('kits load on demand (DG-6)', () => {
  it('maps calls to kits once each, in a stable order', () => {
    expect(kitsFor(['graph3d', 'svg', 'space3d', 'flow', 'chart'])).toEqual(['space3d', 'chart', 'flow']);
    expect(kitsFor(['svg', 'graph2d'])).toEqual([]);
    expect(KIT_NAMES).toEqual(['space3d', 'physics2d', 'chart', 'flow', 'chemistry', 'biology']);
  });

  it('records the kits a scene calls, and checks their stage selectors', () => {
    const js = `
const chart = inc.chart('#c', { title: 'Sales' });
const space = inc.space3d('#s', { title: 'Cube' });
inc.idea('Kits draw what the base runtime does not.');
`;
    const { info, diagnostics } = validateSceneJs(js);
    expect(diagnostics).toEqual([]);
    expect(info.kits).toEqual(['space3d', 'chart']);
    expect(info.stages.map((s) => s.selector)).toEqual(['#c', '#s']);
    const bad = validateSceneJs(`inc.flow(id, { title: 'x' });`);
    expect(bad.diagnostics.map((d) => d.rule)).toContain('stage-selector');
    const late = validateSceneJs(`inc.onFrame(() => inc.chart('#c', { title: 'x' }));`);
    expect(late.diagnostics.map((d) => d.rule)).toContain('mount-only');
    const validated = validateScene({ html: '<div id="c"></div><div id="s"></div>', css: '', js });
    expect(validated.scene?.kits).toEqual(['space3d', 'chart']);
  });

  it('makes the stage, then hands it to the kit', () => {
    const runtime = new SceneRuntime({ autoplay: false, kits: { chart: testKit } });
    let returned: unknown;
    const update = runtime.mount((inc: Inc) => {
      returned = inc.chart('#c', { title: 'Sales', kind: 'bar' });
    });
    expect(update.ui.error).toBeNull();
    expect(update.commands[0]).toMatchObject({ op: 'stage', selector: '#c', viewBox: [0, 0, 300, 200], title: 'Sales' });
    expect(update.commands.some((c) => c.op === 'create' && c.kind === 'circle')).toBe(true);
    expect((returned as Chart).stage.viewBox).toEqual([0, 0, 300, 200]);
  });

  it('says plainly when a kit is missing or the options are wrong', () => {
    const error = (scene: (inc: Inc) => void, kits = {}) => new SceneRuntime({ autoplay: false, kits }).mount(scene).ui.error?.message;
    expect(error((inc) => void inc.space3d('#s', { title: 'Cube' }))).toBe('inc.space3d needs the space3d kit, which this page did not load');
    expect(error((inc) => void inc.chart('#c', { title: ' ' }), { chart: testKit })).toBe('inc.chart needs a title for its accessible name');
    expect(error((inc) => void inc.chart('#c', null as never), { chart: testKit })).toBe('inc.chart needs an options object with a title');
  });
});

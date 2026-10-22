import { describe, expect, it } from 'vitest';
import { loadKitModules } from '../src/kits/load';
import { SIZE_BUDGETS } from '../src/protocol/plan';
import { probeScene, type ProbeOptions, type ProbeReport } from '../src/probe';
import { REFERENCE_SCENES } from '../src/scenes';
import { validateScene } from '../src/validation';
import { compileValidated } from './helpers/compile';

const HTML = "<div id='stage'></div>";

/** A small teaching scene that passes every check. Pieces are swapped out to break one check at a time. */
const GOOD = {
  idea: "inc.idea('A taller bar means a bigger number.');",
  param: "const h = inc.param('height', { min: 1, max: 9, step: 1, value: 4, label: 'Height' });",
  stage: "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Bar', description: 'One bar.' });",
  bar: "const bar = stage.rect(40, 50, 20, 40, { tone: 'lit' });",
  part: "stage.part('Bar', bar, { label: 'Bar', info: 'Its height is the number.' });",
  frame: 'inc.onFrame(() => { bar.set({ y: 90 - h.value * 10, height: h.value * 10 }); });',
  describe: "inc.describe(() => 'A bar ' + h.value + ' units tall.');",
  steps: "inc.steps([{ say: 'Look at the bar.', focus: 'Bar' }, { say: 'Make it taller.', set: { height: 8 } }]);",
};

function build(overrides: Partial<Record<keyof typeof GOOD, string>> = {}, extra = ''): string {
  return [...Object.values({ ...GOOD, ...overrides }), extra].join('\n');
}

function probe(js: string, options: ProbeOptions = {}): ProbeReport {
  const { scene, fuel } = compileValidated({ html: HTML, css: '', js });
  return probeScene(scene, { beforeStep: fuel.refuel, ...options });
}

const checks = (report: ProbeReport) => report.failures.map((f) => f.check);

describe('probe: passing scenes', () => {
  it('passes a small scene that does everything right', () => {
    const report = probe(build(), { spec: { parts: ['Bar'], steps: 2 } });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.stats.frames).toBeGreaterThan(60);
    expect(report.stats.configurations).toBeGreaterThan(8);
    expect(report.stats.elements).toBe(1);
  });

  it.each(Object.keys(REFERENCE_SCENES))('passes the reference scene %s with its own plan', async (id) => {
    const source = REFERENCE_SCENES[id]!;
    const { scene, fuel } = compileValidated(source);
    const kits = await loadKitModules(validateScene(source).scene?.kits ?? []);
    const report = probeScene(scene, {
      beforeStep: fuel.refuel,
      runtime: { kits },
      spec: {
        parts: source.plan.parts,
        steps: source.plan.steps.length,
        singularPoints: source.plan.singularPoints ?? [],
        elements: SIZE_BUDGETS[source.plan.size ?? 'quick'].elements,
      },
    });
    expect(report.failures).toEqual([]);
  });

  it('is deterministic for the same seed', () => {
    const a = probe(build());
    const b = probe(build());
    expect({ ...a.stats, durationMs: 0, averageFrameMs: 0 }).toEqual({ ...b.stats, durationMs: 0, averageFrameMs: 0 });
  });
});

describe('probe: deliberately broken scenes fail for the expected reason', () => {
  it('a throw while mounting', () => {
    const report = probe(build({ bar: "const bar = stage.rect(40, 50, 20, 40, { tone: 'lit' });\nconst list = [];\nconst broken = list[3].x;" }));
    expect(checks(report)).toEqual(['mount']);
    expect(report.failures[0]!.error).toMatchObject({ phase: 'mount', name: 'TypeError' });
  });

  it('a throw inside the frame function, with the time it happened', () => {
    const report = probe(build({}, "inc.onFrame(({ time }) => { if (time > 0.5) { const none = undefined; none.x; } });"));
    expect(checks(report)[0]).toBe('runs');
    expect(report.failures[0]!.time).toBeGreaterThan(0.5);
    expect(report.failures[0]!.playing).toBe(true);
  });

  it('a NaN that only appears at an extreme value', () => {
    const report = probe(build({ frame: 'inc.onFrame(() => { bar.set({ y: 90 - h.value * 10, height: h.value === 9 ? Math.sqrt(-1) : h.value * 10 }); });' }));
    const failure = report.failures.find((f) => f.check === 'numbers');
    expect(failure?.message).toContain('received NaN');
    expect(failure?.values).toEqual({ height: 9 });
  });

  it('a model output that is not finite at the declared singular point', () => {
    const js = build(
      {
        param: "const h = inc.param('height', { min: 1, max: 9, step: 0.01, value: 4, label: 'Height' });",
        frame: "const model = inc.model(({ height }) => ({ image: 1 / (height - 3.37) }));\ninc.onFrame(() => { bar.set({ y: 90 - h.value * 10, height: h.value * 10 }); });",
      },
      'inc.readout({ Image: () => model.image.toFixed(2) });',
    );
    expect(probe(js).failures).toEqual([]); // random points rarely hit it...
    const report = probe(js, { spec: { singularPoints: [{ height: 3.37 }] } }); // ...so the plan declares it
    expect(report.failures.map((f) => [f.check, f.message.split(' with')[0]])).toContainEqual(['numbers', 'Model output model.image is Infinity']);
  });

  it('a throw at the state where a live figure hit a problem, which the spec names (RP-7)', () => {
    const js = build({
      param: "const h = inc.param('height', { min: 1, max: 9, step: 0.01, value: 4, label: 'Height' });",
      frame: "inc.onFrame(() => { const list = []; if (Math.abs(h.value - 6.42) < 0.001) list[2].at(0, 0); bar.set({ y: 90 - h.value * 10, height: h.value * 10 }); });",
    });
    expect(probe(js).failures).toEqual([]);
    const report = probe(js, { spec: { states: [{ height: 6.42, unknown: 1 }] } });
    expect(report.failures[0]).toMatchObject({ check: 'interior', values: { height: 6.42 }, error: { phase: 'frame' } });
  });

  it('a slider that does nothing while paused (the paused-slider bug)', () => {
    const report = probe(
      build({ frame: "inc.onFrame(({ time, dt }) => { if (dt > 0) bar.set({ y: 90 - h.value * 10 - Math.sin(time), height: h.value * 10 }); });" }),
    );
    expect(checks(report)).toContain('paused-change');
    expect(report.failures.find((f) => f.check === 'paused-change')!.message).toContain('Moving height while paused');
  });

  it('a drawing outside the stage', () => {
    const report = probe(build({ bar: "const bar = stage.rect(140, 50, 20, 40, { tone: 'lit' });" }));
    expect(checks(report)).toEqual(['bounds']);
    expect(report.failures[0]!.message).toContain('outside its viewBox');
  });

  it('nothing drawn at all', () => {
    const report = probe(build({ frame: 'inc.onFrame(() => { bar.hide(); });' }));
    expect(report.failures.map((f) => f.message)).toContain('Nothing is drawn at the default values');
  });

  it('too many elements', () => {
    const report = probe(build({}, 'for (let i = 0; i < 400; i++) { stage.circle(50, 50, 1); }'), { elementBudget: 300 });
    expect(report.failures).toContainEqual(expect.objectContaining({ check: 'budget', message: 'The scene draws 401 elements; the budget is 300' }));
  });

  it('a frame that costs too much', () => {
    let clock = 0;
    const report = probe(build(), { now: () => (clock += 10) });
    expect(checks(report)).toContain('frame-cost');
  });

  it('a frame that throws is reported as such, not also as too slow', () => {
    let clock = 0;
    const report = probe(build({}, 'inc.onFrame(() => { const none = undefined; none.x; });'), { now: () => (clock += 10) });
    expect(checks(report)[0]).toBe('runs');
    expect(checks(report)).not.toContain('frame-cost');
  });

  it('missing teaching: no idea, no description, no steps, a missing part', () => {
    const report = probe(build({ idea: '', describe: '', steps: '' }), { spec: { parts: ['Bar', 'Label'] } });
    expect(checks(report)).toEqual(['idea', 'description', 'parts', 'steps']);
    expect(report.failures[2]!.message).toContain('Label');
  });

  it('a step count that disagrees with the plan, and a step that throws', () => {
    const wrongCount = probe(build(), { spec: { steps: 3 } });
    expect(wrongCount.failures).toEqual([expect.objectContaining({ check: 'steps', message: 'The plan has 3 steps but the scene has 2' })]);
    const throwing = probe(
      build({}, "inc.onFrame(() => { if (h.value === 8) { const none = undefined; none.x; } });"),
    );
    expect(throwing.failures.find((f) => f.check === 'steps')?.message).toBe('The scene threw on step 2');
  });

  it('a runaway loop, stopped by fuel and reported as one', () => {
    const report = probe(build({}, 'inc.onFrame(() => { const xs = [1]; for (const x of xs) { xs.push(x); } });'));
    expect(checks(report)[0]).toBe('runs');
    expect(report.failures[0]!.error).toMatchObject({ phase: 'runaway', name: 'RunawayError' });
  });

  it('stops itself when it runs out of time', () => {
    let clock = 0;
    const report = probe(build(), { now: () => (clock += 100), timeBudgetMs: 1000, frameBudgetMs: 1e9 });
    expect(checks(report).at(-1)).toBe('timeout');
  });
});

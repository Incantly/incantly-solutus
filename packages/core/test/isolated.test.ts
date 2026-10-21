import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compileIsolated, probeScene, SceneRuntime, validateScene, type ValidatedScene } from '../src';
import { REFERENCE_SCENES } from '../src/scenes';

/** A fresh context with no Node globals, where strings cannot become code. */
function isolatedEvaluator() {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  return (source: string, filename: string) => new vm.Script(source, { filename }).runInContext(context);
}

function validated(js: string): ValidatedScene {
  const result = validateScene({ html: "<div id='stage'></div>", css: '', js });
  if (!result.scene) throw new Error(result.diagnostics.map((d) => d.message).join('\n'));
  return result.scene;
}

describe('isolated compilation (the eval probe outside a browser)', () => {
  it('probes a reference scene compiled in an isolated context', () => {
    const scene = REFERENCE_SCENES['sine-wave']!;
    const result = validateScene(scene);
    const compiled = compileIsolated(result.scene!, isolatedEvaluator());
    const report = probeScene(compiled.scene, {
      spec: { parts: scene.plan.parts, steps: scene.plan.steps.length },
      beforeStep: compiled.fuel.refuel,
      runtime: { locate: compiled.locate },
    });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('keeps the message and the agent line of an error thrown in the other realm', () => {
    const js = [
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Dots' });",
      'const list = [stage.circle(10, 10, 2)];',
      'inc.onFrame(() => {',
      '  list[3].at(5, 5);',
      '});',
    ].join('\n');
    const compiled = compileIsolated(validated(js), isolatedEvaluator());
    const report = probeScene(compiled.scene, { beforeStep: compiled.fuel.refuel, runtime: { locate: compiled.locate } });
    const failure = report.failures.find((f) => f.check === 'runs');
    expect(failure?.error).toMatchObject({ name: 'TypeError', line: 4 });
    expect(failure?.error?.message).toMatch(/undefined/);
    expect(failure?.error?.column).toBeGreaterThan(2);
  });

  it('stops a runaway loop with fuel', () => {
    const js = [
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'List' });",
      'stage.circle(50, 50, 4);',
      'inc.onFrame(() => {',
      '  const xs = [1];',
      '  for (const x of xs) xs.push(x);',
      '});',
    ].join('\n');
    const compiled = compileIsolated(validated(js), isolatedEvaluator());
    const report = probeScene(compiled.scene, { beforeStep: compiled.fuel.refuel, runtime: { locate: compiled.locate } });
    expect(report.failures[0]).toMatchObject({ check: 'runs', error: { phase: 'runaway' } });
  });

  it('gives code that slipped past the validator no Node globals and no way to make code from strings', () => {
    // Not reachable through validateScene: this checks the second wall on its own.
    const unvalidated: ValidatedScene = {
      html: '',
      css: '',
      js: '',
      instrumented: {
        code: [
          "const seen = [typeof process, typeof require, typeof global, typeof Buffer].join(' ');",
          'let made = "blocked";',
          'try { made = (0, eval)("1 + 1"); } catch (e) { made = e.name; }',
          "inc.idea(seen + ' / ' + made);",
          "inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'x' }).circle(5, 5, 1);",
        ].join('\n'),
        shifts: [],
      },
    };
    const compiled = compileIsolated(unvalidated, isolatedEvaluator());
    const runtime = new SceneRuntime({});
    const update = runtime.mount(compiled.scene);
    expect(update.ui.idea).toBe('undefined undefined undefined undefined / EvalError');
  });
});

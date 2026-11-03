import { validateScene, type ProbeReport } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { isolatedProbe, probeSpecFor } from '../src/probe';
import { likelyCause, parseReport, probeReport, repairPrompt, sourceContext, validationReport } from '../src/report';

const projectile = REFERENCE_SCENES.projectile!;

/** The projectile scene with one line of its script replaced. */
function withLine(find: string | RegExp, replace: string) {
  const js = projectile.js.replace(find, replace);
  if (js === projectile.js) throw new Error(`no match for ${String(find)}`);
  return { html: projectile.html, css: projectile.css, js };
}

async function probe(fragments: { html: string; css: string; js: string }): Promise<ProbeReport> {
  const result = validateScene(fragments);
  if (!result.scene) throw new Error('expected a valid scene');
  return isolatedProbe(result.scene, probeSpecFor(projectile.plan));
}

describe('repair reports', () => {
  it('names an element drawn outside its stage and points at the line that made it', async () => {
    const fragments = withLine(/^const peak = graph\.segment\(0, 0, 0, 0, \{ tone: 'c', dashed: true \}\);$/m, "const peak = graph.segment(0, 0, 0, 0, { tone: 'c', dashed: true });\nconst stray = graph.label(140, 70, 'far away');");
    const report = await probe(fragments);
    const text = probeReport(report, fragments, projectile.plan).text;
    const line = fragments.js.split('\n').findIndex((l) => l.startsWith('const stray')) + 1;
    expect(report.failures[0]).toMatchObject({ check: 'bounds', error: { line } });
    expect(report.failures[0]!.message).toMatch(/the text reaches x = [\d.]+, right of \d+/);
    expect(text).toContain(`AGENT_JS line ${line}`);
    expect(text).toContain("graph.label(140, 70, 'far away')");
  });

  it('quotes a validator error with its rule, the fragment line and its neighbours, and the broken core rule', () => {
    const fragments = withLine(/^inc\.readout/m, "fetch('https://example.com');\ninc.readout");
    const { diagnostics } = validateScene(fragments);
    const report = validationReport(diagnostics, fragments);
    const line = fragments.js.split('\n').findIndex((l) => l.startsWith('fetch(')) + 1;
    expect(report.kind).toBe('validation');
    expect(report.check).toBe('forbidden-global');
    expect(report.text).toContain('REPAIR 1 of 1');
    expect(report.text).toContain(`ERROR    ERROR forbidden-global:`);
    expect(report.text).toContain(`WHERE    AGENT_JS line ${line}, column 1`);
    expect(report.text).toContain(`> ${line} | fetch('https://example.com');`);
    expect(report.text).toMatch(/RULE {5}10\. JavaScript is a small subset/);
    expect(report.summary).toBe(`forbidden-global at js:${line}:1`);
  });

  it('quotes at most five validator errors', () => {
    const js = `${projectile.js}\n${Array.from({ length: 8 }, (_, i) => `window.x${i} = 1;`).join('\n')}`;
    const fragments = { html: projectile.html, css: projectile.css, js };
    const report = validationReport(validateScene(fragments).diagnostics, fragments);
    expect(report.text.match(/^ERROR /gm)).toHaveLength(5);
    expect(report.text).toContain('...and 3 more');
  });

  it('quotes one error of each kind before more of one kind, so a repair sees every kind', () => {
    const js = `${projectile.js}\n${Array.from({ length: 6 }, (_, i) => `window.x${i} = 1;`).join('\n')}\nconst late = (1).toBogus(2);`;
    const fragments = { html: projectile.html, css: projectile.css, js };
    const report = validationReport(validateScene(fragments).diagnostics, fragments);
    expect(report.text.match(/^ERROR /gm)).toHaveLength(5);
    expect(report.text).toContain('toBogus');
    expect(report.summary).toContain('unknown-method');
    expect(report.text).toMatch(/\.\.\.and \d+ more: forbidden-global at js line \d+/);
  });

  it('reports a probe failure with the parameter state, the real error, the mapped line, a likely cause and the rule', async () => {
    const fragments = withLine(/^inc\.onFrame\(\(\{ time \}\) => \{$/m, 'const empty = [];\ninc.onFrame(({ time }) => {\n  empty[2].at(0, 0);');
    const result = await probe(fragments);
    expect(result.ok).toBe(false);
    const report = probeReport(result, fragments, projectile.plan);
    const line = fragments.js.split('\n').findIndex((l) => l.includes('empty[2].at')) + 1;
    expect(report.kind).toBe('probe');
    expect(report.check).toBe('runs');
    expect(report.text).toMatch(/^FAILURE {2}runs: The scene threw on frame 1$/m);
    expect(report.text).toMatch(/^WHEN {5}speed = 18 m\/s \(default\), angle = 45 degrees \(default\), gravity = 9\.8 m\/s² \(default\), t = [\d.]+ s, playing$/m);
    expect(report.text).toMatch(/^ERROR {4}TypeError: Cannot read properties of undefined \(reading 'at'\)$/m);
    // V8 places the error at the property it could not read.
    expect(report.text).toContain(`WHERE    AGENT_JS line ${line}, column 12`);
    expect(report.text).toContain(`> ${line} |   empty[2].at(0, 0);`);
    expect(report.text).toMatch(/^LIKELY {3}an index or key is out of range/m);
    expect(report.text).toMatch(/^RULE {5}5\. Animate only from frame\.time and frame\.dt/m);
    expect(report.summary).toContain(`at js:${line}:12`);
  });

  it('marks parameter values at their bounds', () => {
    const report = probeReport(
      {
        ok: false,
        failures: [{ check: 'sweep', message: 'A readout is NaN', values: { speed: 5, angle: 80, gravity: 12 }, playing: false, time: 0 }],
        stats: { configurations: 1, frames: 1, averageFrameMs: 1, elements: 1, durationMs: 1 },
      },
      projectile,
      projectile.plan,
    );
    expect(report.text).toContain('WHEN     speed = 5 m/s (minimum), angle = 80 degrees (maximum), gravity = 12 m/s², t = 0 s, paused');
    expect(report.text).toContain('LIKELY   a division by zero');
  });

  it('says why text overflows a stage only a few units wide', () => {
    const small = { check: 'bounds' as const, message: '1 element of the stage #stage lies outside its viewBox [-2.6, -0.4, 5.2, 3.9] at the default values: the text reaches x = 86.1, right of 2.6' };
    expect(likelyCause(small)).toMatch(/text is 12 units tall, so in a viewBox only 5.2 wide it covers the stage/);
    const wide = { check: 'bounds' as const, message: '1 element of the stage #stage lies outside its viewBox [0, 0, 760, 380] at the default values: the text reaches x = 811.7, right of 760' };
    expect(likelyCause(wide)).toMatch(/move the text left by 51\.7 units/);
  });

  it('hints API-guard errors by message, not by check', () => {
    // A spring error found while stepping is about the stiffness, not the steps.
    const spring = { check: 'steps' as const, message: 'The scene threw on step 2', error: { phase: 'mount', name: 'SceneApiError', message: 'world.spring: stiffness must be above 0 N/m, got 0' } };
    expect(likelyCause(spring)).toMatch(/clamp it above 0/);
    expect(likelyCause(spring)).not.toMatch(/inc\.steps/);
    const long = { check: 'mount' as const, message: 'The scene threw while mounting', error: { phase: 'mount', name: 'SceneApiError', message: 'Chart series "Setpoint" has 300 values; at most 60' } };
    expect(likelyCause(long)).toMatch(/keep the series to 60/);
    const empty = { check: 'mount' as const, message: 'The scene threw while mounting', error: { phase: 'mount', name: 'SceneApiError', message: 'Chart series "Process" has no values' } };
    expect(likelyCause(empty)).toMatch(/starts with data/);
    const categories = { check: 'mount' as const, message: 'The scene threw while mounting', error: { phase: 'mount', name: 'SceneApiError', message: 'Chart series "Process" has 8 values but the chart has 6 categories' } };
    expect(likelyCause(categories)).toMatch(/exactly one value per category/);
    const element = { check: 'mount' as const, message: 'The scene threw while mounting', error: { phase: 'mount', name: 'SceneApiError', message: 'Expected an element the SDK made, such as stage.circle(...) or graph.point(...); dots and plain objects cannot be used here' } };
    expect(likelyCause(element)).toMatch(/already a part under its own name/);
    const point = { check: 'mount' as const, message: 'The scene threw while mounting', error: { phase: 'mount', name: 'SceneApiError', message: 'world.box: at must be a point [x, y] of finite numbers, in metres' } };
    expect(likelyCause(point)).toMatch(/as an \[x, y\] pair/);
  });

  it('quotes the contract rule for API-guard errors instead of the check’s rule', () => {
    const report = probeReport(
      {
        ok: false,
        failures: [{ check: 'mount', message: 'The scene threw while mounting', error: { phase: 'mount', name: 'SceneApiError', message: 'Chart series "Setpoint" has 300 values; at most 60', line: 32, column: 28 } }],
        stats: { configurations: 1, frames: 1, averageFrameMs: 1, elements: 1, durationMs: 1 },
      },
      projectile,
      projectile.plan,
    );
    expect(report.rules).toEqual([13]);
    expect(report.text).toMatch(/RULE {5}13\. If you are not sure the kit has something/);
    expect(report.text).toMatch(/LIKELY {3}keep the series to 60/);
  });

  it('turns bounds violations into concrete moves', () => {
    const one = { check: 'bounds' as const, message: '1 element of the stage #stage lies outside its viewBox [0, 0, 600, 400] at the default values: the circle reaches y = 433.15, below 400 (made at line 20)' };
    expect(likelyCause(one)).toMatch(/move the circle up by 33\.15 units/);
    const two = { check: 'bounds' as const, message: '4 elements of the stage #stage lie outside its viewBox [0, 0, 600, 400] at the default values: the path reaches x = -220, left of 0 (made at line 12); the circle reaches y = 698.269, below 400 (made at line 14)' };
    expect(likelyCause(two)).toMatch(/move the path right by 220 units; move the circle up by 298\.27 units/);
    expect(likelyCause(two)).toMatch(/every parameter value still fits/);
    // Unparseable bounds still get the general advice.
    expect(likelyCause({ check: 'bounds' as const, message: 'shapes are offstage somewhere' })).toMatch(/scale them to the viewBox/);
  });

  it('names a runaway loop and the other failures found', () => {
    const failure = { check: 'runs' as const, message: 'The scene threw on frame 1', error: { phase: 'runaway', name: 'RunawayError', message: 'too many iterations' } };
    expect(likelyCause(failure)).toMatch(/loop never ends/);
    const report = probeReport(
      {
        ok: false,
        failures: [failure, { check: 'parts', message: 'The plan names parts the scene never registers: Ball' }],
        stats: { configurations: 1, frames: 1, averageFrameMs: 1, elements: 1, durationMs: 1 },
      },
      projectile,
      projectile.plan,
    );
    expect(report.text).toContain('ALSO\n         parts: The plan names parts the scene never registers: Ball');
    expect(report.rules).toEqual([5, 8]);
  });

  it('reports an unreadable reply', () => {
    const report = parseReport(['The js block was never closed'], ['js'], 1, 1);
    expect(report.text).toContain('ERROR    The js block was never closed');
    expect(report.text).toContain('ERROR    Missing fragment: js');
    expect(report.text).toContain('LIKELY   the reply was cut off');
  });

  it('asks only for the edits that failed when the others applied, not for the scene again', () => {
    // Once a repair after one failed edit wrote the whole scene again and ran past the deadline.
    const report = parseReport(['Edit failed: js: edit 8 did not match: copy its SEARCH text exactly from the fragment'], [], 1, 1);
    expect(report.text).toContain('LIKELY   the other edits were applied, and the fragment below is as they left it: send only the edits that failed');
    expect(report.text).not.toContain('cut off');
  });

  it('numbers the source context like the fragment', () => {
    expect(sourceContext('a\nb\nc\nd', 2)).toBe('    1 | a\n  > 2 | b\n    3 | c');
    expect(sourceContext('a\nb', 1)).toBe('  > 1 | a\n    2 | b');
    expect(sourceContext(Array.from({ length: 12 }, (_, i) => `l${i + 1}`).join('\n'), 10)).toBe('     9 | l9\n  > 10 | l10\n    11 | l11');
  });
});

describe('the repair call', () => {
  it('sends only the report, the fragments as they stand, the capability lines and the parameter ranges', () => {
    const fragments = withLine(/^inc\.readout/m, "fetch('https://example.com');\ninc.readout");
    const report = validationReport(validateScene(fragments).diagnostics, fragments);
    const prompt = repairPrompt(report, fragments, projectile.plan);
    expect(prompt.user.startsWith(report.text)).toBe(true);
    expect(prompt.user).toContain('```js\n' + fragments.js.replace(/\n$/, '') + '\n```');
    expect(prompt.user).toContain('speed from 5 to 20');
    expect(prompt.system[1]!.text).toContain('- graph2d: ');
    // Edits, not whole fragments: a repair costs a few lines of output.
    expect(prompt.system[1]!.text).toContain('Reply with edits only');
    expect(prompt.system[1]!.text).toContain('<<<<<<< SEARCH');
    expect(prompt.system[1]!.text).not.toContain('interface Graph {');
  });

  it('adds the contract when the failure is a name the kit does not have', () => {
    const fragments = withLine(/^inc\.readout/m, "inc.plotGraph('#stage');\ninc.readout");
    const report = validationReport(validateScene(fragments).diagnostics, fragments);
    expect(report.check).toBe('unknown-sdk-call');
    expect(repairPrompt(report, fragments, projectile.plan).system[1]!.text).toContain('interface Graph {');
  });

  it('adds the contract for probe failures, whose fixes need the API they tripped', () => {
    const report = probeReport(
      {
        ok: false,
        failures: [{ check: 'paused-change', message: 'Moving speed while paused does not change the drawing', values: { speed: 5 }, playing: false }],
        stats: { configurations: 1, frames: 1, averageFrameMs: 1, elements: 1, durationMs: 1 },
      },
      projectile,
      projectile.plan,
    );
    expect(repairPrompt(report, projectile, projectile.plan).system[1]!.text).toContain('interface Graph {');
  });
});

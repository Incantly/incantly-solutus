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
    expect(likelyCause(wide)).toMatch(/scale them to the viewBox/);
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
});

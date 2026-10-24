import { describe, expect, it } from 'vitest';
import { applyEdits, applyFragmentEdits, parseEdits } from '../src/edits';

const SCENE = ["const wave = inc.formula('A*sin(w*x + phi - t)', { vars: { A, w, phi } });", 'inc.describe(() => `A sine wave.`);', '  inc.onFrame(({ time }) => {', '    dot.at(0, wave(0));', '  });'].join('\n');

const pair = (search: string, replace: string) => ['<<<<<<< SEARCH', search, '=======', replace, '>>>>>>> REPLACE'].join('\n');

describe('edit replies (PRD 25.5, RP-5)', () => {
  it('applies each edit where its SEARCH matches, exactly or line by line', () => {
    const applied = applyEdits(SCENE, [
      { search: "const wave = inc.formula('A*sin(w*x + phi - t)', { vars: { A, w, phi } });", replace: "const wave = inc.formula('A*sin(w*x + phi)', { vars: { A, w, phi } });" },
      // Indented differently from the fragment: still one place.
      { search: 'inc.onFrame(({ time }) => {\n  dot.at(0, wave(0));', replace: '  inc.onFrame(({ time }) => {\n    dot.at(0, wave(time));' },
    ]);
    expect(applied.failed).toEqual([]);
    expect(applied.text).toContain("'A*sin(w*x + phi)'");
    expect(applied.text).toContain('dot.at(0, wave(time));');
  });

  it('finds a SEARCH copied with other spacing: from the middle of a line, indented otherwise, or broken in two', () => {
    // Once a reply copied the start of a long line with two spaces more than the fragment had, and the edit failed.
    const line = '    `Air at ${model.U.toFixed(1)} m/s streams past a cylinder of radius 11 cm spinning at ${spin.value} revolutions a second.`,';
    const source = ['inc.describe(', '  () =>', line, ');'].join('\n');
    const midLine = applyEdits(source, [{ search: '      `Air at ${model.U.toFixed(1)} m/s streams past a cylinder of radius 11 cm spinning', replace: '      `Air at ${model.U.toFixed(1)} m/s streams past a ball of radius 11 cm spinning' }]);
    expect(midLine.failed).toEqual([]);
    // The rest of the line, and its indentation, stay as they were.
    expect(midLine.text).toBe(['inc.describe(', '  () =>', line.replace('a cylinder', 'a ball'), ');'].join('\n'));
    const broken = applyEdits(source, [{ search: 'm/s streams past a cylinder\n of radius 11 cm', replace: 'm/s streams past a ball of radius 11 cm' }]);
    expect(broken.failed).toEqual([]);
    expect(broken.text).toContain('streams past a ball of radius 11 cm spinning');
    // Still once only: spacing taken loosely must not make an edit land in two places.
    const twice = `${source}\n${source}`;
    expect(applyEdits(twice, [{ search: '  `Air at   ${model.U.toFixed(1)}', replace: 'x' }]).failed[0]).toMatch(/more than one place/);
  });

  it('says when an edit matches nowhere or in more than one place', () => {
    const twice = `${SCENE}\n${SCENE}`;
    expect(applyEdits(SCENE, [{ search: 'const nothing = 1;', replace: 'const something = 2;' }]).failed).toEqual(['edit 1 did not match: copy its SEARCH text exactly from the fragment']);
    expect(applyEdits(twice, [{ search: 'dot.at(0, wave(0));', replace: 'dot.at(0, 1);' }]).failed[0]).toMatch(/more than one place/);
  });

  it('takes a repeated edit as applied when its replacement already stands, as when a reply corrects itself', () => {
    const fix = pair("const wave = inc.formula('A*sin(w*x + phi - t)', { vars: { A, w, phi } });", "const wave = inc.formula('A*sin(w*x + phi)', { vars: { A, w, phi } });");
    const noop = pair('  inc.onFrame(({ time }) => {', '  inc.onFrame(({ time }) => {');
    const reply = ['```edit js', fix, noop, '```', '', 'Wait, the last pair is a no-op; the correct reply is:', '', '```edit js', fix, '```'].join('\n');
    const parsed = parseEdits(reply);
    expect(parsed.problems).toEqual([]);
    expect(parsed.edits.js).toHaveLength(3);
    const applied = applyFragmentEdits({ html: '', css: '', js: SCENE }, parsed.edits);
    expect(applied.failed).toEqual([]);
    expect(applied.changed).toEqual(['js']);
    expect(applied.fragments.js).toContain("'A*sin(w*x + phi)'");
    expect(applied.fragments.js!.match(/inc\.formula/g)).toHaveLength(1);
  });

  it('still fails an edit whose replacement stands in more than one place', () => {
    const twice = `${SCENE}\ninc.describe(() => \`A sine wave.\`);`;
    expect(applyEdits(twice, [{ search: 'inc.describe(() => `A wave.`);', replace: 'inc.describe(() => `A sine wave.`);' }]).failed).toHaveLength(1);
  });
});

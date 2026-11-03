import { describe, expect, it } from 'vitest';
import { applyEdits, applyFragmentEdits, parseEdits } from '../src/edits';

const SCENE = ["const wave = inc.formula('A*sin(w*x + phi - t)', { vars: { A, w, phi } });", 'inc.describe(() => `A sine wave.`);', '  inc.onFrame(({ time }) => {', '    dot.at(0, wave(0));', '  });'].join('\n');

const pair = (search: string, replace: string) => ['<<<<<<< SEARCH', search, '=======', replace, '>>>>>>> REPLACE'].join('\n');

describe('edit replies (PRD 25.5, RP-5)', () => {
  it('never keeps a second divider or a SEARCH line inside a replacement as code', () => {
    // Kimi K3 chained pairs without closing each one; the second ======= became a line of the script, a syntax error.
    const chained = ['```edit js', '<<<<<<< SEARCH', 'dot.at(0, wave(0));', '=======', 'dot.at(0, wave(1));', '=======', 'dot.at(0, wave(2));', '>>>>>>> REPLACE', '```'].join('\n');
    const broken = parseEdits(chained);
    expect(broken.edits.js ?? []).toEqual([]);
    expect(broken.problems.join(' ')).toContain('close each edit with >>>>>>> REPLACE');
    // A SEARCH inside a replacement starts the next edit; the one it broke is dropped, the next is applied.
    const next = ['```edit js', '<<<<<<< SEARCH', 'dot.at(0, wave(0));', '=======', 'dot.at(0, wave(1));', '<<<<<<< SEARCH', "inc.describe(() => `A sine wave.`);", '=======', "inc.describe(() => `A wave.`);", '>>>>>>> REPLACE', '```'].join('\n');
    const parsed = parseEdits(next);
    expect(parsed.edits.js).toEqual([{ search: "inc.describe(() => `A sine wave.`);", replace: "inc.describe(() => `A wave.`);" }]);
    expect(applyEdits(SCENE, parsed.edits.js!).text).not.toMatch(/^={5,}$|^<{5,}|^>{5,}/m);
  });

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

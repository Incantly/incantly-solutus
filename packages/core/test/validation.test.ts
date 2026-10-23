import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { REFERENCE_SCENES } from '../src/scenes';
import {
  FUEL_FUNCTION,
  KEY_FUNCTION,
  LineIndex,
  fixScene,
  formatDiagnostic,
  instrumentSceneJs,
  originalColumn,
  validateScene,
  validateSceneCss,
  validateSceneHtml,
  validateSceneJs,
  type Diagnostic,
} from '../src/validation';
import { BASE_JS, VALIDATOR_CASES, scene, type Fragments } from './fixtures/validator-cases';

function expectedPosition(fragments: Fragments, fragment: 'html' | 'css' | 'js', at: string | number) {
  const source = fragments[fragment];
  const offset = typeof at === 'number' ? at : source.indexOf(at);
  expect(offset, `"${String(at)}" occurs in the ${fragment} fragment`).toBeGreaterThanOrEqual(0);
  return new LineIndex(source).position(offset);
}

const errors = (diagnostics: readonly Diagnostic[]) => diagnostics.filter((d) => d.severity === 'error');

describe('validator: messages that name the fix', () => {
  it('points set on a 3D label at text, its words', () => {
    // Once a seasons scene called set on a 3D label and was asked whether it meant at.
    const js = [
      "const space = inc.space3d('#stage', { title: 'Orbit' });",
      "const label = space.label([0, 0, 0], 'a');",
      "label.set('b');",
    ].join('\n');
    const result = validateScene(scene({ js }));
    expect(errors(result.diagnostics).map((d) => d.message)).toContain('Label3D handles have no method "set"; did you mean text?');
  });

  it('points a helper used without inc. at the SDK one', () => {
    // Once a lens scene called sym(...) and was asked whether it meant its own constant S.
    const result = validateScene(scene({ js: `${BASE_JS}\nconst S = 2;\nconst label = sym('x^2');` }));
    expect(errors(result.diagnostics).map((d) => d.message)).toContain('"sym" is not defined; did you mean inc.sym?');
  });

  it('names the cap for a loop to a count that can change, and the loop for Array.from', () => {
    // Once diffusion scenes looped to a particle count the controls change, and seasons scenes built orbits with Array.from.
    const loop = validateScene(scene({ js: `${BASE_JS}\nlet n = 0;\ninc.onFrame(() => {\n  n = 40;\n  for (let i = 0; i < n; i++) dot.at(i, 0);\n});` }));
    expect(errors(loop.diagnostics).map((d) => d.message)).toContain("n can change, so the loop has no visible bound: loop to Math.min(n, 5000), a const number or an array's length");
    const array = validateScene(scene({ js: `${BASE_JS}\nconst points = Array.from({ length: 73 }, (_, i) => [i, 0]);` }));
    const global = errors(array.diagnostics).find((d) => d.rule === 'forbidden-global');
    expect(global?.message).toContain('Array is not part of the scene subset; build a list with a for loop and a visible bound');
  });
});

describe('validator: every forbidden construct is rejected where it is written', () => {
  it.each(VALIDATOR_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const bad = scene({ js: BASE_JS, ...c.bad });
    const result = validateScene(bad);
    expect(result.ok).toBe(false);
    expect(result.scene).toBeNull();
    const position = expectedPosition(bad, c.fragment, c.at);
    const match = result.diagnostics.find((d) => d.rule === c.rule && d.fragment === c.fragment);
    expect(match, `a ${c.rule} error; got ${result.diagnostics.map(formatDiagnostic).join(' | ')}`).toBeDefined();
    expect({ line: match!.line, column: match!.column }).toEqual(position);
    expect(match!.message.length).toBeGreaterThan(10);
  });
});

describe('validator: every valid twin passes, so the rules are not over-strict', () => {
  it.each(VALIDATOR_CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = validateScene(scene({ js: BASE_JS, ...c.twin }));
    expect(errors(result.diagnostics).map(formatDiagnostic)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.scene).not.toBeNull();
  });
});

describe('validator: reference scenes', () => {
  it.each(Object.keys(REFERENCE_SCENES))('%s passes with no warnings', (id) => {
    const source = REFERENCE_SCENES[id]!;
    const result = validateScene(source);
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.info.parts).toEqual(source.plan.parts);
    expect(result.info.stepCount).toBe(source.plan.steps.length);
    expect(result.info.paramCount).toBe(source.plan.parameters.length);
    expect(result.info.hasIdea && result.info.hasDescribe).toBe(true);
  });
});

describe('validator: JavaScript details', () => {
  it('reports syntax errors with the parser message and position', () => {
    const result = validateSceneJs('const a = ;');
    expect(result.program).toBeNull();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ rule: 'syntax', line: 1, column: 11, message: 'Unexpected token' }),
    ]);
  });

  it('follows SDK handle types through const bindings to check method names', () => {
    const js = [
      "const g = inc.graph2d('#stage', { x: [0, 1], y: [0, 1], title: 'G' });",
      'const curve = g.plot((x) => x);',
      'curve.handle.d("M0 0");',
      'curve.handle.text("no");',
    ].join('\n');
    const result = validateSceneJs(js);
    expect(result.diagnostics.map((d) => `${d.rule}:${d.line}`)).toEqual(['unknown-method:4']);
    expect(result.diagnostics[0]!.message).toContain('Path handles have no method "text"');
  });

  it('offers a certain fix where there is one, and fixScene applies it with no model call', () => {
    const js = (body: string) =>
      [
        "const n = inc.param('n', { min: 1, max: 20, value: 5 });",
        "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'S' });",
        'const dot = stage.circle(10, 10, 2);',
        'let count = 3;',
        body,
        "inc.onFrame(() => { count = n.value; dot.at(count, 10); });",
      ].join('\n');
    const html = '<div id="stage"></div>';
    // A loop the controls can lengthen is capped at the limit; a void that only marks a name used is dropped.
    const broken = { html, css: '', js: js('for (let i = 0; i < count; i++) { dot.at(i, 10); }\nvoid dot;') };
    const before = validateScene(broken);
    expect(before.ok).toBe(false);
    expect(before.diagnostics.filter((d) => d.fix).map((d) => d.rule)).toEqual(['unbounded-loop', 'forbidden-syntax']);
    const fixed = fixScene(broken);
    expect(fixed.validation.ok).toBe(true);
    expect(fixed.fragments.js).toContain('for (let i = 0; i < Math.min(count, 5000); i++)');
    expect(fixed.fragments.js).not.toContain('void');
    expect(fixed.applied).toEqual(['dropped void dot', 'capped a loop at Math.min(count, 5000)']);
    // A loop counting down has no certain fix; neither has anything else; a valid scene is left alone.
    const down = { html, css: '', js: js('for (let i = 100; i > count; i--) { dot.at(i, 10); }') };
    expect(fixScene(down).applied).toEqual([]);
    expect(fixScene(down).validation.ok).toBe(false);
    const fine = { html, css: '', js: js('') };
    expect(fixScene(fine).fragments).toBe(fine);
  });

  it('checks the names a helper takes its arguments by, before the scene runs', () => {
    const errors = (js: string) => validateSceneJs(js).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.rule}:${d.line}`);
    const stage = "const stage = inc.svg('#stage', { fit: true, title: 'S' });\nconst g = stage.group();";
    expect(errors(`${stage}\nconst a = inc.path.arrow({ from: [0, 0], to: [10, 0] }, 8);\nconst b = inc.shapes.gear({ center: [50, 50], radius: 20, teeth: 12, toothDepth: 3 });\ng.at(5, 5).rotate(30, { about: [5, 5] });`)).toEqual([]);
    // An arrow with both a tip and an offset, or neither; a gear with a misspelt name; a pivot by another name.
    expect(errors(`${stage}\nconst a = inc.path.arrow({ from: [0, 0], to: [1, 0], by: [1, 0] });`)).toEqual(['invalid-argument:3']);
    expect(errors(`${stage}\nconst a = inc.path.arrow({ from: [0, 0] });`)).toEqual(['invalid-argument:3']);
    expect(errors(`${stage}\nconst b = inc.shapes.gear({ center: [5, 5], radius: 4, depth: 3 });`)).toEqual(['unknown-property:3']);
    expect(errors(`${stage}\ng.rotate(30, { pivot: [5, 5] });`)).toEqual(['unknown-property:3', 'invalid-argument:3']);
    // The names a model reaches for first mean the same: a pivot { x, y }, a gear's cx, cy and r; half of one is not enough.
    expect(errors(`${stage}\ng.rotate(30, { x: 5, y: 5 });\ng.rotate(30, { cx: 5, cy: 5 });\nconst c = inc.shapes.gear({ cx: 5, cy: 5, r: 4 });`)).toEqual([]);
    expect(errors(`${stage}\ng.rotate(30, { x: 5 });`)).toEqual(['invalid-argument:3']);
    expect(errors(`${stage}\nconst c = inc.shapes.gear({ center: [5, 5], cx: 5, cy: 5, r: 4 });`)).toEqual(['invalid-argument:3']);
    // Saved figures that call them by position still validate.
    expect(errors(`${stage}\nconst a = inc.path.arrow(0, 0, 10, 0);\ng.rotate(30, 1, 2);`)).toEqual([]);
  });

  it('lets a number be written with any of the number formatters', () => {
    const js = ['const x = 0.000123;', 'const a = x.toFixed(2);', 'const b = x.toPrecision(3);', 'const c = x.toExponential(1);', 'const d = `${a} ${b} ${c}`.trim();'].join('\n');
    expect(validateSceneJs(js).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('suggests the closest name for typos', () => {
    const result = validateSceneJs("const p = inc.parm('k', { min: 0, max: 1, value: 0 });");
    expect(result.diagnostics[0]!.message).toBe('inc.parm is not part of the SDK; did you mean inc.param?');
  });

  it('allows the documented subset: destructuring, spread, templates, optional chaining, switch', () => {
    const js = [
      "const k = inc.param('k', { min: 1, max: 5, value: 2 });",
      'const model = inc.model(({ k: v }) => ({ v, list: [v, v * 2], label: `k is ${v}` }));',
      'const stage = inc.svg("#stage", { viewBox: [0, 0, 10, 10], title: "S" });',
      'const [first, ...rest] = [1, 2, 3];',
      'const merged = { ...{ a: 1 }, b: rest.length };',
      'let total = 0;',
      'for (const n of model.list) total += n;',
      'for (let i = 0; i < Math.min(model.list.length, 50); i++) total -= i;',
      'switch (first) { case 1: total++; break; default: total--; }',
      'const maybe = model.list?.[0] ?? 0;',
      'inc.onFrame(({ time, dt }) => { stage.viewBox; total = time * dt + maybe + merged.b; });',
    ].join('\n');
    expect(validateSceneJs(js).diagnostics).toEqual([]);
  });

  it('warns, without failing, about typed decimals in teaching text', () => {
    const result = validateScene(scene({ js: `${BASE_JS}\ninc.explain(() => 'The range is 41.2 m.');` }));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ rule: 'number-in-text', severity: 'warning', line: 3 })]);
  });

  it('collects the stages, parts and steps it can see', () => {
    const result = validateSceneJs(
      [
        "const s = inc.svg('#a', { viewBox: [0, 0, 1, 1], title: 'A' });",
        "s.part('Dot', s.circle(0, 0, 1));",
        "inc.steps([{ say: 'one' }, { say: 'two' }]);",
      ].join('\n'),
    );
    expect(result.info.stages).toEqual([{ selector: '#a', line: 1, column: 19 }]);
    expect(result.info.parts).toEqual(['Dot']);
    expect(result.info.stepCount).toBe(2);
  });

  it('rejects a stage host that is not a literal id', () => {
    const result = validateSceneJs("const id = '#a';\nconst s = inc.svg(id, { viewBox: [0, 0, 1, 1], title: 'A' });");
    expect(result.diagnostics.map((d) => d.rule)).toEqual(['stage-selector']);
  });

  it('rejects names reserved for the engine', () => {
    const result = validateSceneJs('const __incFuel = 1;\nconst Math = 2;');
    expect(result.diagnostics.map((d) => d.rule)).toEqual(['reserved-name', 'reserved-name']);
  });

  it('enforces the syntax-tree budget', () => {
    const body = Array.from({ length: 800 }, (_, i) => `const v${i} = [${i}, ${i}, ${i}];`).join('\n');
    const result = validateSceneJs(body, { ...validateLimits(), astNodes: 1000 });
    expect(result.diagnostics.some((d) => d.rule === 'budget-ast')).toBe(true);
  });

  it('enforces the nesting budget', () => {
    const deep = `${'{'.repeat(30)}${'}'.repeat(30)}`;
    expect(validateSceneJs(deep).diagnostics.map((d) => d.rule)).toContain('budget-depth');
  });

  it('formats a diagnostic the way the repair report quotes it', () => {
    const [d] = validateSceneJs('fetch(1);').diagnostics;
    expect(formatDiagnostic(d!)).toBe(
      'ERROR forbidden-global: fetch uses the network; figures work offline and never make requests (AGENT_JS line 1, column 1)',
    );
  });
});

function validateLimits() {
  return {
    jsChars: 100_000,
    htmlChars: 4_000,
    cssChars: 4_000,
    astNodes: 6_000,
    depth: 24,
    params: 3,
    loopBound: 5_000,
    stringChars: 600,
    htmlElements: 120,
    htmlDepth: 12,
    cssRules: 80,
    cssDeclarations: 400,
  };
}

describe('validator: HTML details', () => {
  it('rebuilds canonical HTML: comments dropped, entities decoded and re-escaped, quotes normalized', () => {
    const result = validateSceneHtml(
      "<!-- stage --><div id=stage class='a  b'></div>\n<p>2 &lt; 3 &amp;&amp; x &gt; 1 &nbsp;&#8722;<br/>a & b</p>",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toBe('<div id="stage" class="a  b"></div>\n<p>2 &lt; 3 &amp;&amp; x &gt; 1  −<br>a &amp; b</p>');
    expect([...result.ids]).toEqual(['stage']);
  });

  it('keeps text-level content out of the wrong parents', () => {
    expect(validateSceneHtml('<p><div></div></p>').diagnostics[0]).toMatchObject({ rule: 'html-content' });
    expect(validateSceneHtml('<ul><p>x</p></ul>').diagnostics[0]).toMatchObject({ rule: 'html-content' });
    expect(validateSceneHtml('<ul>text</ul>').diagnostics[0]).toMatchObject({ rule: 'html-content' });
    expect(validateSceneHtml('<li>x</li>').diagnostics[0]).toMatchObject({ rule: 'html-content' });
  });

  it('rejects mismatched closing tags, duplicate ids and malformed references', () => {
    expect(validateSceneHtml('<div><span></div></span>').diagnostics[0]).toMatchObject({ rule: 'html-nesting', column: 12 });
    expect(validateSceneHtml("<div id='a'></div><div id='a'></div>").diagnostics[0]).toMatchObject({ rule: 'html-attribute' });
    expect(validateSceneHtml('<p>&bogus;</p>').diagnostics[0]).toMatchObject({ rule: 'html-entity' });
    expect(validateSceneHtml('<p>&#0;</p>').diagnostics[0]).toMatchObject({ rule: 'html-entity' });
    expect(validateSceneHtml('<!doctype html>').diagnostics[0]).toMatchObject({ rule: 'html-syntax' });
  });

  it('cannot be tricked by attribute or comment edge cases', () => {
    // Every one of these must fail rather than reach the frame.
    for (const html of [
      '<div id="a"onclick="x()"></div>',
      '<div title="a" title="b"></div>',
      '<div data-x="1" data-X="2"></div>',
      '<scr<script>ipt>alert(1)</script>',
      '<div>--!><script>x</script></div>',
      '<!-- <script>x</script> --!>',
      '<svg/onload=alert(1)>',
      '<style>*{}</style>',
      '<div aria-hidden="maybe"></div>',
      '<div role="button"></div>',
      '<div class="inc-controls"></div>',
    ]) {
      expect(validateSceneHtml(html).diagnostics.length, html).toBeGreaterThan(0);
    }
  });

  it('enforces element and depth budgets', () => {
    const many = '<span></span>'.repeat(121);
    expect(validateSceneHtml(many).diagnostics[0]).toMatchObject({ rule: 'html-budget' });
    const deep = `${'<div>'.repeat(13)}${'</div>'.repeat(13)}`;
    expect(validateSceneHtml(deep).diagnostics[0]).toMatchObject({ rule: 'html-budget' });
  });
});

describe('validator: CSS details', () => {
  it('accepts layout, typography, theme tokens, transitions and simple media queries', () => {
    const css = [
      '#stage { max-width: 760px; margin: 0 auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }',
      '.note:hover, .note:focus-visible { color: var(--inc-muted); transition: color 0.2s ease; }',
      'section > p + p { margin-top: calc(1em - 2px); }',
      'li:nth-child(2n+1) { opacity: 0.8; }',
      '[data-kind="slow"] { font-weight: 600; }',
      '@media (max-width: 600px) and (prefers-reduced-motion: reduce) { #stage { padding: 0; } }',
      '/* a comment */',
    ].join('\n');
    expect(validateSceneCss(css).diagnostics).toEqual([]);
  });

  it('rejects selectors that reach the page or the engine', () => {
    for (const [css, column] of [
      ['body { margin: 0; }', 1],
      [':root { --x: 1px; }', 1],
      ['p::before { opacity: 1; }', 2],
      ['#inc-x { opacity: 1; }', 1],
      ['a { opacity: 1; }', 1],
      ['p:has(span) { opacity: 1; }', 2],
    ] as const) {
      expect(validateSceneCss(css).diagnostics[0], css).toMatchObject({ rule: 'css-selector', line: 1, column });
    }
  });

  it('rejects values that load, colour or escape', () => {
    for (const [css, rule] of [
      ['p { color: hsl(0 100% 50%); }', 'css-colour'],
      ['p { border-color: RED; }', 'css-colour'],
      ['p { width: image-set("x.png" 1x); }', 'css-url'],
      ['p { width: 10q; }', 'css-value'],
      ['p { width: attr(data-w); }', 'css-value'],
      ['p { width: e\\78 pression(1); }', 'css-syntax'],
      ['p { width: 1px } -->', 'css-syntax'],
      ['@font-face { font-family: x; }', 'css-at-rule'],
      ['@media (min-resolution: 2dppx) { p { opacity: 1; } }', 'css-media'],
      ['@supports (display: grid) { p { opacity: 1; } }', 'css-at-rule'],
    ] as const) {
      expect(validateSceneCss(css).diagnostics[0], css).toMatchObject({ rule });
    }
  });

  it('enforces the rule budget', () => {
    const css = Array.from({ length: 81 }, (_, i) => `.r${i} { opacity: 1; }`).join('\n');
    expect(validateSceneCss(css).diagnostics[0]).toMatchObject({ rule: 'css-budget' });
  });
});

describe('instrumentation', () => {
  const instrument = (source: string) => {
    const program = parse(source, { ecmaVersion: 2020, sourceType: 'script' });
    return instrumentSceneJs(source, program);
  };

  /** Runs instrumented code with a fuel tank, the way the Worker does. */
  const run = (source: string, fuel = 1000) => {
    const scene = instrument(source);
    let left = fuel;
    const burn = () => {
      if (--left < 0) throw new Error('out of fuel');
    };
    const key = (k: unknown) => {
      if (typeof k === 'number') return k;
      if (typeof k === 'string' && k !== 'constructor' && k !== '__proto__') return k;
      throw new Error(`blocked key ${String(k)}`);
    };
    const fn = new Function(FUEL_FUNCTION, KEY_FUNCTION, `"use strict";\n${scene.code}`);
    return () => fn(burn, key);
  };

  it('adds fuel to every loop and function body and keeps the code on the same lines', () => {
    const source = [
      'const f = (x) => x * 2;',
      'const g = (x) => { return x; };',
      'for (let i = 0; i < 3; i++) f(i);',
      'for (const v of [1, 2]) { g(v); }',
      'const o = () => ({ a: 1 });',
    ].join('\n');
    const { code } = instrument(source);
    expect(code.split('\n')).toEqual([
      `const f = (x) => (${FUEL_FUNCTION}(),x * 2);`,
      `const g = (x) => {${FUEL_FUNCTION}(); return x; };`,
      `for (let i = 0; i < 3; i++) {${FUEL_FUNCTION}();f(i);}`,
      `for (const v of [1, 2]) {${FUEL_FUNCTION}(); g(v); }`,
      `const o = () => ((${FUEL_FUNCTION}(),{ a: 1 }));`,
    ]);
  });

  it('guards computed keys but leaves literal keys alone', () => {
    const { code } = instrument("const a = [1]; const k = 0; const b = a[k] + a[0] + a['length'];");
    expect(code).toBe(`const a = [1]; const k = 0; const b = a[${KEY_FUNCTION}(k)] + a[0] + a['length'];`);
  });

  it('stops a runaway loop with fuel instead of hanging', () => {
    expect(run('const a = [1]; for (const x of a) { if (a.length < 1e9) a.push(x); }')).toThrow('out of fuel');
    expect(run('const a = [1, 2, 3]; let s = 0; for (const x of a) s += x;')).not.toThrow();
  });

  it('blocks a key built at run time from reaching the constructor', () => {
    expect(run("const k = 'con' + 'structor'; const f = (() => 1)[k];")).toThrow('blocked key constructor');
  });

  it('maps instrumented columns back to the original', () => {
    const source = 'const f = (x) => x * 2; const y = f(1)[q];';
    const scene = instrument(source);
    const target = scene.code.indexOf('const y') + 1;
    expect(originalColumn(scene, 1, target)).toBe(source.indexOf('const y') + 1);
    const inside = scene.code.indexOf(FUEL_FUNCTION) + 1;
    expect(originalColumn(scene, 1, inside)).toBe(source.indexOf('x * 2') + 1);
    expect(originalColumn(scene, 2, 5)).toBe(5);
  });

  it('instruments every reference scene into valid script', () => {
    for (const source of Object.values(REFERENCE_SCENES)) {
      const result = validateScene(source);
      expect(result.scene?.instrumented.code).toContain(FUEL_FUNCTION);
      expect(() => parse(result.scene!.instrumented.code, { ecmaVersion: 2020 })).not.toThrow();
    }
  });
});

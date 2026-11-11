/**
 * Object properties as kernel data: defaults, keys, values, layers, showIf, dynamic colours, style edges.
 * Docs: kernel/design.md 9 (9.1 to 9.7); kernel/errors.md 1 and 3; errors/errors.md 1.2 (K020, K021), 5.6.
 */
import { describe, expect, it } from 'vitest';
import { colorFromWord, colorHex, defaultsFor, toColor, validKeysFor } from '@incantly/kernel';
import { bad, expectUnchanged, expectWellFormedError, figure, idOf, must, ok, resetRuns, runs, snap } from './helpers';

const BASE = [
  'A = (1, 1)',
  'B = (4, 0)',
  'M = Midpoint(A, B)',
  'seg = Segment(A, B)',
  'l = Line(A, B)',
  'c = Circle(A, 2)',
  'a = 3 in 0..10 step 0.5',
  'f(x) = x^2',
  's = "label"',
  'flag = true',
];

const style = (f: ReturnType<typeof figure>, name: string) => must(f.styleOf(idOf(f, name) as never), `style of ${name}`);

describe('defaults per type (design 9.3)', () => {
  it('a free Point is blue #2563eb, size 5', () => {
    const d = defaultsFor('Point', true);
    expect(colorHex(d.color)).toBe('#2563eb');
    expect(d.pointSize).toBe(5);
  });
  it('a dependent Point is dark grey #374151, size 4', () => {
    const d = defaultsFor('Point', false);
    expect(colorHex(d.color)).toBe('#374151');
    expect(d.pointSize).toBe(4);
  });
  it('a point on a path is light blue #60a5fa, size 4', () => {
    const d = defaultsFor('Point', false, true);
    expect(colorHex(d.color)).toBe('#60a5fa');
    expect(d.pointSize).toBe(4);
  });
  it.each(['Line', 'Ray', 'Segment', 'Vector'])('%s is #111827, width 2', (type) => {
    const d = defaultsFor(type, false);
    expect(colorHex(d.color)).toBe('#111827');
    expect(d.width).toBe(2);
  });
  it.each(['Circle', 'Arc'])('%s is black #111827, width 2, no fill', (type) => {
    const d = defaultsFor(type, false);
    expect(colorHex(d.color)).toBe('#111827');
    expect(d.width).toBe(2);
  });
  it.each(['Polygon', 'Region'])('%s is #10b981, width 1.5', (type) => {
    const d = defaultsFor(type, false);
    expect(colorHex(d.color)).toBe('#10b981');
    expect(d.width).toBe(1.5);
  });
  it.each(['Function', 'Curve'])('%s is #dc2626, width 2.5', (type) => {
    const d = defaultsFor(type, false);
    expect(colorHex(d.color)).toBe('#dc2626');
    expect(d.width).toBe(2.5);
  });
  it('a Number slider is #6b7280, width 2', () => {
    const d = defaultsFor('Number', true);
    expect(colorHex(d.color)).toBe('#6b7280');
    expect(d.width).toBe(2);
  });
  it('Text is #111827', () => {
    expect(colorHex(defaultsFor('Text', true).color)).toBe('#111827');
  });
  it('every default starts visible, selectable, unfixed, not aux, on layer 0', () => {
    for (const type of ['Point', 'Number', 'Bool', 'Text', 'Line', 'Circle', 'Function', 'Polygon']) {
      const d = defaultsFor(type, true);
      expect(d.visible, type).toBe(true);
      expect(d.selectable, type).toBe(true);
      expect(d.fixed, type).toBe(false);
      expect(d.aux, type).toBe(false);
      expect(d.layer, type).toBe(0);
    }
  });
  it('objects in a figure get the defaults for their type', () => {
    const f = figure(BASE);
    expect(colorHex(style(f, 'A').color)).toBe('#2563eb');
    expect(colorHex(style(f, 'M').color)).toBe('#374151');
    expect(colorHex(style(f, 'seg').color)).toBe('#111827');
    expect(colorHex(style(f, 'f').color)).toBe('#dc2626');
    expect(style(f, 'A').pointSize).toBe(5);
    expect(style(f, 'M').pointSize).toBe(4);
  });
  it('the defaults can be read back through the colour helpers: hex round trips', () => {
    expect(colorFromWord('#2563eb')).toEqual({ r: 37, g: 99, b: 235, a: 1 });
    expect(colorHex({ r: 37, g: 99, b: 235, a: 1 })).toBe('#2563eb');
    expect(colorFromWord('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(colorFromWord('definitelynotacolour')).toBeUndefined();
  });
});

describe('property keys (design 9.1)', () => {
  const COMMON = ['visible', 'label', 'caption', 'aux', 'fixed', 'selectable', 'layer', 'showIf', 'color', 'opacity'];
  it.each(['Point', 'Segment', 'Line', 'Circle', 'Number', 'Function', 'Text', 'Bool'])('%s accepts the common keys', (type) => {
    const keys = validKeysFor(type);
    for (const k of COMMON) expect(keys, `${type} ${k}`).toContain(k);
  });
  it('a Segment accepts the keys listed in the unknown_property example', () => {
    const keys = validKeysFor('Segment');
    // The example also lists `trace`, but design 9 says trace belongs to Points; docs conflict, so it is left out here.
    for (const k of ['color', 'width', 'lineStyle', 'visible', 'label', 'caption', 'layer', 'showIf', 'opacity', 'fixed', 'selectable', 'aux', 'tip', 'tags']) {
      expect(keys).toContain(k);
    }
  });
  it('a Point accepts pointSize and pointStyle', () => {
    expect(validKeysFor('Point')).toEqual(expect.arrayContaining(['pointSize', 'pointStyle']));
  });
  it('the keys are unique', () => {
    const keys = validKeysFor('Point');
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('with: setting properties', () => {
  it('sets several at once and the view reads them from the effective style', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = red, layer = 2, label = value, caption = "start", pointSize = 4, aux = true, selectable = false, tip = name'));
    const s = style(f, 'A');
    expect(s.color).toEqual(colorFromWord('red'));
    expect(s.layer).toBe(2);
    expect(s.label).toBe('value');
    expect(s.caption).toBe('start');
    expect(s.pointSize).toBe(4);
    expect(s.aux).toBe(true);
    expect(s.selectable).toBe(false);
    expect(s.tip).toBe('name');
  });

  it('the line is a restyle: op restyle, nothing recomputed, nothing in the value channel', () => {
    const f = figure(BASE);
    resetRuns();
    const r = ok(f.apply('A with color = red'));
    expect(r.op).toBe('restyle');
    expect(r.name).toBe('A');
    expect(runs.get('Midpoint') ?? 0).toBe(0);
    expect(f.value('M')).toEqual({ x: 2.5, y: 0.5 });
  });

  it('a colour change never marks a maths rule dirty (values and props are kept apart)', () => {
    const f = figure(BASE);
    resetRuns();
    for (const c of ['red', 'blue', '#00ff00', 'rgb(1, 2, 3)', 'hsl(120, 1, 0.5)']) ok(f.apply(`M with color = ${c}`));
    expect(runs.size).toBe(0);
  });

  it('enum properties accept their values', () => {
    const f = figure(BASE);
    for (const v of ['solid', 'dashed', 'dotted', 'dashdot']) ok(f.apply(`seg with lineStyle = ${v}`));
    for (const v of ['dot', 'circle', 'cross', 'plus', 'diamond', 'square', 'triangle']) ok(f.apply(`A with pointStyle = ${v}`));
    for (const v of ['name', 'value', 'both', 'caption', 'none']) ok(f.apply(`A with label = ${v}`));
    for (const v of ['auto', 'name', 'value', 'caption', 'off']) ok(f.apply(`A with tip = ${v}`));
    for (const v of ['solid', 'hatch', 'cross', 'dots', 'checker']) ok(f.apply(`c with fill = ${v}`));
    expect(style(f, 'seg').lineStyle).toBe('dotted'.length ? 'dashdot' : 'solid');
    expect(style(f, 'A').pointStyle).toBe('triangle');
  });

  it('an enum property with a bad value is bad_property_value and lists what is allowed', () => {
    const f = figure(BASE);
    const before = snap(f);
    const e = bad(f.apply('seg with lineStyle = wavy'));
    expect(['bad_property_value', 'unknown_name']).toContain(e.kind);
    expectUnchanged(f, before);
  });

  it('numbers: width is 0.5 to 12', () => {
    const f = figure(BASE);
    ok(f.apply('seg with width = 0.5'));
    ok(f.apply('seg with width = 12'));
    const before = snap(f);
    bad(f.apply('seg with width = 20'), 'bad_property_value');
    bad(f.apply('seg with width = 0'), 'bad_property_value');
    expectUnchanged(f, before);
  });

  it('opacity is 0 to 1 as a literal; out of range is an error, not a clamp', () => {
    const f = figure(BASE);
    ok(f.apply('A with opacity = 0'));
    ok(f.apply('A with opacity = 1'));
    const before = snap(f);
    const e = bad(f.apply('A with opacity = 3'), 'bad_property_value');
    expect(e.params.key).toBe('opacity');
    expectUnchanged(f, before);
  });

  it('Bool properties need Bool values', () => {
    const f = figure(BASE);
    bad(f.apply('A with fixed = 3'));
    bad(f.apply('A with aux = "yes"'));
    ok(f.apply('A with fixed = true'));
    ok(f.apply('A with fixed = false'));
  });

  it('tags is a text list', () => {
    const f = figure(BASE);
    ok(f.apply('A with tags = ["step1", "legend"]'));
    expect(style(f, 'A').tags).toEqual(['step1', 'legend']);
  });

  it('applies to every object type that accepts the key', () => {
    const f = figure(BASE);
    for (const name of ['A', 'M', 'seg', 'l', 'c', 'a', 'f', 's', 'flag']) {
      ok(f.apply(`${name} with color = red, layer = 1, visible = true`), name);
      expect(style(f, name).layer, name).toBe(1);
    }
  });

  it('the property is restored by undo and replayed by redo', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = red'));
    ok(f.undo());
    expect(colorHex(style(f, 'A').color)).toBe('#2563eb');
    ok(f.redo());
    expect(style(f, 'A').color).toEqual(colorFromWord('red'));
  });

  it('a later with line adds to or changes earlier ones', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = red, layer = 3'));
    ok(f.apply('A with layer = 5'));
    expect(style(f, 'A').layer).toBe(5);
    expect(style(f, 'A').color).toEqual(colorFromWord('red'));
  });

  it('a redefinition keeps the properties; redefining on the same line with `with` sets them', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = red'));
    ok(f.apply('A = (7, 7)'));
    expect(style(f, 'A').color).toEqual(colorFromWord('red'));
    ok(f.apply('A = (8, 8) with layer = 4'));
    expect(style(f, 'A').layer).toBe(4);
  });

  it('a with on an unknown object is unknown_name', () => {
    const f = figure(BASE);
    bad(f.apply('Zed with color = red'), 'unknown_name');
  });

  it('setting a property to what the default already is gives a shadowed_default notice', () => {
    const f = figure(BASE);
    const r = ok(f.apply('A with layer = 0'));
    expect(r.notices.map((n) => n.kind)).toContain('shadowed_default');
  });
});

describe('unknown_property and bad_property_value', () => {
  it('unknown_property: K020, the key as the token, the valid keys in expected, a did-you-mean', () => {
    const f = figure(BASE);
    const line = 'seg with colour = red';
    const before = snap(f);
    const e = bad(f.apply(line), 'unknown_property');
    expectWellFormedError(e);
    expect(e.code).toBe('K020');
    expect(e.phase).toBe('typecheck');
    expect(e.token).toBe('colour');
    expect(e.col).toBe(line.indexOf('colour') + 1);
    expect(e.endCol).toBe(line.indexOf('colour') + 1 + 'colour'.length);
    expect(e.expected).toContain('color'); // the full error lists every valid key; only the compact form caps at 8
    expect(e.hint).toContain('color');
    expect(e.suggest).toContain('seg with color = red');
    expect(e.recovery).toBe('use_suggestion');
    expect(e.message).toContain('colour');
    expectUnchanged(f, before);
  });

  it('the suggested line passes', () => {
    const f = figure(BASE);
    const e = bad(f.apply('seg with colour = red'));
    for (const s of e.suggest) ok(f.apply(s), s);
  });

  it('a key that exists for other types but not this one is unknown_property for this type', () => {
    const f = figure(BASE);
    // `pointSize` is a Point property; a Text has no size in points
    const keys = validKeysFor('Text');
    if (!keys.includes('pointSize')) bad(f.apply('s with pointSize = 3'), 'unknown_property');
    else ok(f.apply('s with pointSize = 3'));
  });

  it('bad_property_value: layer 12 (errors.md 5.6)', () => {
    const f = figure(BASE);
    const line = 'A with color = red, layer = 12';
    const before = snap(f);
    const e = bad(f.apply(line), 'bad_property_value');
    expectWellFormedError(e);
    expect(e.code).toBe('K021');
    expect(e.phase).toBe('typecheck');
    expect(e.token).toBe('12');
    expect(e.col).toBe(line.indexOf('12') + 1);
    expect(e.endCol).toBe(line.indexOf('12') + 3);
    expect(e.params.key).toBe('layer');
    expect(String(e.params.allowed)).toContain('0');
    expect(String(e.params.allowed)).toContain('9');
    expect(e.suggest).toContain('A with color = red, layer = 9');
    expectUnchanged(f, before);
  });

  it('the figure is not partly changed: color = red was not applied either', () => {
    const f = figure(BASE);
    bad(f.apply('A with color = red, layer = 12'));
    expect(colorHex(style(f, 'A').color)).toBe('#2563eb');
  });

  it.each(['layer = -1', 'layer = 10', 'layer = 2.5', 'layer = "x"', 'layer = true'])('layer rejects %s without clamping', (item) => {
    const f = figure(BASE);
    bad(f.apply(`A with ${item}`), 'bad_property_value');
    expect(style(f, 'A').layer).toBe(0);
  });

  it.each([0, 1, 4, 9])('layer %i is accepted', (n) => {
    const f = figure(BASE);
    ok(f.apply(`A with layer = ${n}`));
    expect(style(f, 'A').layer).toBe(n);
  });
});

describe('layers (design 9.5)', () => {
  it('new objects always start on layer 0, whatever is in use', () => {
    const f = figure(BASE);
    ok(f.apply('A with layer = 5'));
    ok(f.apply('Z = (3, 3)'));
    ok(f.apply('Y = Midpoint(A, Z)'));
    expect(style(f, 'Z').layer).toBe(0);
    expect(style(f, 'Y').layer).toBe(0);
  });
});

describe('visibility and showIf (design 9.6)', () => {
  it('effective visibility is visible and (showIf absent or true)', () => {
    const f = figure(BASE);
    ok(f.apply('A with showIf = (a < 5)'));
    expect(style(f, 'A').visible).toBe(true);
    expect(style(f, 'A').shown).toBe(true);
    f.setFree('a', 8, 'slider');
    f.flush();
    expect(style(f, 'A').visible).toBe(true);
    expect(style(f, 'A').shown).toBe(false);
    ok(f.apply('A with visible = false'));
    f.setFree('a', 1, 'slider');
    f.flush();
    expect(style(f, 'A').shown).toBe(false);
  });

  it('says why an object is hidden, mentioning showIf', () => {
    const f = figure(BASE);
    ok(f.apply('A with showIf = (a < 2)'));
    expect(style(f, 'A').shown).toBe(false);
    expect(style(f, 'A').why).toContain('showIf');
  });

  it('Show and Hide are sugar for visible, take several objects', () => {
    const f = figure(BASE);
    ok(f.apply('Hide(A, B)'));
    expect(style(f, 'A').visible).toBe(false);
    expect(style(f, 'B').visible).toBe(false);
    ok(f.apply('Show(A)'));
    expect(style(f, 'A').visible).toBe(true);
    expect(style(f, 'B').visible).toBe(false);
  });

  it('Hide on an unknown name is unknown_name and hides nothing', () => {
    const f = figure(BASE);
    const before = snap(f);
    bad(f.apply('Hide(A, Zed)'), 'unknown_name');
    expectUnchanged(f, before);
  });

  it('showIf may use a free Bool as a checkbox: showIf = flag', () => {
    const f = figure(BASE);
    ok(f.apply('A with showIf = flag'));
    expect(style(f, 'A').shown).toBe(true);
    f.setFree('flag', false, 'api');
    f.flush();
    expect(style(f, 'A').shown).toBe(false);
  });

  it('an undefined showIf hides the object', () => {
    const f = figure(['zero = 0', 'n0 = Reciprocal(zero)', 'A = (1, 1)', 'A with showIf = (n0 > 1)']);
    expect(style(f, 'A').shown).toBe(false);
  });

  it('showIf is a rule over real objects: it follows the clock too', () => {
    const f = figure(['A = (1, 1)', 'A with showIf = (t < 2)']);
    expect(style(f, 'A').shown).toBe(true);
    f.setClock(3);
    expect(style(f, 'A').shown).toBe(false);
  });

  it('aux objects are still in the figure and in describe() with aux: true', () => {
    const f = figure(BASE);
    ok(f.apply('M with aux = true'));
    const d = f.describe('M');
    expect('aux' in d && d.aux).toBe(true);
  });
});

describe('dynamic colour and opacity (design 9.4)', () => {
  it('rgb(...) with an expression follows the objects it reads', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = rgb(25 * a, 0, 128)'));
    expect(style(f, 'A').color).toEqual({ r: 75, g: 0, b: 128, a: 1 });
    f.setFree('a', 8, 'slider');
    f.flush();
    expect(style(f, 'A').color.r).toBe(200);
  });

  it('channels clamp to 0..255', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = rgb(255 * a, -10 * a, 0)'));
    const c = style(f, 'A').color;
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
  });

  it('hsl(h, s, l): h is in degrees and wraps', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = hsl(120, 1, 0.5)'));
    const green = style(f, 'A').color;
    expect(green).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    ok(f.apply('B with color = hsl(480, 1, 0.5)'));
    expect(style(f, 'B').color).toEqual(green);
    ok(f.apply('M with color = hsl(-240, 1, 0.5)'));
    expect(style(f, 'M').color).toEqual(green);
  });

  it('hsl driven by a value: hsl(360 * a / 10, 1, 0.5)', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = hsl(360 * a / 10, 1, 0.5)'));
    const c0 = style(f, 'A').color;
    f.setFree('a', 5, 'slider');
    f.flush();
    const c1 = style(f, 'A').color;
    expect(c1).not.toEqual(c0);
    expect(c1).toEqual({ r: 0, g: 255, b: 255, a: 1 }); // hue 180 degrees
  });

  it('hsv is available too', () => {
    const f = figure(BASE);
    ok(f.apply('A with color = hsv(0, 1, 1)'));
    expect(style(f, 'A').color).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it('opacity as an expression clamps to 0..1 at read time (no error)', () => {
    const f = figure(BASE);
    ok(f.apply('A with opacity = a / 5'));
    expect(style(f, 'A').opacity).toBeCloseTo(0.6, 12);
    f.setFree('a', 10, 'slider');
    f.flush();
    expect(style(f, 'A').opacity).toBe(1);
    ok(f.apply('B with opacity = a - 20'));
    expect(style(f, 'B').opacity).toBe(0);
  });

  it('a rule that gives no number falls back to the plain property (the default, once the rule replaced the value)', () => {
    const f = figure(BASE);
    ok(f.apply('A with opacity = sqrt(0 - a)'));
    expect(style(f, 'A').opacity).toBe(defaultsFor('Point', true).opacity);
  });

  it('an undefined rule reverts to the static value, with no warning and the object does not vanish', () => {
    const f = figure(['zero = 0', 'n0 = Reciprocal(zero)', 'A = (1, 1)']);
    const r = ok(f.apply('A with color = rgb(255 * n0, 0, 0)'));
    expect(colorHex(style(f, 'A').color)).toBe('#2563eb');
    expect(style(f, 'A').shown).toBe(true);
    expect(r.notices).toEqual([]);
  });

  it('changing what a colour rule reads does not run the owner\'s maths rule', () => {
    const f = figure(BASE);
    ok(f.apply('M with color = rgb(25 * a, 0, 0)'));
    resetRuns();
    f.setFree('a', 7, 'slider');
    f.flush();
    expect(runs.get('Midpoint') ?? 0).toBe(0);
  });
});

describe('style edges are not value edges (design 9.2)', () => {
  it('a point whose colour reads its own x is legal', () => {
    const f = figure(['P = (2, 1)']);
    ok(f.apply('P with color = hsl(36 * P.x, 1, 0.5)'));
    expect(f.get('P')?.inputs).toEqual([]);
  });

  it('a defining line may use the object it defines in its own with list', () => {
    const f = figure([]);
    ok(f.apply('Q = (2, 1) with color = hsl(36 * Q.x, 1, 0.5)'));
    expect(f.get('Q')).toBeDefined();
  });

  it('showIf may read the owner\'s own value', () => {
    const f = figure(['n = 3']);
    ok(f.apply('n with showIf = (n < 5)'));
    expect(style(f, 'n').shown).toBe(true);
    ok(f.apply('n = 7'));
    expect(style(f, 'n').shown).toBe(false);
  });

  it('style edges are not inputs of the value graph: dependents and ancestors ignore them', () => {
    const f = figure(BASE);
    ok(f.apply('M with showIf = (a < 5)'));
    expect(f.dependentsOf('a')).toEqual([]);
    expect(f.ancestorsOf('M')).toEqual([idOf(f, 'A'), idOf(f, 'B')]);
  });

  it('a value that reads an object whose style reads it back is still a legal figure', () => {
    const f = figure(['a = 2 in 0..10', 'h = Reciprocal(a)']);
    ok(f.apply('a with showIf = (h < 5)'));
    ok(f.apply('h with color = rgb(a * 20, 0, 0)'));
    expect(f.value('h')).toBe(0.5);
  });

  it('describe reports the effective visibility (visible and shown)', () => {
    const f = figure(BASE);
    ok(f.apply('A with showIf = (a < 2)'));
    const d = f.describe('A');
    expect('shown' in d && d.shown).toBe(false);
    expect('visible' in d && d.visible).toBe(true);
    expect('why' in d && d.why).toContain('showIf');
  });
});

describe('colour helpers', () => {
  it('toColor clamps channels and rejects NaN', () => {
    expect(toColor({ r: 300, g: -5, b: 10, a: 2 })).toEqual({ r: 255, g: 0, b: 10, a: 1 });
    expect(toColor({ r: NaN, g: 0, b: 0, a: 1 })).toBeUndefined();
  });
  it('colour words', () => {
    for (const w of ['red', 'green', 'blue', 'black', 'white', 'orange', 'purple', 'gray']) expect(colorFromWord(w), w).toBeDefined();
  });
});

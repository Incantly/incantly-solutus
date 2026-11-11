/**
 * graphics-view/design.md 9 (styles) and ui.md 6 (default look).
 * Colours, dashes, point shapes, fills, opacity, labels, show-if, defaults.
 */
import { describe, expect, it } from 'vitest';
import {
  COLOR_BLIND_SAFE,
  DARK_THEME,
  HIGH_CONTRAST_THEME,
  LIGHT_THEME,
  NAMED_COLORS,
  dashToArray,
  defaultsForKind,
  effectiveVisibility,
  gradientAt,
  isStyleRef,
  parseColor,
  propsForKind,
  renderHatchSpacing,
  resolveStyle,
  rgba,
} from '@incantly/view';
import { errOf, okValue, testStyle } from './helpers';
import type { AuthoredStyle, PaintKind, PointShape, Rgba, StyleEvaluator } from '@incantly/view';

const noRef: StyleEvaluator = () => undefined;
const resolve = (kind: PaintKind, authored: AuthoredStyle, free = true): ReturnType<typeof resolveStyle> =>
  resolveStyle(kind, free, authored, noRef);

describe('design 9.2 colour', () => {
  it('9.2 named script colours match the ui.md map', () => {
    const expected: Record<string, [number, number, number]> = {
      red: [0xd0, 0x3a, 0x2a],
      orange: [0xe8, 0x82, 0x0c],
      green: [0x1f, 0x8a, 0x4c],
      blue: [0x1a, 0x5f, 0xd1],
      purple: [0x7a, 0x3f, 0xd1],
      teal: [0x0f, 0x8f, 0x9a],
      pink: [0xd6, 0x45, 0x8f],
      brown: [0x8a, 0x5a, 0x2b],
      grey: [0x7b, 0x84, 0x91],
      black: [0x11, 0x11, 0x11],
      white: [0xff, 0xff, 0xff],
    };
    for (const [name, [r, g, b]] of Object.entries(expected)) {
      const c = okValue(parseColor(name), name);
      expect([c.r, c.g, c.b, c.a]).toEqual([r, g, b, 1]);
    }
  });

  it('9.2 light/dark forms shift lightness by 20 in hsl', () => {
    const toLightness = (c: Rgba): number => {
      const mx = Math.max(c.r, c.g, c.b) / 255;
      const mn = Math.min(c.r, c.g, c.b) / 255;
      return ((mx + mn) / 2) * 100;
    };
    const base = toLightness(okValue(parseColor('red'), 'red'));
    const spellings = ['lightred', 'light-red', 'light red'];
    const light = spellings.map((s) => parseColor(s)).find((r) => r.ok);
    expect(light?.ok).toBe(true);
    if (light?.ok === true) {
      expect(Math.abs(toLightness(light.value) - base - 20)).toBeLessThan(3);
    }
    const darkSpell = ['darkred', 'dark-red', 'dark red'];
    const dark = darkSpell.map((s) => parseColor(s)).find((r) => r.ok);
    expect(dark?.ok).toBe(true);
    if (dark?.ok === true) {
      expect(Math.abs(toLightness(dark.value) - base + 20)).toBeLessThan(3);
    }
  });

  it('9.2 rgb(), hsl(), hex and alpha literals parse', () => {
    expect(okValue(parseColor('rgb(255, 0, 0)'), 'rgb')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(okValue(parseColor('rgba(255, 0, 0, 0.5)'), 'rgba')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(okValue(parseColor('#1a5fd1'), 'hex')).toEqual({ r: 26, g: 95, b: 209, a: 1 });
    const hsl = okValue(parseColor('hsl(0, 100, 50)'), 'hsl');
    expect([hsl.r, hsl.g, hsl.b]).toEqual([255, 0, 0]);
    const hsla = okValue(parseColor('hsla(120, 100, 25, 0.25)'), 'hsla');
    expect(hsla.a).toBe(0.25);
    expect(hsla.g).toBeGreaterThan(hsla.r);
  });

  it('9.2 unknown colours and out-of-range channels are errors', () => {
    for (const bad of ['notacolor', 'rgb(300, 0, 0)', 'rgb(1, 2)', '#12', '']) {
      const e = errOf(parseColor(bad), bad);
      expect(e.code).toMatch(/^V\d{3}$/);
    }
  });

  it('9.2 NAMED_COLORS exposes the script palette', () => {
    for (const name of ['red', 'orange', 'green', 'blue', 'purple', 'teal', 'pink', 'brown', 'grey', 'black', 'white']) {
      expect(typeof NAMED_COLORS[name]).toBe('string');
    }
  });

  it('9.2 Gradient interpolates in linear light, not naive rgb', () => {
    const black = rgba(0, 0, 0, 1);
    const white = rgba(255, 255, 255, 1);
    expect(gradientAt([black, white], 0)).toEqual(black);
    expect(gradientAt([black, white], 1)).toEqual(white);
    const mid = gradientAt([black, white], 0.5);
    expect(Math.abs(mid.r - 188)).toBeLessThanOrEqual(2);
    expect(mid.r).toBe(mid.g);
    expect(mid.g).toBe(mid.b);
  });

  it('9.2 rgba() defaults alpha to 1', () => {
    expect(rgba(1, 2, 3)).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(rgba(1, 2, 3, 0.5).a).toBe(0.5);
  });
});

describe('design 9.3 line style', () => {
  it('9.3 named dashes scale with width', () => {
    expect(dashToArray('solid', 2)).toEqual([]);
    expect(dashToArray('dashed', 2)).toEqual([8, 6]);
    expect(dashToArray('dotted', 2)).toEqual([2, 4]);
    expect(dashToArray('dashdot', 2)).toEqual([8, 4, 2, 4]);
    expect(dashToArray('dashed', 3)).toEqual([12, 9]);
  });

  it('9.3 dash segments never drop below 1 px', () => {
    for (const v of dashToArray('dotted', 0.5)) expect(v).toBeGreaterThanOrEqual(1);
    for (const v of dashToArray('dashdot', 0.5)) expect(v).toBeGreaterThanOrEqual(1);
  });

  it('9.3 custom {on, off} and array patterns pass through', () => {
    expect(dashToArray({ on: 5, off: 2 }, 2)).toEqual([5, 2]);
    expect(dashToArray([2, 2, 6, 2], 2)).toEqual([2, 2, 6, 2]);
  });
});

describe('design 9.4 point style', () => {
  it('9.4 all twelve point shapes resolve', () => {
    const shapes: PointShape[] = ['dot', 'ring', 'cross', 'plus', 'diamond', 'diamond-open', 'square', 'square-open', 'triangle-up', 'triangle-down', 'triangle-left', 'triangle-right'];
    for (const s of shapes) {
      const r = okValue(resolve('point', { pointStyle: s }), s);
      expect(r.pointStyle).toBe(s);
    }
  });

  it('9.4 point size defaults to radius 4, range 1..20', () => {
    expect(testStyle('point').pointSize).toBe(4);
    expect(okValue(resolve('point', { pointSize: 1 }), 'min').pointSize).toBe(1);
    expect(okValue(resolve('point', { pointSize: 20 }), 'max').pointSize).toBe(20);
    expect(resolve('point', { pointSize: 0 }).ok).toBe(false);
    expect(resolve('point', { pointSize: 21 }).ok).toBe(false);
  });

  it('9.4 free and dependent points differ by default colour', () => {
    const free = defaultsForKind('point', true);
    const dep = defaultsForKind('point', false);
    expect(free.color).toEqual({ r: 26, g: 95, b: 209, a: 1 });
    expect(dep.color).toEqual({ r: 74, g: 79, b: 87, a: 1 });
  });
});

describe('design 9.5 fill and hatching', () => {
  it('9.5 fill defaults: 0.15 for polygons/regions/conics, 0 elsewhere', () => {
    expect(defaultsForKind('region', false).fill).toBe(0.15);
    expect(defaultsForKind('arc', false).fill).toBe(0.15);
    for (const k of ['point', 'line', 'segment', 'vector', 'curve', 'text'] as const) {
      expect(defaultsForKind(k, false).fill).toBe(0);
    }
  });

  it('9.5 hatch specs and none resolve; spacing is checked 2..80', () => {
    const r = okValue(resolve('region', { hatch: { kind: 'lines', angle: 45, spacing: 8 } }), 'hatch');
    expect(r.hatch).toEqual({ kind: 'lines', angle: 45, spacing: 8 });
    expect(okValue(resolve('region', { hatch: 'none' }), 'none').hatch).toBe('none');
    expect(resolve('region', { hatch: { kind: 'lines', angle: 0, spacing: 1 } }).ok).toBe(false);
    expect(resolve('region', { hatch: { kind: 'dots', spacing: 81 } }).ok).toBe(false);
  });

  it('9.5 rendered hatch spacing clamps to the 4..40 px band', () => {
    expect(renderHatchSpacing(2)).toBe(4);
    expect(renderHatchSpacing(8)).toBe(8);
    expect(renderHatchSpacing(80)).toBe(40);
  });
});

describe('design 9.6 opacity', () => {
  it('9.6 opacity defaults to 1 and never changes fill', () => {
    const r = okValue(resolve('region', { opacity: 0.5 }), 'opacity');
    expect(r.opacity).toBe(0.5);
    expect(r.fill).toBe(0.15);
    expect(testStyle('point').opacity).toBe(1);
    expect(testStyle('point').labelOpacity).toBe(1);
    expect(testStyle('point').group).toBeNull();
  });

  it('9.6 opacity and fill reject out-of-range values', () => {
    expect(resolve('point', { opacity: 1.5 }).ok).toBe(false);
    expect(resolve('point', { opacity: -0.1 }).ok).toBe(false);
    expect(resolve('region', { fill: 2 }).ok).toBe(false);
  });

  it('9.6 group opacity is a separate layer value', () => {
    expect(okValue(resolve('region', { group: 0.5 }), 'group').group).toBe(0.5);
  });
});

describe('design 9.7 labels, 9.8 show-if, 9.1 record', () => {
  it('9.7 label default is name for points', () => {
    expect(defaultsForKind('point', false).label).toBe('name');
  });

  it('9.7 label default is name for lines', () => {
    expect(defaultsForKind('line', false).label).toBe('name');
  });

  it('9.7 label default is name for segments', () => {
    expect(defaultsForKind('segment', false).label).toBe('name');
  });

  it('9.7 label default is name for vectors', () => {
    expect(defaultsForKind('vector', false).label).toBe('name');
  });

  it('9.7 label default is name for circles', () => {
    expect(defaultsForKind('arc', false).label).toBe('name');
  });

  it('9.7 label defaults: name for angles, none for regions and curves', () => {
    expect(defaultsForKind('angle', false).label).toBe('name');
    expect(defaultsForKind('region', false).label).toBe('none');
    expect(defaultsForKind('curve', false).label).toBe('none');
  });

  it('9.7 all five label modes resolve; caption and offsets pass through', () => {
    for (const mode of ['none', 'name', 'value', 'name-value', 'caption'] as const) {
      expect(okValue(resolve('point', { label: mode }), mode).label).toBe(mode);
    }
    const r = okValue(resolve('point', { label: 'caption', caption: 'A: {A.x}', labelDx: 6, labelDy: -8 }), 'cap');
    expect(r.caption).toBe('A: {A.x}');
    expect(r.labelDx).toBe(6);
    expect(r.labelDy).toBe(-8);
  });

  it('9.1 widths, marks and enums resolve; bad values fail the line', () => {
    expect(okValue(resolve('line', { width: 2 }), 'w').width).toBe(2);
    expect(resolve('line', { width: 0.4 }).ok).toBe(false);
    expect(resolve('line', { width: 21 }).ok).toBe(false);
    expect(okValue(resolve('segment', { marks: 2 }), 'marks').marks).toBe(2);
    expect(resolve('segment', { marks: 4 }).ok).toBe(false);
    expect(okValue(resolve('angle', { angleStyle: 'square' }), 'sq').angleStyle).toBe('square');
  });

  it('9.1 layers run 0..9 with a hint naming the range', () => {
    expect(okValue(resolve('point', { layer: 3 }), 'layer').layer).toBe(3);
    for (const bad of [10, -1, 2.5]) {
      const e = errOf(resolve('point', { layer: bad }), `layer ${String(bad)}`);
      expect(e.hint ?? '').toContain('0');
      expect(e.hint ?? '').toContain('9');
    }
  });

  it('9.8 show defaults true; Hide sets false; hidden/undefined draw nothing', () => {
    const vis = testStyle('point');
    expect(vis.show).toBe(true);
    expect(effectiveVisibility(vis, true)).toBe(true);
    expect(effectiveVisibility(vis, false)).toBe(false);
    const hidden = okValue(resolve('point', { show: false }), 'hide');
    expect(effectiveVisibility(hidden, true)).toBe(false);
  });

  it('9.1 flags and text styles pass through with checked defaults', () => {
    const r = okValue(
      resolve('point', { fixed: true, selectable: false, trace: true, alt: 'the start', dashPhase: 3, arrow: { at: 'end' } }),
      'flags',
    );
    expect(r.fixed).toBe(true);
    expect(r.selectable).toBe(false);
    expect(r.trace).toBe(true);
    expect(r.alt).toBe('the start');
    expect(r.dashPhase).toBe(3);
    expect(r.arrow?.at).toBe('end');
    expect(testStyle('point').fixed).toBe(false);
    expect(testStyle('point').selectable).toBe(true);
    expect(testStyle('point').textStyle.size).toBe(14);
  });

  it('9.1 a with line is all-or-none: the first bad property fails everything', () => {
    const e = errOf(resolve('line', { width: 40, opacity: 7, layer: 99 }), 'multi-bad');
    expect(e.code).toMatch(/^V\d{3}$/);
  });

  it('9.1 style references evaluate per frame through the kernel handoff', () => {
    const evalRef: StyleEvaluator = (expr) => (expr === 'a' ? 6 : undefined);
    const r = okValue(resolveStyle('line', false, { width: { expr: 'a' } }, noRef), 'literal-check');
    expect(r.width).toBe(2);
    const withRef = okValue(resolveStyle('line', false, { width: { expr: 'a' } }, evalRef), 'ref');
    expect(withRef.width).toBe(6);
    expect(isStyleRef({ expr: 'a' })).toBe(true);
    expect(isStyleRef(5)).toBe(false);
  });

  it('9.1 a reference of the wrong type fails; an empty one keeps the default', () => {
    const wrong: StyleEvaluator = () => 'red';
    expect(resolveStyle('line', false, { width: { expr: 'c' } }, wrong).ok).toBe(false);
    const empty: StyleEvaluator = () => undefined;
    expect(okValue(resolveStyle('line', false, { width: { expr: 'zzz' } }, empty), 'dflt').width).toBe(2);
  });

  it('errors.md pointStyle on a circle is property_not_for_type behaviour', () => {
    const e = errOf(resolve('arc', { pointStyle: 'cross' }), 'misplaced');
    expect(e.code).toMatch(/^V\d{3}$/);
    expect((e.hint ?? e.message).length).toBeGreaterThan(0);
  });

  it('errors.md fill on an open object warns (ok), it does not fail', () => {
    const r = resolve('segment', { fill: 0.5 });
    expect(r.ok).toBe(true);
  });

  it('errors.md propsForKind lists the known properties per type', () => {
    const pointProps = propsForKind('point');
    for (const p of ['color', 'opacity', 'pointStyle', 'pointSize', 'label', 'caption', 'layer', 'show', 'fixed', 'selectable', 'trace', 'alt']) {
      expect(pointProps).toContain(p);
    }
    expect(propsForKind('arc')).not.toContain('pointStyle');
    expect(propsForKind('segment')).toContain('width');
  });
});

describe('ui.md 6 default look', () => {
  it('6 light theme matches the documented hexes', () => {
    const t = LIGHT_THEME;
    expect(t.background).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(t.gridMajor).toEqual({ r: 214, g: 218, b: 224, a: 1 });
    expect(t.gridMinor).toEqual({ r: 236, g: 239, b: 243, a: 1 });
    expect(t.axes).toEqual({ r: 74, g: 82, b: 96, a: 1 });
    expect(t.freePoint).toEqual({ r: 26, g: 95, b: 209, a: 1 });
    expect(t.dependentPoint).toEqual({ r: 74, g: 79, b: 87, a: 1 });
    expect(t.pointOnPath).toEqual({ r: 122, g: 63, b: 209, a: 1 });
    expect(t.stroke).toEqual({ r: 34, g: 40, b: 49, a: 1 });
    expect(t.function).toEqual({ r: 196, g: 54, b: 31, a: 1 });
  });

  it('6 selection, hover and focus colours match', () => {
    expect(LIGHT_THEME.selectionHalo).toEqual({ r: 255, g: 176, b: 0, a: 0.5 });
    expect(LIGHT_THEME.hoverHalo).toEqual({ r: 26, g: 95, b: 209, a: 0.35 });
    expect(LIGHT_THEME.focusRing).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('6 dark theme uses the lighter variants on a dark background', () => {
    expect(DARK_THEME.background).toEqual({ r: 20, g: 22, b: 26, a: 1 });
    expect(DARK_THEME.freePoint).toEqual({ r: 106, g: 163, b: 255, a: 1 });
    expect(DARK_THEME.stroke).toEqual({ r: 230, g: 233, b: 238, a: 1 });
    expect(DARK_THEME.function).toEqual({ r: 255, g: 123, b: 99, a: 1 });
  });

  it('6 high-contrast theme is black on white', () => {
    expect(HIGH_CONTRAST_THEME.background).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(HIGH_CONTRAST_THEME.stroke).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('6 colour-blind-safe palette holds the eight documented colours', () => {
    const hex = (c: Rgba): string =>
      [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const got = new Set(COLOR_BLIND_SAFE.map(hex));
    for (const h of ['0072b2', 'e69f00', '009e73', 'd55e00', 'cc79a7', '56b4e9', 'f0e442', '000000']) {
      expect(got.has(h)).toBe(true);
    }
  });

  it('6 default sizes: point 4, line 2, function 2.5', () => {
    expect(defaultsForKind('point', true).pointSize).toBe(4);
    expect(defaultsForKind('line', false).width).toBe(2);
    expect(defaultsForKind('curve', false).width).toBe(2.5);
  });

  it('9.9 function default colour is function red', () => {
    expect(defaultsForKind('curve', false).color).toEqual({ r: 196, g: 54, b: 31, a: 1 });
  });

  it('9.9 polygon default: dark stroke with blue fill at 0.15', () => {
    expect(defaultsForKind('region', false).color).toEqual({ r: 34, g: 40, b: 49, a: 1 });
    expect(okValue(resolve('region', {}), 'region fill').fillColor).toEqual({ r: 26, g: 95, b: 209, a: 1 });
  });

  it('9.9 angle default: green stroke with 0.25 fill', () => {
    expect(defaultsForKind('angle', false).color).toEqual({ r: 46, g: 139, b: 87, a: 1 });
    expect(defaultsForKind('angle', false).fill).toBe(0.25);
  });
});

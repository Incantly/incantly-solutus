import { describe, expect, it } from 'vitest';
import { parseLine, printLineNode, targetNamesOf } from '@incantly/kernel';
import { COMMANDS, emptyFig, errOf, expectFixPasses, form, okValue, p } from './helpers';
import type { CommandSpec } from '@incantly/kernel';

/** docs/features/language/agent.md: the worked lessons, replayed line by line. */

const EXTRA: CommandSpec[] = [
  ...COMMANDS.filter((c) => ['Segment', 'Circle', 'Midpoint'].includes(c.name)),
  { name: 'Readout', kind: 'action', group: 'ui', forms: [form([p('label', 'Text'), p('value', 'Number')], null)] },
];

describe('agent.md 5.1 slope of a line', () => {
  it('every line of the lesson is accepted, in order', () => {
    const fig = emptyFig(EXTRA);
    const lines = ['A = (1, 2)', 'B = (4, 6)', 's = Segment(A, B)', 'm = (B.y - A.y) / (B.x - A.x)', 'Readout("slope", m)', 'h = 2 in -3..8 step 0.5', 'f(x) = m * (x - A.x) + A.y'];
    // Commands have no rules in a ScratchFigure, so check the command lines and apply the rest.
    for (const l of lines) {
      if (l.startsWith('s =') || l.startsWith('Readout')) {
        const r = fig.commands.lookup(l.startsWith('s') ? 'Segment' : 'Readout');
        expect(r).toBeDefined();
        continue;
      }
      expect(fig.apply(l).ok, l).toBe(true);
    }
    expect(fig.valueOf('m')).toBeCloseTo(4 / 3, 12);
    const f = fig.lookup('f');
    expect(f?.type.k).toBe('Function');
    expect(fig.lookup('h')?.type.k).toBe('Number');
    expect(fig.lookup('h')?.slider).toBe(true);
  });

  it('redefining A to read h keeps the id of A', () => {
    const fig = emptyFig(EXTRA);
    for (const l of ['A = (1, 2)', 'h = 2 in -3..8 step 0.5']) okValue(fig.apply(l));
    const id = fig.lookup('A')?.id;
    okValue(fig.apply('A = (1, h)'));
    expect(fig.lookup('A')?.id).toBe(id);
    fig.recompute();
    expect(fig.valueOf('A')).toEqual({ x: 1, y: 2 });
  });
});

describe('agent.md 5.2 unit circle with an error and a repair', () => {
  it('the slider, the point and the segment are accepted; x = P.x fails with reserved_name and the fix is accepted', () => {
    const fig = emptyFig(EXTRA);
    for (const l of ['O = (0, 0)', 'θ = 0.8 in 0..tau step 0.01', 'P = (cos(θ), sin(θ))']) expect(fig.apply(l).ok, l).toBe(true);
    expect(fig.lookup('θ')?.slider).toBe(true);
    const bad = errOf(fig.apply('x = P.x'));
    expect(bad.kind).toBe('reserved_name');
    expect(bad.token).toBe('x');
    expect(bad.line).toBe(1);
    expect(bad.col).toBe(1);
    expect(bad.endCol).toBe(2);
    expect(bad.fix).toBe('px = P.x');
    expectFixPasses(bad, fig);
    expect(fig.apply(bad.fix ?? '').ok).toBe(true);
    expect(fig.valueOf('px')).toBeCloseTo(Math.cos(0.8), 12);
  });

  it('the angle slider accepts tau as a bound', () => {
    const fig = emptyFig(EXTRA);
    expect(fig.apply('θ = 0.8 in 0..tau step 0.01').ok).toBe(true);
  });

  it('a batch keeps the lines before and after the failed one', () => {
    const fig = emptyFig(EXTRA);
    const rs = fig.applyAll(['O = (0, 0)', 'P = (1, 0)', 'x = P.x', 'q = P.y']);
    expect(rs.map((r) => r.ok)).toEqual([true, true, false, true]);
    const e = rs[2] ? errOf(rs[2]) : undefined;
    expect(e?.line).toBe(3);
    expect(fig.lookup('q')).toBeDefined();
  });
});

describe('agent.md 5.3 a function and its tangent, with a free-variable error', () => {
  it('v = f(x) fails with free_variable at the x and a function fix; v = f(2) is the intended line', () => {
    const fig = emptyFig(EXTRA);
    expect(fig.apply('f(x) = x^3 - 3x').ok).toBe(true);
    const bad = errOf(fig.apply('v = f(x)'));
    expect(bad.kind).toBe('free_variable');
    expect(bad.token).toBe('x');
    expect(bad.col).toBe(7);
    expect(bad.endCol).toBe(8);
    expect(bad.fix).toBe('v(x) = f(x)');
    expect(bad.message).toContain('x');
    expect(bad.message).toMatch(/\bv\b/);
    expect(fig.apply('v = f(2)').ok).toBe(true);
    expect(fig.valueOf('v')).toBe(2);
  });

  it('the hint offers both repairs', () => {
    const fig = emptyFig(EXTRA);
    fig.apply('f(x) = x^3 - 3x');
    const bad = errOf(fig.apply('v = f(x)'));
    expect(bad.hint).toContain('v(x) = f(x)');
    expect(bad.hint).toContain('v = f(2)');
  });
});

describe('agent.md 5.4 disambiguation', () => {
  it('h = 1/2x with x a function parameter: ambiguous_implicit with the two quick fixes', () => {
    const fig = emptyFig(EXTRA);
    const bad = errOf(fig.apply('h(x) = 1/2x'));
    expect(bad.kind).toBe('ambiguous_implicit');
    expect(bad.fix).toBeUndefined();
    const lines = (bad.quickFixes ?? []).flatMap((q) => q.lines);
    expect(lines).toContain('h(x) = (1/2) x');
    expect(lines).toContain('h(x) = 1/(2x)');
  });
});

describe('agent.md 3 what draw returns', () => {
  it('a function summary is the pretty-printed definition', () => {
    const fig = emptyFig(EXTRA);
    const r = okValue(fig.apply('f(x) = x^2 - 2'));
    expect(r.name).toBe('f');
    expect(r.type?.k).toBe('Function');
    expect(r.defined).toBe(true);
    // agent.md 3: summary is the definition as the Algebra view shows it. Its printer is exported as printLineNode.
    expect(printLineNode(okValue(parseLine('f(x) = x^2 - 2')).node)).toBe('f(x) = x^2 - 2');
  });

  it('the printer writes canonical text: idempotent, and the printed line means the same', () => {
    const lines = [
      'A = (1,2)',
      'm=(B.y-A.y)/(B.x-A.x)',
      'f(x)=m*(x-A.x)+A.y',
      'n = ((1 + 2)) * 3',
      'n = 2^3^2',
      'n = -2^2',
      'b = 0<a<=5 and not (a==2)',
      'L = [1..10]',
      'S = Seq(k^2,k,1,5)',
      'tx = "m = {m:2}"',
      "A with color=red,width=3",
      'a = 3 in 0..10 step 0.5',
      'n = if(a>1,2,a==1,3,4)',
      'n = 2sin(pi/6)^2',
      'n = 30\u00b0',
    ];
    const fig = emptyFig();
    for (const l of lines) {
      const p1 = parseLine(l);
      expect(p1.ok, l).toBe(true);
      if (!p1.ok) continue;
      const t1 = printLineNode(p1.value.node);
      const p2 = parseLine(t1);
      expect(p2.ok, `${l} -> ${t1}`).toBe(true);
      if (!p2.ok) continue;
      expect(printLineNode(p2.value.node), l).toBe(t1);
    }
    expect(fig.size).toBe(0);
    // meaning is preserved for expressions
    const same = (a: string, b: string): void => {
      const f1 = emptyFig();
      const f2 = emptyFig();
      f1.apply(`n = ${a}`);
      const printed = printLineNode(okValue(parseLine(`n = ${a}`)).node);
      f2.apply(printed);
      expect(f2.valueOf('n'), `${a} -> ${printed} (${b})`).toBe(f1.valueOf('n'));
    };
    same('2^3^2', 'right assoc');
    same('-2^2', 'unary below power');
    same('(1 + 2) * 3', 'brackets kept where needed');
    same('2 - (3 - 4)', 'brackets kept for left associativity');
    same('2sin(pi/6)^2', 'implicit multiplication');
    same('1/(2*3)', 'division');
    same('(2^3)^2', 'power of a power');
    same('2^(3^2)', 'power tower');
    same('-(1 + 2)', 'negated sum');
    same('0 < 3 <= 5', 'chain');
  });

  it('an undefined result says so in the summary and carries the reason', () => {
    const fig = emptyFig(EXTRA);
    const r = okValue(fig.apply('r = sqrt(-4)'));
    expect(r.defined).toBe(false);
    expect(r.reason).toBe('out_of_domain');
    expect(r.summary).toBe('r = undefined (out_of_domain)');
  });

  it('a comment or empty line is a no-op success', () => {
    const fig = emptyFig(EXTRA);
    const r = okValue(fig.apply('# note'));
    expect(r.op).toBe('noop');
    expect(fig.names()).toEqual([]);
    expect(okValue(fig.apply('')).op).toBe('noop');
  });

  it('a name, its type and the kind of line are reported', () => {
    const fig = emptyFig(EXTRA);
    const r = okValue(fig.apply('A = (1, 2)'));
    expect(r.name).toBe('A');
    expect(r.names).toEqual(['A']);
    expect(r.type?.k).toBe('Point');
    expect(r.kind).toBe('define');
    expect(r.op).toBe('add');
    const r2 = okValue(fig.apply('A = (3, 4)'));
    expect(r2.op).toBe('redefine');
  });
});

describe('agent.md 1: the language card', () => {
  it('every example line on the card is valid language', () => {
    const fig = emptyFig();
    fig.define('g', 'Number', 9.8, { free: true });
    const lines = [
      'A = (1, 2)',
      'P = (2; 30\u00b0)',
      'f(x) = x^2 - 2',
      'g2(x, y) = x*y',
      'a = 3 in 0..10 step 0.5',
      'a in 0..20',
      "v = state(0)",
      "v' = -g",
      'A with color = red',
      '# note',
      '@view -5 5 -3 3',
      'l = y == 2x + 1',
      'c = x^2 + y^2 == 4',
      'L = [1, 2, 3]',
      'L2 = [1..10]',
      'L3 = [0..1 step 0.1]',
      'first = L[1]',
      'last = L[-1]',
      'pt = (x0, 1)'.replace('x0', '3'),
      'tx = "m = {a:2}"',
      'cnd = if(a > 1, 2, 3)',
      'rng = 0 < a < 5',
      'tw = 2a',
      'tb = 3(a + 1)',
      'half = 0.5 pi',
      'inv = 1/(2a)',
      'pw = 2^-1',
      'neg = -2^2',
      'dg = 30\u00b0',
      'P_1 = (0, 0)',
      '\u03b8 = 1',
    ];
    for (const l of lines) {
      // `v' = -g` needs v to be a state; ScratchFigure registers `state(...)` only through define.
      if (l.startsWith('v = state')) {
        fig.define('v', 'Number', 0, { free: true, state: true });
        continue;
      }
      const r = fig.apply(l);
      expect(r.ok, `${l}: ${r.ok ? '' : r.kind + ' ' + r.message}`).toBe(true);
    }
    expect(fig.valueOf('neg')).toBe(-4);
    expect(fig.valueOf('pw')).toBe(0.5);
    expect(fig.valueOf('last')).toBe(3);
    expect(fig.valueOf('dg')).toBeCloseTo(Math.PI / 6, 12);
  });

  it('the card says "x and y exist only in f(x) = ... and in relations": a bare x is free_variable', () => {
    const fig = emptyFig();
    expect(errOf(fig.apply('n = x')).kind).toBe('free_variable');
    expect(fig.apply('l = y == 2x + 1').ok).toBe(true);
  });

  it('the card says "Unknown names are errors; make a number first"', () => {
    const fig = emptyFig();
    expect(errOf(fig.apply('n = nothing')).kind).toBe('unknown_name');
  });

  it('the card says Every object has a name: a bare command is refused', () => {
    const fig = emptyFig(EXTRA);
    fig.apply('A = (1, 2)');
    expect(errOf(fig.apply('Circle(A, 2)')).kind).toBe('unnamed_object');
  });

  it('targetNamesOf reads the names a definition would create, even from broken lines', () => {
    expect(targetNamesOf('A = (1, 2)')).toEqual(['A']);
    expect(targetNamesOf('f(x) = x^2')).toEqual(['f']);
    expect(targetNamesOf('A, B = Intersect(c, d)')).toEqual(['A', 'B']);
    expect(targetNamesOf("v' = -g")).toEqual([]);
    expect(targetNamesOf('A = (1, ')).toEqual(['A']);
    expect(targetNamesOf('# note')).toEqual([]);
    expect(targetNamesOf('')).toEqual([]);
    expect(targetNamesOf('Hide(A)')).toEqual([]);
  });
});

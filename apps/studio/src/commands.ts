/**
 * A few stand-in commands so the studio has something to run. The geometry area supplies the real command table and the
 * studio will take it from the SDK; until then these give the kernel real rules, so values, undefined reasons and the cause
 * chain can all be seen. They are not the geometry area's commands and carry none of its tolerances or edge cases.
 */
import type { CommandRule, CommandSpec, ParamSpec, RuleCall } from '@incantly/kernel';

interface P2 {
  readonly x: number;
  readonly y: number;
}
interface L3 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

interface FormDef {
  readonly params: ParamSpec[];
  readonly returns: string;
  readonly summary: string;
  readonly rule: CommandRule;
  readonly explain?: string;
}

const p = (name: string, type: string): ParamSpec => ({ name, type });
const pt = (call: RuleCall, i: number): P2 => call.values[i] as P2;
const dist = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.y - b.y);

function command(name: string, forms: readonly FormDef[]): CommandSpec {
  return {
    name,
    kind: 'object',
    group: 'geometry',
    forms: forms.map((f) => ({ params: f.params, returns: f.returns, summary: f.summary, rule: () => f.rule, ...(f.explain ? { explain: f.explain } : {}) })),
  };
}

export const STUDIO_COMMANDS: readonly CommandSpec[] = [
  command('Midpoint', [
    {
      params: [p('a', 'Point'), p('b', 'Point')],
      returns: 'Point',
      summary: 'midpoint of two points',
      explain: '{name} is the midpoint of {0} and {1}',
      rule: {
        run: (c) => ({ x: (pt(c, 0).x + pt(c, 1).x) / 2, y: (pt(c, 0).y + pt(c, 1).y) / 2 }),
        // dragging the midpoint moves the first point so that the midpoint lands on the target
        invert: (target, c) => {
          const t = target as P2;
          const b = c.values[1] as P2;
          return [{ param: 0, value: { x: 2 * t.x - b.x, y: 2 * t.y - b.y } }];
        },
      },
    },
  ]),
  command('Distance', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Number', summary: 'distance between two points', rule: { run: (c) => dist(pt(c, 0), pt(c, 1)) } },
  ]),
  command('Segment', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Segment', summary: 'segment between two points', rule: { run: (c) => ({ a: pt(c, 0), b: pt(c, 1) }) } },
  ]),
  command('Circle', [
    {
      params: [p('center', 'Point'), p('radius', 'Number')],
      returns: 'Circle',
      summary: 'circle by centre and radius',
      rule: {
        run: (c) => {
          const r = c.values[1] as number;
          return r > 0 ? { cx: pt(c, 0).x, cy: pt(c, 0).y, r } : c.fail('degenerate', 'the radius must be positive');
        },
      },
    },
    {
      params: [p('center', 'Point'), p('through', 'Point')],
      returns: 'Circle',
      summary: 'circle through a point',
      rule: {
        run: (c) => {
          const r = dist(pt(c, 0), pt(c, 1));
          return r > 0 ? { cx: pt(c, 0).x, cy: pt(c, 0).y, r } : c.fail('degenerate', 'the two points are the same');
        },
      },
    },
  ]),
  command('Line', [
    {
      params: [p('a', 'Point'), p('b', 'Point')],
      returns: 'Line',
      summary: 'line through two points',
      rule: {
        run: (c) => {
          const a = pt(c, 0);
          const b = pt(c, 1);
          if (a.x === b.x && a.y === b.y) return c.fail('degenerate', 'the two points are the same');
          return { a: b.y - a.y, b: a.x - b.x, c: (b.y - a.y) * a.x + (a.x - b.x) * a.y };
        },
      },
    },
  ]),
  command('Intersect', [
    {
      params: [p('l', 'Line'), p('m', 'Line')],
      returns: 'Point',
      summary: 'crossing point of two lines',
      rule: {
        run: (c) => {
          const l = c.values[0] as L3;
          const m = c.values[1] as L3;
          const det = l.a * m.b - m.a * l.b;
          if (Math.abs(det) < 1e-12) {
            const same = Math.abs(l.a * m.c - m.a * l.c) < 1e-9 && Math.abs(l.b * m.c - m.b * l.c) < 1e-9;
            return c.fail(same ? 'coincident' : 'parallel');
          }
          return { x: (l.c * m.b - m.c * l.b) / det, y: (l.a * m.c - m.a * l.c) / det };
        },
      },
    },
  ]),
];

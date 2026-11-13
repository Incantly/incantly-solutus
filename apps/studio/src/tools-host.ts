/**
 * The tool engine's view of the figure (tools-2d design 5): object types, the parameter of a point on a path, where two
 * objects cross, typed numbers and free names. Questions that need a computation run on a scratch copy of the figure,
 * built once per host, so the figure itself never changes until the tool commits.
 */
import { Figure } from '@incantly/kernel';
import type { CommandRegistry } from '@incantly/kernel';
import type { ToolHost, ToolPt } from '@incantly/ui';

const isPt = (v: unknown): v is ToolPt => typeof v === 'object' && v !== null && typeof (v as ToolPt).x === 'number' && typeof (v as ToolPt).y === 'number';

/**
 * A host for one tool step. `slack` is how far, in maths units, a crossing may be from the click and still count
 * (about 12 pixels).
 */
export function figureHost(figure: Figure, registry: CommandRegistry, slack = 0.5): ToolHost {
  let scratch: Figure | undefined;
  let k = 0;
  const copy = (): Figure => (scratch ??= Figure.fromScript(figure.toScript(), { commands: registry }).figure);
  /** Applies `expr` under a fresh temporary name on the scratch copy and returns its value. */
  const tryValue = (expr: string): { ok: true; value: unknown; name: string } | { ok: false; message: string; hint?: string } => {
    const name = `toolTmp${++k}`;
    const r = copy().apply(`${name} = ${expr}`);
    if (!r.ok) return { ok: false, message: r.message, ...(r.hint ? { hint: r.hint } : {}) };
    const c = copy().cellOf(name);
    return c?.defined ? { ok: true, value: c.value, name } : { ok: false, message: `undefined: ${c && !c.defined ? c.reason.replace(/_/g, ' ') : ''}` };
  };
  const straight = (n: string): boolean => ['Line', 'Segment', 'Ray'].includes(figure.get(n)?.type ?? '');
  const count = new Map<string, number>();

  const host: ToolHost = {
    typeOf(name) {
      const o = figure.get(name);
      return o ? (o.type === 'List' ? o.typeText : o.type) : undefined;
    },
    paramOn(path, at) {
      const r = tryValue(`PointOn(${path}, 0.5)`);
      if (!r.ok) return undefined;
      const plan = copy().dragPlan(r.name, { x: at.x, y: at.y });
      const w = plan.writes.find((x) => x.param !== undefined);
      return w && typeof w.value === 'number' ? w.value : undefined;
    },
    nearestIntersection(a, b, at) {
      if (straight(a) && straight(b)) {
        const r = tryValue(`Intersect(${a}, ${b})`);
        if (!r.ok || !isPt(r.value)) return undefined;
        return Math.hypot(r.value.x - at.x, r.value.y - at.y) <= slack ? { index: undefined, at: r.value } : undefined;
      }
      const n = host.intersections(a, b);
      let best: { index: number; at: ToolPt; d: number } | undefined;
      for (let i = 1; i <= Math.min(n, 4); i++) {
        const r = tryValue(`Intersect(${a}, ${b}, ${i})`);
        if (!r.ok || !isPt(r.value)) continue;
        const d = Math.hypot(r.value.x - at.x, r.value.y - at.y);
        if (!best || d < best.d) best = { index: i, at: r.value, d };
      }
      return best && best.d <= slack ? { index: best.index, at: best.at } : undefined;
    },
    intersections(a, b) {
      const key = `${a}|${b}`;
      const hit = count.get(key);
      if (hit !== undefined) return hit;
      let n = 0;
      if (straight(a) && straight(b)) {
        const r = tryValue(`Intersect(${a}, ${b})`);
        n = r.ok && isPt(r.value) ? 1 : 0;
      } else {
        // the indexed form is defined for each crossing that exists; the plain form may be undefined for a tangent pair
        for (let i = 1; i <= 4; i++) {
          const r = tryValue(`Intersect(${a}, ${b}, ${i})`);
          if (r.ok && isPt(r.value)) n = i;
        }
      }
      count.set(key, n);
      return n;
    },
    checkNumber(text) {
      const r = tryValue(`(${text})`);
      if (!r.ok) return { ok: false, message: r.message, ...(r.hint ? { hint: r.hint } : {}) };
      return typeof r.value === 'number' && Number.isFinite(r.value) ? { ok: true, value: r.value } : { ok: false, message: `${text} is not a number.`, hint: 'Type a number, such as 3, 2*r or 40°.' };
    },
    nameFree(name) {
      if (figure.get(name)) return false;
      return figure.apply(`${name} = 0`, { dryRun: true }).ok;
    },
  };
  return host;
}

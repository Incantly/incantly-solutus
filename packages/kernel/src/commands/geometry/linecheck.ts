/**
 * Line-time checks of the geometry area (points-lines 8): `Locus(Q, P)` whose traced point does not depend on the
 * moving point is refused with `no_dependency`, and the hint says when the two are the wrong way round.
 */
import type { ErrorObject } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import type { ParsedLine } from '../../language/ast';
import type { CheckedLine } from '../../language/check';
import type { TNode } from '../../language/tnode';
import { err } from '../../errors/table';
import type { LineRewrite } from '../../graph/registry';
import { numberSource } from '../../graph/values';

/** True when `from` reads `to`, directly or through other objects. */
function dependsOn(figure: Figure, from: ObjId, to: ObjId): boolean {
  const seen = new Set<ObjId>();
  const stack: ObjId[] = [from];
  while (stack.length > 0) {
    const id = stack.pop() as ObjId;
    for (const i of figure.view.inputsOf(id)) {
      if (i === to) return true;
      if (!seen.has(i)) {
        seen.add(i);
        stack.push(i);
      }
    }
  }
  return false;
}

export function geometryLineCheck(host: unknown, line: CheckedLine, _parsed: ParsedLine): ErrorObject | undefined {
  const figure = host as Figure;
  const e = line.expr as TNode | undefined;
  if (!e || e.n !== 'command' || e.spec.name !== 'Locus' || e.args.length !== 2) return undefined;
  const q = e.args[0]?.expr;
  const m = e.args[1]?.expr;
  if (q?.n !== 'ref' || m?.n !== 'ref' || q.ty.k !== 'Point' || m.ty.k !== 'Point') return undefined;
  if (dependsOn(figure, q.id, m.id)) return undefined;
  const swapped = dependsOn(figure, m.id, q.id);
  const at = { line: line.line, col: q.s + 1, endCol: m.e + 1 };
  const why = `${q.name} does not depend on ${m.name}, so its locus would be a single point.`;
  return err('no_dependency', at, { command: 'Locus', why }, {
    token: `${q.name}, ${m.name}`,
    hint: swapped ? `The traced point comes first: Locus(${m.name}, ${q.name}).` : `Trace a point built from ${m.name}, such as Midpoint(${m.name}, ...).`,
    ...(swapped ? { suggest: [`Locus(${m.name}, ${q.name})`] } : {}),
    fingerprintKey: 'Locus',
  });
}

const NAME = '[A-Za-z\\u0370-\\u03FF][A-Za-z0-9_\\u0370-\\u03FF]*';
const RIGID_POINTS = new RegExp(`^(\\s*${NAME}\\s*=\\s*Rigid\\()\\s*(${NAME}(?:\\s*,\\s*${NAME}){2,})\\s*(\\).*)$`, 's');

/**
 * `R = Rigid(A, B, C)` takes the points where they are now and then no longer depends on them (polygons-transforms 5):
 * the names are replaced by their current coordinates before the line is read.
 */
export function geometryLineRewrite(host: unknown, text: string): LineRewrite | undefined {
  const conic = conicWithoutEquation(text);
  if (conic) return { error: conic };
  const m = RIGID_POINTS.exec(text);
  if (!m) return undefined;
  const figure = host as Figure;
  const coords: string[] = [];
  for (const name of (m[2] as string).split(',').map((s) => s.trim())) {
    const o = figure.get(name);
    if (!o || o.type !== 'Point') return undefined;
    const v = figure.value(o.id) as { x?: unknown; y?: unknown } | undefined;
    if (typeof v?.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return undefined;
    coords.push(`(${numberSource(v.x)}, ${numberSource(v.y)})`);
  }
  return { text: `${m[1] as string}${coords.join(', ')}${m[3] as string}` };
}

const CONIC_ONE_ARG = new RegExp(`^\\s*(?:${NAME}\\s*=\\s*)?Conic\\((.*)\\)\\s*$`, 's');

/**
 * `Conic(x^2 + y^2)`: an expression in x and y with no `==` is `bad_equation` (conics errors). The language would call
 * the x a free variable first, which says less, so the area reads the line before it does. A single `=` is left to the
 * language (`assign_in_expr`, ruling Q9).
 */
function conicWithoutEquation(text: string): ErrorObject | undefined {
  const m = CONIC_ONE_ARG.exec(text);
  const inner = m?.[1];
  if (inner === undefined || inner.includes('=') || inner.includes('<') || inner.includes('>')) return undefined;
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) return undefined;
  }
  if (!/\b[xy]\b/.test(inner)) return undefined;
  const at = text.indexOf(inner);
  const expr = inner.trim();
  return err('bad_equation', { line: 1, col: at + 1, endCol: at + inner.length + 1 }, { command: 'Conic', why: 'Conic needs an equation, written with ==.' }, {
    token: expr,
    hint: `${expr} has no ==. Write both sides, for example ${expr} == 1.`,
    suggest: [text.replace(inner, `${expr} == 1`)],
    fingerprintKey: 'Conic',
  });
}

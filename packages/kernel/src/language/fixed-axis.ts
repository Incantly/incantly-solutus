/**
 * Direction fixed by the text of a line-like argument (geometry-reflect R4).
 * Structural only: a bare name, a value and a defining line are never consulted.
 */
import type { TArg, TNode } from './tnode';

export type FixedAxis = 'vertical' | 'horizontal';

/** `vertical` is `x = c`, `horizontal` is `y = c`. `undefined` when the text does not fix it. */
export function fixedAxisOf(node: TNode): FixedAxis | undefined {
  if (node.n === 'ref') return undefined;
  if (node.n === 'const') {
    if (node.name === 'yaxis') return 'vertical';
    if (node.name === 'xaxis') return 'horizontal';
    return undefined;
  }
  if (node.n === 'relation') return relationAxis(node);
  if (node.n === 'command') return commandAxis(node);
  return undefined;
}

function isZeroNumber(n: TNode): boolean {
  return n.n === 'num' && n.v === 0;
}

/** A line equation: `y` coefficient the number 0 and `x` not, or the swap. `x + y == 1` is neither. */
function relationAxis(node: TNode & { n: 'relation' }): FixedAxis | undefined {
  if (node.shape !== 'line' || node.poly === undefined) return undefined;
  const xZero = isZeroNumber(node.poly.x);
  const yZero = isZeroNumber(node.poly.y);
  if (yZero && !xZero) return 'vertical';
  if (xZero && !yZero) return 'horizontal';
  return undefined;
}

/**
 * `Line`, `Segment` or `Ray` through two points, or `Line` of a line equation.
 * A point-and-vector line and a parallel copy are not a fixed axis.
 */
function commandAxis(node: TNode & { n: 'command' }): FixedAxis | undefined {
  const name = node.spec.name;
  if (name !== 'Line' && name !== 'Segment' && name !== 'Ray') return undefined;
  const params = node.form.params;
  const first = params[0];
  const second = params[1];
  if (name === 'Line' && params.length === 1 && first?.type === 'Relation') {
    const eq = node.args[0]?.expr;
    if (eq === undefined || eq.n !== 'relation') return undefined;
    return relationAxis(eq);
  }
  if (params.length !== 2 || first?.type !== 'Point' || second?.type !== 'Point') return undefined;
  const a = node.args[0]?.expr;
  const b = node.args[1]?.expr;
  if (a === undefined || b === undefined || a.n !== 'point' || b.n !== 'point') return undefined;
  const xSame = sameTree(a.x, b.x);
  const ySame = sameTree(a.y, b.y);
  if (xSame && !ySame) return 'vertical';
  if (ySame && !xSame) return 'horizontal';
  return undefined;
}

/** Same shape, literals, names and object ids. Source positions are not part of the text. */
export function sameTree(a: TNode, b: TNode): boolean {
  if (a.n !== b.n || a.unit !== b.unit) return false;
  switch (a.n) {
    case 'num':
      return b.n === 'num' && a.v === b.v;
    case 'bool':
      return b.n === 'bool' && a.v === b.v;
    case 'undef':
      return true;
    case 'const':
      return b.n === 'const' && a.name === b.name;
    case 'clock':
      return b.n === 'clock' && a.which === b.which;
    case 'ref':
      return b.n === 'ref' && a.id === b.id && a.name === b.name;
    case 'local':
      return b.n === 'local' && a.slot === b.slot && a.name === b.name;
    case 'unary':
      return b.n === 'unary' && a.op === b.op && sameTree(a.arg, b.arg);
    case 'bin':
      return b.n === 'bin' && a.op === b.op && a.variant === b.variant && sameTree(a.l, b.l) && sameTree(a.r, b.r);
    case 'fact':
      return b.n === 'fact' && sameTree(a.arg, b.arg);
    case 'callObj':
      return b.n === 'callObj' && a.id === b.id && a.name === b.name && sameNodes(a.args, b.args);
    case 'builtin':
      return b.n === 'builtin' && a.spec.name === b.spec.name && sameNodes(a.args, b.args);
    case 'command':
      return b.n === 'command' && a.spec.name === b.spec.name && a.form === b.form && sameArgs(a.args, b.args);
    case 'index':
      return b.n === 'index' && sameTree(a.target, b.target) && sameTree(a.index, b.index);
    case 'field':
      return b.n === 'field' && a.field === b.field && sameTree(a.target, b.target) && sameNodes(a.args, b.args);
    case 'point':
      return b.n === 'point' && sameTree(a.x, b.x) && sameTree(a.y, b.y);
    case 'tuple':
      return b.n === 'tuple' && sameNodes(a.items, b.items);
    case 'polar':
      return b.n === 'polar' && sameTree(a.r, b.r) && sameTree(a.a, b.a);
    case 'list':
      return b.n === 'list' && sameNodes(a.items, b.items);
    case 'range':
      return b.n === 'range' && sameTree(a.from, b.from) && sameTree(a.to, b.to) && sameOpt(a.step, b.step);
    default:
      return false;
  }
}

function sameOpt(a: TNode | undefined, b: TNode | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameTree(a, b);
}

function sameNodes(a: readonly TNode[] | undefined, b: readonly TNode[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || !sameTree(x, y)) return false;
  }
  return true;
}

function sameArgs(a: readonly TArg[], b: readonly TArg[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined || x.omitted !== y.omitted) return false;
    if (!sameOpt(x.expr, y.expr)) return false;
  }
  return true;
}

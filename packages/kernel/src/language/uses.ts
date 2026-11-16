/**
 * What a checked line uses (app-modes design 3.1, 7): the commands with their group, the built-in functions and the
 * operators, and whether it is an equation, a text, a list or a state. A host's mode policy reads this; the kernel
 * itself decides nothing from it.
 */
import type { CheckedLine } from './check';
import type { RelTree, TNode } from './tnode';
import { formGroup } from '../graph/registry';

export interface UsedName {
  readonly name: string;
  /** 0-based start and end of the name in the line's canonical text. */
  readonly s: number;
  readonly e: number;
}

export interface LineUses {
  readonly commands: readonly (UsedName & { readonly group: string })[];
  readonly functions: readonly (UsedName & { readonly group: string })[];
  readonly operators: readonly UsedName[];
  /** An implicit equation or inequality in x and y (`x^2 + y^2 == 4`). */
  readonly equation: boolean;
  readonly text: boolean;
  readonly list: boolean;
  /** A `state(...)` line or a rate line. */
  readonly state: boolean;
}

export function lineUses(line: CheckedLine): LineUses {
  const commands: (UsedName & { group: string })[] = [];
  const functions: (UsedName & { group: string })[] = [];
  const operators: UsedName[] = [];
  let equation = false;
  let text = false;
  let list = false;
  const seen = new Set<unknown>();
  const rel = (t: RelTree): void => {
    if (t.t === 'cmp') t.operands.forEach(walk);
    else if (t.t === 'not') rel(t.a);
    else {
      rel(t.l);
      rel(t.r);
    }
  };
  function walk(n: TNode | undefined): void {
    if (!n || seen.has(n)) return;
    seen.add(n);
    if (n.ty?.k === 'Text') text = true;
    if (n.ty?.k === 'List') list = true;
    switch (n.n) {
      case 'command':
        commands.push({ name: n.spec.name, group: formGroup(n.form) ?? n.spec.group, s: n.s, e: n.e });
        for (const a of n.args) walk(a.expr);
        return;
      case 'builtin':
        functions.push({ name: n.spec.name, group: n.spec.group, s: n.s, e: n.e });
        n.args.forEach(walk);
        return;
      case 'bin':
        operators.push({ name: n.op, s: n.s, e: n.e });
        walk(n.l);
        walk(n.r);
        return;
      case 'unary':
        if (n.op !== '+') operators.push({ name: n.op, s: n.s, e: n.e });
        walk(n.arg);
        return;
      case 'cmp':
        for (const op of n.ops) operators.push({ name: op, s: n.s, e: n.e });
        n.operands.forEach(walk);
        return;
      case 'fact':
        operators.push({ name: '!', s: n.s, e: n.e });
        walk(n.arg);
        return;
      case 'relation':
        equation = true;
        rel(n.tree);
        return;
      case 'lambda':
        walk(n.body);
        return;
      case 'callObj':
        n.args.forEach(walk);
        return;
      case 'tick':
        walk(n.arg);
        return;
      case 'index':
        walk(n.target);
        walk(n.index);
        return;
      case 'field':
        walk(n.target);
        n.args?.forEach(walk);
        return;
      case 'point':
        walk(n.x);
        walk(n.y);
        return;
      case 'polar':
        walk(n.r);
        walk(n.a);
        return;
      case 'list':
        list = true;
        n.items.forEach(walk);
        return;
      case 'range':
        walk(n.from);
        walk(n.to);
        walk(n.step);
        return;
      case 'cond':
        for (const a of n.arms) {
          walk(a.c);
          walk(a.v);
        }
        walk(n.otherwise);
        return;
      case 'text':
        text = true;
        for (const p of n.parts) if (typeof p !== 'string') walk(p.e);
        return;
      default:
        return;
    }
  }
  walk(line.expr);
  if (line.state) {
    walk(line.state.initial);
    walk(line.state.velocity);
  }
  if (line.range) {
    walk(line.range.from);
    walk(line.range.to);
    walk(line.range.step);
  }
  return { commands, functions, operators, equation, text, list, state: line.isState || line.kind === 'rate' };
}

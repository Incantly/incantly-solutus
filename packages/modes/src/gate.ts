/**
 * The line gate (app-modes design 3.1, 3.7; errors 1): a function the figure asks about each new line. It refuses a line
 * that uses something the mode, a restriction or an exam switches off, with `mode_forbids`. Lines already in the figure
 * are never checked again, so existing objects keep working.
 */
import { err, formGroup } from '@incantly/kernel';
import type { ErrorObject, GateCall, LineGate, UsedName } from '@incantly/kernel';
import { allowedInstead } from './policy';
import type { CommandRef, CompiledPolicy } from './policy';
import type { AppModeId, ExamProfileId } from './types';

export type ForbidReason = 'mode' | 'restriction' | 'exam';

/** One layer of narrowing: the mode itself, then a teacher's restriction, then an exam. Each layer is narrower. */
export interface GateLayer {
  readonly policy: CompiledPolicy;
  readonly reason: ForbidReason;
  readonly examProfile?: ExamProfileId;
}

export interface GateOptions {
  /** Base mode first; the last layer is the one in force. */
  readonly layers: readonly GateLayer[];
  /** The command table, for `allowedInstead`. */
  readonly catalogue: readonly CommandRef[];
  /** Directives that are locked (exam), refused with reason `exam`. */
  readonly lockedDirectives?: readonly string[];
}

/** The `mode_forbids` error object, with the fields of errors 1. */
export type ModeForbidsError = ErrorObject & {
  readonly mode: AppModeId;
  readonly reason: ForbidReason;
  readonly examProfile?: ExamProfileId;
  readonly command?: string;
  readonly function?: string;
  readonly operator?: string;
  readonly allowedInstead: readonly string[];
};

export function makeGate(opts: GateOptions): LineGate {
  const top = opts.layers[opts.layers.length - 1];
  if (!top) return () => undefined;
  const modeId = top.policy.mode.derivedFrom ?? top.policy.mode.id;
  const locked = new Set(opts.lockedDirectives ?? []);

  // the first layer that refuses names the reason: the mode itself, a restriction, or the exam
  const whoForbids = (ok: (p: CompiledPolicy) => boolean): GateLayer | undefined => {
    for (const l of opts.layers) if (!ok(l.policy)) return l;
    return undefined;
  };

  const where = (l: GateLayer): string =>
    l.reason === 'exam' ? `exam profile '${l.examProfile ?? 'custom'}' (mode: ${modeId})` : l.reason === 'restriction' ? `this ${modeId} setup` : `the ${modeId} mode`;

  const forbid = (call: GateCall, l: GateLayer, what: { command?: string; function?: string; operator?: string; label: string }, at: UsedName | undefined, alt: readonly string[]): ModeForbidsError => {
    const span = at ? { line: call.line.line, col: at.s + 1, endCol: Math.max(at.s + 2, at.e + 1) } : { line: call.line.line, col: 1, endCol: 1 };
    const why = `${what.label} is not available in ${where(l)}.`;
    const tail = alt.length > 0 ? ` ${joinOr(alt)} ${alt.length === 1 ? 'is' : 'are'} available.` : '';
    const hint = (l.reason === 'exam' ? 'This test does not allow it.' : l.reason === 'restriction' ? 'Your teacher turned it off here.' : 'This app leaves it out.') + tail;
    const e = err('mode_forbids', span, { why }, { token: what.command ?? what.function ?? what.operator ?? what.label, hint, recovery: 'rewrite', fingerprintKey: `${l.reason}:${what.label}` });
    return {
      ...e,
      mode: modeId,
      reason: l.reason,
      ...(l.examProfile ? { examProfile: l.examProfile } : {}),
      ...(what.command ? { command: what.command } : {}),
      ...(what.function ? { function: what.function } : {}),
      ...(what.operator ? { operator: what.operator } : {}),
      allowedInstead: alt,
    };
  };

  return (call) => {
    const { uses, line } = call;
    if (line.kind === 'directive') {
      const name = line.directive?.name ?? '';
      if (locked.has(name)) {
        const exam = opts.layers.find((l) => l.reason === 'exam') ?? top;
        return forbid(call, exam, { label: `@${name}` }, undefined, []);
      }
      return undefined;
    }
    for (const c of uses.commands) {
      const l = whoForbids((p) => p.command(c.name, c.group));
      if (l) return forbid(call, l, { command: c.name, label: c.name }, c, allowedInstead(top.policy, c, opts.catalogue));
      const rule = top.policy.mode.commands.argumentRules?.find((r) => r.command === c.name);
      if (rule) {
        const first = findCommand(line.expr, c)?.args[0]?.expr as { n?: string; ty?: { k?: string } } | undefined;
        if (first && !(first.n === 'ref' && first.ty?.k === 'Function')) {
          const span = { line: line.line, col: c.s + 1, endCol: c.e + 1 };
          return err('no_matching_form', span, { command: c.name, given: 'an expression' }, { token: c.name, forms: [`${c.name}(f)`], hint: rule.hint, recovery: 'choose_form', fingerprintKey: `rule:${c.name}` });
        }
      }
    }
    for (const f of uses.functions) {
      const l = whoForbids((p) => p.fn(f.name));
      if (l) return forbid(call, l, { function: f.name, label: f.name }, f, []);
    }
    for (const o of uses.operators) {
      const l = whoForbids((p) => p.operator(o.name));
      if (l) return forbid(call, l, { operator: o.name, label: `The operator ${o.name}` }, o, []);
    }
    const kinds: [boolean, (p: CompiledPolicy) => boolean, string][] = [
      [line.kind === 'function', (p) => p.mode.expressions.allowUserFunctions !== false, 'A function'],
      [uses.equation, (p) => p.mode.expressions.allowImplicitEquations, 'An equation in x and y'],
      [uses.text, (p) => p.mode.expressions.allowTextObjects, 'Text'],
      [uses.list, (p) => p.mode.expressions.allowLists, 'A list'],
      [uses.state, (p) => p.mode.expressions.allowStates, 'Motion with state()'],
      [uses.commands.some((c) => c.name === 'Particles'), (p) => p.mode.expressions.allowParticles, 'Particles'],
    ];
    for (const [used, ok, label] of kinds) {
      if (!used) continue;
      const l = whoForbids(ok);
      if (l) return forbid(call, l, { label }, undefined, []);
    }
    return undefined;
  };
}

function joinOr(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1] as string}`;
}

type CmdNode = { n: 'command'; s: number; e: number; spec: { name: string }; args: readonly { expr?: unknown }[] };

function findCommand(root: unknown, at: UsedName): CmdNode | undefined {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const n = stack.pop() as Record<string, unknown> | undefined;
    if (!n || typeof n !== 'object') continue;
    if (n['n'] === 'command' && n['s'] === at.s && (n['spec'] as { name: string }).name === at.name) return n as unknown as CmdNode;
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) stack.push(...v.map((x) => (x && typeof x === 'object' && 'expr' in x ? (x as { expr: unknown }).expr : x)));
      else if (v && typeof v === 'object' && 'n' in v) stack.push(v);
    }
  }
  return undefined;
}

/** The catalogue of a command list: name and group of each spec. */
export function catalogueOf(specs: readonly { readonly name: string; readonly group: string; readonly forms?: readonly object[] }[]): CommandRef[] {
  // a command two areas give appears once per area group (Normal: geometry and distributions)
  const out: CommandRef[] = [];
  for (const s of specs) {
    const groups = new Set([s.group, ...(s.forms ?? []).map((f) => formGroup(f)).filter((g): g is string => g !== undefined)]);
    for (const group of groups) out.push({ name: s.name, group });
  }
  return out;
}

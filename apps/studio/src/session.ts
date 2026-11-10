/**
 * The studio's scratch session: the language's `ScratchFigure` plus the bookkeeping the line list needs. It is not the kernel.
 * It checks a line with the language, stores it, evaluates what the language can evaluate (numbers, points, lists, functions),
 * and leaves everything that needs a command or a drawing undefined with the reason `not_set`.
 */
import { ScratchFigure, analyseLine, createCommandTable, tyStr, valueText } from '@incantly/kernel';
import type { CommandSpec, ObjId } from '@incantly/kernel';
import { rightSide, rowLabel, speak } from '@incantly/ui';
import type { CauseLink, LineRow, SubmitResult } from '@incantly/ui';
import { SAMPLE_COMMANDS } from './sample-commands';

interface Meta {
  readonly source: string;
  readonly reads: readonly ObjId[];
  /** Why the object's own rule gave no value, when it did not. */
  readonly reason: string | undefined;
  readonly warnings: readonly string[];
}

export class ScratchSession {
  readonly figure: ScratchFigure;
  private readonly meta = new Map<string, Meta>();
  private readonly listeners = new Set<() => void>();

  constructor(commands: readonly CommandSpec[] = SAMPLE_COMMANDS) {
    this.figure = new ScratchFigure({ commands: createCommandTable([...commands]) });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Checks and applies one line. A failing line changes nothing. */
  submit(source: string): SubmitResult {
    const text = source.trim();
    const checked = analyseLine(text, this.figure);
    if (!checked.ok) return { ok: false, error: checked };
    const applied = this.figure.apply(text);
    if (!applied.ok) return { ok: false, error: applied };
    this.figure.recompute();
    const name = applied.value.name;
    const makesRow = (applied.value.kind === 'define' || applied.value.kind === 'function') && name !== '' && this.figure.lookup(name) !== undefined;
    if (!makesRow) {
      this.emit();
      return { ok: true, announcement: 'Line accepted' };
    }
    this.meta.set(name, {
      source: text,
      reads: checked.value.reads,
      reason: applied.value.defined ? undefined : applied.value.reason,
      warnings: applied.notices.map((n) => n.message),
    });
    this.emit();
    const row = this.rows().find((r) => r.name === name) as LineRow;
    const verb = applied.value.op === 'redefine' ? 'redefined' : 'defined';
    const word = (this.figure.lookup(name)?.type.k ?? '').toLowerCase();
    return {
      ok: true,
      announcement: row.state.defined ? `${name} ${verb} as ${word} ${speak(rightSide(text))}` : `${name} ${verb}. ${rowLabel(row)}`,
    };
  }

  rows(): LineRow[] {
    const out: LineRow[] = [];
    for (const name of this.figure.names()) {
      const m = this.meta.get(name);
      const info = this.figure.lookup(name);
      if (!m || !info) continue;
      out.push({
        id: info.id,
        name,
        type: tyStr(info.type),
        source: m.source,
        state: this.stateOf(name, m),
        ...(m.warnings.length > 0 ? { warnings: m.warnings } : {}),
      });
    }
    return out;
  }

  private isUndefined(name: string): boolean {
    return this.figure.valueOf(name) === undefined;
  }

  private nameOf(id: ObjId): string | undefined {
    return this.figure.byId(id)?.name;
  }

  /** The nearest undefined input of an object, then that object's own, down to the root (language errors.md, `cause`). */
  private causeNames(name: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>([name]);
    let cur = name;
    for (;;) {
      const m = this.meta.get(cur);
      const next = m?.reads.map((id) => this.nameOf(id)).find((n): n is string => n !== undefined && !seen.has(n) && this.isUndefined(n));
      if (next === undefined) return chain;
      seen.add(next);
      chain.push(next);
      cur = next;
    }
  }

  private stateOf(name: string, m: Meta): LineRow['state'] {
    const value = this.figure.valueOf(name);
    if (value !== undefined) {
      const isFunction = this.figure.lookup(name)?.type.k === 'Function';
      return { defined: true, value: isFunction ? rightSide(m.source) : valueText(value) };
    }
    const names = this.causeNames(name);
    const cause: CauseLink[] = names.map((n, i) => {
      const own = i === names.length - 1 ? this.meta.get(n)?.reason ?? 'not_set' : 'input_undefined';
      return { name: n, reason: own, ...detail(own) };
    });
    const reason = names.length > 0 ? 'input_undefined' : m.reason ?? 'not_set';
    return { defined: false, reason, ...(names.length === 0 ? detail(reason) : {}), cause };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

/** A line that uses a command stays undefined until the kernel runs it; say that instead of "no value has been set". */
function detail(reason: string): { detail?: string } {
  return reason === 'not_set' ? { detail: 'it uses a command, and commands run once the kernel exists' } : {};
}

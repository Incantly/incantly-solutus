/**
 * Switching modes (app-modes design 3.5; ui 3; errors 2): a dry run replays the figure's script in a scratch figure under
 * the new mode's gate, so the learner sees what the switch would remove before anything changes. With `force` the
 * removals apply as one undo step.
 */
import { Figure } from '@incantly/kernel';
import type { ErrorObject } from '@incantly/kernel';
import { makeGate } from './gate';
import type { GateLayer } from './gate';
import { apiError, compilePolicy } from './policy';
import type { CommandRef } from './policy';
import type { ApiError, ModeConfig, ViewKind } from './types';

export interface DroppedObject {
  readonly name: string;
  readonly reason: string;
}

export interface ModeChangeResult {
  readonly ok: boolean;
  /** Objects kept. */
  readonly kept: number;
  /** Objects the new mode cannot hold, with the reason for each. */
  readonly dropped: readonly DroppedObject[];
  /** Views that open or close. */
  readonly viewsChanged: readonly ViewKind[];
  readonly error?: ApiError;
}

export interface SwitchOptions {
  /** Apply even when objects would be dropped. */
  readonly force?: boolean;
  /** Only look: change nothing even when nothing would be dropped. */
  readonly dryRun?: boolean;
  /** The command table, for the gate's `allowedInstead`. */
  readonly catalogue: readonly CommandRef[];
  /** Extra narrowing layers of the new mode (a restriction), after the mode itself. */
  readonly layers?: readonly GateLayer[];
}

const TARGET = /^\s*([A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*(?:\s*,\s*[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*)*)\s*(?:\([^)]*\))?\s*=(?!=)/;

function targetsOf(line: string): string[] {
  const m = TARGET.exec(line);
  return m ? (m[1] as string).split(',').map((s) => s.trim()) : [];
}

/** The logical lines of a script, numbered from 1 the way the loader numbers them. */
function linesOf(script: string): Map<number, string> {
  const out = new Map<number, string>();
  script.split('\n').forEach((l, i) => out.set(i + 1, l));
  return out;
}

/**
 * What switching `figure` from `from` to `to` would keep and drop. Without `force` (or with `dryRun`) nothing changes;
 * with `force` the dropped objects are deleted in one undo step and the new mode's gate is installed.
 */
export function switchMode(figure: Figure, from: ModeConfig, to: ModeConfig, opts: SwitchOptions): ModeChangeResult {
  const viewsChanged = [...new Set([...from.views.initial.filter((v) => !to.views.initial.includes(v)), ...to.views.initial.filter((v) => !from.views.initial.includes(v))])];
  if (!to.available) {
    return { ok: false, kept: figure.objects().length, dropped: [], viewsChanged: [], error: apiError('mode_unavailable', to.unavailableReason ?? `The ${to.id} mode is not part of this app yet.`) };
  }
  const layers: GateLayer[] = [{ policy: compilePolicy(to), reason: 'mode' }, ...(opts.layers ?? [])];
  const gate = makeGate({ layers, catalogue: opts.catalogue });

  // the dry run: the whole script, in a scratch figure, under the new gate
  const script = figure.toScript();
  const scratch = new Figure({ commands: figure.registry, ...(figure.functions ? { functions: figure.functions } : {}), ...(figure.directives ? { directives: figure.directives } : {}) });
  scratch.setGate(gate);
  const report = scratch.append(script);
  const lines = linesOf(script);
  const dropped: DroppedObject[] = [];
  const failedNames = new Map<number, string[]>();
  for (const e of report.errors) {
    const names = targetsOf(lines.get(e.line) ?? '');
    failedNames.set(e.line, names);
    const reason = reasonOf(e, failedNames);
    for (const n of names) if (figure.get(n) && !dropped.some((d) => d.name === n)) dropped.push({ name: n, reason });
  }
  const kept = figure.objects().length - dropped.length;
  if (dropped.length > 0 && !opts.force) {
    return {
      ok: false,
      kept,
      dropped,
      viewsChanged,
      error: apiError('mode_switch_loses_objects', `Switching to ${to.id} would remove ${dropped.length} object${dropped.length === 1 ? '' : 's'}.`, 'Save first, or pass force to switch anyway.', { dropped: dropped.slice(0, 20), droppedCount: dropped.length }),
    };
  }
  if (opts.dryRun) return { ok: true, kept, dropped, viewsChanged };
  if (dropped.length > 0) {
    // one undo step for the whole switch; deleting an object also removes what was built from it
    figure.applyBatch(dropped.map((d) => `Delete(${d.name})`), { group: `Switch to ${to.id}`, mode: 'independent' });
  }
  figure.setGate(gate);
  return { ok: true, kept: figure.objects().length, dropped, viewsChanged };
}

function reasonOf(e: ErrorObject, failed: ReadonlyMap<number, string[]>): string {
  if (e.kind === 'mode_forbids') return e.message.replace(/\.$/, '');
  const by = e.blockedBy ? failed.get(e.blockedBy.line)?.[0] : undefined;
  if (by) return `it is built from ${by}`;
  return e.message.replace(/\.$/, '');
}

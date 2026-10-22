import type { AuditTurn, DepthAudit, DepthViolation } from '../runtime/kit';
import { SceneRuntime, type RuntimeOptions, type SceneFunction } from '../runtime/runtime';

/**
 * The offline checks (PRD 17.7, CH-2): deeper than the probe, too slow for a
 * learner's device, and never in a learner's way. They run in CI over every
 * reviewed scene and in the eval runner over generated ones.
 *
 * - The depth-order audit turns every 3D stage all the way round and checks
 *   at each turn that wherever two pieces overlap, the nearer is drawn on top.
 */

/**
 * The camera turns a 3D figure is audited at: all the way round in steps of
 * 30 degrees, from below, level and from above.
 */
export const AUDIT_TURNS: readonly AuditTurn[] = Object.freeze(
  [-50, -15, 15, 45, 80].flatMap((pitch) => Array.from({ length: 12 }, (_, i) => Object.freeze({ yaw: i * 30, pitch }))),
);

export interface DepthFinding {
  readonly stage: number;
  /** The turn audited, or null for a camera the learner cannot turn. */
  readonly turn: AuditTurn | null;
  readonly audit: DepthAudit;
}

/**
 * Audits every 3D stage of a mounted scene at every turn, then puts each
 * camera back where it was. The scene must have been ticked at least once.
 */
export function auditDepthOf(runtime: SceneRuntime, turns: readonly AuditTurn[] = AUDIT_TURNS): DepthFinding[] {
  const out: DepthFinding[] = [];
  for (const [stage, controller] of runtime.viewControllers()) {
    if (!controller.audit) continue;
    if (!controller.orbit) {
      out.push({ stage, turn: null, audit: controller.audit() });
      continue;
    }
    for (const turn of turns) out.push({ stage, turn, audit: controller.audit(turn) });
    runtime.view(stage, { kind: 'reset' });
  }
  return out;
}

export interface OfflineOptions {
  /** Passed to the runtime the checks mount. */
  readonly runtime?: Pick<RuntimeOptions, 'kits' | 'locate' | 'seed'>;
  /** Called before every runtime step, so a Worker-style fuel tank can refuel. */
  readonly beforeStep?: () => void;
  readonly turns?: readonly AuditTurn[];
}

export interface OfflineReport {
  /** No order mistakes. */
  readonly ok: boolean;
  /** Turns audited, over every 3D stage. */
  readonly turns: number;
  /** Order mistakes, with the turn they were seen at. */
  readonly violations: ReadonlyArray<DepthViolation & { readonly stage: number; readonly turn: AuditTurn | null }>;
  /** The largest overlap drawn wrong where pieces pass through each other or lie in a ring: shown for review, never failed. */
  readonly crossing: number;
  readonly ring: number;
  /** Why the scene could not be checked, if it could not. */
  readonly error?: string;
}

/**
 * Mounts a scene at its defaults and runs the offline checks on it. A scene
 * that fails to mount reports the error and no findings: the probe is what
 * judges whether it runs.
 */
export function offlineChecks(scene: SceneFunction, options: OfflineOptions = {}): OfflineReport {
  const runtime = new SceneRuntime({ autoplay: false, ...options.runtime, ...(options.runtime?.locate ? { traceSites: true } : {}) });
  try {
    options.beforeStep?.();
    runtime.mount(scene);
    options.beforeStep?.();
    runtime.tick(0);
    if (runtime.uiState().error) return { ok: false, turns: 0, violations: [], crossing: 0, ring: 0, error: runtime.uiState().error!.message };
    options.beforeStep?.();
    const depth = auditDepthOf(runtime, options.turns);
    const violations = depth.flatMap((f) => f.audit.violations.map((v) => ({ ...v, stage: f.stage, turn: f.turn })));
    const largest = (list: readonly DepthViolation[]) => list.reduce((m, v) => Math.max(m, v.area), 0);
    return {
      ok: violations.length === 0,
      turns: depth.length,
      violations,
      crossing: Math.max(0, ...depth.map((f) => largest(f.audit.crossings))),
      ring: Math.max(0, ...depth.map((f) => largest(f.audit.rings))),
    };
  } catch (error) {
    return { ok: false, turns: 0, violations: [], crossing: 0, ring: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    runtime.destroy();
  }
}

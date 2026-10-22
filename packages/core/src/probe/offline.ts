import type { Vec2 } from '../api/types';
import type { AuditTurn, DepthAudit, DepthViolation } from '../runtime/kit';
import { SceneRuntime, type RuntimeOptions, type SceneFunction } from '../runtime/runtime';
import type { SceneGraph, VNode } from '../scene/graph';
import { elementOutlines, flattenPath, stageOutlines, type Outline } from '../scene/outline';

/**
 * The offline checks (PRD 17.7, CH-2): deeper than the probe, too slow for a
 * learner's device, and never in a learner's way. They run in CI over every
 * reviewed scene and in the eval runner over generated ones.
 *
 * - The depth-order audit turns every 3D stage all the way round and checks
 *   at each turn that wherever two pieces overlap, the nearer is drawn on top.
 * - The line-end check finds lines in diagrams that end in mid-air: every
 *   plain line must end on a shape, another line, a dot, a label or the edge
 *   of the stage.
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

/** A line whose end touches nothing. */
export interface LooseEnd {
  readonly stage: number;
  readonly element: number;
  readonly kind: 'line' | 'path' | 'polyline';
  /** The end, in stage units. */
  readonly at: Vec2;
  /** The scene line that made the element, where the runtime traced it. */
  readonly line?: number;
}

/** How near, as a share of the stage's diagonal, an end must come to something to touch it; never under 2.5 units. */
const TOUCH = 0.006;

/** Whether a point is inside a polygon, by counting crossings. */
function inside(points: readonly Vec2[], x: number, y: number): boolean {
  let within = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** The squared distance from a point to an outline's edges. */
function distance2(outline: Outline, x: number, y: number): number {
  const p = outline.points;
  let best = Infinity;
  const segments = outline.closed ? p.length : p.length - 1;
  if (p.length === 1) return (p[0]![0] - x) ** 2 + (p[0]![1] - y) ** 2;
  for (let i = 0; i < segments; i++) {
    const [ax, ay] = p[i]!;
    const [bx, by] = p[(i + 1) % p.length]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    best = Math.min(best, (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2);
  }
  return best;
}

/** At most this many segments in a line the check looks at: more is a sampled curve, a wave or an orbit, which may stop anywhere. */
const MAX_SEGMENTS = 40;
/** A path of more strokes than this is a symbol or a pattern, such as a battery's plates or hatching, whose strokes stop where it says. */
const MAX_STROKES = 4;

/** A line bent gently at most of its corners is a curve drawn in pieces, such as a wave or a tail, which may stop anywhere. */
function isCurve(points: readonly Vec2[]): boolean {
  if (points.length < 4) return false;
  let gentle = 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const [cx, cy] = points[i + 1]!;
    const turn = Math.abs(Math.atan2((bx - ax) * (cy - by) - (by - ay) * (cx - bx), (bx - ax) * (cx - bx) + (by - ay) * (cy - by)));
    if (turn > (3 * Math.PI) / 180 && turn < (35 * Math.PI) / 180) gentle++;
  }
  return gentle >= Math.max(2, (points.length - 2) / 2);
}

/**
 * The plain lines of an element, in stage units: a line, a polyline, or each
 * open subpath of straight lines in a path. Dashed guides, filled shapes, the
 * back layer, kit marks, sampled curves and arrows (whose head is their mark)
 * have none.
 */
function plainLines(graph: SceneGraph, node: VNode): Array<readonly Vec2[]> {
  if (node.hidden || node.fill || node.dashed || node.layer === 'back') return [];
  if (node.kind !== 'line' && node.kind !== 'polyline' && node.kind !== 'path') return [];
  // Kit marks: 3D faces, drag handles, the measuring tool, ghosts of compared curves.
  if (/\binc-(face|grab|measure|ghost|slots|on-face)\b/.test(node.extra)) return [];
  for (let at = node.parent === null ? undefined : graph.nodes.get(node.parent); at; at = at.parent === null ? undefined : graph.nodes.get(at.parent)) {
    if (at.hidden) return [];
  }
  const outlines = elementOutlines(graph, node);
  const plain = (points: readonly Vec2[]) => points.length >= 2 && points.length - 1 <= MAX_SEGMENTS && !isCurve(points);
  if (node.kind !== 'path') return outlines.filter((o) => plain(o.points)).map((o) => o.points);
  const subpaths = flattenPath(node.attrs.get('d') ?? '');
  if (subpaths.length > MAX_STROKES || subpaths.length !== outlines.length || subpaths.some((sub) => !sub.straight || !plain(sub.points))) return [];
  // An arrow: a head of three points whose tip is the end of the shaft.
  const ends = outlines.flatMap((o) => (o.closed ? [] : [o.points[0]!, o.points[o.points.length - 1]!]));
  const isHead = (o: Outline) => o.points.length === 3 && ends.some((e) => e !== o.points[1] && Math.hypot(e[0] - o.points[1]![0], e[1] - o.points[1]![1]) < 0.5);
  if (outlines.some(isHead)) return [];
  return outlines.filter((o) => !o.closed && o.points.length >= 2).map((o) => o.points);
}

/**
 * Lines that end in mid-air on the plain stages of a scene: those whose kit
 * does not own the view (graphs and 3D stages draw their own lines) and that
 * are not clipped to a plot area. An end touches something when it comes
 * within a few units of another element's outline or lies inside a shape;
 * ends at the edge of the stage run off it, as rays do. A line that something
 * rests on, hangs from or slides along (a floor, a ceiling, a track) may end
 * anywhere: what the check is for is wires, leaders and springs that stop
 * short of what they join.
 */
export function looseLineEnds(runtime: SceneRuntime): LooseEnd[] {
  const graph = runtime.graph;
  const owned = new Set(runtime.viewControllers().map(([stage]) => stage));
  const out: LooseEnd[] = [];
  for (const stage of graph.stages) {
    if (owned.has(stage.id) || stage.clip) continue;
    const [vx, vy, vw, vh] = stage.viewBox;
    const touch = Math.max(2.5, TOUCH * Math.hypot(vw, vh));
    const outlines = stageOutlines(graph, stage.id);
    // Lines point at labels from a little way off.
    const near = (o: Outline, x: number, y: number) => (o.closed && inside(o.points, x, y)) || distance2(o, x, y) <= (o.text ? 4 : 1) * touch * touch;
    for (const node of graph.nodes.values()) {
      if (node.stage !== stage.id || node.kind === 'stage') continue;
      const lines = plainLines(graph, node);
      for (const points of lines) {
        const first = points[0]!;
        const last = points[points.length - 1]!;
        // A line that comes back to where it began is closed in all but name.
        if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= touch) continue;
        const piece: Outline = { id: node.id, points, closed: false };
        // Something rests on it, hangs from it or slides along it, away from its ends: it is a surface.
        const away = (x: number, y: number) => Math.hypot(x - first[0], y - first[1]) > touch && Math.hypot(x - last[0], y - last[1]) > touch;
        const carries = outlines.some((o) => o.id !== node.id && o.points.some(([x, y]) => away(x, y) && distance2(piece, x, y) <= touch * touch));
        if (carries) continue;
        for (const end of [first, last]) {
          const [x, y] = end;
          // Running to or off the edge of the stage, as rays and axes do.
          if (x <= vx + touch || x >= vx + vw - touch || y <= vy + touch || y >= vy + vh - touch) continue;
          // Another element, or another line of the same path, such as the next stretch of a wire.
          const others = lines.filter((other) => other !== points).map((other): Outline => ({ id: -1, points: other, closed: false }));
          if (outlines.some((o) => o.id !== node.id && near(o, x, y)) || others.some((o) => near(o, x, y))) continue;
          const site = graph.sites.get(node.id);
          out.push({ stage: stage.id, element: node.id, kind: node.kind as LooseEnd['kind'], at: [Math.round(x * 10) / 10, Math.round(y * 10) / 10], ...(site ? { line: site.line } : {}) });
        }
      }
    }
  }
  return out;
}

export interface OfflineOptions {
  /** Passed to the runtime the checks mount. */
  readonly runtime?: Pick<RuntimeOptions, 'kits' | 'locate' | 'seed'>;
  /** Called before every runtime step, so a Worker-style fuel tank can refuel. */
  readonly beforeStep?: () => void;
  readonly turns?: readonly AuditTurn[];
  /** Check line ends: for diagrams. Default true. */
  readonly lineEnds?: boolean;
}

export interface OfflineReport {
  /** No order mistakes and no loose ends. */
  readonly ok: boolean;
  /** Turns audited, over every 3D stage. */
  readonly turns: number;
  /** Order mistakes, with the turn they were seen at. */
  readonly violations: ReadonlyArray<DepthViolation & { readonly stage: number; readonly turn: AuditTurn | null }>;
  /** The largest overlap drawn wrong where pieces pass through each other or lie in a ring: shown for review, never failed. */
  readonly crossing: number;
  readonly ring: number;
  readonly looseEnds: readonly LooseEnd[];
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
    if (runtime.uiState().error) return { ok: false, turns: 0, violations: [], crossing: 0, ring: 0, looseEnds: [], error: runtime.uiState().error!.message };
    const looseEnds = options.lineEnds === false ? [] : looseLineEnds(runtime);
    options.beforeStep?.();
    const depth = auditDepthOf(runtime, options.turns);
    const violations = depth.flatMap((f) => f.audit.violations.map((v) => ({ ...v, stage: f.stage, turn: f.turn })));
    const largest = (list: readonly DepthViolation[]) => list.reduce((m, v) => Math.max(m, v.area), 0);
    return {
      ok: violations.length === 0 && looseEnds.length === 0,
      turns: depth.length,
      violations,
      crossing: Math.max(0, ...depth.map((f) => largest(f.audit.crossings))),
      ring: Math.max(0, ...depth.map((f) => largest(f.audit.rings))),
      looseEnds,
    };
  } catch (error) {
    return { ok: false, turns: 0, violations: [], crossing: 0, ring: 0, looseEnds: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    runtime.destroy();
  }
}

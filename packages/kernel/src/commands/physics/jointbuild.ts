/**
 * From joint values to joints in the world, and back to readouts (physics design 2.4): the driver's joint half.
 */
import type { ObjId } from '../../contracts/values';
import type { Joint2, World2 } from '../../physics/world2';
import { Distance2, Grab2, Hinge2, Pulley2, Slider2, Weld2, localAnchor } from '../../physics/joints2';
import type { JointEnd, JointValue } from './joints';

/** A stable small number for each body start, so a joint's key does not compare whole shapes. */
const SPEC_KEYS = new WeakMap<object, number>();
let nextKey = 1;
export function specKey(s: object): number {
  let k = SPEC_KEYS.get(s);
  if (k === undefined) {
    k = nextKey++;
    SPEC_KEYS.set(s, k);
  }
  return k;
}

const endKey = (e: JointEnd): string => (e.spec ? `s${specKey(e.spec)}` : `i${e.id ?? -1}`);

/** What a joint is built from, as a short list: equal keys give the same joint. */
export function jointKey(j: JointValue): unknown[] {
  return [j.kind, endKey(j.a), endKey(j.b), j.pa.x, j.pa.y, j.pb.x, j.pb.y, j.length, j.k, j.rest, j.damping, j.motor, j.torque, j.min, j.max, j.breaks, j.axis?.x, j.axis?.y, j.ga?.x, j.ga?.y, j.gb?.x, j.gb?.y, j.ratio];
}

export interface JointMember {
  readonly value: JointValue;
  readonly joint: Joint2;
  readonly la: [number, number];
  readonly lb: [number, number];
  readonly item?: number;
}

/** Builds one joint between world bodies a and b (indices), or undefined when it cannot be. */
export function buildJoint(w: World2, j: JointValue, a: number, b: number): { joint: Joint2; la: [number, number]; lb: [number, number] } | undefined {
  const la = localAnchor(w, a, j.pa.x, j.pa.y);
  const lb = localAnchor(w, b, j.pb.x, j.pb.y);
  let joint: Joint2;
  switch (j.kind) {
    case 'hinge':
      joint = new Hinge2(w, a, b, la, lb, { ...(j.motor !== undefined ? { motor: j.motor } : {}), ...(j.torque !== undefined ? { torque: j.torque } : {}), ...(j.min !== undefined ? { min: j.min } : {}), ...(j.max !== undefined ? { max: j.max } : {}) });
      break;
    case 'spring':
      joint = new Distance2(a, b, la, lb, 'spring', j.rest ?? 0, j.k ?? 50, j.damping ?? 0);
      break;
    case 'rope':
      joint = new Distance2(a, b, la, lb, 'rope', j.length ?? 1);
      break;
    case 'rod':
      joint = new Distance2(a, b, la, lb, 'rod', j.length ?? 1);
      break;
    case 'weld':
      joint = new Weld2(w, a, b, la, lb, j.breaks ?? 0);
      break;
    case 'slider':
      joint = new Slider2(w, a, b, la, lb, [j.axis?.x ?? 1, j.axis?.y ?? 0], { ...(j.min !== undefined ? { min: j.min } : {}), ...(j.max !== undefined ? { max: j.max } : {}), ...(j.motor !== undefined ? { motor: j.motor } : {}), ...(j.torque !== undefined ? { force: j.torque } : {}) });
      break;
    case 'pulley':
      joint = new Pulley2(w, a, b, la, lb, [j.ga?.x ?? 0, j.ga?.y ?? 0], [j.gb?.x ?? 0, j.gb?.y ?? 0], j.ratio ?? 1);
      break;
    case 'grab':
      joint = new Grab2(b, b, lb, j.target?.x ?? j.pb.x, j.target?.y ?? j.pb.y);
      break;
    default:
      return undefined;
  }
  if (j.breaks !== undefined && j.kind !== 'weld') (joint as { breaks: number }).breaks = j.breaks;
  return { joint, la, lb };
}

/** A world point of a body from a point in its frame. */
export function worldOf(w: World2, i: number, l: readonly [number, number]): { x: number; y: number } {
  const c = w.qc[i] as number;
  const s = w.qs[i] as number;
  return { x: (w.px[i] as number) + c * l[0] - s * l[1], y: (w.py[i] as number) + s * l[0] + c * l[1] };
}

/** The joint's value now: its start with what it carries, how long it is, and where its ends are. */
export function jointNow(w: World2, m: JointMember, h: number): JointValue {
  const j = m.joint as Joint2 & { force(h: number): number; length(w: World2): number; angle(w: World2): number };
  const a = worldOf(w, j.a, m.la);
  const b = m.value.kind === 'grab' ? { x: (j as unknown as Grab2).tx, y: (j as unknown as Grab2).ty } : worldOf(w, j.b, m.lb);
  return {
    ...m.value,
    force: j.broken ? 0 : j.force(h / w.substeps),
    lengthNow: m.value.kind === 'hinge' || m.value.kind === 'weld' ? 0 : j.length(w),
    angleNow: m.value.kind === 'hinge' ? j.angle(w) : 0,
    broken: j.broken,
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
  };
}

export type { ObjId };

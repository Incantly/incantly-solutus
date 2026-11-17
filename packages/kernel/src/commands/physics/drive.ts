/**
 * Driving a car in space from the keyboard (docs/features/physics/ui.md 9): the arrow keys and Space write the free
 * numbers (usually sliders) a `Vehicle` reads for its `motor`, `steer` and `brake`, and the camera can follow it. Pure:
 * the Space view calls these and writes the values through the figure, so they are logged while the film plays.
 */
import type { Figure } from '../../graph/figure';
import { isBody3Value } from './body3';
import { isVehicle3Value } from './vehicle';

export interface CarPedals {
  /** The car's name, and the free numbers its motor, steer and brake read (when they are plain names). */
  readonly car: string;
  readonly motor?: string;
  readonly steer?: string;
  readonly brake?: string;
}

/** The first car in space whose pedals are free numbers, or undefined. */
export function carPedals(figure: Figure): CarPedals | undefined {
  for (const o of figure.objects()) {
    if (o.type !== 'Vehicle' || !o.cell.defined || !isVehicle3Value(o.cell.value)) continue;
    const out: { car: string; motor?: string; steer?: string; brake?: string } = { car: o.name };
    for (const k of ['motor', 'steer', 'brake'] as const) {
      const m = new RegExp(`\\b${k}\\s*=\\s*([A-Za-z_]\\w*)\\s*[,)]`).exec(o.definition);
      const n = m?.[1];
      const v = n ? figure.get(n) : undefined;
      if (n && v && v.free && v.cell.defined && typeof v.cell.value === 'number') out[k] = n;
    }
    if (out.motor || out.steer || out.brake) return out;
  }
  return undefined;
}

/**
 * The values a key press (or release) gives the pedals: up and down are full motor forward and back, left and right
 * steer to the slider's ends (or half a radian), Space is full brake; letting go puts each back to 0. Empty when the key
 * drives nothing.
 */
export function carKey(figure: Figure, key: string, down: boolean): { readonly name: string; readonly value: number }[] {
  const p = carPedals(figure);
  if (!p) return [];
  const end = (name: string | undefined, hi: boolean, d: number): number => {
    const r = name ? figure.get(name)?.range : undefined;
    return r ? (hi ? r.max : r.min) : hi ? d : -d;
  };
  const set = (name: string | undefined, value: number): { name: string; value: number }[] => (name ? [{ name, value: down ? value : 0 }] : []);
  switch (key) {
    case 'ArrowUp':
      return set(p.motor, Math.min(1, end(p.motor, true, 1)));
    case 'ArrowDown':
      return set(p.motor, Math.max(-1, end(p.motor, false, 1)));
    case 'ArrowLeft':
      return set(p.steer, end(p.steer, true, 0.5));
    case 'ArrowRight':
      return set(p.steer, end(p.steer, false, 0.5));
    case ' ':
    case 'Spacebar':
      return set(p.brake, Math.min(1, end(p.brake, true, 1)));
    default:
      return [];
  }
}

/** Where a car is and the way it faces (radians about z), for a camera that follows it. */
export function carPose(figure: Figure): { readonly x: number; readonly y: number; readonly z: number; readonly heading: number } | undefined {
  const p = carPedals(figure);
  const car = p ? figure.get(p.car) : [...figure.objects()].find((o) => o.type === 'Vehicle' && o.cell.defined && isVehicle3Value(o.cell.value));
  if (!car || !car.cell.defined || !isVehicle3Value(car.cell.value)) return undefined;
  const ch = car.cell.value.chassis;
  const body = ch.id !== undefined ? figure.get(ch.id) : undefined;
  const v = body?.cell.defined ? body.cell.value : undefined;
  if (!isBody3Value(v)) return undefined;
  const [w, x, y, z] = v.q;
  // the chassis's own x axis, seen from above
  const fx = 1 - 2 * (y * y + z * z);
  const fy = 2 * (x * y + w * z);
  return { x: v.x, y: v.y, z: v.z, heading: Math.atan2(fy, fx) };
}

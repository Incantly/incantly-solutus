/**
 * The crackle of a fire (docs/features/physics/design.md 9.7; plan 11A section 5): a `Fire` with `sound = true` plays soft
 * brown noise while some cell is above 500 °C, as loud as the flames are wide, with small pops that come from a hash of
 * the object and the tenth of a film second (integer maths only: the same pops on every computer and every replay).
 */
import type { Figure } from '../../graph/figure';
import type { PlayingSound } from '../sound/index';
import { isFireValue } from './smoke';

/** A number in [0, 1) from two whole numbers (a 32-bit mixer, integer maths only). */
export function crackleHash(a: number, b: number): number {
  let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return x / 4294967296;
}

/** The loudness of the crackle: 0.3 at most, by how wide the flames are, with pops of up to 30%. */
export function crackleGain(flames: number, cells: number, q: number): number {
  const wide = flames / (0.05 * cells);
  return 0.3 * (wide < 1 ? wide : 1) * (0.7 + 0.3 * q);
}

/** The sound source physics registers with the sound area: one crackle for each fire with `sound = true`. */
export function crackleSource(figure: Figure, t: number): { readonly sounds: readonly PlayingSound[]; readonly has: boolean } {
  const sounds: PlayingSound[] = [];
  let has = false;
  for (const o of figure.objects()) {
    if (o.type !== 'Fire' || !o.cell.defined) continue;
    const v = o.cell.value;
    if (!isFireValue(v) || !v.spec.fire.sound) continue;
    has = true;
    if (!(v.flames > 0)) continue;
    const q = crackleHash(Number(o.id), Math.floor(t * 20));
    sounds.push({ key: `fire:${String(o.id)}`, name: o.name, kind: 'noise', color: 'brown', gain: crackleGain(v.flames, v.spec.n * v.spec.n, q), pan: 0 });
  }
  return { sounds, has };
}

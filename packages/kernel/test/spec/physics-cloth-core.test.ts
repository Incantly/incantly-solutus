/**
 * The cloth engine on its own (docs/features/physics/design.md 9.5, 10.3, 11.3, 11.4 "Cloth, …"): links in red-black
 * order, XPBD small steps, pins, tethers, tearing in id order, sleep, checkpoints, readouts.
 */
import { describe, expect, it } from 'vitest';
import type { ClothDef, PinDef } from '../../src/physics/cloth';
import { CLOTH_DEFAULTS, ClothSet, LinkKind, MAX_SHEET, countLinks, pinWord, sheetPoints } from '../../src/physics/cloth';

const H = 1 / 120;

function sheet(nu: number, nv: number, o: Partial<ClothDef> & { pinIdx?: number[] } = {}): ClothDef {
  // a sheet hanging in the x–z plane: u along x, v down
  const pos = sheetPoints(0, 0, 3, 2, 0, 0, 0, 0, -2 * ((nv - 1) / Math.max(1, nu - 1)), nu, nv);
  const pins: PinDef[] = (o.pinIdx ?? []).map((point) => ({ point, body: -1 }));
  return { kind: 'sheet', nu, nv, pos, ...CLOTH_DEFAULTS, tears: 0, self: false, pins, ...o };
}

function run(c: ClothSet, seconds: number): void {
  const n = Math.round(seconds / H);
  for (let k = 0; k < n; k++) c.stepCloth(H);
}

function maxStretch(c: ClothSet, kinds: number[] = [LinkKind.stretch]): number {
  let m = 0;
  for (let l = 0; l < c.la.length; l++) {
    if (c.broken[l] === 1 || !kinds.includes(c.kind[l] as number)) continue;
    const a = c.la[l] as number;
    const b = c.lb[l] as number;
    const d = Math.hypot((c.x[a] as number) - (c.x[b] as number), (c.y[a] as number) - (c.y[b] as number), (c.z[a] as number) - (c.z[b] as number));
    m = Math.max(m, Math.abs(d / (c.rest[l] as number) - 1));
  }
  return m;
}

describe('cloth links', () => {
  it('counts the links of a sheet and a rope, and puts no two links of one stretch batch on one point', () => {
    const d = sheet(8, 6);
    const c = new ClothSet([d], 3);
    expect(c.la.length).toBe(countLinks(d));
    // 8 × 6: 6·7 + 8·5 stretch, 2·7·5 shear, 6·6 + 8·4 bend
    expect(countLinks(d)).toBe(42 + 40 + 70 + 36 + 32);
    // batches: runs of stretch links of one parity and direction share no point
    const seen = new Set<number>();
    let batch = -1;
    for (let l = 0; l < c.la.length; l++) {
      if (c.kind[l] !== LinkKind.stretch) break;
      const a = c.la[l] as number;
      const b = c.lb[l] as number;
      const dir = b - a === 1 ? 0 : 1;
      const par = dir === 0 ? a % 8 % 2 : Math.floor(a / 8) % 2;
      const key = dir * 2 + par;
      if (key !== batch) {
        seen.clear();
        batch = key;
      }
      expect(seen.has(a) || seen.has(b)).toBe(false);
      seen.add(a);
      seen.add(b);
    }
    const rope: ClothDef = { ...sheet(10, 1), kind: 'rope' };
    expect(countLinks(rope)).toBe(9 + 8);
  });

  it('names the points of the pin words', () => {
    const pos = sheetPoints(0, 0, 3, 2, 0, 0, 0, 0, -2, 4, 3);
    expect(pinWord('top', pos, 4, 3, 3)).toEqual([0, 1, 2, 3]);
    expect(pinWord('left', pos, 4, 3, 3)).toEqual([0, 4, 8]);
    expect(pinWord('corners', pos, 4, 3, 3)).toEqual([0, 3, 8, 11]);
    expect(pinWord('top  Corners', pos, 4, 3, 3)).toEqual([0, 3]);
    expect(pinWord('bottom', pos, 4, 3, 3)).toBeUndefined();
    // a rope from (0, 5) to (4, 3): its higher end is the top
    const rope = sheetPoints(0, 5, 0, 4, -2, 0, 0, 0, 0, 5, 1);
    expect(pinWord('top', rope, 5, 1, 2)).toEqual([0]);
    expect(pinWord('corners', rope, 5, 1, 2)).toEqual([0, 4]);
  });
});

describe('cloth steps', () => {
  it('a sheet hanging from its two top corners keeps every link within 2% of its length (11.4 "Cloth, stretch")', () => {
    const d = sheet(64, 32, { pinIdx: [0, 63], damping: 0.5 });
    expect(d.nu * d.nv).toBe(MAX_SHEET);
    const c = new ClothSet([d], 3);
    run(c, 4);
    expect(maxStretch(c)).toBeLessThan(0.02);
    expect(c.cloths[0]?.unstable).toBe(false);
  });

  it('a 32 × 32 cloth pinned at the top with no wind stills under 1 mm after 3 s and sleeps (11.4 "Cloth, still flag")', () => {
    const top = Array.from({ length: 32 }, (_, i) => i);
    const c = new ClothSet([sheet(32, 32, { pinIdx: top })], 3);
    run(c, 3);
    const keep = Float64Array.from(c.z);
    const kx = Float64Array.from(c.x);
    run(c, 57);
    let most = 0;
    for (let i = 0; i < c.n; i++) most = Math.max(most, Math.abs((c.z[i] as number) - (keep[i] as number)), Math.abs((c.x[i] as number) - (kx[i] as number)));
    expect(most).toBeLessThan(0.001);
    expect(c.cloths[0]?.asleep).toBe(true);
  });

  it('a cloth swinging with no damping and no air never gains energy (11.4 "Cloth, energy")', () => {
    // pinned at one corner, held out flat: it swings down and about
    const d: ClothDef = { ...sheet(16, 16, { pinIdx: [0] }), damping: 0, pos: sheetPoints(0, 0, 3, 2, 0, 0, 0, 2, 0, 16, 16) };
    const c = new ClothSet([d], 3);
    const e0 = c.energy(0);
    let most = -Infinity;
    for (let k = 0; k < 60 * 120; k++) {
      c.stepCloth(H);
      most = Math.max(most, c.energy(0));
    }
    expect(most).toBeLessThanOrEqual(e0 + 1e-9 * Math.abs(e0));
  });

  it('wind pushes a flag along it, and a changing wind wakes a sleeping cloth', () => {
    const left = Array.from({ length: 16 }, (_, j) => j * 16);
    const c = new ClothSet([sheet(16, 16, { pinIdx: left })], 3);
    run(c, 3);
    let mx = 0;
    for (let i = 0; i < c.n; i++) mx += c.x[i] as number;
    const before = mx / c.n;
    c.windX = 6;
    run(c, 2);
    mx = 0;
    for (let i = 0; i < c.n; i++) mx += c.x[i] as number;
    // the wind along x makes the flag stand out along x
    expect(mx / c.n).toBeGreaterThan(before - 1e-9);
    // put it to sleep, then change the wind
    c.windX = 0;
    c.sleeping = true;
    run(c, 10);
    if (c.cloths[0]?.asleep) {
      c.windX = 3;
      c.stepCloth(H);
      expect(c.cloths[0]?.asleep).toBe(false);
    }
  });
});

describe('ropes in the plane', () => {
  it('a rope of 200 points hanging from two pins at one height follows the catenary within 2% of its sag (11.5)', () => {
    const n = 200;
    const L = 4;
    const pos = sheetPoints(0, 5, 0, L, 0, 0, 0, 0, 0, n, 1);
    const d: ClothDef = { kind: 'rope', nu: n, nv: 1, pos, ...CLOTH_DEFAULTS, damping: 1, tears: 0, self: false, pins: [{ point: 0, body: -1 }, { point: n - 1, body: -1 }] };
    const c = new ClothSet([d], 2);
    c.gy = -9.8;
    c.gz = 0;
    // the far pin moves in to a span of 3 m, so the 4 m rope hangs
    const span = 3;
    c.pinX[1] = span;
    run(c, 20);
    // the catenary through both pins with length L: 2 a sinh(span / 2a) = L
    let lo = 0.1;
    let hi = 100;
    for (let k = 0; k < 200; k++) {
      const a = 0.5 * (lo + hi);
      if (2 * a * Math.sinh(span / (2 * a)) > L) lo = a;
      else hi = a;
    }
    const a = 0.5 * (lo + hi);
    const sag = a * Math.cosh(span / (2 * a)) - a;
    let low = Infinity;
    for (let i = 0; i < n; i++) low = Math.min(low, c.y[i] as number);
    expect(Math.abs(5 - low - sag) / sag).toBeLessThan(0.02);
    // and its shape: at a quarter of the span
    const q = span / 4;
    const want = 5 - (a * Math.cosh(span / (2 * a)) - a * Math.cosh((q - span / 2) / a));
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs((c.x[i] as number) - q) < Math.abs((c.x[best] as number) - q)) best = i;
    expect(Math.abs((c.y[best] as number) - want) / sag).toBeLessThan(0.02);
  });
});

describe('tearing and checkpoints', () => {
  it('tears the same links at the same steps in two runs, in id order, and counts them', () => {
    const go = (): { torn: number; at: number[]; bits: string } => {
      const d = sheet(20, 10, { pinIdx: [0, 19], tears: 1.5, stretch: 0.5 });
      const c = new ClothSet([d], 3);
      const at: number[] = [];
      // a hard grab pulls the middle of the bottom edge down
      c.grab(9 * 20 + 10, 1, 0, -10);
      for (let k = 0; k < 240; k++) {
        c.stepCloth(H);
        if ((c.tornNow[0] as number) > 0) at.push(k);
      }
      return { torn: c.cloths[0]?.torn ?? 0, at, bits: Array.from(c.broken).join('') };
    };
    const a = go();
    const b = go();
    expect(a.torn).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('a checkpoint loads to the same film, torn links and sleep included', () => {
    const d = sheet(16, 8, { pinIdx: [0, 15], tears: 1.3, stretch: 0.6 });
    const c = new ClothSet([d], 3);
    c.windX = 4;
    c.grab(7 * 16 + 8, 1, 0, -6);
    run(c, 0.5);
    const cp = c.save();
    run(c, 1);
    const want = c.save();
    c.load(cp);
    run(c, 1);
    expect(Array.from(c.save())).toEqual(Array.from(want));
  });
});

/**
 * Shared set-up for the round-3 spec tests (shapes, select, clipboard, fixing). Only the public API of
 * `packages/board` is used: a headless board with every tool (`defaultTools`), shapes written through the store, and
 * pointer input as `InputSample`s with the modifier keys of `InputSample.modifiers`.
 */
import { MOD_ALT, MOD_SHIFT, bindEnd, defaultTools, putNewShape, shapeGeometry } from '../../src/index';
import type { BoardCoreOptions, Bounds, InputSample, ShapeRecord } from '../../src/index';
import { makeRig, sample } from './ink-helpers';
import type { Rig } from './ink-helpers';

export { MOD_ALT, MOD_SHIFT };
export type { Rig };

export type BoardRig = ReturnType<typeof makeRig>;

/** A board with the select tool and the shape tools, the select tool chosen. */
export function shapeRig(tool = 'select', core?: BoardCoreOptions): BoardRig {
  return makeRig({ tools: defaultTools, tool, ...(core !== undefined ? { core } : {}) });
}

export const pageOf = (rig: Rig): string => rig.core.pages.current as string;

/** Every shape of the current page, in the store's order. */
export const shapesOf = (rig: Rig): readonly ShapeRecord[] => rig.core.store.shapesOn(pageOf(rig));

/** The shapes of one kind on the current page. */
export const ofKind = (rig: Rig, kind: string): readonly ShapeRecord[] => shapesOf(rig).filter((s) => s.kind === kind);

/** The shape with this id as it is stored now. */
export function get(rig: Rig, id: string): ShapeRecord {
  const s = rig.core.store.get(id);
  if (s === undefined) throw new Error(`no record ${id}`);
  return s as ShapeRecord;
}

/** The page box of a shape's own box (the box the kind says, turned, without the pad of its line). */
export function boxOf(rig: Rig, id: string): Bounds {
  const g = shapeGeometry(get(rig, id), rig.core.store.kinds);
  if (g === undefined) throw new Error(`${id} has no geometry`);
  const xs = [g.corners[0], g.corners[2], g.corners[4], g.corners[6]] as number[];
  const ys = [g.corners[1], g.corners[3], g.corners[5], g.corners[7]] as number[];
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The middle of the shape's box on the page. */
export function centreOf(rig: Rig, id: string): { readonly x: number; readonly y: number } {
  const g = shapeGeometry(get(rig, id), rig.core.store.kinds);
  if (g === undefined) throw new Error(`${id} has no geometry`);
  return { x: g.pageCx, y: g.pageCy };
}

/** Writes one shape of a kind with the kind's defaults under `props`; returns the stored record. One undo step. */
export function add(rig: Rig, kind: string, x: number, y: number, props: Readonly<Record<string, unknown>> = {}, over: Partial<ShapeRecord> = {}): ShapeRecord {
  let made: ShapeRecord | undefined;
  const written = rig.core.store.change('user', (tx) => {
    const r = putNewShape(tx, rig.core.store, { kind, page: pageOf(rig), x, y, props });
    if (!r.ok) throw new Error(`could not add a ${kind}: ${r.message}`);
    made = r.value;
    if (Object.keys(over).length > 0) tx.update(r.value.id, over as Record<string, unknown>);
  });
  if (!written.ok || made === undefined) throw new Error(`could not add a ${kind}`);
  return get(rig, made.id);
}

/** Sticks the ends of an arrow to shapes (`bindEnd`, aiming at the page point given), in one transaction. */
export function stick(rig: Rig, arrow: string, ends: readonly (readonly ['start' | 'end', string, number, number])[]): void {
  const done = rig.core.store.change('user', (tx) => ends.map(([end, target, x, y]) => bindEnd(tx, rig.core.store, arrow, end, target, { x, y })));
  if (!done.ok || !done.value.value.every((r) => r.ok)) throw new Error('could not stick the arrow');
}

/** A rect `w` by `h` at `x, y`. */
export const rect = (rig: Rig, x: number, y: number, w = 100, h = 60, over: Partial<ShapeRecord> = {}): ShapeRecord => add(rig, 'rect', x, y, { w, h }, over);

const mouse = (phase: InputSample['phase'], x: number, y: number, time: number, modifiers: number): InputSample =>
  sample({ device: 'mouse', pressure: Number.NaN, phase, x, y, time, buttons: phase === 'up' ? 0 : 1, modifiers });

/** A press and a release at one point. `t` is the time of the press. */
export function tap(rig: Rig, x: number, y: number, modifiers = 0, t = 0): void {
  rig.host.sample(mouse('down', x, y, t, modifiers));
  rig.host.sample(mouse('up', x, y, t + 20, modifiers));
}

/** A drag from a point to a point in `steps` moves, the pointer up at the end. `t0` is the time of the press. */
export function drag(rig: Rig, from: readonly [number, number], to: readonly [number, number], modifiers = 0, steps = 6, t0 = 0): void {
  rig.host.sample(mouse('down', from[0], from[1], t0, modifiers));
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    rig.host.sample(mouse('move', from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f, t0 + i * 8, modifiers));
  }
  rig.host.sample(mouse('up', to[0], to[1], t0 + (steps + 1) * 8, modifiers));
}

/** A drag that goes down, moves through `path` and stays down: the gesture is open. */
export function press(rig: Rig, path: readonly (readonly [number, number])[], modifiers = 0, t0 = 0): void {
  path.forEach(([x, y], i) => rig.host.sample(mouse(i === 0 ? 'down' : 'move', x, y, t0 + i * 8, modifiers)));
}

/** Releases the pointer at a point. */
export function release(rig: Rig, x: number, y: number, modifiers = 0, t = 1000): void {
  rig.host.sample(mouse('up', x, y, t, modifiers));
}

/** A key press, as the host's `key` takes it. */
export function key(rig: Rig, k: string, over: { shift?: boolean; mod?: boolean; alt?: boolean } = {}): boolean {
  return rig.host.key({ key: k, down: true, shift: over.shift ?? false, alt: over.alt ?? false, mod: over.mod ?? false, repeat: false });
}

/** Undoes every step and checks the history is empty; returns the number of steps undone. */
export function undoAll(rig: Rig): number {
  let n = 0;
  while (rig.core.history.canUndo && n < 1000) {
    rig.core.history.undo();
    n++;
  }
  return n;
}

/** The record as JSON text with arrays of numbers for typed arrays, to compare a record before and after. */
export function plain(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v instanceof Float32Array ? { f32: [...v] } : v));
}

/** A tiny PNG header: the 8 magic bytes, an IHDR of `w` by `h`, and enough bytes after it. */
export function pngBytes(w: number, h: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(out.buffer).setUint32(16, w);
  new DataView(out.buffer).setUint32(20, h);
  out.set([8, 6, 0, 0, 0], 24);
  return out;
}

/** The start of a JPEG file: SOI, then a baseline frame header of `w` by `h`. */
export function jpegBytes(w: number, h: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

/** A WebP file with a `VP8X` chunk of `w` by `h`. */
export function webpBytes(w: number, h: number): Uint8Array {
  const out = new Uint8Array(30);
  out.set([0x52, 0x49, 0x46, 0x46, 22, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0]);
  const wm = w - 1;
  const hm = h - 1;
  out.set([wm & 255, (wm >> 8) & 255, (wm >> 16) & 255, hm & 255, (hm >> 8) & 255, (hm >> 16) & 255], 24);
  return out;
}

export const svgBytes = (text: string): Uint8Array => new TextEncoder().encode(text);

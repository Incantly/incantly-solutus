/** Reading and checking the fields of a kind's props: each reader gives the value or a `record_invalid` error naming the field. */
import { boardError } from '../errors';
import type { BoardError } from '../errors';

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const isColor = (v: unknown): v is string => typeof v === 'string' && COLOR.test(v);

export const bad = (field: string, message: string): BoardError => boardError('record_invalid', message, { detail: { field } });

export type Bag = Readonly<Record<string, unknown>>;

/** The props as a plain object, or an error. */
export function bagOf(props: unknown, what: string): Bag | BoardError {
  if (typeof props !== 'object' || props === null || Array.isArray(props) || ArrayBuffer.isView(props)) return bad('props', `${what} needs props.`);
  return props as Bag;
}

export function readNumber(p: Bag, key: string, def: number, min: number, max: number): number | BoardError {
  const v = p[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return bad(`props.${key}`, `${key} must be a number from ${min} to ${max}.`);
  return v;
}

export function readColor(p: Bag, key: string, def: string): string | BoardError {
  const v = p[key] ?? def;
  if (!isColor(v)) return bad(`props.${key}`, `${key} must be #rgb, #rrggbb or #rrggbbaa.`);
  return v;
}

/** A colour, or the word `none`. */
export function readFill(p: Bag, key: string, def: string): string | BoardError {
  const v = p[key] ?? def;
  if (v !== 'none' && !isColor(v)) return bad(`props.${key}`, `${key} must be a colour or "none".`);
  return v as string;
}

export function readEnum<T extends string>(p: Bag, key: string, def: T, list: readonly T[]): T | BoardError {
  const v = p[key] ?? def;
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) return bad(`props.${key}`, `${key} must be one of ${list.join(', ')}.`);
  return v as T;
}

export function readText(p: Bag, key: string, def: string, maxLength: number): string | BoardError {
  const v = p[key] ?? def;
  if (typeof v !== 'string' || v.length > maxLength) return bad(`props.${key}`, `${key} must be text of at most ${maxLength} characters.`);
  return v;
}

/** A list of finite numbers whose length is `even` (pairs) and at least `min`. */
export function readNumbers(p: Bag, key: string, def: readonly number[], minPairs: number, maxPairs: number): readonly number[] | BoardError {
  const v = p[key] ?? def;
  if (!Array.isArray(v) || v.length % 2 !== 0 || v.length < minPairs * 2 || v.length > maxPairs * 2) {
    return bad(`props.${key}`, `${key} must be a list of ${minPairs} to ${maxPairs} points, each an x and a y.`);
  }
  for (const n of v as unknown[]) if (typeof n !== 'number' || !Number.isFinite(n)) return bad(`props.${key}`, `Every number of ${key} must be finite.`);
  return Object.freeze([...(v as number[])]);
}

/** A point `[x, y]`. */
export function readPoint(p: Bag, key: string, def: readonly [number, number]): readonly [number, number] | BoardError {
  const v = p[key] ?? def;
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number' || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
    return bad(`props.${key}`, `${key} must be a point, [x, y].`);
  }
  return Object.freeze([v[0], v[1]] as [number, number]);
}

/** True when a reader gave an error. */
export const failed = (v: unknown): v is BoardError => typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false;

/** The first error among readers' results, or undefined. */
export function firstError(...values: readonly unknown[]): BoardError | undefined {
  for (const v of values) if (failed(v)) return v;
  return undefined;
}

export const SIZE_MAX = 200;
export const DIM_MAX = 100_000;
export const DIM_MIN = 1;
export const TEXT_MAX = 100_000;

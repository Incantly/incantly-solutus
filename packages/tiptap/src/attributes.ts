import { SCENE_SCHEMA_VERSION, SDK_VERSION } from '@incantly/core';

/** The three approved scene fragments. */
export interface FigureFragments {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

/**
 * Durable data stored on a figure node. Derived model values, per-frame
 * state, DOM nodes and runtime handles are never stored here.
 */
export interface FigureAttributes {
  readonly figureId: string;
  readonly concept: string;
  readonly sdkVersion: string;
  readonly schemaVersion: number;
  /** Inline fragments, or null when they are stored by content hash. */
  readonly fragments: FigureFragments | null;
  readonly fragmentsRef: string | null;
  readonly defaults: Readonly<Record<string, number>>;
  readonly values: Readonly<Record<string, number>>;
  /** Teaching-step position, or null outside step mode. */
  readonly step: number | null;
  /** Content hash of the last approved snapshot. */
  readonly snapshotRef: string | null;
  /** Text alternative, also shown while the figure is not live. */
  readonly description: string;
  /** Height divided by width, so placeholders reserve a stable size. */
  readonly aspect: number;
  /** Repair and migration metadata. Never prompts, plans or model details. */
  readonly meta: Readonly<Record<string, unknown>>;
}

export const DEFAULT_ASPECT = 9 / 16;

export function defaultAttributes(): FigureAttributes {
  return {
    figureId: '',
    concept: '',
    sdkVersion: SDK_VERSION,
    schemaVersion: SCENE_SCHEMA_VERSION,
    fragments: null,
    fragmentsRef: null,
    defaults: {},
    values: {},
    step: null,
    snapshotRef: null,
    description: '',
    aspect: DEFAULT_ASPECT,
    meta: {},
  };
}

export function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseNumber(value: string | null, fallback: number): number {
  if (value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

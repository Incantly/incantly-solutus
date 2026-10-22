import { SCENE_SCHEMA_VERSION, SDK_VERSION, checkStyle, type FigureStyle } from '@incantly/core';

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
  readonly meta: FigureMeta;
  /** Formulas the learner edited, by index. */
  readonly formulas: Readonly<Record<string, string>>;
  /**
   * This figure's own look over the editor's style: preset, tokens, classes,
   * layout and which parts show. Never CSS: documents travel between people.
   */
  readonly look: FigureStyle | null;
}

/**
 * What a note may record about where a figure came from: enough to ask the
 * server for a repair or to migrate the node, and nothing else. Prompts,
 * plans, model names, check reports and repair history stay on the server
 * (RM-5, PRD 18.6). Unknown keys are dropped when a node is parsed.
 */
export interface FigureMeta {
  /** Opaque id of the server-side generation record. */
  readonly generationId?: string;
  /** When the figure passed the probe, as an ISO date. */
  readonly approvedAt?: string;
  /** The validator version that approved the fragments. */
  readonly validatorVersion?: number;
  /** The generation service's signature on the scene, sent back to repair it in the background (RP-7). */
  readonly ticket?: string;
}

export function sanitizeMeta(value: unknown): FigureMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const meta: { generationId?: string; approvedAt?: string; validatorVersion?: number; ticket?: string } = {};
  if (typeof raw.generationId === 'string' && /^[\w-]{1,64}$/.test(raw.generationId)) meta.generationId = raw.generationId;
  if (typeof raw.approvedAt === 'string' && !Number.isNaN(Date.parse(raw.approvedAt))) meta.approvedAt = raw.approvedAt;
  if (typeof raw.validatorVersion === 'number' && Number.isInteger(raw.validatorVersion)) meta.validatorVersion = raw.validatorVersion;
  // Opaque to the note: only the service can read or check it.
  if (typeof raw.ticket === 'string' && raw.ticket.length <= 16_000 && /^[\w-]+\.[\w-]+$/.test(raw.ticket)) meta.ticket = raw.ticket;
  return meta;
}

/** Learner values from a note: plain finite numbers only. */
export function sanitizeValues(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [name, v] of Object.entries(value as Record<string, unknown>).slice(0, 16)) {
    if (typeof v === 'number' && Number.isFinite(v) && /^[\w$]{1,64}$/.test(name)) out[name] = v;
  }
  return out;
}

/** Fragments from a note: three strings, or null. They are validated again before they mount. */
export function sanitizeFragments(value: unknown): FigureFragments | null {
  const v = value as Partial<FigureFragments> | null;
  return v && typeof v === 'object' && typeof v.html === 'string' && typeof v.css === 'string' && typeof v.js === 'string'
    ? { html: v.html, css: v.css, js: v.js }
    : null;
}

/** Edited formulas from a note: at most eight, keyed by index, each short text. */
export function sanitizeFormulas(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>).slice(0, 8)) {
    if (/^[0-7]$/.test(key) && typeof text === 'string' && text.length <= 200) out[key] = text;
  }
  return out;
}

/** A figure's look from a note: only valid style fields, never CSS; null when nothing is set. */
export function sanitizeLook(value: unknown): FigureStyle | null {
  const look = checkStyle(value);
  return Object.keys(look).length > 0 ? look : null;
}

export const CONTENT_REF = /^sha256:[0-9a-f]{64}$/;

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
    formulas: {},
    look: null,
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

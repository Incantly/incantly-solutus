/**
 * `KindDef` and the registry of kinds (design 7.2). Round 1 holds what a record needs to be checked and loaded;
 * geometry, drawing and handles are added to the same interface in round 3. Built-in kinds and a host's own kinds are
 * registered the same way.
 */
import { boardError, DONE } from '../errors';
import type { BoardResult } from '../errors';
import { RECORD_TYPES } from '../types';

export interface KindDef<P = unknown> {
  /** The kind's name, as in `ShapeRecord.kind`. Not a record type name (`shape`, `page`, …). */
  readonly kind: string;
  /** The props of a new shape of this kind. */
  readonly defaults: P;
  /** Schema check on every write and every load; returns the props to store (defaults filled, values cleaned). */
  check(props: unknown): BoardResult<P>;
  /** Props written by an older file format version, brought to this one. Runs on load only. */
  migrate?(props: unknown, fromVersion: number): unknown;
  /** How many ink points these props hold, for the page limit. Kinds with no ink leave it out. */
  points?(props: P): number;
}

export class KindRegistry {
  readonly #defs = new Map<string, KindDef>();

  /** Adds a kind. A name that is empty, reserved, or already registered is refused. */
  register<P>(def: KindDef<P>): BoardResult<undefined> {
    if (typeof def !== 'object' || def === null || typeof def.kind !== 'string' || def.kind === '') {
      return boardError('bad_argument', 'A kind needs a name.', { detail: { field: 'kind' } });
    }
    if ((RECORD_TYPES as readonly string[]).includes(def.kind)) {
      return boardError('bad_argument', `"${def.kind}" is the name of a record type; give the kind another name.`, { detail: { kind: def.kind } });
    }
    if (typeof def.check !== 'function') {
      return boardError('bad_argument', `Kind "${def.kind}" needs a check function.`, { detail: { kind: def.kind, field: 'check' } });
    }
    if (this.#defs.has(def.kind)) {
      return boardError('bad_argument', `Kind "${def.kind}" is already registered.`, { detail: { kind: def.kind } });
    }
    this.#defs.set(def.kind, def as KindDef);
    return DONE;
  }

  get(kind: string): KindDef | undefined {
    return this.#defs.get(kind);
  }

  has(kind: string): boolean {
    return this.#defs.has(kind);
  }

  /** The registered kind names, in the order they were registered. */
  kinds(): readonly string[] {
    return [...this.#defs.keys()];
  }
}

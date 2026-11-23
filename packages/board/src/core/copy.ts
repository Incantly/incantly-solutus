/**
 * Copies of record data (design 4: props are never written in place; a change writes a new record). A copy that
 * shared a `props` object or a typed array with the original would let one write change both records and the history.
 */

const isPlain = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
};

function copy(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (ArrayBuffer.isView(value)) {
    const out =
      value instanceof DataView
        ? new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
        : (value as unknown as { slice(): ArrayBufferView }).slice();
    seen.set(value, out);
    return out;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value as unknown[]) out.push(copy(item, seen));
    return out;
  }
  if (isPlain(value)) {
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [k, v] of Object.entries(value)) out[k] = copy(v, seen);
    return out;
  }
  // anything else (a class instance) is not plain data; it is shared as it is
  return value;
}

/** A deep copy of plain data (objects, arrays, numbers, text) and of typed arrays. The copy shares nothing with `value`. */
export function copyProps<T>(value: T): T {
  return copy(value, new Map()) as T;
}

/**
 * A shallow, frozen copy of an object or array; anything else (a typed array cannot be frozen) comes back as it is, and
 * so does a value that is frozen already. Used on a record's `props`, so a write in place fails loudly.
 */
export function freezeCopy<T>(value: T): T {
  if (typeof value !== 'object' || value === null || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze([...(value as unknown[])]) as unknown as T;
  if (isPlain(value)) return Object.freeze({ ...value }) as T;
  return value;
}

/** Compact, stable number formatting for SVG attributes: two decimals, no "-0". */
export function fmt(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when a serialized attribute or path contains NaN or Infinity. */
export function hasNonFinite(text: string): boolean {
  return /NaN|Infinity/.test(text);
}

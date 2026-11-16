/**
 * API errors (embed-files-export errors.md): data with an `area`, never thrown. Wrong argument types are programming
 * errors and throw `TypeError`.
 */

export type ApiArea = 'api' | 'file' | 'export' | 'share' | 'frame';

export interface ApiError {
  readonly ok: false;
  readonly area: ApiArea;
  readonly kind: string;
  readonly message: string;
  readonly hint?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export function apiError(area: ApiArea, kind: string, message: string, extra: { hint?: string; detail?: Record<string, unknown> } = {}): ApiError {
  return { ok: false, area, kind, message, ...(extra.hint !== undefined ? { hint: extra.hint } : {}), ...(extra.detail !== undefined ? { detail: extra.detail } : {}) };
}

export const isApiError = (x: unknown): x is ApiError => typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false && typeof (x as { area?: unknown }).area === 'string';

/** Throws `TypeError` unless `ok`: the argument named `what` was the wrong type. */
export function need(ok: boolean, method: string, what: string): void {
  if (!ok) throw new TypeError(`${method}: ${what}`);
}

/** Edit distance, for the close names of `unknown_name`. */
function distance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] as number;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = d[j] as number;
      d[j] = Math.min((d[j] as number) + 1, (d[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return d[b.length] as number;
}

/** Up to three names close to `name`. */
export function closeNames(name: string, names: readonly string[]): string[] {
  const lower = name.toLowerCase();
  return names
    .map((n) => ({ n, d: n.toLowerCase() === lower ? 0 : distance(lower, n.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(1, Math.floor(name.length / 3)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n))
    .slice(0, 3)
    .map((x) => x.n);
}

export function unknownName(name: string, names: readonly string[]): ApiError {
  const near = closeNames(name, names);
  return apiError('api', 'unknown_name', `${name} is not defined.`, {
    hint: near.length > 0 ? `Did you mean ${near.join(', ')}?` : 'Check the name with list().',
    detail: { name, closest: near },
  });
}

export const destroyed = (): ApiError => apiError('api', 'destroyed', 'This app was destroyed.', { hint: 'Create a new app with createApp.' });

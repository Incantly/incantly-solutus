/**
 * Compiled policies (app-modes design 3.1, 5): a mode's allow and deny lists become sets once, so every check is a
 * lookup. Also the mode lookup with its errors, `allowedInstead`, the model's catalogue and its mode card.
 */
import { MODES, MODE_IDS } from './modes';
import type { ApiError, ApiResult, AppModeId, CommandGroupId, ModeConfig, ToolGroupId, ToolId } from './types';

/** What a policy needs to know about a command: its name and its group in the command table. */
export interface CommandRef {
  readonly name: string;
  readonly group: CommandGroupId;
}

export interface CompiledPolicy {
  readonly mode: ModeConfig;
  command(name: string, group: CommandGroupId): boolean;
  fn(name: string): boolean;
  operator(op: string): boolean;
  tool(id: ToolId, group: ToolGroupId): boolean;
  view(kind: string): boolean;
}

const compiled = new WeakMap<ModeConfig, CompiledPolicy>();

/** The sets of a mode, built on first use and kept for the life of the record. */
export function compilePolicy(mode: ModeConfig): CompiledPolicy {
  const hit = compiled.get(mode);
  if (hit) return hit;
  const c = mode.commands;
  const allGroups = c.allow === 'all';
  const groups = new Set<string>(c.allow === 'all' ? [] : c.allow);
  const add = new Set(c.add ?? []);
  const deny = new Set(c.deny ?? []);
  const only = c.only ? new Set(c.only) : undefined;
  const e = mode.expressions;
  const fns = e.functions === 'all' ? undefined : new Set(e.functions);
  const fnDeny = new Set(e.denyFunctions ?? []);
  const ops = e.operators === 'all' ? undefined : new Set(e.operators);
  const toolGroups = new Set<string>(mode.tools.groups);
  const toolAdd = new Set(mode.tools.add ?? []);
  const toolDeny = new Set(mode.tools.deny ?? []);
  const views = new Set<string>(mode.views.available);
  const p: CompiledPolicy = {
    mode,
    command: (name, group) => !deny.has(name) && (only === undefined || only.has(name)) && (allGroups || groups.has(group) || add.has(name)),
    fn: (name) => !fnDeny.has(name) && (fns === undefined || fns.has(name)),
    operator: (op) => ops === undefined || ops.has(op),
    tool: (id, group) => mode.tools.toolbar !== 'none' && !toolDeny.has(id) && (toolGroups.has(group) || toolAdd.has(id)),
    view: (kind) => views.has(kind),
  };
  compiled.set(mode, p);
  return p;
}

function distance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n] as number;
}

/** Names from `pool` closest to `name`, nearest first. */
export function closest(name: string, pool: readonly string[], k = 3): string[] {
  const low = name.toLowerCase();
  return pool
    .map((p) => ({ p, d: distance(low, p.toLowerCase()) - (p.toLowerCase().startsWith(low.slice(0, 3)) ? 1 : 0) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(name.length / 2)))
    .sort((a, b) => a.d - b.d || a.p.localeCompare(b.p))
    .slice(0, k)
    .map((x) => x.p);
}

/**
 * The mode with this id. An id not in the registry is `unknown_mode` with the closest id; a mode this build cannot
 * show is `mode_unavailable` with the modes that exist (errors 2).
 */
export function getMode(id: string): ApiResult<ModeConfig> {
  const mode = (MODES as Record<string, ModeConfig | undefined>)[id];
  if (!mode) {
    const near = closest(id, MODE_IDS, 1);
    return apiError('unknown_mode', `There is no mode called '${id}'.`, near.length > 0 ? `Did you mean '${near[0]}'?` : `Modes: ${MODE_IDS.join(', ')}.`, { requested: id, closest: near[0] ?? null });
  }
  if (!mode.available) {
    const available = availableModes().map((m) => m.id);
    return apiError('mode_unavailable', mode.unavailableReason ?? `The ${id} mode is not part of this app yet.`, `Use ${available.filter((m) => m !== 'figure').slice(0, 2).map((m) => `'${m}'`).join(' or ')}.`, { requested: id, available });
  }
  return { ok: true, value: mode };
}

/** The modes this build can show, in start-screen order. */
export function availableModes(): ModeConfig[] {
  return MODE_IDS.map((id) => MODES[id]).filter((m) => m.available);
}

export function apiError(kind: string, message: string, hint?: string, detail?: Record<string, unknown>): ApiError {
  return { ok: false, area: 'api', kind, message, ...(hint !== undefined ? { hint } : {}), ...(detail ? { detail } : {}) };
}

/**
 * Up to five permitted commands near a forbidden one (errors 1): same group first, then by name; chosen from the mode's
 * own allow list, so it never names more than the mode lets in.
 */
export function allowedInstead(policy: CompiledPolicy, forbidden: CommandRef, catalogue: readonly CommandRef[]): string[] {
  const ok = catalogue.filter((c) => c.name !== forbidden.name && policy.command(c.name, c.group));
  const same = ok.filter((c) => c.group === forbidden.group).map((c) => c.name);
  const near = closest(forbidden.name, ok.map((c) => c.name), 5);
  const out: string[] = [];
  for (const n of [...near.filter((n) => same.includes(n)), ...same, ...near]) if (!out.includes(n)) out.push(n);
  return out.slice(0, 5);
}

/** The catalogue entries the mode permits: forbidden commands are absent, so the model never sees them (agent 1). */
export function filterCatalogue<T extends CommandRef>(policy: CompiledPolicy, catalogue: readonly T[]): T[] {
  return catalogue.filter((c) => policy.command(c.name, c.group));
}

/** The groups that have at least one permitted command, sorted. */
export function allowedGroups(policy: CompiledPolicy, catalogue: readonly CommandRef[]): string[] {
  return [...new Set(catalogue.filter((c) => policy.command(c.name, c.group)).map((c) => c.group))].sort();
}

/** The short text the host sends the model with the catalogue (agent 1), about 60 tokens. */
export function modeCard(mode: ModeConfig, exam: 'off' | 'on' = 'off'): string {
  const d = mode.defaults;
  const v = d.view;
  const labels = { all: 'all objects', points: 'points', none: 'none', 'new-points-only': 'new points' }[d.autoLabels];
  return [
    `mode: ${mode.derivedFrom ?? mode.id}   angle: ${d.angleUnit}   window: ${v.x0} ${v.x1} ${v.y0} ${v.y1}${v.keepRatio ? ' (1:1)' : ''}   axes: ${d.axes ? 'on' : 'off'}   grid: ${d.grid === 'none' ? 'off' : d.grid}`,
    `labels: ${labels}   dragging: ${d.dragDependent ? 'free and dependent points' : 'free points only'}   exam: ${exam}`,
  ].join('\n');
}

/** What the model's `figure()` reports for this area (agent 4). */
export function modeSummary(policy: CompiledPolicy, catalogue: readonly CommandRef[], examState: string = 'idle'): {
  mode: AppModeId; angleUnit: string; exam: { state: string }; allowedGroups: string[]; denied: string[];
} {
  const m = policy.mode;
  return {
    mode: m.derivedFrom ?? m.id,
    angleUnit: m.defaults.angleUnit,
    exam: { state: examState },
    allowedGroups: allowedGroups(policy, catalogue),
    denied: [...(m.commands.deny ?? [])].sort(),
  };
}

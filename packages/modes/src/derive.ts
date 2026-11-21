/**
 * Deriving a mode (app-modes design 3.3): a teacher narrows a mode without writing a new one. Pure, and it can only
 * remove: allow lists intersect, features only turn off. A field that tries to widen is ignored with a warning.
 */
import { compilePolicy } from './policy';
import type { ApiResult, ModeConfig, ModeRestriction, ModeWarning, ViewKind } from './types';
import type { CommandRef } from './policy';

const VIEW_KINDS: readonly ViewKind[] = ['graphics', 'algebra', 'sheet', 'cas', 'graphics3d', 'distribution', 'results', 'board', 'clock', 'datalab', 'script'];

export interface KnownNames {
  /** The command table, to find unknown names and widening allow lists. */
  readonly commands?: readonly CommandRef[];
  readonly tools?: readonly string[];
  readonly functions?: readonly string[];
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

export function deriveMode(base: ModeConfig, r: ModeRestriction, known: KnownNames = {}): ApiResult<ModeConfig> {
  const warnings: ModeWarning[] = [];
  const root = base.derivedFrom ?? base.id;
  if (r.base !== root && r.base !== base.id) {
    return { ok: false, area: 'api', kind: 'restriction_invalid', message: `This restriction narrows '${r.base}', not '${root}'.`, hint: `Set base to '${root}'.`, detail: { base: r.base, mode: root } };
  }
  const unknown = (field: string, names: readonly string[], pool: readonly string[] | undefined): readonly string[] => {
    if (!pool) return names;
    const bad = names.filter((n) => !pool.includes(n));
    if (bad.length > 0) warnings.push({ kind: 'restriction_invalid', field, names: bad, message: `Unknown names in ${field}: ${bad.join(', ')}.` });
    return names.filter((n) => pool.includes(n));
  };
  const cmdNames = known.commands?.map((c) => c.name);

  // views: hide only
  const hide = unknown('hideViews', r.hideViews ?? [], VIEW_KINDS) as readonly ViewKind[];
  const available = base.views.available.filter((v) => !hide.includes(v));
  let initial = base.views.initial.filter((v) => !hide.includes(v));
  if (initial.length === 0 && available.length > 0) initial = [available[0] as ViewKind];

  // commands: deny grows; an allow-only list intersects with what the base already permits
  const denyCommands = unknown('denyCommands', r.denyCommands ?? [], cmdNames);
  let only = base.commands.only;
  if (r.allowOnlyCommands) {
    const asked = unknown('allowOnlyCommands', r.allowOnlyCommands, cmdNames);
    const policy = compilePolicy(base);
    const permitted = known.commands
      ? asked.filter((n) => {
          const spec = known.commands?.find((c) => c.name === n);
          return spec !== undefined && policy.command(spec.name, spec.group);
        })
      : asked;
    const widened = asked.filter((n) => !permitted.includes(n));
    if (widened.length > 0) warnings.push({ kind: 'restriction_widens', field: 'allowOnlyCommands', names: widened, message: `${widened.join(', ')} ${widened.length === 1 ? 'is' : 'are'} not allowed in '${root}', so the restriction cannot let ${widened.length === 1 ? 'it' : 'them'} in.` });
    only = only ? only.filter((n) => permitted.includes(n)) : permitted;
  }

  // features: off only
  const features = { ...base.features };
  for (const [k, v] of Object.entries(r.features ?? {}) as [keyof typeof features, boolean | undefined][]) {
    if (!(k in features)) {
      warnings.push({ kind: 'restriction_invalid', field: 'features', names: [k], message: `Unknown feature ${k}.` });
      continue;
    }
    if (v === true && !base.features[k]) {
      warnings.push({ kind: 'restriction_widens', field: `features.${k}`, message: `'${root}' has ${k} off; a restriction can only turn things off.` });
      continue;
    }
    if (v === false) features[k] = false;
  }

  // defaults: a restriction cannot make dependent objects draggable or sliders appear where the base has them off
  const defaults = { ...base.defaults, ...(r.defaults ?? {}) };
  for (const k of ['autoSliders', 'dragDependent'] as const) {
    if (r.defaults?.[k] === true && !base.defaults[k]) {
      warnings.push({ kind: 'restriction_widens', field: `defaults.${k}`, message: `'${root}' has ${k} off; a restriction can only turn it off.` });
      defaults[k] = false;
    }
  }

  const denyTools = unknown('denyTools', r.denyTools ?? [], known.tools);
  const denyFunctions = unknown('denyFunctions', r.denyFunctions ?? [], known.functions);
  const mode: ModeConfig = {
    ...base,
    derivedFrom: root,
    views: { ...base.views, available, initial },
    tools: { ...base.tools, deny: uniq([...(base.tools.deny ?? []), ...denyTools]) },
    commands: { ...base.commands, deny: uniq([...(base.commands.deny ?? []), ...denyCommands]), ...(only ? { only } : {}) },
    expressions: { ...base.expressions, denyFunctions: uniq([...(base.expressions.denyFunctions ?? []), ...denyFunctions]) },
    features,
    defaults,
  };
  return { ok: true, value: mode, ...(warnings.length > 0 ? { warnings } : {}) };
}

/**
 * Reads `@restrict hide=algebra deny=Derivative,Integral only=… tools=… functions=… off=share,export` (design 3.6) into
 * a restriction of `base`. Unknown keys are reported, never guessed.
 */
export function parseRestrict(base: ModeConfig, words: readonly string[]): ApiResult<ModeRestriction> {
  const r: { -readonly [K in keyof ModeRestriction]: ModeRestriction[K] } = { base: base.derivedFrom ?? base.id };
  const bad: string[] = [];
  for (const w of words) {
    const m = /^([a-z]+)=(.*)$/.exec(w);
    if (!m) {
      bad.push(w);
      continue;
    }
    const list = (m[2] as string).split(',').map((s) => s.trim()).filter(Boolean);
    switch (m[1]) {
      case 'hide':
        r.hideViews = list as ViewKind[];
        break;
      case 'deny':
        r.denyCommands = list;
        break;
      case 'only':
        r.allowOnlyCommands = list;
        break;
      case 'tools':
        r.denyTools = list;
        break;
      case 'functions':
        r.denyFunctions = list;
        break;
      case 'off':
        r.features = Object.fromEntries(list.map((f) => [f, false]));
        break;
      default:
        bad.push(w);
    }
  }
  if (bad.length > 0) {
    return { ok: false, area: 'api', kind: 'restriction_invalid', message: `@restrict does not know ${bad.join(', ')}.`, hint: 'Use hide=, deny=, only=, tools=, functions= or off=.', detail: { names: bad } };
  }
  return { ok: true, value: r };
}

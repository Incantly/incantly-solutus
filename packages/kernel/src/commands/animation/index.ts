/**
 * The animation-time area (docs/features/animation-time): `Play`, `Pause`, `Restart`, `Trace`, `Untrace`, `ClearTrace`,
 * the trace properties, the `rerun` property, and the player's per-frame work for traces.
 *
 * Plug in with `registerAnimation(registry)`. The player itself is in `clock/player.ts`.
 */
import type { ErrorObject } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import { err } from '../../errors/table';
import { registerReasonPhrase } from '../../errors/phrases';
import type { Figure } from '../../graph/figure';
import { registerPropertyTypes } from '../../graph/props';
import type { ActionCall, ActionOutcome, CommandRegistry, RuleCall } from '../../graph/registry';
import { PROPERTIES, registerProperty } from '../../language/props';
import type { CommandSpec, ParamSpec } from '../../language/table';
import { playerOf, registerFrameTicker } from '../../clock/player';
import {
  MAX_TRACES,
  SHAPE_TRACE_TYPES,
  clearTrace,
  isTraceable,
  isTraced,
  startTrace,
  stopTrace,
  tickTraces,
  traceCount,
  traceDragStep,
  traceOptionsOf,
} from './traces';
import type { TraceOptions } from './traces';
import { PARTICLES_SPEC } from './particles';
import { GRADIENT_SPEC } from './colour';
import { particlesLineRewrite } from './particlecheck';
import { registerDragListener, registerLineCheck, registerLineRewriter, registerScriptTail } from '../../graph/registry';
import type { ParsedLine } from '../../language/ast';

const AT = { line: 0, col: 1, endCol: 1 } as const;
const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const TRACEABLE_TEXT = 'a point, segment, line, ray, vector, circle or polygon';

function action(name: string, forms: readonly { params: readonly ParamSpec[]; summary: string }[], run: (call: ActionCall) => ActionOutcome): CommandSpec {
  return {
    name,
    kind: 'action',
    group: 'animation',
    forms: forms.map((f) => ({ params: f.params, returns: null, summary: f.summary, rule: () => ({ run }) })),
  };
}

/**
 * `ValueAt(obj, time)` (design 6, where the draft called it `at`; renamed because the numbers area's `at(x, y)` is a
 * place in the plane): the value `obj` had at film time `time`. It replays the rules between the clock and the object,
 * with states from the solver and animated sliders from their tracks, so it is exact for any time. An object that does
 * not move with time is `not_time_dependent`.
 */
const VALUE_AT_SPEC: CommandSpec = {
  name: 'ValueAt',
  kind: 'object',
  group: 'animation',
  forms: [
    {
      params: [P('obj', 'Any'), P('time', 'Number')],
      returns: '=obj',
      summary: 'the value obj had at a film time',
      explain: '{name} is {0} at time {1}',
      check: (c) => (/^[A-Za-z\u0370-\u03FF_][A-Za-z0-9_\u0370-\u03FF]*$/.test(c.args[0]?.text.trim() ?? '') ? undefined : { kind: 'bad_argument', message: 'ValueAt needs the name of an object, such as ValueAt(P, 2).', param: 0, params: { command: 'ValueAt', why: 'it needs the name of an object' } }),
      rule: () => ({
        run(call: RuleCall) {
          const id = call.ids[0];
          const time = call.values[1];
          if (id === undefined) return call.fail('input_undefined', 'ValueAt needs the name of an object');
          if (typeof time !== 'number' || time !== time) return call.fail('input_undefined', 'the time is undefined');
          const slice = call.slice('t', id);
          if (!('run' in slice)) return call.fail('input_undefined', slice.message);
          if (slice.chain.length === 0 && (slice.states?.length ?? 0) === 0) return call.fail('not_time_dependent', 'it does not change with time');
          const cell = slice.run([time])[0];
          if (!cell || !cell.defined) return call.fail(cell?.reason ?? 'input_undefined', `undefined at t = ${time}`);
          return cell.value;
        },
      }),
    },
  ],
};

/** The object an action names, with the error when it cannot be traced. */
function traceTarget(call: ActionCall, command: string): { id: ObjId } | { error: ErrorObject } {
  const id = call.objects[0];
  const view = id === undefined ? undefined : call.figure.get(id);
  if (id === undefined || !view) {
    return { error: err('bad_argument', AT, { command, why: 'it needs the name of an object' }, { recovery: 'fix_line', fingerprintKey: command }) };
  }
  if (!isTraceable(view.type)) {
    return {
      error: err('not_traceable', AT, { command, why: `${view.name} is a ${view.type}, which leaves no trace. Trace ${TRACEABLE_TEXT}.` }, {
        token: view.name,
        hint: `Trace ${TRACEABLE_TEXT}.`,
        recovery: 'fix_line',
        fingerprintKey: view.type,
      }),
    };
  }
  return { id };
}

function traceRun(call: ActionCall): ActionOutcome {
  const target = traceTarget(call, 'Trace');
  if ('error' in target) return { error: target.error };
  const figure = call.figure;
  const seconds = call.values[1];
  if (seconds !== undefined && (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0)) {
    return { error: err('bad_trace_option', AT, { command: 'Trace', why: 'the window must be a number of seconds above 0' }, { hint: 'Trace(P, 5) keeps the last 5 seconds.', recovery: 'fix_line', fingerprintKey: 'window' }) };
  }
  if (!isTraced(figure, target.id) && traceCount(figure) >= MAX_TRACES) {
    return { error: err('limit', AT, { limit: 'traces', max: MAX_TRACES, got: MAX_TRACES + 1, what: 'traces' }, { hint: `A figure keeps at most ${MAX_TRACES} traces. Untrace one first.`, recovery: 'rewrite', fingerprintKey: 'traces' }) };
  }
  const style = figure.get(target.id)?.style.ext as Record<string, unknown> | undefined;
  const options: TraceOptions = {
    ...(typeof seconds === 'number' ? { window: seconds } : {}),
    fade: style?.['traceFade'] === true,
    join: style?.['traceJoin'] === true,
  };
  const notices = startTrace(figure, target.id, options);
  return { summary: `tracing ${figure.get(target.id)?.name ?? ''}`, notices };
}

function untraceRun(call: ActionCall): ActionOutcome {
  const target = traceTarget(call, 'Untrace');
  if ('error' in target) return { error: target.error };
  stopTrace(call.figure, target.id);
  return { summary: `stopped tracing ${call.figure.get(target.id)?.name ?? ''}` };
}

function clearTraceRun(call: ActionCall): ActionOutcome {
  const target = traceTarget(call, 'ClearTrace');
  if ('error' in target) return { error: target.error };
  clearTrace(call.figure, target.id);
  return { summary: `cleared the trace of ${call.figure.get(target.id)?.name ?? ''}` };
}

export const ANIMATION_COMMANDS: readonly CommandSpec[] = [
  action('Play', [{ params: [], summary: 'start the film' }], (call) => {
    playerOf(call.figure).play();
    return { summary: 'playing' };
  }),
  action('Pause', [{ params: [], summary: 'stop the film where it is' }], (call) => {
    playerOf(call.figure).pause();
    return { summary: 'paused' };
  }),
  action('Restart', [{ params: [], summary: 'put every state back to its initial value, from now on' }], (call) => {
    call.figure.solver.restartStates();
    call.figure.restartDrivers();
    call.figure.flush();
    return { summary: 'states restarted' };
  }),
  action(
    'Trace',
    [
      { params: [P('obj', 'Any')], summary: 'leave a trail behind an object' },
      { params: [P('obj', 'Any'), P('seconds', 'Number')], summary: 'leave a trail of the last few seconds' },
    ],
    traceRun,
  ),
  PARTICLES_SPEC,
  GRADIENT_SPEC,
  VALUE_AT_SPEC,
  action('Untrace', [{ params: [P('obj', 'Any')], summary: 'stop the trail and forget it' }], untraceRun),
  action('ClearTrace', [{ params: [P('obj', 'Any')], summary: 'forget the trail so far and keep tracing' }], clearTraceRun),
];

/**
 * `P with trace = true` and its options start and stop a trace like `Trace(P)` and `Untrace(P)` (design 9.1). Read on
 * each tick, so a property set while paused takes effect on the next frame or seek.
 */
function syncTraceProperties(figure: Figure): void {
  for (const o of figure.objects()) {
    if (!isTraceable(o.type)) continue;
    const ext = o.style.ext as Record<string, unknown>;
    const on = o.style.trace === true || ext['trace'] === true;
    const traced = isTraced(figure, o.id);
    const window = typeof ext['traceWindow'] === 'number' && ext['traceWindow'] > 0 ? ext['traceWindow'] : undefined;
    const options: TraceOptions = { ...(window !== undefined ? { window } : {}), fade: ext['traceFade'] === true, join: ext['traceJoin'] === true };
    if (on && !traced && traceCount(figure) < MAX_TRACES) startTrace(figure, o.id, options);
    else if (on && traced) {
      const now = traceOptionsOf(figure, o.id);
      if (now && (now.window !== options.window || now.fade !== options.fade || now.join !== options.join)) startTrace(figure, o.id, options);
    }
  }
}

let registered = false;

/** Plugs the area into a registry: its commands, properties, reason phrases and per-frame work. */
export function registerAnimation(registry: CommandRegistry): void {
  registry.registerAll(ANIMATION_COMMANDS);
  if (registered) return;
  registered = true;
  const props = {
    traceWindow: { kind: 'number', min: 0.001, allowed: 'a number of seconds above 0' },
    traceFade: { kind: 'bool', allowed: 'true or false' },
    traceJoin: { kind: 'bool', allowed: 'true or false' },
    rerun: { kind: 'enum', values: ['continue', 'restart'], allowed: 'continue or restart' },
  } as const;
  for (const [key, spec] of Object.entries(props)) if (!Object.hasOwn(PROPERTIES, key)) registerProperty(key, spec as (typeof PROPERTIES)[string]);
  const traceTypes = ['Point', ...SHAPE_TRACE_TYPES];
  registerPropertyTypes('trace', traceTypes);
  registerPropertyTypes('traceWindow', traceTypes);
  registerPropertyTypes('traceFade', traceTypes);
  registerPropertyTypes('traceJoin', traceTypes);
  registerPropertyTypes('rerun', ['Number', 'Point', 'Bool']);
  registerReasonPhrase('not_time_dependent', {
    noun: 'not a function of time',
    sentence: 'It depends on a value the learner can change, so its past values are not known.',
  });
  registerLineRewriter(particlesLineRewrite);
  registerLineCheck((_figure, _line, parsed) => animateWordCheck(parsed));
  registerFrameTicker((figure, t, how) => {
    syncTraceProperties(figure);
    tickTraces(figure, t, how);
  });
  registerScriptTail((figure) => inputLogLines(figure as Figure));
  registerDragListener((figure, changed) => {
    syncTraceProperties(figure as Figure);
    traceDragStep(figure as Figure, changed);
  });
}

/**
 * `with animate = …` (kernel ruling K11 keeps the property in the table): this area gives it one meaning, a refusal that
 * points to the one way to animate a slider, the numbers area's `loop`, `period` and `Animate(a)` (design 5).
 */
function animateWordCheck(parsed: ParsedLine): ErrorObject | undefined {
  const node = parsed.node;
  const style = node.k === 'restyle' || node.k === 'define' || node.k === 'function' ? node.style : undefined;
  const item = style?.find((s) => s.key === 'animate');
  if (!item) return undefined;
  const name = node.k === 'restyle' || node.k === 'define' || node.k === 'function' ? node.target.name : 'a';
  return err('bad_property_value', { line: 1, col: item.ks + 1, endCol: item.ke + 1 }, { key: 'animate', allowed: `not used: animate a slider with ${name} with loop = bounce, period = 8, then Animate(${name})` }, {
    token: 'animate',
    hint: `Write ${name} with loop = bounce, period = 8, then Animate(${name}). For a point, animate a slider it reads.`,
    recovery: 'fix_line',
    fingerprintKey: 'animate',
  });
}

/** A number as the script writes it: 15 significant digits, no trailing noise. */
const numText = (x: number): string => String(Number(x.toPrecision(15)));
const valueWords = (v: unknown): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return numText(v);
  const p = v as { x?: unknown; y?: unknown } | undefined;
  if (typeof p?.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) return `${numText(p.x)} ${numText(p.y)}`;
  return undefined;
};

/**
 * The film's input log as `@input` lines at the end of the script (R4.6), so a saved film replays the same: first each
 * logged input's value before its first change (`base`), then the entries in time order.
 */
export function inputLogLines(figure: Figure): string[] {
  const out: string[] = [];
  const log = figure.solver.inputLog;
  if (log.length === 0) return out;
  for (const [id, v] of figure.solver.inputBase) {
    const name = figure.get(id)?.name;
    const w = valueWords(v);
    if (name !== undefined && w !== undefined) out.push(`@input ${name} ${w} base`);
  }
  for (const e of log) {
    if (e.kind === 'reset') {
      out.push(`@input reset at ${numText(e.t)}`);
      continue;
    }
    const name = figure.get(e.id)?.name;
    const w = valueWords(e.value);
    if (name !== undefined && w !== undefined) out.push(`@input ${name} ${w} at ${numText(e.t)}`);
  }
  return out;
}

export { playerOf, registerFrameTicker, Player, FRAME_STEP, MAX_FRAME_DELTA } from '../../clock/player';
export type { PlayMode, PlayerState, PlayerEvent, PlayerLoop, ClockSource, ClockSourceKind, SeekWhy, FrameTicker } from '../../clock/player';
export { startTrace, stopTrace, clearTrace, isTraced, tracePoints, traceSnapshots, traceDragPoints, traceDragSnapshots, traceDragStep, tracedIds, tickTraces, MAX_TRACE_POINTS, MAX_SHAPE_SNAPSHOTS, MAX_TRACES } from './traces';
export type { TraceOptions } from './traces';
export { GRADIENT_SPEC, gradientAt } from './colour';
export type { LogEntry } from '../../clock/solver';
export {
  PARTICLES_SPEC,
  MAX_PARTICLES_PER_SYSTEM,
  MAX_PARTICLES_PER_FIGURE,
  hash4,
  unit4,
  particleClock,
  makeParticleBatch,
  isParticlesValue,
  ParticleShedder,
  SHED_FRAME_MS,
  SHED_AFTER,
  RECOVER_AFTER,
  MIN_QUALITY,
} from './particles';
export type { ParticleSpecPlain, ParticleBatchPlain, ParticleProgram, ParticleShaderSource, ParticleUniformSlot, ParticlesValue } from './particles';

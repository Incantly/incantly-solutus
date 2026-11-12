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
import type { ActionCall, ActionOutcome, CommandRegistry } from '../../graph/registry';
import { PROPERTIES } from '../../language/props';
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
  traceOptionsOf,
} from './traces';
import type { TraceOptions } from './traces';

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
  for (const [key, spec] of Object.entries(props)) if (!Object.hasOwn(PROPERTIES, key)) PROPERTIES[key] = spec as (typeof PROPERTIES)[string];
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
  registerFrameTicker((figure, t, how) => {
    syncTraceProperties(figure);
    tickTraces(figure, t, how);
  });
}

export { playerOf, registerFrameTicker, Player, FRAME_STEP, MAX_FRAME_DELTA } from '../../clock/player';
export type { PlayMode, PlayerState, PlayerEvent, PlayerLoop, ClockSource, ClockSourceKind, SeekWhy, FrameTicker } from '../../clock/player';
export { startTrace, stopTrace, clearTrace, isTraced, tracePoints, traceSnapshots, tracedIds, tickTraces, MAX_TRACE_POINTS, MAX_SHAPE_SNAPSHOTS, MAX_TRACES } from './traces';
export type { TraceOptions } from './traces';
export type { LogEntry } from '../../clock/solver';

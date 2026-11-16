/**
 * The sound area, kernel side (docs/features/sound; .kiro/specs/sound R1 to R3): `Tone`, `Noise` and `Melody` objects of
 * type `Sound`, the actions `Note`, `Sonify`, `Mute` and `Unmute`, the `on` condition, the limits, and `soundsAt`, which
 * says what plays at a film time. The kernel never touches audio: `packages/audio` reads `soundsAt` once a frame.
 *
 * Plug in with `registerSound(registry)`.
 */
import type { ErrorObject } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import { err } from '../../errors/table';
import { makeNotice, registerNotice } from '../../errors/notices';
import type { Notice, NoticeKind } from '../../contracts/errors';
import { registerReasonPhrase } from '../../errors/phrases';
import type { Figure } from '../../graph/figure';
import { registerTypeStyle } from '../../graph/props';
import type { ActionCall, ActionOutcome, CommandRegistry, RuleCall } from '../../graph/registry';
import { registerLineCheck, registerLineRewriter } from '../../graph/registry';
import type { CheckedLine } from '../../language/check';
import { NOTE_NAME_HINT, noteFrequency } from '../../language/notes';
import { registerValueText } from '../../language/runtime';
import type { CommandSpec, ParamSpec } from '../../language/table';

export type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type NoiseColor = 'white' | 'pink' | 'brown';

export const WAVES: readonly Wave[] = ['sine', 'square', 'sawtooth', 'triangle'];
export const NOISE_COLORS: readonly NoiseColor[] = ['white', 'pink', 'brown'];

/** The limits of design 5. */
export const SOUND_LIMITS = Object.freeze({
  minFrequency: 20,
  maxFrequency: 20_000,
  soundsPerFigure: 8,
  minNote: 0.02,
  maxNote: 2,
  notesPerSecond: 24,
  sweepSamples: 128,
});

/** A `Sound` value: plain data, computed like any value (design 3). */
export interface SoundValue {
  readonly schema: 'Sound';
  readonly kind: 'tone' | 'noise' | 'melody';
  readonly frequency?: number;
  readonly gain: number;
  readonly pan: number;
  readonly wave?: Wave;
  readonly color?: NoiseColor;
  readonly notes?: readonly number[];
  readonly beat?: number;
  readonly loop?: boolean;
  /** False while the `on` condition does not hold. */
  readonly on: boolean;
}

export function isSoundValue(v: unknown): v is SoundValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Sound';
}

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** A frequency in range; `clamped` tells the rule to add the notice once. */
function hertz(f: number): { value: number; clamped: boolean } {
  const value = clamp(f, SOUND_LIMITS.minFrequency, SOUND_LIMITS.maxFrequency);
  return { value, clamped: value !== f };
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const word = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);
const listOf = (v: unknown): number[] => (v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

function clampNotice(call: RuleCall, f: number): void {
  call.notify('out_of_range', { value: Math.round(f * 100) / 100, low: SOUND_LIMITS.minFrequency, high: SOUND_LIMITS.maxFrequency });
}

/* ------------------------------ objects ------------------------------ */

const TONE_PARAMS = [P('frequency', 'Number'), P('gain', 'Number', { optional: true }), named('wave', 'Text'), named('pan', 'Number'), named('on', 'Bool')];
const NOISE_PARAMS = [P('color', 'Text'), P('gain', 'Number', { optional: true }), named('pan', 'Number'), named('on', 'Bool')];
const MELODY_PARAMS = [P('notes', 'List<Number>'), P('beat', 'Number'), named('gain', 'Number'), named('wave', 'Text'), named('loop', 'Bool'), named('on', 'Bool')];

function toneRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [f, g, w, pan, on] = call.values;
      if (typeof f !== 'number' || !Number.isFinite(f)) return call.fail('input_undefined', 'the frequency is undefined');
      if (g !== undefined && (typeof g !== 'number' || !Number.isFinite(g))) return call.fail('input_undefined', 'the gain is undefined');
      const hz = hertz(f);
      if (hz.clamped) clampNotice(call, f);
      const v: SoundValue = { schema: 'Sound', kind: 'tone', frequency: hz.value, gain: clamp(num(g, 0.3), 0, 1), pan: clamp(num(pan, 0), -1, 1), wave: word(w, WAVES, 'sine'), on: bool(on, true) };
      return v;
    },
  };
}

function noiseRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [c, g, pan, on] = call.values;
      if (g !== undefined && (typeof g !== 'number' || !Number.isFinite(g))) return call.fail('input_undefined', 'the gain is undefined');
      const v: SoundValue = { schema: 'Sound', kind: 'noise', color: word(c, NOISE_COLORS, 'white'), gain: clamp(num(g, 0.2), 0, 1), pan: clamp(num(pan, 0), -1, 1), on: bool(on, true) };
      return v;
    },
  };
}

function melodyRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [ns, beat, g, w, loop, on] = call.values;
      const notes = listOf(ns);
      if (notes.length === 0) return call.fail('empty_list', 'a melody needs at least one note');
      if (typeof beat !== 'number' || !Number.isFinite(beat) || beat <= 0) return call.fail('input_undefined', 'the beat must be a positive number of seconds');
      let clamped: number | undefined;
      const inRange = notes.map((f) => {
        const hz = hertz(f);
        if (hz.clamped) clamped ??= f;
        return hz.value;
      });
      if (clamped !== undefined) clampNotice(call, clamped);
      const v: SoundValue = {
        schema: 'Sound', kind: 'melody', notes: inRange, beat: clamp(beat, SOUND_LIMITS.minNote, 60), gain: clamp(num(g, 0.3), 0, 1), pan: 0,
        wave: word(w, WAVES, 'triangle'), loop: bool(loop, false), on: bool(on, true),
      };
      return v;
    },
  };
}

const object = (name: string, params: readonly ParamSpec[], summary: string, rule: () => { run(call: RuleCall): unknown }, extra: readonly { params: readonly ParamSpec[]; summary: string }[] = []): CommandSpec => ({
  name,
  kind: 'object',
  group: 'sound',
  forms: [{ params, returns: 'Sound', summary, rule }, ...extra.map((f) => ({ params: f.params, returns: 'Sound', summary: f.summary, rule }))],
});

/* ------------------------------ the log of notes and sweeps ------------------------------ */

/** A one-shot sound in film time: a note, or a sweep of frequencies (`null` where the function is undefined). */
export interface SoundEvent {
  readonly key: number;
  readonly kind: 'note' | 'sweep';
  /** Film time it starts at, seconds. */
  readonly at: number;
  readonly seconds: number;
  readonly gain: number;
  readonly wave: Wave;
  readonly frequency?: number;
  readonly sweep?: readonly (number | null)[];
}

interface FigureSound {
  events: SoundEvent[];
  muted: Set<ObjId>;
  key: number;
}

const STATE = new WeakMap<object, FigureSound>();

function stateOf(figure: object): FigureSound {
  let s = STATE.get(figure);
  if (!s) STATE.set(figure, (s = { events: [], muted: new Set(), key: 0 }));
  return s;
}

const timeOf = (figure: unknown): number => (figure as { clockState?: { t: number } }).clockState?.t ?? 0;

/** The notes and sweeps recorded so far, in film time. */
export function soundEvents(figure: object): readonly SoundEvent[] {
  return stateOf(figure).events;
}

/** Forgets the notes and sweeps (a new figure, a reload). */
export function clearSoundEvents(figure: object): void {
  stateOf(figure).events.length = 0;
}

export function isMuted(figure: object, id: ObjId): boolean {
  return stateOf(figure).muted.has(id);
}

/** Mutes or unmutes one sound (the row toggle; `Mute` and `Unmute` lines do the same). */
export function setMuted(figure: object, id: ObjId, muted: boolean): void {
  const s = stateOf(figure).muted;
  if (muted) s.add(id);
  else s.delete(id);
}

/** Adds a one-shot sound at film time `at`, unless 24 already started in the second before it (design 5). */
function record(figure: object, e: Omit<SoundEvent, 'key'>): { ok: boolean } {
  const s = stateOf(figure);
  const recent = s.events.filter((x) => x.at > e.at - 1 && x.at <= e.at).length;
  if (recent >= SOUND_LIMITS.notesPerSecond) return { ok: false };
  s.events.push({ ...e, key: ++s.key });
  // keep the log small: what ended a minute of film ago cannot be heard again unless the film seeks back that far
  if (s.events.length > 2000) s.events.splice(0, s.events.length - 2000);
  return { ok: true };
}

function action(name: string, params: readonly ParamSpec[], summary: string, run: (call: ActionCall) => ActionOutcome): CommandSpec {
  return { name, kind: 'action', group: 'sound', forms: [{ params, returns: null, summary, rule: () => ({ run }) }] };
}

const NOTE = action('Note', [P('frequency', 'Number'), P('seconds', 'Number'), named('gain', 'Number'), named('wave', 'Text')], 'play one note now, for a number of seconds', (call) => {
  const [f, secs, g, w] = call.values;
  if (typeof f !== 'number' || !Number.isFinite(f) || typeof secs !== 'number' || !Number.isFinite(secs)) {
    return { error: err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Note', why: 'the frequency and the length must be numbers' }, { recovery: 'fix_line' }) };
  }
  const hz = hertz(f);
  const r = record(call.figure, { kind: 'note', at: timeOf(call.figure), seconds: clamp(secs, SOUND_LIMITS.minNote, SOUND_LIMITS.maxNote), gain: clamp(num(g, 0.3), 0, 1), wave: word(w, WAVES, 'sine'), frequency: hz.value });
  if (!r.ok) return { summary: 'note dropped', notices: [notice(rateNotice)] };
  return { summary: `note ${Math.round(hz.value)} Hz`, ...(hz.clamped ? { notices: [notice(clampedNotice(f))] } : {}) };
});

const SONIFY = action('Sonify', [P('f', 'Function<Number, 1>'), P('a', 'Number'), P('b', 'Number'), P('seconds', 'Number'), named('low', 'Number'), named('high', 'Number')], 'play f from a to b as a pitch sweep', (call) => {
  const [fn0, a, b, secs, lo, hi] = call.values;
  // a function named by its object arrives as an object id, not a value
  const fn = fn0 ?? (call.objects[0] !== undefined ? call.figure.value(call.objects[0]) : undefined);
  const f = fn as { call1?: (x: number) => number; call?: (...x: number[]) => unknown } | undefined;
  if (!f || typeof a !== 'number' || typeof b !== 'number' || typeof secs !== 'number' || !(a < b) || !(secs > 0)) {
    return { error: err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'Sonify', why: 'it needs a function, a < b and a positive length' }, { recovery: 'fix_line' }) };
  }
  const low = hertz(num(lo, 220)).value;
  const high = hertz(num(hi, 880)).value;
  const n = SOUND_LIMITS.sweepSamples;
  const ys: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const x = a + ((b - a) * i) / (n - 1);
    let y: unknown;
    try {
      y = f.call1 ? f.call1(x) : f.call?.(x);
    } catch {
      y = undefined;
    }
    ys.push(typeof y === 'number' && Number.isFinite(y) ? y : null);
  }
  const defined = ys.filter((y): y is number => y !== null);
  if (defined.length === 0) return { summary: 'silent: f is undefined on the whole interval' };
  const ymin = Math.min(...defined);
  const ymax = Math.max(...defined);
  // equal steps of y are equal musical steps between low and high (a pitch, not a frequency, scale)
  const pitch = (y: number): number => (ymax === ymin ? Math.sqrt(low * high) : low * (high / low) ** ((y - ymin) / (ymax - ymin)));
  const sweep = ys.map((y) => (y === null ? null : pitch(y)));
  const r = record(call.figure, { kind: 'sweep', at: timeOf(call.figure), seconds: clamp(secs, 0.1, 30), gain: 0.3, wave: 'sine', sweep });
  if (!r.ok) return { summary: 'sweep dropped', notices: [notice(rateNotice)] };
  return { summary: `sweep of ${Math.round(low)} to ${Math.round(high)} Hz over ${secs} s` };
});

const muteAction = (name: 'Mute' | 'Unmute'): CommandSpec => action(name, [P('s', 'Sound')], name === 'Mute' ? 'silence one sound' : 'let a muted sound play again', (call) => {
  const id = call.objects[0];
  if (id === undefined) return { error: err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: name, why: 'it needs the name of a sound' }, { recovery: 'fix_line' }) };
  setMuted(call.figure, id, name === 'Mute');
  return { summary: name === 'Mute' ? 'muted' : 'unmuted' };
});

function notice(n: { kind: string; params?: Record<string, string | number> }): Notice {
  return makeNotice(n.kind as NoticeKind, n.params ?? {});
}
const rateNotice = { kind: 'rate_limited' };
const clampedNotice = (f: number): { kind: string; params: Record<string, number> } => ({
  kind: 'out_of_range',
  params: { value: Math.round(f * 100) / 100, low: SOUND_LIMITS.minFrequency, high: SOUND_LIMITS.maxFrequency },
});

export const SOUND_SPECS: readonly CommandSpec[] = [
  object('Tone', TONE_PARAMS, 'a tone whose pitch, loudness and pan are formulas', toneRule),
  object('Noise', NOISE_PARAMS, 'white, pink or brown noise', noiseRule),
  object('Melody', MELODY_PARAMS, 'a list of pitches, one per beat, played on the film clock', melodyRule),
  NOTE,
  SONIFY,
  muteAction('Mute'),
  muteAction('Unmute'),
];

/* ------------------------------ what plays at a film time ------------------------------ */

/** One sound that plays now, ready for a player. */
export interface PlayingSound {
  /** A stable key: the object id for objects, `note:<key>` for notes and sweeps. */
  readonly key: string;
  readonly name?: string;
  readonly kind: 'tone' | 'noise';
  readonly frequency?: number;
  readonly color?: NoiseColor;
  readonly gain: number;
  readonly pan: number;
  readonly wave?: Wave;
}

export interface SoundFrame {
  readonly t: number;
  readonly sounds: readonly PlayingSound[];
  /** True when the figure has sound objects or actions at all (the speaker shows). */
  readonly hasSound: boolean;
}

/**
 * What plays at film time `t` (default: the figure's clock): every defined, unmuted, `on` sound object, the melody note
 * of the beat `t` falls in, and the notes and sweeps under way. A pure function of the figure and `t` (design 3).
 */
export function soundsAt(figure: Figure, t: number = timeOf(figure)): SoundFrame {
  const out: PlayingSound[] = [];
  const s = stateOf(figure);
  let hasSound = s.events.length > 0;
  for (const o of figure.objects()) {
    if (o.type !== 'Sound') continue;
    hasSound = true;
    if (!o.cell.defined || s.muted.has(o.id)) continue;
    const v = o.cell.value;
    if (!isSoundValue(v) || !v.on || v.gain <= 0) continue;
    const key = String(o.id);
    if (v.kind === 'melody') {
      const notes = v.notes ?? [];
      const beat = v.beat ?? 0.5;
      const step = Math.floor(Math.max(0, t) / beat + 1e-9);
      if (!v.loop && step >= notes.length) continue;
      const f = notes[step % notes.length];
      if (f === undefined) continue;
      // a short gap at the end of each beat, so repeated notes are heard as separate notes
      if (t - step * beat > beat * 0.92) continue;
      out.push({ key: `${key}:${step}`, name: o.name, kind: 'tone', frequency: f, gain: v.gain, pan: v.pan, ...(v.wave ? { wave: v.wave } : {}) });
    } else if (v.kind === 'tone') out.push({ key, name: o.name, kind: 'tone', frequency: v.frequency ?? 440, gain: v.gain, pan: v.pan, ...(v.wave ? { wave: v.wave } : {}) });
    else out.push({ key, name: o.name, kind: 'noise', color: v.color ?? 'white', gain: v.gain, pan: v.pan });
  }
  for (const e of s.events) {
    if (t < e.at || t >= e.at + e.seconds) continue;
    let f = e.frequency;
    if (e.kind === 'sweep' && e.sweep) {
      const pos = ((t - e.at) / e.seconds) * (e.sweep.length - 1);
      const i = Math.floor(pos);
      const y0 = e.sweep[i];
      const y1 = e.sweep[Math.min(i + 1, e.sweep.length - 1)];
      if (y0 === null || y0 === undefined) continue;
      f = y1 === null || y1 === undefined ? y0 : y0 + (y1 - y0) * (pos - i);
    }
    if (f === undefined) continue;
    out.push({ key: `note:${e.key}`, kind: 'tone', frequency: f, gain: e.gain, pan: 0, wave: e.wave });
  }
  return { t, sounds: out, hasSound };
}

/* ------------------------------ checks and rewrites ------------------------------ */

type Node = Record<string, unknown>;

function walk(n: unknown, visit: (n: Node) => void): void {
  if (!n || typeof n !== 'object') return;
  const o = n as Node;
  if (typeof o['n'] === 'string') visit(o);
  for (const [k, v] of Object.entries(o)) {
    if (k === 'spec' || k === 'form' || k === 'ty' || k === 'impl' || k === 'variant') continue;
    if (Array.isArray(v)) for (const x of v) walk(x, visit);
    else if (v && typeof v === 'object') walk(v, visit);
  }
}

const literalText = (n: unknown): string | undefined => {
  const t = n as { n?: string; parts?: readonly unknown[] } | undefined;
  return t?.n === 'text' && t.parts?.length === 1 && typeof t.parts[0] === 'string' ? (t.parts[0] as string) : t?.n === 'text' && t.parts?.length === 0 ? '' : undefined;
};

function soundLineCheck(figure: unknown, line: CheckedLine): ErrorObject | undefined {
  let found: ErrorObject | undefined;
  walk(line.expr, (n) => {
    if (found) return;
    // note("H4"): a literal that is not a note name (errors: check-time)
    if (n['n'] === 'builtin' && (n['spec'] as { name?: string }).name === 'note') {
      const arg = (n['args'] as unknown[])[0] as { s: number; e: number } | undefined;
      const text = literalText(arg);
      if (arg && text !== undefined && noteFrequency(text) === undefined) {
        found = err('bad_note_name', { line: line.line, col: arg.s + 1, endCol: arg.e + 1 }, { token: `"${text}"` }, { token: `"${text}"`, hint: NOTE_NAME_HINT, fingerprintKey: text });
      }
    }
    // wave = "zigzag", Noise("purple"): a word outside its set
    if (n['n'] === 'command' && (n['spec'] as { group?: string }).group === 'sound') {
      const name = (n['spec'] as { name: string }).name;
      for (const a of n['args'] as { param: ParamSpec; expr?: { s: number; e: number } }[]) {
        const allowed = a.param.name === 'wave' ? WAVES : a.param.name === 'color' ? NOISE_COLORS : undefined;
        const text = allowed ? literalText(a.expr) : undefined;
        if (allowed && a.expr && text !== undefined && !(allowed as readonly string[]).includes(text)) {
          found = err('bad_option', { line: line.line, col: a.expr.s + 1, endCol: a.expr.e + 1 }, { command: name, why: `${a.param.name} must be ${allowed.join(', ')}; "${text}" is not one of them.` }, {
            token: `"${text}"`, expected: allowed.map((x) => `"${x}"`), hint: `Write ${a.param.name === 'color' ? `${name}("${allowed[0]}")` : `wave = "${allowed[0]}"`}.`, fingerprintKey: `${a.param.name}:${text}`,
          });
        }
      }
    }
  });
  if (found) return found;
  // a 9th sound in one figure (errors: check-time)
  if (line.op === 'add' && (line.type as { k?: string } | undefined)?.k === 'Sound') {
    const f = figure as Figure;
    const count = f.objects().filter((o) => o.type === 'Sound').length;
    if (count >= SOUND_LIMITS.soundsPerFigure) {
      return err('limit', { line: line.line, col: 1, endCol: 1 }, { max: SOUND_LIMITS.soundsPerFigure, what: 'sounds in one figure' }, { hint: 'A figure plays at most 8 sounds at once. Mute or delete one.', recovery: 'rewrite', fingerprintKey: 'sounds' });
    }
  }
  return undefined;
}

/** Splits `a = 1, b = f(2, 3)` at the commas that are not inside brackets or quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && (ch === '(' || ch === '[' || ch === '{')) depth++;
    if (!quote && (ch === ')' || ch === ']' || ch === '}')) depth--;
    if (!quote && depth === 0 && ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SOUND_WITH = /^(\s*[A-Za-z\u0370-\u03FF][\w\u0370-\u03FF]*\s*=\s*(?:Tone|Noise|Melody)\(.*\))\s+with\s+(.+)$/;

/** `a = Tone(440) with on = abs(θ) < 0.02` is read as `a = Tone(440, on = abs(θ) < 0.02)`: the condition is a formula. */
function soundOnRewrite(_figure: unknown, text: string): { text: string } | undefined {
  const m = SOUND_WITH.exec(text);
  if (!m) return undefined;
  const items = splitTop(m[2] as string);
  const on = items.find((x) => /^on\s*=/.test(x));
  if (!on) return undefined;
  const call = (m[1] as string).trimEnd();
  const rest = items.filter((x) => x !== on);
  const inner = call.slice(0, -1);
  const head = `${inner}${/\(\s*$/.test(inner) ? '' : ', '}${on})`;
  return { text: rest.length > 0 ? `${head} with ${rest.join(', ')}` : head };
}

/* ------------------------------ text ------------------------------ */

/** The row text of a sound: `tone 440 Hz, gain 0.3`. */
export function soundText(v: SoundValue): string {
  const g = `gain ${Math.round(v.gain * 100) / 100}`;
  const off = v.on ? '' : ' (off)';
  if (v.kind === 'tone') return `tone ${Math.round((v.frequency ?? 0) * 100) / 100} Hz, ${g}${v.wave && v.wave !== 'sine' ? `, ${v.wave}` : ''}${off}`;
  if (v.kind === 'noise') return `${v.color ?? 'white'} noise, ${g}${off}`;
  return `melody of ${(v.notes ?? []).length} notes, ${v.beat ?? 0} s a beat${v.loop ? ', looping' : ''}${off}`;
}

let registered = false;

export function registerSound(registry: CommandRegistry): void {
  registry.registerAll(SOUND_SPECS);
  if (registered) return;
  registered = true;
  registerTypeStyle('Sound', { drawable: false });
  registerValueText((v) => (isSoundValue(v) ? soundText(v) : undefined));
  registerLineCheck((figure, line) => soundLineCheck(figure, line));
  registerLineRewriter(soundOnRewrite);
  registerNotice('out_of_range', { code: 'S101', severity: 'warning', template: '{value} Hz is outside {low} to {high} Hz; it was clamped.' });
  registerNotice('rate_limited', { code: 'S102', severity: 'warning', template: 'More than 24 notes started in one second; the extra notes were dropped.' });
  registerReasonPhrase('bad_note_name', { noun: 'not a note name', sentence: 'That text is not a note name, so it has no pitch.' });
}

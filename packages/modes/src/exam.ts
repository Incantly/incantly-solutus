/**
 * Exam mode (app-modes design 3.7, 4; ui 5; errors 3): a profile that narrows the current mode, locks settings, blocks
 * actions and records signals, driven by a small state machine. Times come from a monotonic clock that the host passes
 * in; wall times are only written into the summary for people to read. A web page cannot lock a device, and the
 * summary says so.
 */
import { deriveMode } from './derive';
import { EXAM_PROFILES } from './exam-profiles';
import { makeGate } from './gate';
import type { GateLayer } from './gate';
import { apiError, compilePolicy } from './policy';
import type { CommandRef } from './policy';
import { sha256 } from './sha256';
import type { Settings, StorageLike } from './settings';
import type { ApiError, ApiResult, ExamProfile, ExamProfileId, ExamSignal, ExamSignalKind, ExamState, ExamSummary, ModeConfig, SettingValues } from './types';
import type { LineGate } from '@incantly/kernel';

export const EXAM_NOTE = 'These checks detect some leaving of the page. They do not prevent it.';
const SESSION_KEY = 'incantly.exam.v1';

/** What the exam needs from the figure: its script, its size, and a way to put a script back. */
export interface ExamFigure {
  toScript(): string;
  objectCount(): number;
  /** Replaces the figure with a script (used to restore the learner's earlier figure on exit). */
  restore(script: string): void;
  setGate(gate: LineGate | undefined): void;
}

export type ExamAction = 'share' | 'export' | 'fileOpen' | 'fileSave' | 'network' | 'paste' | 'clipboardImages';

export interface ExamOptions {
  readonly mode: ModeConfig;
  readonly settings: Settings;
  readonly figure: ExamFigure;
  readonly catalogue: readonly CommandRef[];
  /** Monotonic milliseconds (`performance.now`). */
  readonly now: () => number;
  /** Wall time as ISO text, for the summary only. */
  readonly wallClock: () => string;
  /** `sessionStorage`, so a reload resumes the exam. */
  readonly session?: StorageLike | null;
  /** The gate layers of the mode before the exam (a teacher's restriction). */
  readonly baseLayers?: readonly GateLayer[];
}

type Listener = (state: ExamState, signal?: ExamSignal) => void;

interface Saved {
  readonly v: 1;
  readonly profile: ExamProfileId;
  readonly state: ExamState;
  readonly startedWall: string;
  readonly elapsedAtSave: number;
  readonly signals: readonly ExamSignal[];
  readonly blocked: Readonly<Record<string, number>>;
  readonly settings: SettingValues;
  readonly figure: string;
}

const NEXT: Record<ExamState, string[]> = {
  idle: ['prepare'],
  preparing: ['start', 'exit'],
  active: ['finish'],
  finished: ['exit'],
};

export class ExamController {
  private stateNow: ExamState = 'idle';
  private profileNow: ExamProfile | undefined;
  private startMono = 0;
  private startWall = '';
  private finishedAt: { mono: number; wall: string } | undefined;
  private readonly signalsNow: ExamSignal[] = [];
  private readonly blockedNow = new Map<string, number>();
  private readonly lastOfKind = new Map<ExamSignalKind, number>();
  private settingsSnap: SettingValues = {};
  private figureSnap = '';
  private examMode: ModeConfig | undefined;
  private readonly listeners = new Set<Listener>();
  private offset = 0;

  constructor(private readonly o: ExamOptions) {
    this.resume();
  }

  get state(): ExamState {
    return this.stateNow;
  }

  get profile(): ExamProfile | undefined {
    return this.profileNow;
  }

  /** The narrowed mode in force during the exam. */
  get mode(): ModeConfig {
    return this.examMode ?? this.o.mode;
  }

  get signals(): readonly ExamSignal[] {
    return this.signalsNow;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private wrongState(step: string): ApiError {
    return apiError('exam_wrong_state', `${step} is not possible while the exam is ${this.stateNow}.`, `Next: ${NEXT[this.stateNow].join(' or ')}.`, { state: this.stateNow, next: NEXT[this.stateNow] });
  }

  /** Shows the rules; the learner confirms with `start`. */
  prepare(profile: ExamProfileId | ExamProfile): ApiResult<ExamProfile> {
    if (this.stateNow !== 'idle') return this.wrongState('prepare');
    if (!this.o.mode.exam.allowed) {
      return apiError('exam_not_allowed', `The ${this.o.mode.id} mode has no exam mode.`, 'Exams run in graphing, geometry, classic, scientific, probability and CAS.', { mode: this.o.mode.id });
    }
    const p = typeof profile === 'string' ? EXAM_PROFILES[profile] : profile;
    if (!p) return apiError('exam_profile_invalid', `There is no exam profile '${String(profile)}'.`, `Profiles: ${Object.keys(EXAM_PROFILES).join(', ')}.`, { profiles: Object.keys(EXAM_PROFILES) });
    if (typeof profile === 'string' && !this.o.mode.exam.profiles.includes(profile)) {
      return apiError('exam_profile_invalid', `The ${this.o.mode.id} mode does not offer the '${profile}' exam.`, `Offered: ${this.o.mode.exam.profiles.join(', ')}.`, { profiles: this.o.mode.exam.profiles });
    }
    this.profileNow = p;
    this.set('preparing');
    return { ok: true, value: p };
  }

  /** Starts the exam. `fullscreen` says whether the browser granted full screen. */
  start(opts: { readonly fullscreen: boolean }): ApiResult<ModeConfig> {
    if (this.stateNow !== 'preparing' || !this.profileNow) return this.wrongState('start');
    const p = this.profileNow;
    if (!opts.fullscreen && p.watch.fullscreenExit) {
      return apiError('exam_fullscreen_denied', 'The browser did not allow full screen, and this exam needs it.', 'Allow full screen and try again, or ask your teacher for a profile without it.', { profile: p.id });
    }
    const derived = deriveMode(this.o.mode, { base: this.o.mode.derivedFrom ?? this.o.mode.id, ...p.restrict }, { commands: this.o.catalogue });
    if (!derived.ok) return derived;
    this.examMode = derived.value;
    this.settingsSnap = this.o.settings.snapshot();
    this.figureSnap = this.o.figure.toScript();
    for (const [id, v] of Object.entries(p.forceSettings)) this.o.settings.set(id, v);
    this.o.settings.lock(p.lockSettings, `exam profile '${p.id}'`);
    this.installGate();
    this.startMono = this.o.now();
    this.offset = 0;
    this.startWall = this.o.wallClock();
    this.signalsNow.length = 0;
    this.blockedNow.clear();
    this.lastOfKind.clear();
    this.set('active');
    return { ok: true, value: derived.value };
  }

  private installGate(): void {
    const p = this.profileNow;
    if (!p || !this.examMode) return;
    const base: GateLayer[] = this.o.baseLayers && this.o.baseLayers.length > 0 ? [...this.o.baseLayers] : [{ policy: compilePolicy(this.o.mode), reason: 'mode' }];
    const lockedDirectives = p.lockSettings.map((id) => ({ angleUnit: 'angleunit', rounding: 'rounding', coordinates: 'coords' })[id]).filter((d): d is string => d !== undefined);
    this.o.figure.setGate(makeGate({ layers: [...base, { policy: compilePolicy(this.examMode), reason: 'exam', examProfile: p.id }], catalogue: this.o.catalogue, lockedDirectives }));
  }

  /** Milliseconds since the start (monotonic). */
  elapsed(): number {
    if (this.stateNow === 'idle' || this.stateNow === 'preparing') return 0;
    const end = this.finishedAt?.mono ?? this.o.now();
    return Math.max(0, end - this.startMono + this.offset);
  }

  /** Milliseconds left, or undefined for an exam with no duration. */
  timeLeft(): number | undefined {
    const d = this.profileNow?.durationMinutes;
    return d === undefined ? undefined : Math.max(0, d * 60_000 - this.elapsed());
  }

  /**
   * Records what the host saw (focus lost, tab hidden, …). The same kind is kept at most once a second. Returns whether
   * it was recorded.
   */
  signal(kind: ExamSignalKind, detail?: string): boolean {
    if (this.stateNow !== 'active') return false;
    const p = this.profileNow;
    const watched: Partial<Record<ExamSignalKind, boolean | undefined>> = {
      focus_lost: p?.watch.focusLoss, focus_back: p?.watch.focusLoss, fullscreen_exit: p?.watch.fullscreenExit, tab_hidden: p?.watch.visibilityHidden, tab_visible: p?.watch.visibilityHidden,
    };
    if (watched[kind] === false) return false;
    const at = Math.round(this.elapsed());
    const last = this.lastOfKind.get(kind);
    if (last !== undefined && at - last < 1000) return false;
    this.lastOfKind.set(kind, at);
    const s: ExamSignal = { kind, at, ...(detail !== undefined ? { detail } : {}) };
    this.signalsNow.push(s);
    this.save();
    this.emit(s);
    return true;
  }

  /** A blocked action (share, export, paste…): the error to show inline, and a recorded signal. */
  blocked(action: ExamAction): ApiError | undefined {
    if (this.stateNow !== 'active' || !this.profileNow?.block[action]) return undefined;
    this.signal(action === 'paste' || action === 'clipboardImages' ? 'paste_blocked' : 'command_blocked', action);
    return apiError('exam_blocked', 'Not available in this exam.', `The exam turns off ${actionText(action)}.`, { action });
  }

  /** Counts a line the exam refused (`mode_forbids` with reason `exam`). */
  commandBlocked(command: string): void {
    if (this.stateNow !== 'active') return;
    this.blockedNow.set(command, (this.blockedNow.get(command) ?? 0) + 1);
    this.signal('command_blocked', command);
    this.save();
  }

  finish(): ApiResult<ExamSummary> {
    if (this.stateNow !== 'active' || !this.profileNow) return this.wrongState('finish');
    this.finishedAt = { mono: this.o.now(), wall: this.o.wallClock() };
    this.set('finished');
    return { ok: true, value: this.summary() };
  }

  /** The summary of a finished exam (also readable while it runs, for a teacher's live view). */
  summary(): ExamSummary {
    const p = this.profileNow as ExamProfile;
    const away = awayOf(this.signalsNow, this.elapsed());
    return {
      profile: p.id,
      mode: this.o.mode.derivedFrom ?? this.o.mode.id,
      startedAt: this.startWall,
      finishedAt: this.finishedAt?.wall ?? this.o.wallClock(),
      durationMs: Math.round(this.elapsed()),
      signals: [...this.signalsNow],
      away,
      flagged: away.times >= p.flagAfter.times || away.ms > p.flagAfter.seconds * 1000,
      blockedCommands: [...this.blockedNow].map(([command, count]) => ({ command, count })).sort((a, b) => b.count - a.count || a.command.localeCompare(b.command)),
      objectsAtEnd: this.o.figure.objectCount(),
      figureHash: sha256(this.o.figure.toScript()),
      note: EXAM_NOTE,
    };
  }

  /** Ends the exam: settings come back from the snapshot, and the earlier figure unless the exam figure is kept. */
  exit(opts: { readonly keepFigure?: boolean } = {}): ApiResult<{ restoredFigure: boolean; warning?: string }> {
    if (this.stateNow !== 'finished' && this.stateNow !== 'preparing') return this.wrongState('exit');
    const wasActive = this.stateNow === 'finished';
    let warning: string | undefined;
    let restoredFigure = false;
    // the mode's own gate first, so the earlier figure loads without the exam's limits
    const base = this.o.baseLayers && this.o.baseLayers.length > 0 ? this.o.baseLayers : [{ policy: compilePolicy(this.o.mode), reason: 'mode' as const }];
    this.o.figure.setGate(makeGate({ layers: base, catalogue: this.o.catalogue }));
    if (wasActive) {
      this.o.settings.unlock(this.profileNow?.lockSettings);
      try {
        this.o.settings.restore(this.settingsSnap);
      } catch {
        // exam_restore_failed: fall back to the mode's defaults
        this.o.settings.reset();
        warning = 'exam_restore_failed';
      }
      const keep = opts.keepFigure ?? this.profileNow?.keepFigure ?? false;
      if (!keep) {
        this.o.figure.restore(this.figureSnap);
        restoredFigure = true;
      }
    }
    this.examMode = undefined;
    this.profileNow = undefined;
    this.finishedAt = undefined;
    this.set('idle');
    this.clearSaved();
    return { ok: true, value: { restoredFigure, ...(warning ? { warning } : {}) } };
  }

  /* ------------------------------ persistence ------------------------------ */

  private save(): void {
    const s = this.o.session;
    if (!s || !this.profileNow || (this.stateNow !== 'active' && this.stateNow !== 'finished')) return;
    const rec: Saved = {
      v: 1, profile: this.profileNow.id, state: this.stateNow, startedWall: this.startWall, elapsedAtSave: this.elapsed(), signals: this.signalsNow,
      blocked: Object.fromEntries(this.blockedNow), settings: this.settingsSnap, figure: this.figureSnap,
    };
    try {
      s.setItem(SESSION_KEY, JSON.stringify(rec));
    } catch {
      // a full or blocked session store: the exam goes on in memory
    }
  }

  private clearSaved(): void {
    try {
      this.o.session?.removeItem(SESSION_KEY);
    } catch {
      // nothing to do
    }
  }

  /** After a reload: the exam resumes where it was and records `reload` (design 4). */
  private resume(): void {
    let raw: string | null;
    try {
      raw = this.o.session?.getItem(SESSION_KEY) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) return;
    let rec: Saved | undefined;
    try {
      rec = JSON.parse(raw) as Saved;
    } catch {
      rec = undefined;
    }
    const p = rec ? EXAM_PROFILES[rec.profile] : undefined;
    if (!rec || rec.v !== 1 || !p || (rec.state !== 'active' && rec.state !== 'finished')) return;
    this.profileNow = p;
    const derived = deriveMode(this.o.mode, { base: this.o.mode.derivedFrom ?? this.o.mode.id, ...p.restrict }, { commands: this.o.catalogue });
    if (derived.ok) this.examMode = derived.value;
    this.settingsSnap = rec.settings;
    this.figureSnap = rec.figure;
    this.startWall = rec.startedWall;
    this.startMono = this.o.now();
    this.offset = rec.elapsedAtSave;
    this.signalsNow.push(...rec.signals);
    for (const [k, v] of Object.entries(rec.blocked)) this.blockedNow.set(k, v);
    this.o.settings.lock(p.lockSettings, `exam profile '${p.id}'`);
    this.installGate();
    this.stateNow = 'active';
    if (rec.state === 'active') this.signal('reload');
    else {
      this.finishedAt = { mono: this.o.now(), wall: this.o.wallClock() };
      this.stateNow = 'finished';
    }
  }

  private set(s: ExamState): void {
    this.stateNow = s;
    this.save();
    this.emit();
  }

  private emit(signal?: ExamSignal): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(this.stateNow, signal);
      } catch {
        // a listener must not break the exam
      }
    }
  }
}

/** Times and total time away from the window: each leaving signal, until the matching return (or the end). */
export function awayOf(signals: readonly ExamSignal[], end: number): { times: number; ms: number } {
  let times = 0;
  let ms = 0;
  let since: number | undefined;
  for (const s of signals) {
    if (s.kind === 'focus_lost' || s.kind === 'tab_hidden') {
      // hiding the tab also loses focus: one leaving, not two
      if (since === undefined) times++;
      since ??= s.at;
    } else if (s.kind === 'fullscreen_exit' || s.kind === 'reload') {
      times++;
    } else if ((s.kind === 'focus_back' || s.kind === 'tab_visible') && since !== undefined) {
      ms += s.at - since;
      since = undefined;
    }
  }
  if (since !== undefined) ms += Math.max(0, end - since);
  return { times, ms };
}

function actionText(a: ExamAction): string {
  return { share: 'sharing', export: 'exporting', fileOpen: 'opening files', fileSave: 'saving files', network: 'the network', paste: 'pasting', clipboardImages: 'pasting images' }[a];
}

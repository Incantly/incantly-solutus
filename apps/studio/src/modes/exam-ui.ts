/**
 * Exam screens (app-modes ui 5; errors 3): the start sheet with the rules in plain words, the banner with the time left,
 * the notice after leaving the window, inline blocks, and the finish screen with a downloadable report. The banner uses
 * text and an icon, never colour alone. Errors never open a modal over the banner.
 */
import { EXAM_PROFILES, ExamController } from '@incantly/modes';
import type { ExamProfileId, ExamSummary, I18n, ModeConfig, Settings, StorageLike, CommandRef } from '@incantly/modes';
import type { KernelSession } from '../session';

export interface ExamScreens {
  readonly button: HTMLButtonElement;
  readonly banner: HTMLElement;
  readonly startDialog: HTMLDialogElement;
  readonly finishDialog: HTMLDialogElement;
  readonly awayNotice: HTMLElement;
  readonly controller: () => ExamController | undefined;
  /** Opens the start sheet for a profile. */
  prepare(profile?: ExamProfileId): void;
  /** Starts after the learner confirmed (`fullscreen` as the browser answered). */
  start(fullscreen: boolean): void;
  finish(): ExamSummary | undefined;
  close(keepFigure?: boolean): void;
  /** The mode changed: a new controller, and the button shows only where exams are allowed. */
  setMode(mode: ModeConfig): void;
  dispose(): void;
}

export interface ExamScreensOptions {
  readonly session: KernelSession;
  readonly settings: Settings;
  readonly i18n: I18n;
  readonly catalogue: readonly CommandRef[];
  readonly mode: ModeConfig;
  readonly say: (t: string) => void;
  /** The narrowed mode in force (null when the exam ends). */
  readonly narrowed: (m: ModeConfig | undefined) => void;
  readonly session_storage?: StorageLike | null;
  readonly now?: () => number;
  readonly every?: (ms: number, fn: () => void) => () => void;
  /** Ask the browser for full screen; resolves to whether it was granted. */
  readonly requestFullscreen?: () => Promise<boolean>;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
const btn = (label: string, cls: string, on: () => void): HTMLButtonElement => {
  const b = h('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', on);
  return b;
};
const show = (d: HTMLDialogElement): void => (typeof d.showModal === 'function' && !d.open ? d.showModal() : d.setAttribute('open', ''));
const hide = (d: HTMLDialogElement): void => {
  if (typeof d.close === 'function') d.close();
  d.removeAttribute('open');
};

/** `42:10` from milliseconds. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function mountExamScreens(o: ExamScreensOptions): ExamScreens {
  const { i18n } = o;
  const now = o.now ?? (() => performance.now());
  const every = o.every ?? ((ms: number, fn: () => void) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  });
  let mode = o.mode;
  let ctl: ExamController | undefined;
  let profileId: ExamProfileId = 'basic';
  let stopTick: (() => void) | undefined;
  let leftAt: number | undefined;

  const button = btn('🎓', 'icon-btn exam-btn', () => api.prepare());
  button.title = 'Exam mode…';
  button.setAttribute('aria-label', 'Exam mode…');

  const banner = h('div', { class: 'exam-banner', role: 'region', 'aria-label': i18n.t('exam.banner') });
  banner.hidden = true;
  const bannerText = h('span', { class: 'exam-banner-text', role: 'status' });
  const why = h('details', { class: 'exam-why' }, h('summary', {}, i18n.t('exam.why')));
  banner.append(h('span', { class: 'exam-icon', 'aria-hidden': 'true' }, '🎓'), bannerText, why, btn(i18n.t('exam.finish'), 'secondary exam-finish', () => {
    api.finish();
  }));

  const awayNotice = h('div', { class: 'exam-away', role: 'alertdialog', 'aria-live': 'assertive' });
  awayNotice.hidden = true;

  const startDialog = h('dialog', { class: 'exam-dialog', 'aria-label': i18n.t('exam.start') });
  const finishDialog = h('dialog', { class: 'exam-dialog', 'aria-label': i18n.t('exam.finished') });

  const make = (): ExamController => {
    const c = new ExamController({
      mode,
      settings: o.settings,
      catalogue: o.catalogue,
      now,
      wallClock: () => new Date().toISOString(),
      session: o.session_storage ?? null,
      figure: {
        toScript: () => o.session.save(),
        objectCount: () => o.session.figure.objects().length,
        restore: (s) => {
          o.session.load(s);
        },
        setGate: (g) => o.session.setGate(g),
      },
    });
    c.on((state) => {
      if (state === 'active') {
        o.narrowed(c.mode);
        renderBanner();
      } else if (state === 'idle') o.narrowed(undefined);
    });
    return c;
  };

  const renderBanner = (): void => {
    if (!ctl || ctl.state !== 'active') {
      banner.hidden = true;
      stopTick?.();
      stopTick = undefined;
      document.body.classList.remove('in-exam');
      return;
    }
    banner.hidden = false;
    document.body.classList.add('in-exam');
    const left = ctl.timeLeft();
    bannerText.textContent = [i18n.t('exam.banner'), ...(left !== undefined ? [i18n.t('exam.left', { time: clockText(left) })] : []), i18n.t('exam.limited')].join(' · ');
    const off = (ctl.mode.commands.deny ?? []).slice(0, 12);
    why.replaceChildren(h('summary', {}, i18n.t('exam.why')), h('p', {}, off.length > 0 ? `Off: ${off.join(', ')}${(ctl.mode.commands.deny?.length ?? 0) > 12 ? ', …' : ''}.` : 'Sharing, saving and opening files are off.'));
    stopTick ??= every(1000, () => {
      renderBanner();
      if (ctl?.timeLeft() === 0) api.finish();
    });
  };

  // the browser tells us when the learner leaves; we record, we cannot prevent
  const onVisibility = (): void => {
    if (!ctl || ctl.state !== 'active') return;
    if (document.visibilityState === 'hidden') {
      ctl.signal('tab_hidden');
      leftAt ??= ctl.elapsed();
    } else {
      ctl.signal('tab_visible');
      showAway();
    }
  };
  const onBlur = (): void => {
    if (!ctl || ctl.state !== 'active') return;
    ctl.signal('focus_lost');
    leftAt ??= ctl.elapsed();
  };
  const onFocus = (): void => {
    if (!ctl || ctl.state !== 'active') return;
    ctl.signal('focus_back');
    showAway();
  };
  const onFullscreen = (): void => {
    if (ctl?.state === 'active' && !document.fullscreenElement) ctl.signal('fullscreen_exit');
  };
  const onPaste = (e: ClipboardEvent): void => {
    if (!ctl || ctl.state !== 'active') return;
    const blocked = ctl.blocked('paste');
    if (blocked) {
      e.preventDefault();
      o.say(blocked.message);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('fullscreenchange', onFullscreen);
  document.addEventListener('paste', onPaste, true);

  const showAway = (): void => {
    if (!ctl || leftAt === undefined) return;
    const secs = Math.max(1, Math.round((ctl.elapsed() - leftAt) / 1000));
    awayNotice.replaceChildren(
      h('p', {}, i18n.t('exam.away', { at: clockText(leftAt), secs: String(secs) })),
      btn(i18n.t('exam.continue'), 'primary', () => {
        awayNotice.hidden = true;
      }),
    );
    awayNotice.hidden = false;
    leftAt = undefined;
  };

  // a line the exam refused is counted (the error itself shows inline, at the row)
  const offSession = o.session.onChange(() => undefined);
  const origSubmit = o.session.submit.bind(o.session);
  o.session.submit = (src, origin) => {
    const r = origSubmit(src, origin);
    if (!r.ok && ctl?.state === 'active' && r.error.kind === 'mode_forbids' && (r.error as { reason?: string }).reason === 'exam') {
      ctl.commandBlocked((r.error as { command?: string; function?: string }).command ?? (r.error as { function?: string }).function ?? r.error.token);
    }
    return r;
  };

  const renderStart = (): void => {
    const p = EXAM_PROFILES[profileId];
    const select = h('select', { 'aria-label': 'Exam profile' });
    for (const id of mode.exam.profiles) select.append(h('option', { value: id }, i18n.t(EXAM_PROFILES[id].title)));
    select.value = profileId;
    select.addEventListener('change', () => {
      profileId = select.value as ExamProfileId;
      ctl = make();
      const r = ctl.prepare(profileId);
      if (!r.ok) o.say(r.message);
      renderStart();
    });
    startDialog.replaceChildren(
      h('h2', {}, i18n.t('exam.start')),
      select,
      h('p', {}, i18n.t('exam.during')),
      h('ul', { class: 'exam-rules' }, ...p.rules.map((r) => h('li', {}, i18n.t(r)))),
      ...(p.durationMinutes !== undefined ? [h('p', { class: 'muted' }, i18n.t('exam.duration', { n: String(p.durationMinutes) }))] : []),
      h('div', { class: 'dialog-actions' },
        btn(i18n.t('exam.cancel'), 'secondary', () => {
          ctl?.exit();
          hide(startDialog);
        }),
        btn(i18n.t('exam.go'), 'primary', () => {
          const ask = o.requestFullscreen ?? (async () => {
            try {
              await document.documentElement.requestFullscreen?.();
              return Boolean(document.fullscreenElement);
            } catch {
              return false;
            }
          });
          void ask().then((full) => api.start(full));
        })),
    );
  };

  const renderFinish = (s: ExamSummary): void => {
    const blocked = s.blockedCommands.map((b) => `${b.command} ×${b.count}`).join(', ') || '—';
    const table = h('table', { class: 'exam-summary' },
      h('tr', {}, h('th', { scope: 'row' }, i18n.t('exam.timeUsed')), h('td', {}, `${Math.floor(s.durationMs / 60000)} min ${Math.round((s.durationMs % 60000) / 1000)} s`)),
      h('tr', {}, h('th', { scope: 'row' }, i18n.t('exam.leftWindow')), h('td', {}, `${i18n.t('exam.times', { n: s.away.times })}   (${Math.round(s.away.ms / 1000)} s)`)),
      h('tr', {}, h('th', { scope: 'row' }, i18n.t('exam.blockedActions')), h('td', {}, blocked)),
    );
    const download = (name: string, text: string, type: string): void => {
      const url = URL.createObjectURL?.(new Blob([text], { type }));
      if (!url) return;
      const a = h('a', { href: url, download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    finishDialog.replaceChildren(
      h('h2', {}, i18n.t('exam.finished')),
      table,
      h('p', { class: `exam-flag${s.flagged ? ' flagged' : ''}` }, s.flagged ? '⚑ Flagged for the teacher' : '✓ Not flagged'),
      h('p', { class: 'muted' }, s.note),
      h('div', { class: 'dialog-actions' },
        btn(i18n.t('exam.saveReport'), 'secondary', () => download('exam-report.json', JSON.stringify(s, null, 2), 'application/json')),
        btn(i18n.t('exam.saveWork'), 'secondary', () => download('exam-figure.txt', o.session.save(), 'text/plain')),
        btn(i18n.t('exam.close'), 'primary', () => api.close())),
    );
  };

  const api: ExamScreens = {
    button,
    banner,
    startDialog,
    finishDialog,
    awayNotice,
    controller: () => ctl,
    prepare(profile) {
      if (profile) profileId = profile;
      if (!mode.exam.profiles.includes(profileId)) profileId = mode.exam.profiles[0] ?? 'basic';
      ctl = make();
      const r = ctl.prepare(profileId);
      if (!r.ok) {
        o.say(r.message);
        return;
      }
      renderStart();
      show(startDialog);
    },
    start(fullscreen) {
      if (!ctl) return;
      const r = ctl.start({ fullscreen });
      if (!r.ok) {
        o.say(`${r.message} ${r.hint ?? ''}`.trim());
        return;
      }
      hide(startDialog);
      o.say('Exam started.');
      renderBanner();
    },
    finish() {
      if (!ctl) return undefined;
      const r = ctl.finish();
      if (!r.ok) {
        o.say(r.message);
        return undefined;
      }
      renderBanner();
      renderFinish(r.value);
      show(finishDialog);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
      return r.value;
    },
    close(keepFigure) {
      if (!ctl) return;
      const r = ctl.exit(keepFigure !== undefined ? { keepFigure } : {});
      if (!r.ok) o.say(r.message);
      hide(finishDialog);
      awayNotice.hidden = true;
      renderBanner();
    },
    setMode(m) {
      if (ctl && (ctl.state === 'active' || ctl.state === 'finished')) return;
      mode = m;
      button.hidden = !m.exam.allowed;
    },
    dispose() {
      stopTick?.();
      offSession();
      o.session.submit = origSubmit;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('paste', onPaste, true);
      document.body.classList.remove('in-exam');
    },
  };
  button.hidden = !mode.exam.allowed;
  // a reload during an exam resumes it (design 4)
  if (o.session_storage?.getItem('incantly.exam.v1')) {
    ctl = make();
    if (ctl.state === 'active') {
      o.narrowed(ctl.mode);
      renderBanner();
    } else if (ctl.state === 'finished') {
      renderFinish(ctl.summary());
      show(finishDialog);
    }
  }
  return api;
}

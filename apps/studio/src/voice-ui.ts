/**
 * The Talk button and its panel (server design 8, R7.3 to R7.5): a button in the top bar that opens a small panel with the
 * lesson's transcript, a microphone button (where the browser can listen), a text box (always: it is the input where the
 * browser cannot listen, and a way to barge in by typing) and Stop. The panel reads the lesson's machine and draws it;
 * it holds no state of its own beyond whether it is open.
 */
import { browserRecogniser, browserVoice, canListen, speechClips, unlockAudio } from './voice-audio';
import { VoiceLesson } from './voice';
import type { LessonTarget, VoiceState } from './voice';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

/** What the panel says for each state. */
export const STATE_TEXT: Readonly<Record<VoiceState, string>> = {
  idle: 'Ready. Press the microphone or type a question.',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

export interface VoiceUiOptions {
  /** The lesson's target now: the board when it is open, else the figure; undefined when neither can be taught on. */
  readonly target: () => LessonTarget | undefined;
  /** The network, for tests; default the global `fetch`. */
  readonly fetch?: typeof fetch;
}

export interface VoiceUi {
  /** The Talk button for the top bar. */
  readonly button: HTMLButtonElement;
  /** The panel; put it in the page once. */
  readonly panel: HTMLElement;
  readonly lesson: VoiceLesson;
  /** Shows or hides the Talk button (a view with no figure has nothing to teach on). */
  setAvailable(available: boolean): void;
  dispose(): void;
}

export function mountVoice(options: VoiceUiOptions): VoiceUi {
  const hearing = canListen();
  const status = el('p', { class: 'voice-status', role: 'status', 'aria-live': 'polite' });
  const heard = el('p', { class: 'voice-heard', 'aria-live': 'off' });
  const log = el('ol', { class: 'voice-log', 'aria-label': 'The lesson so far' });
  const input = el('input', { type: 'text', class: 'voice-input', 'aria-label': 'Say it in words', placeholder: hearing ? 'Or type here' : 'Type your question here', autocomplete: 'off' });
  const mic = el('button', { type: 'button', class: 'icon-btn voice-mic', title: 'Talk', 'aria-label': 'Talk', 'aria-pressed': 'false' }, '🎙');
  const send = el('button', { type: 'button', class: 'secondary voice-send', title: 'Send', 'aria-label': 'Send' }, 'Send');
  const stop = el('button', { type: 'button', class: 'secondary voice-stop', title: 'Stop the teacher', 'aria-label': 'Stop' }, 'Stop');
  const close = el('button', { type: 'button', class: 'icon-btn voice-close', title: 'Close', 'aria-label': 'Close the talk panel' }, '×');
  const panel = el('section', { class: 'voice-panel', 'aria-label': 'Talk to the teacher' }, el('header', { class: 'voice-head' }, el('strong', {}, 'Talk'), close), log, heard, status, el('div', { class: 'voice-row' }, hearing ? mic : '', input, send, stop));
  panel.hidden = true;
  const button = el('button', { type: 'button', class: 'tool-btn voice-talk', title: 'Talk to the teacher', 'aria-label': 'Talk to the teacher', 'aria-expanded': 'false' }, '🎙 Talk');

  const draw = (): void => {
    const state = lesson.state;
    panel.dataset['state'] = state;
    status.textContent = STATE_TEXT[state];
    heard.textContent = state === 'listening' ? lesson.interim : '';
    mic.setAttribute('aria-pressed', String(state === 'listening'));
    mic.classList.toggle('on', state === 'listening');
    stop.disabled = state === 'idle';
    log.replaceChildren(...lesson.transcript.map((l) => el('li', { class: `voice-${l.who}` }, l.text)));
    log.scrollTop = log.scrollHeight;
  };
  const lesson = new VoiceLesson({
    target: options.target,
    clips: speechClips(options.fetch),
    browserVoice: browserVoice(),
    ...(hearing ? { recogniser: browserRecogniser, canListen: true } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    onChange: draw,
  });

  const submit = (): void => {
    if (lesson.type(input.value)) input.value = '';
  };
  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('on', open);
  };
  button.addEventListener('click', () => {
    if (!panel.hidden) {
      lesson.stop();
      setOpen(false);
      return;
    }
    unlockAudio();
    setOpen(true);
    draw();
    // a first press starts listening where the browser can; otherwise the text box has the focus
    if (hearing && lesson.state === 'idle') lesson.listen();
    else input.focus();
  });
  close.addEventListener('click', () => {
    lesson.stop();
    setOpen(false);
  });
  mic.addEventListener('click', () => {
    unlockAudio();
    if (lesson.state === 'listening') lesson.stop();
    else lesson.listen();
  });
  send.addEventListener('click', () => {
    unlockAudio();
    submit();
  });
  stop.addEventListener('click', () => void lesson.stop());
  input.addEventListener('keydown', (e) => {
    // keys typed in the box are not the studio's shortcuts
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      unlockAudio();
      submit();
    }
  });
  draw();
  return {
    button,
    panel,
    lesson,
    setAvailable(available) {
      button.hidden = !available;
      if (!available) {
        lesson.stop();
        setOpen(false);
      }
    },
    dispose() {
      lesson.dispose();
    },
  };
}

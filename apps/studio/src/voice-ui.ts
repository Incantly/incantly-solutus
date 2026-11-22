/**
 * The Talk button and its panel (server design 8, R7.3 to R7.5; lesson design 1, 6, R1): a button in the top bar that opens
 * a small panel with the transcript, a microphone button (where the browser can listen), a text box (always: it is the input
 * where the browser cannot listen, and a way to barge in by typing) and the buttons of the lesson. The panel reads the
 * machines and draws them; it holds no state of its own beyond whether it is open.
 *
 * On a board the panel holds a lesson, a conversation (`lesson.ts`): Start lesson (the first words in the text box, or the
 * microphone), End lesson, and the plan with the step now at the top. In a graph or geometry view it is the single-turn
 * voice (`voice.ts`). Opening the panel starts nothing and listens to nothing (TR-50): only the microphone, Start lesson or
 * a sent text does.
 */
import { LessonConversation } from './lesson';
import type { ConversationState, ConversationTarget } from './lesson';
import { browserRecogniser, browserVoice, canListen, speechClips, unlockAudio } from './voice-audio';
import { VoiceLesson } from './voice';
import type { LessonTarget, VoiceLine, VoiceState } from './voice';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

/** What the panel says for each state of the single-turn voice. */
export const STATE_TEXT: Readonly<Record<VoiceState, string>> = {
  idle: 'Ready. Press the microphone or type a question.',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

/** What the panel says for each state of the conversation; `off` and `listening` depend on the browser and the transcript. */
export function conversationText(state: ConversationState, hearing: boolean, micOpen: boolean, started: boolean): string {
  switch (state) {
    case 'off':
      if (started) return 'The lesson has ended. Start a new lesson to go on.';
      return hearing ? 'Type what you want to learn and press Start lesson, or press the microphone and say it.' : 'Type what you want to learn and press Start lesson.';
    case 'listening':
      return micOpen ? 'Listening… (press the microphone or Space to stop)' : 'Your turn: type your answer.';
    case 'thinking':
      return 'Thinking…';
    case 'speaking':
      return 'Speaking… (press the microphone or Space to interrupt)';
    case 'paused':
      return hearing ? 'Paused. Press the microphone or type to go on.' : 'Paused. Type to go on.';
  }
}

export interface VoiceUiOptions {
  /** The single-turn lesson's target now: the figure of a graph or geometry view; undefined when it cannot be taught on. */
  readonly target: () => LessonTarget | undefined;
  /** The board the lesson is held on, when the board is open; undefined elsewhere (the panel is then the single-turn voice). */
  readonly conversation?: () => ConversationTarget | undefined;
  /** The network, for tests; default the global `fetch`. */
  readonly fetch?: typeof fetch;
}

export interface VoiceUi {
  /** The Talk button for the top bar. */
  readonly button: HTMLButtonElement;
  /** The panel; put it in the page once. */
  readonly panel: HTMLElement;
  /** The single-turn voice of graph and geometry views. */
  readonly lesson: VoiceLesson;
  /** The lesson on the board. */
  readonly conversation: LessonConversation;
  /** Shows or hides the Talk button (a view with no figure has nothing to teach on). */
  setAvailable(available: boolean): void;
  dispose(): void;
}

/** True when a key event came from a place that takes the key as text or a press: the text box, a button, a field. */
function takesKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

export function mountVoice(options: VoiceUiOptions): VoiceUi {
  const hearing = canListen();
  const status = el('p', { class: 'voice-status', role: 'status', 'aria-live': 'polite' });
  const heard = el('p', { class: 'voice-heard', 'aria-live': 'off' });
  const log = el('ol', { class: 'voice-log', 'aria-label': 'The lesson so far' });
  const step = el('p', { class: 'voice-step' });
  const steps = el('ol', { class: 'voice-steps', 'aria-label': 'The plan of the lesson' });
  const plan = el('div', { class: 'voice-plan' }, step, steps);
  plan.hidden = true;
  const input = el('input', { type: 'text', class: 'voice-input', 'aria-label': 'Say it in words', placeholder: hearing ? 'Or type here' : 'Type your question here', autocomplete: 'off' });
  const mic = el('button', { type: 'button', class: 'icon-btn voice-mic', title: 'Talk', 'aria-label': 'Talk', 'aria-pressed': 'false' }, '🎙');
  const send = el('button', { type: 'button', class: 'secondary voice-send', title: 'Send', 'aria-label': 'Send' }, 'Send');
  const stop = el('button', { type: 'button', class: 'secondary voice-stop', title: 'Stop the teacher', 'aria-label': 'Stop' }, 'Stop');
  const startLesson = el('button', { type: 'button', class: 'voice-start', title: 'Start a lesson', 'aria-label': 'Start lesson' }, 'Start lesson');
  const endLesson = el('button', { type: 'button', class: 'secondary voice-end', title: 'End the lesson', 'aria-label': 'End lesson' }, 'End lesson');
  const close = el('button', { type: 'button', class: 'icon-btn voice-close', title: 'Close', 'aria-label': 'Close the talk panel' }, '×');
  const panel = el(
    'section',
    { class: 'voice-panel', 'aria-label': 'Talk to the teacher' },
    el('header', { class: 'voice-head' }, el('strong', {}, 'Talk'), close),
    plan,
    log,
    heard,
    status,
    el('div', { class: 'voice-row' }, hearing ? mic : '', input, send, stop),
    el('div', { class: 'voice-lesson-row' }, startLesson, endLesson),
  );
  panel.hidden = true;
  const button = el('button', { type: 'button', class: 'tool-btn voice-talk', title: 'Talk to the teacher', 'aria-label': 'Talk to the teacher', 'aria-expanded': 'false' }, '🎙 Talk');

  /** The state the panel showed last, so the text box takes the focus once when a lesson gives the learner the turn. */
  const shown: { was: ConversationState } = { was: 'off' };

  /** True when the panel is the lesson of a board: a board is open, or a lesson is still on. */
  const lessonMode = (): boolean => conversation.state !== 'off' || options.conversation?.() !== undefined;

  const drawPlan = (): void => {
    const view = conversation.view;
    plan.hidden = view.plan.length === 0;
    if (plan.hidden) return;
    const now = Math.min(Math.max(view.step, 1), view.plan.length);
    step.textContent = `Step ${now} of ${view.plan.length}: ${view.plan[now - 1] ?? ''}`;
    steps.replaceChildren(
      ...view.plan.map((title, i) => {
        const item = el('li', { class: i + 1 === now ? 'voice-step-now' : '' }, title);
        if (i + 1 === now) item.setAttribute('aria-current', 'step');
        return item;
      }),
    );
  };

  const drawLines = (lines: readonly VoiceLine[]): void => {
    log.replaceChildren(...lines.map((l) => el('li', { class: `voice-${l.who}` }, l.text)));
    log.scrollTop = log.scrollHeight;
  };

  const draw = (): void => {
    const asLesson = lessonMode();
    panel.dataset['mode'] = asLesson ? 'lesson' : 'single';
    if (asLesson) {
      const state = conversation.state;
      panel.dataset['state'] = state;
      status.textContent = conversationText(state, hearing, conversation.micOpen, conversation.transcript.length > 0);
      heard.textContent = state === 'listening' ? conversation.interim : '';
      mic.setAttribute('aria-pressed', String(conversation.micOpen));
      mic.classList.toggle('on', conversation.micOpen);
      startLesson.hidden = state !== 'off';
      startLesson.textContent = conversation.transcript.length > 0 ? 'Start a new lesson' : 'Start lesson';
      endLesson.hidden = state === 'off';
      send.hidden = state === 'off';
      stop.hidden = true;
      input.placeholder = state === 'off' ? 'What do you want to learn?' : hearing ? 'Or type here' : 'Type your answer here';
      drawPlan();
      drawLines(conversation.transcript);
      // where nothing can listen, the learner's turn is the text box's
      if (state === 'listening' && shown.was !== 'listening' && !conversation.micOpen && !panel.hidden) input.focus();
      shown.was = state;
      return;
    }
    const state = lesson.state;
    panel.dataset['state'] = state;
    status.textContent = STATE_TEXT[state];
    heard.textContent = state === 'listening' ? lesson.interim : '';
    mic.setAttribute('aria-pressed', String(state === 'listening'));
    mic.classList.toggle('on', state === 'listening');
    startLesson.hidden = true;
    endLesson.hidden = true;
    send.hidden = false;
    stop.hidden = false;
    stop.disabled = state === 'idle';
    input.placeholder = hearing ? 'Or type here' : 'Type your question here';
    plan.hidden = true;
    drawLines(lesson.transcript);
  };

  const fetchOption = options.fetch !== undefined ? { fetch: options.fetch } : {};
  const clips = speechClips(options.fetch);
  const voice = browserVoice();
  const lesson = new VoiceLesson({
    target: options.target,
    clips,
    browserVoice: voice,
    ...(hearing ? { recogniser: browserRecogniser, canListen: true } : {}),
    ...fetchOption,
    onChange: draw,
  });
  const conversation = new LessonConversation({
    target: () => options.conversation?.(),
    clips,
    browserVoice: voice,
    ...(hearing ? { recogniser: browserRecogniser, canListen: true } : {}),
    ...fetchOption,
    onChange: draw,
  });

  /** Text typed in the box: the first words of a lesson, an answer, or a question of the single-turn voice. */
  const submit = (): void => {
    const sent = lessonMode() ? (conversation.state === 'off' ? conversation.start(input.value) : conversation.type(input.value)) : lesson.type(input.value);
    if (sent) input.value = '';
  };
  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('on', open);
  };
  /** The panel is closed: the teacher stops and the lesson waits; nothing is ended. */
  const closePanel = (): void => {
    lesson.stop();
    conversation.pause();
    setOpen(false);
  };
  button.addEventListener('click', () => {
    if (!panel.hidden) {
      closePanel();
      return;
    }
    unlockAudio();
    setOpen(true);
    draw();
    // opening the panel starts nothing and listens to nothing (TR-50): the text box has the focus, the microphone is a press away
    input.focus();
  });
  close.addEventListener('click', closePanel);
  mic.addEventListener('click', () => {
    unlockAudio();
    if (lessonMode()) {
      conversation.tap();
      return;
    }
    if (lesson.state === 'listening') lesson.stop();
    else lesson.listen();
  });
  send.addEventListener('click', () => {
    unlockAudio();
    submit();
  });
  stop.addEventListener('click', () => void lesson.stop());
  startLesson.addEventListener('click', () => {
    unlockAudio();
    if (input.value.trim() !== '') submit();
    else if (hearing) conversation.listen();
    else input.focus();
  });
  endLesson.addEventListener('click', () => void conversation.end());
  input.addEventListener('keydown', (e) => {
    // keys typed in the box are not the studio's shortcuts
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      unlockAudio();
      submit();
    }
  });
  // Space interrupts the teacher (design 6): only while the teacher talks or thinks, and not in a field or on a button
  const onSpace = (e: KeyboardEvent): void => {
    if (e.key !== ' ' || e.repeat || panel.hidden || takesKey(e.target)) return;
    const state = conversation.state;
    if (state !== 'thinking' && state !== 'speaking') return;
    e.preventDefault();
    e.stopPropagation();
    unlockAudio();
    conversation.interrupt();
  };
  document.addEventListener('keydown', onSpace, true);
  draw();
  return {
    button,
    panel,
    lesson,
    conversation,
    setAvailable(available) {
      button.hidden = !available;
      if (!available) {
        lesson.stop();
        conversation.end();
        setOpen(false);
      }
    },
    dispose() {
      document.removeEventListener('keydown', onSpace, true);
      lesson.dispose();
      conversation.dispose();
    },
  };
}

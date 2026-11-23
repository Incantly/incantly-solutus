/**
 * The agent panel (ui.md, "The talking agent"; docs/state-machines.md B35): the conversation with the agent, a box to talk
 * to it, a Stop button that ends the job at once (what it drew stays), and a small hand icon that moves to where the agent
 * draws. The panel keeps no copy of the conversation: it shows the service's list. It is shown when the board has an agent.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { AgentService } from '../../core/agent-service';
import type { Camera } from '../../core/camera';
import { refusedMove } from '../../core/errors';
import type { ErrorSink } from '../../core/errors';
import { sendIfAble } from '../../core/machine';
import type { Strings } from '../../core/strings';
import { defaultIcon } from './icons';

type PanelState = 'closed' | 'open' | 'busy';
type PanelEvent = 'open' | 'close' | 'begin' | 'end';

export const PANEL_MACHINE: MachineTable<PanelState, PanelEvent> = {
  closed: { open: 'open', begin: 'busy', end: 'closed' },
  open: { close: 'closed', begin: 'busy' },
  busy: { end: 'open', close: 'closed' },
};

const h = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

export interface AgentPanelOptions {
  readonly doc: Document;
  /** The board's element: the panel, its button and the hand icon go in it. */
  readonly root: HTMLElement;
  readonly service: AgentService;
  readonly strings: Strings;
  /** A line under the title, for a stand-in agent (the studio's scripted demo says so here). */
  readonly label?: string;
  readonly onError: ErrorSink;
}

export class AgentPanel {
  readonly element: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly hand: HTMLElement;
  readonly #o: AgentPanelOptions;
  readonly #machine: StateMachine<PanelState, PanelEvent>;
  readonly #log: HTMLElement;
  readonly #input: HTMLInputElement;
  readonly #allow: HTMLInputElement;
  readonly #send: HTMLButtonElement;
  readonly #stop: HTMLButtonElement;
  readonly #note: HTMLElement;
  readonly #off: () => void;
  /** The newest entry shown; entries come with growing ids. */
  #shown = 0;
  /** How many requests the panel has seen start. */
  #seen = 0;
  /** Where the agent works, in page units. */
  #handX = 0;
  #handY = 0;

  constructor(options: AgentPanelOptions) {
    this.#o = options;
    const { doc, strings } = options;
    this.#machine = new StateMachine(PANEL_MACHINE, 'closed', refusedMove('agent panel', () => options.onError));
    this.#log = h(doc, 'div', { class: 'ib-agent-log', role: 'log', 'aria-live': 'polite', 'aria-label': strings.t('agent.label') });
    this.#input = h(doc, 'input', { type: 'text', class: 'ib-agent-input', placeholder: strings.t('agent.placeholder'), 'aria-label': strings.t('agent.placeholder'), maxlength: '2000' });
    this.#send = h(doc, 'button', { type: 'submit', class: 'ib-agent-send' }, strings.t('agent.send'));
    this.#stop = h(doc, 'button', { type: 'button', class: 'ib-agent-stop', 'data-action': 'agent-stop', hidden: '' }, strings.t('agent.stop'));
    this.#allow = h(doc, 'input', { type: 'checkbox', id: 'ib-agent-allow' });
    this.#note = h(doc, 'div', { class: 'ib-agent-note', role: 'status' });
    const close = h(doc, 'button', { type: 'button', class: 'ib-agent-close', 'aria-label': strings.t('agent.close'), title: strings.t('agent.close') }, '×');
    const form = h(doc, 'form', { class: 'ib-agent-form' }, this.#input, this.#send, this.#stop);
    const allow = h(doc, 'label', { class: 'ib-agent-allow' }, this.#allow, ` ${strings.t('agent.allow')}`);
    this.element = h(
      doc,
      'aside',
      { class: 'ib-bar ib-agent', 'aria-label': strings.t('agent.label'), hidden: '' },
      h(doc, 'div', { class: 'ib-agent-head' }, h(doc, 'strong', {}, strings.t('agent.label')), close),
      ...(options.label !== undefined ? [h(doc, 'div', { class: 'ib-agent-demo', 'data-demo': '' }, options.label)] : []),
      this.#log,
      this.#note,
      form,
      allow,
    );
    this.toggle = h(doc, 'button', { type: 'button', class: 'ib-bar ib-agent-toggle', 'data-action': 'agent', 'aria-expanded': 'false', title: strings.t('agent.open') }, strings.t('agent.label'));
    this.hand = h(doc, 'div', { class: 'ib-hand', 'aria-hidden': 'true', hidden: '' });
    this.hand.innerHTML = defaultIcon('hand') ?? '';
    options.root.append(this.element, this.toggle, this.hand);
    close.addEventListener('click', () => this.close());
    this.toggle.addEventListener('click', () => (this.#machine.is('closed') ? this.open() : this.close()));
    this.#stop.addEventListener('click', () => options.service.stop());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.say();
    });
    this.element.addEventListener('keydown', (e) => e.stopPropagation());
    this.#off = options.service.on(() => this.#sync());
    this.#sync();
    this.#note.textContent = options.service.available ? '' : strings.t('agent.unavailable');
    this.#input.disabled = !options.service.available;
    this.#send.disabled = !options.service.available;
  }

  /** `closed`, `open` or `busy`. */
  get state(): PanelState {
    return this.#machine.state;
  }

  open(): void {
    if (!sendIfAble(this.#machine, 'open')) return;
    this.#render();
  }

  close(): void {
    if (!sendIfAble(this.#machine, 'close')) return;
    this.#render();
  }

  /** Sends what the user wrote in the box. */
  say(): void {
    const text = this.#input.value.trim();
    if (text === '' || !this.#machine.is('open')) return;
    this.#input.value = '';
    void this.#o.service.talk(text, this.#allow.checked);
  }

  /** The agent works at this page point (the runner and the hand animation tell it). */
  handAt(x: number, y: number): void {
    this.#handX = x;
    this.#handY = y;
  }

  /** Puts the hand icon where the agent works; it shows only while a request runs. */
  place(camera: Camera | undefined): void {
    const busy = this.#machine.is('busy');
    this.hand.hidden = !busy || camera === undefined;
    if (!busy || camera === undefined) return;
    const p = camera.toScreen(this.#handX, this.#handY);
    this.hand.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }

  dispose(): void {
    this.#off();
    this.element.remove();
    this.toggle.remove();
    this.hand.remove();
  }

  /** Follows the service: a new request opens the panel as busy, the end of the job takes it back to open. */
  #sync(): void {
    const { service } = this.#o;
    if (service.started !== this.#seen) {
      this.#seen = service.started;
      if (service.busy) sendIfAble(this.#machine, 'begin');
    }
    if (!service.busy) sendIfAble(this.#machine, 'end');
    this.#render();
  }

  #render(): void {
    const { service, strings, root } = this.#o;
    const state = this.#machine.state;
    this.element.hidden = state === 'closed';
    this.toggle.setAttribute('aria-expanded', String(state !== 'closed'));
    root.dataset['agent'] = state === 'closed' ? 'closed' : 'open';
    root.dataset['agentState'] = state;
    this.#stop.hidden = state !== 'busy';
    // the hand icon shows only while a request runs, whether or not a frame follows
    if (state !== 'busy') this.hand.hidden = true;
    this.#send.hidden = state === 'busy';
    this.#input.disabled = state === 'busy' || !service.available;
    const entries = service.entries;
    if (entries.length === 0 && this.#log.childElementCount === 0) {
      this.#log.append(h(this.#o.doc, 'div', { class: 'ib-agent-empty' }, strings.t('agent.empty')));
    }
    for (const e of entries) {
      if (e.id <= this.#shown) continue;
      this.#log.querySelector('.ib-agent-empty')?.remove();
      this.#log.append(h(this.#o.doc, 'div', { class: `ib-agent-line ib-agent-${e.who}`, 'data-who': e.who }, e.text));
      this.#shown = e.id;
    }
    while (this.#log.childElementCount > 200) this.#log.firstElementChild?.remove();
    this.#log.scrollTop = this.#log.scrollHeight;
  }
}

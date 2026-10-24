import type { RendererMessage } from '../protocol/runtime-messages';
import { EASES, FRAME_CAPS, LOOP_MODES, SPEEDS } from '../protocol/runtime-messages';
import type { ActionView, ParamView, ReadoutView, TimingView } from '../protocol/ui';

type Send = (message: RendererMessage) => void;

interface ParamInputs {
  readonly kind: ParamView['kind'];
  readonly range?: HTMLInputElement;
  readonly number?: HTMLInputElement;
  readonly check?: HTMLInputElement;
  readonly select?: HTMLSelectElement;
  readonly buttons?: HTMLButtonElement[];
}

const formatSpeed = (speed: number) => `${speed}×`;

const LOOP_LABELS: Readonly<Record<string, string>> = { loop: 'Loop', once: 'Once', pingpong: 'Back and forth' };
const EASE_LABELS: Readonly<Record<string, string>> = { linear: 'Steady', in: 'Speed up', out: 'Slow down', inOut: 'Smooth', spring: 'Spring' };

/** Which parts of the controls show; integrators switch them off in the figure style. */
export interface ControlsShow {
  readonly transport: boolean;
  readonly speed: boolean;
  readonly settings: boolean;
  readonly undo: boolean;
  readonly fullscreen: boolean;
}

/**
 * Engine-built controls (EN-12): one factory for every parameter kind
 * (slider, toggle, choice, colour), buttons and presets, the transport with
 * undo and redo, and the settings panel with timing (CT-4, CT-9).
 */
export class ControlsView {
  readonly element: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly restart: HTMLButtonElement;
  private readonly speed: HTMLSelectElement;
  private readonly speedLabel: HTMLLabelElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly compareButton: HTMLButtonElement;
  private readonly transport: HTMLElement;
  private readonly settings: HTMLElement;
  private readonly timing: HTMLElement;
  private readonly duration: HTMLInputElement;
  private readonly loop: HTMLSelectElement;
  private readonly ease: HTMLSelectElement;
  private readonly cap: HTMLSelectElement;
  private readonly frameStep: HTMLButtonElement;
  private readonly paramsElement: HTMLElement;
  private readonly actionsElement: HTMLElement;
  private readonly inputs = new Map<string, ParamInputs>();
  /** Each parameter's value as the figure last reported it. */
  private readonly latest = new Map<string, string>();
  /** Number fields to bring back to the figure's value at its next report, focused or not. */
  private readonly resync = new Set<string>();
  private signature = '';
  private actionsSignature = '';
  private playing = false;
  private animated: boolean | null = null;
  /** Frame-rate cap chosen in the settings panel; 0 means none. */
  frameCap = 0;
  onFrameCap: ((cap: number) => void) | null = null;
  onFullscreen: (() => void) | null = null;

  constructor(
    private readonly doc: Document,
    private readonly scope: string,
    send: Send,
    signal: AbortSignal,
    private show: ControlsShow = { transport: true, speed: true, settings: true, undo: true, fullscreen: true },
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'inc-controls';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', 'Figure controls');

    const transport = doc.createElement('div');
    transport.className = 'inc-transport';
    this.toggle = this.button('toggle', 'Play');
    this.toggle.classList.add('inc-primary');
    this.restart = this.button('restart', 'Restart');
    const reset = this.button('reset', 'Reset');
    reset.title = 'Restore the original values';
    const speedLabel = doc.createElement('label');
    this.speedLabel = speedLabel;
    speedLabel.className = 'inc-speed';
    speedLabel.textContent = 'Speed ';
    this.speed = doc.createElement('select');
    this.speed.dataset.action = 'speed';
    for (const s of SPEEDS) this.speed.append(option(doc, String(s), formatSpeed(s)));
    this.speed.value = '1';
    speedLabel.append(this.speed);
    speedLabel.hidden = !show.speed;
    this.undoButton = this.button('undo', 'Undo');
    this.undoButton.setAttribute('aria-keyshortcuts', 'Control+Z');
    this.redoButton = this.button('redo', 'Redo');
    this.redoButton.setAttribute('aria-keyshortcuts', 'Control+Shift+Z');
    setDisabled(this.undoButton, true);
    setDisabled(this.redoButton, true);
    this.undoButton.hidden = this.redoButton.hidden = !show.undo;
    this.compareButton = this.button('compare', 'Compare');
    this.compareButton.setAttribute('aria-pressed', 'false');
    this.compareButton.title = 'Keep a faint copy of the drawing to compare against';
    this.compareButton.hidden = true;
    this.settingsButton = this.button('settings', 'Settings');
    this.settingsButton.setAttribute('aria-expanded', 'false');
    this.settingsButton.classList.add('inc-icon-button');
    this.settingsButton.setAttribute('aria-label', 'Settings');
    this.settingsButton.textContent = '⚙';
    this.settingsButton.hidden = !show.settings;
    this.fullscreenButton = this.button('fullscreen', '⛶');
    this.fullscreenButton.classList.add('inc-icon-button');
    this.fullscreenButton.setAttribute('aria-label', 'Full screen');
    this.fullscreenButton.setAttribute('aria-pressed', 'false');
    this.fullscreenButton.title = 'Full screen';
    this.fullscreenButton.hidden = !show.fullscreen || !(doc.fullscreenEnabled ?? false);
    transport.append(this.toggle, this.restart, speedLabel, reset, this.undoButton, this.redoButton, this.compareButton, this.settingsButton, this.fullscreenButton);
    transport.hidden = !show.transport;
    this.transport = transport;

    // The settings panel: timing (when the scene has a timeline), frame-rate cap and frame step.
    this.settings = doc.createElement('div');
    this.settings.className = 'inc-settings';
    this.settings.id = `${scope}-settings`;
    this.settings.setAttribute('role', 'group');
    this.settings.setAttribute('aria-label', 'Settings');
    this.settings.hidden = true;
    this.settingsButton.setAttribute('aria-controls', this.settings.id);
    this.timing = doc.createElement('div');
    this.timing.className = 'inc-settings__timing';
    this.timing.hidden = true;
    this.duration = doc.createElement('input');
    this.duration.type = 'number';
    this.duration.min = '0.1';
    this.duration.max = '600';
    this.duration.step = '0.1';
    this.duration.dataset.setting = 'duration';
    this.loop = doc.createElement('select');
    this.loop.dataset.setting = 'loop';
    for (const mode of LOOP_MODES) this.loop.append(option(doc, mode, LOOP_LABELS[mode] ?? mode));
    this.ease = doc.createElement('select');
    this.ease.dataset.setting = 'ease';
    for (const ease of EASES) this.ease.append(option(doc, ease, EASE_LABELS[ease] ?? ease));
    this.timing.append(labelled(doc, 'Duration (s)', this.duration), labelled(doc, 'Repeat', this.loop), labelled(doc, 'Easing', this.ease));
    this.cap = doc.createElement('select');
    this.cap.dataset.setting = 'cap';
    for (const cap of FRAME_CAPS) this.cap.append(option(doc, String(cap), cap === 0 ? 'Smooth' : `${cap} fps`));
    this.frameStep = doc.createElement('button');
    this.frameStep.type = 'button';
    this.frameStep.dataset.action = 'frame';
    this.frameStep.textContent = 'Step one frame';
    this.settings.append(this.timing, labelled(doc, 'Frame rate', this.cap), this.frameStep);

    this.paramsElement = doc.createElement('div');
    this.paramsElement.className = 'inc-params';
    this.actionsElement = doc.createElement('div');
    this.actionsElement.className = 'inc-actions';
    this.actionsElement.setAttribute('role', 'group');
    this.actionsElement.setAttribute('aria-label', 'Actions');
    this.actionsElement.hidden = true;
    this.element.append(this.paramsElement, this.actionsElement, transport, this.settings);

    // One delegated listener per event kind; handlers only send messages, never draw.
    this.element.addEventListener(
      'input',
      (event) => {
        const target = event.target as HTMLInputElement;
        const name = target.dataset.param;
        if (!name) return;
        if (target.type === 'checkbox') {
          send({ type: 'setParam', name, value: target.checked ? 1 : 0 });
          return;
        }
        const value = Number(target.value);
        if (target.type === 'number' && (target.value === '' || !Number.isFinite(value))) return;
        send({ type: 'setParam', name, value });
      },
      { signal },
    );
    // A number field the learner left, or committed with Enter, shows the value the figure took, clamped or
    // snapped to its step, at once and again at the next state, even while the field still has focus (CT-2).
    const settle = (target: EventTarget | null) => {
      if (!(target instanceof HTMLInputElement) || target.type !== 'number' || !target.dataset.param) return;
      const latest = this.latest.get(target.dataset.param);
      if (latest !== undefined && target.value !== latest) target.value = latest;
      this.resync.add(target.dataset.param);
    };
    this.element.addEventListener('focusout', (event) => settle(event.target), { signal });
    this.element.addEventListener(
      'change',
      (event) => {
        const target = event.target as HTMLElement;
        settle(target);
        if (target === this.speed) send({ type: 'speed', value: Number(this.speed.value) });
        else if (target instanceof HTMLSelectElement && target.dataset.param) send({ type: 'setParam', name: target.dataset.param, value: Number(target.value) });
        else if (target === this.duration) {
          const value = Number(this.duration.value);
          if (Number.isFinite(value) && value > 0) send({ type: 'timing', duration: value });
        } else if (target === this.loop) send({ type: 'timing', loop: this.loop.value as (typeof LOOP_MODES)[number] });
        else if (target === this.ease) send({ type: 'timing', ease: this.ease.value as (typeof EASES)[number] });
        else if (target === this.cap) {
          this.frameCap = Number(this.cap.value);
          this.onFrameCap?.(this.frameCap);
        }
      },
      { signal },
    );
    this.element.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!button || button.getAttribute('aria-disabled') === 'true') return;
        if (button.dataset.choice !== undefined) {
          send({ type: 'setParam', name: button.dataset.choice, value: Number(button.dataset.value) });
          return;
        }
        if (button.dataset.index !== undefined) {
          send({ type: 'action', index: Number(button.dataset.index) });
          return;
        }
        switch (button.dataset.action) {
          case 'toggle':
            send({ type: this.toggle.dataset.playing === 'true' ? 'pause' : 'play' });
            break;
          case 'restart':
            send({ type: 'restart' });
            break;
          case 'reset':
            send({ type: 'reset' });
            break;
          case 'undo':
            send({ type: 'undo' });
            break;
          case 'redo':
            send({ type: 'redo' });
            break;
          case 'compare':
            send({ type: 'compare', on: this.compareButton.getAttribute('aria-pressed') !== 'true' });
            break;
          case 'frame':
            send({ type: 'frame' });
            break;
          case 'settings': {
            const open = this.settings.hidden;
            this.settings.hidden = !open;
            this.settingsButton.setAttribute('aria-expanded', String(open));
            break;
          }
          case 'fullscreen':
            this.onFullscreen?.();
            break;
        }
      },
      { signal },
    );
    this.element.addEventListener(
      'keydown',
      (event) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
        if ((event.target as HTMLElement).matches('input[type=number], input[type=text], textarea')) return;
        event.preventDefault();
        send({ type: event.shiftKey ? 'redo' : 'undo' });
      },
      { signal },
    );
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.toggle.dataset.playing = String(playing);
    this.toggle.textContent = playing ? 'Pause' : 'Play';
    this.refreshFrameStep();
  }

  /** The figure entered or left full screen. */
  setFullscreen(on: boolean): void {
    this.fullscreenButton.setAttribute('aria-pressed', String(on));
    const label = on ? 'Exit full screen' : 'Full screen';
    this.fullscreenButton.setAttribute('aria-label', label);
    this.fullscreenButton.title = label;
  }

  /** Shows or hides parts of the transport when the integrator restyles the figure. */
  setShow(show: ControlsShow): void {
    this.show = show;
    this.transport.hidden = !show.transport;
    this.speedLabel.hidden = this.animated === false || !show.speed;
    this.undoButton.hidden = this.redoButton.hidden = !show.undo;
    this.settingsButton.hidden = !show.settings;
    if (!show.settings) {
      this.settings.hidden = true;
      this.settingsButton.setAttribute('aria-expanded', 'false');
    }
    this.fullscreenButton.hidden = !show.fullscreen || !(this.doc.fullscreenEnabled ?? false);
  }

  /** A still scene has nothing to play, restart or speed up. */
  setAnimated(animated: boolean | null): void {
    this.animated = animated;
    const still = animated === false;
    this.toggle.hidden = still;
    this.restart.hidden = still;
    this.speedLabel.hidden = still || !this.show.speed;
    this.refreshFrameStep();
  }

  private refreshFrameStep(): void {
    this.frameStep.hidden = this.animated === false;
    setDisabled(this.frameStep, this.playing);
  }

  setSpeed(speed: number): void {
    this.speed.value = String(speed);
  }

  setHistory(history: { readonly undo: boolean; readonly redo: boolean }): void {
    setDisabled(this.undoButton, !history.undo);
    setDisabled(this.redoButton, !history.redo);
  }

  setCompare(compare: { readonly available: boolean; readonly on: boolean }): void {
    this.compareButton.hidden = !compare.available;
    this.compareButton.setAttribute('aria-pressed', String(compare.on));
  }

  setTiming(timing: TimingView | null): void {
    this.timing.hidden = timing === null;
    if (!timing) return;
    if (this.doc.activeElement !== this.duration) this.duration.value = String(timing.duration);
    this.loop.value = timing.loop;
    this.ease.value = timing.ease;
  }

  setActions(actions: readonly ActionView[]): void {
    const signature = JSON.stringify(actions.map((a) => [a.label, a.kind]));
    if (signature !== this.actionsSignature) {
      this.actionsSignature = signature;
      this.actionsElement.replaceChildren();
      for (const action of actions) {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.dataset.index = String(action.index);
        button.className = action.kind === 'preset' ? 'inc-chip' : 'inc-action';
        button.textContent = action.label;
        if (action.kind === 'preset') button.setAttribute('aria-pressed', 'false');
        this.actionsElement.append(button);
      }
      this.actionsElement.hidden = actions.length === 0;
    }
    for (const action of actions) {
      if (action.kind !== 'preset') continue;
      this.actionsElement.querySelector(`button[data-index="${action.index}"]`)?.setAttribute('aria-pressed', String(action.active));
    }
  }

  setParams(params: readonly ParamView[]): void {
    const signature = JSON.stringify(params.map((p) => [p.name, p.label, p.unit, p.min, p.max, p.step, p.note, p.kind, p.options, p.buttons]));
    if (signature !== this.signature) {
      this.signature = signature;
      this.buildParams(params);
    }
    for (const param of params) {
      const inputs = this.inputs.get(param.name);
      if (!inputs) continue;
      const value = String(param.value);
      if (inputs.range) {
        if (inputs.range.value !== value) inputs.range.value = value;
        inputs.range.setAttribute('aria-valuetext', `${value}${param.unit ? ` ${param.unit}` : ''}`);
      }
      this.latest.set(param.name, value);
      // Never fight a learner who is typing into the number field; once they commit or leave it, it shows the value taken.
      const typing = inputs.number !== undefined && this.doc.activeElement === inputs.number && !this.resync.has(param.name);
      if (inputs.number && !typing && inputs.number.value !== value) inputs.number.value = value;
      this.resync.delete(param.name);
      if (inputs.check) inputs.check.checked = param.value === 1;
      if (inputs.select && inputs.select.value !== value) inputs.select.value = value;
      if (inputs.buttons) for (const button of inputs.buttons) button.setAttribute('aria-pressed', String(button.dataset.value === value));
    }
  }

  private buildParams(params: readonly ParamView[]): void {
    this.inputs.clear();
    this.paramsElement.replaceChildren();
    params.forEach((param, index) => {
      const row = this.doc.createElement('div');
      row.className = `inc-param inc-param--${param.kind}`;
      const id = `${this.scope}-param-${index}`;
      const label = this.doc.createElement('label');
      label.className = 'inc-param__label';
      label.htmlFor = id;
      label.textContent = param.label;
      if (param.unit) {
        const unit = this.doc.createElement('span');
        unit.className = 'inc-param__unit';
        unit.textContent = ` (${param.unit})`;
        label.append(unit);
      }
      let inputs: ParamInputs;
      let describedBy: HTMLElement;
      if (param.kind === 'toggle') {
        const check = this.doc.createElement('input');
        check.type = 'checkbox';
        check.id = id;
        check.setAttribute('role', 'switch');
        check.className = 'inc-switch';
        check.checked = param.value === 1;
        check.dataset.param = param.name;
        row.append(check, label);
        inputs = { kind: param.kind, check };
        describedBy = check;
      } else if ((param.kind === 'choice' && param.buttons) || param.kind === 'color') {
        // A row of buttons: a choice shown as a segmented control, or tone swatches.
        const group = this.doc.createElement('div');
        group.className = param.kind === 'color' ? 'inc-swatches' : 'inc-segmented';
        group.setAttribute('role', 'group');
        group.id = id;
        group.setAttribute('aria-labelledby', `${id}-label`);
        label.id = `${id}-label`;
        label.removeAttribute('for');
        const buttons = param.options.map((text, i) => {
          const button = this.doc.createElement('button');
          button.type = 'button';
          button.dataset.choice = param.name;
          button.dataset.value = String(i);
          button.setAttribute('aria-pressed', String(param.value === i));
          if (param.kind === 'color') {
            button.className = `inc-swatch inc-swatch--${text}`;
            button.setAttribute('aria-label', toneName(text));
            button.title = toneName(text);
          } else button.textContent = text;
          group.append(button);
          return button;
        });
        row.append(label, group);
        inputs = { kind: param.kind, buttons };
        describedBy = group;
      } else if (param.kind === 'choice') {
        const select = this.doc.createElement('select');
        select.id = id;
        select.dataset.param = param.name;
        param.options.forEach((text, i) => select.append(option(this.doc, String(i), text)));
        select.value = String(param.value);
        row.append(label, select);
        inputs = { kind: param.kind, select };
        describedBy = select;
      } else {
        const range = this.input('range', param, id);
        const number = this.input('number', param, `${id}-value`);
        number.setAttribute('aria-label', `${param.label} value`);
        row.append(label, range, number);
        inputs = { kind: param.kind, range, number };
        describedBy = range;
      }
      if (param.linked) row.dataset.linked = param.linked;
      if (param.note) {
        const note = this.doc.createElement('p');
        note.className = 'inc-param__note';
        note.id = `${id}-note`;
        note.textContent = param.note;
        describedBy.setAttribute('aria-describedby', note.id);
        row.append(note);
      }
      this.paramsElement.append(row);
      this.inputs.set(param.name, inputs);
    });
  }

  private input(type: 'range' | 'number', param: ParamView, id: string): HTMLInputElement {
    const input = this.doc.createElement('input');
    input.type = type;
    input.id = id;
    input.min = String(param.min);
    input.max = String(param.max);
    input.step = String(param.step);
    input.value = String(param.value);
    input.dataset.param = param.name;
    return input;
  }

  private button(action: string, text: string): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = text;
    return button;
  }
}

/**
 * Live values derived from the model. Text nodes change only when their text
 * does. It is not a live region: a readout that follows time would talk over
 * everything while the figure plays. The renderer announces readouts once a
 * learner's change settles instead.
 */
export class ReadoutsView {
  readonly element: HTMLElement;
  private signature = '';
  private values: HTMLElement[] = [];

  constructor(private readonly doc: Document) {
    this.element = doc.createElement('div');
    this.element.className = 'inc-readouts';
  }

  update(readouts: readonly ReadoutView[]): void {
    const signature = readouts.map((r) => r.label).join('\u0000');
    if (signature !== this.signature) {
      this.signature = signature;
      this.element.replaceChildren();
      this.values = readouts.map((readout) => {
        const tile = this.doc.createElement('div');
        tile.className = 'inc-readout';
        const label = this.doc.createElement('span');
        label.className = 'inc-readout__label';
        label.textContent = readout.label;
        const value = this.doc.createElement('span');
        value.className = 'inc-readout__value';
        tile.append(label, value);
        this.element.append(tile);
        return value;
      });
    }
    readouts.forEach((readout, i) => {
      const value = this.values[i];
      if (value && value.textContent !== readout.text) value.textContent = readout.text;
    });
  }
}

function option(doc: Document, value: string, text: string): HTMLOptionElement {
  const element = doc.createElement('option');
  element.value = value;
  element.textContent = text;
  return element;
}

function labelled(doc: Document, text: string, control: HTMLElement): HTMLLabelElement {
  const label = doc.createElement('label');
  label.className = 'inc-settings__field';
  const span = doc.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

/** aria-disabled keeps the button focusable, so focus never drops to the page. */
export function setDisabled(element: HTMLButtonElement, disabled: boolean): void {
  if (disabled) element.setAttribute('aria-disabled', 'true');
  else element.removeAttribute('aria-disabled');
}

const TONE_NAMES: Readonly<Record<string, string>> = { lo: 'Pale', mid: 'Grey', hi: 'Dark', lit: 'Accent', faint: 'Faint', a: 'Rose', b: 'Blue', c: 'Green' };

function toneName(tone: string): string {
  return TONE_NAMES[tone] ?? tone;
}

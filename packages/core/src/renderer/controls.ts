import type { RendererMessage } from '../protocol/runtime-messages';
import { SPEEDS } from '../protocol/runtime-messages';
import type { ParamView, ReadoutView } from '../protocol/ui';

type Send = (message: RendererMessage) => void;

interface ParamInputs {
  readonly range: HTMLInputElement;
  readonly number: HTMLInputElement;
}

const formatSpeed = (speed: number) => `${speed}×`;

/** Engine-built controls: transport and one labelled slider plus number field per parameter. */
export class ControlsView {
  readonly element: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly speed: HTMLSelectElement;
  private readonly paramsElement: HTMLElement;
  private readonly inputs = new Map<string, ParamInputs>();
  private signature = '';

  constructor(
    private readonly doc: Document,
    private readonly scope: string,
    send: Send,
    signal: AbortSignal,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'inc-controls';
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', 'Figure controls');

    const transport = doc.createElement('div');
    transport.className = 'inc-transport';
    this.toggle = this.button('toggle', 'Play');
    const restart = this.button('restart', 'Restart');
    const reset = this.button('reset', 'Reset');
    reset.title = 'Restore the original values';
    const speedLabel = doc.createElement('label');
    speedLabel.textContent = 'Speed ';
    this.speed = doc.createElement('select');
    this.speed.dataset.action = 'speed';
    for (const s of SPEEDS) {
      const option = doc.createElement('option');
      option.value = String(s);
      option.textContent = formatSpeed(s);
      this.speed.append(option);
    }
    this.speed.value = '1';
    speedLabel.append(this.speed);
    transport.append(this.toggle, restart, speedLabel, reset);

    this.paramsElement = doc.createElement('div');
    this.paramsElement.className = 'inc-params';
    this.element.append(this.paramsElement, transport);

    // One delegated listener per event kind; handlers only send messages, never draw.
    this.element.addEventListener(
      'input',
      (event) => {
        const target = event.target as HTMLInputElement;
        const name = target.dataset.param;
        if (!name) return;
        const value = Number(target.value);
        if (target.type === 'number' && (target.value === '' || !Number.isFinite(value))) return;
        send({ type: 'setParam', name, value });
      },
      { signal },
    );
    this.element.addEventListener(
      'change',
      (event) => {
        const target = event.target as HTMLElement;
        if (target === this.speed) send({ type: 'speed', value: Number(this.speed.value) });
      },
      { signal },
    );
    this.element.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
        if (!button) return;
        const action = button.dataset.action;
        if (action === 'toggle') send({ type: this.toggle.dataset.playing === 'true' ? 'pause' : 'play' });
        else if (action === 'restart') send({ type: 'restart' });
        else if (action === 'reset') send({ type: 'reset' });
      },
      { signal },
    );
  }

  setPlaying(playing: boolean): void {
    this.toggle.dataset.playing = String(playing);
    this.toggle.textContent = playing ? 'Pause' : 'Play';
  }

  setSpeed(speed: number): void {
    this.speed.value = String(speed);
  }

  setParams(params: readonly ParamView[]): void {
    const signature = JSON.stringify(params.map((p) => [p.name, p.label, p.unit, p.min, p.max, p.step, p.note]));
    if (signature !== this.signature) {
      this.signature = signature;
      this.buildParams(params);
    }
    for (const param of params) {
      const inputs = this.inputs.get(param.name);
      if (!inputs) continue;
      const value = String(param.value);
      if (inputs.range.value !== value) inputs.range.value = value;
      inputs.range.setAttribute('aria-valuetext', `${value}${param.unit ? ` ${param.unit}` : ''}`);
      // Never fight a learner who is typing into the number field.
      if (this.doc.activeElement !== inputs.number && inputs.number.value !== value) inputs.number.value = value;
    }
  }

  private buildParams(params: readonly ParamView[]): void {
    this.inputs.clear();
    this.paramsElement.replaceChildren();
    params.forEach((param, index) => {
      const row = this.doc.createElement('div');
      row.className = 'inc-param';
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
      const range = this.input('range', param, id);
      const number = this.input('number', param, `${id}-value`);
      number.setAttribute('aria-label', `${param.label} value`);
      row.append(label, range, number);
      if (param.note) {
        const note = this.doc.createElement('p');
        note.className = 'inc-param__note';
        note.id = `${id}-note`;
        note.textContent = param.note;
        range.setAttribute('aria-describedby', note.id);
        row.append(note);
      }
      this.paramsElement.append(row);
      this.inputs.set(param.name, { range, number });
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

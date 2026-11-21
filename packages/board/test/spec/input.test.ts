/**
 * Input (docs/features/board/design.md 3, 6.1, 6.5, 13; requirements R4.1, R4.2, R4.6; state-machines B5, B6): Pointer
 * Events become `InputSample`s with every coalesced sample, predicted samples marked, pressure, tilt, twist and buttons;
 * a pen that only reports 0.5 and a mouse get simulated pressure; the palm rule; wheel, pinch and two-finger gestures.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BUTTON_BARREL, BUTTON_ERASER, BUTTON_TIP, PALM_GRACE_MS, PROBE_FLAT_SAMPLES, PointerGate, PressureProbe, WebInput } from '../../src/index';
import type { GestureInput, InputSample, InputSink, KeyInput, TouchDraws, WheelInput } from '../../src/index';
import { sample } from './ink-helpers';

interface Fake {
  readonly pointerType?: 'pen' | 'touch' | 'mouse';
  readonly pointerId?: number;
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly twist?: number;
  readonly buttons?: number;
  readonly time?: number;
}

/** A Pointer Event with the given numbers (happy-dom does not carry them all), plus the browser's coalesced and predicted lists. */
function pointer(type: string, f: Fake, coalesced?: readonly Fake[], predicted?: readonly Fake[]): PointerEvent {
  const make = (g: Fake, kind: string): PointerEvent => {
    const e = new PointerEvent(kind, { bubbles: true, cancelable: true });
    const values: Record<string, unknown> = {
      pointerType: g.pointerType ?? 'pen',
      pointerId: g.pointerId ?? 1,
      clientX: g.x,
      clientY: g.y,
      pressure: g.pressure ?? 0.5,
      tiltX: g.tiltX ?? 0,
      tiltY: g.tiltY ?? 0,
      twist: g.twist ?? 0,
      buttons: g.buttons ?? 1,
      timeStamp: g.time ?? 0,
    };
    for (const [k, v] of Object.entries(values)) Object.defineProperty(e, k, { value: v, configurable: true });
    return e;
  };
  const e = make(f, type);
  if (coalesced !== undefined) Object.defineProperty(e, 'getCoalescedEvents', { value: () => coalesced.map((c) => make(c, type)), configurable: true });
  if (predicted !== undefined) Object.defineProperty(e, 'getPredictedEvents', { value: () => predicted.map((c) => make(c, type)), configurable: true });
  return e;
}

/** A copy of the fields of a sample (the adapter's object keeps `phase` in a getter, so a spread would lose it). */
const snap = (s: InputSample): InputSample => ({
  pointer: s.pointer, device: s.device, phase: s.phase, x: s.x, y: s.y, pressure: s.pressure, tiltX: s.tiltX, tiltY: s.tiltY, twist: s.twist,
  buttons: s.buttons, time: s.time, predicted: s.predicted,
});

/** A wheel event with a position (happy-dom ignores the position in the init). */
function wheel(init: WheelEventInit & { clientX?: number; clientY?: number }): WheelEvent {
  const e = new WheelEvent('wheel', { cancelable: true, deltaMode: 0, ...init });
  Object.defineProperty(e, 'clientX', { value: init.clientX ?? 0, configurable: true });
  Object.defineProperty(e, 'clientY', { value: init.clientY ?? 0, configurable: true });
  Object.defineProperty(e, 'deltaY', { value: init.deltaY ?? 0, configurable: true });
  Object.defineProperty(e, 'deltaX', { value: init.deltaX ?? 0, configurable: true });
  Object.defineProperty(e, 'ctrlKey', { value: init.ctrlKey ?? false, configurable: true });
  return e;
}

interface Heard {
  /** Copies, in order (the adapter reuses one object, so a test copies what it keeps). */
  readonly samples: InputSample[];
  /** The objects the sink was handed. */
  readonly refs: InputSample[];
  readonly wheels: WheelInput[];
  readonly gestures: GestureInput[];
  readonly keys: KeyInput[];
}

function listen(touchDraws?: TouchDraws): { readonly el: HTMLElement; readonly input: WebInput; readonly heard: Heard } {
  const el = document.createElement('div');
  document.body.append(el);
  const heard: Heard = { samples: [], refs: [], wheels: [], gestures: [], keys: [] };
  const sink: InputSink = {
    sample: (s) => {
      heard.refs.push(s);
      heard.samples.push(snap(s));
    },
    key: (k) => heard.keys.push({ ...k }),
    wheel: (w) => heard.wheels.push({ ...w }),
    gesture: (g) => heard.gestures.push({ ...g }),
  };
  const input = new WebInput({ element: el, sink, ...(touchDraws !== undefined ? { touchDraws } : {}) });
  return { el, input, heard };
}

let mounted: { el: HTMLElement; input: WebInput } | undefined;
const mount = (touchDraws?: TouchDraws): ReturnType<typeof listen> => {
  const m = listen(touchDraws);
  mounted = m;
  return m;
};
afterEach(() => {
  mounted?.input.dispose();
  mounted?.el.remove();
  mounted = undefined;
});

describe('web input: Pointer Events to InputSample (design 6.1, R4.1)', () => {
  it('a pen stroke arrives as down, move, up with pressure, tilt, twist and buttons', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 10, y: 20, pressure: 0.3, tiltX: 12, tiltY: -7, twist: 90, buttons: BUTTON_TIP, time: 100 }));
    el.dispatchEvent(pointer('pointermove', { x: 15, y: 25, pressure: 0.7, tiltX: 14, tiltY: -5, twist: 91, buttons: BUTTON_TIP | BUTTON_BARREL, time: 108 }));
    el.dispatchEvent(pointer('pointerup', { x: 18, y: 30, pressure: 0, buttons: 0, time: 116 }));
    expect(heard.samples.map((s) => s.phase)).toEqual(['down', 'move', 'up']);
    expect(heard.samples[0]).toMatchObject({ device: 'pen', x: 10, y: 20, tiltX: 12, tiltY: -7, twist: 90, buttons: BUTTON_TIP, time: 100, predicted: false });
    expect(heard.samples[0]?.pressure).toBeCloseTo(0.3, 5);
    expect(heard.samples[1]?.pressure).toBeCloseTo(0.7, 5);
    expect(heard.samples[1]?.buttons).toBe(BUTTON_TIP | BUTTON_BARREL);
    expect(heard.samples[1]).toMatchObject({ tiltX: 14, tiltY: -5, twist: 91 });
  });

  it('a pointer id stays the same while the pointer is down', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 1, y: 1, pointerId: 7, pressure: 0.3 }));
    el.dispatchEvent(pointer('pointermove', { x: 2, y: 2, pointerId: 7, pressure: 0.4 }));
    el.dispatchEvent(pointer('pointerup', { x: 3, y: 3, pointerId: 7, buttons: 0 }));
    expect(new Set(heard.samples.map((s) => s.pointer))).toEqual(new Set([7]));
  });

  it('every coalesced sample of a move is given, in order, and the merged event itself is not', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.3, time: 0 }));
    const merged: Fake[] = [1, 2, 3, 4].map((i) => ({ x: i * 2, y: i, pressure: 0.3 + i * 0.1, time: i * 2 }));
    el.dispatchEvent(pointer('pointermove', { x: 8, y: 4, pressure: 0.7, time: 8 }, merged));
    const moves = heard.samples.filter((s) => s.phase === 'move');
    expect(moves.map((s) => s.x)).toEqual([2, 4, 6, 8]);
    expect(moves.map((s) => s.time)).toEqual([2, 4, 6, 8]);
    expect(moves.every((s) => !s.predicted)).toBe(true);
    expect(moves[0]?.pressure).toBeCloseTo(0.4, 5);
  });

  it('predicted samples follow the real ones, marked predicted, and only while a pointer is down', () => {
    const { el, heard } = mount();
    // hovering: no predicted samples are given
    el.dispatchEvent(pointer('pointermove', { x: 5, y: 5, buttons: 0 }, undefined, [{ x: 6, y: 6, buttons: 0 }]));
    expect(heard.samples.some((s) => s.predicted)).toBe(false);
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.3 }));
    el.dispatchEvent(pointer('pointermove', { x: 4, y: 4, pressure: 0.4 }, [{ x: 4, y: 4, pressure: 0.4 }], [{ x: 6, y: 6, pressure: 0.4 }, { x: 8, y: 8, pressure: 0.4 }]));
    const tail = heard.samples.slice(-3);
    expect(tail.map((s) => s.predicted)).toEqual([false, true, true]);
    expect(tail.map((s) => s.x)).toEqual([4, 6, 8]);
  });

  it('positions are relative to the board element, not the window', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = (): DOMRect => ({ left: 100, top: 50, right: 500, bottom: 350, width: 400, height: 300, x: 100, y: 50, toJSON: () => ({}) });
    document.body.append(el);
    const heard: InputSample[] = [];
    const input = new WebInput({ element: el, sink: { sample: (s) => heard.push(snap(s)), key: () => undefined, wheel: () => undefined, gesture: () => undefined } });
    mounted = { el, input };
    el.dispatchEvent(pointer('pointerdown', { x: 130, y: 90, pressure: 0.3 }));
    expect(heard[0]).toMatchObject({ x: 30, y: 40 });
  });

  it('input makes no garbage: one sample object is reused for every event (design 13, how 1)', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.3 }));
    for (let i = 1; i <= 5; i++) el.dispatchEvent(pointer('pointermove', { x: i, y: i, pressure: 0.4 }, [{ x: i, y: i, pressure: 0.4 }]));
    expect(new Set(heard.refs).size).toBe(1);
  });

  it('dispose removes the listeners', () => {
    const { el, input, heard } = mount();
    input.dispose();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
    expect(heard.samples).toHaveLength(0);
  });
});

describe('pressure (R4.2, design 6.1 item 3)', () => {
  it('a pen with a sensor reports its pressure as it is', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.2 }));
    for (const [i, p] of [0.35, 0.8, 0.95].entries()) el.dispatchEvent(pointer('pointermove', { x: i + 1, y: 0, pressure: p }));
    expect(heard.samples.map((s) => Number(s.pressure.toFixed(2)))).toEqual([0.2, 0.35, 0.8, 0.95]);
  });

  it('a pen that reports exactly 0.5 for every sample gives NaN, so the core simulates pressure from speed', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.5 }));
    for (let i = 1; i <= PROBE_FLAT_SAMPLES + 4; i++) el.dispatchEvent(pointer('pointermove', { x: i, y: 0, pressure: 0.5 }));
    expect(heard.samples.length).toBeGreaterThan(PROBE_FLAT_SAMPLES);
    expect(heard.samples.every((s) => Number.isNaN(s.pressure))).toBe(true);
  });

  it('a pen that shows one other value is a pen with a sensor: 0.5 is then a real pressure', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.5 }));
    el.dispatchEvent(pointer('pointermove', { x: 1, y: 0, pressure: 0.62 }));
    el.dispatchEvent(pointer('pointermove', { x: 2, y: 0, pressure: 0.5 }));
    expect(heard.samples.map((s) => (Number.isNaN(s.pressure) ? 'nan' : Number(s.pressure.toFixed(2))))).toEqual(['nan', 0.62, 0.5]);
  });

  it('a mouse has no pressure: NaN, and tilt and twist are 0', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse', x: 0, y: 0, pressure: 0.5, buttons: 1 }));
    el.dispatchEvent(pointer('pointermove', { pointerType: 'mouse', x: 5, y: 0, pressure: 0.5, buttons: 1 }));
    el.dispatchEvent(pointer('pointerup', { pointerType: 'mouse', x: 6, y: 0, pressure: 0, buttons: 0 }));
    expect(heard.samples.map((s) => s.device)).toEqual(['mouse', 'mouse', 'mouse']);
    expect(heard.samples.every((s) => Number.isNaN(s.pressure) && s.tiltX === 0 && s.tiltY === 0 && s.twist === 0)).toBe(true);
  });

  it('PressureProbe: unknown and flat report 0.5 as NaN; one real value ends the doubt for good', () => {
    const probe = new PressureProbe();
    expect(probe.state).toBe('unknown');
    for (let i = 0; i < PROBE_FLAT_SAMPLES - 1; i++) expect(probe.observe(0.5)).toBeNaN();
    expect(probe.state).toBe('unknown');
    expect(probe.observe(0.5)).toBeNaN();
    expect(probe.state).toBe('flat');
    expect(probe.observe(0.5)).toBeNaN();
    expect(probe.observe(0.31)).toBeCloseTo(0.31, 5);
    expect(probe.state).toBe('real');
    expect(probe.observe(0.5)).toBe(0.5);
    for (let i = 0; i < 20; i++) probe.observe(0.5);
    expect(probe.state).toBe('real');
  });

  it('PressureProbe: 0 (a hover) is neither flat nor a sensor value; a value that is not a number is NaN', () => {
    const probe = new PressureProbe();
    expect(probe.observe(0)).toBe(0);
    expect(probe.state).toBe('unknown');
    expect(probe.observe(Number.NaN)).toBeNaN();
    expect(probe.observe(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(probe.state).toBe('unknown');
  });
});

describe('palm rule (R4.6, design 6.5, B5)', () => {
  const pen = (phase: InputSample['phase'], time: number, pointer = 1): InputSample => sample({ device: 'pen', phase, time, pointer });
  const touch = (phase: InputSample['phase'], time: number, pointer: number): InputSample => sample({ device: 'touch', phase, time, pointer, pressure: Number.NaN });

  it('a finger alone draws', () => {
    const gate = new PointerGate();
    expect(gate.admit(touch('down', 0, 10))).toBe('draw');
    expect(gate.state).toBe('touchDown');
    expect(gate.admit(touch('move', 8, 10))).toBe('draw');
    expect(gate.admit(touch('up', 16, 10))).toBe('draw');
    expect(gate.state).toBe('idle');
  });

  it('a touch is ignored while a pen hovers (near)', () => {
    const gate = new PointerGate();
    expect(gate.admit(pen('hover', 0))).toBe('draw');
    expect(gate.state).toBe('penNear');
    expect(gate.admit(touch('down', 10, 10))).toBe('ignore');
    expect(gate.admit(touch('move', 20, 10))).toBe('ignore');
    expect(gate.admit(touch('up', 30, 10))).toBe('ignore');
  });

  it('a touch is ignored while a pen is down, and counted so the count never goes below 0', () => {
    const gate = new PointerGate();
    gate.admit(pen('down', 0));
    expect(gate.state).toBe('penDown');
    expect(gate.admit(touch('down', 5, 10))).toBe('ignore');
    expect(gate.touches).toBe(1);
    expect(gate.admit(touch('up', 9, 10))).toBe('ignore');
    expect(gate.admit(touch('up', 10, 11))).toBe('ignore');
    expect(gate.touches).toBe(0);
    expect(gate.state).toBe('penDown');
  });

  it(`a touch within ${PALM_GRACE_MS} ms of the last pen sample is still the palm; after that a finger draws`, () => {
    const gate = new PointerGate();
    gate.admit(pen('hover', 1000));
    gate.penAway();
    expect(gate.state).toBe('idle');
    expect(gate.admit(touch('down', 1000 + PALM_GRACE_MS - 50, 10))).toBe('ignore');
    gate.admit(touch('up', 1000 + PALM_GRACE_MS - 40, 10));
    expect(gate.admit(touch('down', 1000 + PALM_GRACE_MS + 50, 11))).toBe('draw');
  });

  it("touchDraws 'never' ignores every single touch", () => {
    const never = new PointerGate({ touchDraws: 'never' });
    expect(never.admit(touch('down', 0, 10))).toBe('ignore');
  });

  it("touchDraws 'always' lets a finger draw even with a pen near (B5 invariants: 'unless the host sets touchDraws: always')", () => {
    const always = new PointerGate({ touchDraws: 'always' });
    always.admit(pen('hover', 0));
    expect(always.admit(touch('down', 10, 10))).toBe('draw');
  });

  it('two fingers pan and zoom (a gesture), and the first finger stroke is cancelled', () => {
    const gate = new PointerGate();
    expect(gate.admit(touch('down', 0, 10))).toBe('draw');
    expect(gate.admit(touch('down', 4, 11))).toBe('gestureStart');
    expect(gate.state).toBe('gesture');
    expect(gate.admit(touch('move', 8, 10))).toBe('gesture');
    expect(gate.admit(touch('down', 12, 12))).toBe('gesture');
    expect(gate.admit(touch('up', 16, 12))).toBe('gesture');
    expect(gate.admit(touch('up', 20, 11))).toBe('gestureEnd');
    expect(gate.state).toBe('idle');
  });

  it('two fingers still pan and zoom while a pen hovers', () => {
    const gate = new PointerGate();
    gate.admit(pen('hover', 0));
    expect(gate.admit(touch('down', 5, 10))).toBe('ignore');
    expect(gate.admit(touch('down', 6, 11))).toBe('gestureStart');
    expect(gate.state).toBe('gesture');
  });

  it('a pen that goes down while a finger draws cancels the finger stroke and wins', () => {
    const gate = new PointerGate();
    gate.admit(touch('down', 0, 10));
    expect(gate.drawing).toBe(10);
    expect(gate.admit(pen('down', 5))).toBe('cancelThenDraw');
    expect(gate.state).toBe('penDown');
    expect(gate.dropDrawing()).toBe(10);
    expect(gate.dropDrawing()).toBe(-1);
  });

  it('a pen that hovers while a finger draws also cancels the finger and draws the hover', () => {
    const gate = new PointerGate();
    gate.admit(touch('down', 0, 10));
    expect(gate.admit(pen('hover', 5))).toBe('cancelThenDraw');
    expect(gate.state).toBe('penNear');
  });

  it('web input: a finger is ignored while a pen hovers', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointermove', { pointerType: 'pen', pointerId: 1, x: 5, y: 5, buttons: 0, time: 1000 }));
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 2, x: 50, y: 50, time: 1010 }));
    el.dispatchEvent(pointer('pointermove', { pointerType: 'touch', pointerId: 2, x: 60, y: 60, time: 1020 }));
    el.dispatchEvent(pointer('pointerup', { pointerType: 'touch', pointerId: 2, x: 60, y: 60, buttons: 0, time: 1030 }));
    expect(heard.samples.filter((s) => s.device === 'touch')).toHaveLength(0);
  });

  it('web input: after the pen leaves and the grace has passed, a finger draws', () => {
    const { el, heard } = mount();
    const leave = pointer('pointerleave', { pointerType: 'pen', x: 0, y: 0, buttons: 0 });
    el.dispatchEvent(pointer('pointermove', { pointerType: 'pen', pointerId: 1, x: 5, y: 5, buttons: 0, time: 1000 }));
    el.dispatchEvent(leave);
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 2, x: 50, y: 50, time: 1000 + PALM_GRACE_MS + 100 }));
    el.dispatchEvent(pointer('pointermove', { pointerType: 'touch', pointerId: 2, x: 60, y: 60, time: 1000 + PALM_GRACE_MS + 110 }));
    const touches = heard.samples.filter((s) => s.device === 'touch');
    expect(touches.map((s) => s.phase)).toEqual(['down', 'move']);
  });

  it('web input: two fingers give gestures (centre moved, spread changed), not strokes', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 1, x: 100, y: 100, time: 0 }));
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 2, x: 200, y: 100, time: 5 }));
    heard.samples.length = 0;
    el.dispatchEvent(pointer('pointermove', { pointerType: 'touch', pointerId: 2, x: 300, y: 100, time: 10 }));
    expect(heard.samples).toHaveLength(0);
    expect(heard.gestures).toHaveLength(1);
    const g = heard.gestures[0] as GestureInput;
    expect(g.scale).toBeCloseTo(2, 5);
    expect(g.x).toBeCloseTo(200, 5);
    expect(g.dx).toBeCloseTo(50, 5);
  });

  it('web input: the first finger stroke is cancelled when a second finger lands', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 1, x: 100, y: 100, time: 0 }));
    el.dispatchEvent(pointer('pointermove', { pointerType: 'touch', pointerId: 1, x: 110, y: 100, time: 8 }));
    el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', pointerId: 2, x: 200, y: 100, time: 16 }));
    const phases = heard.samples.map((s) => s.phase);
    expect(phases).toEqual(['down', 'move', 'cancel']);
    expect(heard.samples[2]?.pointer).toBe(1);
  });
});

describe('wheel, pinch and keys (R3.4)', () => {
  it('a mouse wheel notch zooms about the pointer', () => {
    const { el, heard } = mount();
    const e = wheel({ deltaY: 100, clientX: 40, clientY: 60 });
    el.dispatchEvent(e);
    expect(heard.wheels).toHaveLength(1);
    expect(heard.wheels[0]).toMatchObject({ x: 40, y: 60, zoom: true });
    expect(e.defaultPrevented).toBe(true);
  });

  it('Ctrl with the wheel (a trackpad pinch) zooms, and a smooth two-finger scroll pans', () => {
    const { el, heard } = mount();
    el.dispatchEvent(wheel({ deltaY: -3, ctrlKey: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(wheel({ deltaX: 4, deltaY: 7, clientX: 10, clientY: 10 }));
    expect(heard.wheels[0]?.zoom).toBe(true);
    expect(heard.wheels[1]).toMatchObject({ zoom: false, dx: 4, dy: 7 });
  });

  it('keys reach the sink with their modifiers; Space is kept from scrolling the page', () => {
    const { el, heard } = mount();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, cancelable: true }));
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    el.dispatchEvent(space);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', cancelable: true }));
    expect(heard.keys[0]).toMatchObject({ key: 'z', mod: true, shift: true, down: true });
    expect(heard.keys[1]).toMatchObject({ key: ' ', down: true });
    expect(heard.keys[2]).toMatchObject({ key: ' ', down: false });
    expect(space.defaultPrevented).toBe(true);
  });

  it('the pen eraser end and the barrel button arrive as button bits', () => {
    const { el, heard } = mount();
    el.dispatchEvent(pointer('pointerdown', { x: 0, y: 0, pressure: 0.4, buttons: BUTTON_ERASER }));
    el.dispatchEvent(pointer('pointermove', { x: 3, y: 0, pressure: 0.4, buttons: BUTTON_TIP | BUTTON_BARREL }));
    expect((heard.samples[0]?.buttons ?? 0) & BUTTON_ERASER).toBe(BUTTON_ERASER);
    expect((heard.samples[1]?.buttons ?? 0) & BUTTON_BARREL).toBe(BUTTON_BARREL);
  });
});

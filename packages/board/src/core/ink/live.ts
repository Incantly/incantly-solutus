/**
 * The stroke being drawn (design 6.3, docs/state-machines.md B7). It grows in a buffer of its own, outside the store:
 * nothing is written to the store while the pen is down, and a stored record never shares a typed array with it
 * (BR-10). When the stroke ends it commits one fresh `ink` record, so the whole stroke is one undo step. Predicted
 * samples are kept apart and never stored. No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { CameraView } from '../camera';
import { boardError, ok, refusedMove } from '../errors';
import type { BoardResult, ErrorSink } from '../errors';
import { keyBetween } from '../fractional';
import type { InputSample } from '../input';
import { parseColor } from '../kinds/ink';
import type { InkProps } from '../kinds/ink';
import type { LiveStrokeView, PredictedView } from '../draw';
import type { Store } from '../store';
import type { ShapeRecord } from '../types';
import { Outliner } from './outline';
import type { Nib, OutlineOptions } from './outline';
import { InkSampler } from './samples';
import type { Stride } from './samples';

type LiveState = 'idle' | 'drawing';
type LiveEvent = 'begin' | 'sample' | 'end' | 'cancel';

export const LIVE_MACHINE: MachineTable<LiveState, LiveEvent> = {
  idle: { begin: 'drawing' },
  drawing: { sample: 'drawing', end: 'idle', cancel: 'idle' },
};

/** What a pen or highlighter draws with. */
export interface PenStyle {
  readonly nib: Nib;
  readonly size: number;
  readonly color: string;
  readonly opacity: number;
}

/** The last index key on a page, so a new shape goes after it. */
function lastIndexOn(store: Store, page: string): string | null {
  let last: string | null = null;
  for (const s of store.shapesOn(page)) if (last === null || s.index > last) last = s.index;
  return last;
}

const PREDICTED_MAX = 32;

/** The numbers the painter reads, written in place each frame so a frame makes no garbage (BR-16). */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

export class LiveStroke {
  /** The triangles of the stroke so far, rebuilt by `rebuild`; the painter reads them. */
  readonly outliner = new Outliner();
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(LIVE_MACHINE, 'idle', refusedMove('live stroke', () => this.#report));
  readonly #samplers: Readonly<Record<Stride, InkSampler>> = { 3: new InkSampler(3), 5: new InkSampler(5) };
  readonly #predicted = new Float32Array(PREDICTED_MAX * 2);
  #predictedCount = 0;
  #sampler: InkSampler = this.#samplers[3];
  #style: PenStyle = { nib: 'pen', size: 3, color: '#000000', opacity: 1 };
  /** Data of the `drawing` state: the page the stroke is on. It is cleared when the stroke ends or is cancelled. */
  #page: string | null = null;
  #serial = 0;
  readonly #options: Writable<OutlineOptions> = { size: 3, nib: 'pen', tolerance: 0.25 };
  readonly #colour = { r: 0, g: 0, b: 0 };
  readonly #predictedView: Writable<PredictedView> = { xy: this.#predicted, count: 0 };
  readonly #strokeView: Writable<LiveStrokeView> = {
    serial: 0, originX: 0, originY: 0, r: 0, g: 0, b: 0, size: 3, opacity: 1, multiply: false, outliner: this.outliner, predicted: null,
  };

  constructor(report?: ErrorSink) {
    this.#report = report;
  }

  get state(): LiveState {
    return this.#machine.state;
  }

  /** The number of kept points. */
  get count(): number {
    return this.#sampler.buffer.count;
  }

  /** The page the stroke is being drawn on. */
  get page(): string | null {
    return this.#page;
  }

  /** Starts a stroke at its first sample. Returns false when one is already in progress. */
  begin(s: InputSample, camera: CameraView, page: string, style: PenStyle, tilt: boolean): boolean {
    if (!this.#machine.send('begin')) return false;
    this.#serial++;
    this.#style = style;
    this.#page = page;
    const [r, g, b] = parseColor(style.color);
    this.#colour.r = r;
    this.#colour.g = g;
    this.#colour.b = b;
    this.outliner.reset();
    this.#predictedCount = 0;
    this.#sampler = this.#samplers[tilt && s.device === 'pen' ? 5 : 3];
    this.#sampler.reset();
    this.#sampler.add(s, camera);
    return true;
  }

  /** Adds a real sample. Returns true when it was kept (the 0.5 px filter may drop it). */
  add(s: InputSample, camera: CameraView): boolean {
    if (!this.#machine.send('sample')) return false;
    this.#predictedCount = 0;
    return this.#sampler.add(s, camera);
  }

  /** Adds a guess of a future sample, in screen pixels, for the overlay. Never stored. */
  predict(s: InputSample): void {
    if (!this.#machine.is('drawing') || this.#predictedCount >= PREDICTED_MAX) return;
    this.#predicted[this.#predictedCount * 2] = s.x;
    this.#predicted[this.#predictedCount * 2 + 1] = s.y;
    this.#predictedCount++;
  }

  /**
   * Brings the outline up to the points so far; `scale` is device pixels per page unit. The points before the last few
   * segments are kept from the last call, so a frame costs the same however long the stroke is. A change of zoom
   * (another tolerance) builds the whole outline again.
   */
  rebuild(scale: number): void {
    const buf = this.#sampler.buffer;
    const o = this.#options;
    o.size = this.#style.size;
    o.nib = this.#style.nib;
    o.tolerance = 0.25 / (scale > 0 ? scale : 1);
    this.outliner.extend(buf.array, buf.count, buf.stride, o);
  }

  /** What the painter draws. Call `rebuild` first. The same object every time: read it during the frame. */
  view(): LiveStrokeView {
    const v = this.#strokeView;
    v.serial = this.#serial;
    v.originX = this.#sampler.originX;
    v.originY = this.#sampler.originY;
    v.r = this.#colour.r;
    v.g = this.#colour.g;
    v.b = this.#colour.b;
    v.size = this.#style.size;
    v.opacity = this.#style.opacity;
    v.multiply = this.#style.nib === 'highlighter';
    if (this.#predictedCount > 0) {
      this.#predictedView.count = this.#predictedCount;
      v.predicted = this.#predictedView;
    } else {
      v.predicted = null;
    }
    return v;
  }

  /**
   * Ends the stroke: one fresh `ink` record goes into the store (one undo step). A stroke with no point stores
   * nothing. A refused write (`limit`) leaves the board as it was. Either way the stroke is over.
   */
  end(store: Store): BoardResult<ShapeRecord | undefined> {
    if (!this.#machine.send('end')) return boardError('bad_argument', 'There is no stroke to end.', { detail: { field: 'stroke' } });
    const page = this.#page;
    const buf = this.#sampler.buffer;
    const done = (): void => {
      buf.clear();
      this.#predictedCount = 0;
      this.#page = null;
    };
    if (page === null || buf.count === 0) {
      done();
      return ok(undefined);
    }
    const key = keyBetween(lastIndexOn(store, page), null);
    if (!key.ok) {
      done();
      return key;
    }
    const props: InkProps = {
      points: buf.copy(),
      stride: buf.stride,
      nib: this.#style.nib,
      size: this.#style.size,
      color: this.#style.color,
      opacity: this.#style.opacity,
    };
    const x = this.#sampler.originX;
    const y = this.#sampler.originY;
    const result = store.change('user', (tx) => {
      const shape: ShapeRecord<'ink', InkProps> = {
        id: tx.newId('shape'),
        page,
        kind: 'ink',
        x,
        y,
        rotation: 0,
        parent: null,
        index: key.value,
        locked: false,
        opacity: 1,
        props,
        meta: {},
      };
      return tx.put(shape);
    });
    done();
    if (!result.ok) return result;
    const put = result.value.value;
    return put.ok ? ok(put.value as ShapeRecord) : put;
  }

  /** Drops the stroke without storing anything. */
  cancel(): void {
    if (!this.#machine.send('cancel')) return;
    this.#sampler.buffer.clear();
    this.#predictedCount = 0;
    this.#page = null;
  }
}

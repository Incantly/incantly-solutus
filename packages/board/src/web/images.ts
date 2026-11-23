/**
 * The pictures of image shapes on the web (docs/state-machines.md B24): one entry for each asset a tile asks for. The
 * browser decodes the asset's bytes; until it has, and when it cannot, the painter draws a grey box. An SVG goes
 * through an `<img>` element, so it cannot run script. Nothing here throws.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { refusedMove } from '../core/errors';
import type { BoardError } from '../core/errors';
import type { Store } from '../core/store';
import { isAsset } from '../core/types';

type ImageState = 'pending' | 'ready' | 'failed';
type ImageEvent = 'decoded' | 'fail';

export const IMAGE_MACHINE: MachineTable<ImageState, ImageEvent> = {
  pending: { decoded: 'ready', fail: 'failed' },
  ready: {},
  failed: {},
};

/** One asset's picture and how far its decoding has got. */
export class ImageEntry {
  readonly #report: ((error: BoardError) => void) | undefined;
  readonly #machine = new StateMachine(IMAGE_MACHINE, 'pending', refusedMove('image', () => this.#report));
  readonly #image: HTMLImageElement;

  constructor(src: string, settled: () => void, report?: (error: BoardError) => void) {
    this.#report = report;
    this.#image = new Image();
    this.#image.onload = () => {
      if (this.#machine.send('decoded')) settled();
    };
    this.#image.onerror = () => {
      if (this.#machine.send('fail')) settled();
    };
    this.#image.src = src;
  }

  get state(): ImageState {
    return this.#machine.state;
  }

  /** The decoded picture, or null while it is pending or when it failed. */
  get picture(): CanvasImageSource | null {
    return this.#machine.is('ready') ? this.#image : null;
  }

  release(): void {
    this.#image.onload = null;
    this.#image.onerror = null;
    this.#image.removeAttribute('src');
  }
}

/** The entries of a board's assets, made when a tile first asks and dropped when the asset record goes. */
export class ImageCache {
  readonly #entries = new Map<string, ImageEntry>();
  readonly #store: Store;
  readonly #settled: () => void;
  readonly #stop: () => void;

  constructor(store: Store, settled: () => void) {
    this.#store = store;
    this.#settled = settled;
    this.#stop = store.on((diff) => {
      for (const r of diff.removed) {
        const entry = this.#entries.get(r.id);
        if (entry !== undefined && isAsset(r)) {
          entry.release();
          this.#entries.delete(r.id);
        }
      }
    });
  }

  /** The picture of an asset, or null when it is not ready. The first ask starts the decoding. */
  lookup = (asset: string): CanvasImageSource | null => {
    const known = this.#entries.get(asset);
    if (known !== undefined) return known.picture;
    const record = this.#store.get(asset);
    if (record === undefined || !isAsset(record)) return null;
    const entry = new ImageEntry(`data:${record.mime};base64,${record.data}`, this.#settled, this.#store.sink);
    this.#entries.set(asset, entry);
    return entry.picture;
  };

  dispose(): void {
    this.#stop();
    for (const e of this.#entries.values()) e.release();
    this.#entries.clear();
  }
}

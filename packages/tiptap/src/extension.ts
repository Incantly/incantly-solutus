/** The `Incantly` extension: its options, and the two nodes configured with them (design 6). */
import { Extension } from '@tiptap/core';
import { IncantlyFigure } from './figure-node';
import type { TiptapError } from './errors';
import { DEFAULT_OPTIONS } from './types';
import type { IncantlyTiptapOptions } from './types';
import { isModeId } from './attrs';

export interface IncantlyStorage {
  /** The last error the extension reported, for hosts that poll instead of listening. */
  lastError: TiptapError | null;
}

/** Options with the defaults filled in and nonsense values replaced by the defaults. */
export function resolveOptions(options: Partial<IncantlyTiptapOptions>): IncantlyTiptapOptions {
  const live = options.liveLimit;
  return {
    ...options,
    readOnly: options.readOnly === true,
    liveLimit: typeof live === 'number' && Number.isInteger(live) && live >= 1 ? live : DEFAULT_OPTIONS.liveLimit,
    defaultMode: isModeId(options.defaultMode) ? options.defaultMode : DEFAULT_OPTIONS.defaultMode,
    sound: options.sound === true,
  };
}

export const Incantly = Extension.create<IncantlyTiptapOptions, IncantlyStorage>({
  name: 'incantly',

  addOptions() {
    return { ...DEFAULT_OPTIONS };
  },

  addStorage() {
    return { lastError: null };
  },

  addExtensions() {
    const options = resolveOptions(this.options);
    return [IncantlyFigure.configure(options)];
  },
});

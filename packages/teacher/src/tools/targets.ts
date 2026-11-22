/**
 * Target adapters (teacher design 9). `figureTarget` wraps an SDK app (or a headless app): the tools run lines through
 * it and read the figure from it. The adapter holds the target's tool guard.
 */
import { DEFAULT_LIMITS } from '@incantly/kernel';
import type { ErrorObject } from '@incantly/kernel';
import type { App } from '@incantly/sdk';
import { ToolGuard } from './guard';
import type { Target } from './types';

export interface TargetOptions {
  /** Hears a refused move of the target's machines (a bug). Default: nobody. */
  readonly onFault?: (e: ErrorObject) => void;
}

export function figureTarget(app: App, options: TargetOptions = {}): Target {
  return {
    kind: 'figure',
    get mode() {
      return app.mode;
    },
    guard: new ToolGuard(options.onFault),
    lineLimit: DEFAULT_LIMITS.lineLength,
    // independent lines: a line that reads a name a failed line of the call was to make gets `blockedBy` (errors design 6, rule 2)
    run: (lines) => app.run(lines, { independent: true }),
    objects() {
      const list = app.list();
      return { list, truncated: (list as { truncated?: boolean }).truncated === true };
    },
    figureSummary: () => app.figureSummary(),
    undefinedObjects: () => app.undefinedObjects(),
    clock: {
      get t() {
        return app.clock.t;
      },
      play: () => app.clock.play(),
      pause: () => app.clock.pause(),
      seek: (t) => app.clock.seek(t),
    },
  };
}

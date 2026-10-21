import type { LiveOptions, ProbeRequest } from '../protocol/bridge';
import type { RendererMessage, RuntimeUpdate } from '../protocol/runtime-messages';
import type { ErrorView } from '../protocol/ui';
import type { ProbeReport } from '../probe/probe';
import type { InstrumentedScene } from '../validation/instrument-map';

/** Messages between the frame and its Worker. Internal to the sandbox. */

export interface WorkerBoot {
  readonly type: 'boot';
  readonly mode: 'live' | 'probe';
  readonly lineOffset: number;
  readonly sceneLines: number;
  readonly shifts: InstrumentedScene['shifts'];
  readonly live?: LiveOptions;
  readonly probe?: ProbeRequest;
}

export type WorkerInbound = WorkerBoot | { readonly type: 'message'; readonly message: RendererMessage };

export type WorkerOutbound =
  | { readonly type: 'alive' }
  | { readonly type: 'update'; readonly update: RuntimeUpdate }
  | { readonly type: 'probe'; readonly report: ProbeReport }
  | { readonly type: 'fatal'; readonly error: ErrorView };

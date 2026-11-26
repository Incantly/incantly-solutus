/**
 * The agent of one board put together (design 11): the runner of the board tools, the service with its transport, the
 * circle to ask, and, on a screen, the hand that draws on the live layer. `createBoard`'s `agent` option is `AgentOption`.
 * Without a transport the kit still exists, so the Ask tool can say the agent is unavailable and a host can read the
 * conversation; with one (or a `server`) the board shows the agent panel.
 */
import { BoardAgent } from '../core/agent';
import type { AgentOptions } from '../core/agent';
import { AgentService } from '../core/agent-service';
import type { BoardAgentTransport } from '../core/agent-service';
import type { BoardCore } from '../core/board';
import { CircleAsk } from '../core/circle';
import type { BoardError } from '../core/errors';
import type { Bounds } from '../core/types';
import { httpAgentTransport } from './agent-http';
import { sdkFigureHost } from './agent-lines';
import { WebHand } from './agent-hand';
import { drawItems2D } from './painter-2d';
import type { ImageLookup } from './painter-2d';

/** The `agent` option of `createBoard` (design 10). */
export interface AgentOption {
  /** How requests reach a model; the default is the HTTP client for `server`. */
  readonly transport?: BoardAgentTransport;
  /** The address of `@incantly/server`; the board posts to `{server}/v1/board/ask`. */
  readonly server?: string;
  /** Send a picture of the circled area with the request. Default false: only for a model that reads pictures. */
  readonly vision?: boolean;
  /** Draw hand-style actions at once. Default: the user's own setting (`prefers-reduced-motion`). */
  readonly reducedMotion?: boolean;
  /** A line under the panel's title; a stand-in agent says what it is here. */
  readonly label?: string;
  /** For tests and hosts that route requests themselves; default `fetch`. */
  readonly fetch?: typeof fetch;
  /** When false, the camera stays put while the agent draws. Default true: new work is kept on screen. */
  readonly follow?: boolean;
}

export interface AgentKit {
  readonly runner: BoardAgent;
  readonly service: AgentService;
  readonly circle: CircleAsk;
  /** The hand animation of a board on a screen; undefined for a headless board. */
  readonly hand: WebHand | undefined;
  readonly option: AgentOption;
  /** True when requests can go somewhere: the panel shows only then. */
  readonly enabled: boolean;
}

export interface KitEnv {
  readonly view?: () => Bounds;
  readonly viewSize?: () => { readonly w: number; readonly h: number };
  readonly clock?: () => number;
  readonly requestFrame?: () => void;
  readonly onTip?: (at: { readonly x: number; readonly y: number }) => void;
  readonly onHand?: (at: { readonly x: number; readonly y: number }) => void;
  readonly onPoint?: (box: Bounds) => void;
  readonly onAsk?: () => void;
  readonly picture?: (area: Bounds) => string | undefined;
  readonly onError: (error: BoardError) => void;
}

/** True when the user asks for less motion. */
const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createAgentKit(core: BoardCore, option: AgentOption | undefined, env: KitEnv): AgentKit {
  const opt = option ?? {};
  const transport = opt.transport ?? (opt.server !== undefined && opt.server.trim() !== '' ? httpAgentTransport(opt.server, opt.fetch) : undefined);
  // The hand is built before the runner, and each frame of a stroke tells the runner where the pen is.
  const follow: { runner?: BoardAgent } = {};
  const hand =
    env.requestFrame !== undefined
      ? new WebHand({
          core,
          requestFrame: env.requestFrame,
          onTip: (at) => {
            follow.runner?.followTip(at);
            env.onTip?.(at);
          },
          onError: env.onError,
        })
      : undefined;
  const figures = sdkFigureHost();
  const options: AgentOptions = {
    figures,
    follow: opt.follow !== false,
    reducedMotion: () => opt.reducedMotion ?? prefersReducedMotion(),
    ...(env.view !== undefined ? { view: env.view } : {}),
    ...(env.viewSize !== undefined ? { viewSize: env.viewSize } : {}),
    ...(env.clock !== undefined ? { clock: env.clock } : {}),
    ...(hand !== undefined ? { hand } : {}),
    ...(env.onPoint !== undefined ? { onPoint: env.onPoint } : {}),
    ...(env.onHand !== undefined ? { onHand: env.onHand } : {}),
  };
  const runner = new BoardAgent(core, options);
  follow.runner = runner;
  const service = new AgentService(runner, { ...(transport !== undefined ? { transport } : {}), onError: env.onError });
  const circle = new CircleAsk(core, service, {
    figures,
    ...(opt.vision === true && env.picture !== undefined ? { picture: env.picture } : {}),
    ...(env.onAsk !== undefined ? { onAsk: env.onAsk } : {}),
  });
  return { runner, service, circle, hand, option: opt, enabled: transport !== undefined };
}

/** The circled area as a PNG data URL, drawn the way a tile is (no figure cards' live apps); longest side 512 pixels at most. */
export function pictureOf(core: BoardCore, doc: Document, images: ImageLookup, area: Bounds): string | undefined {
  const w = area.maxX - area.minX;
  const h = area.maxY - area.minY;
  if (!(w >= 1 && h >= 1)) return undefined;
  const scale = Math.min(1, 512 / Math.max(w, h));
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w * scale));
  canvas.height = Math.max(1, Math.ceil(h * scale));
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawItems2D(ctx, core.drawList.itemsIn(area, scale), scale, area.minX, area.minY, images);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

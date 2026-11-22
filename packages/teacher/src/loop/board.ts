/**
 * The jobs `circle` and `talk` (teacher agent.md 1, board agent.md 3): one board request in, a stream of turn events out.
 * The request is already checked (the server's `/v1/board/ask` does that); this builds the board target from its items,
 * gives the model `board_read` and `board`, and runs the turn. What leaves are the `actions` that passed the checks of
 * `boardTarget`, the model's words as `say` pieces (a talk's as they come; a circle's in one piece before `done`, and only
 * when the circle drew something), then `done` or an `error`. A talk with words and no action ends with `done`; a turn with
 * no action and no words, and a circle that drew nothing, end with `model_bad_output`, as a prompt to figure does when no
 * line passed.
 */
import { EDITS_MINE } from '@incantly/board/core';
import type { BoardAgentRequest } from '@incantly/board/core';
import { streamErrorOf } from '../errors';
import { choiceAsk, choiceMode, isChoiceId } from '../prompt/choices';
import type { TurnRequest } from '../prompt/build';
import { boardTarget } from '../tools/board-target';
import { toolset } from '../tools/toolset';
import type { ChatImage, ModelClient } from './model';
import { runTurn } from './turn';
import type { TurnEvent, TurnLimits } from './turn';

export interface BoardTurnOptions {
  readonly client: ModelClient;
  /** A request that passed its checks: a circle with a known choice, or a talk with its words. */
  readonly request: BoardAgentRequest;
  /** The circled area as a picture; the call then uses the vision models. */
  readonly image?: ChatImage;
  readonly signal?: AbortSignal;
  readonly now: () => number;
  readonly limits?: Partial<TurnLimits>;
}

/** The mode a request's figure cards use: the choice's for a circle, graphing for the talking agent. */
export function boardMode(request: BoardAgentRequest): string {
  return request.kind === 'circle' && isChoiceId(request.choice) ? choiceMode(request.choice) : 'graphing';
}

/** True when the request lets the agent change what the user made (a talk's `allowEdit`, a circle's `slider` and `animate`). */
export function boardAllowsEdit(request: BoardAgentRequest): boolean {
  return request.kind === 'talk' ? request.allowEdit : EDITS_MINE.includes(request.choice);
}

async function* run(o: BoardTurnOptions): AsyncGenerator<TurnEvent> {
  const r = o.request;
  const tools = toolset(['board_read', 'board']);
  if (!tools.ok) {
    yield { error: streamErrorOf(tools) };
    return;
  }
  const target = boardTarget(
    { page: r.page, items: r.items, more: r.more, ...(r.kind === 'circle' ? { circle: r.circle } : {}) },
    { mode: boardMode(r), allowEdit: boardAllowsEdit(r) },
  );
  const images = o.image === undefined ? {} : { images: [o.image] };
  const request: TurnRequest =
    r.kind === 'circle'
      ? { text: r.text ?? '', instruction: isChoiceId(r.choice) ? choiceAsk(r.choice) : choiceAsk('ask'), ...images }
      : { text: r.text, ...images };
  let sent = 0;
  let said = false;
  /** A circle's words, held until its answer is known to hold an action (a circle with nothing drawn is an error, not a reply). */
  const held: string[] = [];
  for await (const ev of runTurn({ job: r.kind, client: o.client, toolset: tools.value, target, request, now: o.now, ...(o.signal !== undefined ? { signal: o.signal } : {}), ...(o.limits !== undefined ? { limits: o.limits } : {}) })) {
    if ('actions' in ev) sent += ev.actions.length;
    if ('say' in ev) {
      // a talk's words go out as they come; a circle's wait for the end of the answer
      if (ev.say.trim() !== '') said = true;
      if (r.kind === 'circle') held.push(ev.say);
      else yield ev;
      continue;
    }
    if ('done' in ev && o.signal?.aborted !== true) {
      // a talk with words and no action is a valid answer (TR-28); anything else with no action did not draw
      if (sent === 0 && !(r.kind === 'talk' && said)) {
        yield { error: { ok: false, kind: 'model_bad_output', message: 'The AI could not draw this.', hint: 'Say it in other words.', detail: { reason: 'The model sent no board action that passed its checks.' } } };
        return;
      }
      if (held.length > 0) yield { say: held.join('') };
    }
    yield ev;
  }
}

/**
 * Runs a circle or talk request as a turn. Never throws; the last event is `done` or `error`.
 */
export function boardTurn(options: BoardTurnOptions): AsyncIterable<TurnEvent> {
  return run(options);
}

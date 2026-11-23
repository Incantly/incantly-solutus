/**
 * The prompt of a turn (teacher design 5): instructions for the job, the grammar summary, the mode card and the
 * catalogue make the system text; the figure now and what the person wrote make the first message. What a person wrote
 * goes in a `<material>` block, with any such tag inside it escaped, and the instructions say it is never an order.
 */
import type { CommandRegistry, Result } from '@incantly/kernel';
import { MODES, modeCard } from '@incantly/modes';
import type { ChatImage, ChatMessage } from '../loop/model';
import type { Target } from '../tools/types';
import { catalogueFor } from './catalogue';
import { GRAMMAR } from './grammar';
import { jobInstructions } from './jobs';
import type { JobId } from './jobs';
import { tokensOf } from './tokens';

/** Each job's system text stays under this many tokens (design 5), before the target's own data. */
export const PROMPT_LIMIT = 4000;
/** The system text aims below the limit by a margin, so rounding in the groups' counts cannot pass it. */
const SYSTEM_TARGET = 3900;
/** The figure's own data in the first message, at most this many tokens. */
export const TARGET_DATA_TOKENS = 1200;

export interface HistoryItem {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface TurnRequest {
  /** What the person said or typed. It goes in the material block. */
  readonly text: string;
  /** What the job asks for, in our words (a circle's chosen answer). It goes before the material, outside it, so it is an instruction. */
  readonly instruction?: string;
  /** More of what people wrote (document text, board text, a circled item's text), one block each. */
  readonly material?: readonly string[];
  /** The last turns, oldest first. */
  readonly history?: readonly HistoryItem[];
  /** Pictures the person sent (a circled area): they go with the first message and the call uses the vision models. */
  readonly images?: readonly ChatImage[];
  /** What the job kept from earlier turns, already fenced and cut (a lesson's memory block). It goes in the system text, so the catalogue's room shrinks by its size. */
  readonly memory?: string;
}

export interface PromptOptions {
  /** The tools the job offers; default `draw` and `figure`. */
  readonly tools?: readonly string[];
  /** Groups the turn has used so far, most recent first: they load before the groups the words need. */
  readonly groups?: readonly string[];
  /** The command table; default the SDK's. */
  readonly registry?: CommandRegistry;
}

export interface PromptTokens {
  readonly system: number;
  readonly messages: number;
  readonly total: number;
}

export interface SystemPrompt {
  readonly system: string;
  readonly tokens: number;
  /** The catalogue groups the system text loads. */
  readonly groups: readonly string[];
}

export interface BuiltPrompt {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  /** The catalogue groups the system text loads. */
  readonly groups: readonly string[];
  readonly tokens: PromptTokens;
}

/** Escapes any `<material>` or `</material>` tag in what a person wrote, so it cannot close the block. */
export function escapeMaterial(text: string): string {
  return text.replace(/<(\s*\/?\s*material)/gi, '&lt;$1');
}

export function materialBlock(text: string): string {
  return `<material>\n${escapeMaterial(text)}\n</material>`;
}

/** The figure's summary as the first message shows it: a head line, what is undefined, a sample of objects, cut to `TARGET_DATA_TOKENS`. */
function figureText(target: Target): string {
  const s = target.figureSummary();
  const head = `mode: ${s.mode}; objects: ${s.objects}; t: ${s.t}; window: x ${s.view.x0}..${s.view.x1}, y ${s.view.y0}..${s.view.y1}`;
  const lines = [head];
  if (s.undefined.length > 0) lines.push(`undefined: ${s.undefined.map((u) => `${u.name} (${u.reason})`).join(', ')}`);
  for (const o of s.sample) lines.push(`${o.summary}  [${o.type}${o.visible ? '' : ', hidden'}]`);
  if (s.objects > s.sample.length) lines.push(`... and ${s.objects - s.sample.length} more (call figure to read them)`);
  const text = lines.join('\n');
  const max = TARGET_DATA_TOKENS * 4;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The target's own data for the first message, cut to `TARGET_DATA_TOKENS`: a figure's summary, or a board's head line. */
export function describeTarget(target: Target): string {
  return target.board !== undefined ? target.board.describe().head : figureText(target);
}

/**
 * The system text: instructions, grammar, mode card and the catalogue groups that fit. An unknown mode is
 * `bad_argument`. `request.text` and the types of the figure's objects choose which groups load first.
 */
export function buildSystem(job: JobId, target: Target, request: Pick<TurnRequest, 'text' | 'instruction' | 'memory'>, options: PromptOptions = {}): Result<SystemPrompt> {
  const catalogue = options.registry === undefined ? catalogueFor(target.mode) : catalogueFor(target.mode, options.registry);
  if (!catalogue.ok) return catalogue;
  const config = MODES[target.mode as keyof typeof MODES];
  const fixed = [jobInstructions(job, options.tools ?? ['draw', 'figure'], target.mode), `LANGUAGE\n${GRAMMAR}`, `APP MODE\n${modeCard(config)}`, ...(request.memory !== undefined && request.memory !== '' ? [request.memory] : [])].join('\n\n');
  const types = target.figureSummary().sample.map((o) => o.type);
  const words = request.instruction === undefined ? request.text : `${request.instruction}\n${request.text}`;
  const wanted = [...(options.groups ?? []), ...catalogue.value.groupsFor(words, types)];
  const room = SYSTEM_TARGET - tokensOf(fixed) - 2;
  const picked = catalogue.value.withGroups(wanted, room);
  const system = `${fixed}\n\n${picked.text}`;
  return { ok: true, value: { system, tokens: tokensOf(system), groups: picked.loaded }, notices: [] };
}

/** The messages of a first model call: the history, then the figure now and what the person wrote. */
export function buildMessages(target: Target, request: TurnRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const h of request.history ?? []) {
    messages.push(h.role === 'user' ? { role: 'user', content: materialBlock(h.text) } : { role: 'assistant', content: h.text });
  }
  const board = target.board?.describe();
  // a live lesson on a board may also hold the figure of the card in focus: it is told after the board
  const focus = board !== undefined && target.figureSummary().objects > 0 ? `\n\nTHE FIGURE IN FOCUS (the card the lesson draws on)\n${figureText(target)}` : '';
  const first =
    board === undefined
      ? `THE FIGURE NOW\n${describeTarget(target)}`
      : `THE BOARD NOW\n${board.head}\n\n${materialBlock(board.items === '' ? '(nothing in view)' : board.items)}${focus}`;
  const texts = request.instruction === undefined ? [request.text, ...(request.material ?? [])] : [request.text, ...(request.material ?? [])].filter((t) => t.trim() !== '');
  const blocks = texts.map(materialBlock).join('\n\n');
  const ask = request.instruction === undefined ? '' : `\n\nTHE REQUEST\n${request.instruction}`;
  messages.push({
    role: 'user',
    content: `${first}${ask}${blocks === '' ? '' : `\n\n${blocks}`}`,
    ...(request.images !== undefined && request.images.length > 0 ? { images: request.images } : {}),
  });
  return messages;
}

/** The whole first prompt of a turn, with its token counts (4 characters a token). */
export function buildPrompt(job: JobId, target: Target, request: TurnRequest, options: PromptOptions = {}): Result<BuiltPrompt> {
  const system = buildSystem(job, target, request, options);
  if (!system.ok) return system;
  const messages = buildMessages(target, request);
  const messageTokens = messages.reduce((n, m) => n + tokensOf(m.content), 0);
  return {
    ok: true,
    value: { system: system.value.system, groups: system.value.groups, messages, tokens: { system: system.value.tokens, messages: messageTokens, total: system.value.tokens + messageTokens } },
    notices: [],
  };
}

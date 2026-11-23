/**
 * A model client that replays a recording (teacher design 11, server design 4). Every test and bench uses it; it never
 * touches the network. A recording is JSON: the replies, in the order the loop will ask for them.
 */
import type { StreamError } from '../errors';
import type { ChatEvent, ChatRequest, ModelClient } from './model';

export interface RecordedToolCall {
  readonly id?: string;
  readonly name: string;
  /** The arguments as the model wrote them: JSON text, or the data it holds. */
  readonly args: string | Readonly<Record<string, unknown>>;
}

export interface RecordedReply {
  /** The reply's text in one piece (ignored when `pieces` is given). */
  readonly text?: string;
  /** The reply's text as the pieces the stream sent. */
  readonly pieces?: readonly string[];
  readonly toolCalls?: readonly RecordedToolCall[];
  /** The reply fails after its text and calls (kind `stream_cut` is a cut reply). */
  readonly error?: StreamError;
  readonly model?: string;
}

export interface Recording {
  readonly replies: readonly RecordedReply[];
}

export class FakeModel implements ModelClient {
  /** The requests the loop made, in order. */
  readonly requests: ChatRequest[] = [];
  private next = 0;

  constructor(private readonly replies: readonly RecordedReply[]) {}

  /** How many replies were used. */
  get used(): number {
    return this.next;
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    this.requests.push(request);
    const reply = this.replies[this.next];
    this.next += 1;
    if (reply === undefined) {
      yield { error: { ok: false, kind: 'model_unavailable', message: 'The recording has no more replies.' } };
      return;
    }
    for (const piece of reply.pieces ?? (reply.text !== undefined ? [reply.text] : [])) {
      if (signal.aborted) return;
      if (piece !== '') yield { text: piece };
    }
    let n = 0;
    for (const call of reply.toolCalls ?? []) {
      if (signal.aborted) return;
      n += 1;
      yield { toolCall: { id: call.id ?? `call_${this.next}_${n}`, name: call.name, args: typeof call.args === 'string' ? call.args : JSON.stringify(call.args) } };
    }
    if (reply.error !== undefined) {
      yield { error: reply.error };
      return;
    }
    yield { done: { model: reply.model ?? 'fake', inputTokens: 0, outputTokens: 0 } };
  }
}

/** A client that replays `recording` (an object with `replies`, or the list of replies itself). */
export function fakeModel(recording: Recording | readonly RecordedReply[]): FakeModel {
  return new FakeModel(Array.isArray(recording) ? (recording as readonly RecordedReply[]) : (recording as Recording).replies);
}

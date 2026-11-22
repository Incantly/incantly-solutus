/**
 * OpenRouter's chat completions (docs/features/server/design.md 4, R3.1): `POST /api/v1/chat/completions` with
 * `stream: true`, the toolset as function-style `tools`, and a picture as an `image_url` part with a data URL. The key goes
 * only in the `Authorization` header. A failed status, a network failure and an error inside the stream all become an
 * `error` event with a fixed message: the provider's own text is never passed on, and no error holds the key or the body.
 */
import type { ChatEvent, ChatMessage, ChatRequest, ModelClient, ToolSpec } from '@incantly/teacher';
import { FallbackClient } from './fallback';
import type { FallbackOptions, ModelOpener } from './fallback';
import { chatEvents, providerError, streamCut } from './sse';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';
/** Sent as `HTTP-Referer` and `X-Title`, so OpenRouter can name the app in its rankings. */
export const OPENROUTER_REFERER = 'https://incantly.xyz';
export const OPENROUTER_TITLE = 'Incantly';

export interface OpenRouterOptions {
  /** The key, read when a request starts (so a key set later is used; it is never stored in a log or an error). */
  readonly apiKey: () => string | undefined;
  /** The network. Default: the global `fetch`. Tests pass their own; none calls the real one. */
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
}

type Part = { readonly type: 'text'; readonly text: string } | { readonly type: 'image_url'; readonly image_url: { readonly url: string } };

type WireMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string | readonly Part[] }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly { readonly id: string; readonly type: 'function'; readonly function: { readonly name: string; readonly arguments: string } }[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

function wireMessage(m: ChatMessage): WireMessage {
  if (m.role === 'user') {
    if (m.images === undefined || m.images.length === 0) return { role: 'user', content: m.content };
    const parts: Part[] = [{ type: 'text', text: m.content }, ...m.images.map((i): Part => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))];
    return { role: 'user', content: parts };
  }
  if (m.role === 'assistant') {
    const calls = m.toolCalls ?? [];
    return calls.length === 0
      ? { role: 'assistant', content: m.content }
      : { role: 'assistant', content: m.content === '' ? null : m.content, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) };
  }
  return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
}

const wireTool = (t: ToolSpec): unknown => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } });

/** The JSON body of a chat completions request for `model`. `tools` is left out when the call has none. */
export function requestBody(model: string, request: ChatRequest): string {
  const messages: WireMessage[] = [{ role: 'system', content: request.system }, ...request.messages.map(wireMessage)];
  return JSON.stringify({
    model,
    messages,
    stream: true,
    temperature: 0.2,
    ...(request.tools.length > 0 ? { tools: request.tools.map(wireTool) } : {}),
  });
}

/** Milliseconds a `retry-after` header (seconds) asks for, or undefined. */
function retryAfterMs(res: Response): number | undefined {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 3600) * 1000 : undefined;
}

/** The opener of one OpenRouter model: its stream as `ChatEvent`s, with errors as events and never as throws. */
export function openRouterOpener(options: OpenRouterOptions): ModelOpener {
  const base = (options.baseUrl ?? OPENROUTER_URL).replace(/\/+$/, '');
  return async function* open(model, request, signal): AsyncGenerator<ChatEvent> {
    const key = options.apiKey();
    if (key === undefined || key === '') {
      yield { error: providerError(undefined) };
      return;
    }
    let res: Response;
    try {
      const send = options.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init));
      res = await send(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'http-referer': OPENROUTER_REFERER,
          'x-title': OPENROUTER_TITLE,
        },
        body: requestBody(model, request),
        signal,
      });
    } catch {
      if (!signal.aborted) yield { error: providerError(undefined) };
      return;
    }
    if (!res.ok) {
      try {
        await res.body?.cancel();
      } catch {
        // the body was already closed
      }
      yield { error: providerError(res.status, retryAfterMs(res)) };
      return;
    }
    if (res.body === null) {
      yield { error: providerError(undefined) };
      return;
    }
    try {
      yield* chatEvents(res.body, model);
    } catch {
      if (!signal.aborted) yield { error: streamCut() };
    }
  };
}

/**
 * The OpenRouter `ModelClient`: the models in order through `openRouterOpener`, with the fallback of design 4. A request
 * with `vision` uses `visionModels`.
 */
export function openRouterClient(options: OpenRouterOptions, models: Pick<FallbackOptions, 'textModels' | 'visionModels'> & Partial<Omit<FallbackOptions, 'open'>>): ModelClient {
  return new FallbackClient({ ...models, open: openRouterOpener(options) });
}

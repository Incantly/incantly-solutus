/**
 * The AI client (design 4, 9 and 10, agent.md): the request to `@incantly/server`, the streamed lines, and the job that
 * applies them to a figure and commits the script once. The model writes only lines; the extension owns the document.
 */
import type { Editor } from '@tiptap/core';
import { createHeadlessApp } from '@incantly/sdk';
import type { App, LineResult } from '@incantly/sdk';
import { SCRIPT_LIMIT, checkAttrs, scriptFits } from './attrs';
import { findFigure } from './doc';
import { ok, tiptapError } from './errors';
import type { TiptapError, TiptapResult } from './errors';
import { reportError } from './report';
import { peekRuntime } from './runtime';
import type { AiEvent, AiRequest, AiTransport, IncantlyTiptapOptions } from './types';

/** How much text round the figure goes to the model, in characters, on each side. */
export const CONTEXT_CHARS = 500;

/** The reason the AI cannot be used with these options, or `undefined` when it can. */
export function aiUnavailable(options: IncantlyTiptapOptions, id?: string): TiptapError | undefined {
  const server = typeof options.server === 'string' ? options.server.trim() : '';
  if (server === '' && options.aiTransport === undefined) {
    return tiptapError('ai_unavailable', 'The AI needs a server, and none was set.', {
      hint: 'Pass the address of @incantly/server as the server option, or edit the lines by hand.',
      ...(id !== undefined ? { node: id } : {}),
    });
  }
  return undefined;
}

/** One line of the server's answer as an event, or `undefined` when it is not one. */
export function parseEvent(line: string): AiEvent | undefined {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o['lines']) && o['lines'].every((l) => typeof l === 'string')) return { lines: o['lines'] as string[] };
  if (o['done'] === true) return { done: true };
  const e = o['error'];
  if (typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string') {
    const kind = (e as { kind?: unknown }).kind;
    return { error: { kind: typeof kind === 'string' ? kind : 'error', message: (e as { message: string }).message } };
  }
  return undefined;
}

const badStream = (): AiEvent => ({ error: { kind: 'bad_stream', message: 'The server sent an answer that is not lines of a figure.' } });

/**
 * The HTTP client: `POST {server}/v1/figure/draw` with the request as JSON; the answer is NDJSON, `{lines}` events then
 * `{done: true}`, or `{error: {kind, message}}`. A network failure throws; the job turns it into `ai_unavailable`.
 */
export function httpTransport(server: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): AiTransport {
  return async function* (request, signal) {
    const url = `${server.trim().replace(/\/+$/, '')}/v1/figure/draw`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) {
      yield { error: { kind: `http_${res.status}`, message: `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.` } };
      return;
    }
    const body = res.body;
    if (!body) {
      for (const l of (await res.text()).split('\n')) {
        if (l.trim() === '') continue;
        const ev = parseEvent(l);
        yield ev ?? badStream();
        if (!ev) return;
      }
      return;
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const l = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (l.trim() !== '') {
            const ev = parseEvent(l);
            yield ev ?? badStream();
            if (!ev) return;
          }
          nl = buffer.indexOf('\n');
        }
        if (done) break;
      }
      if (buffer.trim() !== '') {
        const ev = parseEvent(buffer);
        yield ev ?? badStream();
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // the stream was already closed
      }
    }
  };
}

/** What a finished job did. */
export interface AskOutcome {
  /** Lines added to the figure. */
  readonly applied: number;
  /** Lines the model wrote that the figure could not use. */
  readonly failed: readonly string[];
}

const jobs = new WeakMap<Editor, Map<string, AbortController>>();

/** The options of the extension on this editor. */
function optionsOf(editor: Editor): IncantlyTiptapOptions {
  const fromRuntime = peekRuntime(editor)?.options;
  if (fromRuntime) return fromRuntime;
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'incantlyFigure');
  return (ext?.options ?? {}) as IncantlyTiptapOptions;
}

const joinScript = (base: string, lines: readonly string[]): string => {
  if (lines.length === 0) return base;
  const head = base === '' || base.endsWith('\n') ? base : `${base}\n`;
  return `${head}${lines.join('\n')}`;
};

/** The writer's text round a figure: up to 500 characters before it and after it. */
function surroundingText(editor: Editor, pos: number, size: number): { before: string; after: string } {
  const doc = editor.state.doc;
  const from = Math.max(0, pos - CONTEXT_CHARS * 3);
  const to = Math.min(doc.content.size, pos + size + CONTEXT_CHARS * 3);
  const before = doc.textBetween(from, pos, '\n', ' ').slice(-CONTEXT_CHARS);
  const after = doc.textBetween(pos + size, to, '\n', ' ').slice(0, CONTEXT_CHARS);
  return { before, after };
}

/**
 * Asks the AI to draw or change a figure. Lines apply to the figure as they arrive and show in the lines panel; when the
 * answer ends, the script commits as one transaction. Nothing throws: a failure is the result, and also goes to
 * `onError`. A newer request on the same figure stops this one.
 */
export async function askIncantly(editor: Editor, id: string, request: string): Promise<TiptapResult<AskOutcome>> {
  const options = optionsOf(editor);
  const fail = (e: TiptapError, say = true): TiptapError => {
    reportError(editor, options, e);
    if (say) peekRuntime(editor)?.viewOf(id)?.aiStatus(e.hint ? `${e.message} ${e.hint}` : e.message, false);
    return e;
  };
  try {
    const unavailable = aiUnavailable(options, id);
    if (unavailable) return fail(unavailable);
    if (typeof request !== 'string' || request.trim() === '') return fail(tiptapError('ai_unavailable', 'There is no request to send.', { hint: 'Write what the figure should show.', node: id }));
    const found = findFigure(editor.state.doc, id);
    if (!found) return fail(tiptapError('figure_not_found', `There is no figure with the id ${id}.`, { node: id }));
    const checked = checkAttrs(found.node.attrs);
    if (!checked.ok) return fail(checked);
    const attrs = checked.value;
    const runtime = peekRuntime(editor);
    const view = runtime?.viewOf(id);

    // a new request on the same figure stops the old one
    let map = jobs.get(editor);
    if (!map) {
      map = new Map();
      jobs.set(editor, map);
    }
    map.get(id)?.abort();
    const ctl = new AbortController();
    map.set(id, ctl);

    const base = attrs.script;
    const summary = base.trim() !== '' ? (runtime?.store.appFor(id)?.figureSummary() ?? null) : null;
    const around = surroundingText(editor, found.pos, found.node.nodeSize);
    const req: AiRequest = { request: request.trim(), mode: attrs.mode, script: base, figure: summary, before: around.before, after: around.after };
    const transport: AiTransport = options.aiTransport ?? httpTransport(options.server ?? '');

    view?.beginAi(base);
    view?.aiStatus('The AI is writing…', true);
    let jobApp: App | undefined;
    const applyTo = (lines: readonly string[]): readonly LineResult[] => {
      const live = view?.runLines(lines);
      if (live) return live;
      // the figure is not live: a headless one starts from the lines already accepted, so later lines can read them
      if (!jobApp) jobApp = createHeadlessApp({ mode: attrs.mode, script: joinScript(base, good) });
      return jobApp.run(lines);
    };

    const good: string[] = [];
    const failed: string[] = [];
    let stopped: TiptapError | undefined;
    let finished = false;
    let tooBig = false;
    try {
      for await (const ev of transport(req, ctl.signal)) {
        if (ctl.signal.aborted) break;
        if ('lines' in ev) {
          const lines = ev.lines.flatMap((l) => l.split('\n')).filter((l) => l.trim() !== '');
          if (lines.length === 0) continue;
          if (!scriptFits(joinScript(base, [...good, ...lines]))) {
            tooBig = true;
            break;
          }
          const results = applyTo(lines);
          const okAt = new Set<number>();
          results.forEach((r) => {
            if (r.ok && 'line' in r) okAt.add(r.line);
          });
          lines.forEach((l, i) => (okAt.has(i + 1) ? good : failed).push(l));
          view?.progressAi(joinScript(base, good));
        } else if ('done' in ev) {
          finished = true;
          break;
        } else {
          stopped = tiptapError('ai_unavailable', `The AI could not answer: ${ev.error.message}`, { hint: 'Edit the lines by hand, or try again.', node: id, detail: { serverKind: ev.error.kind } });
          break;
        }
      }
    } catch (e) {
      if (!ctl.signal.aborted) {
        stopped = tiptapError('ai_unavailable', `The AI could not be reached: ${e instanceof Error ? e.message : 'the request failed'}.`, { hint: 'Check the server address, or edit the lines by hand.', node: id });
      }
    } finally {
      try {
        jobApp?.destroy();
      } catch {
        // nothing to free
      }
      if (map.get(id) === ctl) map.delete(id);
    }

    // a newer request replaced this one: the figure and the panel are the newer request's now, so this one touches neither
    if (ctl.signal.aborted) {
      if (!map.has(id)) view?.resetToNode();
      return tiptapError('ai_partial', 'A newer request replaced this one.', { node: id, detail: { superseded: true, applied: good.length, failed } });
    }
    if (tooBig) stopped = tiptapError('ai_unavailable', `The figure would be over ${SCRIPT_LIMIT / 1024} KB.`, { hint: 'Split the figure into two.', node: id });
    const next = joinScript(base, good);
    const commit = (): void => {
      if (good.length === 0) return;
      if (view) view.commitScript(next);
      else editor.commands.updateIncantlyFigure(id, { script: next });
    };

    if (stopped || !finished) {
      const reason = stopped ?? tiptapError('ai_unavailable', 'The AI stopped before it finished.', { hint: 'Try again, or edit the lines by hand.', node: id });
      if (good.length === 0) {
        view?.resetToNode();
        return fail(reason);
      }
      commit();
      const lost = failed.length;
      return fail(
        tiptapError('ai_partial', `The AI stopped after ${good.length} ${good.length === 1 ? 'line' : 'lines'}${lost > 0 ? `; ${lost} did not apply` : ''}.`, {
          hint: 'The lines that worked are kept. Try the request again, or fix the lines.',
          node: id,
          detail: { applied: good.length, failed, reason: reason.message },
        }),
      );
    }
    commit();
    const msg =
      failed.length === 0
        ? good.length === 0
          ? 'The AI sent no lines.'
          : `Added ${good.length} ${good.length === 1 ? 'line' : 'lines'}.`
        : `Added ${good.length} ${good.length === 1 ? 'line' : 'lines'}. These did not apply: ${failed.join(' | ')}`;
    view?.aiStatus(msg, false);
    return ok({ applied: good.length, failed });
  } catch (e) {
    return fail(tiptapError('ai_unavailable', `The AI request failed: ${e instanceof Error ? e.message : 'unknown reason'}.`, { node: id }));
  }
}

/** Starts the job for one figure in the background. Returns `true` once it has started. */
export function startAsk(editor: Editor, _options: IncantlyTiptapOptions, id: string, request: string): boolean {
  void askIncantly(editor, id, request);
  return true;
}

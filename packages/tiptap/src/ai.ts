/**
 * The AI client (design 4, agent.md). Round 1 holds the availability check the `askIncantly` command needs; the
 * request, the stream and the job are added in round 4.
 */
import type { Editor } from '@tiptap/core';
import { tiptapError } from './errors';
import type { TiptapError } from './errors';
import type { IncantlyTiptapOptions } from './types';

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

/** Starts the job for one figure (round 4). Returns `false` while nothing can start. */
export function startAsk(_editor: Editor, _options: IncantlyTiptapOptions, _id: string, _request: string): boolean {
  return false;
}

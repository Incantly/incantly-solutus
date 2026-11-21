/** Where an error goes: `editor.storage.incantly.lastError` and the host's `onError`. Nothing here throws. */
import type { Editor } from '@tiptap/core';
import type { TiptapError } from './errors';
import type { IncantlyTiptapOptions } from './types';

export function reportError(editor: Editor, options: IncantlyTiptapOptions, error: TiptapError): void {
  try {
    const storage = (editor.storage as unknown as Record<string, Record<string, unknown> | undefined>)['incantly'];
    if (storage) storage['lastError'] = error;
  } catch {
    // the editor may be gone; the host's callback below still hears of it
  }
  try {
    options.onError?.(error);
  } catch {
    // a host callback that throws must not break the editor
  }
}

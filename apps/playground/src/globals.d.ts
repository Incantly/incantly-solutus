/// <reference types="vite/client" />
import type { Editor } from '@tiptap/core';

export interface PlaygroundHandle {
  ready: boolean;
  page: string;
  editor?: Editor;
  /** Milliseconds from navigation start until the editor accepted input. */
  editorReadyMs?: number;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __playground?: PlaygroundHandle;
  }
}

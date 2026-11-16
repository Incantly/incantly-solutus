/**
 * What the screen does with files (embed-files-export ui.md 3 and 5): download a picture or a file, pick a file to
 * open, say what an open did, list the lines that failed, and build a share link. Used by `createApp`'s menu and by
 * the studio.
 */
import type { LoadResult } from '../file';
import type { ApiError } from '../errors';
import type { KernelError } from '../app';

/** Downloads a blob under a file name through a normal download. */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // the browser has the blob once the click ran; give it a moment before the URL goes
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name from a title: letters, digits, spaces and dashes; `figure` when there is none. */
export function fileName(title: string | undefined, ext: string): string {
  const base = (title ?? '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return `${base || 'figure'}.${ext}`;
}

/** Asks for one file with the file picker. Resolves to nothing when the learner cancels. */
export function pickFile(accept = '.incantly,.inc,.json,.txt'): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(undefined);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** The bytes of a picked file. */
export async function bytesOf(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Uint8Array(await new Response(file).arrayBuffer());
}

/** The toast after an open: "Opened 41 lines" or "Opened 41 of 43 lines. 2 could not be used." (ui.md 3). */
export function openedText(r: LoadResult | ApiError): string {
  if (!('applied' in r)) return r.message;
  const res = r;
  const total = res.applied + res.failed.length;
  if (!res.ok && res.applied === 0) return res.failed.length ? `Nothing opened: ${res.failed[0]?.message ?? 'no line could be used'}` : 'Nothing opened.';
  const lines = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;
  if (res.failed.length === 0) return `Opened ${lines(res.applied)}.`;
  return `Opened ${res.applied} of ${lines(total)}. ${res.failed.length} could not be used.`;
}

/** One failed line as the panel shows it: where, what, and the hint (the same format as a typed error). */
export function failedLine(e: KernelError): { where: string; message: string; hint?: string; source?: string } {
  return { where: `Line ${e.line}`, message: e.message, ...(e.hint ? { hint: e.hint } : {}), ...(e.source ? { source: e.source } : {}) };
}

/** A list of the failed lines, for the `Show` panel. */
export function failedList(failed: readonly KernelError[]): HTMLOListElement {
  const ol = document.createElement('ol');
  ol.className = 'failed-lines';
  for (const e of failed) {
    const f = failedLine(e);
    const li = document.createElement('li');
    const head = document.createElement('strong');
    head.textContent = `${f.where}: `;
    li.append(head, f.message);
    if (f.source) {
      const code = document.createElement('code');
      code.textContent = f.source;
      li.append(document.createElement('br'), code);
    }
    if (f.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = f.hint;
      li.append(hint);
    }
    ol.append(li);
  }
  return ol;
}

/** The page address with a figure in its fragment (design 6). Nothing is sent to a server. */
export function shareUrl(fragment: string, href: string): string {
  const base = href.split('#')[0] ?? href;
  return `${base}#${fragment}`;
}

/** The `f=…` part of a page address, if there is one. */
export function fragmentOf(href: string): string | undefined {
  const hash = href.split('#')[1];
  return hash && /^f=/.test(hash) ? hash : undefined;
}

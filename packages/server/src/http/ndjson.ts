/**
 * The NDJSON answer (docs/features/server/design.md 6): `200`, `application/x-ndjson`, one JSON event a line, each
 * flushed when written so the client sees it at once. The job (`jobs/job.ts`) decides when the head and each line may
 * be written; this file writes them.
 */
import type { ServerResponse } from 'node:http';

export const NDJSON_TYPE = 'application/x-ndjson; charset=utf-8';

/** Sends the head and flushes it, so the client has the stream before the first line. */
export function openNdjson(res: ServerResponse, headers: Readonly<Record<string, string>>): void {
  res.socket?.setNoDelay(true);
  res.writeHead(200, { ...headers, 'content-type': NDJSON_TYPE, 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.flushHeaders();
}

/** One event as one line. */
export function ndjsonLine(event: unknown): string {
  return `${JSON.stringify(event)}\n`;
}

/** Writes one event; a write to a closed connection is dropped. */
export function writeNdjson(res: ServerResponse, event: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(ndjsonLine(event));
}

/** Calls `onClose` when the client goes away before the answer ended (the job aborts the model call). */
export function onClientClose(res: ServerResponse, onClose: () => void): void {
  res.on('close', () => {
    if (!res.writableFinished) onClose();
  });
}

/**
 * The audio answer of `/v1/speech` (docs/features/server/design.md 6): `200` with `audio/mpeg`, or `audio/pcm` and
 * `x-sample-rate`, and the bytes as they come from the provider. The job (`jobs/job.ts`) decides when the head and each
 * chunk may be written; this file writes them. Nothing is buffered beyond what the socket holds: a chunk waits for the
 * socket to drain before the next is read.
 */
import type { ServerResponse } from 'node:http';

export type AudioType = 'audio/mpeg' | 'audio/pcm';

/** Sends the head and flushes it, so the client can start its decoder before the first byte arrives. */
export function openAudio(res: ServerResponse, headers: Readonly<Record<string, string>>, contentType: AudioType, extra: Readonly<Record<string, string>> = {}): void {
  res.socket?.setNoDelay(true);
  res.writeHead(200, { ...headers, ...extra, 'content-type': contentType, 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  res.flushHeaders();
}

/** Writes one chunk; waits for the socket when it is full. A write to a closed connection is dropped. */
export async function writeAudio(res: ServerResponse, bytes: Uint8Array): Promise<void> {
  if (res.destroyed || res.writableEnded) return;
  if (res.write(bytes)) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

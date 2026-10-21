import { contentRef } from '@incantly/core';
import type { FigureFragments } from './attributes';

/**
 * Where large figure content lives. A note stores only content references
 * (`sha256:` plus the hex digest) as ordinary node attributes, so copy and
 * paste and HTML export carry the reference, and identical content is stored
 * once. A host backs this with its own server; the cache keeps figures working
 * offline.
 */
export interface FigureStore {
  /** Stores a PNG data URL and returns its reference. */
  putSnapshot(png: string): Promise<string>;
  /** A URL an <img> can show, if the store has the snapshot. */
  getSnapshot(ref: string): Promise<string | undefined>;
  putFragments(fragments: FigureFragments): Promise<string>;
  getFragments(ref: string): Promise<FigureFragments | undefined>;
}

/** Fragments larger than this are stored by reference instead of inline. */
export const INLINE_FRAGMENTS_LIMIT = 16 * 1024;

export function fragmentsText(fragments: FigureFragments): string {
  return JSON.stringify({ html: fragments.html, css: fragments.css, js: fragments.js });
}

function isFragments(value: unknown): value is FigureFragments {
  const v = value as Partial<FigureFragments> | null;
  return !!v && typeof v.html === 'string' && typeof v.css === 'string' && typeof v.js === 'string';
}

/** Keeps everything in memory. For tests, the playground and as a session cache. */
export class MemoryFigureStore implements FigureStore {
  private readonly items = new Map<string, string>();

  async putSnapshot(png: string): Promise<string> {
    if (!png.startsWith('data:image/png;base64,')) throw new Error('Snapshots are PNG data URLs');
    const ref = contentRef(png);
    this.items.set(ref, png);
    return ref;
  }

  async getSnapshot(ref: string): Promise<string | undefined> {
    return this.items.get(ref);
  }

  async putFragments(fragments: FigureFragments): Promise<string> {
    const text = fragmentsText(fragments);
    const ref = contentRef(text);
    this.items.set(ref, text);
    return ref;
  }

  async getFragments(ref: string): Promise<FigureFragments | undefined> {
    const text = this.items.get(ref);
    if (text === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      return isFragments(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  get size(): number {
    return this.items.size;
  }
}

/**
 * Wraps a store with a local IndexedDB cache, so figures that were seen once
 * keep their snapshots and fragments offline. Content is checked against its
 * reference before it is trusted, from either side.
 */
export class CachedFigureStore implements FigureStore {
  private db: Promise<IDBDatabase | null> | null = null;

  constructor(
    private readonly remote: FigureStore,
    private readonly name = 'incantly-figures',
  ) {}

  async putSnapshot(png: string): Promise<string> {
    const ref = await this.remote.putSnapshot(png);
    await this.write(ref, png);
    return ref;
  }

  async getSnapshot(ref: string): Promise<string | undefined> {
    const cached = await this.read(ref);
    if (cached !== undefined && contentRef(cached) === ref) return cached;
    const remote = await this.remote.getSnapshot(ref);
    if (remote !== undefined && contentRef(remote) === ref) await this.write(ref, remote);
    return remote;
  }

  async putFragments(fragments: FigureFragments): Promise<string> {
    const ref = await this.remote.putFragments(fragments);
    await this.write(ref, fragmentsText(fragments));
    return ref;
  }

  async getFragments(ref: string): Promise<FigureFragments | undefined> {
    const cached = await this.read(ref);
    if (cached !== undefined && contentRef(cached) === ref) {
      try {
        const parsed: unknown = JSON.parse(cached);
        if (isFragments(parsed)) return parsed;
      } catch {
        // fall through to the remote store
      }
    }
    const remote = await this.remote.getFragments(ref);
    if (remote) await this.write(ref, fragmentsText(remote));
    return remote;
  }

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('content');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return this.db;
  }

  private async read(ref: string): Promise<string | undefined> {
    const db = await this.open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      const request = db.transaction('content', 'readonly').objectStore('content').get(ref);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
      request.onerror = () => resolve(undefined);
    });
  }

  private async write(ref: string, text: string): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const transaction = db.transaction('content', 'readwrite');
      transaction.objectStore('content').put(text, ref);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });
  }
}

import 'fake-indexeddb/auto';
import { contentRef } from '@incantly/core';
import { describe, expect, it } from 'vitest';
import { CachedFigureStore, MemoryFigureStore, type FigureStore } from '../src';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const FRAGMENTS = { html: "<div id='stage'></div>", css: '', js: "inc.idea('x');" };

/** A remote store that can go offline. */
class FlakyRemote implements FigureStore {
  readonly inner = new MemoryFigureStore();
  online = true;
  private check() {
    if (!this.online) throw new Error('offline');
  }
  async putSnapshot(png: string) {
    this.check();
    return this.inner.putSnapshot(png);
  }
  async getSnapshot(ref: string) {
    this.check();
    return this.inner.getSnapshot(ref);
  }
  async putFragments(fragments: typeof FRAGMENTS) {
    this.check();
    return this.inner.putFragments(fragments);
  }
  async getFragments(ref: string) {
    this.check();
    return this.inner.getFragments(ref);
  }
}

let databases = 0;
const cached = (remote: FigureStore) => new CachedFigureStore(remote, `test-${++databases}`);

describe('figure stores', () => {
  it('addresses content by its SHA-256, so identical content is stored once', async () => {
    const store = new MemoryFigureStore();
    const a = await store.putSnapshot(PNG);
    const b = await store.putSnapshot(PNG);
    expect(a).toBe(b);
    expect(a).toBe(contentRef(PNG));
    expect(store.size).toBe(1);
    await expect(store.putSnapshot('data:text/html,<script>')).rejects.toThrow();
  });

  it('round-trips fragments by reference', async () => {
    const store = new MemoryFigureStore();
    const ref = await store.putFragments(FRAGMENTS);
    expect(ref).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await store.getFragments(ref)).toEqual(FRAGMENTS);
    expect(await store.getFragments(`sha256:${'0'.repeat(64)}`)).toBeUndefined();
  });

  it('keeps content seen once available offline', async () => {
    const remote = new FlakyRemote();
    const store = cached(remote);
    const snapshot = await store.putSnapshot(PNG);
    const fragments = await store.putFragments(FRAGMENTS);
    remote.online = false;
    expect(await store.getSnapshot(snapshot)).toBe(PNG);
    expect(await store.getFragments(fragments)).toEqual(FRAGMENTS);
  });

  it('fills the cache from the remote store on first read', async () => {
    const remote = new FlakyRemote();
    const ref = await remote.putSnapshot(PNG);
    const store = cached(remote);
    expect(await store.getSnapshot(ref)).toBe(PNG);
    remote.online = false;
    expect(await store.getSnapshot(ref)).toBe(PNG);
  });

  it('never trusts cached content that does not match its reference', async () => {
    const remote = new FlakyRemote();
    const name = `test-${++databases}`;
    const store = new CachedFigureStore(remote, name);
    const ref = await store.putSnapshot(PNG);
    // Tamper with the cached copy directly.
    await new Promise<void>((resolve) => {
      const open = indexedDB.open(name, 1);
      open.onsuccess = () => {
        const tx = open.result.transaction('content', 'readwrite');
        tx.objectStore('content').put('data:image/png;base64,AAAA', ref);
        tx.oncomplete = () => resolve();
      };
    });
    const fresh = new CachedFigureStore(remote, name);
    expect(await fresh.getSnapshot(ref)).toBe(PNG);
  });
});

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSandboxed, prewarmFigure, sandboxAdapter } from '../src/sandbox/adapter';
import { referenceScene } from '../src/scenes';

/**
 * Warm frames (PRD 25.4): a live figure's frame booted before its scene
 * exists, which the next figure takes instead of booting its own. The frame
 * itself, and moving one from the page body, are checked in a real browser.
 */

const scene = () => {
  const { html, css, js } = referenceScene('sine-wave')!;
  return { html, css, js };
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('warm frames (PRD 25.4)', () => {
  it('keeps one frame booted in its place while a lease is held, and the figure mounted there takes it', async () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    const lease = sandboxAdapter.prewarm!({ container: slot });
    const waiting = slot.querySelector('iframe')!;
    // Hidden, out of the tab order, with a policy that lets in styles carrying its nonce.
    expect(waiting.getAttribute('aria-hidden')).toBe('true');
    expect(waiting.srcdoc).toMatch(/style-src [^;"]*'nonce-[A-Za-z0-9+/]{22}=='/);
    expect(waiting.srcdoc).toContain('<div class="inc-scene"></div>');
    const figure = mountSandboxed(slot, scene(), { title: 'Interactive figure: a sine wave' });
    expect([...slot.querySelectorAll('iframe')]).toEqual([waiting]);
    expect(waiting.hasAttribute('aria-hidden')).toBe(false);
    expect(waiting.title).toBe('Interactive figure: a sine wave');
    expect(waiting.style.visibility).toBe('');
    expect(waiting.style.width).toBe('100%');
    // Its own slot is the figure's now: nothing else is warmed there.
    await vi.advanceTimersByTimeAsync(0);
    expect(slot.querySelectorAll('iframe')).toHaveLength(1);
    lease.release();
    figure.destroy();
    expect(slot.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('closes a frame nobody took a while after the last lease is let go, and keeps it while another is held', () => {
    const slot = document.createElement('div');
    document.body.append(slot);
    const first = prewarmFigure({ container: slot });
    const second = prewarmFigure({ container: slot });
    expect(slot.querySelectorAll('iframe')).toHaveLength(1);
    first.release();
    first.release();
    vi.advanceTimersByTime(60_000);
    expect(slot.querySelectorAll('iframe')).toHaveLength(1);
    second.release();
    vi.advanceTimersByTime(14_000);
    expect(slot.querySelectorAll('iframe')).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(slot.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('boots a figure its own frame when none is waiting, or when the waiting one cannot be moved to it', async () => {
    const elsewhere = document.createElement('div');
    const slot = document.createElement('div');
    document.body.append(elsewhere, slot);
    // This document cannot move a frame without loading it again (no moveBefore), so the page body warms nothing.
    expect('moveBefore' in Element.prototype).toBe(false);
    const idle = prewarmFigure();
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    idle.release();
    const lease = prewarmFigure({ container: elsewhere });
    const waiting = elsewhere.querySelector('iframe')!;
    const figure = mountSandboxed(slot, scene());
    const own = slot.querySelector('iframe')!;
    expect(own).not.toBe(waiting);
    expect(own.srcdoc).not.toContain("'nonce-");
    // The waiting frame could not be used, so it is closed, and another is warmed while the lease is held.
    expect(waiting.isConnected).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(elsewhere.querySelectorAll('iframe')).toHaveLength(1);
    lease.release();
    figure.destroy();
  });
});

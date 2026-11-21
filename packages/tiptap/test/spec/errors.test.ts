/**
 * R2.5 (save and restore) and R10 (mount_failed, context_lost, restore_failed, nothing throws).
 * Docs: errors.md, design.md section 3 and 7, requirements R2, R10. Uses fake timers for the scheduler's 150 ms settle
 * and 8 s off-screen rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountedApp } from '@incantly/sdk';
import type { Editor } from '@tiptap/core';
import { FULL_WIDTH_PX } from '../../src/index';
import { Viewport, boxOf, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, posOf, undoSteps, lastError } from './helpers';

const probe = vi.hoisted(() => ({
  apps: [] as MountedApp[],
  calls: 0,
  failWhen: undefined as undefined | ((call: number) => boolean),
  gate: undefined as undefined | Promise<void>,
}));

vi.mock('@incantly/sdk', async (original) => {
  const sdk = await original<typeof import('@incantly/sdk')>();
  return {
    ...sdk,
    createApp: async (o: Parameters<typeof sdk.createApp>[0]) => {
      probe.calls++;
      if (probe.failWhen?.(probe.calls)) throw new Error('no GPU in this test');
      if (probe.gate) await probe.gate;
      const app = await sdk.createApp(o);
      probe.apps.push(app);
      return app;
    },
  };
});

const PIC = 'data:image/svg+xml;base64,PHN2Zy8+';
const tick = (ms: number): Promise<unknown> => vi.advanceTimersByTimeAsync(ms);
/** What a reader sees of the figure: its whole node view, not only the box (notices sit beside the box). */
const figureDom = (editor: { view: { dom: HTMLElement } }, id: string): HTMLElement => editor.view.dom.querySelector(`[data-id="${id}"]`) as HTMLElement;
const mounted = (): MountedApp[] => probe.apps.filter((a) => !a.destroyed);

beforeEach(() => {
  probe.apps = [];
  probe.calls = 0;
  probe.failWhen = undefined;
  probe.gate = undefined;
  vi.stubGlobal('IntersectionObserver', Viewport);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const one = (extra: Record<string, unknown> = {}) => docOf(figureJson({ id: 'fig_a', script: 'a = 1\nb = a + 1', mode: 'graphing', height: 200, ...extra }), para('x'));

describe('mount_failed (R10.1)', () => {
  it('shows the picture with "Live figure unavailable", reports mount_failed, and the editor keeps working', async () => {
    probe.failWhen = () => true;
    const { editor, errors } = makeEditor(one({ picture: PIC, caption: 'A caption' }));
    await tick(1500);
    const e = errors.find((x) => x.kind === 'mount_failed');
    expect(e).toBeDefined();
    expect(e?.ok).toBe(false);
    expect(e?.node).toBe('fig_a');
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    expect(figureDom(editor, 'fig_a').textContent).toContain('Live figure unavailable');
    expect(box.querySelector('img')?.getAttribute('src')).toBe(PIC);
    expect(box.dataset['state']).not.toBe('live');
    editor.commands.focus('end');
    expect(editor.commands.insertContent('still typing')).toBe(true);
    expect(editor.getText()).toContain('still typing');
  });

  it('shows the caption with "Live figure unavailable" when there is no picture', async () => {
    probe.failWhen = () => true;
    const { editor } = makeEditor(one({ caption: 'Quadratic roots' }));
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    expect(figureDom(editor, 'fig_a').textContent).toContain('Live figure unavailable');
    expect(figureDom(editor, 'fig_a').textContent).toContain('Quadratic roots');
    expect(box.querySelector('img')).toBeNull();
  });

  it('tries once more when the figure next becomes live, and goes live if that works', async () => {
    probe.failWhen = (n) => n === 1;
    const { editor } = makeEditor(one());
    await tick(1500);
    expect(probe.calls).toBe(1);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    Viewport.set(box, false);
    await tick(500);
    Viewport.set(box, true);
    await tick(1500);
    expect(probe.calls).toBe(2);
    expect(box.dataset['state']).toBe('live');
    expect(mounted()).toHaveLength(1);
  });

  it('retries once, then stays a picture for good', async () => {
    probe.failWhen = () => true;
    const { editor, errors } = makeEditor(one({ picture: PIC }));
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    expect(probe.calls).toBe(1);
    Viewport.set(box, false);
    await tick(500);
    Viewport.set(box, true);
    await tick(1500);
    expect(probe.calls).toBe(2);
    for (let i = 0; i < 3; i++) {
      Viewport.set(box, false);
      await tick(500);
      Viewport.set(box, true);
      await tick(1500);
    }
    expect(probe.calls).toBe(2);
    expect(box.querySelector('img')?.getAttribute('src')).toBe(PIC);
    expect(figureDom(editor, 'fig_a').textContent).toContain('Live figure unavailable');
    expect(errors.filter((e) => e.kind === 'mount_failed').length).toBeGreaterThanOrEqual(1);
  });

  it('does not stop the other figures from going live', async () => {
    probe.failWhen = (n) => n === 1;
    const doc = docOf(
      figureJson({ id: 'fig_a', script: 'a = 1', mode: 'graphing', height: 200 }),
      figureJson({ id: 'fig_b', script: 'b = 2', mode: 'graphing', height: 200 }),
      para('x'),
    );
    const { editor } = makeEditor(doc);
    await tick(2000);
    const states = [boxOf(editor, 'fig_a'), boxOf(editor, 'fig_b')].map((b) => b?.dataset['state']);
    expect(states).toContain('live');
    expect(mounted()).toHaveLength(1);
  });
});

describe('save and restore (R2.5)', () => {
  async function goLiveThenSave(extra: Record<string, unknown> = {}) {
    const made = makeEditor(one(extra));
    await tick(1500);
    const box = boxOf(made.editor, 'fig_a') as HTMLElement;
    expect(box.dataset['state']).toBe('live');
    return { ...made, box };
  }

  it('refreshes the picture without an undo step and frees the live figure when off screen', async () => {
    const { editor, box } = await goLiveThenSave();
    const steps = undoSteps(editor);
    const app = mounted()[0] as MountedApp;
    Viewport.set(box, false);
    await tick(10_000);
    expect(app.destroyed).toBe(true);
    expect(mounted()).toHaveLength(0);
    expect(box.dataset['state']).toBe('saved');
    expect(box.querySelector('.inc-tt-live')).toBeNull();
    const picture = figureAttrs(editor, 'fig_a')?.picture;
    expect(picture).toMatch(/^data:image\/svg\+xml/);
    expect(undoSteps(editor)).toBe(steps);
    expect(box.querySelector('img')?.getAttribute('src')).toBe(picture);
  });

  it('remounts from the script when the figure comes back, with a new app', async () => {
    const { editor, box } = await goLiveThenSave();
    Viewport.set(box, false);
    await tick(10_000);
    expect(mounted()).toHaveLength(0);
    Viewport.set(box, true);
    await tick(2000);
    expect(box.dataset['state']).toBe('live');
    expect(mounted()).toHaveLength(1);
    expect(mounted()[0]?.value('b')).toBe(2);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = a + 1');
  });

  it('keeps a reader\'s change across a save and restore when the script has not changed, with no error', async () => {
    const { errors, box } = await goLiveThenSave();
    mounted()[0]?.run(['a = 7']);
    Viewport.set(box, false);
    await tick(10_000);
    Viewport.set(box, true);
    await tick(2000);
    expect(mounted()[0]?.value('a')).toBe(7);
    expect(errors.filter((e) => e.kind === 'restore_failed')).toHaveLength(0);
  });

  it('never writes the reader\'s change back to the document', async () => {
    const { editor, box } = await goLiveThenSave();
    mounted()[0]?.run(['z = 5']);
    Viewport.set(box, false);
    await tick(10_000);
    expect(figureAttrs(editor, 'fig_a')?.script).toBe('a = 1\nb = a + 1');
  });

  it('reports restore_failed and starts from the script when the script changed while saved', async () => {
    const { editor, errors, box } = await goLiveThenSave();
    mounted()[0]?.run(['z = 5']);
    Viewport.set(box, false);
    await tick(10_000);
    expect(box.dataset['state']).toBe('saved');
    editor.commands.updateIncantlyFigure('fig_a', { script: 'a = 10\nb = a + 1' });
    Viewport.set(box, true);
    await tick(2000);
    const e = errors.find((x) => x.kind === 'restore_failed');
    expect(e).toBeDefined();
    expect(e?.node).toBe('fig_a');
    expect(e?.ok).toBe(false);
    expect(lastError(editor)?.kind).toBe('restore_failed');
    const app = mounted()[0] as MountedApp;
    expect(app.value('a')).toBe(10);
    expect(app.list().map((o) => o.name)).not.toContain('z');
    expect(box.dataset['state']).toBe('live');
  });
});

describe('context_lost (R10.2)', () => {
  const lose = (box: HTMLElement): void => {
    const target = box.querySelector('canvas') ?? box.querySelector('.inc-tt-live') ?? box;
    target.dispatchEvent(new Event('webglcontextlost', { bubbles: false, cancelable: true }));
  };

  it('reports context_lost for the figure and the editor keeps working', async () => {
    const { editor, errors } = makeEditor(one({ picture: PIC }));
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    expect(box.dataset['state']).toBe('live');
    expect(() => lose(box)).not.toThrow();
    await tick(500);
    expect(box.isConnected).toBe(true);
    editor.commands.focus('end');
    const e = errors.find((x) => x.kind === 'context_lost');
    expect(e).toBeDefined();
    expect(e?.ok).toBe(false);
    expect(e?.node).toBe('fig_a');
    expect(editor.commands.insertContent('still typing')).toBe(true);
  });

  it('shows the last frame (the picture) instead of a broken figure', async () => {
    const { editor } = makeEditor(one({ picture: PIC }));
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    lose(box);
    await tick(500);
    expect(box.querySelector('img')?.getAttribute('src')).toBe(PIC);
  });

  it('goes live again from the script when the context comes back', async () => {
    const { editor } = makeEditor(one({ picture: PIC }));
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    lose(box);
    await tick(500);
    box.querySelector('canvas')?.dispatchEvent(new Event('webglcontextrestored'));
    box.dispatchEvent(new Event('webglcontextrestored'));
    await tick(3000);
    expect(box.dataset['state']).toBe('live');
    expect(mounted().length).toBeGreaterThanOrEqual(1);
  });
});

describe('no error breaks the editor (R10.3)', () => {
  it('survives a figure with a bad script, a failed mount and a failed update together', async () => {
    probe.failWhen = () => true;
    const { editor, errors } = makeEditor(
      docOf(
        figureJson({ id: 'fig_bad', script: 'x = 1\n'.repeat(20000) }),
        figureJson({ id: 'fig_ok', script: 'a = 1', mode: 'graphing', height: 200 }),
        para('x'),
      ),
    );
    await tick(2000);
    expect(errors.map((e) => e.kind)).toEqual(expect.arrayContaining(['bad_attrs', 'mount_failed']));
    expect(editor.commands.updateIncantlyFigure('fig_nope', { script: 'a' })).toBe(false);
    expect(editor.commands.insertIncantlyFigure({ script: 'q = 1' })).toBe(true);
    expect(() => editor.getHTML()).not.toThrow();
    expect(() => editor.getJSON()).not.toThrow();
    expect(() => editor.destroy()).not.toThrow();
  });
});

/** Writes attributes straight into the node, as an undo or a collaborator's change does (a command would refuse a bad one). */
const setAttrs = (editor: Editor, id: string, patch: Record<string, unknown>): void => {
  const pos = posOf(editor, id);
  const node = editor.state.doc.nodeAt(pos);
  if (!node) throw new Error(`no node for ${id}`);
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
};

describe('a figure fixed after being bad (TT-R4)', () => {
  it('mounts again in view, with no scroll, once its attributes are good', async () => {
    const { editor } = makeEditor(one());
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    expect(box.dataset['state']).toBe('live');
    setAttrs(editor, 'fig_a', { mode: 'not-a-mode' });
    await tick(1500);
    expect(box.dataset['state']).toBe('bad');
    expect(mounted()).toHaveLength(0);
    setAttrs(editor, 'fig_a', { mode: 'graphing' });
    await tick(1500);
    expect(box.dataset['state']).toBe('live');
    expect(mounted()).toHaveLength(1);
    expect(mounted()[0]?.value('b')).toBe(2);
  });

  it('stays as it is when the node is good again before the figure was freed', async () => {
    const { editor } = makeEditor(one());
    await tick(1500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    setAttrs(editor, 'fig_a', { mode: 'not-a-mode' });
    setAttrs(editor, 'fig_a', { mode: 'graphing' });
    await tick(1500);
    expect(box.dataset['state']).toBe('live');
    expect(mounted()).toHaveLength(1);
  });
});

describe('a remount under the live cap (TT-R5)', () => {
  it('does not mount a figure again that is being saved, and never passes the cap', async () => {
    const { editor } = makeEditor(docOf(...['fig_a', 'fig_b', 'fig_c'].map((id) => figureJson({ id, script: 'a = 1\nb = a + 1', mode: 'graphing', height: 200 })), para('x')));
    await tick(2500);
    expect(mounted()).toHaveLength(3);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    const app = mounted().find((a) => a.element.closest('[data-id="fig_a"]') !== null) as MountedApp;
    expect(app).toBeDefined();
    // the picture of fig_a takes a while, and the app refuses a mode change in place, so the figure starts again
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const exportNow = app.export.bind(app);
    app.export = (async (...args: Parameters<typeof app.export>) => {
      await gate;
      return exportNow(...args);
    }) as typeof app.export;
    app.setMode = (() => ({ ok: false, message: 'no' })) as unknown as typeof app.setMode;
    Viewport.set(box, false);
    await tick(10_000);
    expect(box.dataset['state']).not.toBe('saved');
    setAttrs(editor, 'fig_a', { mode: 'geometry' });
    let most = mounted().length;
    release();
    for (let i = 0; i < 20; i++) {
      await tick(100);
      most = Math.max(most, mounted().length);
    }
    expect(most).toBeLessThanOrEqual(3);
    expect(box.dataset['state']).toBe('saved');
    expect(app.destroyed).toBe(true);
    expect(mounted().filter((a) => a.element.closest('[data-id="fig_a"]') !== null)).toHaveLength(0);
    expect(mounted()).toHaveLength(2);
  });
});

describe('the picture after a mode change that a save wins (TT-R10)', () => {
  /** The picture of a script in a mode, made the way a placeholder picture is (SVG data URL). */
  const pictureIn = async (mode: 'graphing' | 'scientific', script: string, height: number): Promise<string> => {
    const sdk = await vi.importActual<typeof import('@incantly/sdk')>('@incantly/sdk');
    const app = sdk.createHeadlessApp({ mode, script, readOnly: true });
    try {
      const r = await app.export({ format: 'svg', width: FULL_WIDTH_PX, height });
      if (!r.ok) throw new Error(r.message);
      const text = r.text ?? (await r.blob.text());
      let s = '';
      for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b);
      return `data:image/svg+xml;base64,${btoa(s)}`;
    } finally {
      app.destroy();
    }
  };

  it('shows the figure in its new mode, not the old one', async () => {
    // the scientific mode leaves out the function, so its picture differs from the graphing one
    const script = 'a = 1\nf(x) = x^2';
    const { editor } = makeEditor(docOf(...['fig_a', 'fig_b', 'fig_c'].map((id) => figureJson({ id, script, mode: 'graphing', height: 200 })), para('x')));
    await tick(2500);
    const box = boxOf(editor, 'fig_a') as HTMLElement;
    const app = mounted().find((a) => a.element.closest('[data-id="fig_a"]') !== null) as MountedApp;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const exportNow = app.export.bind(app);
    app.export = (async (...args: Parameters<typeof app.export>) => {
      await gate;
      return exportNow(...args);
    }) as typeof app.export;
    app.setMode = (() => ({ ok: false, message: 'no' })) as unknown as typeof app.setMode;
    Viewport.set(box, false);
    await tick(10_000);
    setAttrs(editor, 'fig_a', { mode: 'scientific' });
    release();
    for (let i = 0; i < 20; i++) await tick(100);
    expect(box.dataset['state']).toBe('saved');
    const want = await pictureIn('scientific', script, 200);
    const old = await pictureIn('graphing', script, 200);
    expect(want).not.toBe(old);
    expect(figureAttrs(editor, 'fig_a')?.picture).toBe(want);
  });
});

describe('a mode change while the app is being made (TT-R9)', () => {
  it('mounts again in the new mode and holds one place under the cap', async () => {
    let release: () => void = () => undefined;
    probe.gate = new Promise<void>((res) => {
      release = res;
    });
    const { editor } = makeEditor(one());
    await tick(500);
    expect(probe.calls).toBe(1);
    setAttrs(editor, 'fig_a', { mode: 'geometry' });
    probe.gate = undefined;
    release();
    for (let i = 0; i < 20; i++) await tick(100);
    const live = mounted();
    expect(live).toHaveLength(1);
    expect(live[0]?.mode).toBe('geometry');
    expect(boxOf(editor, 'fig_a')?.dataset['state']).toBe('live');
  });
});

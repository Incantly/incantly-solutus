/**
 * BR-34 (handoff/board/findings.md, "Later"; docs/features/board/errors.md `asset_invalid`; docs/state-machines.md B21): the
 * browser paths that were tried in Chrome in round 6 and are kept here as tests in happy-dom. An image pasted adds an image
 * shape; a file that is not an image is refused as `asset_invalid` with "This image could not be added" and adds nothing;
 * the text editor keeps accented characters, and a finished input-method composition ends as the text that was composed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBoardView, putNewShape } from '../../src/index';
import type { BoardError, BoardView, ShapeRecord } from '../../src/index';
import { installCanvas2d } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { pngBytes } from './shape-helpers';
import { stubBrowser } from './view-helpers';
import type { Browser } from './view-helpers';

let fake: FakeCanvas;
let browser: Browser;
let container: HTMLElement;
let view: BoardView;
let errors: BoardError[];

beforeEach(() => {
  fake = installCanvas2d();
  browser = stubBrowser(800, 600);
  container = document.createElement('div');
  document.body.append(container);
  errors = [];
  const made = mountBoardView({ container, canvas2dOnly: true, onError: (e) => errors.push(e) });
  if (!made.ok) throw new Error(made.message);
  view = made.value;
});
afterEach(() => {
  view.dispose();
  container.remove();
  browser.restore();
  fake.restore();
});

const page = (): string => view.core.pages.current as string;
const shapes = (): readonly ShapeRecord[] => view.core.store.shapesOn(page());
const images = (): readonly ShapeRecord[] => shapes().filter((s) => s.kind === 'image');
const notice = (): HTMLElement => container.querySelector('.ib-fixed') as HTMLElement;

/** A paste event that carries `files` and no text. */
function pasteFiles(files: readonly File[]): void {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files, getData: () => '' } });
  view.element.dispatchEvent(e);
}

const bytesOf = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const fileOf = (bytes: Uint8Array, name: string, type: string): File => new File([bytesOf(bytes)], name, { type });

describe('BR-34: an image pasted into the board', () => {
  it('a paste with a PNG file adds one image shape and its asset, selected', async () => {
    pasteFiles([fileOf(pngBytes(300, 200), 'picture.png', 'image/png')]);
    await vi.waitFor(() => expect(images()).toHaveLength(1));
    expect(view.core.store.all('asset')).toHaveLength(1);
    expect(view.core.selection.ids).toEqual([(images()[0] as ShapeRecord).id]);
    expect(errors).toEqual([]);
  });

  it('the picture is one undo step: undo takes the image off the page', async () => {
    const steps = view.core.history.undoSteps;
    pasteFiles([fileOf(pngBytes(300, 200), 'picture.png', 'image/png')]);
    await vi.waitFor(() => expect(images()).toHaveLength(1));
    expect(view.core.history.undoSteps).toBe(steps + 1);
    view.core.history.undo();
    expect(images()).toHaveLength(0);
  });

  it('a pasted file that says it is an image but is not one is refused as asset_invalid, and nothing is added', async () => {
    const before = view.core.store.all().length;
    pasteFiles([fileOf(new TextEncoder().encode('this is plain text'), 'fake.png', 'image/png')]);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.kind).toBe('asset_invalid');
    expect(images()).toHaveLength(0);
    expect(view.core.store.all('asset')).toHaveLength(0);
    expect(view.core.store.all()).toHaveLength(before);
    expect(notice().hidden).toBe(false);
    expect(notice().textContent).toContain('This image could not be added');
  });

  it('a file that is not an image, pasted with no text, adds nothing and says nothing went wrong', async () => {
    const before = view.core.store.all().length;
    pasteFiles([fileOf(new TextEncoder().encode('just words'), 'notes.txt', 'text/plain')]);
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(images()).toHaveLength(0);
    expect(view.core.store.all().length).toBe(before);
  });
});

describe('BR-34: the Image button\'s file picker', () => {
  const input = (): HTMLInputElement => container.querySelector('input[type="file"]') as HTMLInputElement;
  /** Gives the input a file and fires `change`, as the browser does when a file is chosen. */
  function choose(file: File): void {
    Object.defineProperty(input(), 'files', { configurable: true, value: [file] });
    input().dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('the picker takes PNG, JPEG, WebP and SVG', () => {
    const accept = input().accept.split(',');
    expect(accept).toEqual(expect.arrayContaining(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']));
  });

  it('a chosen PNG adds an image shape', async () => {
    choose(fileOf(pngBytes(120, 80), 'a.png', 'image/png'));
    await vi.waitFor(() => expect(images()).toHaveLength(1));
    expect(view.core.store.all('asset')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('a chosen file that is not an image is refused as asset_invalid with "This image could not be added", and nothing is added', async () => {
    const before = view.core.store.all().length;
    choose(fileOf(new TextEncoder().encode('hello, this is a text file'), 'notes.txt', 'text/plain'));
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]?.kind).toBe('asset_invalid');
    expect(images()).toHaveLength(0);
    expect(view.core.store.all().length).toBe(before);
    expect(notice().textContent).toContain('This image could not be added');
  });

  it('the Image button of the toolbar is there and opens the picker', () => {
    const button = container.querySelector('[data-action="image"]');
    expect(button).not.toBeNull();
    const clicked = vi.spyOn(input(), 'click').mockImplementation(() => undefined);
    (button as HTMLElement).click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});

describe('BR-34: the text editor keeps what is typed and composed (B21)', () => {
  const field = (): HTMLTextAreaElement => container.querySelector('textarea.ib-edit') as HTMLTextAreaElement;

  function newText(): ShapeRecord {
    let made: ShapeRecord | undefined;
    const done = view.core.store.change('user', (tx) => {
      const r = putNewShape(tx, view.core.store, { kind: 'text', page: page(), x: 100, y: 100, props: { text: 'a' } });
      if (r.ok) made = r.value;
    });
    if (!done.ok || made === undefined) throw new Error('could not add a text shape');
    return made;
  }
  const textOf = (id: string): string => ((view.core.store.get(id) as ShapeRecord).props as { text: string }).text;

  /** Opens the editor on a new text shape and returns its id. */
  function open(): string {
    const shape = newText();
    expect(view.core.editor.open(shape.id).ok).toBe(true);
    expect(field().hidden).toBe(false);
    return shape.id;
  }
  /** Types as the browser does: the field holds the whole text, then `input` fires. */
  function type(text: string): void {
    field().value = text;
    field().dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('accented letters, ligatures and a superscript are kept, every one', () => {
    const id = open();
    for (const text of ['Café déjà vu: naïve', 'x² + 1', 'Ångström, façade, Zoë, señor, Größe']) {
      type(text);
      expect(textOf(id)).toBe(text);
    }
    expect(view.core.editor.state).toBe('editing');
  });

  it('what was typed is still there after the editor is closed with Escape', () => {
    const id = open();
    type('Café déjà vu: naïve');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(view.core.editor.state).toBe('closed');
    expect(textOf(id)).toBe('Café déjà vu: naïve');
  });

  it('typing is one undo step: the text goes back to what it was before the edit', () => {
    const id = open();
    const steps = view.core.history.undoSteps;
    type('C');
    type('Ca');
    type('Caf');
    type('Café');
    view.core.editor.commit();
    expect(view.core.history.undoSteps).toBe(steps + 1);
    view.core.history.undo();
    expect(textOf(id)).toBe('a');
  });

  it('an input-method composition goes composing, then editing; the finished text is the text of the shape', () => {
    const id = open();
    field().dispatchEvent(new Event('compositionstart', { bubbles: true }));
    expect(view.core.editor.state).toBe('composing');
    type('き');
    type('きょう');
    expect(view.core.editor.state).toBe('composing');
    type('今日');
    type('今日は');
    field().dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(view.core.editor.state).toBe('editing');
    type('今日は');
    expect(textOf(id)).toBe('今日は');
    view.core.editor.commit();
    expect(textOf(id)).toBe('今日は');
    expect(view.core.editor.state).toBe('closed');
  });

  it('text typed before a composition stays, and the composed text is added after it', () => {
    const id = open();
    type('Hello ');
    field().dispatchEvent(new Event('compositionstart', { bubbles: true }));
    type('Hello 世');
    type('Hello 世界');
    field().dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(textOf(id)).toBe('Hello 世界');
    type('Hello 世界 café');
    expect(textOf(id)).toBe('Hello 世界 café');
    expect(view.core.editor.state).toBe('editing');
  });

  it('a closed editor ignores an input event on its field, and nothing is written', () => {
    const id = open();
    type('kept');
    view.core.editor.commit();
    expect(view.core.editor.state).toBe('closed');
    type('changed after closing');
    expect(textOf(id)).toBe('kept');
  });
});

import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { FigureNode, SCALE_PROFILES, countFigures, createFixtureDocument } from '../src';

const editors: Editor[] = [];

function createEditor(content: Editor['options']['content']): Editor {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, Image, FigureNode], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
});

describe('fixture documents', () => {
  it.each(Object.entries(SCALE_PROFILES))('builds the %s profile with %i figures', (_name, figures) => {
    const doc = createFixtureDocument({ figures });
    expect(countFigures(doc)).toBe(figures);
  });

  it('surrounds figures with representative prose', () => {
    const doc = createFixtureDocument({ figures: 10 });
    const types = new Set(doc.content?.map((node) => node.type));
    for (const type of ['heading', 'paragraph', 'bulletList', 'blockquote', 'image', 'incantlyFigure']) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(createFixtureDocument({ figures: 5, seed: 7 })).toEqual(createFixtureDocument({ figures: 5, seed: 7 }));
    expect(createFixtureDocument({ figures: 5, seed: 7 })).not.toEqual(createFixtureDocument({ figures: 5, seed: 8 }));
  });

  it('loads into a TipTap editor with placeholder node views', () => {
    const editor = createEditor(createFixtureDocument({ figures: 10 }));
    expect(countFigures(editor.getJSON())).toBe(10);
    expect(editor.view.dom.querySelectorAll('figure.incantly-figure[data-state="placeholder"]').length).toBe(10);
  });
});

describe('figure node attributes', () => {
  it('round-trips every attribute through HTML, as copy and paste does', () => {
    const attrs = {
      figureId: 'fig-1',
      concept: 'thin lens',
      fragments: { html: "<div id='stage'></div>", css: '.x{}', js: 'inc.idea("x")' },
      fragmentsRef: null,
      defaults: { focalLength: 10, objectDistance: 25 },
      values: { focalLength: 12, objectDistance: 30 },
      step: 2,
      snapshotRef: `sha256:${'ab'.repeat(32)}`,
      description: 'Rays meet where the image forms.',
      aspect: 0.5,
      meta: { validatorVersion: 1 },
    };
    const source = createEditor({ type: 'doc', content: [{ type: 'incantlyFigure', attrs }] });
    const html = source.getHTML();
    expect(html).toContain('data-incantly-figure');
    expect(html).toContain('<figcaption>Rays meet where the image forms.</figcaption>');

    const copy = createEditor(html);
    const node = copy.getJSON().content?.[0];
    expect(node?.type).toBe('incantlyFigure');
    expect(node?.attrs).toMatchObject(attrs);
  });

  it('falls back to defaults for malformed JSON attributes', () => {
    const editor = createEditor(
      "<figure data-incantly-figure data-figure-id='f' data-values='{not json' data-aspect='abc'><figcaption>x</figcaption></figure>",
    );
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.values).toEqual({});
    expect(node?.attrs?.figureId).toBe('f');
  });
});

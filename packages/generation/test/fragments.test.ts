import { describe, expect, it } from 'vitest';
import { FragmentStream, missingFragments, parseFragments, parsePlanReply, type FragmentName } from '../src/fragments';

const REPLY = [
  'Here is the scene.',
  '```html',
  "<div id='stage'></div>",
  '```',
  '```css',
  '#stage { margin: 0 auto; }',
  '```',
  '```javascript',
  "const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Dot' });",
  '',
  'stage.circle(5, 5, 1);',
  '```',
  'That is all.',
].join('\n');

describe('scene replies', () => {
  it('reads the three fenced fragments and ignores prose around them', () => {
    const { fragments, problems } = parseFragments(REPLY);
    expect(problems).toEqual([]);
    expect(fragments).toEqual({
      html: "<div id='stage'></div>\n",
      css: '#stage { margin: 0 auto; }\n',
      js: "const stage = inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Dot' });\n\nstage.circle(5, 5, 1);\n",
    });
    expect(missingFragments(fragments)).toEqual([]);
  });

  it('hands on each fragment as soon as its fence closes, however the stream is cut', () => {
    for (const size of [1, 3, 7, 64]) {
      const seen: Array<[FragmentName, number]> = [];
      let received = 0;
      const stream = new FragmentStream((name) => seen.push([name, received]));
      for (let i = 0; i < REPLY.length; i += size) {
        const piece = REPLY.slice(i, i + size);
        received += piece.length;
        stream.push(piece);
      }
      const result = stream.end();
      expect(result.fragments, `chunk ${size}`).toEqual(parseFragments(REPLY).fragments);
      expect(seen.map(([name]) => name)).toEqual(['html', 'css', 'js']);
      // The HTML was handed on long before the reply ended.
      expect(seen[0]![1]).toBeLessThan(REPLY.indexOf('```css') + size + 1);
    }
  });

  it('reports blocks it cannot use', () => {
    expect(parseFragments('```html\n<div></div>\n```\n```html\n<p></p>\n```').problems).toEqual(['There is more than one html block']);
    expect(parseFragments('```python\nprint(1)\n```').problems).toEqual(['A ```python block is not one of html, css or js']);
    expect(parseFragments('```js\nconst a = 1;').problems).toEqual(['The js block was never closed']);
    expect(missingFragments(parseFragments('```js\nconst a = 1;\n```').fragments)).toEqual(['html', 'css']);
  });

  it('accepts Windows line endings', () => {
    expect(parseFragments('```css\r\n#stage { margin: 0; }\r\n```\r\n').fragments.css).toBe('#stage { margin: 0; }\n');
  });
});

describe('plan replies', () => {
  it('reads a fenced JSON plan', () => {
    expect(parsePlanReply('Plan:\n```json\n{ "concept": "sine wave" }\n```\n').value).toEqual({ concept: 'sine wave' });
  });

  it('falls back to the outermost braces', () => {
    expect(parsePlanReply('Sure! { "concept": "lens", "parts": ["Lens"] } Done.').value).toEqual({ concept: 'lens', parts: ['Lens'] });
  });

  it('says why a reply is not a plan', () => {
    expect(parsePlanReply('no plan here').problem).toBe('The reply has no JSON object');
    expect(parsePlanReply('```json\n{ concept: lens }\n```').problem).toMatch(/^The plan is not valid JSON/);
  });
});

/** The notes demo: a Tiptap editor with the Incantly extension and a page about a parabola (tiptap R1 to R9). */
import { Editor, Node } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { Incantly, httpTransport } from '@incantly/tiptap';
import { probeServer } from './server';

// The smallest document a page needs: `doc`, `paragraph`, `heading` and `text`.
const Doc = Node.create({ name: 'doc', topNode: true, content: 'block+' });
const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: () => ['p', 0],
});
const Heading = Node.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes: () => ({ level: { default: 1 } }),
  parseHTML: () => [1, 2].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  renderHTML: ({ node }) => [`h${node.attrs['level'] === 2 ? 2 : 1}`, 0],
});
const Text = Node.create({ name: 'text', group: 'inline' });

const text = (t: string): JSONContent => ({ type: 'text', text: t });
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const formula = (expr: string, format: string): JSONContent => ({ type: 'incantlyFormula', attrs: { expr, figure: 'fig_parabola', format } });

const START: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('The parabola')] },
    p(text('A parabola is the graph of a quadratic. Drag the figure, or open its lines to change it.')),
    {
      type: 'incantlyFigure',
      attrs: {
        id: 'fig_parabola',
        mode: 'graphing',
        height: 320,
        caption: 'f(x) = x² − 2x − 3 and where it crosses the x-axis',
        script: ['f(x) = x^2 - 2*x - 3', 'r1 = Root(f, -5, 1)', 'r2 = Root(f, 1, 5)'].join('\n'),
      },
    },
    p(text('The right-hand root is at x = '), formula('r2.x', '2'), text(' and the left-hand one at x = '), formula('r1.x', '2'), text('.')),
    { type: 'heading', attrs: { level: 2 }, content: [text('In the plane')] },
    p(text('The same idea with a circle, and a point you can drag round it.')),
    {
      type: 'incantlyFigure',
      attrs: {
        id: 'fig_circle',
        mode: 'geometry',
        height: 300,
        caption: 'A circle and a tangent',
        script: ['c = Circle((0, 0), 2)', 'P = PointOn(c, 0.6)', 'T = Tangent(P, c)'].join('\n'),
      },
    },
    { type: 'heading', attrs: { level: 2 }, content: [text('In space')] },
    p(text('Turn a parabola about its axis and you get a surface. Here a cube is cut by a plane.')),
    {
      type: 'incantlyFigure',
      attrs: {
        id: 'fig_cube',
        mode: 'graphing3d',
        height: 340,
        caption: 'A cube cut by a plane',
        script: ['A = (0, 0, 0)', 'B = (3, 0, 0)', 'C = (0, 1, 0)', 'k = Cube(A, B, C)', 'q = Plane((1.5, 1.5, 1.5), Vector(1, 1, 1))', 'cut = Intersect(q, k)'].join('\n'),
      },
    },
    p(text('Type / on an empty line to add a figure of your own.')),
  ],
};

const host = document.getElementById('editor');
const toggle = document.getElementById('readonly');
let editor: Editor | undefined;
/** True when `/v1/health` answered with a model ready: the AI panel then talks to the server at this origin. */
let useServer = false;

function open(content: JSONContent, readOnly: boolean): void {
  if (!host) return;
  editor?.destroy();
  editor = new Editor({
    element: host,
    editable: !readOnly,
    extensions: [Doc, Paragraph, Heading, Text, Incantly.configure({ readOnly, liveLimit: 3, ...(useServer ? { aiTransport: httpTransport('') } : {}) })],
    content,
  });
  (window as unknown as { editor: Editor }).editor = editor;
}

if (host) {
  // ask the server first, so the extension is made once with the right options
  void probeServer().then((health) => {
    useServer = health?.ready === true;
    open(START, false);
    if (toggle instanceof HTMLInputElement) {
      toggle.addEventListener('change', () => {
        // a new editor with the same document: the extension's read-only option is fixed when it is made
        open(editor?.getJSON() ?? START, toggle.checked);
      });
    }
  });
}

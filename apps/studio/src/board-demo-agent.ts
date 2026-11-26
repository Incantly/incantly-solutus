/**
 * A stand-in agent for the studio's Board mode (board round 5): a `BoardAgentTransport` that answers every circle to ask
 * suggestion and a few things said in the agent panel with fixed actions, so the whole flow can be seen with no server.
 * It is not an AI and says so on the panel (`DEMO_LABEL`): it reads only what the board sent (the kinds, the text and the
 * summaries of the circled items) and never understands a sentence beyond a few words. No model is called anywhere.
 */
import type { AgentItem, BoardAction, BoardAgentEvent, BoardAgentRequest, BoardAgentTransport, Box } from '@incantly/board';

/** The words under the panel's title. */
export const DEMO_LABEL = 'Demo agent, scripted, no AI';

/** The gap between two answers, so the card and the arrow visibly arrive one after the other. */
const PACE_MS = 450;

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

type Answer = readonly (readonly BoardAction[])[];

const near = (target: string | Box, side: 'right' | 'left' | 'above' | 'below' = 'right'): { near: string | Box; side: 'right' | 'left' | 'above' | 'below' } => ({ near: target, side });

/** A figure beside the circled area, an arrow from the area to it, and a line of words under the figure. */
function card(circle: Box, lines: readonly string[], mode: string, words: string): Answer {
  return [
    [{ op: 'figure', lines, mode, at: near(circle, 'right') }],
    [
      { op: 'arrow', from: circle, to: '$last' },
      { op: 'write', text: words, at: near('$last', 'below'), style: 'hand', size: 22 },
    ],
  ];
}

const first = (items: readonly AgentItem[], pick: (i: AgentItem) => boolean): AgentItem | undefined => items.find(pick);

/** What the demo answers to a pick on a circle. */
function circleAnswer(r: Extract<BoardAgentRequest, { kind: 'circle' }>): Answer {
  const c = r.circle;
  const said = first(r.items, (i) => i.text !== undefined)?.text;
  switch (r.choice) {
    case 'graph':
      return card(c, ['f(x) = (x - 1)^2 - 2', 'v = (1, -2)'], 'graphing', 'Here it is as a graph.');
    case 'formula':
      return [
        [{ op: 'write', text: '$f(x) = (x - 1)^2 - 2$', at: near(c, 'right'), style: 'hand', size: 30 }],
        [{ op: 'arrow', from: c, to: '$last' }],
        [{ op: 'write', text: 'A fixed answer: the demo cannot read your curve.', at: near('$last', 'below'), style: 'hand', size: 16 }],
      ];
    case 'solve':
      return [
        [{ op: 'write', text: said !== undefined ? `You circled: ${said}` : 'Solving it:', at: near(c, 'right'), style: 'hand', size: 18 }],
        [{ op: 'write', text: '$x^2 - 2x - 3 = 0$', at: near('$last', 'below'), style: 'hand', size: 28 }],
        [{ op: 'write', text: '$(x - 3)(x + 1) = 0$', at: near('$last', 'below'), style: 'hand', size: 28 }],
        [{ op: 'write', text: '$x = 3$ or $x = -1$', at: near('$last', 'below'), style: 'hand', size: 28 }],
      ];
    case 'steps':
      return [
        [{ op: 'write', text: '1. Move everything to one side.', at: near(c, 'right'), style: 'hand', size: 24 }],
        [{ op: 'write', text: '2. Factor the quadratic.', at: near('$last', 'below'), style: 'hand', size: 24 }],
        [{ op: 'write', text: '3. Each factor is zero in turn.', at: near('$last', 'below'), style: 'hand', size: 24 }],
        [{ op: 'mark', target: c, how: 'box' }],
      ];
    case 'measure':
      return card(c, ['A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'AB = Segment(A, B)', 'BC = Segment(B, C)', 'CA = Segment(C, A)', 'd = Distance(A, B)'], 'geometry', 'The base is 4 long (a fixed triangle).');
    case 'geometry':
      return card(c, ['A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'poly = Polygon(A, B, C)', 'ang = Angle(B, A, C)'], 'geometry', 'As a geometry figure (a fixed triangle).');
    case 'explain': {
      const summary = first(r.items, (i) => i.summary !== undefined)?.summary;
      return [
        [{ op: 'write', text: summary !== undefined ? `This card holds: ${summary}.` : 'This is a figure card.', at: near(c, 'right'), style: 'hand', size: 18 }],
        [{ op: 'arrow', from: c, to: '$last' }],
        [{ op: 'mark', target: c, how: 'circle' }],
      ];
    }
    case 'animate':
      return card(c, ['a = 1', 'f(x) = a * x^2', 'g(x) = sin(x)'], 'graphing', 'Drag a to change the parabola.');
    case 'slider':
      return card(c, ['a = 1', 'f(x) = a * x^2'], 'graphing', 'The slider is the number a.');
    case 'ask':
      return [
        [{ op: 'write', text: `You asked: “${r.text ?? ''}”.`, at: near(c, 'right'), style: 'hand', size: 18 }],
        [{ op: 'write', text: 'This demo agent is scripted and has no AI, so it only gives this fixed note.', at: near('$last', 'below'), style: 'hand', size: 20 }],
        [{ op: 'arrow', from: c, to: '$last' }],
      ];
  }
}

/** A sine wave as points, for a stroke the hand draws. */
function wave(): readonly [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= 60; i++) out.push([i * 6, 40 + Math.sin(i / 6) * 34]);
  return out;
}

/** What the demo answers to a sentence in the panel: a few words it knows, else its own help. */
function talkAnswer(r: Extract<BoardAgentRequest, { kind: 'talk' }>): Answer {
  const t = r.text.toLowerCase();
  const item = r.items[0];
  if (/parabola|graph|plot/.test(t)) {
    return [
      [{ op: 'figure', lines: ['f(x) = x^2 - 2*x - 3', 'r1 = Root(f, -5, 1)', 'r2 = Root(f, 1, 5)'], mode: 'graphing', at: 'free' }],
      [{ op: 'write', text: 'A parabola, with its roots.', at: near('$last', 'below'), style: 'hand', size: 22 }],
    ];
  }
  if (/wave|sine|stroke|draw/.test(t)) {
    return [
      [{ op: 'write', text: 'Watch the pen:', at: 'free', style: 'hand', size: 26 }],
      [{ op: 'stroke', points: wave(), at: 'free', color: '#2563eb', size: 4 }],
    ];
  }
  if (/triangle|shape|box|diagram/.test(t)) {
    return [
      [{ op: 'shape', kind: 'triangle', at: 'free', color: '#16a34a' }],
      [{ op: 'write', text: 'A triangle', at: near('$last', 'below'), style: 'hand', size: 24 }],
    ];
  }
  if (/mark|circle|highlight|underline/.test(t)) {
    return item !== undefined
      ? [[{ op: 'mark', target: item.id, how: 'circle' }]]
      : [[{ op: 'write', text: 'Nothing is in view to mark. Draw something first.', at: 'free', style: 'hand', size: 18 }]];
  }
  if (/point|laser|show me/.test(t)) {
    return item !== undefined ? [[{ op: 'point', target: item.id }]] : [[{ op: 'write', text: 'Nothing is in view to point at.', at: 'free', style: 'hand', size: 18 }]];
  }
  if (/camera|zoom|all|everything/.test(t)) return [[{ op: 'camera', target: 'all' }]];
  if (/hello|hi\b|write|say|name/.test(t)) return [[{ op: 'write', text: 'Hello! I am a scripted demo, with no AI.', at: 'free', style: 'hand', size: 30 }]];
  return [
    [
      {
        op: 'write',
        text: 'I am a scripted demo with no AI. Try: graph, wave, hello, triangle, mark, point, show all. Or circle something with Ask.',
        at: 'free',
        style: 'hand',
        size: 18,
      },
    ],
  ];
}

/** The demo transport. It streams the answer one step at a time and stops when the request is aborted. */
export const demoAgentTransport: BoardAgentTransport = async function* (request, signal): AsyncGenerator<BoardAgentEvent> {
  const answer = request.kind === 'circle' ? circleAnswer(request) : talkAnswer(request);
  await sleep(PACE_MS, signal);
  for (const actions of answer) {
    if (signal.aborted) return;
    yield { actions };
    await sleep(PACE_MS, signal);
  }
  if (!signal.aborted) yield { done: true };
};

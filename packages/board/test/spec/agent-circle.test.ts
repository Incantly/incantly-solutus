/**
 * Circle to ask (agent.md 3; design 11.1; requirements R8.3 and R8.4; state-machines B33 and B12 `askHeld`): the items in
 * a loop, suggestions from the item kinds at once, the request body of agent.md 3, the picture only with `agent.vision`,
 * and the answer: a figure card near the circle, joined to it by an arrow. A fake transport stands for the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUTTON_BARREL, BUTTON_TIP, CIRCLE_LABELS, createBoard, figureOf, inkTools, suggestionsFor } from '../../src/index';
import type { AgentItem, Board, BoardAgentEvent, BoardAgentRequest, BoardError, CircleRequest } from '../../src/index';
import { drawPath, installCanvas2d, line } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { circleAround, makeAgentRig, must, overlaps, responding, scripted, shapesOf, userShape } from './agent-helpers';
import type { AgentRig } from './agent-helpers';
import { stubSize } from './round4-helpers';

const item = (kind: string, extra: Partial<AgentItem> = {}): AgentItem => ({ id: `shape:${kind}`, kind, box: [0, 0, 10, 10], ...extra });
const choices = (items: readonly AgentItem[]): string[] => suggestionsFor(items).map((s) => s.choice);

describe('suggestions from the item kinds alone (design 11.1 table)', () => {
  it('a hand-drawn curve: make it a graph, find its formula', () => {
    expect(choices([item('ink', { shape: 'curve' })])).toEqual(['graph', 'formula', 'ask']);
  });

  it('written or typed maths: solve it, show the steps, graph it', () => {
    expect(choices([item('text', { text: '$x^2 - 4 = 0$' })])).toEqual(['solve', 'steps', 'graph', 'ask']);
    expect(choices([item('text', { text: '2x + 3 = 11' })])).toEqual(['solve', 'steps', 'graph', 'ask']);
    expect(choices([item('sticky', { text: 'y = 3x' })])).toEqual(['solve', 'steps', 'graph', 'ask']);
  });

  it.each(['triangle', 'quadrilateral', 'pentagon', 'polygon'])('a drawn %s: measure it, make it a geometry figure', (shape) => {
    expect(choices([item('ink', { shape })])).toEqual(['measure', 'geometry', 'ask']);
  });

  it('a triangle shape: measure it, make it a geometry figure', () => {
    expect(choices([item('triangle')])).toEqual(['measure', 'geometry', 'ask']);
  });

  it('a figure card: explain it, animate it, add a slider', () => {
    expect(choices([item('figure', { summary: 'graphing figure, 1 object (f)' })])).toEqual(['explain', 'animate', 'slider', 'ask']);
  });

  it('anything: ask something else; a loop with nothing in it has only that', () => {
    expect(choices([item('ellipse')])).toEqual(['ask']);
    expect(choices([item('text', { text: 'hello' })])).toEqual(['ask']);
    expect(choices([])).toEqual(['ask']);
  });

  it('a mixed loop offers the suggestions of each kind once, and ends with ask', () => {
    const list = choices([item('ink', { shape: 'curve' }), item('text', { text: 'x = 2' }), item('figure')]);
    expect(list).toEqual(['graph', 'formula', 'solve', 'steps', 'explain', 'animate', 'slider', 'ask']);
    expect(new Set(list).size).toBe(list.length);
    expect(list[list.length - 1]).toBe('ask');
  });

  it('every suggestion has a label on its button', () => {
    for (const s of suggestionsFor([item('ink', { shape: 'curve' }), item('figure')])) {
      expect(s.label).toBe(CIRCLE_LABELS[s.choice]);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe('finding what is in the loop (design 11.1 step 2; B33)', () => {
  it('shows suggestions at once when the loop closes, with no server', () => {
    const rig = makeAgentRig(undefined);
    expect(rig.board.agent.circle.state).toBe('idle');
    userShape(rig, 'ellipse', 50, 50, { w: 100, h: 60 });
    circleAround(rig, [0, 0, 300, 300]);
    expect(rig.board.agent.circle.state).toBe('choosing');
    expect(rig.board.agent.circle.suggestions.map((s) => s.choice)).toEqual(['ask']);
  });

  it('holds the shapes whose middle is inside, and not the others', () => {
    const rig = makeAgentRig();
    const inside = userShape(rig, 'rect', 50, 50, { w: 100, h: 60 });
    userShape(rig, 'rect', 250, 100, { w: 200, h: 60 });
    userShape(rig, 'rect', 900, 900, { w: 100, h: 60 });
    circleAround(rig, [0, 0, 300, 300]);
    expect(rig.board.agent.circle.found.items.map((i) => i.id)).toEqual([inside.id]);
  });

  it('holds ink that is mostly inside, and gives its recognised shape', () => {
    const rig = makeAgentRig();
    const arc: [number, number][] = [];
    for (let i = 0; i <= 30; i++) {
      const t = (i - 15) / 15;
      arc.push([100 + i * 10, 300 - 150 * (1 - t * t)]);
    }
    drawPath({ host: rig.board.host }, arc);
    drawPath({ host: rig.board.host }, line(1500, 100, 1700, 100, 10), {}, 1000);
    circleAround(rig, [0, 0, 600, 400]);
    const found = rig.board.agent.circle.found;
    expect(found.items).toHaveLength(1);
    expect(found.items[0]?.kind).toBe('ink');
    expect(found.items[0]?.shape).toBe('curve');
    expect(rig.board.agent.circle.suggestions.map((s) => s.choice)).toEqual(['graph', 'formula', 'ask']);
  });

  it('describes a figure card with its summary, and offers explain, animate and slider', async () => {
    const rig = makeAgentRig();
    await rig.board.agent.runner.run({ actions: [{ op: 'figure', lines: ['f(x) = x^2'], mode: 'graphing', at: { x: 100, y: 100 } }] });
    circleAround(rig, [0, 0, 600, 500]);
    const [card] = rig.board.agent.circle.found.items;
    expect(card?.kind).toBe('figure');
    expect(typeof card?.summary).toBe('string');
    expect(rig.board.agent.circle.suggestions.map((s) => s.choice)).toEqual(['explain', 'animate', 'slider', 'ask']);
  });

  it('a loop of fewer than 3 points is no loop', () => {
    const rig = makeAgentRig();
    const c = rig.board.agent.circle;
    c.down(10, 10);
    c.move(20, 20);
    c.up();
    expect(c.state).toBe('idle');
    expect(c.suggestions).toEqual([]);
  });

  it('dismiss puts the suggestions away; a new loop replaces the old one', () => {
    const rig = makeAgentRig();
    userShape(rig, 'rect', 50, 50, { w: 100, h: 60 });
    circleAround(rig, [0, 0, 300, 300]);
    rig.board.agent.circle.dismiss();
    expect(rig.board.agent.circle.state).toBe('idle');
    expect(rig.board.agent.circle.suggestions).toEqual([]);
    expect(rig.board.agent.circle.found.items).toEqual([]);
    circleAround(rig, [0, 0, 300, 300]);
    circleAround(rig, [2000, 2000, 100, 100]);
    expect(rig.board.agent.circle.found.items).toEqual([]);
  });
});

describe('the request of agent.md 3', () => {
  const asked = async (rig: AgentRig, seen: BoardAgentRequest[], choice: Parameters<AgentRig['board']['agent']['circle']['pick']>[0], text?: string): Promise<void> => {
    must(await rig.board.agent.circle.pick(choice, text));
    expect(seen.length).toBeGreaterThan(0);
  };

  it('is one request with kind circle, the choice, the items, the circle and the page', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const a = userShape(rig, 'rect', 50, 50, { w: 100, h: 60 });
    circleAround(rig, [0, 0, 300, 300]);
    await asked(rig, fake.requests, 'explain');
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0] as CircleRequest;
    expect(request.kind).toBe('circle');
    expect(request.choice).toBe('explain');
    expect(request.page).toBe(rig.page);
    expect(request.more).toBe(0);
    expect(request.items.map((i) => i.id)).toEqual([a.id]);
    expect(request.items[0]?.kind).toBe('rect');
    expect(request.items[0]?.box).toHaveLength(4);
    expect(request.circle).toEqual([0, 0, 300, 300]);
    expect('picture' in request).toBe(false);
    expect('text' in request).toBe(false);
  });

  it('the choice is each suggestion the user can pick', async () => {
    const picked: string[] = [];
    const fake = responding((r) => {
      picked.push((r as CircleRequest).choice);
      return [{ done: true as const }];
    });
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    for (const choice of ['graph', 'formula', 'solve', 'steps', 'measure', 'geometry', 'explain', 'animate', 'slider'] as const) {
      circleAround(rig, [0, 0, 300, 300]);
      must(await rig.board.agent.circle.pick(choice));
    }
    expect(picked).toEqual(['graph', 'formula', 'solve', 'steps', 'measure', 'geometry', 'explain', 'animate', 'slider']);
  });

  it('ask carries the text, and is refused with no text', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    circleAround(rig, [0, 0, 300, 300]);
    const none = await rig.board.agent.circle.pick('ask', '   ');
    expect(none.ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
    expect(rig.board.agent.circle.state).toBe('choosing');
    must(await rig.board.agent.circle.pick('ask', 'Why is this steep?'));
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ kind: 'circle', choice: 'ask', text: 'Why is this steep?' });
  });

  it('lists at most 60 items and says how many more the circle holds', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    for (let i = 0; i < 70; i++) userShape(rig, 'rect', 10 + (i % 10) * 60, 10 + Math.floor(i / 10) * 50, { w: 40, h: 30 });
    circleAround(rig, [0, 0, 700, 400]);
    must(await rig.board.agent.circle.pick('explain'));
    const request = fake.requests[0] as CircleRequest;
    expect(request.items).toHaveLength(60);
    expect(request.more).toBe(10);
  });

  it('pick with no circle drawn is refused and sends nothing', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const r = await rig.board.agent.circle.pick('explain');
    expect(r.ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('a choice that is not a suggestion is refused and sends nothing', async () => {
    const fake = scripted([[{ done: true }]]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    circleAround(rig, [0, 0, 300, 300]);
    const r = await rig.board.agent.circle.pick('delete everything' as never);
    expect(r.ok).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('the picture only with agent.vision (agent.md 3; design 11.1 step 4)', () => {
  let canvas: FakeCanvas;
  let unsize: () => void;
  let container: HTMLElement;
  let boards: Board[];
  let toDataUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    canvas = installCanvas2d();
    unsize = stubSize();
    toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/png;base64,AAAA');
    container = document.createElement('div');
    document.body.append(container);
    boards = [];
  });
  afterEach(() => {
    for (const b of boards) b.dispose();
    container.remove();
    toDataUrl.mockRestore();
    unsize();
    canvas.restore();
  });

  async function pickWith(vision: boolean | undefined): Promise<CircleRequest> {
    const fake = scripted([[{ done: true }]]);
    const board = must(createBoard({ container, canvas2dOnly: true, agent: { transport: fake.transport, reducedMotion: true, ...(vision !== undefined ? { vision } : {}) } }));
    boards.push(board);
    await board.agent.runner.run({ actions: [{ op: 'shape', kind: 'rect', at: { x: 50, y: 50 }, w: 100, h: 60 }] });
    const c = board.agent.circle;
    c.down(0, 0);
    c.move(300, 0);
    c.move(300, 300);
    c.move(0, 300);
    c.up();
    must(await c.pick('explain'));
    return fake.requests[0] as CircleRequest;
  }

  it('is sent as an image data URL when vision is on', async () => {
    const request = await pickWith(true);
    expect(typeof request.picture).toBe('string');
    expect(request.picture).toMatch(/^data:image\/png;base64,/);
  });

  it('is not sent when vision is off, which is the default', async () => {
    expect('picture' in (await pickWith(false))).toBe(false);
    expect('picture' in (await pickWith(undefined))).toBe(false);
  });
});

describe('the answer lands on the board (agent.md 3; design 11.1 step 5; ui.md Circle to ask)', () => {
  /** What a server would answer: one figure near the circle, and an arrow from the circle to it. */
  const answer = (r: BoardAgentRequest): readonly { actions: readonly unknown[] }[] => {
    const circle = (r as CircleRequest).circle;
    return [
      { actions: [{ op: 'figure', lines: ['f(x) = x^2'], mode: 'graphing', at: { near: circle, side: 'right' } }] },
      { actions: [{ op: 'arrow', from: circle, to: '$last' }] },
    ];
  };

  it('a figure card is placed near the circle, clear of the circled work, with an arrow to it', async () => {
    const fake = responding((r) => [...answer(r), { done: true as const }]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    userShape(rig, 'rect', 50, 50, { w: 100, h: 60 });
    circleAround(rig, [0, 0, 300, 300]);
    const outcome = must(await rig.board.agent.circle.pick('graph'));
    expect(outcome.failed).toEqual([]);
    const cards = shapesOf(rig).filter((s) => s.kind === 'figure');
    expect(cards).toHaveLength(1);
    const card = figureOf(rig.board.core, (cards[0] as { id: string }).id);
    expect(card?.meta['madeBy']).toBe('model');
    const read = must(rig.board.agent.runner.read({ area: [-1000, -1000, 5000, 5000] }));
    const cardBox = read.items.find((i) => i.id === card?.id)?.box as readonly [number, number, number, number];
    expect(cardBox[0]).toBeGreaterThanOrEqual(300);
    expect(overlaps(cardBox, [0, 0, 300, 300])).toBe(false);
    expect(Math.abs(cardBox[0] - 300)).toBeLessThan(400);
    expect(shapesOf(rig).filter((s) => s.kind === 'arrow')).toHaveLength(1);
    expect(outcome.made).toHaveLength(2);
  });

  it('the whole answer is one undo step, and one undo takes the card and the arrow back', async () => {
    const fake = responding((r) => [...answer(r), { done: true as const }]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    const userRect = userShape(rig, 'rect', 50, 50, { w: 100, h: 60 });
    const steps = rig.board.core.history.undoSteps;
    circleAround(rig, [0, 0, 300, 300]);
    must(await rig.board.agent.circle.pick('graph'));
    expect(rig.board.core.history.undoSteps).toBe(steps + 1);
    expect(rig.board.core.history.undo().ok).toBe(true);
    expect(shapesOf(rig).map((s) => s.id)).toEqual([userRect.id]);
  });

  it('the conversation keeps what the user picked and what the agent did', async () => {
    const fake = responding((r) => [...answer(r), { done: true as const }]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    circleAround(rig, [0, 0, 300, 300]);
    must(await rig.board.agent.circle.pick('graph'));
    const who = rig.board.agent.service.entries.map((e) => e.who);
    expect(who[0]).toBe('you');
    expect(who).toContain('agent');
  });

  it('the circle goes back to idle when the answer is done', async () => {
    const fake = responding((r) => [...answer(r), { done: true as const }]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    circleAround(rig, [0, 0, 300, 300]);
    const pending = rig.board.agent.circle.pick('graph');
    expect(rig.board.agent.circle.state).toBe('asking');
    must(await pending);
    expect(rig.board.agent.circle.state).toBe('idle');
    expect(rig.board.agent.circle.suggestions).toEqual([]);
  });

  it('a figure line that fails comes back to the agent and the other lines still make the card', async () => {
    const fake = responding((r) => [
      { actions: [{ op: 'figure', lines: ['f(x) = x^2', 'g(x = '], mode: 'graphing', at: { near: (r as CircleRequest).circle, side: 'right' } }] },
      { done: true as const },
    ]);
    const rig = makeAgentRig({ reducedMotion: true, transport: fake.transport });
    circleAround(rig, [0, 0, 300, 300]);
    must(await rig.board.agent.circle.pick('graph'));
    const card = shapesOf(rig).find((s) => s.kind === 'figure');
    expect(card).toBeDefined();
    expect(figureOf(rig.board.core, (card as { id: string }).id)?.props.script).toContain('f(x) = x^2');
  });
});

describe('what a circle lets the agent change (agent.md 2: "a circle\'s slider and animate choices")', () => {
  const editAnswer = (id: string) => (): readonly BoardAgentEvent[] => [{ actions: [{ op: 'edit', id, text: 'f(x) = x^2\na = 2' }] }, { done: true }];

  const setup = async (choice: 'slider' | 'animate' | 'explain'): Promise<{ rig: AgentRig; id: string; error: BoardError | undefined }> => {
    const rig = makeAgentRig();
    // a figure card of the user's: made without the mark of the model
    const card = userShape(rig, 'figure', 50, 50, { script: '# incantly 1\nf(x) = x^2', mode: 'graphing', w: 300, h: 200, picture: null });
    const fake = responding(editAnswer(card.id));
    const board = rig.board;
    board.agent.service.setTransport(fake.transport);
    circleAround(rig, [0, 0, 500, 400]);
    must(await board.agent.circle.pick(choice));
    return { rig, id: card.id, error: board.agent.service.job?.failed[0] };
  };

  it.each(['slider', 'animate'] as const)('%s may edit the figure card the user made', async (choice) => {
    const { rig, id, error } = await setup(choice);
    expect(error).toBeUndefined();
    expect(figureOf(rig.board.core, id)?.props.script).toContain('a = 2');
  });

  it('explain may not: the edit is refused with not_model and the card stays as it was', async () => {
    const { rig, id, error } = await setup('explain');
    expect(error?.kind).toBe('agent_refused');
    expect((error?.detail as { reason?: string } | undefined)?.reason).toBe('not_model');
    expect(figureOf(rig.board.core, id)?.props.script).not.toContain('a = 2');
  });
});

describe('no transport: Ask reports agent_unavailable (R8.4; errors.md)', () => {
  it('pick returns agent_unavailable, tells onError and makes nothing', async () => {
    const errors: BoardError[] = [];
    const board = must(createBoard({ onError: (e) => errors.push(e) }));
    expect(board.agent.service.available).toBe(false);
    board.agent.circle.down(0, 0);
    board.agent.circle.move(100, 0);
    board.agent.circle.move(100, 100);
    board.agent.circle.up();
    const r = await board.agent.circle.pick('ask', 'hello');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_unavailable');
    expect(errors.map((e) => e.kind)).toContain('agent_unavailable');
  });

  it('the Ask tool draws a loop with the pointer, and the answer to a pick is agent_unavailable', async () => {
    const errors: BoardError[] = [];
    const board = must(createBoard({ onError: (e) => errors.push(e) }));
    expect(board.setTool('ask').ok).toBe(true);
    const base = { pointer: 1, device: 'mouse' as const, pressure: Number.NaN, tiltX: 0, tiltY: 0, twist: 0, buttons: 1, predicted: false };
    board.host.sample({ ...base, phase: 'down', x: 10, y: 10, time: 0 });
    board.host.sample({ ...base, phase: 'move', x: 200, y: 10, time: 8 });
    board.host.sample({ ...base, phase: 'move', x: 200, y: 200, time: 16 });
    board.host.sample({ ...base, phase: 'move', x: 10, y: 200, time: 24 });
    board.host.sample({ ...base, phase: 'up', x: 10, y: 12, buttons: 0, time: 32 });
    expect(board.agent.circle.state).toBe('choosing');
    const r = await board.agent.circle.pick('ask', 'what is this?');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('agent_unavailable');
    expect(errors.map((e) => e.kind)).toContain('agent_unavailable');
  });
});

describe("the pen's barrel button held gives Ask for that stroke (ui.md Pen; B12 askHeld)", () => {
  const BARREL = BUTTON_TIP | BUTTON_BARREL;

  it('a barrel stroke with the pen chosen is a circle, not ink, and the pen comes back', () => {
    const rig = makeAgentRig();
    userShape(rig, 'rect', 50, 50, { w: 100, h: 60 });
    expect(rig.board.tool).toBe('pen');
    const loop: [number, number][] = [[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]];
    drawPath({ host: rig.board.host }, loop.flatMap((p, i, a) => (i === 0 ? [] : line(a[i - 1]?.[0] ?? 0, a[i - 1]?.[1] ?? 0, p[0], p[1], 6))) as [number, number][], { buttons: BARREL });
    expect(rig.board.agent.circle.state).toBe('choosing');
    expect(rig.board.agent.circle.found.items).toHaveLength(1);
    expect(shapesOf(rig).filter((s) => s.kind === 'ink')).toHaveLength(0);
    expect(rig.board.tool).toBe('pen');
    // the next stroke, without the button, writes ink again
    drawPath({ host: rig.board.host }, line(400, 400, 600, 420, 10), {}, 1000);
    expect(shapesOf(rig).filter((s) => s.kind === 'ink')).toHaveLength(1);
  });

  it('the host is in askHeld while the button is down, and back to chosen after', () => {
    const rig = makeAgentRig();
    const base = { pointer: 1, device: 'pen' as const, pressure: 0.5, tiltX: 0, tiltY: 0, twist: 0, predicted: false };
    expect(rig.board.host.state).toBe('chosen');
    rig.board.host.sample({ ...base, phase: 'down', x: 10, y: 10, buttons: BARREL, time: 0 });
    expect(rig.board.host.state).toBe('askHeld');
    rig.board.host.sample({ ...base, phase: 'move', x: 100, y: 10, buttons: BARREL, time: 8 });
    rig.board.host.sample({ ...base, phase: 'up', x: 100, y: 100, buttons: 0, time: 16 });
    expect(rig.board.host.state).toBe('chosen');
  });

  it('without the Ask tool in the list the barrel button does not give it, and the stroke is ink', () => {
    const board = must(createBoard({ tools: inkTools }));
    drawPath({ host: board.host }, line(0, 0, 300, 100, 10), { buttons: BARREL });
    expect(board.agent.circle.state).toBe('idle');
    expect(board.core.store.shapesOn(board.core.pages.current as string).filter((s) => s.kind === 'ink')).toHaveLength(1);
  });
});

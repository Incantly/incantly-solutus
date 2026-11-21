/**
 * The agent panel and Stop (ui.md Layout and "The talking agent"; design 11.4; state-machines B35): the conversation, a box
 * to talk, a Stop button that stops at once and keeps what was drawn, a box that lets the agent change the user's work
 * (off by default), and a hand icon that shows only while the agent works.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentPanel, AgentService, BOARD_STRINGS, BoardAgent, BoardCore, Strings, createBoard } from '../../src/index';
import type { Board, BoardAgentRequest, BoardAgentTransport } from '../../src/index';
import { installCanvas2d } from './ink-helpers';
import type { FakeCanvas } from './ink-helpers';
import { stubSize } from './round4-helpers';
import { circleAround, gate, must, scripted, tick } from './agent-helpers';

const T = (key: string): string => BOARD_STRINGS[key] as string;

let fake: FakeCanvas;
let unsize: () => void;
let container: HTMLElement;
let boards: Board[];

beforeEach(() => {
  fake = installCanvas2d();
  unsize = stubSize();
  container = document.createElement('div');
  document.body.append(container);
  boards = [];
});
afterEach(() => {
  for (const b of boards) b.dispose();
  container.remove();
  unsize();
  fake.restore();
});

type Agent = NonNullable<Parameters<typeof createBoard>[0]>['agent'];

function mount(agent: Agent): Board {
  const board = must(createBoard({ container, canvas2dOnly: true, ...(agent !== undefined ? { agent } : {}) }));
  boards.push(board);
  return board;
}

const panelOf = (b: Board): HTMLElement | null => (b.element as HTMLElement).querySelector(`aside[aria-label="${T('agent.label')}"]`);
const buttons = (root: ParentNode, text: string): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text);
const stopOf = (b: Board): HTMLButtonElement => buttons(panelOf(b) as HTMLElement, T('agent.stop'))[0] as HTMLButtonElement;
const toggleOf = (b: Board): HTMLButtonElement => buttons(b.element as HTMLElement, T('agent.label')).find((x) => !(panelOf(b) as HTMLElement).contains(x)) as HTMLButtonElement;
const inputOf = (b: Board): HTMLInputElement => (panelOf(b) as HTMLElement).querySelector('input[type="text"]') as HTMLInputElement;
const allowOf = (b: Board): HTMLInputElement => (panelOf(b) as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement;
const submit = (b: Board): void => {
  (panelOf(b) as HTMLElement).querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
};
const rect = (x: number): unknown => ({ op: 'shape', kind: 'rect', at: { x, y: 20 }, w: 80, h: 40 });
const shapeCount = (b: Board): number => b.core.store.shapesOn(b.core.pages.current as string).length;

describe('the panel is there when an agent is set (ui.md Layout)', () => {
  it('a board with a transport has the panel and its button; the panel starts shut', () => {
    const board = mount({ transport: scripted([[{ done: true }]]).transport, reducedMotion: true });
    expect(panelOf(board)).not.toBeNull();
    expect(toggleOf(board)).toBeDefined();
    expect(panelOf(board)?.hidden).toBe(true);
  });

  it('a board with no agent at all has no panel', () => {
    const board = mount(undefined);
    expect(panelOf(board)).toBeNull();
  });

  it('the button opens and shuts the panel', () => {
    const board = mount({ transport: scripted([[{ done: true }]]).transport, reducedMotion: true });
    toggleOf(board).click();
    expect(panelOf(board)?.hidden).toBe(false);
    toggleOf(board).click();
    expect(panelOf(board)?.hidden).toBe(true);
  });

  it('a stand-in agent says what it is under the title', () => {
    const board = mount({ transport: scripted([[{ done: true }]]).transport, label: 'Scripted demo, not a model', reducedMotion: true });
    expect(panelOf(board)?.textContent).toContain('Scripted demo, not a model');
  });

  it('the box that lets the agent change the user\'s work is off by default', () => {
    const board = mount({ transport: scripted([[{ done: true }]]).transport, reducedMotion: true });
    toggleOf(board).click();
    expect(allowOf(board).checked).toBe(false);
    expect(panelOf(board)?.textContent).toContain(T('agent.allow'));
  });
});

describe('talking to the agent (ui.md The talking agent)', () => {
  it('what the user writes is sent as a talk request, and the conversation shows what the user said and what the agent did', async () => {
    const fakeT = scripted([[{ actions: [rect(20)] }, { done: true }]]);
    const board = mount({ transport: fakeT.transport, reducedMotion: true });
    toggleOf(board).click();
    inputOf(board).value = 'draw a box';
    submit(board);
    await tick(10);
    expect(fakeT.requests).toHaveLength(1);
    const request = fakeT.requests[0] as BoardAgentRequest;
    expect(request.kind).toBe('talk');
    expect((request as { text: string }).text).toBe('draw a box');
    expect(request).toHaveProperty('allowEdit', false);
    const text = panelOf(board)?.textContent ?? '';
    expect(text).toContain('draw a box');
    expect(text.toLowerCase()).toContain('rect');
    expect(shapeCount(board)).toBe(1);
  });

  it('with the box ticked the request lets the agent change the user\'s work', async () => {
    const fakeT = scripted([[{ done: true }]]);
    const board = mount({ transport: fakeT.transport, reducedMotion: true });
    toggleOf(board).click();
    allowOf(board).checked = true;
    inputOf(board).value = 'fix my work';
    submit(board);
    await tick(10);
    expect(fakeT.requests[0]).toHaveProperty('allowEdit', true);
  });

  it('an empty box sends nothing', async () => {
    const fakeT = scripted([[{ done: true }]]);
    const board = mount({ transport: fakeT.transport, reducedMotion: true });
    toggleOf(board).click();
    inputOf(board).value = '   ';
    submit(board);
    await tick(10);
    expect(fakeT.requests).toHaveLength(0);
  });
});

describe('Stop (ui.md: stops the agent at once; what it drew so far stays)', () => {
  const slow = (): { transport: BoardAgentTransport; hold: ReturnType<typeof gate> } => {
    const hold = gate();
    const transport: BoardAgentTransport = async function* () {
      yield { actions: [rect(20)] };
      await hold.wait;
      yield { actions: [rect(300)] };
      yield { done: true as const };
    };
    return { transport, hold };
  };

  it('while the agent works Stop shows and the box to talk is off; when it ends Stop goes', async () => {
    const { transport, hold } = slow();
    const board = mount({ transport, reducedMotion: true });
    toggleOf(board).click();
    expect(stopOf(board).hidden).toBe(true);
    inputOf(board).value = 'draw';
    submit(board);
    await tick(10);
    expect(stopOf(board).hidden).toBe(false);
    expect(inputOf(board).disabled).toBe(true);
    hold.open();
    await tick(10);
    expect(stopOf(board).hidden).toBe(true);
    expect(inputOf(board).disabled).toBe(false);
    expect(shapeCount(board)).toBe(2);
  });

  it('pressing Stop stops the job at once, keeps what was drawn, and the panel goes back to ready', async () => {
    const { transport, hold } = slow();
    const board = mount({ transport, reducedMotion: true });
    toggleOf(board).click();
    inputOf(board).value = 'draw';
    submit(board);
    await tick(10);
    expect(board.agent.service.busy).toBe(true);
    stopOf(board).click();
    expect(board.agent.service.busy).toBe(false);
    expect(board.agent.service.job?.state).toBe('stopped');
    expect(stopOf(board).hidden).toBe(true);
    expect(inputOf(board).disabled).toBe(false);
    hold.open();
    await tick(10);
    expect(shapeCount(board)).toBe(1);
    expect(panelOf(board)?.hidden).toBe(false);
  });

  it('Stop of a stroke drawn by hand, in the middle, keeps the part that was drawn', async () => {
    const hold = gate();
    const board = mount({
      transport: async function* () {
        yield { actions: [{ op: 'stroke', points: Array.from({ length: 100 }, (_, i) => [i * 12, (i % 2) * 10]), at: { x: 20, y: 20 } }] };
        await hold.wait;
        yield { done: true as const };
      },
    });
    toggleOf(board).click();
    inputOf(board).value = 'write';
    submit(board);
    // the board's frame loop is the clock: let some frames draw part of the 3/4 second the stroke takes
    await tick(350);
    expect(shapeCount(board)).toBe(0);
    stopOf(board).click();
    await tick(20);
    hold.open();
    await tick(10);
    const [stored] = board.core.store.shapesOn(board.core.pages.current as string);
    expect(stored?.kind).toBe('ink');
    const props = stored?.props as { points: Float32Array; stride: number };
    expect(props.points.length / props.stride).toBeLessThan(100);
  });
});

describe('circle to ask opens the panel by itself (B35 closed --begin--> busy)', () => {
  it('picking a suggestion shows the panel while the answer arrives', async () => {
    const hold = gate();
    const board = mount({
      transport: async function* () {
        await hold.wait;
        yield { done: true as const };
      },
      reducedMotion: true,
    });
    expect(panelOf(board)?.hidden).toBe(true);
    const rig = { board, errors: [], page: board.core.pages.current as string };
    circleAround(rig, [0, 0, 300, 300]);
    const pending = board.agent.circle.pick('ask', 'what is this?');
    await tick(5);
    expect(panelOf(board)?.hidden).toBe(false);
    expect(stopOf(board).hidden).toBe(false);
    hold.open();
    must(await pending);
    expect(stopOf(board).hidden).toBe(true);
  });

  it('a job that goes on while the panel is shut does not open it again', async () => {
    const hold = gate();
    const board = mount({
      transport: async function* () {
        await hold.wait;
        yield { done: true as const };
      },
      reducedMotion: true,
    });
    const pending = board.agent.service.talk('go');
    await tick(5);
    expect(panelOf(board)?.hidden).toBe(false);
    toggleOf(board).click();
    expect(panelOf(board)?.hidden).toBe(true);
    hold.open();
    await pending;
    expect(panelOf(board)?.hidden).toBe(true);
  });
});

describe('the panel without a transport says the agent is unavailable and has no box (B35)', () => {
  it('a board with agent options but nothing to send to does not let the user talk', () => {
    const board = mount({ reducedMotion: true });
    const panel = panelOf(board);
    if (panel === null) return;
    expect(panel.textContent).toContain(T('agent.unavailable'));
    expect(panel.querySelector<HTMLInputElement>('input[type="text"]')?.disabled).toBe(true);
  });
});

describe('the hand icon (ui.md: a small hand icon moves where the agent draws)', () => {
  function bare(transport?: Parameters<typeof AgentService.prototype.setTransport>[0]): { panel: AgentPanel; service: AgentService; core: BoardCore; root: HTMLElement } {
    const core = must(BoardCore.create());
    const service = new AgentService(new BoardAgent(core), transport !== undefined ? { transport } : {});
    const root = document.createElement('div');
    document.body.append(root);
    const panel = new AgentPanel({ doc: document, root, service, strings: new Strings(BOARD_STRINGS), onError: () => undefined });
    return { panel, service, core, root };
  }

  it('shows only while a request runs, at the place the agent works', async () => {
    const hold = gate();
    const { panel, service, core, root } = bare(async function* () {
      await hold.wait;
      yield { done: true as const };
    });
    panel.open();
    expect(panel.state).toBe('open');
    panel.handAt(300, 200);
    panel.place(core.camera);
    expect(panel.hand.hidden).toBe(true);
    const pending = service.talk('go');
    await tick(5);
    expect(panel.state).toBe('busy');
    panel.place(core.camera);
    expect(panel.hand.hidden).toBe(false);
    expect(panel.hand.style.transform).toContain('300');
    expect(panel.hand.style.transform).toContain('200');
    hold.open();
    await pending;
    expect(panel.state).toBe('open');
    panel.place(core.camera);
    expect(panel.hand.hidden).toBe(true);
    panel.dispose();
    root.remove();
  });

  it('close in closed and open in open are no-ops that report nothing', () => {
    const { panel, root } = bare(scripted([[{ done: true }]]).transport);
    panel.close();
    expect(panel.state).toBe('closed');
    panel.open();
    panel.open();
    expect(panel.state).toBe('open');
    panel.dispose();
    root.remove();
  });
});

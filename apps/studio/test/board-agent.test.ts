/**
 * Round 3, the studio's board agent (server design 8, requirements R7.2; board design 11.3): the board uses the server
 * when `GET /v1/health` answers and a model is ready, and keeps the scripted demo agent, labelled "no AI", otherwise.
 * Only the studio's public functions and the mounted page are used; `fetch` is replaced, so nothing reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoard } from '@incantly/board';
import type { BoardAgentRequest, BoardView } from '@incantly/board';
import { AI_LABEL, boardAgentOption, connectBoardAgent } from '../src/board-agent';
import { DEMO_LABEL } from '../src/board-demo-agent';
import { PROBE_MS, probeServer } from '../src/server';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ndjson = (...events: unknown[]): Response => new Response(`${events.map((e) => JSON.stringify(e)).join('\n')}\n`, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });

const READY = { ok: true, provider: 'openrouter', keySet: true, ready: true };
const NOT_READY = { ok: true, provider: 'openrouter', keySet: false, ready: false };

const circleRequest = (page: string): BoardAgentRequest => ({
  kind: 'circle',
  choice: 'formula',
  items: [{ id: 'shape:a1', kind: 'text', box: [0, 0, 100, 40], text: 'y = x^2' }],
  more: 0,
  circle: [0, 0, 100, 40],
  page,
});

const labelOf = (view: BoardView): string | undefined => view.element.querySelector('.ib-agent-demo')?.textContent ?? undefined;
const shapeCount = (view: BoardView): number => view.core.store.shapesOn(view.core.pages.current as string).length;

async function waitFor(check: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
}

/** Starts a circle on the demo agent and waits until its first answer (the figure card) is on the board, then stops it: the hand-written caption after it needs the board's frame loop, which a test does not run. */
async function demoAnswers(view: BoardView, choice = 'graph'): Promise<boolean> {
  const before = shapeCount(view);
  void view.agent.service.ask({ ...circleRequest(view.core.pages.current as string), choice } as BoardAgentRequest, 'Graph');
  const made = await waitFor(() => shapeCount(view) > before);
  view.agent.service.stop();
  return made;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('probeServer: GET /v1/health (design 8)', () => {
  it('asks /v1/health with an accept header and reads the provider and whether a model is ready', async () => {
    const seen: { url: string; accept: string | undefined }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, accept: (init?.headers as Record<string, string> | undefined)?.['accept'] });
      return json(READY);
    }) as unknown as typeof fetch;
    expect(await probeServer(fake)).toEqual({ provider: 'openrouter', ready: true });
    expect(seen).toEqual([{ url: '/v1/health', accept: 'application/json' }]);
  });

  it('a server with no key answers, and is not ready', async () => {
    expect(await probeServer((async () => json(NOT_READY)) as unknown as typeof fetch)).toEqual({ provider: 'openrouter', ready: false });
  });

  it('a server that does not answer, answers an error, or answers something else is no server (undefined, never a throw)', async () => {
    expect(await probeServer((async () => { throw new TypeError('connection refused'); }) as unknown as typeof fetch)).toBeUndefined();
    expect(await probeServer((async () => json({ ok: false }, 503)) as unknown as typeof fetch)).toBeUndefined();
    expect(await probeServer((async () => json({ hello: 'world' })) as unknown as typeof fetch)).toBeUndefined();
    expect(await probeServer((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch)).toBeUndefined();
  });

  it('waits at most PROBE_MS (1.5 s) and then goes on without the server', async () => {
    expect(PROBE_MS).toBe(1500);
    const never = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      })) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await probeServer(never, 60)).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('the agent option and connectBoardAgent (board design 11.3)', () => {
  let container: HTMLElement;
  let board: ReturnType<typeof makeBoard>;

  function makeBoard() {
    const made = createBoard({ container, canvas2dOnly: true, agent: boardAgentOption() });
    if (!made.ok || made.value.view === undefined) throw new Error('no board');
    return made.value;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    board = makeBoard();
  });
  afterEach(() => {
    board.dispose();
    container.remove();
  });

  it('the option is the scripted demo agent, labelled so', () => {
    const option = boardAgentOption();
    expect(option.transport).toBeTypeOf('function');
    expect(option.label).toBe(DEMO_LABEL);
    expect(DEMO_LABEL.toLowerCase()).toContain('no ai');
  });

  it('a board made with the option shows the demo label on its panel', () => {
    expect(labelOf(board.view as BoardView)).toBe(DEMO_LABEL);
  });

  it('a ready server gives the board the HTTP agent: the next request goes to POST /v1/board/ask, the same origin', async () => {
    const view = board.view as BoardView;
    const calls: { url: string; method: string | undefined; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return ndjson({ actions: [{ op: 'write', text: 'from the server', at: 'free' }] }, { done: true });
    });
    connectBoardAgent(view, { provider: 'openrouter', ready: true });
    const before = shapeCount(view);
    const outcome = await view.agent.service.ask(circleRequest(view.core.pages.current as string), 'Formula');
    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/v1/board/ask');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toMatchObject({ kind: 'circle', choice: 'formula' });
    expect(shapeCount(view)).toBe(before + 1);
  });

  it('a ready server changes the label from "no AI" to the AI\'s', () => {
    const view = board.view as BoardView;
    connectBoardAgent(view, { provider: 'openrouter', ready: true });
    expect(labelOf(view)).toBe(AI_LABEL);
    expect(labelOf(view)).not.toBe(DEMO_LABEL);
    expect(AI_LABEL.toLowerCase()).not.toContain('no ai');
  });

  it('a server with no model ready, or none at all, leaves the demo agent and its label', async () => {
    for (const health of [{ provider: 'openrouter', ready: false }, undefined]) {
      const view = board.view as BoardView;
      const fetchSpy = vi.fn(async () => ndjson({ done: true }));
      vi.stubGlobal('fetch', fetchSpy);
      connectBoardAgent(view, health);
      expect(labelOf(view)).toBe(DEMO_LABEL);
      expect(await demoAnswers(view)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('the demo agent answers a circle by itself, with no network', async () => {
    const view = board.view as BoardView;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await demoAnswers(view)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('after the server agent is connected, a server error is shown as the board\'s agent error, and the board stays whole', async () => {
    const view = board.view as BoardView;
    vi.stubGlobal('fetch', async () => json({ ok: false, kind: 'rate_limited', message: 'Too many requests; try again in 20 s.' }, 429));
    connectBoardAgent(view, { provider: 'openrouter', ready: true });
    const outcome = await view.agent.service.ask(circleRequest(view.core.pages.current as string), 'Formula');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(JSON.stringify(outcome)).toContain('Too many requests');
  });
});

describe('the mounted studio chooses the board\'s agent from /v1/health (R7.2)', () => {
  let root: HTMLElement;
  let m: Mounted;

  const mount = (): void => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, mode: 'notes' });
  };
  afterEach(() => {
    m.dispose();
    root.remove();
  });
  const view = (): BoardView => m.board.view() as BoardView;

  it('the Board opens at once with the demo agent, and a ready server then takes over (label and transport)', async () => {
    const posted: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      posted.push(`${init?.method ?? 'GET'} ${String(url)}`);
      if (String(url) === '/v1/health') return json(READY);
      return ndjson({ actions: [{ op: 'write', text: 'server says hi', at: 'free' }] }, { done: true });
    });
    mount();
    expect(view()).toBeDefined();
    expect(posted).toContain('GET /v1/health');
    expect(await waitFor(() => labelOf(view()) === AI_LABEL)).toBe(true);
    const outcome = await view().agent.service.ask(circleRequest(view().core.pages.current as string), 'Formula');
    expect(outcome.ok).toBe(true);
    expect(posted).toContain('POST /v1/board/ask');
  });

  it('a server with no key leaves the demo agent: the label stays and no request goes to /v1/board/ask', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return json(NOT_READY);
    });
    mount();
    await waitFor(() => calls.includes('/v1/health'));
    await new Promise((r) => setTimeout(r, 50));
    expect(labelOf(view())).toBe(DEMO_LABEL);
    expect(await demoAnswers(view())).toBe(true);
    expect(calls).not.toContain('/v1/board/ask');
  });

  it('no server at all (the probe fails) leaves the demo agent', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      throw new TypeError('connection refused');
    });
    mount();
    await waitFor(() => calls.includes('/v1/health'));
    await new Promise((r) => setTimeout(r, 50));
    expect(labelOf(view())).toBe(DEMO_LABEL);
    expect(await demoAnswers(view())).toBe(true);
    expect(calls).not.toContain('/v1/board/ask');
  });

  it('a request made before the probe has answered goes to the demo agent', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url));
      return new Promise<Response>(() => undefined);
    });
    mount();
    expect(await demoAnswers(view())).toBe(true);
    expect(calls).not.toContain('/v1/board/ask');
  });
});

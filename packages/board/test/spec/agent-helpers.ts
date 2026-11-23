/**
 * Shared set-up for the round-5 spec tests (agents on the board, docs/features/board/agent.md). Only the public API of
 * `packages/board` is used: a headless board made by `createBoard` with a fake `BoardAgentTransport` (no network), the
 * runner of the two tools, the service and the circle to ask.
 */
import { createBoard, putNewShape } from '../../src/index';
import type { ActionResult, AgentOption, Board, BoardAgentEvent, BoardAgentRequest, BoardAgentTransport, BoardError, BoardResult, Limits, ShapeRecord } from '../../src/index';

export const must = <T>(r: BoardResult<T>): T => {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
};

/** A headless board with an agent. `errors` collects what the board reports through `onError`. */
export interface AgentRig {
  readonly board: Board;
  readonly errors: BoardError[];
  readonly page: string;
}

export function makeAgentRig(agent: AgentOption | undefined = { reducedMotion: true }, limits?: Partial<Limits>): AgentRig {
  const errors: BoardError[] = [];
  const board = must(createBoard({ ...(agent !== undefined ? { agent } : {}), ...(limits !== undefined ? { limits } : {}), onError: (e) => errors.push(e) }));
  return { board, errors, page: board.core.pages.current as string };
}

/** The shapes of the current page. */
export const shapesOf = (rig: AgentRig): readonly ShapeRecord[] => rig.board.core.store.shapesOn(rig.board.core.pages.current as string);

export const shape = (rig: AgentRig, id: string): ShapeRecord => {
  const s = rig.board.core.store.get(id);
  if (s === undefined) throw new Error(`no record ${id}`);
  return s as ShapeRecord;
};

/** Runs one `board` call; the results are the list of the answer. */
export async function run(rig: AgentRig, actions: readonly unknown[], request?: Parameters<AgentRig['board']['agent']['runner']['run']>[1]): Promise<readonly ActionResult[]> {
  return must(await rig.board.agent.runner.run({ actions }, request));
}

/** The id an action made, or a failure of the test. */
export function idOf(r: ActionResult | undefined): string {
  if (r === undefined || !r.ok || r.id === undefined) throw new Error(`the action gave no id: ${JSON.stringify(r)}`);
  return r.id;
}

/** The kind of a failed action, or `ok`. */
export const verdict = (r: ActionResult | undefined): string => (r === undefined ? 'missing' : r.ok ? 'ok' : r.kind);

/** A shape the user made (no `madeBy` mark), written as a user transaction. */
export function userShape(rig: AgentRig, kind: string, x: number, y: number, props: Readonly<Record<string, unknown>> = {}, over: Record<string, unknown> = {}): ShapeRecord {
  const { core } = rig.board;
  let made: ShapeRecord | undefined;
  const done = core.store.change('user', (tx) => {
    const r = putNewShape(tx, core.store, { kind, page: core.pages.current as string, x, y, props });
    if (!r.ok) throw new Error(`could not add a ${kind}: ${r.message}`);
    made = r.value;
    if (Object.keys(over).length > 0) tx.update(r.value.id, over);
  });
  if (!done.ok || made === undefined) throw new Error(`could not add a ${kind}`);
  return shape(rig, made.id);
}

/** The page box of a shape `[minX, minY, maxX, maxY]` from `board_read`. */
export function readBox(rig: AgentRig, id: string): readonly [number, number, number, number] {
  const read = must(rig.board.agent.runner.read({ area: [-100000, -100000, 200000, 200000] }));
  const item = read.items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`board_read does not list ${id}`);
  return item.box;
}

export const overlaps = (a: readonly [number, number, number, number], b: readonly [number, number, number, number]): boolean =>
  a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** A transport that answers each request with the next list of events; the requests it saw are kept. */
export interface FakeTransport {
  readonly transport: BoardAgentTransport;
  readonly requests: BoardAgentRequest[];
  readonly signals: AbortSignal[];
}

export function scripted(answers: readonly (readonly BoardAgentEvent[])[]): FakeTransport {
  const requests: BoardAgentRequest[] = [];
  const signals: AbortSignal[] = [];
  const transport: BoardAgentTransport = async function* (request, signal) {
    const n = requests.length;
    requests.push(request);
    signals.push(signal);
    for (const event of answers[Math.min(n, answers.length - 1)] ?? []) yield event;
  };
  return { transport, requests, signals };
}

/** A gate a test opens by hand, so an answer can stop in the middle. */
export function gate(): { readonly wait: Promise<void>; open(): void } {
  let open = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

export const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A transport whose answer is made from the request, as a server would. */
export function responding(answer: (request: BoardAgentRequest) => readonly BoardAgentEvent[]): FakeTransport {
  const requests: BoardAgentRequest[] = [];
  const signals: AbortSignal[] = [];
  const transport: BoardAgentTransport = async function* (request, signal) {
    requests.push(request);
    signals.push(signal);
    for (const event of answer(request)) yield event;
  };
  return { transport, requests, signals };
}

/** Draws a closed loop round the page box `[x, y, w, h]` with the circle to ask, and lifts the pointer. */
export function circleAround(rig: AgentRig, box: readonly [number, number, number, number]): void {
  const [x, y, w, h] = box;
  const c = rig.board.agent.circle;
  c.down(x, y);
  c.move(x + w, y);
  c.move(x + w, y + h);
  c.move(x, y + h);
  c.move(x, y + 2);
  c.up();
}

/** The values of a shape's props, to look for a label, a colour or a text without naming the field. */
export const propValues = (s: ShapeRecord): unknown[] => Object.values(s.props as Record<string, unknown>);

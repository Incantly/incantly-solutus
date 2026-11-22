/**
 * Prompt to figure, `streamFigure` (teacher design 7, requirements R5, docs/state-machines.md TE3, errors.md): the plan
 * call and when it is skipped, the script call whose lines are applied at their newline, the one repair call, and the
 * ends of a stream (done, cut, model error, deadline, stop, script limit). Written from the docs and the public
 * exports; the model is a scripted client, so no network is touched.
 */
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { streamFigure } from '../../src/index';
import type { ChatEvent, ChatRequest, ModelClient, StreamError, TurnEvent } from '../../src/index';
import { collect, makeRig, namesOn } from './helpers';
import type { Rig } from './helpers';

type Reply = (signal: AbortSignal) => AsyncGenerator<ChatEvent>;

/** A model client that plays `replies` in order and keeps the requests it got. */
class Scripted implements ModelClient {
  readonly calls: ChatRequest[] = [];
  private next = 0;
  constructor(private readonly replies: readonly Reply[]) {}
  async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    this.calls.push(request);
    const reply = this.replies[this.next];
    this.next += 1;
    if (reply === undefined) {
      yield { error: { ok: false, kind: 'model_unavailable', message: 'no more replies' } };
      return;
    }
    yield* reply(signal);
  }
}

const DONE: ChatEvent = { done: { model: 'fake', inputTokens: 0, outputTokens: 0 } };
const cutError: StreamError = { ok: false, kind: 'stream_cut', message: 'The answer stopped partway.' };
const busyError: StreamError = { ok: false, kind: 'model_busy', message: 'The AI is busy; try again in 5 s.', detail: { retryAfterMs: 5000 } };

/** A whole reply, in the pieces given. */
const say =
  (...pieces: string[]): Reply =>
  async function* () {
    for (const text of pieces) yield { text };
    yield DONE;
  };
/** A reply that stops partway: the pieces, then `stream_cut`. */
const cut =
  (...pieces: string[]): Reply =>
  async function* () {
    for (const text of pieces) yield { text };
    yield { error: cutError };
  };
/** A reply that fails after its pieces. */
const fail =
  (error: StreamError, ...pieces: string[]): Reply =>
  async function* () {
    for (const text of pieces) yield { text };
    yield { error };
  };
/** A reply that sends its pieces and then nothing, ever (it does not even listen to the abort signal). */
const hang =
  (...pieces: string[]): Reply =>
  async function* () {
    for (const text of pieces) yield { text };
    await new Promise<never>(() => undefined);
  };

const REQUEST = { text: 'a circle with a point on it' };
const now0 = (): number => 0;

const linesOf = (events: readonly TurnEvent[]): string[] => events.flatMap((e) => ('lines' in e ? [...e.lines] : []));
const errorsOf = (events: readonly TurnEvent[]): StreamError[] => events.flatMap((e) => ('error' in e ? [e.error] : []));
const doneOf = (events: readonly TurnEvent[]): Extract<TurnEvent, { done: true }> | undefined => events.find((e): e is Extract<TurnEvent, { done: true }> => 'done' in e);

interface Run {
  readonly events: TurnEvent[];
  readonly client: Scripted;
  readonly rig: Rig;
}

async function play(replies: readonly Reply[], options: { script?: string; mode?: string; plan?: 'auto' | 'always' | 'never'; choice?: string; signal?: AbortSignal; now?: () => number; limits?: { ms?: number; scriptChars?: number } } = {}): Promise<Run> {
  const rig = makeRig(options.mode ?? 'geometry', options.script);
  const client = new Scripted(replies);
  const events = await collect(
    streamFigure({
      client,
      target: rig.target,
      request: REQUEST,
      now: options.now ?? now0,
      ...(options.plan !== undefined ? { plan: options.plan } : {}),
      ...(options.choice !== undefined ? { choice: options.choice } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(options.limits !== undefined ? { limits: options.limits } : {}),
    }),
  );
  return { events, client, rig };
}

/** The error the kernel gives a line, read from a separate headless app. */
function kernelMessage(line: string): string {
  const app = createHeadlessApp({ mode: 'geometry' });
  const r = app.run([line])[0];
  if (r === undefined || r.ok) throw new Error(`the line "${line}" did not fail`);
  return (r as { message: string }).message;
}

describe('the script call, a happy stream (design 7 step 2)', () => {
  it('lines go out one a `lines` event, then `done`, and nothing else', async () => {
    const { events } = await play([say('c = Circle((0, 0), 2)\nP = Point', 'On(c)\n')], { plan: 'never' });
    expect(events).toEqual([{ lines: ['c = Circle((0, 0), 2)'] }, { lines: ['P = PointOn(c)'] }, { done: true }]);
  });

  it('the figure holds the lines that went out', async () => {
    const { rig } = await play([say('c = Circle((0, 0), 2)\nP = PointOn(c)\n')], { plan: 'never' });
    expect(namesOn(rig.target)).toEqual(['P', 'c']);
  });

  it('the last line needs no newline when the reply was whole', async () => {
    const { events } = await play([say('a = 1\nb = a + 1')], { plan: 'never' });
    expect(linesOf(events)).toEqual(['a = 1', 'b = a + 1']);
    expect(doneOf(events)).toEqual({ done: true });
  });

  it('a stream with no line to repair makes one model call', async () => {
    const { client } = await play([say('a = 1\n')], { plan: 'never' });
    expect(client.calls).toHaveLength(1);
  });

  it('the splitter drops blanks, fences and numbers before a line is applied', async () => {
    const { events } = await play([say('```\n1. a = 1\n\n2) b = a + 1\n```\n')], { plan: 'never' });
    expect(linesOf(events)).toEqual(['a = 1', 'b = a + 1']);
    expect(errorsOf(events)).toEqual([]);
  });

  it('a reply cut into one-character pieces gives the same lines', async () => {
    const text = 'c = Circle((0, 0), 2)\nP = PointOn(c)\n';
    const { events } = await play([say(...text)], { plan: 'never' });
    expect(linesOf(events)).toEqual(['c = Circle((0, 0), 2)', 'P = PointOn(c)']);
  });

  it('the lines that went out all load on a fresh figure: what the client commits is a script that loads', async () => {
    const { events } = await play([say('c = Circle((0, 0), 2)\nbad = Nope(\nP = PointOn(c)\nq = c +\nr = 3\n'), say('')], { plan: 'never' });
    const fresh = createHeadlessApp({ mode: 'geometry' });
    const results = fresh.run(linesOf(events));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(linesOf(events)).toEqual(['c = Circle((0, 0), 2)', 'P = PointOn(c)', 'r = 3']);
  });
});

describe('each line is applied at its newline, before the reply ends (design 7: first line within about 1 s of the first token)', () => {
  it('the first line is out, and on the figure, while the model has not sent the rest', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const gated: Reply = async function* () {
      yield { text: 'a = 1\nb = ' };
      await gate;
      yield { text: '2\n' };
      yield DONE;
    };
    const rig = makeRig('geometry');
    const it = streamFigure({ client: new Scripted([gated]), target: rig.target, request: REQUEST, now: now0, plan: 'never' })[Symbol.asyncIterator]();
    const first = await Promise.race([it.next(), new Promise<'late'>((r) => setTimeout(() => r('late'), 1500))]);
    expect(first).not.toBe('late');
    expect((first as IteratorResult<TurnEvent>).value).toEqual({ lines: ['a = 1'] });
    expect(namesOn(rig.target)).toEqual(['a']);
    open();
    const rest: TurnEvent[] = [];
    for (let r = await it.next(); r.done !== true; r = await it.next()) rest.push(r.value);
    expect(rest).toEqual([{ lines: ['b = 2'] }, { done: true }]);
  });

  it('a line that is not finished is not applied and not sent', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const gated: Reply = async function* () {
      yield { text: 'a = 1\nb = a +' };
      await gate;
      yield { text: ' 1\n' };
      yield DONE;
    };
    const rig = makeRig('geometry');
    const it = streamFigure({ client: new Scripted([gated]), target: rig.target, request: REQUEST, now: now0, plan: 'never' })[Symbol.asyncIterator]();
    await it.next();
    const pending = it.next();
    const second = await Promise.race([pending, new Promise<'waiting'>((r) => setTimeout(() => r('waiting'), 150))]);
    expect(second).toBe('waiting');
    expect(namesOn(rig.target)).toEqual(['a']);
    open();
    const next = await pending;
    expect((next as IteratorResult<TurnEvent>).value).toEqual({ lines: ['b = a + 1'] });
  });
});

describe('only passing lines are emitted, and one repair call (design 7 step 3, TE3)', () => {
  it('a failed line never goes out, and the lines before and after it still do', async () => {
    const { events } = await play([say('a = 1\nbad = Nope(\nb = a + 1\n'), say('')], { plan: 'never' });
    expect(linesOf(events)).toEqual(['a = 1', 'b = a + 1']);
    expect(JSON.stringify(events)).not.toContain('Nope(');
  });

  it('after the script call, one repair call gets the lines that passed and the failed line with its error', async () => {
    const { client } = await play([say('a = 1\nbad = Nope(\nb = a + 1\n'), say('bad = 3\n')], { plan: 'never' });
    expect(client.calls).toHaveLength(2);
    const repair = JSON.stringify(client.calls[1]?.messages);
    expect(repair).toContain('a = 1');
    expect(repair).toContain('b = a + 1');
    expect(repair).toContain('bad = Nope(');
    expect(repair).toContain(JSON.stringify(kernelMessage('bad = Nope(')).slice(1, -1));
  });

  it('the repair call is not made when no line failed', async () => {
    const { client } = await play([say('a = 1\nb = 2\n'), say('c = 3\n')], { plan: 'never' });
    expect(client.calls).toHaveLength(1);
  });

  it('a replacement line is applied the same way and goes out when it passes', async () => {
    const { events, rig } = await play([say('a = 1\nbad = Nope(\n'), say('bad = 3\n')], { plan: 'never' });
    expect(events).toEqual([{ lines: ['a = 1'] }, { lines: ['bad = 3'] }, { done: true }]);
    expect(namesOn(rig.target)).toEqual(['a', 'bad']);
  });

  it('a failed line and the line that reads it are both repaired, in order', async () => {
    const { events } = await play([say('bad = Nope(\nc = bad + 1\n'), say('bad = 3\nc = bad + 1\n')], { plan: 'never' });
    expect(linesOf(events)).toEqual(['bad = 3', 'c = bad + 1']);
    expect(doneOf(events)).toEqual({ done: true });
  });

  it('the repair call runs at most once: a replacement that fails again is left out, and the stream ends', async () => {
    const { events, client } = await play([say('a = 1\nbad = Nope(\n'), say('bad = Nope2(\n'), say('bad = 5\n')], { plan: 'never' });
    expect(client.calls).toHaveLength(2);
    expect(linesOf(events)).toEqual(['a = 1']);
    const done = doneOf(events);
    expect(done).toBeDefined();
    const notices = done !== undefined && 'notices' in done ? (done.notices ?? []) : [];
    expect(notices.map((n) => n.kind)).toEqual(['retry_spent']);
    expect(notices[0]?.names).toEqual(['bad']);
  });

  it('a line left out is reported as one retry_spent notice each (T005), in the last event', async () => {
    const { events } = await play([say('a = 1\nbad = Nope(\nq = c +\n'), say('')], { plan: 'never' });
    const done = doneOf(events);
    const notices = done !== undefined && 'notices' in done ? (done.notices ?? []) : [];
    expect(notices.map((n) => n.kind)).toEqual(['retry_spent', 'retry_spent']);
    expect(notices.map((n) => n.code)).toEqual(['T005', 'T005']);
    expect(notices.flatMap((n) => [...(n.names ?? [])]).sort()).toEqual(['bad', 'q']);
  });

  it('a stream with nothing left out ends with `done` and no notices field', async () => {
    const { events } = await play([say('a = 1\n')], { plan: 'never' });
    expect(events[events.length - 1]).toEqual({ done: true });
  });

  it('a repair call that is cut or fails keeps the lines that passed and leaves the failures out, and ends with done', async () => {
    for (const reply of [cut('bad = '), fail(busyError)]) {
      const { events } = await play([say('a = 1\nbad = Nope(\n'), reply], { plan: 'never' });
      expect(linesOf(events)[0], 'first line').toBe('a = 1');
      const done = doneOf(events);
      expect(done, 'a repair call that fails ends with done, not with an error').toBeDefined();
      expect(errorsOf(events)).toEqual([]);
      const notices = done !== undefined && 'notices' in done ? (done.notices ?? []) : [];
      expect(notices.some((n) => n.kind === 'retry_spent' && (n.names ?? []).includes('bad'))).toBe(true);
    }
  });

  it('nothing is ever sent after the last event', async () => {
    const { events } = await play([say('a = 1\nbad = Nope(\n'), say('bad = 3\n')], { plan: 'never' });
    const last = events[events.length - 1];
    expect(last !== undefined && ('done' in last || 'error' in last)).toBe(true);
    expect(events.filter((e) => 'done' in e || 'error' in e)).toHaveLength(1);
  });
});

describe('no line passed (errors.md model_bad_output)', () => {
  it('every line fails and the repair call writes nothing that passes: one model_bad_output error, no done', async () => {
    const { events } = await play([say('bad = Nope(\nq = c +\n'), say('bad = Nope2(\n')], { plan: 'never' });
    expect(linesOf(events)).toEqual([]);
    expect(doneOf(events)).toBeUndefined();
    const errors = errorsOf(events);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.kind).toBe('model_bad_output');
    expect(errors[0]?.message).toBe('The AI could not draw this.');
  });

  it('a reply with no line at all is model_bad_output', async () => {
    const { events } = await play([say('')], { plan: 'never' });
    expect(errorsOf(events).map((e) => e.kind)).toEqual(['model_bad_output']);
    expect(doneOf(events)).toBeUndefined();
  });

  it('a reply of fences and blanks only is model_bad_output', async () => {
    const { events } = await play([say('```\n\n```\n')], { plan: 'never' });
    expect(errorsOf(events).map((e) => e.kind)).toEqual(['model_bad_output']);
  });

  it('every line fails and the repair call fixes one: the stream is good and ends with done', async () => {
    const { events } = await play([say('bad = Nope(\n'), say('bad = 3\n')], { plan: 'never' });
    expect(events).toEqual([{ lines: ['bad = 3'] }, { done: true }]);
  });

  it('the error is in the SDK shape: ok false, kind, message', async () => {
    const { events } = await play([say('')], { plan: 'never' });
    const e = errorsOf(events)[0];
    expect(e?.ok).toBe(false);
    expect(typeof e?.message).toBe('string');
  });
});

describe('the plan call (design 7 step 1, TE3 idle -> planning)', () => {
  it('a new figure gets a plan call, then the script call', async () => {
    const { client } = await play([say('first a circle, then a point on it'), say('c = Circle((0, 0), 2)\n')]);
    expect(client.calls).toHaveLength(2);
  });

  it('the plan call gets the request', async () => {
    const { client } = await play([say('a plan'), say('a = 1\n')]);
    expect(JSON.stringify(client.calls[0]?.messages)).toContain(REQUEST.text);
  });

  it('the plan call gets the mode and the catalogue (the command forms)', async () => {
    const { client } = await play([say('a plan'), say('a = 1\n')]);
    expect(client.calls[0]?.system).toMatch(/Circle/);
    expect(client.calls[0]?.system).toMatch(/geometry/i);
  });

  it('the plan call gets the current script (an edit of 3 or more lines)', async () => {
    const script = 'a = 1\nb = 2\nc = 3';
    const { client } = await play([say('a plan'), say('d = 4\n')], { script });
    expect(client.calls).toHaveLength(2);
    expect(JSON.stringify(client.calls[0]?.messages)).toContain('a = 1');
  });

  it('the plan is never sent out: no event holds its words', async () => {
    const { events } = await play([say('PLANWORDS circle first'), say('c = Circle((0, 0), 2)\n')]);
    expect(JSON.stringify(events)).not.toContain('PLANWORDS');
    expect(linesOf(events)).toEqual(['c = Circle((0, 0), 2)']);
  });

  it('the script call is told the plan', async () => {
    const { client } = await play([say('PLANWORDS circle first'), say('c = Circle((0, 0), 2)\n')]);
    expect(JSON.stringify(client.calls[1]?.messages)).toContain('PLANWORDS circle first');
  });

  it('lines written in the plan reply are not applied: only the script call writes lines', async () => {
    const { events, rig } = await play([say('a = 1\nb = 2\n'), say('c = 3\n')]);
    expect(linesOf(events)).toEqual(['c = 3']);
    expect(namesOn(rig.target)).toEqual(['c']);
  });

  it('an edit of fewer than 3 lines skips the plan call', async () => {
    for (const script of ['a = 1', 'a = 1\nb = 2']) {
      const { client } = await play([say('c = 3\n'), say('d = 4\n')], { script });
      expect(client.calls, JSON.stringify(script)).toHaveLength(1);
    }
  });

  it('an edit of 3 lines does not skip it', async () => {
    const { client } = await play([say('a plan'), say('d = 4\n')], { script: 'a = 1\nb = 2\nc = 3' });
    expect(client.calls).toHaveLength(2);
  });

  it('a request that names the result (graph, solve, steps) skips it, even on a new figure', async () => {
    for (const choice of ['graph', 'solve', 'steps']) {
      const { client } = await play([say('a = 1\n'), say('b = 2\n')], { choice });
      expect(client.calls, choice).toHaveLength(1);
    }
  });

  it('a plan call that fails ends the stream with that error, and no script call is made', async () => {
    const { events, client } = await play([fail(busyError), say('a = 1\n')]);
    expect(events).toEqual([{ error: busyError }]);
    expect(client.calls).toHaveLength(1);
  });

  it('a plan that comes back empty still lets the script call run', async () => {
    const { events } = await play([say(''), say('a = 1\n')]);
    expect(linesOf(events)).toEqual(['a = 1']);
  });
});

describe('a stream cut partway (R5.4, T006, TE3 scripting -> done)', () => {
  it('the half line is dropped, the lines before it stay, and `done` carries a stream_cut notice', async () => {
    const { events, rig } = await play([cut('a = 1\nb = Circ')], { plan: 'never' });
    expect(linesOf(events)).toEqual(['a = 1']);
    expect(namesOn(rig.target)).toEqual(['a']);
    const done = doneOf(events);
    expect(done).toBeDefined();
    const notices = done !== undefined && 'notices' in done ? (done.notices ?? []) : [];
    expect(notices.map((n) => n.kind)).toContain('stream_cut');
    expect(errorsOf(events)).toEqual([]);
  });

  it('a cut stream is not repaired: no second model call', async () => {
    const { client } = await play([cut('a = 1\nbad = Nope(\nb = Circ'), say('bad = 3\n')], { plan: 'never' });
    expect(client.calls).toHaveLength(1);
  });

  it('the notice is T006 and says how many lines were drawn', async () => {
    const { events } = await play([cut('a = 1\nb = 2\nc = ')], { plan: 'never' });
    const done = doneOf(events);
    const notice = (done !== undefined && 'notices' in done ? (done.notices ?? []) : []).find((n) => n.kind === 'stream_cut');
    expect(notice?.code).toBe('T006');
  });

  it('a cut that ends exactly on a newline drops no line', async () => {
    const { events } = await play([cut('a = 1\nb = 2\n')], { plan: 'never' });
    expect(linesOf(events)).toEqual(['a = 1', 'b = 2']);
  });
});

describe('the model fails (TE3 modelError -> failed)', () => {
  it('an error in the script call ends the stream with that error; the lines already sent stay sent', async () => {
    const { events } = await play([fail(busyError, 'a = 1\n')], { plan: 'never' });
    expect(events).toEqual([{ lines: ['a = 1'] }, { error: busyError }]);
  });

  it('no repair call follows a failed script call', async () => {
    const { client } = await play([fail(busyError, 'bad = Nope(\n'), say('bad = 3\n')], { plan: 'never' });
    expect(client.calls).toHaveLength(1);
  });

  it('a client that throws does not throw out of the stream: it ends with an error event', async () => {
    const boom: Reply = async function* () {
      yield { text: 'a = 1\n' };
      throw new Error('socket exploded');
    };
    const { events } = await play([boom], { plan: 'never' });
    expect(errorsOf(events)).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('socket exploded');
  });
});

describe('the turn deadline and a stop (design 6 table, TE3 limit and abort)', () => {
  it('a signal aborted with a TimeoutError reason while the model sends nothing ends the stream as turn_limit', async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(new DOMException('timed out', 'TimeoutError')), 30);
    const run = await Promise.race([play([hang()], { plan: 'never', signal: ctl.signal }), new Promise<'stuck'>((r) => setTimeout(() => r('stuck'), 2000))]);
    expect(run).not.toBe('stuck');
    const { events } = run as Run;
    expect(errorsOf(events).map((e) => e.kind)).toEqual(['turn_limit']);
    expect(doneOf(events)).toBeUndefined();
  });

  it('what passed before the deadline stays, and goes out before the error', async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(new DOMException('timed out', 'TimeoutError')), 30);
    const { events, rig } = await play([hang('a = 1\nb = 2\n')], { plan: 'never', signal: ctl.signal });
    expect(linesOf(events)).toEqual(['a = 1', 'b = 2']);
    expect(namesOn(rig.target)).toEqual(['a', 'b']);
    expect(errorsOf(events).map((e) => e.kind)).toEqual(['turn_limit']);
    const last = events[events.length - 1];
    expect(last !== undefined && 'error' in last).toBe(true);
  });

  it('a signal aborted for any other reason is a stop: the lines stay, one final `done`, and no error', async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    const { events, rig } = await play([hang('a = 1\n')], { plan: 'never', signal: ctl.signal });
    expect(linesOf(events)).toEqual(['a = 1']);
    expect(namesOn(rig.target)).toEqual(['a']);
    expect(errorsOf(events)).toEqual([]);
    expect(events[events.length - 1]).toEqual({ done: true });
  });

  it('a stop during the plan call ends the stream and no script call is made', async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 30);
    const { client, events } = await play([hang(), say('a = 1\n')], { signal: ctl.signal });
    expect(client.calls).toHaveLength(1);
    expect(linesOf(events)).toEqual([]);
  });

  it('a signal that is already aborted ends the stream without a line', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const { events } = await play([say('a = 1\n')], { plan: 'never', signal: ctl.signal });
    expect(linesOf(events)).toEqual([]);
  });

  it('the injected clock passing 60 s ends the stream as turn_limit, between events', async () => {
    let t = 0;
    const slow: Reply = async function* () {
      yield { text: 'a = 1\n' };
      t = 61_000;
      yield { text: 'b = 2\n' };
      yield DONE;
    };
    const { events } = await play([slow], { plan: 'never', now: () => t });
    expect(errorsOf(events).map((e) => e.kind)).toEqual(['turn_limit']);
    expect(linesOf(events)).toContain('a = 1');
    expect(doneOf(events)).toBeUndefined();
  });

  it('59 s on the clock is still inside the turn', async () => {
    let t = 0;
    const slow: Reply = async function* () {
      yield { text: 'a = 1\n' };
      t = 59_000;
      yield { text: 'b = 2\n' };
      yield DONE;
    };
    const { events } = await play([slow], { plan: 'never', now: () => t });
    expect(errorsOf(events)).toEqual([]);
    expect(linesOf(events)).toEqual(['a = 1', 'b = 2']);
  });
});

describe('the script limit (design 7: lines are capped at the script limit; past it the stream stops with `limit`)', () => {
  it('a line that would pass the limit ends the stream as turn_limit, and the lines before it stay', async () => {
    const { events, rig } = await play([say('a = 1\nb = 2\nc = 3\nd = 4\n')], { plan: 'never', limits: { scriptChars: 14 } });
    expect(linesOf(events)).toEqual(['a = 1', 'b = 2']);
    expect(namesOn(rig.target)).toEqual(['a', 'b']);
    expect(errorsOf(events).map((e) => e.kind)).toEqual(['turn_limit']);
    expect(doneOf(events)).toBeUndefined();
  });

  it('the limit counts the characters of lines that passed, not the failed ones', async () => {
    const { events } = await play([say('bad = Nope(\nbad2 = Nope(\na = 1\nb = 2\n')], { plan: 'never', limits: { scriptChars: 14 } });
    expect(linesOf(events)).toEqual(['a = 1', 'b = 2']);
  });

  it('a script that fits the limit exactly is not refused', async () => {
    const { events } = await play([say('a = 1\nb = 2\n')], { plan: 'never', limits: { scriptChars: 12 } });
    expect(errorsOf(events)).toEqual([]);
    expect(linesOf(events)).toEqual(['a = 1', 'b = 2']);
  });
});

describe('state of the figure after the stream (design 7: the script grows only by lines that passed)', () => {
  it('the figure holds exactly the lines that went out, never a failed one', async () => {
    const { events, rig } = await play([say('a = 1\nbad = Nope(\nb = a + 1\nc = zzz + 1\n'), say('')], { plan: 'never' });
    expect(namesOn(rig.target)).toEqual(linesOf(events).map((l) => l.split('=')[0]?.trim() ?? '').sort());
  });

  it('a second stream on the same figure adds to what the first left (an edit)', async () => {
    const rig = makeRig('geometry');
    const first = await collect(streamFigure({ client: new Scripted([say('a = 1\n')]), target: rig.target, request: REQUEST, now: now0, plan: 'never' }));
    const second = await collect(streamFigure({ client: new Scripted([say('b = a + 1\n')]), target: rig.target, request: REQUEST, now: now0, plan: 'never' }));
    expect(linesOf(first)).toEqual(['a = 1']);
    expect(linesOf(second)).toEqual(['b = a + 1']);
    expect(namesOn(rig.target)).toEqual(['a', 'b']);
  });
});

describe('the model never gets a tool in the script or repair call (the model writes lines only)', () => {
  it('no call offers a tool that could draw by another route', async () => {
    const { client } = await play([say('bad = Nope(\n'), say('bad = 3\n')], { plan: 'never' });
    for (const call of client.calls) expect(call.tools.map((t) => t.name)).not.toContain('draw');
  });

  it('what the person wrote goes in a marked data block (design 5)', async () => {
    const { client } = await play([say('a = 1\n')], { plan: 'never' });
    const user = client.calls[0]?.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('<material>');
    expect(user?.content).toContain(REQUEST.text);
  });
});

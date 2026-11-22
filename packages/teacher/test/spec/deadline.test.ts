/**
 * The 60 s turn limit carried by the caller's signal (review TR-6, teacher design 6): the package has no timers, so the
 * caller passes `AbortSignal.timeout(60_000)`. A signal aborted with a `TimeoutError` reason ends the turn as
 * `turn_limit`, also while the model sends nothing; any other reason is a stop. No network, no real waiting.
 */
import { describe, expect, it } from 'vitest';
import { runTurn } from '../../src/index';
import type { ChatEvent, ModelClient, TurnEvent } from '../../src/index';
import { isError, lastOf, makeRig, tools } from './helpers';

/** A model that sends nothing and never looks at the signal. */
const silent: ModelClient = {
  async *chat(): AsyncGenerator<ChatEvent> {
    await new Promise<never>(() => undefined);
    yield { text: 'never sent' };
  },
};

/** A model that sends nothing and throws when the signal fires, as a fetch does. */
const throwing: ModelClient = {
  async *chat(_request, signal): AsyncGenerator<ChatEvent> {
    await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    yield { text: 'never sent' };
  },
};

async function run(client: ModelClient, signal: AbortSignal): Promise<TurnEvent[]> {
  const rig = makeRig('graphing');
  const events: TurnEvent[] = [];
  for await (const e of runTurn({ job: 'live', client, toolset: tools(), target: rig.target, request: { text: 'x' }, signal, now: () => 0 })) events.push(e);
  return events;
}

const timeout = (): DOMException => new DOMException('The operation timed out.', 'TimeoutError');

describe('the deadline is the signal (TR-6)', () => {
  it('a model that sends nothing is stopped by a TimeoutError signal: turn_limit', async () => {
    const controller = new AbortController();
    const turn = run(silent, controller.signal);
    controller.abort(timeout());
    const events = await turn;
    const last = lastOf(events);
    expect(isError(last) && last.error).toMatchObject({ ok: false, kind: 'turn_limit' });
  });

  it('a model that throws when the signal fires gives turn_limit, not internal', async () => {
    const controller = new AbortController();
    const turn = run(throwing, controller.signal);
    controller.abort(timeout());
    const last = lastOf(await turn);
    expect(isError(last) && last.error.kind).toBe('turn_limit');
  });

  it('a signal already past its deadline ends the turn as turn_limit with no model call', async () => {
    const controller = new AbortController();
    controller.abort(timeout());
    const last = lastOf(await run(silent, controller.signal));
    expect(isError(last) && last.error.kind).toBe('turn_limit');
  });

  it('a stop with another reason is still a stop: a final done', async () => {
    const controller = new AbortController();
    const turn = run(silent, controller.signal);
    controller.abort();
    expect(lastOf(await turn)).toEqual({ done: true });
  });

  it('a stop by a model that throws on abort is a final done, not internal', async () => {
    const controller = new AbortController();
    const turn = run(throwing, controller.signal);
    controller.abort(new Error('user stop'));
    expect(lastOf(await turn)).toEqual({ done: true });
  });

  it('AbortSignal.timeout ends a silent turn as turn_limit', async () => {
    const last = lastOf(await run(silent, AbortSignal.timeout(20)));
    expect(isError(last) && last.error.kind).toBe('turn_limit');
  });
});

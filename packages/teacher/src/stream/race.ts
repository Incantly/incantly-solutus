/**
 * A reply that can be stopped while it waits: each step of the model's stream races a promise that settles when the
 * caller's signal fires, so a model that sends nothing is still stopped (a stop, or the deadline). The package has no
 * timers; the deadline is the caller's `AbortSignal.timeout`.
 */

/** Marks that the caller's signal fired while the stream waited. */
export const ABORTED: unique symbol = Symbol('aborted');

/** A promise that settles with `ABORTED` when `signal` fires. */
export function whenAborted(signal: AbortSignal): Promise<typeof ABORTED> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(ABORTED);
    else signal.addEventListener('abort', () => resolve(ABORTED), { once: true });
  });
}

/**
 * The items of `stream`, then nothing; or `ABORTED` once, and the stream is closed, when `aborted` settles first. A
 * stream that throws while the signal is not fired throws on; the caller turns it into an `internal` event.
 */
export async function* raceStream<T>(stream: AsyncIterable<T>, signal: AbortSignal, aborted: Promise<typeof ABORTED>): AsyncGenerator<T | typeof ABORTED> {
  const it = stream[Symbol.asyncIterator]();
  for (;;) {
    const pending = it.next();
    pending.catch(() => undefined);
    let step: IteratorResult<T> | typeof ABORTED;
    try {
      step = await Promise.race([pending, aborted]);
    } catch (e) {
      if (!signal.aborted) throw e;
      step = ABORTED;
    }
    if (step === ABORTED) {
      void Promise.resolve(it.return?.()).catch(() => undefined);
      yield ABORTED;
      return;
    }
    if (step.done === true) return;
    yield step.value;
  }
}

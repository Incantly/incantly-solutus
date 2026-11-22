/**
 * Rate limits and the daily budget (server design 7, errors.md `rate_limited`, `daily_budget`; requirements R5.3).
 * They are counters, not states. Time is the clock the test passes.
 */
import { describe, expect, it } from 'vitest';
import { RateLimiter, STATUS } from '../../src/index';
import type { ServerError } from '../../src/index';
import { makeClock } from './helpers';

const isError = (x: { ok: true } | ServerError): x is ServerError => x.ok === false;
const errorOf = (x: { ok: true } | ServerError): ServerError => {
  if (!isError(x)) throw new Error('admitted');
  return x;
};

const limiter = (ratePerMinute: number, dailyModelCalls: number, now: () => number): RateLimiter => new RateLimiter({ ratePerMinute, dailyModelCalls }, now);

describe('requests a minute per client (RATE_PER_MINUTE)', () => {
  it('admits the first N and refuses the N+1th with rate_limited and the documented message', () => {
    const clock = makeClock();
    const l = limiter(3, 900, clock.now);
    for (let i = 0; i < 3; i++) expect(l.acquire('a').ok, `request ${i + 1}`).toBe(true);
    const e = errorOf(l.acquire('a'));
    expect(e.kind).toBe('rate_limited');
    expect(e.message).toMatch(/^Too many requests; try again in \d+ s\.$/);
    expect(typeof e.detail?.['retryAfterMs']).toBe('number');
    expect(STATUS.rate_limited).toBe(429);
  });

  it('detail.retryAfterMs is the time until a slot frees, and the message says it in whole seconds, rounded up', () => {
    const clock = makeClock();
    const l = limiter(2, 900, clock.now);
    l.acquire('a');
    clock.advance(20_000);
    l.acquire('a');
    clock.advance(5_000);
    const e = errorOf(l.acquire('a'));
    // the first request leaves the minute 60 s after it came: 35 s from now
    expect(e.detail?.['retryAfterMs']).toBe(35_000);
    expect(e.message).toBe('Too many requests; try again in 35 s.');
  });

  it('a partial second is rounded up, and the wait is at least 1 s', () => {
    const clock = makeClock();
    const l = limiter(1, 900, clock.now);
    l.acquire('a');
    clock.advance(59_500);
    const e = errorOf(l.acquire('a'));
    expect(e.message).toBe('Too many requests; try again in 1 s.');
    expect(Number(e.detail?.['retryAfterMs'])).toBeGreaterThan(0);
  });

  it('waiting the retryAfterMs is enough', () => {
    const clock = makeClock();
    const l = limiter(2, 900, clock.now);
    l.acquire('a');
    l.acquire('a');
    const e = errorOf(l.acquire('a'));
    clock.advance(Number(e.detail?.['retryAfterMs']));
    expect(l.acquire('a').ok).toBe(true);
  });

  it('the minute slides: a request leaves the count 60 s after it came', () => {
    const clock = makeClock();
    const l = limiter(2, 900, clock.now);
    l.acquire('a');
    clock.advance(30_000);
    l.acquire('a');
    clock.advance(29_000);
    expect(isError(l.acquire('a'))).toBe(true);
    clock.advance(1_001);
    expect(l.acquire('a').ok).toBe(true);
    expect(isError(l.acquire('a'))).toBe(true);
  });

  it('every client has its own minute', () => {
    const clock = makeClock();
    const l = limiter(1, 900, clock.now);
    expect(l.acquire('a').ok).toBe(true);
    expect(l.acquire('b').ok).toBe(true);
    expect(isError(l.acquire('a'))).toBe(true);
    expect(isError(l.acquire('b'))).toBe(true);
  });

  it('a refused request does not count against the minute', () => {
    const clock = makeClock();
    const l = limiter(1, 900, clock.now);
    l.acquire('a');
    for (let i = 0; i < 10; i++) l.acquire('a');
    clock.advance(60_001);
    expect(l.acquire('a').ok).toBe(true);
  });

  it('a sentence of speech counts one tenth of a model request (server design 6)', () => {
    const clock = makeClock();
    const l = limiter(2, 900, clock.now);
    for (let i = 0; i < 10; i++) expect(l.acquire('a', { weight: 0.1 }).ok, `sentence ${i + 1}`).toBe(true);
    expect(l.acquire('a').ok).toBe(true);
    expect(isError(l.acquire('a'))).toBe(true);
    expect(isError(l.acquire('a', { weight: 0.1 }))).toBe(true);
  });

  it('the default rate is 20 a minute', () => {
    const clock = makeClock();
    const l = limiter(20, 900, clock.now);
    for (let i = 0; i < 20; i++) expect(l.acquire('a').ok).toBe(true);
    expect(isError(l.acquire('a'))).toBe(true);
  });
});

describe('one model request at a time per client; a newer one aborts the older (design 7, R5.3)', () => {
  it('a second exclusive request aborts the first one\'s controller', () => {
    const l = limiter(20, 900, makeClock().now);
    const first = new AbortController();
    const second = new AbortController();
    expect(l.acquire('a', { exclusive: true, controller: first }).ok).toBe(true);
    expect(first.signal.aborted).toBe(false);
    expect(l.acquire('a', { exclusive: true, controller: second }).ok).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it('another client\'s request is not aborted', () => {
    const l = limiter(20, 900, makeClock().now);
    const mine = new AbortController();
    l.acquire('a', { exclusive: true, controller: mine });
    l.acquire('b', { exclusive: true, controller: new AbortController() });
    expect(mine.signal.aborted).toBe(false);
  });

  it('a request that was released is not aborted by the next one', () => {
    const l = limiter(20, 900, makeClock().now);
    const first = new AbortController();
    const adm = l.acquire('a', { exclusive: true, controller: first });
    if (isError(adm)) throw new Error('refused');
    adm.release();
    l.acquire('a', { exclusive: true, controller: new AbortController() });
    expect(first.signal.aborted).toBe(false);
  });

  it('release is safe to call more than once and does not free a newer request\'s slot', () => {
    const l = limiter(20, 900, makeClock().now);
    const first = new AbortController();
    const second = new AbortController();
    const a1 = l.acquire('a', { exclusive: true, controller: first });
    l.acquire('a', { exclusive: true, controller: second });
    if (isError(a1)) throw new Error('refused');
    a1.release();
    a1.release();
    const third = new AbortController();
    l.acquire('a', { exclusive: true, controller: third });
    expect(second.signal.aborted).toBe(true);
  });

  it('a request that is refused by the minute aborts nobody', () => {
    const l = limiter(1, 900, makeClock().now);
    const first = new AbortController();
    l.acquire('a', { exclusive: true, controller: first });
    expect(isError(l.acquire('a', { exclusive: true, controller: new AbortController() }))).toBe(true);
    expect(first.signal.aborted).toBe(false);
  });
});

describe('model calls a day, UTC (DAILY_MODEL_CALLS)', () => {
  it('the call after the last one is daily_budget with the documented message and HTTP 429', () => {
    const clock = makeClock();
    const l = limiter(20, 3, clock.now);
    for (let i = 0; i < 3; i++) expect(l.takeModelCall().ok).toBe(true);
    const e = errorOf(l.takeModelCall());
    expect(e.kind).toBe('daily_budget');
    expect(e.message).toBe('The AI has done its work for today.');
    expect(STATUS.daily_budget).toBe(429);
  });

  it('it is for the whole server, not per client', () => {
    const l = limiter(20, 2, makeClock().now);
    l.acquire('a');
    l.takeModelCall();
    l.acquire('b');
    l.takeModelCall();
    expect(isError(l.takeModelCall())).toBe(true);
  });

  it('it starts again at UTC midnight', () => {
    const clock = makeClock(Date.UTC(2026, 10, 22, 23, 59, 0));
    const l = limiter(20, 2, clock.now);
    l.takeModelCall();
    l.takeModelCall();
    expect(isError(l.takeModelCall())).toBe(true);
    clock.set(Date.UTC(2026, 10, 22, 23, 59, 59, 999));
    expect(isError(l.takeModelCall())).toBe(true);
    clock.set(Date.UTC(2026, 10, 23, 0, 0, 0, 0));
    expect(l.takeModelCall().ok).toBe(true);
    expect(l.takeModelCall().ok).toBe(true);
    expect(isError(l.takeModelCall())).toBe(true);
  });

  it('the wait it reports reaches the next UTC midnight', () => {
    const clock = makeClock(Date.UTC(2026, 10, 22, 22, 0, 0));
    const l = limiter(20, 1, clock.now);
    l.takeModelCall();
    const e = errorOf(l.takeModelCall());
    const wait = e.detail?.['retryAfterMs'];
    if (typeof wait === 'number') expect(wait).toBe(2 * 3_600_000);
  });

  it('a refused call does not use the budget of the next day', () => {
    const clock = makeClock();
    const l = limiter(20, 1, clock.now);
    l.takeModelCall();
    for (let i = 0; i < 5; i++) l.takeModelCall();
    clock.advance(24 * 3_600_000);
    expect(l.takeModelCall().ok).toBe(true);
    expect(isError(l.takeModelCall())).toBe(true);
  });

  it('callsToday counts the calls of the UTC day', () => {
    const clock = makeClock();
    const l = limiter(20, 900, clock.now);
    expect(l.callsToday).toBe(0);
    l.takeModelCall();
    l.takeModelCall();
    expect(l.callsToday).toBe(2);
    clock.advance(24 * 3_600_000);
    expect(l.callsToday).toBe(0);
  });

  it('the minute limit and the day limit are separate counters', () => {
    const clock = makeClock();
    const l = limiter(1, 1, clock.now);
    l.acquire('a');
    expect(isError(l.acquire('a'))).toBe(true);
    expect(l.takeModelCall().ok).toBe(true);
    expect(isError(l.takeModelCall())).toBe(true);
    expect(l.acquire('b').ok).toBe(true);
  });

  it('time comes only from the clock passed in: a frozen clock never frees a minute or a day', () => {
    const l = limiter(1, 1, () => 5_000_000_000);
    l.acquire('a');
    l.takeModelCall();
    expect(isError(l.acquire('a'))).toBe(true);
    expect(isError(l.takeModelCall())).toBe(true);
  });
});

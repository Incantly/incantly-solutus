import { describe, expect, it } from 'vitest';
import { cleanSignal, Telemetry, type ProductSignal } from '../src/client/telemetry';

describe('film telemetry signals', () => {
  const ALL: ProductSignal[] = [
    { type: 'film-start', filmId: 'pendulum', version: 2, length: 30 },
    { type: 'film-complete', filmId: 'pendulum', ms: 31_200.4, beats: 6, version: 2 },
    { type: 'film-scrub', filmId: 'pendulum', from: 's1b1', to: 's1b4' },
    { type: 'film-ask', filmId: 'pendulum', beat: 's1b3', rung: 'show-me', count: 2 },
    { type: 'film-insert', filmId: 'pendulum', beat: 's1b3', lines: 2 },
    { type: 'film-resume', filmId: 'pendulum', beat: 's1b2', word: 4 },
    { type: 'film-export', filmId: 'pendulum', kind: 'video', ms: 9000 },
    { type: 'film-scene', filmId: 'pendulum', scene: 's1', ms: 1800 },
  ];

  it('passes every film signal with its ids, counts and timings', () => {
    for (const signal of ALL) expect(cleanSignal(signal), signal.type).toEqual(signal.type === 'film-complete' ? { ...signal, ms: 31_200 } : signal);
  });

  it('refuses note, question and prompt content: free text never fits a token', () => {
    expect(cleanSignal({ type: 'film-ask', filmId: 'pendulum', beat: 's1b3', rung: 'answer', count: 1, question: 'Why is it fast?' })).toEqual({
      type: 'film-ask',
      filmId: 'pendulum',
      beat: 's1b3',
      rung: 'answer',
      count: 1,
    });
    expect(cleanSignal({ type: 'film-start', filmId: 'Show me a film about pendulums' })).toBeNull();
    expect(cleanSignal({ type: 'film-ask', filmId: 'pendulum', beat: 'why does it swing', rung: 'answer', count: 1 })).toBeNull();
    expect(cleanSignal({ type: 'film-scrub', filmId: 'pendulum', from: 's1b1', to: 'the fast part' })).toBeNull();
    expect(cleanSignal({ type: 'film-export', filmId: 'f', kind: 'my own video please', ms: 1 })).toBeNull();
  });

  it('rejects oversized and out-of-range fields', () => {
    expect(cleanSignal({ type: 'film-start', filmId: 'f'.repeat(65) })).toBeNull();
    expect(cleanSignal({ type: 'film-complete', filmId: 'f', ms: 1000, beats: 10_001 })).toBeNull();
    expect(cleanSignal({ type: 'film-complete', filmId: 'f', ms: -5, beats: 2 })).toBeNull();
    expect(cleanSignal({ type: 'film-ask', filmId: 'f', beat: 's1b1', rung: 'answer', count: 1.5 })).toBeNull();
    expect(cleanSignal({ type: 'film-ask', filmId: 'f', beat: 's1b1', rung: 'phone-a-friend', count: 1 })).toBeNull();
  });

  it('drops what does not fit and counts it, never sending it', async () => {
    const batches: unknown[][] = [];
    const telemetry = new Telemetry({ sink: (events) => void batches.push([...events]), session: 's-test', now: () => 1000 });
    telemetry.emit({ type: 'film-ask', filmId: 'pendulum', beat: 's1b3', rung: 'answer', count: 1 });
    telemetry.emit({ type: 'film-start', filmId: 'Show me a film about pendulums' });
    expect(telemetry.dropped).toBe(1);
    await telemetry.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([{ type: 'film-ask', filmId: 'pendulum', beat: 's1b3', rung: 'answer', count: 1, at: 1000, session: 's-test' }]);
  });
});

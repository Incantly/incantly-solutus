import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { benchRound, callKey, type BenchReply, type PendingCall } from '../src/bench';
import { LAUNCH_REQUESTS } from '../src/launch';

const requests = LAUNCH_REQUESTS.filter((r) => r.id === 'projectile-1' || r.id === 'ohm-1');

/** Stands in for the subagents: plans and scenes from the reviewed examples, edits when adapting. */
function answer(call: PendingCall, ms: number): BenchReply {
  const id = call.key.split('|')[0]!;
  const scene = REFERENCE_SCENES[requests.find((r) => r.id === id)!.example!]!;
  if (call.purpose === 'plan') return { key: call.key, ms, text: `\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`` };
  if (call.prompt.includes('EDIT format')) return { key: call.key, ms, text: '```edit js\n```' };
  return { key: call.key, ms, text: ['html', 'css', 'js'].map((f) => `\`\`\`${f}\n${scene[f as 'html' | 'css' | 'js']}\n\`\`\``).join('\n') };
}

async function run(ms: (call: PendingCall) => number) {
  const replies: BenchReply[] = [];
  const rounds: PendingCall[][] = [];
  for (let i = 0; i < 5; i++) {
    const round = await benchRound(requests, ['library', 'novel'], replies);
    if (round.pending.length === 0) return { results: round.results, rounds };
    rounds.push([...round.pending]);
    replies.push(...round.pending.map((p) => answer(p, ms(p))));
  }
  throw new Error('The bench did not finish');
}

describe('the agent bench', () => {
  it('runs the real pipeline in rounds, asking once for each plan, and times what a learner waits for', async () => {
    const { results, rounds } = await run((call) => (call.purpose === 'plan' ? 3000 : 9000));
    // Round 1: the two plans, shared by both conditions. Round 2: four scenes. Then nothing.
    expect(rounds.map((r) => r.map((p) => p.purpose).sort())).toEqual([['plan', 'plan'], ['scene', 'scene', 'scene', 'scene']]);
    expect(rounds[0]!.map((p) => p.key).sort()).toEqual([callKey('ohm-1', 'library', 'plan', 0), callKey('projectile-1', 'library', 'plan', 0)]);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.pending, r.id).toBe(false);
      expect(r.passed, `${r.id} ${r.condition}: ${r.failureReason}`).toBe(true);
      expect(r.mode).toBe(r.condition === 'library' ? 'adapt' : 'write');
      expect(r.timings.planMs).toBeGreaterThanOrEqual(3000);
      expect(r.timings.sceneMs).toBeGreaterThanOrEqual(9000);
      expect(r.timings.totalMs).toBeGreaterThanOrEqual(12_000);
      expect(r.timings.totalMs).toBeLessThan(25_000);
    }
    // Withheld, the concept's own scene is not the example.
    expect(results.find((r) => r.condition === 'novel' && r.id === 'ohm-1')!.example).not.toBe('ohm');
  });

  it('cuts a call off at the deadline, as the service would', async () => {
    const { results } = await run((call) => (call.purpose === 'plan' ? 4000 : 24_000));
    for (const r of results) {
      expect(r.passed).toBe(false);
      expect(r.failureReason).toMatch(/timeout: The scene call would have run past the deadline/);
      // Cut off with time left to deliver a fallback.
      expect(r.timings.totalMs).toBeLessThanOrEqual(24_000);
    }
  });
});

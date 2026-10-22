import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { benchRound, callKey, replyMs, type BenchReply, type PendingCall } from '../src/bench';
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
    // Round 1: the two plans, shared by both conditions, and the two library builds that start beside them.
    // Round 2: the two scenes written whole for the novel condition. Then nothing.
    expect(rounds.map((r) => r.map((p) => p.purpose).sort())).toEqual([['plan', 'plan', 'scene', 'scene'], ['scene', 'scene']]);
    expect(rounds[0]!.filter((p) => p.purpose === 'plan').map((p) => p.key).sort()).toEqual([callKey('ohm-1', 'library', 'plan', 0), callKey('projectile-1', 'library', 'plan', 0)]);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.pending, r.id).toBe(false);
      expect(r.passed, `${r.id} ${r.condition}: ${r.failureReason}`).toBe(true);
      expect(r.mode).toBe(r.condition === 'library' ? 'adapt' : 'write');
      expect(r.retrieved).toBe(r.condition === 'library' ? r.id.replace(/-\d$/, '') : null);
      expect(r.timings.planMs).toBeGreaterThanOrEqual(3000);
      // The scene's own time, whether or not a plan ran beside it.
      expect(r.timings.sceneMs).toBeGreaterThanOrEqual(9000);
      expect(r.timings.sceneMs).toBeLessThan(10_000);
      // Library builds run beside their plan call: the learner waits for the longer of the two.
      expect(r.timings.totalMs).toBeGreaterThanOrEqual(r.condition === 'library' ? 9000 : 12_000);
      expect(r.timings.totalMs).toBeLessThan(r.condition === 'library' ? 10_000 : 25_000);
    }
    // Withheld, the concept's own scene is not the example.
    expect(results.find((r) => r.condition === 'novel' && r.id === 'ohm-1')!.example).not.toBe('ohm');
  });

  it('counts a reply that began by thinking from a first token, as the service calls models with thinking off', () => {
    const thought: BenchReply = { key: 'k', text: 'x', ms: 9000, thinkMs: 6000, model: 'claude-sonnet-5-5' };
    expect(replyMs(thought, 'raw')).toBe(9000);
    // Without a measured first token, only the time to write the reply.
    expect(replyMs(thought, 'text')).toBe(3000);
    // With one, that time and the writing.
    expect(replyMs(thought, 'text', { 'claude-sonnet-5-5': 1500 })).toBe(4500);
    // Never more than the reply took.
    expect(replyMs({ ...thought, thinkMs: 500 }, 'text', { 'claude-sonnet-5-5': 1500 })).toBe(9000);
    // A reply that did not think counts as it was measured.
    expect(replyMs({ ...thought, thinkMs: undefined }, 'text', { 'claude-sonnet-5-5': 1500 })).toBe(9000);
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

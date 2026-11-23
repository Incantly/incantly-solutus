/**
 * The round-5 tables (docs/state-machines.md, "Round 5", B31 to B35): every row of every `*_MACHINE` table is exact, every
 * move the document does not list has no row, and the running code refuses the moves with no row without changing state
 * and without a report (a report means a bug: the code asks first).
 * B31 agent runner (`RUNNER_MACHINE`), B32 agent job (`JOB_MACHINE`), B33 circle to ask (`CIRCLE_MACHINE`), B34 hand animation
 * (`ANIMATION_MACHINE`), B35 agent panel (`PANEL_MACHINE`). B12 `askHeld` is in machines-round2.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  ANIMATION_MACHINE, AgentJob, BoardAgent, BoardCore, CIRCLE_MACHINE, HandAnimation, JOB_MACHINE, PANEL_MACHINE, RUNNER_MACHINE, TOOLS_MACHINE,
} from '../../src/index';
import type { BoardError, HandPlan, HandPlayer } from '../../src/index';
import { makeAgentRig, circleAround, must, scripted, tick, gate } from './agent-helpers';
import { walk } from './ink-helpers';
import type { Row } from './ink-helpers';

// B31 agent runner
walk('B31 RUNNER_MACHINE', RUNNER_MACHINE, ['idle', 'running', 'stopping'], ['run', 'done', 'stop'], [
  ['idle', 'run', 'running'],
  ['running', 'done', 'idle'],
  ['running', 'stop', 'stopping'],
  ['stopping', 'done', 'idle'],
]);

// B32 agent job
type JobState = 'ready' | 'waiting' | 'working' | 'done' | 'stopped' | 'failed' | 'replaced';
type JobEvent = 'start' | 'actions' | 'done' | 'stop' | 'fail' | 'replace';
const JOB_ROWS: readonly Row<JobState, JobEvent>[] = [
  ['ready', 'start', 'waiting'],
  ['waiting', 'actions', 'working'],
  ['waiting', 'done', 'done'],
  ['working', 'actions', 'working'],
  ['working', 'done', 'done'],
  ...(['waiting', 'working'] as const).flatMap((from): Row<JobState, JobEvent>[] => [
    [from, 'stop', 'stopped'],
    [from, 'fail', 'failed'],
    [from, 'replace', 'replaced'],
  ]),
];
walk('B32 JOB_MACHINE', JOB_MACHINE, ['ready', 'waiting', 'working', 'done', 'stopped', 'failed', 'replaced'], ['start', 'actions', 'done', 'stop', 'fail', 'replace'], JOB_ROWS);

// B33 circle to ask
type CircleState = 'idle' | 'drawing' | 'choosing' | 'asking';
type CircleEvent = 'down' | 'move' | 'up' | 'cancel' | 'pick' | 'dismiss' | 'finish';
const CIRCLE_ROWS: readonly Row<CircleState, CircleEvent>[] = [
  ['idle', 'down', 'drawing'],
  ['drawing', 'move', 'drawing'],
  ['drawing', 'up', 'choosing'],
  ['drawing', 'cancel', 'idle'],
  ['choosing', 'pick', 'asking'],
  ['choosing', 'down', 'drawing'],
  ['choosing', 'dismiss', 'idle'],
  ['asking', 'finish', 'idle'],
  ['asking', 'down', 'drawing'],
  ['asking', 'dismiss', 'idle'],
];
walk('B33 CIRCLE_MACHINE', CIRCLE_MACHINE, ['idle', 'drawing', 'choosing', 'asking'], ['down', 'move', 'up', 'cancel', 'pick', 'dismiss', 'finish'], CIRCLE_ROWS);

// B34 hand animation
walk('B34 ANIMATION_MACHINE', ANIMATION_MACHINE, ['idle', 'playing', 'landing'], ['begin', 'step', 'finish', 'cancel', 'settle'], [
  ['idle', 'begin', 'playing'],
  ['playing', 'step', 'playing'],
  ['playing', 'finish', 'landing'],
  ['playing', 'cancel', 'landing'],
  ['landing', 'settle', 'idle'],
]);

// B35 agent panel
walk('B35 PANEL_MACHINE', PANEL_MACHINE, ['closed', 'open', 'busy'], ['open', 'close', 'begin', 'end'], [
  ['closed', 'open', 'open'],
  ['closed', 'begin', 'busy'],
  ['closed', 'end', 'closed'],
  ['open', 'close', 'closed'],
  ['open', 'begin', 'busy'],
  ['busy', 'end', 'open'],
  ['busy', 'close', 'closed'],
]);

// B12 as round 5 appended it: the table of the document, read from the exported machine
describe('B12 TOOLS_MACHINE (round 5 rows)', () => {
  it('chosen --askDown--> askHeld and askHeld --askUp--> chosen', () => {
    expect((TOOLS_MACHINE['chosen'] as Record<string, string>)['askDown']).toBe('askHeld');
    expect((TOOLS_MACHINE['askHeld'] as Record<string, string>)['askUp']).toBe('chosen');
  });

  it('askDown in eraserEnd and handHeld has no row, and nothing starts in askHeld but askUp', () => {
    expect((TOOLS_MACHINE['eraserEnd'] as Record<string, string>)['askDown']).toBeUndefined();
    expect((TOOLS_MACHINE['handHeld'] as Record<string, string>)['askDown']).toBeUndefined();
    expect(Object.keys(TOOLS_MACHINE['askHeld'] as object)).toEqual(['askUp']);
  });
});

describe('the running code refuses the moves with no row, and reports nothing (the code asks first)', () => {
  const sinkOf = (): { errors: BoardError[]; sink: (e: BoardError) => void } => {
    const errors: BoardError[] = [];
    return { errors, sink: (e) => errors.push(e) };
  };

  it('B31: stop when idle changes nothing; a call that arrives while one runs waits for it', async () => {
    const rig = makeAgentRig();
    const runner = rig.board.agent.runner;
    expect(runner.state).toBe('idle');
    runner.stop();
    expect(runner.state).toBe('idle');
    const first = runner.run({ actions: [{ op: 'shape', kind: 'rect', at: { x: 10, y: 10 } }] });
    const second = runner.run({ actions: [{ op: 'shape', kind: 'ellipse', at: { x: 300, y: 10 } }] });
    must(await first);
    must(await second);
    expect(runner.state).toBe('idle');
    expect(rig.errors).toEqual([]);
    expect(rig.board.core.store.shapesOn(rig.page).map((s) => s.kind)).toEqual(['rect', 'ellipse']);
  });

  it('B31: running goes to stopping on stop, then to idle; a second stop while stopping is refused quietly', async () => {
    const core = must(BoardCore.create());
    let release: (n: number) => void = () => undefined;
    const hand: HandPlayer = {
      play: () => new Promise<number>((resolve) => {
        release = resolve;
      }),
      cancel: () => release(0.6),
    };
    const agent = new BoardAgent(core, { hand });
    const call = agent.run({ actions: [{ op: 'stroke', points: [[0, 0], [100, 0], [200, 50], [300, 0]], at: { x: 10, y: 10 } }] });
    await tick();
    expect(agent.state).toBe('running');
    agent.stop();
    expect(agent.state).toBe('stopping');
    agent.stop();
    must(await call);
    expect(agent.state).toBe('idle');
  });

  it('B32: every event of a final job is refused; the state does not change and nothing is reported', () => {
    const { errors, sink } = sinkOf();
    const job = new AgentJob({ kind: 'talk', text: 'x', items: [], more: 0, page: 'page:1', allowEdit: false }, () => sink);
    expect(job.state).toBe('ready');
    expect(job.gotActions()).toBe(false);
    expect(job.finish()).toBe(false);
    expect(job.state).toBe('ready');
    expect(job.start()).toBe(true);
    expect(job.start()).toBe(false);
    expect(job.state).toBe('waiting');
    expect(job.gotActions()).toBe(true);
    expect(job.state).toBe('working');
    expect(job.stop()).toBe(true);
    expect(job.controller.signal.aborted).toBe(true);
    for (const move of [() => job.gotActions(), () => job.finish(), () => job.stop(), () => job.fail('x', 'late'), () => job.replace(), () => job.start()]) expect(move()).toBe(false);
    expect(job.state).toBe('stopped');
    expect(errors).toEqual([]);
  });

  it.each([
    ['finish', (j: AgentJob) => j.finish(), 'done'],
    ['fail', (j: AgentJob) => j.fail('server', 'boom'), 'failed'],
    ['replace', (j: AgentJob) => j.replace(), 'replaced'],
  ] as const)('B32: a job that was %s takes no more events', (_name, end, state) => {
    const job = new AgentJob({ kind: 'talk', text: 'x', items: [], more: 0, page: 'page:1', allowEdit: false });
    job.start();
    expect(end(job)).toBe(true);
    expect(job.state).toBe(state);
    expect(job.gotActions()).toBe(false);
    expect(job.stop()).toBe(false);
    expect(job.state).toBe(state);
  });

  it('B32: a late event of an aborted stream is dropped (the answer after Stop is not applied)', async () => {
    const hold = gate();
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* () {
        await hold.wait;
        yield { actions: [{ op: 'shape', kind: 'rect', at: { x: 10, y: 10 } }] };
        yield { done: true as const };
      },
    });
    const pending = rig.board.agent.service.talk('go');
    await tick(5);
    rig.board.agent.service.stop();
    hold.open();
    await pending;
    expect(rig.board.core.store.shapesOn(rig.page)).toEqual([]);
    expect(rig.errors.filter((e) => e.kind === 'internal')).toEqual([]);
  });

  it('B33: up and move with no loop, a pick with no loop, and finish are refused, and nothing is reported', async () => {
    const rig = makeAgentRig({ reducedMotion: true, transport: scripted([[{ done: true }]]).transport });
    const c = rig.board.agent.circle;
    c.move(5, 5);
    c.up();
    c.cancel();
    c.dismiss();
    expect(c.state).toBe('idle');
    const picked = await c.pick('explain');
    expect(picked.ok).toBe(false);
    expect(c.state).toBe('idle');
    expect(rig.errors.filter((e) => e.kind === 'internal')).toEqual([]);
  });

  it('B33: up and move while choosing do nothing; a second pick while asking is refused', async () => {
    const hold = gate();
    const rig = makeAgentRig({
      reducedMotion: true,
      transport: async function* () {
        await hold.wait;
        yield { done: true as const };
      },
    });
    circleAround(rig, [0, 0, 300, 300]);
    const c = rig.board.agent.circle;
    expect(c.state).toBe('choosing');
    const before = c.found;
    c.move(900, 900);
    c.up();
    expect(c.state).toBe('choosing');
    expect(c.found).toBe(before);
    const first = c.pick('explain');
    expect(c.state).toBe('asking');
    const second = await c.pick('graph');
    expect(second.ok).toBe(false);
    expect(c.state).toBe('asking');
    hold.open();
    must(await first);
    expect(c.state).toBe('idle');
    expect(rig.errors.filter((e) => e.kind === 'internal')).toEqual([]);
  });

  it('B33: a new loop while choosing or asking begins again from the new point', async () => {
    const rig = makeAgentRig({ reducedMotion: true, transport: scripted([[{ done: true }]]).transport });
    circleAround(rig, [0, 0, 300, 300]);
    const c = rig.board.agent.circle;
    expect(c.down(500, 500)).toBe(true);
    expect(c.state).toBe('drawing');
    expect(c.suggestions).toEqual([]);
    expect(c.found.items).toEqual([]);
    expect(c.down(10, 10)).toBe(false);
    c.cancel();
    expect(c.state).toBe('idle');
  });

  it('B34: begin while playing, step in idle and landing, cancel in idle, settle while playing are refused', () => {
    const { errors, sink } = sinkOf();
    const core = must(BoardCore.create());
    const anim = new HandAnimation(core.store.kinds, sink);
    let plan: HandPlan | undefined;
    const hand: HandPlayer = {
      play: (p) => {
        plan = p;
        return Promise.resolve(1);
      },
      cancel: () => undefined,
    };
    void new BoardAgent(core, { hand }).run({ actions: [{ op: 'write', text: 'hello world', at: { x: 10, y: 10 }, style: 'hand' }] });
    return tick().then(() => {
      expect(plan).toBeDefined();
      expect(anim.step(0)).toBeUndefined();
      expect(anim.cancel()).toBe(0);
      expect(anim.state).toBe('idle');
      anim.settle();
      expect(anim.state).toBe('idle');
      expect(anim.begin(plan as HandPlan)).toBe(true);
      expect(anim.begin(plan as HandPlan)).toBe(false);
      anim.settle();
      expect(anim.state).toBe('playing');
      anim.step(0);
      anim.step(10_000);
      expect(anim.state).toBe('landing');
      expect(anim.step(20_000)).toBeUndefined();
      expect(anim.begin(plan as HandPlan)).toBe(false);
      expect(anim.state).toBe('landing');
      anim.settle();
      expect(anim.state).toBe('idle');
      expect(errors).toEqual([]);
    });
  });
});

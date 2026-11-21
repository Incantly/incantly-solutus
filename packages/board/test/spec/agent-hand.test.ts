/**
 * Hand-style `write` and `stroke` (agent.md 2; design 11.4; state-machines B34): they animate on the live layer at about
 * 400 characters a second (a stroke counts one for every 4 page units, never over 3 seconds), are stored as stated, appear
 * at once with reduced motion, and a Stop partway keeps what was drawn. A fake `HandPlayer` stands for the live layer.
 */
import { describe, expect, it } from 'vitest';
import {
  BoardAgent, BoardCore, HAND_CPS, HAND_MAX_MS, HandAnimation, STROKE_UNITS_PER_CHAR, WebHand, partOf, planLength, planMs,
} from '../../src/index';
import type { ActionResult, HandPlan, HandPlayer, ShapeRecord } from '../../src/index';
import { must, tick, verdict } from './agent-helpers';

/** A player that keeps the plans it was asked to play and ends each one when the test says. */
class FakePlayer implements HandPlayer {
  readonly plans: HandPlan[] = [];
  cancelled = 0;
  /** What `cancel` gives back as the progress reached. */
  reached = 0.5;
  #pending: ((progress: number) => void) | undefined;

  play(plan: HandPlan): Promise<number> {
    this.plans.push(plan);
    return new Promise((resolve) => {
      this.#pending = resolve;
    });
  }

  cancel(): void {
    this.cancelled++;
    this.#pending?.(this.reached);
    this.#pending = undefined;
  }

  /** The drawing is whole. */
  finish(): void {
    this.#pending?.(1);
    this.#pending = undefined;
  }
}

function boardWith(options: { hand?: HandPlayer; reducedMotion?: boolean } = {}): { core: BoardCore; agent: BoardAgent } {
  const core = must(BoardCore.create());
  const agent = new BoardAgent(core, { ...(options.hand !== undefined ? { hand: options.hand } : {}), reducedMotion: () => options.reducedMotion === true });
  return { core, agent };
}

const shapesOn = (core: BoardCore): readonly ShapeRecord[] => core.store.shapesOn(core.pages.current as string);

const writeHand = (text: string): unknown => ({ op: 'write', text, at: { x: 100, y: 100 }, style: 'hand' });
const strokeOf = (n: number): unknown => ({ op: 'stroke', points: Array.from({ length: n }, (_, i) => [i * 10, (i % 2) * 20]), at: { x: 200, y: 200 } });

describe('a hand-style action animates, then is stored (agent.md 2; design 11.4)', () => {
  it('write: the text is played as a text plan and is not in the store until it is drawn whole', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const call = agent.run({ actions: [writeHand('Hello there')] });
    await tick();
    expect(hand.plans).toHaveLength(1);
    expect(hand.plans[0]?.how).toBe('text');
    expect(shapesOn(core)).toHaveLength(0);
    hand.finish();
    const results = must(await call);
    expect(results.map(verdict)).toEqual(['ok']);
    const [stored] = shapesOn(core);
    expect(stored?.kind).toBe('text');
    expect(stored?.props).toMatchObject({ text: 'Hello there', font: 'hand' });
    expect(stored?.meta['madeBy']).toBe('model');
  });

  it('stroke: the stroke is played as a stroke plan and stored as ink', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const call = agent.run({ actions: [strokeOf(20)] });
    await tick();
    expect(hand.plans[0]?.how).toBe('stroke');
    expect(shapesOn(core)).toHaveLength(0);
    hand.finish();
    must(await call);
    expect(shapesOn(core).map((s) => s.kind)).toEqual(['ink']);
  });

  it('a typed write is not animated: it is stored at once', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    must(await agent.run({ actions: [{ op: 'write', text: 'typed', at: { x: 10, y: 10 }, style: 'typed' }] }));
    expect(hand.plans).toHaveLength(0);
    expect(shapesOn(core)).toHaveLength(1);
  });

  it('actions go one after the other: the second waits for the first to be drawn', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const call = agent.run({ actions: [writeHand('first'), writeHand('second')] });
    await tick();
    expect(hand.plans).toHaveLength(1);
    hand.finish();
    await tick();
    expect(hand.plans).toHaveLength(2);
    expect(shapesOn(core)).toHaveLength(1);
    hand.finish();
    must(await call);
    expect(shapesOn(core)).toHaveLength(2);
  });
});

describe('reduced motion (agent.md 2; ui.md Motion)', () => {
  it('a hand-style write and a stroke appear at once, and the live layer is not asked to draw them', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand, reducedMotion: true });
    const results = must(await agent.run({ actions: [writeHand('now'), strokeOf(30)] }));
    expect(results.map(verdict)).toEqual(['ok', 'ok']);
    expect(hand.plans).toHaveLength(0);
    expect(shapesOn(core).map((s) => s.kind).sort()).toEqual(['ink', 'text']);
  });
});

describe('Stop partway keeps what was made (agent.md 2; design 11.3)', () => {
  it('a stopped hand-style write is stored as far as it got', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const full = 'The quick brown fox jumps over the lazy dog';
    const call = agent.run({ actions: [writeHand(full)] });
    await tick();
    agent.stop();
    const results = must(await call);
    expect(hand.cancelled).toBeGreaterThan(0);
    // the action in hand was stopped partway: it is stored as far as it got, and it is reported as made or as partial
    expect(['ok', 'agent_partial']).toContain(verdict(results[0]));
    const [stored] = shapesOn(core);
    const text = (stored?.props as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(full.length);
    expect(full.startsWith(text)).toBe(true);
  });

  it('a stopped stroke is stored with the points it had drawn', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const call = agent.run({ actions: [strokeOf(40)] });
    await tick();
    const planProps = hand.plans[0]?.shape.props as { points: Float32Array; stride: number };
    const whole = planProps.points.length / planProps.stride;
    agent.stop();
    must(await call);
    const [stored] = shapesOn(core);
    expect(stored?.kind).toBe('ink');
    const props = stored?.props as { points: Float32Array; stride: number };
    const n = props.points.length / props.stride;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThan(whole);
  });

  it('the actions that were not run are reported agent_partial, and what was made before stays', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const call = agent.run({ actions: [{ op: 'shape', kind: 'rect', at: { x: 10, y: 10 } }, writeHand('abcdefghij'), { op: 'shape', kind: 'ellipse', at: { x: 400, y: 10 } }, writeHand('never')] });
    await tick();
    agent.stop();
    const results: readonly ActionResult[] = must(await call);
    expect(verdict(results[0])).toBe('ok');
    expect(['ok', 'agent_partial']).toContain(verdict(results[1]));
    expect(results.slice(2).map(verdict)).toEqual(['agent_partial', 'agent_partial']);
    expect(shapesOn(core).map((s) => s.kind).sort()).toEqual(['rect', 'text']);
  });

  it('what a stopped call made is one undo step the user can take back', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const steps = core.history.undoSteps;
    const call = agent.run({ actions: [{ op: 'shape', kind: 'rect', at: { x: 10, y: 10 } }, writeHand('abcdefghij')] });
    await tick();
    agent.stop();
    must(await call);
    expect(core.history.undoSteps).toBe(steps + 1);
    expect(core.history.undo().ok).toBe(true);
    expect(shapesOn(core)).toHaveLength(0);
  });

  it('a call that begins after a stop is not stopped by it', async () => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    agent.stop();
    const call = agent.run({ actions: [writeHand('again')] });
    await tick();
    hand.finish();
    const results = must(await call);
    expect(results.map(verdict)).toEqual(['ok']);
    expect(shapesOn(core)).toHaveLength(1);
  });
});

describe('the pace (design 11.4; B34): 400 characters a second, 1 for every 4 units of a stroke, 3 seconds at most', () => {
  /** Plays an action to the end and gives the plan the runner made. */
  const planOf = async (action: unknown): Promise<HandPlan> => {
    const hand = new FakePlayer();
    const { agent } = boardWith({ hand });
    const call = agent.run({ actions: [action] });
    await tick();
    hand.finish();
    must(await call);
    return hand.plans[0] as HandPlan;
  };

  it('the constants of the docs', () => {
    expect(HAND_CPS).toBe(400);
    expect(STROKE_UNITS_PER_CHAR).toBe(4);
    expect(HAND_MAX_MS).toBe(3000);
  });

  it('200 characters take 500 ms', async () => {
    const plan = await planOf(writeHand('x'.repeat(200)));
    expect(planLength(plan)).toBe(200);
    expect(planMs(plan)).toBeCloseTo(500, 5);
  });

  it('a stroke 800 units long counts as 200 characters and takes 500 ms', async () => {
    const plan = await planOf({ op: 'stroke', points: [[0, 0], [800, 0]], at: { x: 10, y: 10 } });
    expect(planLength(plan)).toBeGreaterThanOrEqual(199);
    expect(planLength(plan)).toBeLessThanOrEqual(201);
    expect(planMs(plan)).toBeGreaterThan(490);
    expect(planMs(plan)).toBeLessThan(510);
  });

  it('nothing takes longer than 3 seconds', async () => {
    const plan = await planOf(writeHand('x'.repeat(3000)));
    expect(planMs(plan)).toBe(3000);
  });
});

describe('HandAnimation: the frame time is given, there is no clock (B34)', () => {
  const textPlan = async (text: string): Promise<{ plan: HandPlan; core: BoardCore }> => {
    const hand = new FakePlayer();
    const { core, agent } = boardWith({ hand });
    const call = agent.run({ actions: [writeHand(text)] });
    await tick();
    hand.finish();
    must(await call);
    return { plan: hand.plans[0] as HandPlan, core };
  };

  it('progress follows the times of the frames, never goes back, and ends in landing, then idle', async () => {
    const { plan, core } = await textPlan('x'.repeat(400));
    const anim = new HandAnimation(core.store.kinds);
    expect(anim.state).toBe('idle');
    expect(anim.begin(plan)).toBe(true);
    expect(anim.state).toBe('playing');
    const f0 = anim.step(10_000);
    expect(f0?.progress).toBe(0);
    const f1 = anim.step(10_500);
    expect(f1?.progress).toBeCloseTo(0.5, 5);
    const back = anim.step(10_200);
    expect(back?.progress).toBeGreaterThanOrEqual(0.5);
    const end = anim.step(11_000);
    expect(end?.progress).toBe(1);
    expect(anim.state).toBe('landing');
    anim.settle();
    expect(anim.state).toBe('idle');
  });

  it('a second begin while one plays is refused; step in idle gives nothing', async () => {
    const { plan, core } = await textPlan('abc');
    const anim = new HandAnimation(core.store.kinds);
    expect(anim.step(0)).toBeUndefined();
    expect(anim.begin(plan)).toBe(true);
    expect(anim.begin(plan)).toBe(false);
    expect(anim.state).toBe('playing');
  });

  it('cancel gives the progress reached and goes to landing', async () => {
    const { plan, core } = await textPlan('x'.repeat(400));
    const anim = new HandAnimation(core.store.kinds);
    anim.begin(plan);
    anim.step(0);
    anim.step(250);
    expect(anim.cancel()).toBeCloseTo(0.25, 5);
    expect(anim.state).toBe('landing');
  });

  it('partOf shows the text up to the progress', async () => {
    const { plan } = await textPlan('abcdefghij');
    expect((partOf(plan, 0.5).props as { text: string }).text).toBe('abcde');
    expect((partOf(plan, 0).props as { text: string }).text).toBe('');
    expect((partOf(plan, 1).props as { text: string }).text).toBe('abcdefghij');
  });
});

describe('WebHand on the live layer: the frame loop is the clock (design 11.4)', () => {
  it('draws frames until the drawing is whole, then the runner stores it', async () => {
    const core = must(BoardCore.create());
    let frames = 0;
    const tips: { x: number; y: number }[] = [];
    const hand = new WebHand({ core, requestFrame: () => frames++, onTip: (at) => tips.push(at), onError: () => undefined });
    const agent = new BoardAgent(core, { hand });
    const call = agent.run({ actions: [writeHand('x'.repeat(400))] });
    await tick();
    expect(frames).toBeGreaterThan(0);
    const first = hand.frame(5000, 1);
    expect(first.more).toBe(true);
    expect(first.item).toBeDefined();
    expect(shapesOn(core)).toHaveLength(0);
    hand.frame(5500, 1);
    expect(hand.animation.progress).toBeCloseTo(0.5, 5);
    expect(shapesOn(core)).toHaveLength(0);
    hand.frame(6000, 1);
    must(await call);
    expect(shapesOn(core)).toHaveLength(1);
    expect(tips.length).toBeGreaterThanOrEqual(3);
    // the picture stays a frame or two so the stored shape never blinks, then it goes
    let guard = 0;
    while (hand.frame(6100 + guard * 16, 1).more && guard < 10) guard++;
    expect(guard).toBeLessThan(10);
    expect(hand.frame(7000, 1).item).toBeUndefined();
  });

  it('with nothing playing a frame has nothing to draw and asks for no more', () => {
    const core = must(BoardCore.create());
    const hand = new WebHand({ core, requestFrame: () => undefined, onTip: () => undefined, onError: () => undefined });
    const f = hand.frame(0, 1);
    expect(f.item).toBeUndefined();
    expect(f.more).toBe(false);
  });

  it('cancel ends the drawing at once with the progress reached', async () => {
    const core = must(BoardCore.create());
    const hand = new WebHand({ core, requestFrame: () => undefined, onTip: () => undefined, onError: () => undefined });
    const agent = new BoardAgent(core, { hand });
    const call = agent.run({ actions: [writeHand('x'.repeat(400))] });
    await tick();
    hand.frame(0, 1);
    hand.frame(500, 1);
    agent.stop();
    must(await call);
    const [stored] = shapesOn(core);
    const text = (stored?.props as { text: string }).text;
    expect(text.length).toBeGreaterThan(150);
    expect(text.length).toBeLessThan(250);
  });
});

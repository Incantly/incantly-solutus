import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ScenePlan } from '@incantly/core';
import { checkPlans, checkScene, planItems, readJson, type BenchRequest, type PlanItem, type PlanOutcome, type Reply, type SceneCheck } from '../bench';
import { LAUNCH_REQUESTS } from '../launch';

/**
 * The agent bench, stage by stage. Model calls happen outside: each stage
 * reads the replies (with their measured wall times) and writes what the next
 * stage sends.
 *
 *   node dist/bench.mjs plan-prompts --dir bench/run1
 *   node dist/bench.mjs check-plans --dir bench/run1 --replies plan-replies.json
 *   node dist/bench.mjs check-scenes --dir bench/run1 --replies scene-replies.json --tag sonnet
 *   node dist/bench.mjs check-repairs --dir bench/run1 --replies repair-replies.json --tag sonnet
 *   node dist/bench.mjs report --dir bench/run1 --tags sonnet,haiku
 */

const [command] = process.argv.slice(2);
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    dir: { type: 'string', default: 'bench' },
    replies: { type: 'string' },
    tag: { type: 'string', default: 'default' },
    tags: { type: 'string', default: 'default' },
    only: { type: 'string' },
    stage: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
  },
});

const say = (text: string) => process.stdout.write(`${text}\n`);
const dir = values.dir;
mkdirSync(dir, { recursive: true });
const path = (name: string) => join(dir, name);
const write = (name: string, data: unknown) => writeFileSync(path(name), `${JSON.stringify(data, null, 2)}\n`);

function requests(): BenchRequest[] {
  const only = values.only?.split(',');
  return LAUNCH_REQUESTS.filter((r) => !only || only.some((o) => r.id.startsWith(o)));
}

function replies(): Reply[] {
  if (!values.replies) throw new Error('--replies is required');
  return readJson<Reply[]>(path(values.replies));
}

interface SceneRecord {
  readonly id: string;
  readonly reply: Reply;
  readonly check: SceneCheck;
}

switch (command) {
  case 'plan-prompts': {
    const items = planItems(requests());
    write('plan-prompts.json', items);
    say(`${items.length} plan prompts, ${Math.round(items.reduce((n, i) => n + i.prompt.length, 0) / items.length)} characters each on average`);
    break;
  }
  case 'check-plans': {
    const items = readJson<PlanItem[]>(path('plan-prompts.json'));
    const outcomes = checkPlans(items, replies());
    write('plan-check.json', outcomes);
    const passed = outcomes.filter((o) => o.plan).length;
    say(`${passed}/${outcomes.length} plans passed`);
    for (const o of outcomes.filter((o) => !o.plan)) say(`  ${o.id}: ${o.problems.map((p) => `${p.rule} (${p.path})`).join(', ')}`);
    break;
  }
  case 'check-scenes':
  case 'check-repairs': {
    const plans = new Map(readJson<PlanOutcome[]>(path('plan-check.json')).map((o) => [o.id, o.plan] as const));
    const previous =
      command === 'check-repairs' ? new Map(readJson<SceneRecord[]>(path(`scene-check-${values.tag}.json`)).map((r) => [r.id, r.check.fragments] as const)) : null;
    const records: SceneRecord[] = [];
    for (const reply of replies()) {
      const plan = plans.get(reply.id) as ScenePlan | null | undefined;
      if (!plan) throw new Error(`No validated plan for ${reply.id}`);
      const check = await checkScene(reply.id, plan, reply.text, previous?.get(reply.id), reply.model ?? values.tag);
      records.push({ id: reply.id, reply, check });
      const status = check.passed ? 'pass' : `FAIL ${check.failed}: ${check.report?.summary ?? ''}`;
      say(`${reply.id.padEnd(28)} ${String(check.jsLines).padStart(4)} lines ${status}`);
    }
    write(`${command === 'check-scenes' ? 'scene' : 'repair'}-check-${values.tag}.json`, records);
    say(`${records.filter((r) => r.check.passed).length}/${records.length} passed`);
    break;
  }
  case 'workflow': {
    // A workflow script that sends each prompt of a stage to a subagent and returns nothing but counts;
    // the replies are read back from the run's journal, so they never pass through the caller's context.
    const stage = values.stage ?? 'plan';
    const model = values.model ?? 'haiku';
    const effort = values.effort ?? 'low';
    let prompts: Array<{ id: string; prompt: string }>;
    if (stage === 'calibrate') {
      // The fixed cost of one subagent call: a reply of one word, for subtracting from the measured times.
      prompts = [1, 2, 3, 4, 5].map((n) => ({ id: `calibrate-${n}`, prompt: 'Do not use any tools. Reply with the single word OK.' }));
    } else if (stage === 'plan') prompts = readJson<PlanItem[]>(path('plan-prompts.json')).map((i) => ({ id: i.id, prompt: i.prompt }));
    else if (stage === 'replan') prompts = readJson<PlanOutcome[]>(path('plan-check.json')).filter((o) => o.replan).map((o) => ({ id: o.id, prompt: o.replan! }));
    else if (stage === 'scene') prompts = readJson<PlanOutcome[]>(path('plan-check.json')).filter((o) => o.scene).map((o) => ({ id: o.id, prompt: o.scene! }));
    else if (stage === 'repair') prompts = readJson<SceneRecord[]>(path(`scene-check-${values.tag}.json`)).filter((r) => r.check.repair).map((r) => ({ id: r.id, prompt: r.check.repair! }));
    else throw new Error(`Unknown stage ${stage}`);
    const only = values.only?.split(',');
    if (only) prompts = prompts.filter((p) => only.some((o) => p.id.startsWith(o)));
    const name = `bench-${stage}-${values.tag}`;
    // Prompts share most of their text (rules, contract, examples): each paragraph is stored once.
    const chunks: string[] = [];
    const index = new Map<string, number>();
    const items = prompts.map((p) => ({
      id: p.id,
      parts: p.prompt.split('\n\n').map((chunk) => {
        let i = index.get(chunk);
        if (i === undefined) {
          i = chunks.push(chunk) - 1;
          index.set(chunk, i);
        }
        return i;
      }),
    }));
    const script = [
      'export const meta = {',
      `  name: ${JSON.stringify(name)},`,
      `  description: ${JSON.stringify(`Latency bench: ${prompts.length} ${stage} prompts on ${model} (effort ${effort}), one subagent per prompt`)},`,
      `  phases: [{ title: ${JSON.stringify(stage)} }],`,
      '}',
      `const CHUNKS = ${JSON.stringify(chunks)}`,
      `const ITEMS = ${JSON.stringify(items)}`,
      `phase(${JSON.stringify(stage)})`,
      'const results = await parallel(ITEMS.map((item) => () =>',
      `  agent(item.parts.map((i) => CHUNKS[i]).join("\\n\\n"), { label: ${JSON.stringify(`${stage}:`)} + item.id, phase: ${JSON.stringify(stage)}, model: ${JSON.stringify(model)}, effort: ${JSON.stringify(effort)} })`,
      '    .then((text) => (typeof text === "string" ? text.length : 0))))',
      'return { prompts: ITEMS.length, replied: results.filter((n) => n > 0).length }',
      '',
    ].join('\n');
    writeFileSync(path(`${name}.workflow.js`), script);
    say(`${path(`${name}.workflow.js`)}: ${prompts.length} prompts`);
    break;
  }
  default:
    process.stderr.write('Commands: plan-prompts, check-plans, check-scenes, check-repairs, workflow\n');
    process.exit(1);
}

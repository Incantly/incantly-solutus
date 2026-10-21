import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { benchRound, readJson, type BenchCondition, type BenchReply, type BenchResult, type PendingCall } from '../bench';
import { LAUNCH_REQUESTS } from '../launch';
import { spread } from '../metrics';

/**
 * The agent bench, in rounds (see ../bench.ts). Each round replays every
 * generation with the replies so far and writes a workflow script that sends
 * the calls still waiting to subagents: plans to the small model, scenes and
 * repairs to the large one. The replies are read back from the workflow's
 * transcripts, with their wall times and token counts, so they never pass
 * through the caller's own context.
 *
 *   node dist/bench.mjs round --dir bench/run       # writes round-N.workflow.js, or says the run is complete
 *   node dist/bench.mjs ingest --dir bench/run --run <workflow transcript dir>
 *   node dist/bench.mjs calibrate --dir bench/run   # the fixed cost of a subagent call, to subtract
 *   node dist/bench.mjs ingest --dir bench/run --run <dir> --calibration
 *   node dist/bench.mjs report --dir bench/run      # results.json and report.md
 */

const [command] = process.argv.slice(2);
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    dir: { type: 'string', default: 'bench' },
    run: { type: 'string' },
    only: { type: 'string' },
    conditions: { type: 'string', default: 'library,novel' },
    plan: { type: 'string', default: 'haiku' },
    scene: { type: 'string', default: 'sonnet' },
    effort: { type: 'string', default: 'low' },
    calibration: { type: 'boolean', default: false },
    deadline: { type: 'string' },
  },
});

const say = (text: string) => process.stdout.write(`${text}\n`);
const dir = values.dir;
mkdirSync(dir, { recursive: true });
const path = (name: string) => join(dir, name);
const write = (name: string, data: unknown) => writeFileSync(path(name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
const conditions = values.conditions.split(',') as BenchCondition[];

function requests() {
  const only = values.only?.split(',');
  return LAUNCH_REQUESTS.filter((r) => !only || only.some((o) => r.id.startsWith(o)));
}

function replies(): BenchReply[] {
  return existsSync(path('replies.json')) ? readJson<BenchReply[]>(path('replies.json')) : [];
}

const options = values.deadline !== undefined ? { deadlineMs: Number(values.deadline) } : {};

/** A workflow script that sends each prompt to a subagent and returns only counts. */
function workflowScript(name: string, description: string, calls: ReadonlyArray<{ readonly label: string; readonly prompt: string; readonly model: string; readonly phase: string }>): string {
  // Prompts share most of their text (rules, contract, examples): each paragraph is stored once.
  const chunks: string[] = [];
  const index = new Map<string, number>();
  const items = calls.map((c) => ({
    label: c.label,
    model: c.model,
    phase: c.phase,
    parts: c.prompt.split('\n\n').map((chunk) => {
      let i = index.get(chunk);
      if (i === undefined) {
        i = chunks.push(chunk) - 1;
        index.set(chunk, i);
      }
      return i;
    }),
  }));
  const phases = [...new Set(calls.map((c) => c.phase))];
  return [
    'export const meta = {',
    `  name: ${JSON.stringify(name)},`,
    `  description: ${JSON.stringify(description)},`,
    `  phases: ${JSON.stringify(phases.map((title) => ({ title })))},`,
    '}',
    `const CHUNKS = ${JSON.stringify(chunks)}`,
    `const ITEMS = ${JSON.stringify(items)}`,
    'const results = await parallel(ITEMS.map((item) => () =>',
    `  agent(item.parts.map((i) => CHUNKS[i]).join("\\n\\n"), { label: item.label, phase: item.phase, model: item.model, effort: ${JSON.stringify(values.effort)} })`,
    '    .then((text) => (typeof text === "string" ? text.length : 0))))',
    'return { prompts: ITEMS.length, replied: results.filter((n) => n > 0).length }',
    '',
  ].join('\n');
}

/** Replies from a workflow run's transcripts: text, wall time from the task to the last answer, and tokens. */
function readRun(runDir: string): BenchReply[] {
  const labels = new Map<string, string>();
  const results = new Map<string, unknown>();
  for (const line of readFileSync(join(runDir, 'journal.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { type?: string; agentId?: string; label?: string; result?: unknown };
    if (entry.type === 'started' && entry.agentId && entry.label) labels.set(entry.agentId, entry.label);
    if (entry.type === 'result' && entry.agentId) results.set(entry.agentId, entry.result);
  }
  const out: BenchReply[] = [];
  for (const [agent, label] of labels) {
    const file = join(runDir, `agent-${agent}.jsonl`);
    if (!existsSync(file)) continue;
    let start: number | null = null;
    let end: number | null = null;
    let model: string | undefined;
    const usage = new Map<string, { input: number; output: number; cacheRead: number }>();
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as {
        type?: string;
        timestamp?: string;
        message?: { id?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
      };
      const t = entry.timestamp ? Date.parse(entry.timestamp) : null;
      if (entry.type === 'user' && start === null && t !== null) start = t;
      if (entry.type === 'assistant') {
        if (t !== null) end = t;
        model = entry.message?.model ?? model;
        const u = entry.message?.usage;
        if (u && entry.message?.id) usage.set(entry.message.id, { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 });
      }
    }
    const text = results.get(agent);
    const sum = [...usage.values()].reduce((a, u) => ({ input: a.input + u.input, output: a.output + u.output, cacheRead: a.cacheRead + u.cacheRead }), { input: 0, output: 0, cacheRead: 0 });
    const key = label.slice(label.indexOf(':') + 1);
    out.push({
      key,
      text: typeof text === 'string' ? text : '',
      ms: start !== null && end !== null ? end - start : 0,
      ...(model ? { model } : {}),
      outputTokens: sum.output,
      inputTokens: sum.input,
      cacheReadTokens: sum.cacheRead,
    });
  }
  return out;
}

const seconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? '–' : (ms / 1000).toFixed(1));
const percent = (n: number, of: number) => (of === 0 ? '–' : `${Math.round((100 * n) / of)}%`);

function stats(values: readonly number[]): string {
  const s = spread(values);
  return s.count === 0 ? '–' : `${seconds(s.p50)} / ${seconds(s.p90)} / ${seconds(s.max)} / ${seconds(s.mean)}`;
}

function report(results: readonly BenchResult[], overheadMs: Record<string, number>): string {
  const lines: string[] = [];
  const done = results.filter((r) => !r.pending);
  lines.push('# Generation bench', '');
  lines.push(
    `${done.length} generations: ${requests().length} launch requests (PRD 17.8) in ${conditions.length} condition${conditions.length > 1 ? 's' : ''}. Plans on ${values.plan}, scenes and repairs on ${values.scene}, effort ${values.effort}, each call one subagent.`,
    'Times are what a learner waits for, on the pipeline\'s own clock: each model call\'s measured wall time plus this machine\'s validation and probe. Calls are cut off at the deadline as the service would cut them.',
    '',
  );
  lines.push('## Summary', '', '| Condition | Generations | Approved | First attempt | Repaired | Failed | Total p50 / p90 / max / mean (s) | Within 25 s | 5 to 20 s |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const condition of conditions) {
    const rows = done.filter((r) => r.condition === condition);
    const approved = rows.filter((r) => r.passed);
    const totals = rows.map((r) => r.timings.totalMs);
    lines.push(
      `| ${condition} | ${rows.length} | ${approved.length} (${percent(approved.length, rows.length)}) | ${rows.filter((r) => r.firstAttempt).length} (${percent(rows.filter((r) => r.firstAttempt).length, rows.length)}) | ${rows.filter((r) => r.passed && !r.firstAttempt).length} | ${rows.filter((r) => !r.passed).length} | ${stats(totals)} | ${percent(totals.filter((t) => t <= 25_000).length, rows.length)} | ${percent(totals.filter((t) => t >= 5_000 && t <= 20_000).length, rows.length)} |`,
    );
  }
  lines.push('', '## Stages (p50 / p90 / max / mean, seconds)', '', '| Condition | Plan | Scene, adapted by edits | Scene, written whole | Repair | Local checks |', '| --- | --- | --- | --- | --- | --- |');
  for (const condition of conditions) {
    const rows = done.filter((r) => r.condition === condition);
    const scene = (mode: string) => rows.filter((r) => r.mode === mode).map((r) => r.timings.sceneMs);
    lines.push(
      `| ${condition} | ${stats(rows.map((r) => r.timings.planMs))} | ${stats(scene('adapt'))} | ${stats(scene('write'))} | ${stats(rows.filter((r) => r.repairs > 0).map((r) => r.timings.repairMs))} | ${stats(rows.map((r) => r.timings.checkMs))} |`,
    );
  }
  lines.push('', '## Output', '', '| Condition | Mode | Scenes | Scene output tokens p50 / max | Script characters p50 / max |', '| --- | --- | --- | --- | --- |');
  for (const condition of conditions) {
    for (const mode of ['adapt', 'write']) {
      const rows = done.filter((r) => r.condition === condition && r.mode === mode);
      if (rows.length === 0) continue;
      const tokens = spread(rows.map((r) => r.calls.find((c) => c.purpose === 'scene')?.outputTokens ?? 0));
      const chars = spread(rows.map((r) => r.jsChars));
      lines.push(`| ${condition} | ${mode} | ${rows.length} | ${tokens.p50} / ${tokens.max} | ${chars.p50} / ${chars.max} |`);
    }
  }
  if (Object.keys(overheadMs).length > 0) {
    lines.push(
      '',
      '## Subagent overhead',
      '',
      'Each call ran as a subagent, which adds its own fixed cost (its harness prompt and turn) to what an API call would take. Measured with one-word replies:',
      '',
      ...Object.entries(overheadMs).map(([model, ms]) => `- ${model}: ${seconds(ms)} s per call (median)`),
      '',
      `Subtracting it from every call (${Object.keys(overheadMs).length} models), the totals above become an estimate of the API path:`,
      '',
      '| Condition | Estimated total p50 / p90 / max / mean (s) | Within 25 s |',
      '| --- | --- | --- |',
    );
    for (const condition of conditions) {
      const rows = done.filter((r) => r.condition === condition);
      const adjusted = rows.map((r) => r.timings.totalMs - r.calls.reduce((sum, c) => sum + (overheadMs[c.model] ?? 0), 0));
      lines.push(`| ${condition} | ${stats(adjusted)} | ${percent(adjusted.filter((t) => t <= 25_000).length, rows.length)} |`);
    }
  }
  lines.push('', '## Every generation', '', '| Request | Condition | Mode | Example | Plan s | Scene s | Repair s | Total s | Result | Failures |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of done) {
    const result = r.passed ? (r.firstAttempt ? 'first attempt' : 'repaired') : `failed${r.deadlineSkipped ? ' (repair skipped for time)' : ''}`;
    lines.push(
      `| ${r.id} | ${r.condition} | ${r.mode ?? '–'} | ${r.example ?? '–'} | ${seconds(r.timings.planMs)} | ${seconds(r.timings.sceneMs)} | ${r.repairs > 0 ? seconds(r.timings.repairMs) : '–'} | ${seconds(r.timings.totalMs)} | ${result} | ${r.failures.join(', ') || '–'} |`,
    );
  }
  const failed = done.filter((r) => !r.passed);
  if (failed.length > 0) {
    lines.push('', '## Why generations failed', '');
    for (const r of failed) lines.push(`- ${r.id} (${r.condition}): ${r.failureReason ?? 'unknown'}`);
  }
  return `${lines.join('\n')}\n`;
}

switch (command) {
  case 'round': {
    const round = await benchRound(requests(), conditions, replies(), options);
    const waiting = round.results.filter((r) => r.pending).length;
    if (round.pending.length === 0) {
      say(`Complete: ${round.results.length} generations, nothing pending. Run "report".`);
      break;
    }
    const n = readdirSync(dir).filter((f) => /^round-\d+\.workflow\.js$/.test(f)).length + 1;
    const calls = round.pending.map((p: PendingCall) => ({
      label: `${p.purpose}:${p.key}`,
      prompt: p.prompt,
      model: p.purpose === 'plan' ? values.plan : values.scene,
      phase: p.purpose,
    }));
    write(`round-${n}.workflow.js`, workflowScript(`bench-round-${n}`, `Generation bench round ${n}: ${calls.length} model calls (${[...new Set(calls.map((c) => c.phase))].join(', ')}), one subagent each`, calls));
    say(`${path(`round-${n}.workflow.js`)}: ${calls.length} calls for ${waiting} waiting generations`);
    for (const purpose of ['plan', 'scene', 'repair']) {
      const count = round.pending.filter((p) => p.purpose === purpose).length;
      if (count) say(`  ${purpose}: ${count}`);
    }
    break;
  }
  case 'calibrate': {
    // The fixed cost of one subagent call: a reply of one word, for subtracting from the measured times.
    const calls = [values.plan, values.scene].flatMap((model) =>
      [1, 2, 3, 4, 5].map((i) => ({ label: `calibrate:${model}-${i}`, prompt: 'Do not use any tools. Reply with the single word OK.', model, phase: 'calibrate' })),
    );
    write('calibrate.workflow.js', workflowScript('bench-calibrate', `Generation bench calibration: ${calls.length} one-word calls`, calls));
    say(`${path('calibrate.workflow.js')}: ${calls.length} calls`);
    break;
  }
  case 'ingest': {
    if (!values.run) throw new Error('--run <workflow transcript dir> is required');
    const fresh = readRun(values.run);
    const file = values.calibration ? 'calibration.json' : 'replies.json';
    const existing = existsSync(path(file)) ? readJson<BenchReply[]>(path(file)) : [];
    const keys = new Set(fresh.map((r) => r.key));
    write(file, [...existing.filter((r) => !keys.has(r.key)), ...fresh]);
    say(`${fresh.length} replies read into ${path(file)}`);
    for (const r of fresh) say(`  ${r.key.padEnd(34)} ${seconds(r.ms).padStart(6)} s ${String(r.outputTokens ?? 0).padStart(6)} output tokens  ${r.model ?? ''}`);
    break;
  }
  case 'report': {
    const round = await benchRound(requests(), conditions, replies(), options);
    const calibration = existsSync(path('calibration.json')) ? readJson<BenchReply[]>(path('calibration.json')) : [];
    const overhead: Record<string, number> = {};
    for (const model of new Set(calibration.map((c) => c.model ?? ''))) {
      if (!model) continue;
      overhead[model] = spread(calibration.filter((c) => c.model === model).map((c) => c.ms)).p50 ?? 0;
    }
    write('results.json', round.results);
    write('report.md', report(round.results, overhead));
    say(`${path('report.md')}: ${round.results.filter((r) => !r.pending).length} complete, ${round.results.filter((r) => r.pending).length} still waiting`);
    break;
  }
  default:
    process.stderr.write('Commands: round, calibrate, ingest, report\n');
    process.exit(1);
}

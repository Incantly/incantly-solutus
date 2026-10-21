import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runEvals, summaryMarkdown, type Condition } from '../evals';
import { AnthropicClient, type ModelClient } from '../models';
import { FAULTS, referenceModel } from '../reference-model';

/**
 * Runs the generation evals and writes the trials, the failure records and a
 * summary to eval-results/<time>/.
 *
 *   npm run evals -- --model anthropic --trials 100
 *   npm run evals -- --model reference --faults 0.3     (the pipeline itself, with injected faults)
 *
 * Options: --model anthropic|reference, --trials per concept and condition
 * (default 100), --conditions with-example,example-withheld, --concepts ids,
 * --concurrency (default 4), --faults rate (reference only), --out directory,
 * --gate (exit 1 unless the v0.1 gate is met). The Anthropic model needs
 * ANTHROPIC_API_KEY.
 */

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'anthropic' },
    trials: { type: 'string', default: '100' },
    conditions: { type: 'string', default: 'with-example,example-withheld' },
    concepts: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    faults: { type: 'string', default: '0' },
    out: { type: 'string', default: 'eval-results' },
    gate: { type: 'boolean', default: false },
  },
});

function model(): ModelClient {
  if (values.model === 'reference') {
    const rate = Number(values.faults);
    // Deterministic: every n-th trial carries the next fault, and every third faulty trial's repair changes nothing.
    const every = rate > 0 ? Math.max(1, Math.round(1 / rate)) : 0;
    return referenceModel({
      fault: (trial) => (every && trial % every === 0 ? FAULTS[(trial / every) % FAULTS.length]! : 'none'),
      stubborn: (trial) => every > 0 && trial % every === 0 && (trial / every) % 3 === 2,
    });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Set ANTHROPIC_API_KEY to run the evals against the model, or use --model reference');
  return new AnthropicClient({ apiKey: key, timeoutMs: 60_000 });
}

const started = new Date();
const directory = join(values.out, started.toISOString().replace(/[:.]/g, '-'));
const { trials, summary } = await runEvals({
  model: model(),
  trialsPerConcept: Number(values.trials),
  conditions: values.conditions.split(',') as Condition[],
  ...(values.concepts ? { concepts: values.concepts.split(',') } : {}),
  concurrency: Number(values.concurrency),
  onTrial: (trial, done, total) => {
    const mark = trial.passed ? (trial.firstAttempt ? 'pass' : 'repaired') : `FAIL ${trial.failure ?? ''}`;
    process.stdout.write(`[${done}/${total}] ${trial.concept} (${trial.condition}) ${mark}\n`);
  },
});

await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'trials.jsonl'), trials.map((trial) => JSON.stringify({ ...trial, record: trial.record.id })).join('\n') + '\n');
await writeFile(join(directory, 'records.jsonl'), trials.map((t) => JSON.stringify(t.record)).join('\n') + '\n');
await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
const markdown = summaryMarkdown(summary);
await writeFile(join(directory, 'summary.md'), markdown);
process.stdout.write(`\n${markdown}\nWritten to ${directory}\n`);

const gate = summary.gate;
if (values.gate && !(gate.firstAttempt && gate.postRepair && gate.noBrokenFigures)) process.exit(1);

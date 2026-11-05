import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { filmSummaryMarkdown, runFilmEvals } from '../film-evals';

/**
 * Runs the film evals on the stand-in model with the stub narrator — no model
 * or speech provider calls — and writes the trials and a summary to
 * film-eval-results/<time>/.
 *
 *   npm run film-evals -- --trials 2 --gate
 *
 * Options: --trials per concept and length (default 2), --concepts ids,
 * --lengths seconds, --concurrency (default 2), --out directory,
 * --gate (exit 1 unless no broken film was shown).
 */

const { values } = parseArgs({
  options: {
    trials: { type: 'string', default: '2' },
    concepts: { type: 'string' },
    lengths: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    out: { type: 'string', default: 'film-eval-results' },
    gate: { type: 'boolean', default: false },
  },
});

const started = new Date();
const directory = join(values.out, started.toISOString().replace(/[:.]/g, '-'));
const { trials, summary } = await runFilmEvals({
  trialsPerConcept: Number(values.trials),
  ...(values.concepts ? { concepts: values.concepts.split(',') } : {}),
  ...(values.lengths ? { lengths: values.lengths.split(',').map(Number) } : {}),
  concurrency: Number(values.concurrency),
  onTrial: (trial, done, total) => {
    const mark = trial.passed ? (trial.firstAttempt ? 'pass' : 'repaired') : `FAIL ${trial.failure ?? ''}`;
    process.stdout.write(`[${done}/${total}] ${trial.concept} ${trial.length}s ${mark}\n`);
  },
});

await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'trials.jsonl'), trials.map((trial) => JSON.stringify(trial)).join('\n') + '\n');
await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
const markdown = filmSummaryMarkdown(summary);
await writeFile(join(directory, 'summary.md'), markdown);
process.stdout.write(`\n${markdown}\nWritten to ${directory}\n`);

if (values.gate && !summary.gate.noBrokenFilms) process.exit(1);

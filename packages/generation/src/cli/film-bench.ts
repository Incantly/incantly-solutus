import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { filmBenchMarkdown, runFilmBench } from '../film-bench';

/**
 * Runs the film bench on the stand-in model with the stub narrator — no model
 * or speech provider calls — and writes the report to
 * film-bench-results/<time>/.
 *
 *   npm run film-bench -- --trials 2
 *
 * Options: --lengths seconds (default 30,60,120,180,240), --trials per length
 * (default 2), --out directory. The bench measures and records; it never
 * gates, like the figure bench — the evals hold the gate.
 */

const { values } = parseArgs({
  options: {
    lengths: { type: 'string', default: '30,60,120,180,240' },
    trials: { type: 'string', default: '2' },
    out: { type: 'string', default: 'film-bench-results' },
  },
});

const started = new Date();
const directory = join(values.out, started.toISOString().replace(/[:.]/g, '-'));
const report = await runFilmBench({
  lengths: values.lengths.split(',').map(Number),
  trialsPerLength: Number(values.trials),
  onFilm: (length, done, total) => {
    process.stdout.write(`[${done}/${total}] ${length}s film\n`);
  },
});

await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const markdown = filmBenchMarkdown(report);
await writeFile(join(directory, 'report.md'), markdown);
process.stdout.write(`\n${markdown}\nWritten to ${directory}\n`);

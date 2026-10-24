import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dashboard, dashboardText } from '../metrics';
import type { FailureRecord } from '../records';

/**
 * Prints the generation dashboard from a directory of JSON-lines records:
 *   node dist/metrics.mjs records/ [--json]
 */
const [directory = 'records', ...flags] = process.argv.slice(2);
const files = (await readdir(directory)).filter((name) => /^records-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
const records: FailureRecord[] = [];
for (const file of files) {
  for (const line of (await readFile(join(directory, file), 'utf8')).split('\n')) {
    if (line.trim() !== '') records.push(JSON.parse(line) as FailureRecord);
  }
}
const board = dashboard(records);
process.stdout.write(flags.includes('--json') ? `${JSON.stringify(board, null, 2)}\n` : dashboardText(board));

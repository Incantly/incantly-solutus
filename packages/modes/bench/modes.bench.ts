/**
 * App mode benchmarks against app-modes design 5: a policy check per command under 5 µs, a `setMode` dry run on 500
 * objects under 30 ms, deriving a mode and compiling its sets, and the exam gate on a line.
 *
 * Plain script, like the other benches (Vitest 5 has no `bench` export). Run it with
 * `npx tsx packages/modes/bench/modes.bench.ts`. Method: 2 warmup runs, then runs until at least 25 ms in all (5 to 500
 * runs); the number is the mean per run. Exit code 1 when a case misses its target.
 */
import { performance } from 'node:perf_hooks';
import { CommandRegistry, Figure, geometry, registerFunctions, registerNumbers } from '@incantly/kernel';
import { EXAM_PROFILES, MODES, catalogueOf, compilePolicy, deriveMode, makeGate, switchMode } from '../src/index';

const reg = new CommandRegistry();
geometry.registerGeometry(reg);
registerNumbers(reg);
registerFunctions(reg);
const CAT = catalogueOf(reg.all());

function time(fn: () => void): number {
  fn();
  fn();
  let runs = 0;
  const t0 = performance.now();
  while (runs < 500 && (runs < 5 || performance.now() - t0 < 25)) {
    fn();
    runs++;
  }
  return (performance.now() - t0) / runs;
}

const big = new Figure({ commands: reg });
for (let i = 0; i < 250; i++) {
  big.apply(`pt${i} = (${i}, ${i % 7})`);
  big.apply(`md${i} = Midpoint(pt${i}, (0, 0))`);
}
const policy = compilePolicy(MODES.graphing);
const exam = deriveMode(MODES.graphing, { base: 'graphing', ...EXAM_PROFILES.basic.restrict }, { commands: CAT });
if (!exam.ok) throw new Error(exam.message);
const gated = new Figure({ commands: reg });
gated.apply('f(x) = x^2');
gated.setGate(makeGate({ layers: [{ policy, reason: 'mode' }, { policy: compilePolicy(exam.value), reason: 'exam', examProfile: 'basic' }], catalogue: CAT }));

const cases: { name: string; ms: number; target: number; unit: 'ms' | 'µs'; per?: number }[] = [
  { name: 'policy check (1000 lookups)', ms: time(() => {
    for (let i = 0; i < 1000; i++) policy.command(i % 2 ? 'Derivative' : 'Circle', i % 2 ? 'functions' : 'conics');
  }), target: 5, unit: 'µs', per: 1000 },
  { name: 'setMode dry run, 500 objects', ms: time(() => {
    switchMode(big, MODES.geometry, MODES.scientific, { catalogue: CAT, dryRun: true });
  }), target: 30, unit: 'ms' },
  { name: 'deriveMode + compile (exam)', ms: time(() => {
    const r = deriveMode(MODES.graphing, { base: 'graphing', ...EXAM_PROFILES.basic.restrict }, { commands: CAT });
    if (r.ok) compilePolicy(r.value);
  }), target: 2, unit: 'ms' },
  { name: 'gated line (dry run)', ms: time(() => {
    gated.apply('t = Tangent(f, 1)', { dryRun: true });
  }), target: 1, unit: 'ms' },
];

let bad = 0;
for (const c of cases) {
  const value = c.unit === 'µs' ? (c.ms * 1000) / (c.per ?? 1) : c.ms;
  const ok = value <= c.target;
  if (!ok) bad++;
  process.stdout.write(`${ok ? 'ok  ' : 'MISS'}  ${c.name.padEnd(34)} ${value.toFixed(3).padStart(9)} ${c.unit}   target ${c.target} ${c.unit}\n`);
}
process.exit(bad > 0 ? 1 : 0);

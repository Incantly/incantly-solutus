/**
 * The two lanes (cas/design.md 5.13; finding SYM-SM-26): a heavy call past the fast lane is pending and goes to the
 * worker; the worker's answer seeds this realm's cache, and recomputing the object gives the answer at once. The
 * worker's queue drops cancelled jobs and an older job for the same key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, registerCas, registerNumbers, setCasEngine, valueText } from '@incantly/kernel';
import { SYMBOLIC_COMMANDS } from '@incantly/symbolic/catalogue';
import { WorkerQueue, acceptWorkerResult, casEngine, clearCache, handleWorkerRequest, run, setCasLanes } from '@incantly/symbolic';
import type { LaneJob, WorkerRequest } from '@incantly/symbolic';

const registry = new CommandRegistry();
registerNumbers(registry);
registerCas(registry, SYMBOLIC_COMMANDS);
setCasEngine(casEngine);

afterEach(() => setCasLanes(undefined));

describe('the worker lane', () => {
  it('a heavy call past the fast lane is pending, then answered from the cache the worker filled', () => {
    clearCache();
    const jobs: LaneJob[] = [];
    setCasLanes({ fastLaneMs: 0.0001, submit: (j) => jobs.push(j) });
    const f = new Figure({ commands: registry });
    expect(f.apply('F = Factor(x^30 - 1)').ok).toBe(true);
    const c = f.get('F')?.cell;
    expect(c && !c.defined ? c.reason : 'defined').toBe('pending');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.owner).toBe('F');
    // the "worker": a structured clone of the job, run, and its answer handed back
    const job = structuredClone(jobs[0]) as LaneJob;
    const res = handleWorkerRequest({ id: 1, key: job.key, op: job.op, args: job.args, domains: job.domains }, run);
    acceptWorkerResult(res.key as string, structuredClone(res.result));
    const id = f.get('F')?.id;
    f.recompute(id === undefined ? [] : [id]);
    f.flush();
    expect(valueText(f.value('F'))).toMatch(/^\(x - 1\) \* \(x \+ 1\)/);
  });

  it('objects that read a pending one follow when it is answered', () => {
    clearCache();
    const jobs: LaneJob[] = [];
    setCasLanes({ fastLaneMs: 0.0001, submit: (j) => jobs.push(j) });
    const f = new Figure({ commands: registry });
    f.apply('F = Factor(x^12 - 1)');
    f.apply('n = ToNumber(Substitute(F, x, 2))');
    expect(f.get('n')?.cell.defined).toBe(false);
    const job = jobs[0] as LaneJob;
    const res = handleWorkerRequest({ id: 1, key: job.key, op: job.op, args: job.args, domains: job.domains }, run);
    acceptWorkerResult(job.key, res.result);
    f.recompute([f.get('F')?.id as never]);
    f.flush();
    expect(f.value('n')).toBe(4095);
  });

  it('without lanes the call runs to its full budget here', () => {
    clearCache();
    const f = new Figure({ commands: registry });
    f.apply('F = Factor(x^12 - 1)');
    expect(f.get('F')?.cell.defined).toBe(true);
  });
});

describe('the worker queue', () => {
  const req = (id: number, key?: string): WorkerRequest => ({ id, ...(key ? { key } : {}), op: 'Expand', args: [] });

  it('takes jobs in order, drops a cancelled one, and keeps only the newest job for a key', () => {
    const q = new WorkerQueue();
    q.push(req(1, 'a'));
    q.push(req(2, 'b'));
    q.push(req(3, 'a'));
    q.push({ cancel: 2 });
    expect(q.size).toBe(1);
    expect(q.next()?.id).toBe(3);
    expect(q.next()).toBeUndefined();
  });

  it('the answer carries the key back', () => {
    const r = handleWorkerRequest(req(7, 'k'), run);
    expect(r.id).toBe(7);
    expect(r.key).toBe('k');
  });
});

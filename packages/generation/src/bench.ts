import { readFileSync } from 'node:fs';
import type { ScenePlan } from '@incantly/core';
import { planPrompt, scenePrompt, type LearnerRequest, type Prompt } from './context';
import { FragmentStream, missingFragments, parsePlanReply, type FragmentSet } from './fragments';
import { formatPlanProblems, validatePlan, type PlanProblem } from './plan';
import { isolatedProbe, probeSpecFor } from './probe';
import { parseReport, probeReport, repairPrompt, validationReport, type RepairReport } from './report';
import { validateScene } from '@incantly/core';

/**
 * The agent bench: measures generation stage by stage with real models
 * driven from outside this process (for example as subagents of a coding
 * agent, when no API key is at hand). Each stage writes the exact prompts the
 * service would send; the replies come back as JSON; the next stage checks
 * them with the real validators and the isolated probe. Timings are measured
 * by whoever runs the model calls and passed in with the replies.
 */

export interface BenchRequest {
  readonly id: string;
  readonly concept: string;
  readonly request: LearnerRequest;
}

/** A prompt as one text: the service's system blocks, then the learner turn. */
export function promptText(prompt: Prompt): string {
  return [
    'You are standing in for a model endpoint in a latency benchmark. Do not use any tools and do not read any files. Reply with exactly what the instructions ask for and nothing else: no preamble, no explanation after.',
    '',
    '<system>',
    prompt.system.map((block) => block.text).join('\n\n'),
    '</system>',
    '',
    '<user>',
    prompt.user,
    '</user>',
  ].join('\n');
}

export interface PlanItem {
  readonly id: string;
  readonly concept: string;
  readonly request: LearnerRequest;
  readonly prompt: string;
}

export function planItems(requests: readonly BenchRequest[]): PlanItem[] {
  return requests.map((r) => ({ id: r.id, concept: r.concept, request: r.request, prompt: promptText(planPrompt(r.request)) }));
}

export interface Reply {
  readonly id: string;
  readonly text: string;
  /** Wall time of the model call in milliseconds, as measured by the caller. */
  readonly ms?: number;
  readonly model?: string;
}

export interface PlanOutcome {
  readonly id: string;
  readonly plan: ScenePlan | null;
  readonly problems: readonly PlanProblem[];
  /** The re-plan prompt when the plan was rejected. */
  readonly replan: string | null;
  /** The scene prompt when the plan passed. */
  readonly scene: string | null;
  readonly example: string | null;
  readonly checkMs: number;
}

export function checkPlans(items: readonly PlanItem[], replies: readonly Reply[], options: { readonly withhold?: (id: string) => readonly string[] } = {}): PlanOutcome[] {
  return replies.map((reply) => {
    const started = performance.now();
    const item = items.find((i) => i.id === reply.id);
    if (!item) throw new Error(`No plan prompt for ${reply.id}`);
    const parsed = parsePlanReply(reply.text);
    const validation = parsed.problem
      ? { ok: false, plan: null, problems: [{ rule: 'schema' as const, path: 'plan', message: parsed.problem }] }
      : validatePlan(parsed.value);
    if (!validation.plan) {
      const replan = promptText(planPrompt(item.request, { previous: reply.text.trim().slice(0, 4000), problems: formatPlanProblems(validation.problems) }));
      return { id: reply.id, plan: null, problems: validation.problems, replan, scene: null, example: null, checkMs: performance.now() - started };
    }
    const withhold = options.withhold?.(reply.id);
    const { prompt, example } = scenePrompt(validation.plan, withhold ? { withhold } : {});
    return { id: reply.id, plan: validation.plan, problems: [], replan: null, scene: promptText(prompt), example, checkMs: performance.now() - started };
  });
}

export interface SceneCheck {
  readonly id: string;
  readonly model: string | null;
  readonly passed: boolean;
  readonly failed: 'reply' | 'validation' | 'probe' | null;
  readonly report: RepairReport | null;
  /** The repair prompt for a failure. */
  readonly repair: string | null;
  readonly fragments: FragmentSet;
  readonly jsLines: number;
  readonly outputChars: number;
  readonly validateMs: number;
  readonly probeMs: number;
  readonly elements: number;
}

/** Validates and probes one scene reply, as the pipeline does, and builds the repair prompt if it fails. */
export async function checkScene(id: string, plan: ScenePlan, text: string, previous?: FragmentSet, model: string | null = null): Promise<SceneCheck> {
  const stream = new FragmentStream();
  stream.push(text);
  const parsed = stream.end();
  const fragments: FragmentSet = previous ? { ...previous, ...parsed.fragments } : parsed.fragments;
  const missing = missingFragments(fragments);
  const base = { id, model, fragments, jsLines: (fragments.js ?? '').split('\n').length, outputChars: text.length };
  if (missing.length > 0 || parsed.problems.length > 0) {
    const report = parseReport(parsed.problems, missing);
    return { ...base, passed: false, failed: 'reply', report, repair: promptText(repairPrompt(report, fragments, plan)), validateMs: 0, probeMs: 0, elements: 0 };
  }
  const v0 = performance.now();
  const validation = validateScene({ html: fragments.html!, css: fragments.css!, js: fragments.js! });
  const validateMs = performance.now() - v0;
  if (!validation.ok || !validation.scene) {
    const report = validationReport(validation.diagnostics, fragments);
    return { ...base, passed: false, failed: 'validation', report, repair: promptText(repairPrompt(report, fragments, plan)), validateMs, probeMs: 0, elements: 0 };
  }
  const p0 = performance.now();
  const probe = await isolatedProbe(validation.scene, probeSpecFor(plan));
  const probeMs = performance.now() - p0;
  if (!probe.ok) {
    const report = probeReport(probe, fragments, plan);
    return { ...base, passed: false, failed: 'probe', report, repair: promptText(repairPrompt(report, fragments, plan)), validateMs, probeMs, elements: probe.stats.elements };
  }
  return { ...base, passed: true, failed: null, report: null, repair: null, validateMs, probeMs, elements: probe.stats.elements };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

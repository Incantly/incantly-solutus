/**
 * The lesson tools (lesson design 5): `lesson_plan` sets or replaces the plan, `lesson_step` moves the step, rewrites the
 * summary and notes what was hard. Both write into the memory the job gives `lessonTools`, and a good call also sends a
 * `lesson` event out of the turn so the learner's screen shows the plan and the step. A bad input is `tool_input` (T001).
 * No DOM, timers, network or `Date`.
 */
import { defineTool, ok } from '../tools/schema';
import type { JsonSchema, ToolDef, TurnOutput } from '../tools/types';
import { LESSON_LIMITS, clip, lessonView } from './memory';
import type { LessonMemory } from './memory';

const PLAN_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      description: `The lesson's steps, in order: ${LESSON_LIMITS.planMin} to ${LESSON_LIMITS.planMax} short titles.`,
      minItems: LESSON_LIMITS.planMin,
      maxItems: LESSON_LIMITS.planMax,
      items: { type: 'string', minLength: 1, maxLength: LESSON_LIMITS.stepChars },
    },
  },
  required: ['steps'],
};

const STEP_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    // 'next' or a step number: the subset of JSON Schema has no union, so `check` reads it
    to: { description: "'next', or the number of a step of the plan (1 is the first)." },
    summary: { type: 'string', description: 'What the lesson has covered so far, in a few sentences. It replaces the old summary.', maxLength: LESSON_LIMITS.summaryChars },
    hard: { type: 'string', description: 'One short note on what the learner found hard.', maxLength: LESSON_LIMITS.hardChars },
  },
};

/** The `lesson` event of a good call, read from the memory as it is after the call. */
const outputsOf = (memory: LessonMemory): readonly TurnOutput[] => [{ lesson: lessonView(memory) }];

function planTool(memory: LessonMemory): ToolDef {
  return defineTool({
    name: 'lesson_plan',
    description: `Set the lesson's plan: ${LESSON_LIMITS.planMin} to ${LESSON_LIMITS.planMax} short steps, each at most ${LESSON_LIMITS.stepChars} characters. Calling it again replaces the plan and starts at step 1.`,
    schema: PLAN_SCHEMA,
    check(input) {
      const steps = input['steps'] as readonly string[];
      return steps.some((s) => s.trim() === '') ? 'A step of the plan is empty.' : undefined;
    },
    body(_target, input) {
      memory.plan = (input['steps'] as readonly string[]).map((s) => s.trim());
      memory.step = 1;
      return ok({ ok: true, step: 1 });
    },
    outputs: () => outputsOf(memory),
  });
}

/** The step a `to` names, or the sentence that says why it is not one. */
function targetStep(memory: LessonMemory, to: unknown): number | string {
  if (memory.plan.length === 0) return 'There is no plan yet; call lesson_plan first.';
  if (to === 'next') return memory.step < memory.plan.length ? memory.step + 1 : `The lesson is at its last step (${memory.plan.length}); there is no next one.`;
  if (typeof to === 'number' && Number.isInteger(to)) return to >= 1 && to <= memory.plan.length ? to : `"to" must be a step of the plan, 1 to ${memory.plan.length}.`;
  return `"to" must be 'next' or the number of a step, 1 to ${memory.plan.length}.`;
}

function stepTool(memory: LessonMemory): ToolDef {
  return defineTool({
    name: 'lesson_step',
    description: "Move the lesson on: to: 'next' or a step number, a summary of what the lesson has covered (replaces the old one), and a note of what the learner found hard. Send at least one of the three.",
    schema: STEP_SCHEMA,
    check(input) {
      const { to, summary, hard } = input;
      if (to === undefined && summary === undefined && hard === undefined) return 'Send at least one of "to", "summary" and "hard".';
      if (typeof summary === 'string' && summary.trim() === '') return '"summary" is empty.';
      if (typeof hard === 'string' && hard.trim() === '') return '"hard" is empty.';
      if (to !== undefined) {
        const step = targetStep(memory, to);
        if (typeof step === 'string') return step;
      }
      return undefined;
    },
    body(_target, input) {
      const { to, summary, hard } = input;
      if (to !== undefined) {
        const step = targetStep(memory, to);
        if (typeof step === 'number') memory.step = step;
      }
      if (typeof summary === 'string') memory.summary = clip(summary, LESSON_LIMITS.summaryChars);
      if (typeof hard === 'string') {
        const note = clip(hard, LESSON_LIMITS.hardChars);
        memory.hard = [...memory.hard.filter((h) => h !== note), note].slice(-LESSON_LIMITS.hard);
      }
      return ok({ ok: true, step: memory.step });
    },
    outputs: () => outputsOf(memory),
  });
}

/**
 * The two lesson tools over `memory`. Add them to a toolset as its extra tools: `toolset(['board_read', 'board'], lessonTools(memory))`.
 */
export function lessonTools(memory: LessonMemory): readonly ToolDef[] {
  return [planTool(memory), stepTool(memory)];
}

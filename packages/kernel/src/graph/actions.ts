/**
 * The actions the kernel itself owns (docs/features/kernel/design.md section 14, core design 6.6): their command specs.
 * The figure runs them directly; their `rule` is never called.
 */
import type { CommandForm, CommandSpec, ParamSpec } from '../language/table';

const noRule = (): never => {
  throw new Error('kernel actions are run by the figure');
};

const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const form = (params: ParamSpec[], summary: string, rest?: ParamSpec): CommandForm => ({
  params,
  ...(rest ? { rest } : {}),
  returns: null,
  rule: noRule,
  summary,
});

export const KERNEL_ACTIONS: readonly string[] = ['Show', 'Hide', 'Delete', 'Rename', 'Undo', 'Redo', 'Describe', 'DependsOn', 'Uses'];

/** Specs of the kernel actions. */
export function kernelActionSpecs(): CommandSpec[] {
  return [
    { name: 'Show', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any')], 'show objects', p('more', 'Any', { optional: true }))] },
    { name: 'Hide', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any')], 'hide objects', p('more', 'Any', { optional: true }))] },
    { name: 'Delete', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any')], 'remove an object and everything built from it')] },
    { name: 'Rename', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any'), p('name', 'Text')], 'change the name of an object')] },
    { name: 'Undo', kind: 'action', group: 'figure', forms: [form([], 'take back the last line')] },
    { name: 'Redo', kind: 'action', group: 'figure', forms: [form([], 'restore the line taken back')] },
    { name: 'Describe', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any')], 'report an object: type, definition, value, properties, inputs, dependents')] },
    { name: 'DependsOn', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any')], 'the objects it depends on')] },
    { name: 'Uses', kind: 'action', group: 'figure', forms: [form([p('obj', 'Any')], 'the objects that depend on it')] },
  ];
}

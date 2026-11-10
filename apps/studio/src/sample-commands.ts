/**
 * A small sample command table. The kernel will supply the real one (docs/features/language/design.md 3.11); this one exists
 * only so completion, signature help and error forms have commands to show before the kernel exists. The rules do nothing:
 * a line that uses a command is accepted and typed, and its value stays undefined (`not_set`) until a kernel runs it.
 */
import type { CommandForm, CommandSpec, ParamSpec } from '@incantly/kernel';

const rule = (): unknown => ({});
const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const form = (params: ParamSpec[], returns: string, summary: string, extra: Partial<CommandForm> = {}): CommandForm => ({
  params,
  returns,
  rule,
  summary,
  ...extra,
});

export const SAMPLE_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Midpoint',
    kind: 'object',
    group: 'geometry',
    forms: [
      form([p('a', 'Point'), p('b', 'Point')], 'Point', 'midpoint of two points'),
      form([p('s', 'Segment')], 'Point', 'midpoint of a segment'),
    ],
  },
  {
    name: 'Circle',
    kind: 'object',
    group: 'geometry',
    forms: [
      form([p('center', 'Point'), p('radius', 'Number')], 'Circle', 'circle by centre and radius'),
      form([p('center', 'Point'), p('through', 'Point')], 'Circle', 'circle through a point'),
      form([p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], 'Circle', 'circle through three points'),
    ],
  },
  { name: 'Segment', kind: 'object', group: 'geometry', forms: [form([p('a', 'Point'), p('b', 'Point')], 'Segment', 'segment between two points')] },
  { name: 'Distance', kind: 'object', group: 'geometry', forms: [form([p('a', 'Point'), p('b', 'Point')], 'Number', 'distance between two points')] },
  {
    name: 'Polygon',
    kind: 'object',
    group: 'geometry',
    forms: [form([p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], 'Polygon', 'polygon through its corners', { rest: p('more', 'Point') })],
  },
];

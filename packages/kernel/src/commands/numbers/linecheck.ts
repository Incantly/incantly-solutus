/**
 * Line checks of the numbers area: refusals the language cannot make because they depend on the figure
 * (numbers-sliders errors 2, controls-scripting errors 2). The kernel asks before it commits a line.
 */
import type { ErrorObject } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import type { ParsedLine } from '../../language/ast';
import type { CheckedLine } from '../../language/check';
import { animatingIds } from './animate';
import { checkSliderLineUnits, countControls } from './commands';
import { numbersError } from './errors';
import { checkInputTarget } from './input';
import { inferUnitFromDefinition } from './props';
import { NUMBERS_LIMITS } from './types';

const AT = { line: 0, col: 1, endCol: 1 } as const;
const CONTROLS: ReadonlySet<string> = new Set(['Button', 'Choice', 'Input']);

function commandOf(line: CheckedLine): { readonly name: string; readonly firstRef: ObjId | undefined } | undefined {
  const e = line.expr;
  if (!e || e.n !== 'command') return undefined;
  const first = e.args[0]?.expr;
  return { name: e.spec.name, firstRef: first && first.n === 'ref' ? first.id : undefined };
}

export function numbersLineCheck(host: unknown, line: CheckedLine, parsed: ParsedLine): ErrorObject | undefined {
  const figure = host as Figure;
  const node = parsed.node;
  const text = (s: number, e: number): string => parsed.sm.text.slice(s, e);
  const name = line.names[0] ?? '';

  if (line.kind === 'define' && node.k === 'define' && node.range) {
    // a slider holds its own value: a number computed from others cannot have a range
    if (!line.free && !line.isState) {
      const inputs = line.reads.map((id) => figure.get(id)?.name).filter((n): n is string => n !== undefined && n !== name);
      if (inputs.length > 0) {
        return numbersError('not_free', AT, { name, inputs: inputs.join(', '), depends_on: inputs.join(', ') }, {
          token: name,
          hint: `${name} is computed from ${inputs.join(', ')}, so it cannot be a slider. Give it a plain number, or drop the range.`,
          related: inputs,
        });
      }
    }
    // an angle written with a unit keeps that unit on its bounds
    const unit = inferUnitFromDefinition(text(node.expr.s, node.expr.e));
    if (unit !== undefined) {
      const lo = text(node.range.from.s, node.range.from.e);
      const hi = text(node.range.to.s, node.range.to.e);
      const step = node.range.step ? text(node.range.step.s, node.range.step.e) : undefined;
      const e = checkSliderLineUnits({ lo, hi, ...(step !== undefined ? { step } : {}) }, unit);
      if (e) {
        const u: string = unit === 'rad' ? '' : unit;
        const fixed = `${name} = ${text(node.expr.s, node.expr.e)} in ${lo}${bare(lo) ? u : ''}..${hi}${bare(hi) ? u : ''}${step !== undefined ? ` step ${step}${bare(step) ? u : ''}` : ''}`;
        return { ...e, params: { ...e.params, name, unit }, hint: `The value is in ${unit}, so write the bounds in ${unit} too: ${fixed}.`, suggest: [fixed] } as ErrorObject;
      }
    }
  }

  const cmd = line.kind === 'define' ? commandOf(line) : undefined;
  if (cmd && CONTROLS.has(cmd.name)) {
    // a new control over the limit (a redefinition of a control does not add one)
    const existing = line.existing !== undefined ? figure.get(line.existing) : undefined;
    const adds = !(existing && CONTROLS.has(existing.type));
    const max = NUMBERS_LIMITS.controlsPerFigure;
    if (adds && countControls(figure) >= max) {
      return numbersError('limit', AT, { max, what: 'controls', limit: 'controls_per_figure', got: countControls(figure) + 1 }, {
        token: name,
        hint: `A figure holds at most ${max} buttons, dropdowns and input boxes. Delete one first.`,
      });
    }
    if (cmd.name === 'Input') {
      const target = cmd.firstRef !== undefined ? figure.get(cmd.firstRef) : undefined;
      if (!target) {
        return numbersError('bad_input_target', AT, { name: 'the target', why: 'an input box is linked to an object by its name', reason: 'not_an_object', allowed: 'Number, Text, Point, Vector, Bool, Function' }, {
          token: name,
          hint: 'Write the name of a free Number, Text, Point, Vector, Bool or Function.',
        });
      }
      const e = checkInputTarget(figure, target.name);
      if (e) return { ...e, params: { ...e.params, allowed: 'Number, Text, Point, Vector, Bool, Function' } } as ErrorObject;
    }
  }

  if (line.kind === 'rate' && line.rate) {
    // an animating slider that a rate reads would restart the states every frame
    const moving = new Set<ObjId>(animatingIds(figure));
    if (moving.size > 0) {
      for (const id of line.reads) {
        const hit = moving.has(id) ? id : [...moving].find((m) => figure.dependentsOf(m).includes(id));
        if (hit === undefined) continue;
        const slider = figure.get(hit)?.name ?? '';
        return numbersError('animated_input', AT, { slider, rate: line.rate.name }, {
          token: name,
          hint: `Stop the animation of ${slider}, or write ${slider} as a formula of t instead of a slider.`,
          related: [slider, line.rate.name],
        });
      }
    }
  }
  return undefined;
}

function bare(text: string): boolean {
  const t = text.trim();
  return /^-?\d+(\.\d+)?$/.test(t) && Number(t) !== 0;
}

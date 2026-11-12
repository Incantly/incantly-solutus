/**
 * Line rewrites of the numbers area (numbers-sliders design 3.2): the range keys of a `with` list, the words `none`
 * and `auto`, a slider that keeps its range when it is given a new number, and an initial value that lands on a step.
 */
import type { Notice } from '../../contracts/errors';
import type { Figure } from '../../graph/figure';
import type { LineRewrite } from '../../graph/registry';
import { makeNotice } from '../../errors/notices';
import { numberSource } from '../../graph/values';
import type { TNode } from '../../language/tnode';
import { commit } from './commit';
import { numbersError } from './errors';
import { evalTNode } from './eval';
import { checkExprProbe } from './run';
import { inferUnitFromDefinition } from './props';
import { parseRangeRestyle, rangeLine } from './rangestep';

const AT = { line: 0, col: 1, endCol: 1 } as const;
const NAME = '[A-Za-z\\u0370-\\u03FF][A-Za-z0-9_\\u0370-\\u03FF]*';
const NUM = '-?\\d+(?:\\.\\d+)?';
const PLAIN_DEFINE = new RegExp(`^\\s*(${NAME})\\s*=\\s*(${NUM})\\s*$`);
const SLIDER_DEFINE = new RegExp(`^\\s*(${NAME})\\s*=\\s*(${NUM})\\s+in\\s+(${NUM})\\.\\.(${NUM})\\s+step\\s+(${NUM})(\\s+with\\s.*)?$`, 's');
const ANGLE_DEFINE = new RegExp(`^\\s*(${NAME})\\s*=\\s*([^=]+)$`);
const SHOW_NONE = /(\bshowIf\s*=\s*)none\b/;
const CONTROL_WITH = new RegExp(`^\\s*(${NAME})\\s+with\\s`);
const CONTROL_TYPES: ReadonlySet<string> = new Set(['Number', 'Bool', 'Button', 'Choice', 'Input']);
const LABEL_TEXT = /(\blabel\s*=\s*)"([^"]*)"/;
const PLACE_DOCK = /(\bplace\s*=\s*)dock\b/;
const MAX_CAPTION = 120;

/** The range part of a slider's own line, as written (`0..10 step 0.5`), so bounds that are expressions stay live. */
function rangeText(definition: string): string | undefined {
  const m = /\sin\s+(.+?)(?:\s+with\s.*)?$/s.exec(definition);
  return m ? (m[1] as string).trim() : undefined;
}

function numberOf(figure: Figure, text: string): number | undefined {
  const probe = checkExprProbe(figure, text, new Map());
  if (!('checked' in probe) || probe.checked.expr?.ty.k !== 'Number') return undefined;
  const v = evalTNode(figure, probe.checked.expr as TNode, {});
  return v.defined && typeof v.value === 'number' ? v.value : undefined;
}

export function numbersLineRewrite(host: unknown, text: string): LineRewrite | undefined {
  const figure = host as Figure;

  // a with min = 0, max = 20, step = auto
  const rr = parseRangeRestyle(text);
  if (rr && rr.others.length === 0) {
    const view = figure.get(rr.target);
    if (!view || view.type !== 'Number') return undefined;
    if (!view.free) {
      const inputs = view.inputs.map((id) => figure.get(id)?.name).filter((n): n is string => n !== undefined);
      return {
        error: numbersError('not_free', AT, { name: view.name, inputs: inputs.join(', '), depends_on: inputs.join(', ') }, {
          token: view.name,
          hint: `${view.name} is computed${inputs.length > 0 ? ` from ${inputs.join(', ')}` : ''}, so it cannot have a range. Only a number that holds its own value can be a slider.`,
          related: inputs,
        }),
      };
    }
    // min = none or max = none: the number stops being a slider and keeps its value
    if (rr.items.some((i) => i.key !== 'step' && i.value === 'none')) {
      const v = figure.value(view.id);
      return typeof v === 'number' && Number.isFinite(v) ? { text: `${view.name} = ${numberSource(v)}`, dropRange: true } : undefined;
    }
    let lo = view.range?.min;
    let hi = view.range?.max;
    let step: number | 'auto' = view.range?.step ?? 'auto';
    for (const item of rr.items) {
      if (item.key === 'step' && (item.value === 'auto' || item.value === 'none')) {
        step = 'auto';
        continue;
      }
      const v = numberOf(figure, item.value);
      if (v === undefined) return undefined;
      if (item.key === 'min') lo = v;
      else if (item.key === 'max') hi = v;
      else step = v;
    }
    if (lo === undefined || hi === undefined) {
      return {
        error: numbersError('bad_range', AT, { why: `${view.name} has no range yet, so it needs both ends` }, {
          token: view.name,
          hint: `Give both: ${view.name} with min = 0, max = 10.`,
        }),
      };
    }
    return { text: rangeLine(view.name, lo, hi, step) };
  }

  // P with showIf = none: the condition goes away
  if (SHOW_NONE.test(text) && /\swith\s/.test(text)) return { text: text.replace(SHOW_NONE, '$1true') };

  // a with label = "Angle": a text label on a control is its caption; place = dock is the word, not a name
  const styled = CONTROL_WITH.exec(text);
  const control = styled ? figure.get(styled[1] as string) : undefined;
  if (styled && control && CONTROL_TYPES.has(control.type)) {
    const label = LABEL_TEXT.exec(text);
    if (label && (label[2] as string).length > MAX_CAPTION) {
      return {
        error: numbersError('limit', AT, { max: MAX_CAPTION, what: 'label characters', limit: 'caption_length', got: (label[2] as string).length }, {
          token: control.name,
          hint: `A label holds at most ${MAX_CAPTION} characters. Shorten it.`,
        }),
      };
    }
    const out = text.replace(LABEL_TEXT, 'caption = "$2", label = caption').replace(PLACE_DOCK, '$1"dock"');
    if (out !== text) return { text: out };
  }

  // a = 5 on a slider: the slider stays, with its range
  const plain = PLAIN_DEFINE.exec(text);
  if (plain) {
    const view = figure.get(plain[1] as string);
    const range = view && view.free && view.range ? rangeText(view.definition) : undefined;
    if (view && range !== undefined) {
      return { text: `${view.name} = ${plain[2] as string} in ${range}`, notices: [makeNotice('range_kept', { name: view.name, range })] };
    }
  }

  // a = 3.3 in 0..10 step 0.5: an initial value off the grid goes to the nearest step
  const slider = SLIDER_DEFINE.exec(text);
  if (slider) {
    const [, name, v, lo, hi, st, rest] = slider as unknown as [string, string, string, string, string, string, string | undefined];
    const out = commit(Number(v), { lo: Number(lo), hi: Number(hi), step: Number(st), unit: 'none', source: 'redefine' });
    if (out.ok && out.snapped && out.value !== Number(v) && Number(st) > 0 && Number(lo) < Number(hi)) {
      const notices: Notice[] = [makeNotice('snapped', { name, value: numberSource(out.value), from: Number(v), to: out.value })];
      return { text: `${name} = ${numberSource(out.value)} in ${lo}..${hi} step ${st}${rest ?? ''}`, notices };
    }
  }

  // θ = 30deg: the unit the value was written in is the unit it is shown in
  const angle = ANGLE_DEFINE.exec(text);
  if (angle && !figure.get(angle[1] as string)) {
    const unit = inferUnitFromDefinition(angle[2] as string);
    if (unit !== undefined && unit !== 'rad') return { notices: [makeNotice('unit_inferred', { name: angle[1] as string, unit })] };
  }
  return undefined;
}

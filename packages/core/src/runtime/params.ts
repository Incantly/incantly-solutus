import type { Param, ParamOptions } from '../api/types';
import type { ControlKind } from '../protocol/ui';
import { SceneApiError } from '../scene/errors';

export interface ParamState {
  readonly name: string;
  readonly label: string;
  readonly unit: string;
  readonly note: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  value: number;
  readonly handle: Param;
  readonly kind: ControlKind;
  /** Choice labels, or tone names for a colour. */
  readonly options: readonly string[];
  readonly buttons: boolean;
  /** The parameter a link keeps in step with this one. */
  linked: string | null;
}

export interface ControlShape {
  readonly kind: ControlKind;
  readonly options: readonly string[];
  readonly buttons: boolean;
  /** Extra read-only properties on the handle, such as `on` or `selected`. */
  readonly extras?: (state: ParamState) => PropertyDescriptorMap;
}

const SLIDER: ControlShape = { kind: 'slider', options: [], buttons: false };

const NAME = /^[A-Za-z][\w ]{0,39}$/;

/** Rounds away floating-point noise such as 0.30000000000000004. */
export const tidy = (value: number) => Number(value.toPrecision(12));

export function snap(state: Pick<ParamState, 'min' | 'max' | 'step'>, value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  const clamped = Math.min(state.max, Math.max(state.min, value));
  const snapped = state.min + Math.round((clamped - state.min) / state.step) * state.step;
  return tidy(Math.min(state.max, Math.max(state.min, snapped)));
}

export function createParamState(name: string, options: ParamOptions, restored: number | undefined, shape: ControlShape = SLIDER): ParamState {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new SceneApiError(`Parameter name "${String(name)}" must start with a letter and use letters, digits, spaces or _`);
  }
  const { min, max, value } = options;
  if (![min, max, value].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new SceneApiError(`Parameter "${name}" needs finite min, max and value`);
  }
  if (!(min < max)) throw new SceneApiError(`Parameter "${name}" needs min < max`);
  if (value < min || value > max) throw new SceneApiError(`Parameter "${name}" default ${value} is outside [${min}, ${max}]`);
  const step = options.step ?? tidy((max - min) / 100);
  if (!(typeof step === 'number' && Number.isFinite(step) && step > 0)) {
    throw new SceneApiError(`Parameter "${name}" needs a positive step`);
  }
  const state: ParamState = {
    name,
    label: options.label ?? name,
    unit: options.unit ?? '',
    note: options.note ?? '',
    min,
    max,
    step,
    defaultValue: value,
    value,
    handle: undefined as unknown as Param,
    kind: shape.kind,
    options: shape.options,
    buttons: shape.buttons,
    linked: null,
  };
  if (restored !== undefined && Number.isFinite(restored)) state.value = snap(state, restored);
  (state as { handle: Param }).handle = Object.freeze(
    Object.defineProperties(
      {},
      {
        name: { value: name, enumerable: true },
        min: { value: min, enumerable: true },
        max: { value: max, enumerable: true },
        value: { get: () => state.value, enumerable: true },
        ...(shape.extras?.(state) ?? {}),
      },
    ),
  ) as Param;
  return state;
}

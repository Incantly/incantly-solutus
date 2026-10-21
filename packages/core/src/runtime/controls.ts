import type { ChoiceOptions, ColorOptions, ParamOptions, Tone, ToggleOptions } from '../api/types';
import { SceneApiError } from '../scene/errors';
import { TONES } from '../scene/handles';
import type { ControlShape, ParamState } from './params';

/**
 * Controls other than sliders (CT-3). Each is a parameter holding a number,
 * so the model, persistence, steps, presets and undo treat them all alike:
 * a toggle holds 0 or 1, a choice and a colour hold an index.
 */

const MAX_OPTIONS = 8;

export function toggleControl(name: string, options: ToggleOptions): { readonly param: ParamOptions; readonly shape: ControlShape } {
  if (typeof options?.value !== 'boolean') throw new SceneApiError(`Toggle "${name}" needs value: true or false`);
  return {
    param: { min: 0, max: 1, step: 1, value: options.value ? 1 : 0, ...(options.label ? { label: options.label } : {}), ...(options.note ? { note: options.note } : {}) },
    shape: {
      kind: 'toggle',
      options: [],
      buttons: false,
      extras: (state: ParamState) => ({ on: { get: () => state.value === 1, enumerable: true } }),
    },
  };
}

export function choiceControl(name: string, options: ChoiceOptions): { readonly param: ParamOptions; readonly shape: ControlShape } {
  const list = options?.options;
  if (!Array.isArray(list) || list.length < 2 || list.length > MAX_OPTIONS) {
    throw new SceneApiError(`Choice "${name}" needs from 2 to ${MAX_OPTIONS} options`);
  }
  const labels = list.map((option, i) => {
    if (typeof option !== 'string' || option.trim() === '' || option.length > 40) {
      throw new SceneApiError(`Choice "${name}" option ${i + 1} must be short text`);
    }
    return option;
  });
  if (new Set(labels).size !== labels.length) throw new SceneApiError(`Choice "${name}" has the same option twice`);
  const value = options.value ?? 0;
  if (!Number.isInteger(value) || value < 0 || value >= labels.length) {
    throw new SceneApiError(`Choice "${name}" value must be an option index from 0 to ${labels.length - 1}`);
  }
  const frozen = Object.freeze([...labels]);
  return {
    param: { min: 0, max: labels.length - 1, step: 1, value, ...(options.label ? { label: options.label } : {}), ...(options.note ? { note: options.note } : {}) },
    shape: {
      kind: 'choice',
      options: frozen,
      buttons: options.buttons === true,
      extras: (state: ParamState) => ({ selected: { get: () => frozen[state.value] ?? frozen[0], enumerable: true } }),
    },
  };
}

export function colorControl(name: string, options: ColorOptions): { readonly param: ParamOptions; readonly shape: ControlShape } {
  const tones = (options?.options ?? ['a', 'b', 'c', 'lit']) as readonly Tone[];
  if (!Array.isArray(tones) || tones.length < 2 || tones.length > MAX_OPTIONS) throw new SceneApiError(`Colour "${name}" needs from 2 to ${MAX_OPTIONS} tones`);
  for (const tone of tones) if (!TONES.has(tone)) throw new SceneApiError(`Colour "${name}": "${String(tone)}" is not a tone`);
  const value = tones.indexOf(options.value);
  if (value < 0) throw new SceneApiError(`Colour "${name}" starts on "${String(options?.value)}", which is not one of its tones`);
  const frozen = Object.freeze([...tones]);
  return {
    param: { min: 0, max: tones.length - 1, step: 1, value, ...(options.label ? { label: options.label } : {}) },
    shape: {
      kind: 'color',
      options: frozen,
      buttons: true,
      extras: (state: ParamState) => ({ tone: { get: () => frozen[state.value] ?? frozen[0], enumerable: true } }),
    },
  };
}

/**
 * The `change` event a write raises for host listeners (controls-scripting 3.6, agent.md 4).
 * One place builds it, so every write path reports a dropdown the same way: the chosen value and its 1-based index.
 */

import type { ObjId } from '../../contracts/values';
import type { Figure } from '../../graph/figure';
import { valueText } from '../../language/runtime';
import type { ControlEvent } from './types';

/** The `change` event of an object after a write, or undefined when the object is gone. */
export function changeEventOf(figure: Figure, id: ObjId, by: 'learner' | 'host'): ControlEvent | undefined {
  const view = figure.get(id);
  if (!view) return undefined;
  const raw = figure.value(id);
  if (view.type === 'Choice') {
    const state = raw as { value?: unknown; index?: unknown } | undefined;
    if (state && typeof state === 'object' && typeof state.index === 'number') {
      const chosen = typeof state.value === 'string' ? state.value : valueText(state.value);
      return { event: 'change', name: view.name, type: view.type, value: chosen, index: state.index, by };
    }
  }
  return { event: 'change', name: view.name, type: view.type, value: valueText(raw), by };
}

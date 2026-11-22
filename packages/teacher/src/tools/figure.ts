/**
 * The `figure` tool (core design 10): what is on the figure now, so the model describes facts and not its intent.
 * Per object: name, type, value summary, visible, and why it is undefined.
 */
import { defineTool, ok } from './schema';
import type { JsonSchema, ToolDef } from './types';

/** The most objects one `figure` result lists; the rest are counted in `omitted`. */
export const FIGURE_MAX_OBJECTS = 100;
export const FIGURE_UNDEFINED_MAX = 20;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    names: { type: 'array', description: 'Only these objects.', items: { type: 'string' }, maxItems: 50 },
    type: { type: 'string', description: 'Only objects of this type, such as Point or Circle.' },
  },
};

export const figureTool: ToolDef = defineTool({
  name: 'figure',
  description: 'Read the figure: every object with its name, type, value, whether it is visible and why it is undefined. Optional filters: names, type.',
  schema: SCHEMA,
  body(target, input) {
    const names = Array.isArray(input['names']) ? new Set(input['names'] as string[]) : undefined;
    const type = typeof input['type'] === 'string' ? input['type'] : undefined;
    const summary = target.figureSummary();
    const reasons = new Map(target.undefinedObjects().map((u) => [u.name, u.reason]));
    const { list, truncated } = target.objects();
    const picked = list.filter((o) => (names === undefined || names.has(o.name)) && (type === undefined || o.type === type));
    const shown = picked.slice(0, FIGURE_MAX_OBJECTS);
    return ok({
      mode: summary.mode,
      t: summary.t,
      view: { x0: summary.view.x0, x1: summary.view.x1, y0: summary.view.y0, y1: summary.view.y1 },
      count: picked.length,
      objects: shown.map((o) => ({
        name: o.name,
        type: o.type,
        summary: o.summary,
        visible: o.visible,
        ...(reasons.has(o.name) ? { reason: reasons.get(o.name) as string } : {}),
      })),
      ...(picked.length > shown.length ? { omitted: picked.length - shown.length } : {}),
      ...(truncated ? { truncated: true } : {}),
      undefined: summary.undefined.slice(0, FIGURE_UNDEFINED_MAX),
    });
  },
});

/**
 * Shared screen-reader and `figure` words (graphics-view design 15).
 * `Drawable.describe()` and the teacher's `figure` tool build from these
 * templates so the model and the learner hear the same words. The kernel
 * supplies preformatted value text; this file owns the sentences.
 */

export type DescribedRole = 'free' | 'dependent' | 'onPath';

export function describePoint(name: string, posText: string, role: DescribedRole, extra: string | null): string {
  const base = `Point ${name} at ${posText}.`;
  if (role === 'free') return `${base} Free, can be moved.`;
  if (role === 'onPath') return `${base} On a path, can slide.`;
  return extra !== null ? `${base} ${extra}.` : `${base} Dependent.`;
}

export function describeSegment(name: string, from: string, to: string, lengthText: string): string {
  return `Segment ${name} from ${from} to ${to}, length ${lengthText}.`;
}

export function describeVector(name: string, vecText: string, lengthText: string): string {
  return `Vector ${name} ${vecText}, length ${lengthText}.`;
}

export function describeLine(name: string, throughText: string): string {
  return `Line ${name} through ${throughText}.`;
}

export function describeCircle(name: string, centre: string, radiusText: string): string {
  return `Circle ${name} centre ${centre}, radius ${radiusText}.`;
}

export function describeArc(name: string, centre: string, radiusText: string, spanText: string): string {
  return `Arc ${name} centre ${centre}, radius ${radiusText}, ${spanText}.`;
}

export function describePolygon(name: string, vertexCount: number, areaText: string | null): string {
  return areaText === null
    ? `Polygon ${name} with ${vertexCount} vertices.`
    : `Polygon ${name} with ${vertexCount} vertices, area ${areaText}.`;
}

export function describeFunction(name: string, spokenDef: string): string {
  return `Function ${name} of x equals ${spokenDef}.`;
}

export function describeCurve(name: string, kindText: string): string {
  return `Curve ${name}, ${kindText}.`;
}

export function describeRegion(name: string, areaText: string | null): string {
  return areaText === null ? `Region ${name}.` : `Region ${name}, area ${areaText}.`;
}

export function describeAngle(name: string, valueText: string): string {
  return `Angle ${name}, ${valueText}.`;
}

export function describeSlider(name: string, valueText: string, loText: string, hiText: string, stepText: string): string {
  return `Slider ${name}, value ${valueText}, from ${loText} to ${hiText} in steps of ${stepText}.`;
}

export function describeBool(name: string, value: boolean): string {
  return `${name} is ${value ? 'checked' : 'unchecked'}.`;
}

export function describeText(name: string, content: string): string {
  return `Text ${name}: ${content}.`;
}

export function describeParticles(name: string, count: number, alt: string | null): string {
  if (alt !== null && alt !== '') return `Particle system ${name}, ${alt}.`;
  return `Particle system ${name}, ${count.toLocaleString('en-US')} particles.`;
}

export function describeTrace(name: string, pointCount: number): string {
  return `Trace of ${name}, ${pointCount} points.`;
}

export function describeUndefined(name: string, typeLabel: string, reasonText: string): string {
  return `${typeLabel} ${name} is undefined: ${reasonText}.`;
}

export function describeHidden(name: string, typeLabel: string): string {
  return `${typeLabel} ${name} is hidden.`;
}

export function describeFigure(count: number): string {
  return count === 1 ? 'Figure, 1 object.' : `Figure, ${count} objects.`;
}

export function describeMove(name: string, toText: string): string {
  return `${name} moved to ${toText}.`;
}

export function describeAdded(typeLabel: string, name: string, summary: string): string {
  return `Added ${typeLabel} ${name}, ${summary}.`;
}

/** Plain words for undefined reasons the view surfaces (errors.md 3). */
export const VIEW_REASON_TEXT: Readonly<Record<string, string>> = {
  not_finite: 'a coordinate is not a finite number',
  outside_range: 'it is hidden by a show condition',
  path_undefined: 'its path has no value right now',
  degenerate_view: 'the view has no size yet',
  plot_failed: 'the plotter could not draw it',
};

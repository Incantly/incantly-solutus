/**
 * Failure classes closed so far (RP-12, PRD 27.7). A failure that keeps
 * coming back becomes a kit function or an engine behaviour that removes its
 * cause, or at least a core rule that names it; the check that caught it
 * stays, and a test keeps the class closed. The dashboard marks each
 * recurring failure with what closed its class, or names the rule against it,
 * or says it is open: the next one to close.
 */

export interface ClosedClass {
  /** The failing check or validator rule, as failure records name it. */
  readonly check: string;
  /** The failures of that check it covers, by the words of their report; without it, every failure of the check. */
  readonly match?: RegExp;
  /** A kit function or an engine behaviour removes the cause. A rule only names it, so the class stays open to a kit function. */
  readonly by: 'kit' | 'engine' | 'rule';
  /** What closed it, in a sentence. */
  readonly fix: string;
  /** The test that keeps it closed: a file under packages/, and the test's name. */
  readonly test: { readonly file: string; readonly name: string };
}

export const CLOSED_CLASSES: readonly ClosedClass[] = [
  {
    check: 'paused-change',
    by: 'engine',
    fix: 'A parameter changed while paused redraws once with dt = 0, so a figure drawn from its model in onFrame shows the change (the paused-slider bug of PRD 21.1; rule 5).',
    test: { file: 'core/test/runtime.test.ts', name: 'redraws once with dt = 0 when a parameter changes while paused' },
  },
  {
    check: 'budget',
    by: 'kit',
    fix: 'stage.dots draws a cloud of small dots on a canvas layer as one element, and a drawing near its budget is warned to use it (SV-12).',
    test: { file: 'core/test/probe.test.ts', name: 'passes a drawing near its element budget, with a warning that suggests dots (SV-12)' },
  },
  {
    check: 'mount',
    match: /can already be dragged/,
    by: 'engine',
    fix: 'A later drag on an element says how it drags instead of failing at mount.',
    test: { file: 'core/test/graph-interaction.test.ts', name: 'lets a later drag on a handle say how it drags, instead of failing' },
  },
  {
    check: 'mount',
    match: /is already the part/,
    by: 'engine',
    fix: "A later part() on an element or 3D object that is a part already renames it, with the later label and info, so a scene can name a ready-made model's pieces in its plan's words.",
    test: { file: 'core/test/kits-space3d.test.ts', name: 'lets a later part() rename an object that is a part already, as a model names its pieces' },
  },
  {
    check: 'runs',
    match: /made without a label/,
    by: 'kit',
    fix: 'A 3D arrow made without a label gets one the first time label() is called, so a readout at its tip needs no option at creation.',
    test: { file: 'core/test/kits-space3d.test.ts', name: 'gives an arrow made without a label one the first time it is labelled' },
  },
  {
    check: 'unknown-tone',
    match: /"water" is not a tone/,
    by: 'kit',
    fix: 'A water tone for liquids, in light, dark and every palette, listed with the other tones in the core rules (rule 6).',
    test: { file: 'core/test/kits-physics2d.test.ts', name: 'draws the liquid in the water tone, which the theme gives a light and a dark value (6.9a)' },
  },
  {
    check: 'unknown-property',
    match: /handles have no property "handle"/,
    by: 'kit',
    fix: 'Every element has a handle that is itself, and a graph item stands for its drawn handle.',
    test: { file: 'core/test/scene.test.ts', name: 'lets a graph item stand for its handle, gives every element a handle, and names what it needs when neither fits' },
  },
  {
    check: 'unknown-sdk-call',
    by: 'rule',
    fix: 'Rule 13: only the catalog and the contract; the validator names the helper a scene meant, such as inc.calc.integral for inc.calc.integrate, so one repair finds it.',
    test: { file: 'core/test/helpers.test.ts', name: 'suggests the helper a scene meant: a close name, or two names joined' },
  },
  {
    check: 'parts',
    by: 'rule',
    fix: 'Rule 8: register every planned part; plans name only things drawn in the figure as parts, and graph.part names a graph item as stage.part does an element.',
    test: { file: 'core/test/graph-interaction.test.ts', name: 'names a graph item as a part, as stage.part does for an element' },
  },
];

/** What has closed, or named, the class of one failure: by its check, and by its report's words where a closure names them. */
export function closureFor(report: { readonly check: string; readonly summary: string; readonly text?: string }): ClosedClass | null {
  const words = `${report.summary}\n${report.text ?? ''}`;
  return CLOSED_CLASSES.find((closed) => closed.check === report.check && (closed.match === undefined || closed.match.test(words))) ?? null;
}

/** Whether a closure removes the cause, rather than naming it in a rule. */
export function removesCause(closed: ClosedClass): boolean {
  return closed.by !== 'rule';
}

/**
 * Failure classes closed so far (RP-12, PRD 27.7). A failure that keeps
 * coming back becomes a kit function or an engine behaviour that removes its
 * cause, or at least a core rule that names it; the check that caught it
 * stays, and a test keeps the class closed. The dashboard marks each
 * recurring failure with what closed its class, or says it is open: the next
 * one to close.
 */

export interface ClosedClass {
  /** The failing check or validator rule, as failure records name it. */
  readonly check: string;
  /** A kit function, an engine behaviour, or a core rule. */
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
    check: 'unknown-sdk-call',
    by: 'kit',
    fix: 'The validator names the helper a scene meant, such as inc.calc.integral for inc.calc.integrate, so one repair finds it (rule 13).',
    test: { file: 'core/test/helpers.test.ts', name: 'suggests the helper a scene meant: a close name, or two names joined' },
  },
  {
    check: 'unknown-method',
    by: 'kit',
    fix: 'The forms scenes reach for work: a graph item stands for its handle, every element has a handle, and inc.path.polyline and inc.shapes.resistor draw what line and zigzag draw.',
    test: { file: 'core/test/scene.test.ts', name: 'lets a graph item stand for its handle, gives every element a handle, and names what it needs when neither fits' },
  },
  {
    check: 'mount',
    by: 'engine',
    fix: 'A later drag on an element says how it drags instead of failing at mount.',
    test: { file: 'core/test/graph-interaction.test.ts', name: 'lets a later drag on a handle say how it drags, instead of failing' },
  },
  {
    check: 'unknown-tone',
    by: 'kit',
    fix: 'A water tone for liquids, in light, dark and every palette, listed with the other tones in the core rules (rule 6).',
    test: { file: 'core/test/kits-physics2d.test.ts', name: 'draws the liquid in the water tone, which the theme gives a light and a dark value (6.9a)' },
  },
  {
    check: 'parts',
    by: 'kit',
    fix: 'graph.part names a graph item as a part, as stage.part does an element, and plans name only things drawn in the figure as parts (rule 8).',
    test: { file: 'core/test/graph-interaction.test.ts', name: 'names a graph item as a part, as stage.part does for an element' },
  },
];

/** What closed the class of a failing check, or null while it is open. */
export function closureOf(check: string): ClosedClass | null {
  return CLOSED_CLASSES.find((closed) => closed.check === check) ?? null;
}

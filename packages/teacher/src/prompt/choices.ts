/**
 * What each choice of circle to ask asks the model to do (board agent.md 3, design 11.1), in our own words, so it goes in
 * the prompt as an instruction and not inside the person's material block. `ask` is the person's own sentence, which goes
 * in the material block; its instruction only says to answer it.
 */

/** The choices a circle offers; the same ids as the board's `CIRCLE_CHOICES`. */
export const CHOICE_IDS = ['graph', 'formula', 'solve', 'steps', 'measure', 'geometry', 'explain', 'animate', 'slider', 'ask'] as const;
export type ChoiceId = (typeof CHOICE_IDS)[number];

export const isChoiceId = (x: unknown): x is ChoiceId => typeof x === 'string' && (CHOICE_IDS as readonly string[]).includes(x);

const ASKS: Readonly<Record<ChoiceId, string>> = {
  graph: 'Graph what is circled (a curve, a formula or a table of values): one figure card with its lines, placed near the circle, and an arrow from the circle to it. Under the card, write a short hand-style caption.',
  formula: 'Write the formula of what is circled as maths ($...$) in a write action placed near the circle. If the circle holds a curve, fit the simplest formula that matches it.',
  solve: 'Solve what is circled (an equation or a system). Make one figure card whose lines show the solution, near the circle, and write the answer beside it as maths.',
  steps: 'Show the steps of the solution of what is circled, in order: one short write action for each step ($...$ for maths), placed one below the other near the circle.',
  measure: 'Measure what is circled (lengths, angles, areas): make a geometry figure card of it with the measurements as lines, near the circle, and write the results as maths beside it.',
  geometry: 'Make a geometry figure card of what is circled (points, lines, circles, polygons, with the names it shows), near the circle, and an arrow from the circle to it.',
  explain: 'Explain what is circled in two or three short plain sentences: each a hand-style write action, placed near the circle one below the other.',
  animate: 'Make a figure card of what is circled that moves with the film time: its lines use a number that changes with time, so playing the card shows the motion. Place it near the circle.',
  slider: 'Make a figure card of what is circled with one free number the person can drag (a slider) for the value that matters. Place it near the circle.',
  ask: 'Answer the question in the material block about what is circled, with board actions placed near the circle.',
};

/** The instruction a choice gives the model. */
export const choiceAsk = (choice: ChoiceId): string => ASKS[choice];

/** The app mode a choice's figure cards use: geometry for the two that are about shapes, graphing for the rest. */
export const choiceMode = (choice: ChoiceId): string => (choice === 'measure' || choice === 'geometry' ? 'geometry' : 'graphing');

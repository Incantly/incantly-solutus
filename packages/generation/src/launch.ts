import type { BenchRequest } from './bench';

/**
 * The launch set (PRD 17.8): the twelve concepts every change to the rules or
 * the kit is measured against, two learner phrasings each.
 */
const LAUNCH: ReadonlyArray<readonly [id: string, concept: string, phrasings: readonly [string, string]]> = [
  ['projectile', 'projectile motion', ['Explain projectile motion for a physics student.', 'Why does a ball thrown at 45 degrees go the furthest?']],
  ['buoyancy', 'buoyancy', ['Show me why some things float and others sink.', "Explain buoyancy and Archimedes' principle with a block in water."]],
  ['magnets', 'bar magnets', ['Show the magnetic field around a bar magnet.', 'What happens when two bar magnets are brought close together?']],
  ['sine', 'sine wave', ['Show me how amplitude, frequency and phase change a sine wave.', 'Make an interactive graph of y = A*sin(wx + phi).']],
  ['pendulum', 'simple pendulum', ['How does the length of a pendulum change its period?', 'Simulate a simple pendulum and show its energy.']],
  ['spring', 'spring-mass oscillator', ['Show a mass on a spring oscillating.', 'How do mass and spring stiffness change the period of oscillation?']],
  ['ohm', "Ohm's law circuit", ["Explain Ohm's law with a simple circuit.", 'Show how current changes when I change the voltage or the resistance.']],
  ['lens', 'lens ray diagram', ['Draw a ray diagram for a convex lens.', 'Show me where the image forms when I move the object closer to a lens.']],
  ['titration', 'titration curve', ['Show a titration curve for a strong acid and a strong base.', 'Explain the equivalence point on a titration curve.']],
  ['gas', 'ideal gas particles', ['Show gas particles in a box and how temperature changes pressure.', 'Explain the ideal gas law with moving particles.']],
  ['normal', 'normal distribution', ['Show how the mean and standard deviation change a normal distribution.', 'Explain the 68-95-99.7 rule with a bell curve.']],
  ['derivative', 'derivative as slope', ['Show the derivative as the slope of the tangent line.', 'Help me understand what a derivative means on a graph.']],
];

export const LAUNCH_REQUESTS: readonly BenchRequest[] = LAUNCH.flatMap(([id, concept, phrasings]) =>
  phrasings.map((prompt, i) => ({ id: `${id}-${i + 1}`, concept, request: { prompt } })),
);

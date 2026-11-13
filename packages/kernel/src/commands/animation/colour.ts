/**
 * `Gradient(x, c1, c2, ...)` (animation-time 10.2): the colour at `x` on an even ramp through the colours. A command, as
 * every capital name is; particle formulas may call it (on the CPU and on the GPU), unlike other commands.
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { ColorValue } from '../../language/runtime';
import type { CommandSpec, ParamSpec } from '../../language/table';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const isColor = (v: unknown): v is ColorValue => {
  const c = v as Partial<ColorValue> | undefined;
  return typeof c?.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number' && typeof c.a === 'number';
};

/** The colour at `x` on an even ramp through `cs`: `x` is clamped to 0..1, and each channel is mixed linearly. */
export function gradientAt(x: number, cs: readonly ColorValue[]): ColorValue | undefined {
  const n = cs.length;
  if (n < 2 || Number.isNaN(x)) return undefined;
  const s = clamp(x, 0, 1) * (n - 1);
  const k = Math.min(n - 2, Math.floor(s));
  const f = s - k;
  const a = cs[k] as ColorValue;
  const b = cs[k + 1] as ColorValue;
  return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f, a: a.a + (b.a - a.a) * f };
}

/** Commands a particle formula may call: they have a GLSL form. */
export const PARTICLE_COMMANDS: ReadonlySet<string> = new Set(['Gradient']);

const P = (name: string, type: string): ParamSpec => ({ name, type });

const gradientRule = (): CommandRule => ({
  run(call: RuleCall) {
    const x = call.values[0];
    const cs = call.values.slice(1);
    if (typeof x !== 'number') return call.fail('input_undefined', 'the position is undefined');
    if (!cs.every(isColor)) return call.fail('input_undefined', 'a colour is undefined');
    return gradientAt(x, cs);
  },
});

export const GRADIENT_SPEC: CommandSpec = {
  name: 'Gradient',
  kind: 'object',
  group: 'animation',
  forms: [
    {
      params: [P('x', 'Number'), P('c1', 'Color'), P('c2', 'Color')],
      rest: P('more', 'Color'),
      returns: 'Color',
      summary: 'the colour at x (0 to 1) on an even ramp through the colours',
      explain: 'the colour at {0} on a ramp',
      rule: () => gradientRule(),
    },
  ],
};

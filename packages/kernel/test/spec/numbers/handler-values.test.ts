/**
 * `value` in handler steps (controls-scripting design 3.3): Text while typing (`input`), and the linked object's new
 * value for an input box's `change`.
 */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, commitInputText, registerNumbers, runHandler, typeInputText } from '@incantly/kernel';

const registry = new CommandRegistry();
registerNumbers(registry);
const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};

describe('value in input box handlers', () => {
  it('is a Text for input: a Text target is accepted and a Number one is refused', () => {
    const f = fig(['r = 2 in 0..5', 'seen = ""', 'q = Input(r)']);
    expect(f.apply('on q input: SetValue(seen, value)').ok).toBe(true);
    expect(f.apply('n = 0').ok).toBe(true);
    expect(f.apply('on q input: SetValue(n, value)').ok).toBe(false);
    typeInputText(f, 'q', '4.5');
    runHandler(f, 'q', 'input', { value: '4.5', by: 'learner' }, 'learner');
    expect(f.value('seen')).toBe('4.5');
    expect(f.value('r')).toBe(2);
  });

  it('is the linked number for change', () => {
    const f = fig(['r = 2 in 0..5', 'twice = 0', 'q = Input(r)', 'on q change: SetValue(twice, 2 * value)']);
    expect(commitInputText(f, 'q', '3', { by: 'learner' }).ok).toBe(true);
    expect(f.value('r')).toBe(3);
    expect(f.value('twice')).toBe(6);
  });
});

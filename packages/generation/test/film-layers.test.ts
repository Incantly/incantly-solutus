import { describe, expect, it } from 'vitest';
import { FILM_PLAN_FORMAT, parseStoryboardReply, validateStoryboard } from '../src/film';

/** A one-scene storyboard carrying every explainer layer. */
function layered() {
  return {
    film: { title: 'Layers', lengthTarget: 30 },
    scenes: [
      {
        id: 's1',
        idea: 'A ball with room for layers',
        kit: 'svg',
        beats: [
          { id: 'b1', say: 'First we open the section.' },
          { id: 'b2', say: 'The ball sits still while we write its rule.', write: { text: 'x = 3', math: true }, notes: ['The ball rests.'] },
          { id: 'b3', say: 'And that is all the ball does today.', notes: ['Nothing else moves.'] },
        ],
      },
    ],
  };
}

describe('film layers: plan validation', () => {
  it('accepts well-formed layers and passes them to the scene slice', () => {
    const validation = validateStoryboard(layered(), 30);
    expect(validation.problems).toEqual([]);
    expect(validation.ok).toBe(true);
    const beats = validation.storyboard!.scenes[0]!.beats;
    expect(beats[0]).not.toHaveProperty('card');
    expect(beats[1]!.write).toEqual({ text: 'x = 3', math: true });
    expect(beats[1]!.notes).toEqual(['The ball rests.']);
    expect(beats[2]!.notes).toEqual(['Nothing else moves.']);
  });

  it('parses layers out of a fenced plan reply', () => {
    const parsed = parseStoryboardReply(`\`\`\`json\n${JSON.stringify(layered())}\n\`\`\``);
    expect(parsed.problem).toBeNull();
    expect(validateStoryboard(parsed.value, 30).ok).toBe(true);
  });

  it('rejects malformed layers with the beat named', () => {
    const cases: Array<{ beat: unknown; match: string }> = [
      { beat: { id: 'b1', say: 'Hi there.', write: { text: '' } }, match: 'write needs text' },
      { beat: { id: 'b1', say: 'Hi there.', write: { text: 'x'.repeat(201) } }, match: 'at most 200' },
      { beat: { id: 'b1', say: 'Hi there.', write: 'x = 1' }, match: 'write must be' },
      { beat: { id: 'b1', say: 'Hi there.', notes: ['a', 'b', 'c', 'd', 'e'] }, match: 'at most 4' },
      { beat: { id: 'b1', say: 'Hi there.', notes: ['x'.repeat(141)] }, match: 'at most 140' },
      { beat: { id: 'b1', say: 'Hi there.', card: { kind: 'section', text: 'The ball' } }, match: 'sends a card' },
    ];
    for (const { beat, match } of cases) {
      const spec = { film: { title: 'T', lengthTarget: 30 }, scenes: [{ id: 's1', idea: 'I', kit: 'svg', beats: [beat] }] };
      const validation = validateStoryboard(spec, 30);
      expect(validation.ok).toBe(false);
      expect(validation.problems.some((problem) => problem.includes('b1') && problem.includes(match))).toBe(true);
    }
  });
});

describe('film layers: plan format', () => {
  it('shows layer shapes the validator accepts, on beats that validate clean', () => {
    // The example beats verbatim: whatever shapes the format teaches must pass.
    const start = FILM_PLAN_FORMAT.indexOf('{"film":');
    const example = JSON.parse(FILM_PLAN_FORMAT.slice(start, FILM_PLAN_FORMAT.indexOf('\nScenes:'))) as {
      scenes: Array<{ beats: unknown[] }>;
    };
    const beats = example.scenes[0]!.beats;
    expect(beats.map((beat) => (beat as { id: string }).id)).toEqual(['s1b1', 's1b2', 's1b3']);
    const spec = {
      film: { title: 'T', lengthTarget: 30 },
      scenes: [{ id: 's1', idea: 'I', kit: 'svg', durationShare: 1, beats }],
    };
    const validation = validateStoryboard(spec, 30);
    expect(validation.problems).toEqual([]);
    expect(validation.ok).toBe(true);
    const sliced = validation.storyboard!.scenes[0]!.beats;
    expect(sliced[0]!.write).toEqual({ text: 'a² + b² = c²', math: true });
    expect(sliced[1]!.notes).toEqual(['First this.']);
    expect(sliced[2]).not.toHaveProperty('card');
  });

  it('names the two fields and when to use them, briefly', () => {
    expect(FILM_PLAN_FORMAT).not.toContain('section card');
    expect(FILM_PLAN_FORMAT).not.toContain('recap card');
    expect(FILM_PLAN_FORMAT).toContain('write');
    expect(FILM_PLAN_FORMAT).toContain('notes');
    expect(FILM_PLAN_FORMAT).toContain('key equation or rule');
    expect(FILM_PLAN_FORMAT).toContain('step-by-step');
    // Every word costs plan latency: the paragraph stays two sentences.
    const paragraph = FILM_PLAN_FORMAT.slice(FILM_PLAN_FORMAT.indexOf('Layers, sparingly'));
    expect(paragraph.split('.').filter((s) => s.trim() !== '').length).toBeLessThanOrEqual(3);
  });
});

import { describe, expect, it } from 'vitest';
import { filmPresetFor, FILM_LENGTH_PRESETS } from '@incantly/core';
import { filmReferenceModel, filmReferenceSceneJs } from '../src/film-reference';
import { filmPlanPrompt, generateFilm, generateFilmScene, parseStoryboardReply, validateStoryboard } from '../src/film';
import { StubNarrator } from '../src/tts';

describe('the film stand-in model', () => {
  it.each([...FILM_LENGTH_PRESETS])('plans a valid storyboard with the preset scenes at %ss', async (length) => {
    const model = filmReferenceModel();
    const prompt = filmPlanPrompt({ prompt: 'How dots shift', lengthTarget: length });
    const reply = await model.complete({ purpose: 'plan', prompt, maxTokens: filmPresetFor(length).planTokens });
    const parsed = parseStoryboardReply(reply.text);
    expect(parsed.problem).toBeNull();
    const validation = validateStoryboard(parsed.value, length);
    expect(validation.problems).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(validation.storyboard!.scenes).toHaveLength(filmPresetFor(length).scenes);
    if (validation.storyboard!.scenes.length > 1) expect(validation.storyboard!.film.context).toBeDefined();
  });

  it('writes a scene that passes its checks with no repair', async () => {
    const model = filmReferenceModel();
    const slice = {
      id: 's1',
      idea: 'A dot shifts aside',
      kit: 'svg',
      beats: [
        { id: 's1b1', say: 'A dot appears at the center of the stage.', focus: 'Dot' },
        { id: 's1b2', say: 'Move the shift control and watch the dot glide aside.', focus: 'Dot' },
      ],
      cut: 'cut' as const,
      durationShare: 1,
    };
    const result = await generateFilmScene(slice, { palette: 'default', parts: ['Dot'], notation: '', units: { shift: 'px' }, tone: '' }, { model });
    expect(result.ok).toBe(true);
    expect(result.repairsUsed).toBe(0);
    expect(result.steps!.map((step) => step.say)).toEqual(slice.beats.map((beat) => beat.say));
  });

  it('rebuilds a repair from the spoken lines the prompt quotes', async () => {
    const model = filmReferenceModel();
    const broken = filmReferenceSceneJs([{ say: 'First line.' }, { say: 'Second line.' }]).replace('dot.at(shift.value - 20, 0);', 'fetch("https://example.com/x");');
    const reply = await model.complete({
      purpose: 'repair',
      prompt: { system: [{ text: 'REPAIR', cache: false }], user: `REPAIR 1 of 3\n\nThe fragments as they stand:\n\`\`\`html\n<div></div>\n\`\`\`\n\`\`\`css\n\n\`\`\`\n\`\`\`js\n${broken}\n\`\`\`` },
      maxTokens: 6000,
    });
    expect(reply.text).toContain('First line.');
    expect(reply.text).toContain('Second line.');
    expect(reply.text).not.toContain('fetch(');
  });

  it('makes a complete two-scene film through the real pipeline', async () => {
    const state = await generateFilm({ prompt: 'How dots shift', lengthTarget: 120 }, { model: filmReferenceModel(), narrator: new StubNarrator() });
    expect(state.failure).toBeNull();
    expect(state.fallback).toBeNull();
    expect(state.partial).toBe(false);
    expect(state.film).not.toBeNull();
    expect(state.scenes).toHaveLength(2);
    expect(state.timings.firstSceneMs).not.toBeNull();
  }, 60_000);
});

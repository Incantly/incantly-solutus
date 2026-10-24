import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { LATER_REQUESTS, LAUNCH_REQUESTS } from '../src/launch';
import { aboutScene, retrieveExample } from '../src/retrieve';

describe('retrieval (PRD 25.5)', () => {
  it('finds the reviewed scene every bench phrasing names, so each takes the library path', () => {
    for (const request of [...LAUNCH_REQUESTS, ...LATER_REQUESTS]) {
      expect(retrieveExample(request.request)?.id, request.request.prompt).toBe(request.example);
    }
  });

  it('matches a concept in any form of its word: diffusing, diffuses, diffusion', () => {
    for (const prompt of ['Show particles diffusing across a membrane.', 'How does oxygen diffuse into a cell?', 'Explain diffusion.']) {
      expect(retrieveExample({ prompt })?.id, prompt).toBe('diffusion');
    }
  });

  it('names no scene for a request about something else, or one it withholds', () => {
    expect(retrieveExample({ prompt: 'Explain photosynthesis in a leaf.' })).toBeNull();
    expect(retrieveExample({ prompt: 'Show particles diffusing across a membrane.' }, { withhold: ['diffusion'] })).toBeNull();
    expect(aboutScene('diffusion across a membrane. Particles spread down the gradient.', 'diffusion')).toBe(true);
    expect(Object.keys(REFERENCE_SCENES)).toContain('diffusion');
  });
});

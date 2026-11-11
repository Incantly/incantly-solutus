/**
 * performance.md 5 (budgets per figure) and graphics-view errors.md 6
 * (limits): over-budget behaviour for objects, particles, triangles, curve
 * samples and labels, and the `limit` error shape (`limit`, `value`, `max`).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGETS,
  capCurveSamples,
  checkLabelChars,
  checkLabels,
  checkObjects,
  checkParticles,
  checkTriangles,
} from '@incantly/view';
import { errOf } from './helpers';

describe('performance 5 default budgets', () => {
  it('5 objects 5,000; points and particles 50,000 (20,000 per system)', () => {
    expect(DEFAULT_BUDGETS.objects).toBe(5000);
    expect(DEFAULT_BUDGETS.pointsAndParticles).toBe(50000);
    expect(DEFAULT_BUDGETS.particlesPerSystem).toBe(20000);
  });

  it('5 triangles 200,000; curve samples 4,000 per curve; labels shown 300', () => {
    expect(DEFAULT_BUDGETS.triangles).toBe(200000);
    expect(DEFAULT_BUDGETS.curveSamplesPerCurve).toBe(4000);
    expect(DEFAULT_BUDGETS.labelsShown).toBe(300);
  });

  it('errors.md 6 label text 2,000 characters; export side 16,384; SVG 50,000 elements', () => {
    expect(DEFAULT_BUDGETS.labelChars).toBe(2000);
    expect(DEFAULT_BUDGETS.exportSidePx).toBe(16384);
    expect(DEFAULT_BUDGETS.svgElements).toBe(50000);
  });
});

describe('performance 5 objects', () => {
  it('5 up to 5,000 objects are accepted', () => {
    expect(checkObjects(0).ok).toBe(true);
    expect(checkObjects(4999).ok).toBe(true);
    expect(checkObjects(5000).ok).toBe(true);
  });

  it('5 the 5,001st object is refused with limit', () => {
    const e = errOf(checkObjects(5001), 'objects');
    expect(e.kind).toBe('limit');
  });

  it('errors.md 6 an overflow carries limit, value and max', () => {
    const e = errOf(checkObjects(6000), 'objects') as unknown as { params: Record<string, unknown> };
    const flat = JSON.stringify(e.params);
    expect(flat).toContain('6000');
    expect(flat).toContain('5000');
  });

  it('5 a custom limit is honoured', () => {
    expect(checkObjects(11, { ...DEFAULT_BUDGETS, objects: 10 }).ok).toBe(false);
    expect(checkObjects(10, { ...DEFAULT_BUDGETS, objects: 10 }).ok).toBe(true);
  });
});

describe('performance 5 points and particles', () => {
  it('5 a system of 20,000 particles in a figure of 20,000 is accepted', () => {
    expect(checkParticles(20000, 20000).ok).toBe(true);
  });

  it('5 a system over 20,000 particles is refused with limit', () => {
    expect(errOf(checkParticles(20001, 20001), 'system').kind).toBe('limit');
  });

  it('5 a figure over 50,000 points and particles is refused with limit', () => {
    expect(checkParticles(10000, 50000).ok).toBe(true);
    expect(errOf(checkParticles(10000, 50001), 'figure').kind).toBe('limit');
  });
});

describe('performance 5 triangles', () => {
  it('5 up to 200,000 triangles need no notice', () => {
    expect(checkTriangles(200000)).toBeNull();
    expect(checkTriangles(10)).toBeNull();
  });

  it('5 over 200,000 triangles gives a notice (round solids get fewer facets), not a refusal', () => {
    const n = checkTriangles(200001);
    expect(n).not.toBeNull();
    expect(n?.severity === 'info' || n?.severity === 'warning').toBe(true);
    expect((n?.message ?? '').length).toBeGreaterThan(0);
  });
});

describe('performance 5 labels', () => {
  it('5 300 labels are all shown', () => {
    const r = checkLabels(300);
    expect(r.hidden).toBe(0);
    expect(r.notice).toBeNull();
  });

  it('5 the lowest-priority labels over 300 are hidden, with a notice', () => {
    const r = checkLabels(350);
    expect(r.hidden).toBe(50);
    expect(r.notice).not.toBeNull();
  });

  it('5 hidden labels count is exact for 301', () => {
    expect(checkLabels(301).hidden).toBe(1);
  });
});

describe('performance 5 curve samples and label text', () => {
  it('5 the adaptive sampler stops at 4,000 samples per curve', () => {
    expect(capCurveSamples(100)).toBe(100);
    expect(capCurveSamples(4000)).toBe(4000);
    expect(capCurveSamples(4001)).toBe(4000);
    expect(capCurveSamples(1e6)).toBe(4000);
  });

  it('errors.md 6 a label of 2,000 characters is accepted, 2,001 is refused with limit', () => {
    expect(checkLabelChars(2000).ok).toBe(true);
    expect(errOf(checkLabelChars(2001), 'label').kind).toBe('limit');
  });
});

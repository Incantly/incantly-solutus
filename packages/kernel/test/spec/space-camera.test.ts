/** The camera object `space` (.kiro/specs/space-3d R3.1, R3.2; docs/features/space-3d design 8.1, 8.3, 8.4; errors 3 S005, S009). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerNumbers, registerSpace, space } from '../../src/index';

let f: Figure;
const DEG = Math.PI / 180;

beforeEach(() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerSpace(r);
  f = new Figure({ commands: r });
});

const ok = (...lines: string[]): void => {
  for (const line of lines) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
  }
};
const fail = (line: string): { kind: string; message: string; hint?: string; suggest: string[] } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const view = (): space.View3 => space.viewOf(f);
const def = (): string | undefined => f.get('space')?.definition;

describe('the space object (R3.1, design 8.1)', () => {
  it('without a camera line the view has the defaults', () => {
    expect(f.get('space')).toBeUndefined();
    expect(view()).toEqual(space.DEFAULT_VIEW3);
    expect(view().azimuth).toBeCloseTo(-40 * DEG, 12);
    expect(view().elevation).toBeCloseTo(22 * DEG, 12);
  });

  it('space with … makes the camera, then changes one property and keeps the others', () => {
    ok('space with azimuth = 40deg');
    expect(def()).toBe('space = Space(azimuth = 40deg)');
    expect(f.get('space')?.type).toBe('View3');
    expect(view().azimuth).toBeCloseTo(40 * DEG, 12);
    ok('space with zoom = 2, projection = persp');
    expect(view()).toMatchObject({ zoom: 2, projection: 'persp' });
    expect(view().azimuth).toBeCloseTo(40 * DEG, 12);
    ok('space with azimuth = 10deg');
    expect(view()).toMatchObject({ zoom: 2, projection: 'persp' });
    expect(view().azimuth).toBeCloseTo(10 * DEG, 12);
  });

  it('a property may be a formula of a slider, and the camera follows it', () => {
    ok('a = 1', 'space with azimuth = a * 10deg');
    expect(view().azimuth).toBeCloseTo(10 * DEG, 12);
    ok('a = 3');
    expect(view().azimuth).toBeCloseTo(30 * DEG, 12);
  });

  it('every camera line is one undo step, and the file keeps it', () => {
    ok('space with azimuth = 40deg', 'space with elevation = 60deg');
    f.undo();
    expect(view().elevation).toBeCloseTo(22 * DEG, 12);
    expect(view().azimuth).toBeCloseTo(40 * DEG, 12);
    expect(f.toScript()).toContain('space = Space(azimuth = 40deg)');
  });

  it('the camera shows in texts', () => {
    ok('space with azimuth = 30deg, zoom = 1.5');
    expect(space.spaceText((f.get('space')?.cell as { value?: unknown }).value)).toBe('camera ortho, azimuth 30°, elevation 22°, zoom 1.5');
  });
});

describe('bad values and names (errors 3 S004, S005, S009)', () => {
  it('a field of view out of range, zoom 0 and a tilt past the pole are bad_property_value with the range', () => {
    const e = fail('space with fov = 200deg');
    expect(e).toMatchObject({ kind: 'bad_property_value', message: 'fov must be between 5deg and 120deg.' });
    expect(e.hint).toMatch(/60deg/);
    expect(fail('space with zoom = 0').message).toBe('zoom must be above 0.');
    expect(fail('space with elevation = 120deg').kind).toBe('bad_property_value');
    expect(fail('space with obliqueFactor = 3').kind).toBe('bad_property_value');
    expect(f.get('space')).toBeUndefined();
  });

  it('projection = isometric is a preset, so it suggests ViewPreset(isometric)', () => {
    const e = fail('space with projection = isometric');
    expect(e.message).toBe('projection must be ortho, persp, oblique.');
    expect(e.suggest).toEqual(['ViewPreset(isometric)']);
  });

  it('a property the camera does not have is refused', () => {
    expect(fail('space with azimut = 10deg').message).toMatch(/azimut/);
  });

  it('space names only the camera, and only space may be one', () => {
    expect(fail('space = 3').kind).toMatch(/reserved_name|type_change/);
    expect(fail('cam = Space()').kind).toBe('reserved_name');
    ok('space with zoom = 2');
    expect(fail('space = (1, 2, 3)').kind).toMatch(/reserved_name|type_change/);
  });
});

describe('view lines (R3.2, design 8.3, 8.4)', () => {
  it('ViewPreset sets the exact angles, orthographic', () => {
    ok('space with projection = persp, zoom = 2', 'ViewPreset(top)');
    expect(view()).toMatchObject({ projection: 'ortho', zoom: 2 });
    expect(view().elevation).toBeCloseTo(90 * DEG, 12);
    ok('ViewPreset(isometric)');
    expect(view().azimuth).toBeCloseTo(45 * DEG, 6);
    expect(view().elevation).toBeCloseTo(Math.asin(1 / Math.sqrt(3)), 5);
    for (const name of space.VIEW_PRESETS) ok(`ViewPreset(${name})`);
  });

  it('an unknown preset is bad_option listing the views', () => {
    const e = fail('ViewPreset(sideways)');
    expect(e.kind).toBe('bad_option');
    expect(e.message).toMatch(/front, back, left, right, top, bottom, isometric/);
  });

  it('ViewReset goes back to the defaults', () => {
    ok('space with azimuth = 10deg, zoom = 3', 'ViewReset()');
    expect(view()).toEqual(space.DEFAULT_VIEW3);
  });

  it('ViewFacing looks straight at a plane from the nearer side, centred on it', () => {
    // the default camera is on the −x side of this plane (azimuth −40deg), so it looks from there
    ok('p = Plane((0, 0, 0), Vector(1, 0, 0))', 'ViewFacing(p)');
    expect(view().azimuth).toBeCloseTo(-90 * DEG, 6);
    expect(view().elevation).toBeCloseTo(0, 6);
    // from the +x side, the camera turns the short way: azimuth 90deg
    ok('space with azimuth = 100deg', 'ViewFacing(p)');
    expect(view().azimuth).toBeCloseTo(90 * DEG, 6);
    ok('g = Polygon((0, 0, 2), (2, 0, 2), (2, 2, 2))', 'ViewFacing(g)');
    expect(view().elevation).toBeCloseTo(90 * DEG, 6);
    expect(view().target).toEqual({ x: 1, y: 1, z: 2 });
    const e = fail('ViewFacing(nothing)');
    expect(e.kind).toBe('bad_option');
  });

  it('ViewAll centres on everything and zooms so it fits', () => {
    ok('A = (10, 10, 10)', 'B = (12, 10, 10)', 'ViewAll()');
    expect(view().target).toEqual({ x: 11, y: 10, z: 10 });
    // the ball of radius 1 with a tenth to spare fills the view of radius 6
    expect(view().zoom).toBeCloseTo(6 / 1.1, 4);
  });
});

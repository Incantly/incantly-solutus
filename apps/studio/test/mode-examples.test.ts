/** Examples per app mode (.kiro/specs/mode-examples R1, R2, R3). */
import { afterEach, describe, expect, it } from 'vitest';
import { EXAMPLES, examplesFor } from '../src/examples';
import { loadCasEngine } from '../src/registry';
import { mountStudio } from '../src/studio-page';
import type { Mounted } from '../src/studio-page';
import type { AppModeId } from '@incantly/modes';

describe('examples per app mode', () => {
  let root: HTMLElement | undefined;
  let m: Mounted | undefined;
  const mount = (mode: AppModeId): Mounted => {
    root = document.createElement('div');
    document.body.append(root);
    m = mountStudio(root, { raf: () => 1, caf: () => undefined, storage: null, mode });
    return m;
  };
  afterEach(() => {
    m?.dispose();
    root?.remove();
    m = undefined;
  });

  it('every example has a mode, and ids are unique (R1.1)', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) expect(e.modes.length).toBeGreaterThan(0);
  });

  it('each mode has examples, with more animation in geometry and particles in graphing (R2)', () => {
    const ids = (mode: AppModeId): string[] => examplesFor(mode).flatMap((g) => g.examples.map((e) => e.id));
    expect(ids('geometry').filter((id) => id.startsWith('geo-')).length).toBeGreaterThanOrEqual(3);
    expect(ids('graphing').filter((id) => id.startsWith('particles-')).length).toBeGreaterThanOrEqual(3);
    expect(ids('scientific').length).toBeGreaterThanOrEqual(3);
    expect(ids('cas').length).toBeGreaterThanOrEqual(3);
    expect(ids('probability').length).toBeGreaterThanOrEqual(3);
    expect(examplesFor('figure')).toEqual([]);
  });

  it('the menu shows only the mode\'s examples, and changes with the mode (R1.2)', () => {
    const s = mount('geometry');
    const opts = (): string[] => [...root!.querySelectorAll<HTMLOptionElement>('select.examples option')].map((o) => o.value).filter(Boolean);
    expect(opts()).toContain('geo-euler');
    expect(opts()).not.toContain('functions');
    s.modes.setMode('scientific');
    expect(opts()).toEqual(['sci-fractions', 'sci-powers', 'sci-everyday']);
    expect((root!.querySelector('select.examples') as HTMLElement).hidden).toBe(false);
  });

  it('classic lists its own first, then the others in groups (R1.3)', () => {
    mount('classic');
    const groups = [...root!.querySelectorAll('select.examples optgroup')].map((g) => g.getAttribute('label'));
    expect(groups).toEqual(['Classic', 'Geometry', 'Graphing', 'Probability', 'CAS', 'Scientific']);
  });

  it('geometry allows particles but not state() motion (R4)', () => {
    const s = mount('geometry');
    expect(s.session.submit('sp = Particles(count = 10, life = 1, pos = (u, v))').ok).toBe(true);
    const r = s.session.submit('st = state(0)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('mode_forbids');
    expect(examplesFor('geometry').flatMap((g) => g.examples.map((e) => e.id)).filter((id) => id.startsWith('geo-particles-')).length).toBeGreaterThanOrEqual(2);
  });

  it('in geometry, with no list, the play bar floats on the graph so a film can play', () => {
    const s = mount('geometry');
    s.loadExample('geo-euler');
    const clock = root!.querySelector('.clock') as HTMLElement;
    expect(clock.hidden).toBe(false);
    expect(clock.classList.contains('clock-float')).toBe(true);
    expect(clock.closest('.graph')).not.toBeNull();
    s.modes.setMode('graphing');
    expect(clock.closest('.panel')).not.toBeNull();
  });

  it('every example loads with no failed line in each of its modes (R1.4)', async () => {
    await loadCasEngine();
    const bad: string[] = [];
    for (const mode of ['classic', 'graphing', 'geometry', 'scientific', 'probability', 'cas'] as const) {
      const s = mount(mode);
      for (const e of EXAMPLES.filter((x) => x.modes.includes(mode))) {
        if (e.id === 'big-list') continue;
        const r = s.session.load(e.lines.join('\n'));
        if (r.errors.length > 0 || r.applied !== r.total) bad.push(`${mode}/${e.id}: ${r.errors.map((x) => `${x.line}: ${x.message}`).join(' | ')}`);
        else if (s.session.figure.objects().some((o) => !o.cell.defined && o.cell.reason !== 'pending')) {
          bad.push(`${mode}/${e.id}: undefined ${s.session.figure.objects().filter((o) => !o.cell.defined).map((o) => `${o.name} (${o.cell.reason})`).join(', ')}`);
        }
      }
      m?.dispose();
      root?.remove();
      m = undefined;
    }
    expect(bad).toEqual([]);
  });
});

/** Files (.kiro/specs/sdk R2; embed-files-export design 4, errors 3). */
import { describe, expect, it } from 'vitest';
import { FILE_LIMITS, assetProblem, createHeadlessApp, fromFragment, gzip, readFile } from '../../src/index';
import type { ApiError, IncantlyFile, LoadResult } from '../../src/index';
import { sha256 } from '@incantly/modes';

const loaded = (r: LoadResult | ApiError): LoadResult => {
  if ('area' in r) throw new Error(r.message);
  return r;
};
const failed = (r: LoadResult | ApiError): ApiError => {
  if (!('area' in r)) throw new Error('expected a file error');
  return r;
};

const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0));
const png = (data = PNG) => ({ mime: 'image/png' as const, encoding: 'base64' as const, data, sha256: sha256(data) });
const svg = (text: string) => {
  const data = btoa(text);
  return { mime: 'image/svg+xml' as const, encoding: 'base64' as const, data, sha256: sha256(data) };
};

describe('save (R2.2)', () => {
  it('the file holds the script, settings, clock, layout and metadata', () => {
    const app = createHeadlessApp({ mode: 'geometry', script: '@title "Triangles"\n@clock 0..30\nA = (1, 2)\n@angleunit degree\n@rounding 3s' });
    const f = app.save();
    expect(f).toMatchObject({ format: 'incantly', formatVersion: 1, mode: 'geometry', meta: { title: 'Triangles' }, clock: { range: [0, 30], t: 0, speed: 1, playing: false } });
    expect(f.script.startsWith('# incantly 1 mode=geometry\n')).toBe(true);
    expect(f.settings).toMatchObject({ angleUnit: 'degree', rounding: { mode: 'sig', digits: 3 }, language: 'en' });
    expect(f.views.panes).toEqual(['graphics']);
    expect(JSON.parse(app.saveText())).toEqual(f);
  });

  it('save is deterministic', () => {
    const a = createHeadlessApp({ script: 'a = 1\nb = a + 1' });
    const b = createHeadlessApp({ script: 'a = 1\nb = a + 1' });
    expect(a.saveText()).toBe(b.saveText());
  });
});

describe('load (R2.3)', () => {
  it('a saved file opens to the same figure, mode, view and clock', () => {
    const a = createHeadlessApp({ mode: 'geometry', script: '@clock 0..10\nA = (1, 2)\nB = (3, 4)\nM = Midpoint(A, B)' });
    a.view.keepRatio(false);
    a.view.set(-3, 3, -2, 2);
    a.clock.seek(4);
    const text = a.saveText();
    const b = createHeadlessApp();
    const r = loaded(b.load(text));
    expect(r).toMatchObject({ ok: true, migrated: false, failed: [], warnings: [] });
    expect(b.mode).toBe('geometry');
    expect(b.value('M')).toEqual({ x: 2, y: 3 });
    expect(b.view.get()).toMatchObject({ x0: -3, x1: 3 });
    expect(b.clock.t).toBe(4);
    expect(b.saved).toBe(true);
    expect(b.saveText()).toBe(text);
  });

  it('a plain script opens too; its header names the mode', () => {
    const app = createHeadlessApp();
    const r = loaded(app.load('# incantly 1 mode=geometry\nA = (0, 0)'));
    expect(r.applied).toBe(1);
    expect(app.mode).toBe('geometry');
  });

  it('failed lines are listed; the rest loads', () => {
    const app = createHeadlessApp();
    const r = loaded(app.load('a = 1\nb = Spline3D(a)\nc = a + 1'));
    expect(r.applied).toBe(2);
    expect(r.failed.map((e) => e.line)).toEqual([2]);
    expect(app.value('c')).toBe(2);
  });

  it('a file with nothing usable changes nothing', () => {
    const app = createHeadlessApp({ script: 'keep = 1' });
    const r = loaded(app.load('bad = nope'));
    expect(r.ok).toBe(false);
    expect(app.exists('keep')).toBe(true);
  });

  it('a bad shape is file_invalid with the path of the field', () => {
    const app = createHeadlessApp({ script: 'keep = 1' });
    const f = app.save() as unknown as Record<string, unknown>;
    const bad = { ...f, settings: { ...(f['settings'] as object), view: { x0: null, x1: 1, y0: 0, y1: 1, keepRatio: true } } };
    const e = failed(app.load(bad));
    expect(e).toMatchObject({ area: 'file', kind: 'file_invalid', detail: { path: 'settings.view.x0' } });
    expect(e.message).toBe('settings.view.x0 must be a finite number, got null.');
    expect(app.exists('keep')).toBe(true);
    expect(failed(app.load('{ not json')).kind).toBe('file_invalid');
    expect(failed(app.load({ format: 'other' })).kind).toBe('file_invalid');
  });

  it('a newer format is file_too_new; nothing is guessed', () => {
    const app = createHeadlessApp();
    const e = failed(app.load({ ...app.save(), formatVersion: 3 }));
    expect(e).toMatchObject({ kind: 'file_too_new', detail: { fileVersion: 3, supported: 1 } });
    expect(e.message).toBe('This file uses format 3; this app reads up to format 1.');
  });

  it('an older format is migrated', () => {
    const app = createHeadlessApp();
    const r = loaded(app.load({ format: 'incantly', formatVersion: 0, mode: 'graphing', script: 'a = 5' }));
    expect(r.migrated).toBe(true);
    expect(app.value('a')).toBe(5);
  });

  it('a mode this build does not have opens in graphing, and says so', () => {
    const app = createHeadlessApp();
    const r = loaded(app.load({ ...app.save(), mode: 'notes', script: 'a = 1' }));
    expect(app.mode).toBe('graphing');
    expect(r.modeAdjusted).toMatchObject({ from: 'notes', to: 'graphing' });
  });

  it('binary data is file_not_text; too large is file_too_large', () => {
    const app = createHeadlessApp();
    expect(failed(app.load('PK\u0003\u0004\u0000\u0000\u0001')).kind).toBe('file_not_text');
    expect(failed(app.load('x'.repeat(FILE_LIMITS.bytes + 1))).kind).toBe('file_too_large');
  });

  it('unknown keys and extensions are kept on a round trip', () => {
    const app = createHeadlessApp();
    const f = { ...app.save(), extensions: { teacher: { lesson: 3 } }, future: [1, 2] } as IncantlyFile;
    loaded(app.load(f));
    expect(app.save()).toMatchObject({ extensions: { teacher: { lesson: 3 } }, future: [1, 2] });
  });

  it('gzipped bytes open', async () => {
    const a = createHeadlessApp({ script: 'a = 7' });
    const b = createHeadlessApp();
    const r = loaded(await b.loadBytes(await gzip(a.saveText())));
    expect(r.ok).toBe(true);
    expect(b.value('a')).toBe(7);
  });
});

describe('assets (errors 3)', () => {
  it('good images are kept; bad ones dropped with a warning', () => {
    expect(assetProblem(png())).toBeUndefined();
    expect(assetProblem({ ...png(), mime: 'image/jpeg' })).toBe('it is not a JPEG');
    expect(assetProblem({ ...png(), sha256: 'x' })).toBe('its checksum does not match its data');
    expect(assetProblem(svg('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'))).toBeUndefined();
    expect(assetProblem(svg('<svg><script>alert(1)</script></svg>'))).toBe('the SVG holds a script');
    expect(assetProblem(svg('<svg onload="x()"></svg>'))).toBe('the SVG holds a script');
    expect(assetProblem(svg('<svg><image href="https://evil.example/a.png"/></svg>'))).toBe('the SVG links to something outside the file');
    const app = createHeadlessApp();
    const r = loaded(app.load({ ...app.save(), assets: { good: png(), bad: { ...png(), mime: 'image/webp' } } }));
    expect(Object.keys(app.assets)).toEqual(['good']);
    expect(r.warnings).toEqual([{ kind: 'asset_invalid', id: 'bad', message: 'bad was dropped: it is not a WebP image.' }]);
  });

  it('more than 200 assets is file_too_large', () => {
    const assets: Record<string, unknown> = {};
    for (let i = 0; i < 201; i++) assets[`a${i}`] = png();
    const app = createHeadlessApp();
    expect(failed(app.load({ ...app.save(), assets })).kind).toBe('file_too_large');
  });

  it('a cache that does not match the script is ignored with a warning', () => {
    const app = createHeadlessApp();
    const r = readFile({ ...app.save(), cache: { checksum: 'nope', values: {} } });
    expect('area' in r ? [] : r.warnings.map((w) => w.kind)).toEqual(['checksum_mismatch']);
  });
});

describe('links (R2.4)', () => {
  it('a figure goes into a URL fragment and back', async () => {
    const a = createHeadlessApp({ mode: 'geometry', script: 'A = (1, 2)\nB = (3, 4)\ns = Segment(A, B)' });
    const frag = await a.toFragment();
    expect(frag).toMatch(/^f=[A-Za-z0-9_-]+$/);
    const b = createHeadlessApp();
    loaded(await b.loadFragment(`#${frag}`));
    expect(b.toScript()).toBe(a.toScript());
    const bad = await fromFragment('f=@@');
    expect('area' in bad && bad.kind).toBe('file_invalid');
  });
});

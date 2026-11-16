// @vitest-environment node
/** The headless app runs with no DOM (.kiro/specs/sdk design: "The core holds no DOM"), in Node and in a worker. */
import { describe, expect, it } from 'vitest';

describe('the SDK in Node', () => {
  it('loads without a DOM and runs, saves and exports a figure', async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const sdk = await import('../../src/index');
    const app = sdk.createHeadlessApp({ mode: 'classic', script: 'A = (1, 2)\nc = Circle(A, 1)' });
    expect(app.value('A')).toEqual({ x: 1, y: 2 });
    expect(JSON.parse(app.saveText())).toMatchObject({ format: 'incantly' });
    const r = await app.export({ format: 'svg' });
    expect(r).toMatchObject({ ok: true, format: 'svg' });
    // a PNG needs a canvas, which Node has not: the error says what to do instead
    expect(await app.export({ format: 'png' })).toMatchObject({ ok: false, kind: 'export_unsupported' });
  });

  it('refuses createApp without a container, before touching the DOM', async () => {
    const sdk = await import('../../src/index');
    await expect(sdk.createApp({} as never)).rejects.toThrow(TypeError);
  });
});

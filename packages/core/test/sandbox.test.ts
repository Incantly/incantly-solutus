import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BRIDGE_VERSION, FRAME_MESSAGE_TYPES, HOST_MESSAGE_TYPES, parseConnect, parseFrameMessage, parseHostMessage } from '../src/protocol/bridge';
import { FRAME_SCRIPT, FRAME_SCRIPT_HASH, WORKER_SCRIPT } from '../src/sandbox/generated/bundles';
import { guardKey, SHADOWED_GLOBALS, wrapSceneSource, WRAPPER_LINES_BEFORE } from '../src/sandbox/scene-wrapper';
import { cspHash, sha256, base64 } from '../src/sandbox/sha256';
import { buildShell, contentSecurityPolicy, newChannelId } from '../src/sandbox/shell';
import { locateInStack } from '../src/sandbox/stack';
import { THEME_CSS } from '../src/renderer/theme';

const CHANNEL = 'a'.repeat(32);
const envelope = (body: Record<string, unknown>) => ({ v: BRIDGE_VERSION, channel: CHANNEL, ...body });

describe('bridge messages', () => {
  it('accepts well-formed host messages for its channel only', () => {
    expect(parseHostMessage(envelope({ type: 'pause' }), CHANNEL)).toEqual(envelope({ type: 'pause' }));
    expect(parseHostMessage({ ...envelope({ type: 'pause' }), channel: 'b'.repeat(32) }, CHANNEL)).toBeNull();
    expect(parseHostMessage({ ...envelope({ type: 'pause' }), v: 2 }, CHANNEL)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'eval' }), CHANNEL)).toBeNull();
    expect(parseHostMessage('pause', CHANNEL)).toBeNull();
    expect(parseHostMessage(null, CHANNEL)).toBeNull();
  });

  it('checks the shape of each host message', () => {
    expect(parseHostMessage(envelope({ type: 'setValues', values: { a: 1 } }), CHANNEL)).not.toBeNull();
    expect(parseHostMessage(envelope({ type: 'setValues', values: { a: 'x' } }), CHANNEL)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'setValues', values: { a: Infinity } }), CHANNEL)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'step', step: 1.5 }), CHANNEL)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'step', step: null }), CHANNEL)).not.toBeNull();
    expect(parseHostMessage(envelope({ type: 'init', mode: 'live', worker: '', scene: '', shifts: {} }), CHANNEL)).not.toBeNull();
    expect(parseHostMessage(envelope({ type: 'init', mode: 'admin', worker: '', scene: '', shifts: {} }), CHANNEL)).toBeNull();
  });

  it('checks the shape of each frame message', () => {
    expect(parseFrameMessage(envelope({ type: 'ready' }), CHANNEL)).not.toBeNull();
    expect(parseFrameMessage(envelope({ type: 'step', step: 2, count: 3 }), CHANNEL)).not.toBeNull();
    expect(parseFrameMessage(envelope({ type: 'step', step: null }), CHANNEL)).not.toBeNull();
    expect(parseFrameMessage(envelope({ type: 'step', step: 1, count: -1 }), CHANNEL)).toBeNull();
    expect(parseFrameMessage(envelope({ type: 'step', step: 1, count: 'all' }), CHANNEL)).toBeNull();
    expect(parseFrameMessage(envelope({ type: 'resize', height: -4 }), CHANNEL)).toBeNull();
    expect(parseFrameMessage(envelope({ type: 'snapshot', id: 1, png: 'javascript:alert(1)' }), CHANNEL)).toBeNull();
    expect(parseFrameMessage(envelope({ type: 'snapshot', id: 1, png: 'data:image/png;base64,AAAA' }), CHANNEL)).not.toBeNull();
    expect(parseFrameMessage(envelope({ type: 'error', error: { phase: 'frame' } }), CHANNEL)).toBeNull();
    expect(parseFrameMessage(envelope({ type: 'values', values: { a: 1 } }), CHANNEL)).not.toBeNull();
    expect(parseFrameMessage(envelope({ type: 'description', text: 'A wave.' }), CHANNEL)).not.toBeNull();
    expect(parseFrameMessage(envelope({ type: 'description', text: 'x'.repeat(2001) }), CHANNEL)).toBeNull();
    expect(parseFrameMessage(envelope({ type: 'escape', direction: 'sideways' }), CHANNEL)).toBeNull();
    expect(parseHostMessage(envelope({ type: 'focus', edge: 'last' }), CHANNEL)).not.toBeNull();
  });

  it('carries no generation data: every message type is on the documented list', () => {
    expect([...HOST_MESSAGE_TYPES].sort()).toEqual([
      'destroy',
      'focus',
      'init',
      'pause',
      'ping',
      'reducedMotion',
      'resume',
      'setValues',
      'snapshot',
      'step',
    ]);
    expect([...FRAME_MESSAGE_TYPES].sort()).toEqual([
      'description',
      'error',
      'escape',
      'mounted',
      'pong',
      'probe',
      'ready',
      'resize',
      'snapshot',
      'step',
      'values',
    ]);
  });

  it('recognises the connect message', () => {
    expect(parseConnect({ incantly: 'connect', v: 1, channel: CHANNEL }, CHANNEL)).not.toBeNull();
    expect(parseConnect({ incantly: 'connect', v: 1, channel: 'x' }, CHANNEL)).toBeNull();
  });
});

describe('the scene wrapper', () => {
  it('puts the agent line 1 on its own line and shadows the ambient globals', () => {
    const wrapped = wrapSceneSource('const a = 1;');
    expect(wrapped.split('\n')[WRAPPER_LINES_BEFORE]).toBe('const a = 1;');
    for (const name of ['self', 'globalThis', 'fetch', 'postMessage', 'importScripts']) expect(SHADOWED_GLOBALS).toContain(name);
    expect(() => new Function(`return ${wrapped}`)()).not.toThrow();
  });

  it('lets numbers and plain strings through as keys, and nothing else', () => {
    expect(guardKey(2)).toBe(2);
    expect(guardKey('x')).toBe('x');
    expect(() => guardKey('constructor')).toThrow('"constructor" is not available in scenes');
    expect(() => guardKey('__proto__')).toThrow();
    expect(() => guardKey({ toString: () => 'x' })).toThrow('Only numbers and strings');
    expect(() => guardKey(Symbol.iterator)).toThrow();
  });
});

describe('stack mapping', () => {
  const map = { lineOffset: 100, sceneLines: 10, shifts: { 3: [{ column: 5, length: 11 }] } };

  it('maps a V8 stack to the agent line and column', () => {
    const stack = ['TypeError: x', '    at blob:null/abc:50:2', '    at f (blob:null/abc:103:20)', '    at blob:null/abc:104:1'].join('\n');
    expect(locateInStack(stack, map)).toEqual({ line: 3, column: 9 });
  });

  it('maps a JavaScriptCore stack', () => {
    const stack = ['f@blob:null/abc:105:7', 'forEach@[native code]'].join('\n');
    expect(locateInStack(stack, map)).toEqual({ line: 5, column: 7 });
  });

  it('returns null when no frame is inside the scene', () => {
    expect(locateInStack('Error\n    at blob:null/abc:20:3', map)).toBeNull();
  });
});

describe('content security policy', () => {
  it('computes SHA-256 like Node does', () => {
    for (const text of ['', 'abc', THEME_CSS, 'é ∑ 😀'.repeat(50)]) {
      expect(base64(sha256(new TextEncoder().encode(text)))).toBe(createHash('sha256').update(text, 'utf8').digest('base64'));
    }
    expect(cspHash('abc')).toBe("'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='");
  });

  it('allows exactly the inline script and styles of the frame by hash', () => {
    const css = '#stage { margin: 0; }';
    const html = buildShell({ html: '<div id="stage"></div>', css, channel: CHANNEL });
    const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    expect(policy).toBe(contentSecurityPolicy(css));
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts).toEqual([FRAME_SCRIPT]);
    expect(policy).toContain(`script-src ${FRAME_SCRIPT_HASH}`);
    expect(FRAME_SCRIPT_HASH).toBe(cspHash(FRAME_SCRIPT));
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
    expect(styles).toEqual([THEME_CSS, css]);
    for (const style of styles) expect(policy).toContain(cspHash(style));
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain('unsafe');
  });

  it('refuses unvalidated CSS and a weak channel id', () => {
    expect(() => buildShell({ html: '', css: '</style><script>x</script>', channel: CHANNEL })).toThrow();
    expect(() => buildShell({ html: '', css: '', channel: 'abc' })).toThrow();
    expect(newChannelId()).toMatch(/^[a-f0-9]{32}$/);
    expect(newChannelId()).not.toBe(newChannelId());
  });

  it('ships sandbox bundles with no console calls, eval or markup that could escape a script element', () => {
    for (const code of [FRAME_SCRIPT, WORKER_SCRIPT]) {
      expect(code).not.toMatch(/console\.(log|warn|error|info|debug)/);
      expect(code).not.toMatch(/\beval\(/);
    }
    expect(FRAME_SCRIPT).not.toMatch(/<\/script|<script|<!--/i);
    // The parser stays on the host: the frame and Worker never validate.
    expect(WORKER_SCRIPT).not.toContain('acorn');
    expect(WORKER_SCRIPT.length).toBeLessThan(120_000);
  });
});

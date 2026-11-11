/**
 * graphics-view design 15 (the words a screen reader and the `figure` tool
 * share), ui.md 5 (announcements), errors.md 3 (undefined reasons) and the
 * unified error object (docs/features/errors/design.md 3 and 5).
 */
import { describe, expect, it } from 'vitest';
import {
  VIEW_ERROR_CODES,
  VIEW_MESSAGE_TEMPLATES,
  VIEW_REASON_TEXT,
  describeAdded,
  describeBool,
  describeFigure,
  describeMove,
  describeParticles,
  describePoint,
  describeSegment,
  describeCircle,
  describeFunction,
  describeSlider,
  describeUndefined,
  describeHidden,
  describeText,
  describeTrace,
  guard,
  okResult,
  renderViewMessage,
  viewError,
  viewNotice,
} from '@incantly/view';
import { errOf } from './helpers';

describe('design 15 descriptions (the documented table)', () => {
  // Doc conflict inside section 15: the table says `Point A at 1.5, 2. Free.`, the hidden-list example says
  // `... Free, can be moved.`. ui.md 5 also reads "Point A at 1.5, 2. Free. 1 of 12.", so the table wins.
  it('15 a free point (table text)', () => {
    expect(describePoint('A', '1.5, 2', 'free', null)).toBe('Point A at 1.5, 2. Free.');
  });

  it('15 a free point starts with the table text whatever follows', () => {
    expect(describePoint('A', '1.5, 2', 'free', null).startsWith('Point A at 1.5, 2. Free')).toBe(true);
  });

  it('15 a dependent point names how it was made', () => {
    expect(describePoint('M', '3, 1', 'dependent', 'Midpoint of A and B')).toBe('Point M at 3, 1. Midpoint of A and B.');
  });

  it('15 a point on a path says so', () => {
    const t = describePoint('P', '0, 2', 'onPath', null);
    expect(t.startsWith('Point P at 0, 2.')).toBe(true);
    expect(t.toLowerCase()).toContain('path');
  });

  it('15 a segment', () => {
    expect(describeSegment('a', 'A', 'B', '5')).toBe('Segment a from A to B, length 5.');
  });

  it('15 a circle', () => {
    expect(describeCircle('c', 'O', '3')).toBe('Circle c centre O, radius 3.');
  });

  it('15 a function with its spoken definition', () => {
    expect(describeFunction('f', 'x squared minus 2')).toBe('Function f of x equals x squared minus 2.');
  });

  it('15 a slider', () => {
    expect(describeSlider('a', '3', '0', '10', '0.1')).toBe('Slider a, value 3, from 0 to 10 in steps of 0.1.');
  });

  it('15 an undefined object gives the reason', () => {
    expect(describeUndefined('l', 'Line', 'the lines are parallel')).toBe('Line l is undefined: the lines are parallel.');
  });

  it('15 a particle system names the count with a thousands separator', () => {
    const t = describeParticles('fire', 1500, null);
    expect(t).toContain('Particle system fire, 1,500 particles');
  });

  it('animation-time 10.8 the author alt text is added to the particle description', () => {
    const t = describeParticles('fire', 1500, 'flames rising');
    expect(t).toContain('Particle system fire, 1,500 particles');
    expect(t).toContain('flames rising');
  });

  it('15 every description is one or more sentences ending in a full stop', () => {
    const all = [
      describePoint('A', '1, 2', 'free', null), describeSegment('a', 'A', 'B', '1'), describeCircle('c', 'O', '1'),
      describeFunction('f', 'x'), describeSlider('a', '1', '0', '2', '1'), describeUndefined('l', 'Line', 'parallel'),
      describeBool('b', true), describeText('t', 'hello'), describeTrace('tr', 10), describeHidden('h', 'Point'),
    ];
    for (const t of all) {
      expect(t.length).toBeGreaterThan(0);
      expect(t.endsWith('.')).toBe(true);
    }
  });

  it('15 names are never dropped from a description', () => {
    expect(describeBool('flag', false)).toContain('flag');
    expect(describeText('note', 'hello')).toContain('note');
    expect(describeText('note', 'hello')).toContain('hello');
    expect(describeTrace('tr', 10)).toContain('tr');
    expect(describeHidden('h', 'Point')).toContain('h');
  });
});

describe('ui.md 5 announcements', () => {
  it('5 the figure region says how many objects it holds', () => {
    expect(describeFigure(12)).toContain('Figure, 12 objects');
  });

  it('5 after a drag: "A moved to 2, 3."', () => {
    expect(describeMove('A', '2, 3')).toBe('A moved to 2, 3.');
  });

  it('5 teacher additions: "Added circle c, radius 3"', () => {
    expect(describeAdded('circle', 'c', 'radius 3')).toContain('Added circle c, radius 3');
  });
});

describe('errors.md 3 undefined reasons', () => {
  it.each(['not_finite', 'outside_range', 'path_undefined', 'degenerate_view', 'plot_failed'])(
    '3 reason %s has plain text',
    (reason) => {
      const text = VIEW_REASON_TEXT[reason];
      expect(text).toBeDefined();
      expect((text ?? '').length).toBeGreaterThan(3);
    },
  );
});

describe('errors/design.md 3 and 5 the error object', () => {
  it('3 viewError builds an error object that is not ok and not committed', () => {
    const e = viewError({ kind: 'limit', messageKey: 'view.limit', params: { limit: 'objects', value: 6000, max: 5000 } });
    expect(e.ok).toBe(false);
    expect(e.committed).toBe(false);
    expect(e.kind).toBe('limit');
    expect(e.severity).toBe('error');
  });

  it('3 viewError fills a stable code, phase, recovery, message and fingerprint', () => {
    const e = viewError({ kind: 'limit', messageKey: 'view.limit', params: { limit: 'objects', value: 6000, max: 5000 } });
    expect(e.code).toMatch(/^V\d{3}$/);
    expect(typeof e.phase).toBe('string');
    expect(typeof e.recovery).toBe('string');
    expect(e.message.length).toBeGreaterThan(0);
    expect(e.fingerprint.length).toBeGreaterThan(0);
    expect(e.messageKey).toBe('view.limit');
  });

  it('3 two errors of one kind with the same params share a fingerprint', () => {
    const a = viewError({ kind: 'limit', messageKey: 'view.limit', params: { limit: 'objects', value: 6000, max: 5000 } });
    const b = viewError({ kind: 'limit', messageKey: 'view.limit', params: { limit: 'objects', value: 6000, max: 5000 } });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('3 position fields pass through and default to a valid position', () => {
    const e = viewError({ kind: 'bad_directive', messageKey: 'view.bad_view_range', params: { directive: 'view' }, line: 2, col: 7, endCol: 15, token: '5 -5' });
    expect(e.line).toBe(2);
    expect(e.col).toBe(7);
    expect(e.endCol).toBe(15);
    expect(e.token).toBe('5 -5');
    const d = viewError({ kind: 'limit', messageKey: 'view.limit', params: {} });
    expect(d.line).toBeGreaterThanOrEqual(1);
    expect(d.endCol).toBeGreaterThanOrEqual(d.col);
  });

  it('3 forms, hint, expected and suggest pass through', () => {
    const e = viewError({
      kind: 'bad_directive', messageKey: 'view.bad_view_range', params: {}, forms: ['@view x0 x1 y0 y1'], hint: 'Swap them.',
      expected: ['number'], suggest: ['@view -5 5 -3 3'],
    });
    expect(e.forms).toEqual(['@view x0 x1 y0 y1']);
    expect(e.hint).toBe('Swap them.');
    expect(e.expected).toEqual(['number']);
    expect(e.suggest).toEqual(['@view -5 5 -3 3']);
  });

  it('3 every view error code is unique and shaped V plus three digits', () => {
    const codes = Object.values(VIEW_ERROR_CODES).map((s) => s.code);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c).toMatch(/^V\d{3}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  function paramsFor(template: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of template.matchAll(/\{([A-Za-z0-9_]+)\}/g)) out[m[1] ?? ''] = 'X1';
    return out;
  }

  it('3 every message template renders its params and leaves no placeholder behind', () => {
    for (const [key, template] of Object.entries(VIEW_MESSAGE_TEMPLATES)) {
      const params = paramsFor(template);
      const text = renderViewMessage(key, params);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\{[A-Za-z0-9_]+\}/);
      if (Object.keys(params).length > 0) expect(text).toContain('X1');
    }
  });

  it('3.4 messages carry no exclamation marks or "please"', () => {
    for (const [key, template] of Object.entries(VIEW_MESSAGE_TEMPLATES)) {
      const text = renderViewMessage(key, paramsFor(template));
      expect(text).not.toContain('!');
      expect(text.toLowerCase()).not.toContain('please');
    }
  });

  it('3.4 a message with a missing param does not throw', () => {
    const key = Object.keys(VIEW_MESSAGE_TEMPLATES)[0];
    expect(key).toBeDefined();
    expect(() => renderViewMessage(key ?? '', {})).not.toThrow();
  });

  it('5 okResult carries the value and a notices array', () => {
    const r = okResult(42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
      expect(Array.isArray(r.notices)).toBe(true);
      expect(r.notices).toHaveLength(0);
    }
  });

  it('3.1 viewNotice builds an info or warning notice with a code and message', () => {
    const n = viewNotice('warning', 'V901', 'Label of C overlaps label of D.', { name: 'C' }, ['C']);
    expect(n.severity).toBe('warning');
    expect(n.code).toBe('V901');
    expect(n.message).toBe('Label of C overlaps label of D.');
    expect(n.names).toEqual(['C']);
    expect(okResult(1, [n]).ok).toBe(true);
  });

  it('5 guard returns the value of a function that works', () => {
    const r = guard('test', () => 7);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(7);
  });

  it('5 guard turns a throw into an internal error and never throws', () => {
    let r: ReturnType<typeof guard<number>> | undefined;
    expect(() => {
      r = guard('test', (): number => {
        throw new Error('boom');
      });
    }).not.toThrow();
    expect(r).toBeDefined();
    if (r !== undefined) {
      const e = errOf(r, 'guard');
      expect(e.kind).toBe('internal');
    }
  });

  it('5 an internal error keeps the stack out of the object', () => {
    const r = guard('test', (): number => {
      throw new Error('secret-stack-marker');
    });
    const e = errOf(r, 'guard');
    expect(JSON.stringify(e)).not.toMatch(/at .*\.ts:\d+/);
  });
});

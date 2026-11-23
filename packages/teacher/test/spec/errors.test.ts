/**
 * Teacher errors (docs/features/teacher/errors.md, docs/features/errors/errors.md rows T001 to T006, design 3):
 * the kernel's error object for tool and turn errors, the stream shape for what ends a turn, the notices.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { noticeOf, retrySpentError, streamCutError, streamErrorOf, toolUnknownError, turnLimitError } from '../../src/index';
import { errorOf, makeRig, tools } from './helpers';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('T003 to T006 are in docs/features/errors/errors.md (R7)', () => {
  const doc = read('../../../../docs/features/errors/errors.md');
  const rows: readonly [string, string, string, string][] = [
    ['turn_limit', 'T003', 'This answer stopped after {what}.', 'report'],
    ['tool_unknown', 'T004', 'There is no tool {name}; the tools are {list}.', 'fix_line'],
    ['retry_spent', 'T005', '{name} was left out after two tries.', 'skip'],
    ['stream_cut', 'T006', 'The answer stopped partway; {n} line(s) were drawn.', 'report'],
  ];
  for (const [kind, code, template, recovery] of rows) {
    it(`${kind} ${code}: the doc row holds the template and the recovery`, () => {
      const row = doc.split('\n').find((l) => l.includes(`\`${kind}\` ${code}`));
      expect(row).toBeDefined();
      expect(row).toContain(template);
      expect(row).toContain(recovery);
    });
  }
});

describe('the error objects (errors.md table)', () => {
  it('turn_limit T003: "This answer stopped after {what}.", recovery report', () => {
    const e = turnLimitError('8 model calls');
    expect(e).toMatchObject({ ok: false, committed: false, kind: 'turn_limit', code: 'T003', recovery: 'report', message: 'This answer stopped after 8 model calls.' });
    expect(typeof e.fingerprint).toBe('string');
  });

  it('tool_unknown T004: names the tool and lists the tools; expected holds them', () => {
    const e = toolUnknownError('erase', ['draw', 'figure']);
    expect(e).toMatchObject({ kind: 'tool_unknown', code: 'T004', recovery: 'fix_line', message: 'There is no tool erase; the tools are draw, figure.' });
    expect(e.expected).toEqual(['draw', 'figure']);
  });

  it('retry_spent T005: "{name} was left out after two tries.", recovery skip', () => {
    const e = retrySpentError('P', 2, 'P = zzz(1)');
    expect(e).toMatchObject({ kind: 'retry_spent', code: 'T005', recovery: 'skip', message: 'P was left out after two tries.' });
    expect(e.line).toBe(2);
  });

  it('stream_cut T006: "The answer stopped partway; {n} line(s) were drawn.", recovery report', () => {
    expect(streamCutError(3)).toMatchObject({ kind: 'stream_cut', code: 'T006', recovery: 'report', message: 'The answer stopped partway; 3 line(s) were drawn.' });
  });

  it('every one is a Result-shaped object with the fields a caller reads', () => {
    for (const e of [turnLimitError('60 s'), toolUnknownError('x', ['draw']), retrySpentError('A', 1, 'A = 1'), streamCutError(0)]) {
      expect(e.ok).toBe(false);
      for (const f of ['kind', 'code', 'phase', 'message', 'messageKey', 'recovery', 'fingerprint', 'severity']) expect(e).toHaveProperty(f);
      expect(e.phase).toBe('tool');
    }
  });

  it('the same error twice has the same fingerprint, a different one a different fingerprint', () => {
    expect(toolUnknownError('erase', ['draw']).fingerprint).toBe(toolUnknownError('erase', ['draw']).fingerprint);
    expect(toolUnknownError('erase', ['draw']).fingerprint).not.toBe(toolUnknownError('wipe', ['draw']).fingerprint);
  });

  it('T001 tool_input: "{tool} needs {expected}.", recovery fix_line, forms holds the schema shape', () => {
    const { target } = makeRig('graphing');
    const e = errorOf(tools().call(target, 'draw', { lines: [] }));
    expect(e).toMatchObject({ kind: 'tool_input', code: 'T001', recovery: 'fix_line' });
    expect(e.message).toMatch(/^draw needs .+\.$/);
    expect(e.forms.join(' ')).toContain('lines');
  });

  it('T002 tool_busy: "The figure is busy; try again.", recovery skip', () => {
    const { target } = makeRig('graphing');
    target.guard.enter();
    expect(errorOf(tools().call(target, 'figure', {}))).toMatchObject({ kind: 'tool_busy', code: 'T002', recovery: 'skip', message: 'The figure is busy; try again.' });
  });
});

describe('what ends a stream, and notices (errors.md intro and notes)', () => {
  it('streamErrorOf gives the SDK shape { ok: false, kind, message, hint?, detail? }', () => {
    const s = streamErrorOf(turnLimitError('24 tool calls'));
    expect(s).toMatchObject({ ok: false, kind: 'turn_limit', message: 'This answer stopped after 24 tool calls.' });
    for (const key of Object.keys(s)) expect(['ok', 'kind', 'message', 'hint', 'detail']).toContain(key);
  });

  it('retry_spent and stream_cut are notices, not errors that end the turn', () => {
    expect(noticeOf(retrySpentError('P', 1, 'P = 1'), ['P'])).toMatchObject({ kind: 'retry_spent', code: 'T005', names: ['P'] });
    expect(noticeOf(streamCutError(2))).toMatchObject({ kind: 'stream_cut', code: 'T006' });
  });

  it('no error object holds a key, a request body or a provider answer: only the documented fields', () => {
    const s = JSON.stringify(streamErrorOf(turnLimitError('60 s')));
    expect(s).not.toMatch(/authorization|api[_-]?key|bearer/i);
  });
});

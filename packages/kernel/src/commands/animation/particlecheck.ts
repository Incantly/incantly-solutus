/**
 * Line checks for `Particles(...)` (animation-time errors 2), read from the line before the language does, so the
 * learner gets the particle error and not a general one: an unknown or missing parameter, a word value such as
 * `blend = add`, a count or life out of range, a command inside a particle formula, the figure's particle limit, and a
 * particle-only name (`u`, `age`, ...) used outside `Particles`.
 */
import type { ErrorObject } from '../../contracts/errors';
import { err } from '../../errors/table';
import { PARTICLE_COMMANDS } from './colour';
import type { Figure } from '../../graph/figure';
import type { LineRewrite } from '../../graph/registry';
import {
  BLENDS,
  MAX_PARTICLES_PER_FIGURE,
  MAX_PARTICLES_PER_SYSTEM,
  PARTICLE_ONLY_NAMES,
  PARTICLE_PARAMS,
  RENDERERS,
  SHAPES,
  SIZE_UNITS,
  isParticlesValue,
} from './particles';

const ORDER = Object.keys(PARTICLE_PARAMS);
const WORDS: Readonly<Record<string, readonly string[]>> = { shape: SHAPES, blend: BLENDS, renderer: RENDERERS, sizeUnit: SIZE_UNITS };
const BODIES: ReadonlySet<string> = new Set(['pos', 'color', 'size', 'alpha', 'angle']);
const NAME_RE = /^[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*$/;

interface Piece {
  readonly name: string | undefined;
  readonly value: string;
  /** Offset of the value in the line. */
  readonly at: number;
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      row[j] = Math.min((up[j] as number) + 1, (row[j - 1] as number) + 1, (up[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return (d[a.length] as number[])[b.length] as number;
}

function closest(word: string, known: readonly string[]): string[] {
  return known.map((k) => ({ k, d: editDistance(word.toLowerCase(), k) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d).slice(0, 2).map((x) => x.k);
}

/** The top-level arguments of the call that opens at `open` (the index of its `(`), or `undefined` if it never closes. */
function piecesOf(text: string, open: number): { pieces: Piece[]; close: number } | undefined {
  const pieces: Piece[] = [];
  let depth = 0;
  let start = open + 1;
  let inStr = false;
  for (let k = open; k < text.length; k++) {
    const ch = text[k] as string;
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') {
      depth--;
      if (depth === 0) {
        pushPiece(text, start, k, pieces);
        return { pieces, close: k };
      }
    } else if (ch === ',' && depth === 1) {
      pushPiece(text, start, k, pieces);
      start = k + 1;
    }
  }
  return undefined;
}

function pushPiece(text: string, from: number, to: number, out: Piece[]): void {
  const raw = text.slice(from, to);
  if (raw.trim() === '') return;
  const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/.exec(raw);
  if (m) {
    const valueStart = from + (m[0] as string).length;
    out.push({ name: m[2] as string, value: text.slice(valueStart, to).trim(), at: valueStart + (text.slice(valueStart, to).length - text.slice(valueStart, to).trimStart().length) });
  } else out.push({ name: undefined, value: raw.trim(), at: from + (raw.length - raw.trimStart().length) });
}

function fail(kind: Parameters<typeof err>[0], text: string, at: number, len: number, why: string, extra: { hint?: string; suggest?: readonly string[]; token?: string } = {}): ErrorObject {
  return err(kind, { line: 1, col: at + 1, endCol: at + Math.max(1, len) + 1 }, { command: 'Particles', why }, {
    token: extra.token ?? text.slice(at, at + len),
    ...(extra.hint ? { hint: extra.hint } : {}),
    ...(extra.suggest ? { suggest: extra.suggest } : {}),
    recovery: 'fix_line',
    fingerprintKey: kind,
  });
}

let probing = false;

export function particlesLineRewrite(host: unknown, text: string): LineRewrite | undefined {
  const figure = host as Figure;
  const open = /\bParticles\s*\(/.exec(text);
  if (!open) return outsideNames(figure, text);
  const call = piecesOf(text, open.index + (open[0] as string).length - 1);
  if (!call) return undefined;
  const given = new Set<string>();
  let out = text;
  let shift = 0;
  let count: number | undefined;
  let pxSize = false;
  for (const [k, p] of call.pieces.entries()) {
    const name = p.name ?? ORDER[k];
    if (name === undefined) continue;
    if (!Object.hasOwn(PARTICLE_PARAMS, name)) {
      const near = closest(name, ORDER);
      return { error: fail('unknown_particle_param', text, p.at - name.length - 3 < 0 ? p.at : text.lastIndexOf(name, p.at), name.length, `Particles has no parameter called ${name}.`, {
        token: name,
        hint: near.length > 0 ? `Did you mean ${near.join(' or ')}? The parameters are ${ORDER.join(', ')}.` : `The parameters are ${ORDER.join(', ')}.`,
        suggest: near.map((c) => text.replace(new RegExp(`\\b${name}\\s*=`), `${c} =`)),
      }) };
    }
    given.add(name);
    const words = WORDS[name];
    if (words && NAME_RE.test(p.value)) {
      if (!words.includes(p.value)) {
        return { error: fail('bad_particle_value', text, p.at, p.value.length, `${name} must be ${words.join(', ')}; got ${p.value}.`, { hint: `Use one of ${words.join(', ')}.` }) };
      }
      // a word value is the word, not an object name
      const quoted = `"${p.value}"`;
      out = out.slice(0, p.at + shift) + quoted + out.slice(p.at + shift + p.value.length);
      shift += quoted.length - p.value.length;
    }
    if (name === 'count' && /^-?\d+(\.\d+)?$/.test(p.value)) {
      const c = Number(p.value);
      if (!Number.isInteger(c) || c < 1 || c > MAX_PARTICLES_PER_SYSTEM) {
        return { error: fail('bad_particle_value', text, p.at, p.value.length, `count must be a whole number from 1 to ${MAX_PARTICLES_PER_SYSTEM}; got ${p.value}.`, { hint: `A system holds at most ${MAX_PARTICLES_PER_SYSTEM} particles.` }) };
      }
      count = c;
    }
    if (name === 'life' && /^-?\d+(\.\d+)?$/.test(p.value) && !(Number(p.value) > 0)) {
      return { error: fail('bad_particle_value', text, p.at, p.value.length, `life must be a number of seconds above 0; got ${p.value}.`, { hint: 'Try life = 1.' }) };
    }
    if (name === 'layer' && /^-?\d+(\.\d+)?$/.test(p.value)) {
      const l = Number(p.value);
      if (!Number.isInteger(l) || l < 0 || l > 9) {
        return { error: fail('bad_particle_value', text, p.at, p.value.length, `layer must be a whole number from 0 to 9; got ${p.value}.`, { hint: 'Try layer = 0.' }) };
      }
    }
    if (name === 'size') {
      // size = px(…) is a size in screen pixels (10.2): kept as the formula inside and sizeUnit = "px"
      const px = /^px\s*\(/.exec(p.value);
      if (px && p.value.endsWith(')') && piecesOf(p.value, px[0].length - 1)?.close === p.value.length - 1) {
        const inner = p.value.slice(px[0].length, -1).trim();
        out = out.slice(0, p.at + shift) + inner + out.slice(p.at + shift + p.value.length);
        shift += inner.length - p.value.length;
        pxSize = true;
      }
    }
    if (BODIES.has(name)) {
      // the first command call, other than the few with a GLSL form (Gradient)
      let cmd: RegExpExecArray | null = null;
      for (const m of p.value.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
        if (!PARTICLE_COMMANDS.has(m[1] as string)) {
          cmd = m as RegExpExecArray;
          break;
        }
      }
      if (cmd) {
        return { error: fail('particle_command', text, p.at + cmd.index, (cmd[1] as string).length, `${cmd[1] as string} is a command; a particle formula may use only built-in functions.`, {
          token: cmd[1] as string,
          hint: 'Use built-in functions only inside Particles, such as sin, rand, noise or rgb. Compute the rest as an object outside and name it.',
        }) };
      }
    }
  }
  const missing = ORDER.filter((n) => PARTICLE_PARAMS[n]?.required === true && !given.has(n));
  if (missing.length > 0) {
    return { error: fail('missing_particle_param', text, open.index, (open[0] as string).length - 1, `Particles needs ${missing.join(', ')}.`, {
      token: 'Particles',
      hint: 'count, life and pos are required: Particles(count = 500, life = 1, pos = (u, age)).',
    }) };
  }
  if (count !== undefined) {
    const own = /^\s*([A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ]*)\s*=/.exec(text)?.[1];
    let others = 0;
    for (const o of figure.objects()) {
      if (o.type !== 'Particles' || o.name === own) continue;
      const v = figure.value(o.id);
      if (isParticlesValue(v)) others += v.spec.count;
    }
    if (others + count > MAX_PARTICLES_PER_FIGURE) {
      return { error: err('limit', { line: 1, col: open.index + 1, endCol: call.close + 2 }, { limit: 'particles', max: MAX_PARTICLES_PER_FIGURE, got: others + count, what: 'particles in the figure' }, {
        hint: `A figure holds at most ${MAX_PARTICLES_PER_FIGURE} particles; the others already use ${others}.`,
        recovery: 'rewrite',
        fingerprintKey: 'particles',
      }) };
    }
  }
  if (pxSize && !given.has('sizeUnit')) {
    const close = call.close + shift;
    out = `${out.slice(0, close)}, sizeUnit = "px"${out.slice(close)}`;
  }
  return out !== text ? { text: out } : undefined;
}

/**
 * `u`, `age`, `ph`, ... outside `Particles`: when the line fails only because one of them is unknown, the error says
 * where these names live. The line is tried once as a dry run to find that out.
 */
function outsideNames(figure: Figure, text: string): LineRewrite | undefined {
  if (probing) return undefined;
  const words = text.replace(/"[^"]*"/g, '').match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  if (!words.some((w) => PARTICLE_ONLY_NAMES.has(w))) return undefined;
  probing = true;
  let r;
  try {
    r = figure.apply(text, { dryRun: true });
  } finally {
    probing = false;
  }
  if (r.ok || r.kind !== 'unknown_name') return undefined;
  const name = String(r.params['name'] ?? r.token ?? '');
  if (!PARTICLE_ONLY_NAMES.has(name)) return undefined;
  return {
    error: err('particle_name_outside', { line: 1, col: r.col, endCol: r.endCol }, { command: 'Particles', why: `${name} exists only inside Particles(...).` }, {
      token: name,
      hint: 'These names exist only inside Particles(...).',
      recovery: 'fix_line',
      fingerprintKey: name,
    }),
  };
}

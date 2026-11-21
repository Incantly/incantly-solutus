/**
 * The attributes of the figure node (design 2) and their checks. No Tiptap import: the same checks serve the node,
 * the commands, paste and the export.
 */
import { MODE_IDS } from '@incantly/modes';
import type { AppModeId } from '@incantly/modes';
import { ok, tiptapError } from './errors';
import type { TiptapResult } from './errors';

export interface IncantlyFigureAttrs {
  /** Stable, created on insert. */
  readonly id: string;
  /** The figure's lines: the only source of truth. */
  readonly script: string;
  readonly mode: AppModeId;
  /** Pixels, or the column width. */
  readonly width: number | 'full';
  readonly height: number;
  /** Plain text, optional. */
  readonly caption: string;
  /** The last saved picture as a data or https URL, for placeholders and exports. */
  readonly picture: string | null;
  readonly version: 1;
}

export const FIGURE_DEFAULTS: IncantlyFigureAttrs = {
  id: '',
  script: '',
  mode: 'figure',
  width: 'full',
  height: 360,
  caption: '',
  picture: null,
  version: 1,
};

/** The most a script may hold, in UTF-8 bytes (errors.md `bad_attrs`). */
export const SCRIPT_LIMIT = 64 * 1024;
export const HEIGHT_MIN = 120;
export const HEIGHT_MAX = 4000;
/** The width a `full` figure is drawn at when there is no column to measure (exports). */
export const FULL_WIDTH_PX = 720;

const MODE_SET: ReadonlySet<string> = new Set(MODE_IDS);

export const isModeId = (x: unknown): x is AppModeId => typeof x === 'string' && MODE_SET.has(x);

/** UTF-8 length of a text. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** True when a script is within the limit. */
export function scriptFits(text: string): boolean {
  if (text.length > SCRIPT_LIMIT) return false;
  if (text.length * 3 <= SCRIPT_LIMIT) return true;
  return new TextEncoder().encode(text).length <= SCRIPT_LIMIT;
}

export const isPictureUrl = (x: unknown): x is string => typeof x === 'string' && (x.startsWith('data:image/') || x.startsWith('https:'));

const NUMBER_TEXT = /^\d+(?:\.\d+)?$/;

/** A number from a number or from the digits HTML gives; anything else is `undefined`. */
function numberOf(x: unknown): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string' && NUMBER_TEXT.test(x.trim())) return Number(x);
  return undefined;
}

/** New ids: `fig_` and 8 base-62 characters. */
export function newFigureId(): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const out: string[] = [];
  const buf = new Uint8Array(16);
  while (out.length < 8) {
    globalThis.crypto.getRandomValues(buf);
    // 248 = 4 * 62: bytes above it are dropped so every character is equally likely
    for (const b of buf) {
      if (b < 248 && out.length < 8) out.push(alphabet.charAt(b % 62));
    }
  }
  return `fig_${out.join('')}`;
}

const bad = (id: string | undefined, message: string, hint: string): TiptapResult<never> =>
  tiptapError('bad_attrs', message, { hint, ...(id !== undefined ? { node: id } : {}) });

/**
 * Checks the raw attributes of a figure node. Missing optional attributes take their defaults; text numbers (from
 * HTML) are read as numbers. The result holds the normalised attributes. A failure is `bad_attrs` with the figure's id.
 */
export function checkAttrs(raw: Readonly<Record<string, unknown>>, defaults: IncantlyFigureAttrs = FIGURE_DEFAULTS): TiptapResult<IncantlyFigureAttrs> {
  const r = typeof raw === 'object' && raw !== null ? raw : {};
  const id = typeof r['id'] === 'string' ? r['id'] : undefined;
  if (id === undefined || id === '') return bad(id, 'The figure has no id.', 'Insert the figure again, or give it an id.');

  const script = r['script'] === undefined ? defaults.script : r['script'];
  if (typeof script !== 'string') return bad(id, 'The figure\'s script is not text.', 'Replace the script with the figure\'s lines as text.');
  if (!scriptFits(script)) {
    const kb = Math.ceil(utf8Length(script) / 1024);
    return bad(id, `The figure's script is ${kb} KB; the limit is ${SCRIPT_LIMIT / 1024} KB.`, 'Split the figure into two, or remove unused objects.');
  }

  const mode = r['mode'] === undefined ? defaults.mode : r['mode'];
  if (!isModeId(mode)) return bad(id, `The figure's mode "${String(mode)}" is not a mode.`, `Use one of: ${MODE_IDS.join(', ')}.`);

  let width: number | 'full';
  const w = r['width'] === undefined ? defaults.width : r['width'];
  if (w === 'full') width = 'full';
  else {
    const n = numberOf(w);
    if (n === undefined || n <= 0) return bad(id, 'The figure\'s width must be "full" or a number of pixels above 0.', 'Set the width to "full" or to a number such as 480.');
    width = n;
  }

  const hRaw = r['height'] === undefined ? defaults.height : r['height'];
  const height = numberOf(hRaw);
  if (height === undefined || height < HEIGHT_MIN || height > HEIGHT_MAX) {
    return bad(id, `The figure's height must be a number from ${HEIGHT_MIN} to ${HEIGHT_MAX} pixels.`, `Set the height between ${HEIGHT_MIN} and ${HEIGHT_MAX}.`);
  }

  const caption = r['caption'] === undefined ? defaults.caption : r['caption'];
  if (typeof caption !== 'string') return bad(id, 'The figure\'s caption is not text.', 'Replace the caption with plain text.');

  const pic = r['picture'] === undefined ? defaults.picture : r['picture'];
  if (pic !== null && !isPictureUrl(pic)) {
    return bad(id, 'The figure\'s picture must be an image data URL or an https address.', 'Remove the picture; it is drawn again from the script.');
  }

  const v = r['version'] === undefined ? defaults.version : numberOf(r['version']) ?? r['version'];
  if (v !== 1) return bad(id, `The figure's version ${String(v)} is not one this build reads.`, 'Open the document in a newer Incantly, or remove the figure.');

  return ok({ id, script, mode, width, height, caption, picture: pic, version: 1 });
}

/** Opening line of a script written by the SDK: `# incantly 1 mode=graphing`. */
export const SCRIPT_HEADER = /^\s*# incantly \d+[^\n]*(?:\n|$)/;

/** The mode a script's header names, if it names a known one. */
export function headerMode(script: string): AppModeId | undefined {
  const m = /^\s*# incantly \d+[^\n]*?\bmode=([A-Za-z0-9]+)/.exec(script);
  const mode = m?.[1];
  return isModeId(mode) ? mode : undefined;
}

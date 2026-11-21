/**
 * Figure cards as data (design 8): what the web layer (`web/figures.ts`) reads and writes. The script is the only source
 * of truth; `picture` is a cache, written outside the undo history, and a change of script or mode clears it in the same
 * step. Every write is one transaction through the store; nothing here touches a page, a timer or an app.
 */
import type { BoardCore } from './board';
import { boardError, ok } from './errors';
import type { BoardResult } from './errors';
import { FIGURE_DEFAULTS, FIGURE_HEADER, SCRIPT_MAX } from './kinds/media';
import type { FigureProps } from './kinds/media';
import { putNewShape, shapeOf } from './shapes';
import type { Origin, ShapeRecord } from './types';

/** The figure card with this id, or undefined when the shape is not a figure. */
export function figureOf(core: BoardCore, id: string): (ShapeRecord<'figure', FigureProps>) | undefined {
  const s = shapeOf(core.store, id);
  return s !== undefined && s.kind === 'figure' ? (s as ShapeRecord<'figure', FigureProps>) : undefined;
}

/** The figure cards of the current page, bottom to top. */
export function figuresOnPage(core: BoardCore): readonly ShapeRecord<'figure', FigureProps>[] {
  const page = core.pages.current;
  if (page === null) return [];
  return core.store.shapesOn(page).filter((s) => s.kind === 'figure') as ShapeRecord<'figure', FigureProps>[];
}

/** The SDK's mode id for the mode a card names (`graph` and `3d` are the short names the first placeholder used). */
export function sdkMode(mode: string): string {
  return mode === 'graph' ? 'graphing' : mode === '3d' ? 'graphing3d' : mode;
}

/** The script with the header line the format asks for. */
export function withHeader(script: string): string {
  const text = script.replace(/\r\n?/g, '\n');
  return text.trimStart().startsWith(FIGURE_HEADER) ? text.trimStart() : `${FIGURE_HEADER}\n${text}`;
}

export interface NewFigure {
  /** The card's middle, in page units; default the middle of the view's page point (0, 0). */
  readonly at: { readonly x: number; readonly y: number };
  readonly mode?: string;
  readonly script?: string;
}

/** Adds an empty (or scripted) figure card with its middle at `at`. One undo step. Returns the shape id. */
export function addFigure(core: BoardCore, spec: NewFigure, origin: Origin = 'user'): BoardResult<string> {
  const page = core.pages.current;
  if (page === null) return boardError('bad_argument', 'The board has no page.', { detail: { field: 'page' } });
  const w = FIGURE_DEFAULTS.w;
  const h = FIGURE_DEFAULTS.h;
  let id = '';
  const props: Record<string, unknown> = {};
  if (spec.mode !== undefined) props['mode'] = spec.mode;
  if (spec.script !== undefined) props['script'] = withHeader(spec.script);
  const done = core.store.change(origin, (tx) => {
    const made = putNewShape(tx, core.store, { kind: 'figure', page, x: spec.at.x - w / 2, y: spec.at.y - h / 2, props });
    if (made.ok) id = made.value.id;
    return made;
  });
  if (!done.ok) return done;
  if (!done.value.value.ok) return done.value.value;
  return ok(id);
}

function figureWrite(core: BoardCore, id: string, patch: Partial<FigureProps>, origin: Origin, history: boolean): BoardResult<undefined> {
  const card = figureOf(core, id);
  if (card === undefined) return boardError('bad_argument', `There is no figure card "${id}".`, { detail: { record: id } });
  const done = core.store.change(origin, (tx) => tx.update(id, { props: { ...card.props, ...patch } }), history ? {} : { history: false });
  if (!done.ok) return done;
  const inner = done.value.value;
  return inner.ok ? ok(undefined) : inner;
}

/** Replaces the card's script (one undo step); the picture is cleared in the same step, since it showed the old script. */
export function setFigureScript(core: BoardCore, id: string, script: string, origin: Origin = 'user'): BoardResult<undefined> {
  if (typeof script !== 'string' || script.length > SCRIPT_MAX) {
    return boardError('record_invalid', `A figure's script is text of at most ${SCRIPT_MAX} characters.`, { detail: { record: id, field: 'props.script' } });
  }
  return figureWrite(core, id, { script: withHeader(script), picture: null }, origin, true);
}

/** Changes the card's mode (one undo step); the picture is cleared in the same step. */
export function setFigureMode(core: BoardCore, id: string, mode: string, origin: Origin = 'user'): BoardResult<undefined> {
  if (typeof mode !== 'string' || mode === '') return boardError('record_invalid', 'A figure card has a mode.', { detail: { record: id, field: 'props.mode' } });
  return figureWrite(core, id, { mode, picture: null }, origin, true);
}

/** Writes the card's picture, a cache: not an undo step. */
export function setFigurePicture(core: BoardCore, id: string, picture: string | null): BoardResult<undefined> {
  const card = figureOf(core, id);
  if (card !== undefined && card.props.picture === picture) return ok(undefined);
  return figureWrite(core, id, { picture }, 'host', false);
}

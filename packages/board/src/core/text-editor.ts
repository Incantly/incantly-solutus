/**
 * The text editor of the board (docs/state-machines.md B21): which shape's text is being typed, and the text and the
 * selection range in it. The web view puts a hidden text field over the shape and sends what the field holds (`set`)
 * and its composition events; the core knows no DOM. Every `set` writes the shape's text with one merge key, so typing
 * is one undo step. No DOM, no timers.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { BoardResult } from './errors';
import { boardError, DONE, refusedMove } from './errors';
import type { History } from './history';
import type { Store } from './store';
import { isShape } from './types';
import type { ShapeRecord } from './types';

type EditorState = 'closed' | 'editing' | 'composing';
type EditorEvent = 'open' | 'set' | 'compose' | 'endCompose' | 'commit';

export const EDITOR_MACHINE: MachineTable<EditorState, EditorEvent> = {
  closed: { open: 'editing' },
  editing: { set: 'editing', compose: 'composing', commit: 'closed' },
  composing: { set: 'composing', endCompose: 'editing', commit: 'closed' },
};

export type EditorListener = (open: boolean) => void;

/** The state's data: the shape being edited (empty when closed), the selection range, and the count that names the merge key. */
interface Session {
  id: string;
  start: number;
  end: number;
  serial: number;
}

export class TextEditor {
  readonly #store: Store;
  readonly #history: History;
  readonly #machine = new StateMachine(EDITOR_MACHINE, 'closed', refusedMove('text editor', () => this.#store.sink));
  readonly #session: Session = { id: '', start: 0, end: 0, serial: 0 };
  #listeners: readonly EditorListener[] = [];

  constructor(store: Store, history: History) {
    this.#store = store;
    this.#history = history;
  }

  get state(): EditorState {
    return this.#machine.state;
  }

  /** The id of the shape being edited, or an empty string when the editor is closed. */
  get shapeId(): string {
    return this.#session.id;
  }

  /** The selection range in the text: where it starts and ends (equal for a caret). */
  get range(): { readonly start: number; readonly end: number } {
    return { start: this.#session.start, end: this.#session.end };
  }

  /** The text of the shape being edited, or an empty string. */
  get text(): string {
    const shape = this.#shape();
    const def = shape === undefined ? undefined : this.#store.kinds.get(shape.kind);
    return shape !== undefined && def?.text !== undefined ? def.text.get(shape.props) : '';
  }

  /** Calls `listener(true)` when the editor opens and `listener(false)` when it closes. */
  on(listener: EditorListener): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  /** Starts editing the text of a shape. Refused for a locked shape, a kind that holds no text, a missing shape, or while another is open. */
  open(id: string): BoardResult<undefined> {
    const r = this.#store.get(id);
    const shape = r !== undefined && isShape(r) ? r : undefined;
    if (shape === undefined) return boardError('bad_argument', `There is no shape "${id}" to type in.`, { detail: { record: id } });
    const def = this.#store.kinds.get(shape.kind);
    if (def?.text === undefined) return boardError('bad_argument', `A shape of kind "${shape.kind}" holds no text.`, { detail: { record: id, kind: shape.kind } });
    if (shape.locked) return boardError('bad_argument', `The shape "${id}" is locked.`, { detail: { record: id } });
    if (!this.#machine.send('open')) return boardError('bad_argument', 'Another shape is being edited; finish it first.', { detail: { record: this.#session.id } });
    const text = def.text.get(shape.props);
    this.#session.id = id;
    this.#session.start = text.length;
    this.#session.end = text.length;
    this.#session.serial++;
    this.#tell(true);
    return DONE;
  }

  /** The field now holds `text` with the range `start` to `end` selected. */
  set(text: string, start: number = text.length, end: number = start): BoardResult<undefined> {
    if (this.#machine.is('closed')) return boardError('bad_argument', 'No text is being edited.', { detail: { field: 'editor' } });
    const shape = this.#shape();
    const def = shape === undefined ? undefined : this.#store.kinds.get(shape.kind);
    if (shape === undefined || def?.text === undefined) return this.commit();
    this.#machine.send('set');
    this.#session.start = Math.max(0, Math.min(text.length, start));
    this.#session.end = Math.max(0, Math.min(text.length, end));
    if (def.text.get(shape.props) === text) return DONE;
    const written = this.#store.change('user', (tx) => tx.update(shape.id, { props: def.text?.set(shape.props, text) ?? {} }), { mergeKey: `edit:${this.#session.serial}` });
    return written.ok ? DONE : written;
  }

  /** An input method started making a character. */
  compose(): boolean {
    return this.#machine.send('compose');
  }

  endCompose(): boolean {
    return this.#machine.send('endCompose');
  }

  /** Ends the editing. A text or sticky shape left with only white space is removed. */
  commit(): BoardResult<undefined> {
    if (this.#machine.is('closed')) return DONE;
    const shape = this.#shape();
    const id = this.#session.id;
    const def = shape === undefined ? undefined : this.#store.kinds.get(shape.kind);
    this.#machine.send('commit');
    this.#session.id = '';
    this.#session.start = 0;
    this.#session.end = 0;
    let result: BoardResult<undefined> = DONE;
    if (shape !== undefined && (shape.kind === 'text' || shape.kind === 'sticky') && def?.text !== undefined && def.text.get(shape.props).trim() === '') {
      const removed = this.#store.change('user', (tx) => tx.remove(id), { mergeKey: `edit:${this.#session.serial}` });
      if (!removed.ok) result = removed;
    }
    this.#history.seal();
    this.#tell(false);
    return result;
  }

  #shape(): ShapeRecord | undefined {
    if (this.#session.id === '') return undefined;
    const r = this.#store.get(this.#session.id);
    return r !== undefined && isShape(r) ? r : undefined;
  }

  #tell(open: boolean): void {
    for (const l of this.#listeners) {
      try {
        l(open);
      } catch {
        // a listener's failure does not stop the others
      }
    }
  }
}

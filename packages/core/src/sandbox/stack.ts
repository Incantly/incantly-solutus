import { originalColumn, type InstrumentedScene } from '../validation/instrument-map';

/**
 * Maps a stack trace from the Worker back to the agent's own fragment. The
 * Worker script is the bundled runtime, then the wrapper, then the scene, so
 * a browser line number points past the agent's code by a known offset, and
 * columns are shifted by the inserted fuel and key guards (RP-3).
 */

export interface SceneLocation {
  readonly line: number;
  readonly column: number;
}

export interface StackMap {
  /** Script lines before the agent's line 1. */
  readonly lineOffset: number;
  /** Lines of agent code. */
  readonly sceneLines: number;
  readonly shifts: InstrumentedScene['shifts'];
}

/** The first frame of a stack that lies inside the scene, as a fragment location. */
export function locateInStack(stack: string, map: StackMap): SceneLocation | null {
  // V8: "at f (blob:null/uuid:12:34)" or "at blob:null/uuid:12:34"; JavaScriptCore and Gecko: "f@blob:null/uuid:12:34".
  const pattern = /:(\d+):(\d+)\)?\s*$/;
  for (const raw of stack.split('\n')) {
    const match = pattern.exec(raw.trim());
    if (!match) continue;
    const line = Number(match[1]) - map.lineOffset;
    if (line < 1 || line > map.sceneLines) continue;
    return { line, column: originalColumn({ shifts: map.shifts }, line, Number(match[2])) };
  }
  return null;
}

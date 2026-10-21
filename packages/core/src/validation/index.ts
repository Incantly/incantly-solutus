import { validateSceneCss } from './css';
import { hasErrors, type Diagnostic } from './diagnostics';
import { validateSceneHtml } from './html';
import { instrumentSceneJs, type InstrumentedScene } from './instrument';
import { validateSceneJs, type JsInfo } from './js';
import { SCENE_LIMITS, type SceneLimits } from './limits';

export interface SceneFragments {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

export interface ValidatedScene {
  /** Canonical HTML, rebuilt from the parsed fragment. */
  readonly html: string;
  readonly css: string;
  /** The agent's script, unchanged. */
  readonly js: string;
  /** The script with fuel and key guards, ready for the Worker. */
  readonly instrumented: InstrumentedScene;
}

export interface SceneValidation {
  readonly ok: boolean;
  /** Errors and warnings, in fragment order (html, css, js, scene) then by position. */
  readonly diagnostics: readonly Diagnostic[];
  /** Present only when there are no errors. */
  readonly scene: ValidatedScene | null;
  readonly info: JsInfo;
}

export interface ValidateOptions {
  readonly limits?: SceneLimits;
}

const ORDER = { html: 0, css: 1, js: 2, scene: 3 } as const;

/**
 * Validates the three fragments together. Runs on the server for every
 * generation and again in the browser before any stored scene mounts.
 */
export function validateScene(fragments: SceneFragments, options: ValidateOptions = {}): SceneValidation {
  const limits = options.limits ?? SCENE_LIMITS;
  const diagnostics: Diagnostic[] = [];
  const typed = (value: unknown, fragment: string): string => {
    if (typeof value === 'string') return value;
    diagnostics.push({ fragment: 'scene', rule: 'missing-fragment', message: `The ${fragment} fragment must be a string`, line: 1, column: 1, severity: 'error' });
    return '';
  };
  const htmlSource = typed(fragments.html, 'HTML');
  const cssSource = typed(fragments.css, 'CSS');
  const jsSource = typed(fragments.js, 'JavaScript');

  const html = validateSceneHtml(htmlSource, limits);
  const css = validateSceneCss(cssSource, limits);
  const js = validateSceneJs(jsSource, limits);
  diagnostics.push(...html.diagnostics, ...css.diagnostics, ...js.diagnostics);

  // Every stage the script draws into must exist in the HTML.
  if (!hasErrors(html.diagnostics)) {
    for (const stage of js.info.stages) {
      const id = stage.selector.slice(1);
      if (!html.ids.has(id)) {
        diagnostics.push({
          fragment: 'js',
          rule: 'missing-stage-host',
          message: `${stage.selector} does not match an element in the scene HTML; add <div id="${id}"></div>`,
          line: stage.line,
          column: stage.column,
          severity: 'error',
        });
      }
    }
  }
  if (js.program && js.info.stages.length === 0 && !hasErrors(js.diagnostics)) {
    diagnostics.push({
      fragment: 'js',
      rule: 'no-stage',
      message: 'The scene never draws: create a stage with inc.svg or inc.graph2d',
      line: 1,
      column: 1,
      severity: 'error',
    });
  }

  diagnostics.sort((a, b) => ORDER[a.fragment] - ORDER[b.fragment] || a.line - b.line || a.column - b.column);
  const ok = !hasErrors(diagnostics);
  return {
    ok,
    diagnostics,
    scene:
      ok && js.program
        ? { html: html.html, css: cssSource, js: jsSource, instrumented: instrumentSceneJs(jsSource, js.program) }
        : null,
    info: js.info,
  };
}

export { formatDiagnostic, hasErrors, LineIndex } from './diagnostics';
export type { Diagnostic, Fragment, Position, Severity } from './diagnostics';
export { FUEL_FUNCTION, KEY_FUNCTION, instrumentSceneJs, originalColumn } from './instrument';
export type { ColumnShift, InstrumentedScene } from './instrument';
export { validateSceneJs } from './js';
export type { JsInfo, JsValidation, StageReference } from './js';
export { validateSceneHtml } from './html';
export type { HtmlValidation } from './html';
export { validateSceneCss } from './css';
export type { CssValidation } from './css';
export { SCENE_LIMITS } from './limits';
export type { SceneLimits } from './limits';

import { validateSceneCss } from './css';
import { hasErrors, type Diagnostic } from './diagnostics';
import { validateSceneHtml } from './html';
import { instrumentSceneJs, type InstrumentedScene } from './instrument';
import { validateSceneJs, type JsInfo } from './js';
import { SCENE_LIMITS, type SceneLimits } from './limits';
import type { KitName } from '../runtime/kits';

/**
 * The version of the validator's rules. Stored with approved fragments, so a
 * figure approved under older rules can be found and checked again.
 */
export const VALIDATOR_VERSION = 1;

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
  /** Kits the scene calls; the host loads them before it runs. */
  readonly kits: readonly KitName[];
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
      message: 'The scene never draws: create a stage with inc.svg, inc.graph2d or a kit such as inc.space3d',
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
        ? { html: html.html, css: cssSource, js: jsSource, instrumented: instrumentSceneJs(jsSource, js.program), kits: js.info.kits }
        : null,
    info: js.info,
  };
}

export interface FixedScene {
  readonly fragments: SceneFragments;
  /** What each applied fix did, in order. */
  readonly applied: readonly string[];
  readonly validation: SceneValidation;
}

/**
 * The scene with the validator's certain fixes applied, the way a compiler
 * applies its own suggestions, and validated again: no model call. Two passes
 * at most, as a fix may let the validator see past it; fixes that overlap
 * one already applied wait for the next pass. What no fix covers is left for
 * a repair.
 */
export function fixScene(fragments: SceneFragments, options: ValidateOptions = {}): FixedScene {
  let current = fragments;
  const applied: string[] = [];
  let validation = validateScene(current, options);
  for (let pass = 0; pass < 2 && !validation.ok; pass++) {
    const fixes = validation.diagnostics.flatMap((d) => (d.severity === 'error' && d.fragment === 'js' && d.fix ? [d.fix] : []));
    if (fixes.length === 0 || typeof current.js !== 'string') break;
    let js = current.js;
    let before = Number.POSITIVE_INFINITY;
    for (const fix of [...fixes].sort((a, b) => b.start - a.start)) {
      if (fix.end > before) continue;
      js = js.slice(0, fix.start) + fix.text + js.slice(fix.end);
      before = fix.start;
      applied.push(fix.note);
    }
    current = { ...current, js };
    validation = validateScene(current, options);
  }
  return { fragments: current, applied, validation };
}

export { formatDiagnostic, hasErrors, LineIndex } from './diagnostics';
export type { Diagnostic, Fix, Fragment, Position, Severity } from './diagnostics';
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

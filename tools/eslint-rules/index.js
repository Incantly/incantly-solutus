/**
 * The `incantly` ESLint plugin: our own rules, so every rule of AGENTS.md and docs/state-machines.md that code can
 * check fails `npm run check` (spec: .kiro/specs/lint-rules/).
 */
import { noAiCredit, noThrowExport } from './code.js';
import { glClearMasks } from './gl.js';
import { noLengthReset } from './arrays.js';
import { allowedImports } from './imports.js';
import { noImportedMutation, stateRefusalReported } from './purity.js';
import { noFlagSoup, noIoFlags, noShadowNull, noStaleAfterAwait, tableRefuses, tableRequired, transitionOnly, unionType } from './state.js';

export const rules = {
  'state-no-flag-soup': noFlagSoup,
  'state-transition-only': transitionOnly,
  'state-union-type': unionType,
  'state-table-required': tableRequired,
  'state-table-refuses': tableRefuses,
  'state-no-stale-after-await': noStaleAfterAwait,
  'state-no-shadow-null': noShadowNull,
  'state-no-io-flags': noIoFlags,
  'allowed-imports': allowedImports,
  'no-throw-export': noThrowExport,
  'no-ai-credit': noAiCredit,
  'no-imported-mutation': noImportedMutation,
  'state-refusal-reported': stateRefusalReported,
  'gl-clear-masks': glClearMasks,
  'no-length-reset': noLengthReset,
};

export default { meta: { name: 'eslint-plugin-incantly' }, rules };

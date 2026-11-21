/**
 * The `incantly` ESLint plugin: our own rules, so every rule of AGENTS.md and docs/state-machines.md that code can
 * check fails `npm run check` (spec: .kiro/specs/lint-rules/).
 */
import { noAiCredit, noThrowExport } from './code.js';
import { allowedImports } from './imports.js';
import { noFlagSoup, noStaleAfterAwait, tableRefuses, tableRequired, transitionOnly, unionType } from './state.js';

export const rules = {
  'state-no-flag-soup': noFlagSoup,
  'state-transition-only': transitionOnly,
  'state-union-type': unionType,
  'state-table-required': tableRequired,
  'state-table-refuses': tableRefuses,
  'state-no-stale-after-await': noStaleAfterAwait,
  'allowed-imports': allowedImports,
  'no-throw-export': noThrowExport,
  'no-ai-credit': noAiCredit,
};

export default { meta: { name: 'eslint-plugin-incantly' }, rules };

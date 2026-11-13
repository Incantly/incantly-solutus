/**
 * Lists and matrices: public API (docs/features/lists-matrices).
 *
 * Plug in with `registerLists(registry)`. It adds the list and matrix commands, the `Matrix` and `Record` types (their
 * operators, indexing and fields), list broadcasting, the record schemas, notices and reason phrases.
 */
import type { CommandRegistry } from '../../graph/registry';
import { registerNotice } from '../../errors/notices';
import { registerReasonPhrase } from '../../errors/phrases';
import { T, listOf } from '../../language/types';
import type { Ty } from '../../language/types';
import { LIST_COMMANDS } from './list-commands';
import { MATRIX_COMMANDS } from './matrix-commands';
import { registerListOps } from './ops';
import { registerRecordSchema } from './types';

const M: Ty = { k: 'Matrix' };

const NOTICES: Readonly<Record<string, { code: string; severity: 'info' | 'warning'; template: string }>> = {
  ill_conditioned: { code: 'L101', severity: 'warning', template: 'This matrix is nearly singular (condition number about {cond}); its inverse is unreliable.' },
  least_squares: { code: 'L102', severity: 'info', template: 'The system has more equations than unknowns; this is the least-squares solution.' },
  approximate: { code: 'L103', severity: 'info', template: 'Computed in floating point from the eigenvalues; the coefficients are approximate.' },
};

const PHRASES: Readonly<Record<string, { noun: string; sentence: string }>> = {
  size_mismatch: { noun: 'sizes do not match', sentence: 'The lists or matrices have sizes that do not fit together.' },
  not_rectangular: { noun: 'not rectangular', sentence: 'The rows have different lengths, so they do not make a matrix.' },
  not_square: { noun: 'not square', sentence: 'This needs a square matrix.' },
  singular: { noun: 'singular', sentence: 'The matrix has no inverse: its determinant is 0.' },
  not_positive_definite: { noun: 'not positive definite', sentence: 'The matrix is not symmetric positive definite.' },
  complex_eigenvalues: { noun: 'complex eigenvalues', sentence: 'Some eigenvalues are complex, so there are no real eigenvectors for them.' },
  needs_exact: { noun: 'needs exact entries', sentence: 'This needs a matrix of whole numbers or short decimals.' },
  bad_step: { noun: 'bad step', sentence: 'The step is 0 or not finite.' },
  point_at_infinity: { noun: 'point at infinity', sentence: 'The map sends this point to infinity.' },
  too_large: { noun: 'too large', sentence: 'The result is bigger than this command allows.' },
  empty_matrix: { noun: 'empty matrix', sentence: 'The matrix has no rows or no columns.' },
  has_undefined: { noun: 'undefined element', sentence: 'An element of the list is undefined.' },
};

let registered = false;

/** Registers the area. Idempotent. */
export function registerLists(registry: CommandRegistry): void {
  registry.registerAll(LIST_COMMANDS);
  registry.registerAll(MATRIX_COMMANDS);
  if (registered) return;
  registered = true;
  registerListOps();
  registerRecordSchema('LU', [
    { name: 'L', ty: M },
    { name: 'U', ty: M },
    { name: 'P', ty: M },
  ]);
  registerRecordSchema('QR', [
    { name: 'Q', ty: M },
    { name: 'R', ty: M },
  ]);
  registerRecordSchema('SVD', [
    { name: 'U', ty: M },
    { name: 'S', ty: listOf(T.Number) },
    { name: 'V', ty: M },
  ]);
  registerRecordSchema('Eigen', [
    { name: 'values', ty: listOf(T.Point) },
    { name: 'vectors', ty: M },
    { name: 'multiplicities', ty: listOf(T.Number) },
    { name: 'defective', ty: T.Bool },
  ]);
  registerRecordSchema('Diagonalize', [
    { name: 'P', ty: M },
    { name: 'D', ty: M },
    { name: 'jordan', ty: T.Bool },
  ]);
  registerRecordSchema('Tally', [
    { name: 'values', ty: { k: 'List' } },
    { name: 'counts', ty: listOf(T.Number) },
  ]);
  for (const [kind, spec] of Object.entries(NOTICES)) registerNotice(kind, spec);
  for (const [reason, phrase] of Object.entries(PHRASES)) registerReasonPhrase(reason, phrase);
}

export { LIST_COMMANDS, compensatedSum } from './list-commands';
export { MATRIX_COMMANDS, fromLists } from './matrix-commands';
export { addM, mulM, mulPoint, powM, scaleM } from './ops';
export {
  MAX_DENSE, MAX_EIGEN, MAX_EXACT, MAX_LIST, MAX_SYM_EIGEN, RECORD_SCHEMAS, identity, isMatrix, isRecord, makeMatrix, record, registerRecordSchema, registerRecordText, zeros,
} from './types';
export type { MatrixValue, Rat, RecordValue } from './types';
export { ratText } from './exact';

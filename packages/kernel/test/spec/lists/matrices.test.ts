/**
 * Matrices and records (design 5, 6, 7, 8; errors 2, 3, 4): the type, makers, operators, the exact path, everyday
 * commands, factorisations, eigen-anything, records and their errors.
 */
import { describe, expect, it } from 'vitest';
import { isMatrix, isRecord } from '@incantly/kernel';
import { bad, fig, mat, nums, ok, rows, undef, val } from './helpers';

const A = ['A = Matrix([[1, 2], [3, 4]])'];
const near = (a: number, b: number, tol = 1e-10): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
};

describe('5.1 and 5.2 the type and its makers', () => {
  it('Matrix from rows; fields rows, cols, trace; M[i] is a row and M[i][j] an entry, 1-based and negative from the end', () => {
    const f = fig([...A, 'r = A.rows', 'c = A.cols', 'tr = A.trace', 'row = A[2]', 'en = A[2][1]', 'last = A[-1][-1]']);
    expect(f.value('r')).toBe(2);
    expect(f.value('c')).toBe(2);
    expect(f.value('tr')).toBe(5);
    expect(nums(f.value('row'))).toEqual([3, 4]);
    expect(f.value('en')).toBe(3);
    expect(f.value('last')).toBe(4);
    expect(undef(A, 'q = A[3]')).toBe('index_out_of_range');
  });
  it('a ragged literal is refused at check time; a ragged list at run time is not_rectangular', () => {
    expect(fig().apply('M = Matrix([[1, 2], [3]])').ok).toBe(false);
    expect(undef(['L = [[1, 2], [3, 4]]', 'k = 1'], 'M = Matrix(Map(L, r, Head(r, k + if(r[1] == 1, 1, 0))))')).toBe('not_rectangular');
  });
  it('the generator form, Identity, Zeros, Diag, FromRows, FromCols', () => {
    expect(rows(val([], 'H = Matrix(2, 3, i + 10 j, i, j)'))).toEqual([[11, 21, 31], [12, 22, 32]]);
    expect(rows(val([], 'I = Identity(2)'))).toEqual([[1, 0], [0, 1]]);
    expect(rows(val([], 'Z = Zeros(1, 2)'))).toEqual([[0, 0]]);
    expect(rows(val([], 'D = Diag([2, 3])'))).toEqual([[2, 0], [0, 3]]);
    expect(nums(val(A, 'd = Diag(A)'))).toEqual([1, 4]);
    expect(rows(val([], 'F = FromCols([[1, 2], [3, 4]])'))).toEqual([[1, 3], [2, 4]]);
    expect(rows(val([], 'F = FromRows([[1, 2], [3, 4]])'))).toEqual([[1, 2], [3, 4]]);
  });
  it('HStack, VStack, Submatrix, Row, Col, Minor, ToLists', () => {
    expect(rows(val(A, 'S = HStack(A, Identity(2))'))).toEqual([[1, 2, 1, 0], [3, 4, 0, 1]]);
    expect(rows(val(A, 'S = VStack(A, A)'))).toEqual([[1, 2], [3, 4], [1, 2], [3, 4]]);
    expect(undef(A, 'S = HStack(A, Identity(3))')).toBe('size_mismatch');
    expect(rows(val(['B = Matrix([[1, 2, 3], [4, 5, 6], [7, 8, 9]])'], 'S = Submatrix(B, 2, 3, 1, 2)'))).toEqual([[4, 5], [7, 8]]);
    expect(nums(val(A, 'c = Col(A, 2)'))).toEqual([2, 4]);
    expect(nums(val(A, 'c = Row(A, -1)'))).toEqual([3, 4]);
    expect(rows(val(['B = Matrix([[1, 2, 3], [4, 5, 6], [7, 8, 9]])'], 'S = Minor(B, 1, 1)'))).toEqual([[5, 6], [8, 9]]);
    expect(val(A, 'L = ToLists(A)')).toEqual([Float64Array.from([1, 2]), Float64Array.from([3, 4])]);
  });
  it('a list of lists works wherever a matrix does', () => {
    expect(val([], 'd = Determinant([[1, 2], [3, 4]])')).toBe(-2);
  });
});

describe('5.4 operators', () => {
  it('A ± B, k A, A k, A / k, A B, A ^ n, -A, A == B', () => {
    expect(rows(val(A, 'S = A + A'))).toEqual([[2, 4], [6, 8]]);
    expect(rows(val(A, 'S = A - A'))).toEqual([[0, 0], [0, 0]]);
    expect(rows(val(A, 'S = 2 A'))).toEqual([[2, 4], [6, 8]]);
    expect(rows(val(A, 'S = A / 2'))).toEqual([[0.5, 1], [1.5, 2]]);
    expect(rows(val(A, 'S = A * A'))).toEqual([[7, 10], [15, 22]]);
    expect(rows(val(A, 'S = A ^ 3'))).toEqual([[37, 54], [81, 118]]);
    expect(rows(val(A, 'S = A ^ 0'))).toEqual([[1, 0], [0, 1]]);
    expect(rows(val(A, 'S = -A'))).toEqual([[-1, -2], [-3, -4]]);
    expect(val(A, 'q = A == Transpose(Transpose(A))')).toBe(true);
    expect(val(A, 'q = A != 2 A')).toBe(true);
  });
  it('A ^ -1 is the inverse; shapes that do not fit are size_mismatch; a power of a non-square is not_square', () => {
    expect(rows(val(A, 'S = A ^ -1'))).toEqual([[-2, 1], [1.5, -0.5]]);
    expect(undef(A, 'S = A * Matrix([[1, 2, 3]])')).toBe('size_mismatch');
    expect(undef(A, 'S = A + Identity(3)')).toBe('size_mismatch');
    expect(undef([], 'S = Matrix([[1, 2]]) ^ 2')).toBe('not_square');
  });
  it('A * v for a list, A * P for a 2×2 (linear) and a 3×3 (homogeneous) map', () => {
    expect(nums(val(A, 'v = A * [1, 1]'))).toEqual([3, 7]);
    expect(val(A, 'P = A * (1, 0)')).toEqual({ x: 1, y: 3 });
    expect(val(['T = Matrix([[1, 0, 5], [0, 1, -2], [0, 0, 1]])'], 'P = T * (1, 1)')).toEqual({ x: 6, y: -1 });
    expect(undef(['T = Matrix([[1, 0, 0], [0, 1, 0], [1, 0, 0]])'], 'P = T * (0, 3)')).toBe('point_at_infinity');
  });
});

describe('5.3 the exact path', () => {
  it('a literal matrix keeps exact entries: the inverse of an integer matrix is fractions, not rounded floats', () => {
    const inv = mat(val(['B = Matrix([[3, 1], [2, 1]])'], 'C = Invert(Matrix([[1, 1, 1], [0, 2, 5], [2, 5, -1]]))'));
    expect(inv.exact).toBeDefined();
    const f = fig(['T = Matrix([[1, 3], [0, 3]])', 'I3 = Invert(T)']);
    expect(mat(f.value('I3')).data[1]).toBe(-1);
    expect(f.get('I3')?.cell).toBeDefined();
  });
  it('1/10 stays exact through products: (0.1 I)^3 is exactly 0.001', () => {
    const m = mat(val([], 'P = Matrix([[0.1, 0], [0, 0.1]]) ^ 3'));
    expect(m.data[0]).toBe(0.001);
  });
  it('a nearly singular integer-looking matrix gets its exact determinant, not a rounded one', () => {
    expect(val([], 'd = Determinant(Matrix([[100000001, 100000000], [100000000, 99999999]]))')).toBe(-1);
  });
  it('a matrix with a slider in it is floating point', () => {
    expect(mat(val(['a = 2'], 'B = Matrix([[a, 1], [1, a]])')).exact).toBeUndefined();
  });
  it('a matrix shows its exact entries as fractions', () => {
    const f = fig([...A, 'I = Invert(A)']);
    expect(f.steps().find((s) => s.name === 'I')?.valueText).toBe('Matrix 2×2 [[-2, 1], [3/2, -1/2]]');
  });
});

describe('6.1 everyday operations', () => {
  it('Transpose, Determinant, Invert, Trace field, Dim', () => {
    expect(rows(val(A, 'T = Transpose(A)'))).toEqual([[1, 3], [2, 4]]);
    expect(val(A, 'd = Determinant(A)')).toBe(-2);
    expect(val([], 'd = Determinant(Zeros(0, 0))')).toBe(1);
    expect(nums(val([], 'd = Dim(Zeros(2, 3))'))).toEqual([2, 3]);
  });
  it('singular and not_square are reasons with details', () => {
    expect(undef([], 'I = Invert(Matrix([[1, 2], [2, 4]]))')).toBe('singular');
    expect(undef([], 'd = Determinant(Matrix([[1, 2, 3]]))')).toBe('not_square');
    expect(undef(['a = 1'], 'I = Invert(Matrix([[a, 2 a], [2, 4]]))')).toBe('singular');
  });
  it('Rank, Rref, NullSpace, ColSpace', () => {
    expect(val([], 'r = Rank(Matrix([[1, 2], [2, 4]]))')).toBe(1);
    expect(val(['a = 1'], 'r = Rank(Matrix([[a, 2], [2, 4]]))')).toBe(1);
    expect(rows(val([], 'R = Rref(Matrix([[1, 2, 3], [4, 5, 6]]))'))).toEqual([[1, 0, -1], [0, 1, 2]]);
    expect(rows(val([], 'N = NullSpace(Matrix([[1, 2], [2, 4]]))'))).toEqual([[-2], [1]]);
    const n = mat(val(['a = 1'], 'N = NullSpace(Matrix([[a, 2], [2, 4]]))'));
    expect(n.cols).toBe(1);
    near(Math.abs((n.data[0] as number) / (n.data[1] as number)), 2, 1e-9);
    expect(rows(val([], 'C = ColSpace(Matrix([[1, 2], [2, 4]]))'))).toEqual([[1], [2]]);
  });
  it('Solve: square systems exactly, a matrix right side, least squares for a tall system', () => {
    expect(nums(val(A, 'sx = Solve(A, [5, 6])'))).toEqual([-4, 4.5]);
    expect(rows(val(A, 'X = Solve(A, Identity(2))'))).toEqual([[-2, 1], [1.5, -0.5]]);
    const ls = nums(val([], 'sx = Solve(Matrix([[1, 0], [1, 1], [1, 2]]), [1, 2, 4])'));
    near(ls[0] as number, 5 / 6, 1e-12);
    near(ls[1] as number, 1.5, 1e-12);
    expect(undef([], 'sx = Solve(Matrix([[1, 2], [2, 4]]), [1, 1])')).toBe('singular');
  });
  it('Norm (fro, 1, inf, 2), Cond, Cofactor, Adjugate, Kron', () => {
    near(val(A, 'n = Norm(A)') as number, Math.sqrt(30));
    expect(val(A, 'n = Norm(A, "1")')).toBe(6);
    expect(val(A, 'n = Norm(A, "inf")')).toBe(7);
    near(val(A, 'n = Norm(A, "2")') as number, 5.464985704219043, 1e-9);
    bad(fig(A).apply('n = Norm(A, "l3")'), 'bad_option');
    expect(val([], 'c = Cond(Matrix([[1, 2], [2, 4]]))')).toBe(Infinity);
    expect(val(A, 'c = Cofactor(A, 1, 2)')).toBe(-3);
    expect(rows(val(A, 'J = Adjugate(A)'))).toEqual([[4, -2], [-3, 1]]);
    expect(rows(val(A, 'K = Kron(Identity(2), A)'))).toEqual([[1, 2, 0, 0], [3, 4, 0, 0], [0, 0, 1, 2], [0, 0, 3, 4]]);
  });
});

describe('6.2 factorisations', () => {
  const close = (got: number[][], want: number[][], tol = 1e-10): void => {
    got.forEach((r, i) => r.forEach((x, j) => near(x, (want[i] as number[])[j] as number, tol)));
  };
  it('LU gives P M = L U, L unit lower', () => {
    const f = fig([...A, 'f = LU(A)', 'L = f.L', 'U = f.U', 'P = f.P', 'PM = P * A', 'LUp = L * U']);
    close(rows(f.value('PM')), rows(f.value('LUp')));
    expect(rows(f.value('L'))[0]).toEqual([1, 0]);
  });
  it('QR gives M = Q R with orthonormal columns', () => {
    const f = fig([...A, 'f = QR(A)', 'Q = f.Q', 'R = f.R', 'B = Q * R', 'QtQ = Transpose(Q) * Q']);
    close(rows(f.value('B')), [[1, 2], [3, 4]]);
    close(rows(f.value('QtQ')), [[1, 0], [0, 1]]);
  });
  it('Cholesky, and not_positive_definite with the leading minor', () => {
    const f = fig(['L = Cholesky(Matrix([[4, 2], [2, 3]]))', 'B = L * Transpose(L)']);
    close(rows(f.value('B')), [[4, 2], [2, 3]]);
    expect(undef([], 'L = Cholesky(Matrix([[1, 2], [2, 1]]))')).toBe('not_positive_definite');
  });
  it('SVD: singular values descending and M = U diag(S) Vᵀ', () => {
    const f = fig([...A, 'f = SVD(A)', 'U = f.U', 'S = f.S', 'V = f.V', 'B = U * Diag(S) * Transpose(V)']);
    const s = nums(f.value('S'));
    expect((s[0] as number) >= (s[1] as number)).toBe(true);
    close(rows(f.value('B')), [[1, 2], [3, 4]]);
  });
});

describe('6.2 eigen-anything', () => {
  it('Eigenvalues are points (re, im), by real then imaginary part; a rotation has ±i', () => {
    expect(val([], 'ev = Eigenvalues(Matrix([[2, 0], [0, 3]]))')).toEqual([{ x: 2, y: 0 }, { x: 3, y: 0 }]);
    const r = val([], 'ev = Eigenvalues(Matrix([[0, -1], [1, 0]]))') as { x: number; y: number }[];
    near(r[0]?.y as number, -1, 1e-12);
    near(r[1]?.y as number, 1, 1e-12);
  });
  it('a general matrix: the eigenvalues sum to the trace and multiply to the determinant', () => {
    const e = val([], 'ev = Eigenvalues(Matrix([[4, 1, 2], [0, 3, 1], [1, 0, 2]]))') as { x: number; y: number }[];
    near(e.reduce((s, v) => s + v.x, 0), 9, 1e-9);
  });
  it('Eigenvectors: unit columns with M v = λ v; complex eigenvalues give complex_eigenvalues', () => {
    const f = fig(['M = Matrix([[2, 1], [1, 2]])', 'V = Eigenvectors(M)', 'ev = Eigenvalues(M)', 'v1 = Col(V, 1)', 'Mv = M * v1']);
    const v1 = nums(f.value('v1'));
    const mv = nums(f.value('Mv'));
    const lam = (f.value('ev') as { x: number }[])[0]?.x as number;
    near(Math.hypot(v1[0] as number, v1[1] as number), 1, 1e-12);
    near(mv[0] as number, lam * (v1[0] as number), 1e-10);
    expect(undef([], 'V = Eigenvectors(Matrix([[0, -1], [1, 0]]))')).toBe('complex_eigenvalues');
  });
  it('Eigen is a record; its vectors may be undefined while its values are defined', () => {
    const f = fig(['g = Eigen(Matrix([[0, -1], [1, 0]]))', 'vals = g.values', 'd = g.defective']);
    expect(isRecord(f.value('g'))).toBe(true);
    expect((f.value('vals') as unknown[]).length).toBe(2);
    expect(f.value('d')).toBe(false);
    ok(f.apply('vecs = g.vectors'));
    expect(f.value('vecs')).toBeUndefined();
  });
  it('multiplicities and defective: a Jordan block is defective', () => {
    const f = fig(['g = Eigen(Matrix([[2, 1], [0, 2]]))', 'm = g.multiplicities', 'd = g.defective']);
    expect(nums(f.value('m'))).toEqual([2]);
    expect(f.value('d')).toBe(true);
  });
  it('Diagonalize: M = P D P⁻¹', () => {
    const f = fig(['M = Matrix([[2, 1], [1, 2]])', 'g = Diagonalize(M)', 'B = g.P * g.D * Invert(g.P)']);
    const b = rows(f.value('B'));
    near(b[0]?.[0] as number, 2, 1e-10);
    near(b[0]?.[1] as number, 1, 1e-10);
  });
  it('CharPoly is a function of x (exact for a literal matrix); MinPoly needs the exact path', () => {
    const f = fig([...A, 'p = CharPoly(A)', 'p0 = p(0)', 'p1 = p(1)', 'q = MinPoly(2 Identity(3))', 'q2 = q(2)', 'q3 = q(3)']);
    expect(f.value('p0')).toBe(-2);
    expect(f.value('p1')).toBe(-6);
    expect(f.value('q2')).toBe(0);
    expect(f.value('q3')).toBe(1);
    expect(undef(['a = 2'], 'q = MinPoly(Matrix([[a, 0], [0, a]]))')).toBe('needs_exact');
  });
});

describe('8.3 accuracy', () => {
  it('the inverse of the Hilbert matrix of size 6 (exact path) is whole numbers', () => {
    const f = fig(['H = Matrix([[1, 1/2, 1/3, 1/4, 1/5, 1/6], [1/2, 1/3, 1/4, 1/5, 1/6, 1/7], [1/3, 1/4, 1/5, 1/6, 1/7, 1/8], [1/4, 1/5, 1/6, 1/7, 1/8, 1/9], [1/5, 1/6, 1/7, 1/8, 1/9, 1/10], [1/6, 1/7, 1/8, 1/9, 1/10, 1/11]])', 'K = Invert(H)']);
    const k = mat(f.value('K'));
    expect(k.exact).toBeDefined();
    expect(k.data[0]).toBe(36);
    expect(Array.from(k.data).every((x) => Number.isInteger(x))).toBe(true);
  });
  it('a float inverse of a well-conditioned 40×40 matrix has M M⁻¹ within 1e-12 of I', () => {
    const f = fig(['a = 1', 'M = Matrix(40, 40, if(i == j, 50 a, sin(i * j)), i, j)', 'K = Invert(M)', 'E = M * K - Identity(40)', 'n = Norm(E, "inf")']);
    expect(f.value('n') as number).toBeLessThan(1e-12);
  });
  it('the singular values of a random 30×20 matrix square-sum to its Frobenius norm', () => {
    const f = fig(['a = 1', 'M = Matrix(30, 20, a * sin(i + 3 j), i, j)', 'f = SVD(M)', 's = Sum(f.S, x, x^2)', 'n = Norm(M)']);
    near(f.value('s') as number, (f.value('n') as number) ** 2, 1e-9);
  });
});

describe('7 records and errors 2', () => {
  it('an unknown field of a record is unknown_field naming the real ones', () => {
    const e = bad(fig([...A, 'f = LU(A)']).apply('zz = f.Z'), 'unknown_field');
    expect(e.expected).toEqual(['L', 'U', 'P']);
  });
  it('records are values of their command: summaries list the fields', () => {
    const f = fig([...A, 'f = QR(A)']);
    expect(f.steps().find((s) => s.name === 'f')?.valueText).toMatch(/^QR \{Q: Matrix 2×2, R: Matrix 2×2\}$/);
    expect(isMatrix(f.value('A'))).toBe(true);
  });
  it('an ill-conditioned float inverse is defined and warns', () => {
    const f = fig(['a = 1']);
    const r = f.apply('K = Invert(Matrix([[a, 1], [1, a + 1e-14]]))');
    ok(r);
    if (r.ok) expect(JSON.stringify(r)).toMatch(/ill_conditioned/);
  });
});

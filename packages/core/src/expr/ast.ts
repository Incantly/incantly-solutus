export type Expr =
  | { readonly kind: 'number'; readonly value: number; readonly position: number }
  | { readonly kind: 'variable'; readonly name: string; readonly position: number }
  | { readonly kind: 'unary'; readonly operator: '-' | '+' | '!'; readonly operand: Expr; readonly position: number }
  | {
      readonly kind: 'binary';
      readonly operator: BinaryOperator;
      readonly left: Expr;
      readonly right: Expr;
      readonly position: number;
    }
  | { readonly kind: 'call'; readonly name: string; readonly args: readonly Expr[]; readonly position: number }
  | {
      readonly kind: 'conditional';
      readonly test: Expr;
      readonly consequent: Expr;
      readonly alternate: Expr;
      readonly position: number;
    };

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '<'
  | '<='
  | '>'
  | '>='
  | '=='
  | '!='
  | '&&'
  | '||';

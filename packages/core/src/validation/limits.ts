/**
 * Size and complexity budgets for one scene. A typical v0.1 scene is 30 to
 * 120 lines, so these leave room without letting a scene grow unbounded.
 */
export interface SceneLimits {
  readonly jsChars: number;
  readonly htmlChars: number;
  readonly cssChars: number;
  /** Syntax-tree nodes in the JavaScript fragment. */
  readonly astNodes: number;
  /** Nested blocks and functions. */
  readonly depth: number;
  readonly params: number;
  /** Largest literal loop bound. Loops also burn fuel at run time. */
  readonly loopBound: number;
  readonly stringChars: number;
  readonly htmlElements: number;
  readonly htmlDepth: number;
  readonly cssRules: number;
  readonly cssDeclarations: number;
}

export const SCENE_LIMITS: SceneLimits = {
  jsChars: 16_000,
  htmlChars: 4_000,
  cssChars: 4_000,
  astNodes: 6_000,
  depth: 24,
  params: 8,
  loopBound: 5_000,
  stringChars: 600,
  htmlElements: 120,
  htmlDepth: 12,
  cssRules: 80,
  cssDeclarations: 400,
};

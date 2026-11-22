/**
 * The language card the model always reads (docs/features/language/agent.md 1 and 2): the line forms, the rules that
 * trip a model up, the built-in functions on one line, and the operators on types. Stable text, so it caches.
 */

export const LANGUAGE_CARD = `LINES: one change per line. Send 1-5 lines per draw call.
  A = (1, 2)              point             P = (2; 30°)      polar point
  f(x) = x^2 - 2          function          g(x, y) = x*y     two variables
  a = 3 in 0..10 step 0.5 slider            a in 0..20        change range only
  M = Midpoint(A, B)      command result    A, B = Intersect(c, d)   two results
  th = state(0.5)         a state (start value)   th' = -g   its rate: make the state first
  A with color = red      restyle
  Hide(A)                 action            # note   @view -5 5 -3 3
RULES
  '=' defines, '==' compares. Every object has a name (the command is not enough).
  Commands are PascalCase; built-in functions and constants are lowercase.
  A product needs '*', except right after a number: 2x, 3(a+b), 0.5 pi. 'ab' is one name.
  Use brackets after '/': 1/(2x). Powers: x^2, 2^-1. -2^2 is -4. 30° is 30*pi/180.
  Angles are radians. Unknown names are errors; make a number first.
  x and y exist only in f(x) = ... and in relations: l = y == 2x + 1, c = x^2 + y^2 == 4.
  A circle from an equation needs a number radius. With a slider a, x^2 + y^2 == a^2 is a Curve; use Circle(O, a).
  Lists [1,2,3] [1..10] [0..1 step 0.1]; L[1] is the first item. Points (x, y).
  Text: "m = {m:2}" shows a live value. if(cond, a, b). 0 < x < 5 is allowed.
  Names: letters, digits, _ ; P_1 ; Greek ok. Not a command, function, or: t x y z e pi tau deg inf.`;

export const FUNCTIONS_LINE = `FUNCTIONS (lowercase, pure): sin cos tan sec csc cot asin acos atan atan2(y,x) sinh cosh tanh asinh acosh atanh
sqrt cbrt nroot(x,n) hypot(a,b) exp ln log10 log2 log(base,x) abs sign floor ceil round(x[,d]) trunc fract
min max (many args or a list) clamp(x,lo,hi) mod(a,b) rem gcd lcm fact(n) ncr(n,r) npr(n,r) gamma beta erf
lerp(a,b,s) smooth(e0,e1,x) step(e,x) rand(seed) noise(x[,y[,z]]) dot cross norm unit perp todeg torad
rgb(r,g,b[,a]) hsl(h,s,l[,a]) len(text) number(text)   CONSTANTS: pi tau e deg inf undefined true false
FIELDS: P.x P.y  v.length  s.length  c.center c.radius  poly.area poly.perimeter`;

export const OPERATORS_LINE = `Point-Point = Vector. Point+Vector = Point. Number*Vector = Vector. No Point*Number: use 2*Vector(A) or Dilate.
Functions combine: h = f + g, k = 2 f + 1. A list with a number on its right works element-wise: L * 2 (2 * L is an error).`;

/** The whole grammar summary, as the prompt prints it. */
export const GRAMMAR: string = [LANGUAGE_CARD, FUNCTIONS_LINE, OPERATORS_LINE].join('\n');

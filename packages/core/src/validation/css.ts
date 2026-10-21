import { COLOUR_FUNCTIONS, NAMED_COLOURS } from './colours';
import { LineIndex, type Diagnostic } from './diagnostics';
import { SCENE_LIMITS, type SceneLimits } from './limits';

/**
 * The CSS validator. Scene CSS lays out the scene's own HTML and may read the
 * theme tokens. It may not load anything, pick literal colours, animate on
 * its own, cover the page or restyle the engine. The text goes into the frame
 * verbatim, allowed by its hash, so it must also never contain "<".
 */

export interface CssValidation {
  readonly diagnostics: Diagnostic[];
}

type TokenType =
  | 'ident'
  | 'function'
  | 'at'
  | 'hash'
  | 'string'
  | 'number'
  | 'percentage'
  | 'dimension'
  | 'delim'
  | 'colon'
  | 'semicolon'
  | 'comma'
  | '['
  | ']'
  | '('
  | ')'
  | '{'
  | '}'
  | 'ws';

interface Token {
  readonly type: TokenType;
  /** Lower-cased name for idents, functions, at-keywords and hashes; the unit for dimensions. */
  readonly value: string;
  readonly number?: number;
  readonly offset: number;
}

const PROPERTIES: ReadonlySet<string> = new Set(
  (
    'display flex flex-direction flex-wrap flex-flow flex-grow flex-shrink flex-basis order ' +
    'grid grid-template-columns grid-template-rows grid-template-areas grid-column grid-row grid-area ' +
    'grid-auto-flow grid-auto-columns grid-auto-rows gap row-gap column-gap ' +
    'align-items align-content align-self justify-items justify-content justify-self place-items place-content place-self ' +
    'width height min-width max-width min-height max-height aspect-ratio box-sizing ' +
    'margin margin-top margin-right margin-bottom margin-left margin-inline margin-block ' +
    'padding padding-top padding-right padding-bottom padding-left padding-inline padding-block ' +
    'overflow overflow-x overflow-y position top right bottom left inset z-index ' +
    'font-size font-weight font-style font-variant-numeric line-height letter-spacing word-spacing ' +
    'text-align text-transform text-decoration text-decoration-line text-indent white-space word-break overflow-wrap hyphens ' +
    'color background-color opacity visibility vertical-align ' +
    'border border-top border-right border-bottom border-left border-width border-style border-color border-radius ' +
    'outline outline-width outline-style outline-color outline-offset ' +
    'list-style list-style-type list-style-position ' +
    'transform transform-origin transition transition-property transition-duration transition-timing-function transition-delay ' +
    'cursor pointer-events user-select touch-action ' +
    'fill fill-opacity stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap stroke-linejoin vector-effect'
  ).split(' '),
);

const PROPERTY_ADVICE: Readonly<Record<string, string>> = {
  filter: 'filter is slow on iPad and not allowed; fake depth with tones',
  'backdrop-filter': 'backdrop-filter is slow on iPad and not allowed',
  'mix-blend-mode': 'Blend modes are not allowed',
  mask: 'Masks are slow on iPad and not allowed',
  'mask-image': 'Masks are slow on iPad and not allowed',
  'box-shadow': 'Shadows are slow on iPad and not allowed; use a border or a tone',
  'text-shadow': 'Shadows are slow on iPad and not allowed',
  animation: 'CSS animations play on their own and cannot be paused; animate with inc.onFrame or inc.tween',
  'animation-name': 'CSS animations play on their own and cannot be paused; animate with inc.onFrame or inc.tween',
  content: 'Generated content is not allowed; text belongs in the HTML fragment',
  background: 'Use background-color with a theme token',
  'background-image': 'Background images would load from the network',
  'font-family': 'The theme sets the font',
  font: 'The theme sets the font; use font-size and font-weight',
  'will-change': 'will-change is not allowed',
  behavior: 'behavior is not allowed',
  '-moz-binding': '-moz-binding is not allowed',
};

/** Functions a value may use. Anything else, including url() and colour functions, is rejected. */
const FUNCTIONS: ReadonlySet<string> = new Set([
  'var',
  'calc',
  'min',
  'max',
  'clamp',
  'minmax',
  'repeat',
  'fit-content',
  'translate',
  'translatex',
  'translatey',
  'rotate',
  'scale',
  'scalex',
  'scaley',
  'cubic-bezier',
  'steps',
]);

const UNITS: ReadonlySet<string> = new Set(['px', 'em', 'rem', 'ch', 'ex', 'vw', 'vh', 'vmin', 'vmax', 'fr', 'deg', 'rad', 'turn', 's', 'ms', 'lh']);

const TYPE_SELECTORS: ReadonlySet<string> = new Set([
  'div',
  'span',
  'p',
  'section',
  'strong',
  'em',
  'b',
  'i',
  'small',
  'sub',
  'sup',
  'code',
  'abbr',
  'ul',
  'ol',
  'li',
  'figure',
  'figcaption',
  'hr',
  'br',
  'svg',
  'g',
  'path',
  'line',
  'circle',
  'rect',
  'text',
  'polyline',
]);

const PSEUDO_CLASSES: ReadonlySet<string> = new Set([
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
  'first-child',
  'last-child',
  'only-child',
  'first-of-type',
  'last-of-type',
  'empty',
]);
const PSEUDO_FUNCTIONS: ReadonlySet<string> = new Set(['not', 'is', 'where', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);

const MEDIA_FEATURES: Readonly<Record<string, ReadonlySet<string> | 'length'>> = {
  'min-width': 'length',
  'max-width': 'length',
  'prefers-reduced-motion': new Set(['reduce', 'no-preference']),
  'prefers-color-scheme': new Set(['light', 'dark']),
  pointer: new Set(['coarse', 'fine', 'none']),
  hover: new Set(['hover', 'none']),
  orientation: new Set(['portrait', 'landscape']),
};
const MEDIA_WORDS: ReadonlySet<string> = new Set(['screen', 'print', 'all', 'and', 'not', 'only']);

export function validateSceneCss(source: string, limits: SceneLimits = SCENE_LIMITS): CssValidation {
  return new CssValidator(source, limits).run();
}

class CssValidator {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly index: LineIndex;
  private tokens: Token[] = [];
  private i = 0;
  private rules = 0;
  private declarations = 0;

  constructor(
    private readonly source: string,
    private readonly limits: SceneLimits,
  ) {
    this.index = new LineIndex(source);
  }

  run(): CssValidation {
    if (this.source.length > this.limits.cssChars) {
      this.report('css-budget', `The scene CSS is ${this.source.length} characters; the limit is ${this.limits.cssChars}`, 0);
      return { diagnostics: this.diagnostics };
    }
    const tokens = this.tokenize();
    if (!tokens) return { diagnostics: this.diagnostics };
    this.tokens = tokens;
    this.stylesheet(false);
    return { diagnostics: this.diagnostics };
  }

  private report(rule: string, message: string, offset: number): void {
    const { line, column } = this.index.position(offset);
    this.diagnostics.push({ fragment: 'css', rule, message, line, column, severity: 'error' });
  }

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  private tokenize(): Token[] | null {
    const src = this.source;
    const out: Token[] = [];
    let pos = 0;
    const identAt = (p: number) => /^-?(?:[A-Za-z_]|-)[A-Za-z0-9_-]*/.exec(src.slice(p));
    while (pos < src.length) {
      const ch = src[pos]!;
      const rest = src.slice(pos);
      if (ch === '<') {
        this.report('css-syntax', '"<" is not allowed in scene CSS', pos);
        return null;
      }
      if (ch === '\\') {
        this.report('css-syntax', 'CSS escapes are not allowed in scene CSS', pos);
        return null;
      }
      if (/\s/.test(ch)) {
        const ws = /^\s+/.exec(rest)![0];
        out.push({ type: 'ws', value: ' ', offset: pos });
        pos += ws.length;
        continue;
      }
      if (rest.startsWith('/*')) {
        const end = src.indexOf('*/', pos + 2);
        if (end === -1) {
          this.report('css-syntax', 'This comment is never closed with */', pos);
          return null;
        }
        pos = end + 2;
        continue;
      }
      if (rest.startsWith('-->')) {
        this.report('css-syntax', '"-->" is not allowed in scene CSS', pos);
        return null;
      }
      if (ch === '"' || ch === "'") {
        const end = src.indexOf(ch, pos + 1);
        const newline = src.slice(pos + 1, end === -1 ? undefined : end).search(/[\n\r]/);
        if (end === -1 || newline !== -1) {
          this.report('css-syntax', 'This string is never closed', pos);
          return null;
        }
        out.push({ type: 'string', value: src.slice(pos + 1, end), offset: pos });
        pos = end + 1;
        continue;
      }
      const number = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
      if (number && !(ch === '-' && identAt(pos) && !/^-[\d.]/.test(rest))) {
        pos += number[0].length;
        const value = Number(number[0]);
        if (src[pos] === '%') {
          out.push({ type: 'percentage', value: '%', number: value, offset: pos - number[0].length });
          pos++;
          continue;
        }
        const unit = /^[A-Za-z]+/.exec(src.slice(pos));
        if (unit) {
          out.push({ type: 'dimension', value: unit[0].toLowerCase(), number: value, offset: pos - number[0].length });
          pos += unit[0].length;
          continue;
        }
        out.push({ type: 'number', value: number[0], number: value, offset: pos - number[0].length });
        continue;
      }
      if (ch === '@') {
        const name = identAt(pos + 1);
        if (!name) {
          this.report('css-syntax', 'Unexpected "@"', pos);
          return null;
        }
        out.push({ type: 'at', value: name[0].toLowerCase(), offset: pos });
        pos += 1 + name[0].length;
        continue;
      }
      if (ch === '#') {
        const name = /^[A-Za-z0-9_-]+/.exec(src.slice(pos + 1));
        if (!name) {
          this.report('css-syntax', 'Unexpected "#"', pos);
          return null;
        }
        out.push({ type: 'hash', value: name[0], offset: pos });
        pos += 1 + name[0].length;
        continue;
      }
      const ident = identAt(pos);
      if (ident) {
        const name = ident[0];
        pos += name.length;
        if (src[pos] === '(') {
          out.push({ type: 'function', value: name.toLowerCase(), offset: pos - name.length });
          pos++;
        } else out.push({ type: 'ident', value: name, offset: pos - name.length });
        continue;
      }
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7f]/.test(ch)) {
        this.report('css-syntax', 'Only plain ASCII is allowed outside strings and comments', pos);
        return null;
      }
      const single: Partial<Record<string, TokenType>> = {
        ':': 'colon',
        ';': 'semicolon',
        ',': 'comma',
        '[': '[',
        ']': ']',
        '(': '(',
        ')': ')',
        '{': '{',
        '}': '}',
      };
      out.push({ type: single[ch] ?? 'delim', value: ch, offset: pos });
      pos++;
    }
    return out;
  }

  private peek(skipWs = true): Token | undefined {
    let j = this.i;
    if (skipWs) while (this.tokens[j]?.type === 'ws') j++;
    return this.tokens[j];
  }

  private next(skipWs = true): Token | undefined {
    if (skipWs) while (this.tokens[this.i]?.type === 'ws') this.i++;
    return this.tokens[this.i++];
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  private stylesheet(nested: boolean): void {
    for (;;) {
      const token = this.peek();
      if (!token) {
        if (nested) this.report('css-syntax', 'A block is never closed with "}"', this.source.length - 1);
        return;
      }
      if (token.type === '}') {
        if (nested) {
          this.next();
          return;
        }
        this.report('css-syntax', 'Unexpected "}"', token.offset);
        this.next();
        continue;
      }
      if (token.type === 'at') {
        this.atRule(nested);
        continue;
      }
      this.rule();
    }
  }

  private atRule(nested: boolean): void {
    const at = this.next()!;
    if (at.value === 'media' && !nested) {
      const prelude = this.collectUntil(['{']);
      this.mediaQuery(prelude, at.offset);
      if (this.peek()?.type !== '{') {
        this.report('css-syntax', '@media needs a block', at.offset);
        return;
      }
      this.next();
      this.stylesheet(true);
      return;
    }
    const advice: Record<string, string> = {
      import: '@import would load another stylesheet',
      'font-face': '@font-face would load fonts; the theme sets the font',
      keyframes: 'CSS animations play on their own and cannot be paused; animate with inc.onFrame or inc.tween',
      namespace: '@namespace is not allowed',
      charset: '@charset is not needed',
      media: 'Nested @media rules are not allowed',
    };
    this.report('css-at-rule', advice[at.value] ?? `@${at.value} is not allowed in scene CSS`, at.offset);
    // Skip the at-rule to keep reporting useful errors after it.
    this.collectUntil(['semicolon', '{']);
    const end = this.next();
    if (end?.type === '{') this.skipBlock();
  }

  private mediaQuery(prelude: Token[], offset: number): void {
    const tokens = prelude.filter((t) => t.type !== 'ws');
    if (tokens.length === 0) {
      this.report('css-media', '@media needs a condition', offset);
      return;
    }
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j]!;
      if (t.type === 'ident' && MEDIA_WORDS.has(t.value.toLowerCase())) continue;
      if (t.type === 'comma') continue;
      if (t.type === '(') {
        const name = tokens[j + 1];
        const colon = tokens[j + 2];
        const value = tokens[j + 3];
        const close = tokens[j + 4];
        const feature = name?.type === 'ident' ? MEDIA_FEATURES[name.value.toLowerCase()] : undefined;
        const ok =
          feature !== undefined &&
          colon?.type === 'colon' &&
          close?.type === ')' &&
          value !== undefined &&
          (feature === 'length'
            ? value.type === 'dimension' && UNITS.has(value.value)
            : value.type === 'ident' && feature.has(value.value.toLowerCase()));
        if (!ok) {
          this.report('css-media', `Only width, reduced-motion, colour-scheme, pointer, hover and orientation media features are allowed`, t.offset);
          return;
        }
        j += 4;
        continue;
      }
      this.report('css-media', 'Unexpected token in the media query', t.offset);
      return;
    }
  }

  private rule(): void {
    const start = this.peek()!;
    const selector = this.collectUntil(['{', 'semicolon', '}']);
    const open = this.peek();
    if (open?.type !== '{') {
      this.report('css-syntax', 'Expected "{" after the selector', open?.offset ?? start.offset);
      if (open?.type === 'semicolon') this.next();
      return;
    }
    this.rules++;
    if (this.rules > this.limits.cssRules) {
      this.report('css-budget', `The scene CSS has more than ${this.limits.cssRules} rules`, start.offset);
    }
    this.selector(selector, start.offset);
    this.next();
    this.declarationBlock();
  }

  private collectUntil(stops: readonly TokenType[]): Token[] {
    const out: Token[] = [];
    let depth = 0;
    for (;;) {
      const token = this.tokens[this.i];
      if (!token) return out;
      if (depth === 0 && stops.includes(token.type)) return out;
      if (token.type === '(' || token.type === 'function' || token.type === '[') depth++;
      if ((token.type === ')' || token.type === ']') && depth > 0) depth--;
      out.push(token);
      this.i++;
    }
  }

  private skipBlock(): void {
    let depth = 1;
    while (depth > 0) {
      const token = this.next(false);
      if (!token) return;
      if (token.type === '{') depth++;
      if (token.type === '}') depth--;
    }
  }

  // -------------------------------------------------------------------------
  // Selectors
  // -------------------------------------------------------------------------

  private selector(tokens: Token[], offset: number): void {
    const list = tokens.filter((t, j) => !(t.type === 'ws' && (j === 0 || j === tokens.length - 1)));
    if (list.length === 0) {
      this.report('css-selector', 'A rule needs a selector', offset);
      return;
    }
    if (list.map((t) => t.value).join('').length > 200) {
      this.report('css-selector', 'This selector is longer than 200 characters', offset);
    }
    for (let j = 0; j < list.length; j++) {
      const t = list[j]!;
      const fail = (message: string) => this.report('css-selector', message, t.offset);
      switch (t.type) {
        case 'ws':
        case 'comma':
          break;
        case 'ident': {
          const name = t.value.toLowerCase();
          if (name === 'html' || name === 'body') fail(`Scene CSS cannot style <${name}>; style the scene's own elements`);
          else if (!TYPE_SELECTORS.has(name)) fail(`"${t.value}" is not an element a scene can style`);
          break;
        }
        case 'hash':
          if (/^inc/i.test(t.value)) fail('Ids starting with "inc" belong to the engine');
          break;
        case 'delim':
          if (t.value === '.') {
            const name = list[j + 1];
            if (name?.type !== 'ident') fail('Expected a class name after "."');
            else if (/^inc-/i.test(name.value)) {
              this.report('css-selector', 'Classes starting with "inc-" belong to the engine; style your own classes', name.offset);
            }
            j++;
          } else if (!['>', '+', '~', '*'].includes(t.value)) fail(`Unexpected "${t.value}" in a selector`);
          break;
        case 'colon': {
          const next = list[j + 1];
          if (next?.type === 'colon') {
            fail('Pseudo-elements are not allowed in scene CSS');
            return;
          }
          if (next?.type === 'ident') {
            const name = next.value.toLowerCase();
            if (name === 'root') fail('Scene CSS cannot style :root');
            else if (!PSEUDO_CLASSES.has(name)) fail(`:${name} is not allowed in scene CSS`);
            j++;
          } else if (next?.type === 'function') {
            if (!PSEUDO_FUNCTIONS.has(next.value)) fail(`:${next.value}() is not allowed in scene CSS`);
            j++;
          } else fail('Expected a pseudo-class after ":"');
          break;
        }
        case '[': {
          const close = list.findIndex((x, k) => k > j && x.type === ']');
          const inside = list.slice(j + 1, close === -1 ? undefined : close).filter((x) => x.type !== 'ws');
          const okName = inside[0]?.type === 'ident';
          const okRest =
            inside.length === 1 ||
            (inside.length >= 3 &&
              (inside[1]!.type === 'delim' || inside[1]!.type === 'colon') &&
              (inside[inside.length - 1]!.type === 'string' || inside[inside.length - 1]!.type === 'ident'));
          if (close === -1 || !okName || !okRest) fail('Malformed attribute selector');
          j = close === -1 ? list.length : close;
          break;
        }
        case 'number':
        case 'dimension':
        case ')':
        case '(':
          // Arguments of :nth-child(2n+1) and friends.
          break;
        case 'function':
          // :not( and friends are handled with their colon; a bare function is not a selector.
          fail(`Unexpected ${t.value}() in a selector`);
          break;
        default:
          fail('Unexpected token in a selector');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Declarations
  // -------------------------------------------------------------------------

  private declarationBlock(): void {
    for (;;) {
      const token = this.peek();
      if (!token) {
        this.report('css-syntax', 'A rule is never closed with "}"', this.source.length - 1);
        return;
      }
      if (token.type === '}') {
        this.next();
        return;
      }
      if (token.type === 'semicolon') {
        this.next();
        continue;
      }
      this.declaration();
    }
  }

  private declaration(): void {
    const name = this.next()!;
    if (name.type !== 'ident') {
      this.report('css-syntax', 'Expected a property name', name.offset);
      this.collectUntil(['semicolon', '}']);
      return;
    }
    if (this.peek()?.type !== 'colon') {
      this.report('css-syntax', `Expected ":" after ${name.value}`, name.offset);
      this.collectUntil(['semicolon', '}']);
      return;
    }
    this.next();
    const value = this.collectUntil(['semicolon', '}']);
    this.declarations++;
    if (this.declarations > this.limits.cssDeclarations) {
      this.report('css-budget', `The scene CSS has more than ${this.limits.cssDeclarations} declarations`, name.offset);
    }
    const property = name.value.toLowerCase();
    if (property.startsWith('--')) {
      if (property.startsWith('--inc-')) {
        this.report('css-property', 'Theme tokens (--inc-*) belong to the engine; read them with var(), never redefine them', name.offset);
      }
    } else if (!PROPERTIES.has(property)) {
      this.report('css-property', PROPERTY_ADVICE[property] ?? `${name.value} is not allowed in scene CSS`, name.offset);
      return;
    }
    this.value(property, value, name.offset);
  }

  private value(property: string, tokens: Token[], offset: number): void {
    const meaningful = tokens.filter((t) => t.type !== 'ws');
    if (meaningful.length === 0) {
      this.report('css-syntax', `${property} needs a value`, offset);
      return;
    }
    for (let j = 0; j < meaningful.length; j++) {
      const t = meaningful[j]!;
      const fail = (rule: string, message: string) => this.report(rule, message, t.offset);
      switch (t.type) {
        case 'hash':
          fail('css-colour', `#${t.value} is a literal colour; use a theme token such as var(--inc-fg)`);
          break;
        case 'string':
          fail('css-value', 'Strings are not allowed in scene CSS values');
          break;
        case 'ident': {
          const word = t.value.toLowerCase();
          if (NAMED_COLOURS.has(word)) fail('css-colour', `${t.value} is a literal colour; use a theme token such as var(--inc-a)`);
          if (property === 'position' && (word === 'fixed' || word === 'sticky')) {
            fail('css-value', `position: ${word} would cover the page; use relative or absolute inside the figure`);
          }
          break;
        }
        case 'dimension':
          if (!UNITS.has(t.value)) fail('css-value', `The unit ${t.value} is not allowed`);
          break;
        case 'function': {
          if (t.value === 'url' || t.value === 'image-set' || t.value === 'image' || t.value === 'cross-fade' || t.value === 'element' || t.value === 'paint') {
            fail('css-url', `${t.value}() would load a resource; scene CSS cannot load anything`);
          } else if (COLOUR_FUNCTIONS.has(t.value)) {
            fail('css-colour', `${t.value}() makes a literal colour; use a theme token such as var(--inc-b)`);
          } else if (t.value === 'var') {
            const ref = meaningful[j + 1];
            if (ref?.type !== 'ident' || !ref.value.startsWith('--')) fail('css-value', 'var() takes a custom property name such as --inc-fg');
          } else if (!FUNCTIONS.has(t.value)) {
            fail('css-value', `${t.value}() is not allowed in scene CSS`);
          }
          break;
        }
        case 'delim':
          if (t.value === '!') {
            fail('css-value', '!important is not allowed; the engine theme must stay in charge of its own UI');
            return;
          }
          if (!['/', '+', '-', '*', '.'].includes(t.value)) fail('css-value', `Unexpected "${t.value}" in a value`);
          break;
        case 'number':
        case 'percentage':
        case 'comma':
        case '(':
        case ')':
          break;
        case 'colon':
        case '[':
        case ']':
        case '{':
        case 'at':
          fail('css-syntax', 'Unexpected token in a value');
          return;
        default:
          break;
      }
    }
  }
}

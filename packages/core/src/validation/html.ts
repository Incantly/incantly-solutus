import { LineIndex, type Diagnostic } from './diagnostics';
import { SCENE_LIMITS, type SceneLimits } from './limits';

/**
 * The HTML validator. Scene HTML is a small structural fragment: containers
 * for stages and short text. It is parsed by a strict tokenizer and, when it
 * passes, re-serialized from the parsed tree. The frame receives that
 * canonical HTML, never the original text, so what the browser parses is
 * exactly what was checked.
 */

export interface HtmlValidation {
  readonly diagnostics: Diagnostic[];
  /** Canonical HTML rebuilt from the parsed tree. Only meaningful without errors. */
  readonly html: string;
  /** Every id the fragment declares. */
  readonly ids: ReadonlySet<string>;
}

const PHRASING: ReadonlySet<string> = new Set(['span', 'strong', 'em', 'b', 'i', 'small', 'sub', 'sup', 'br', 'code', 'abbr']);
const FLOW: ReadonlySet<string> = new Set([...PHRASING, 'div', 'p', 'section', 'ul', 'ol', 'figure', 'hr']);
const ELEMENTS: ReadonlySet<string> = new Set([...FLOW, 'li', 'figcaption']);
const VOID: ReadonlySet<string> = new Set(['br', 'hr']);
/** Elements whose children must be phrasing content. */
const PHRASING_ONLY: ReadonlySet<string> = new Set(['p', ...PHRASING]);

const ELEMENT_ADVICE: Readonly<Record<string, string>> = {
  script: 'Script elements are not allowed; scene code belongs in the JS fragment',
  style: 'Style elements are not allowed; put CSS in the CSS fragment',
  link: 'Link elements would load external resources',
  meta: 'Meta elements are not allowed',
  base: 'Base elements would change where the figure loads from',
  iframe: 'Embedded frames are not allowed',
  frame: 'Embedded frames are not allowed',
  object: 'Embedded objects are not allowed',
  embed: 'Embedded content is not allowed',
  img: 'Images would load from the network; draw with inc.svg instead',
  picture: 'Images would load from the network; draw with inc.svg instead',
  video: 'Media elements are not allowed',
  audio: 'Media elements are not allowed',
  source: 'Media elements are not allowed',
  canvas: 'Canvas is not available in v0.1; draw with inc.svg or inc.graph2d',
  svg: 'Inline SVG is not allowed; draw with inc.svg or inc.graph2d so the engine can theme and budget it',
  math: 'MathML is not allowed in v0.1',
  foreignobject: 'foreignObject is not allowed',
  a: 'Links are not allowed: they would navigate the figure away',
  form: 'Forms are not allowed; the engine builds controls from inc.param',
  input: 'Inputs are not allowed; the engine builds controls from inc.param',
  button: 'Buttons are not allowed; the engine builds controls and steps',
  select: 'Selects are not allowed; the engine builds controls from inc.param',
  textarea: 'Text areas are not allowed',
  label: 'Labels are not needed; the engine labels its own controls',
  template: 'Templates are not allowed',
  slot: 'Slots are not allowed',
  dialog: 'Dialogs are not allowed',
  details: 'The engine provides the text-description toggle; use inc.describe',
};

const ROLES: ReadonlySet<string> = new Set(['group', 'note', 'presentation', 'none']);
const NAME = /^[A-Za-z][\w-]{0,63}$/;
const DATA_ATTRIBUTE = /^data-[a-z][a-z0-9-]{0,40}$/;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  times: '×',
  minus: '−',
  deg: '°',
  middot: '·',
  hellip: '…',
};

interface Element {
  readonly name: string;
  readonly attributes: Array<[string, string | null]>;
  readonly children: Array<Element | string>;
  readonly offset: number;
}

export function validateSceneHtml(source: string, limits: SceneLimits = SCENE_LIMITS): HtmlValidation {
  return new HtmlValidator(source, limits).run();
}

class HtmlValidator {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly index: LineIndex;
  private readonly ids = new Set<string>();
  private pos = 0;
  private elements = 0;

  constructor(
    private readonly source: string,
    private readonly limits: SceneLimits,
  ) {
    this.index = new LineIndex(source);
  }

  run(): HtmlValidation {
    if (this.source.length > this.limits.htmlChars) {
      this.report('html-budget', `The scene HTML is ${this.source.length} characters; the limit is ${this.limits.htmlChars}`, 0);
      return this.result([]);
    }
    const root: Element = { name: '#root', attributes: [], children: [], offset: 0 };
    const stack: Element[] = [root];
    const src = this.source;
    while (this.pos < src.length) {
      const lt = src.indexOf('<', this.pos);
      if (lt === -1) {
        this.text(stack, src.slice(this.pos), this.pos);
        break;
      }
      if (lt > this.pos) this.text(stack, src.slice(this.pos, lt), this.pos);
      this.pos = lt;
      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        if (end === -1) {
          this.report('html-syntax', 'This comment is never closed with -->', lt);
          break;
        }
        this.pos = end + 3; // comments are dropped from the canonical HTML
        continue;
      }
      const next = src[lt + 1] ?? '';
      if (next === '!' || next === '?') {
        this.report('html-syntax', 'Doctypes, CDATA and processing instructions are not allowed in a fragment', lt);
        break;
      }
      if (next === '/') {
        if (!this.endTag(stack)) break;
        continue;
      }
      if (/[A-Za-z]/.test(next)) {
        if (!this.startTag(stack)) break;
        continue;
      }
      // A "<" that does not start a tag is text, as in "a < b".
      this.text(stack, '<', lt);
      this.pos = lt + 1;
    }
    for (let i = stack.length - 1; i > 0; i--) {
      const open = stack[i]!;
      this.report('html-unclosed', `<${open.name}> is never closed`, open.offset);
    }
    return this.result(root.children);
  }

  private result(children: Array<Element | string>): HtmlValidation {
    return { diagnostics: this.diagnostics, html: serialize(children), ids: this.ids };
  }

  private report(rule: string, message: string, offset: number): void {
    const { line, column } = this.index.position(offset);
    this.diagnostics.push({ fragment: 'html', rule, message, line, column, severity: 'error' });
  }

  private text(stack: Element[], raw: string, offset: number): void {
    const parent = stack[stack.length - 1]!;
    const text = this.decode(raw, offset);
    if (text === null) return;
    if ((parent.name === 'ul' || parent.name === 'ol') && text.trim() !== '') {
      this.report('html-content', `Text cannot sit directly inside <${parent.name}>; wrap it in <li>`, offset);
      return;
    }
    const last = parent.children[parent.children.length - 1];
    if (typeof last === 'string') parent.children[parent.children.length - 1] = last + text;
    else parent.children.push(text);
  }

  private decode(raw: string, offset: number): string | null {
    let out = '';
    let i = 0;
    while (i < raw.length) {
      const amp = raw.indexOf('&', i);
      if (amp === -1) {
        out += raw.slice(i);
        break;
      }
      out += raw.slice(i, amp);
      const match = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/.exec(raw.slice(amp));
      if (!match) {
        if (/^&[#A-Za-z]/.test(raw.slice(amp))) {
          this.report('html-entity', 'This character reference is malformed; end it with ";" or write the character itself', offset + amp);
          return null;
        }
        out += '&';
        i = amp + 1;
        continue;
      }
      const body = match[1]!;
      let decoded: string | undefined;
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
        const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff;
        decoded = valid && (code >= 0x20 || code === 9 || code === 10) ? String.fromCodePoint(code) : undefined;
      } else decoded = ENTITIES[body];
      if (decoded === undefined) {
        this.report('html-entity', `&${body}; is not a supported character reference; write the character itself`, offset + amp);
        return null;
      }
      out += decoded;
      i = amp + match[0].length;
    }
    return out;
  }

  private startTag(stack: Element[]): boolean {
    const src = this.source;
    const start = this.pos;
    const nameMatch = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(src.slice(start));
    const name = nameMatch![1]!.toLowerCase();
    this.pos = start + nameMatch![0].length;
    const attributes: Array<[string, string | null]> = [];
    const seen = new Set<string>();
    let selfClosing = false;
    for (;;) {
      const ws = /^\s*/.exec(src.slice(this.pos))![0];
      this.pos += ws.length;
      if (this.pos >= src.length) {
        this.report('html-syntax', `<${name}> is not closed with ">"`, start);
        return false;
      }
      if (src.startsWith('/>', this.pos)) {
        selfClosing = true;
        this.pos += 2;
        break;
      }
      if (src[this.pos] === '>') {
        this.pos++;
        break;
      }
      const attrStart = this.pos;
      const attrMatch = /^[^\s"'>/=<`]+/.exec(src.slice(this.pos));
      if (!attrMatch || ws.length === 0) {
        this.report('html-syntax', `Unexpected character in <${name}>`, this.pos);
        return false;
      }
      const attrName = attrMatch[0].toLowerCase();
      this.pos += attrMatch[0].length;
      let value: string | null = null;
      const eq = /^\s*=\s*/.exec(src.slice(this.pos));
      if (eq) {
        this.pos += eq[0].length;
        const quote = src[this.pos];
        let raw: string;
        if (quote === '"' || quote === "'") {
          const end = src.indexOf(quote, this.pos + 1);
          if (end === -1) {
            this.report('html-syntax', `The value of ${attrName} is never closed`, this.pos);
            return false;
          }
          raw = src.slice(this.pos + 1, end);
          this.pos = end + 1;
        } else {
          const unquoted = /^[^\s"'=<>`]+/.exec(src.slice(this.pos));
          if (!unquoted) {
            this.report('html-syntax', `${attrName} needs a value`, this.pos);
            return false;
          }
          raw = unquoted[0];
          this.pos += raw.length;
        }
        value = this.decode(raw, attrStart);
        if (value === null) return false;
      }
      if (seen.has(attrName)) {
        this.report('html-attribute', `${attrName} appears twice on <${name}>`, attrStart);
        continue;
      }
      seen.add(attrName);
      if (this.checkAttribute(name, attrName, value, attrStart)) attributes.push([attrName, value]);
    }

    const parent = stack[stack.length - 1]!;
    if (!ELEMENTS.has(name)) {
      this.report(
        'html-element',
        ELEMENT_ADVICE[name] ?? `<${name}> is not allowed; scene HTML may use ${[...ELEMENTS].sort().join(', ')}`,
        start,
      );
      // Skip the rest of a raw-text element so its content does not cascade into more errors.
      if (name === 'script' || name === 'style' || name === 'textarea' || name === 'template') {
        const close = src.toLowerCase().indexOf(`</${name}`, this.pos);
        this.pos = close === -1 ? src.length : close;
        const end = src.indexOf('>', this.pos);
        this.pos = end === -1 ? src.length : end + 1;
      } else if (!VOID.has(name) && !selfClosing) {
        stack.push({ name, attributes: [], children: [], offset: start });
      }
      return true;
    }
    this.checkPlacement(parent, name, start);
    if (selfClosing && !VOID.has(name)) {
      this.report('html-syntax', `<${name}/> cannot self-close; write <${name}></${name}>`, start);
    }
    this.elements++;
    if (this.elements > this.limits.htmlElements) {
      this.report('html-budget', `The scene HTML has more than ${this.limits.htmlElements} elements`, start);
      return false;
    }
    const element: Element = { name, attributes, children: [], offset: start };
    parent.children.push(element);
    if (!VOID.has(name) && !selfClosing) {
      stack.push(element);
      if (stack.length - 1 > this.limits.htmlDepth) {
        this.report('html-budget', `Elements nest more than ${this.limits.htmlDepth} levels deep`, start);
        return false;
      }
    }
    return true;
  }

  private endTag(stack: Element[]): boolean {
    const src = this.source;
    const start = this.pos;
    const match = /^<\/([A-Za-z][A-Za-z0-9-]*)\s*>/.exec(src.slice(start));
    if (!match) {
      this.report('html-syntax', 'Malformed closing tag', start);
      return false;
    }
    const name = match[1]!.toLowerCase();
    this.pos = start + match[0].length;
    const open = stack[stack.length - 1]!;
    if (VOID.has(name)) {
      this.report('html-syntax', `<${name}> has no closing tag`, start);
      return true;
    }
    if (open.name !== name) {
      this.report(
        'html-nesting',
        stack.length > 1 ? `</${name}> closes <${open.name}>; close elements in the order they were opened` : `</${name}> has no matching opening tag`,
        start,
      );
      const index = stack.map((e) => e.name).lastIndexOf(name);
      if (index > 0) stack.length = index;
      return true;
    }
    stack.pop();
    return true;
  }

  private checkPlacement(parent: Element, name: string, offset: number): void {
    const p = parent.name;
    if (PHRASING_ONLY.has(p) && !PHRASING.has(name)) {
      this.report('html-content', `<${name}> cannot sit inside <${p}>, which holds text-level elements only`, offset);
    } else if ((p === 'ul' || p === 'ol') && name !== 'li') {
      this.report('html-content', `<${p}> can only contain <li>`, offset);
    } else if (name === 'li' && p !== 'ul' && p !== 'ol') {
      this.report('html-content', '<li> must sit inside <ul> or <ol>', offset);
    } else if (name === 'figcaption' && p !== 'figure') {
      this.report('html-content', '<figcaption> must sit inside <figure>', offset);
    }
  }

  /** True when the attribute is kept. */
  private checkAttribute(element: string, name: string, value: string | null, offset: number): boolean {
    const bad = (message: string) => {
      this.report('html-attribute', message, offset);
      return false;
    };
    if (name.startsWith('on')) return bad('Inline event handlers are not allowed; the engine owns all listeners');
    if (name === 'style') return bad('Inline styles are not allowed; use a class and the CSS fragment');
    if (['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'background', 'ping', 'cite'].includes(name)) {
      return bad(`${name} would load or navigate to a URL`);
    }
    if (name === 'hidden') return value === null || value === '' || value === 'hidden' ? true : bad('hidden takes no value');
    if (value === null) return bad(`${name} needs a value`);
    switch (name) {
      case 'id':
        if (!NAME.test(value)) return bad(`The id "${value}" must start with a letter and use letters, digits, - or _`);
        if (/^inc/i.test(value)) return bad(`Ids starting with "inc" are reserved for the engine`);
        if (this.ids.has(value)) return bad(`The id "${value}" is used twice`);
        this.ids.add(value);
        return true;
      case 'class': {
        const classes = value.split(/\s+/).filter(Boolean);
        for (const c of classes) {
          if (!NAME.test(c)) return bad(`The class "${c}" must start with a letter and use letters, digits, - or _`);
          if (/^inc-/i.test(c)) return bad(`Classes starting with "inc-" belong to the engine`);
        }
        return true;
      }
      case 'title':
      case 'aria-label':
        return value.length <= 200 ? true : bad(`${name} is longer than 200 characters`);
      case 'lang':
        return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value) ? true : bad(`"${value}" is not a language tag`);
      case 'dir':
        return ['ltr', 'rtl', 'auto'].includes(value) ? true : bad('dir must be ltr, rtl or auto');
      case 'role':
        return ROLES.has(value) ? true : bad(`role="${value}" is not allowed; use ${[...ROLES].join(', ')}`);
      case 'aria-hidden':
        return value === 'true' || value === 'false' ? true : bad('aria-hidden must be true or false');
      case 'aria-labelledby':
      case 'aria-describedby':
        return value.split(/\s+/).every((id) => NAME.test(id)) ? true : bad(`${name} must list ids`);
      case 'start':
        return element === 'ol' && /^-?\d{1,6}$/.test(value) ? true : bad('start is only allowed on <ol>, as a whole number');
      default:
        if (DATA_ATTRIBUTE.test(name)) return value.length <= 200 ? true : bad(`${name} is longer than 200 characters`);
        return bad(`The ${name} attribute is not allowed on <${element}>`);
    }
  }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serialize(children: ReadonlyArray<Element | string>): string {
  let out = '';
  for (const child of children) {
    if (typeof child === 'string') {
      out += escapeText(child);
      continue;
    }
    out += `<${child.name}`;
    for (const [name, value] of child.attributes) out += value === null ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
    out += '>';
    if (VOID.has(child.name)) continue;
    out += serialize(child.children);
    out += `</${child.name}>`;
  }
  return out;
}

/**
 * A PNG snapshot of a stage, for placeholders and sharing (PRD 23.11). Theme
 * colours live in CSS variables, so the clone gets the computed colours
 * written onto each element before it is drawn to a canvas. The image is a
 * blob: URL, which the frame's policy allows (img-src blob: data:).
 */

/** Paint that children inherit: written where it differs from the parent's, and in full on the root. */
const INHERITED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
] as const;
/** Paint each element has on its own, written where it is not the default. */
const OWN: ReadonlyArray<readonly [string, string]> = [
  ['opacity', '1'],
  ['dominant-baseline', 'auto'],
];
const MAX_WIDTH = 1600;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** What an equation's box needs to draw its MathML (DG-5): the browser runs it, other programs use the text beside it. */
const MATH_EXTENSIONS = 'http://www.w3.org/1999/xhtml http://www.w3.org/1998/Math/MathML';

/** The equation's own point, from its box and which way its maths is aligned. */
function equationText(source: Element, box: CSSStyleDeclaration): SVGTextElement {
  const doc = source.ownerDocument;
  const text = doc.createElementNS(SVG_NS, 'text') as SVGTextElement;
  const x = Number(source.getAttribute('x')) || 0;
  const y = Number(source.getAttribute('y')) || 0;
  const width = Number(source.getAttribute('width')) || 0;
  const height = Number(source.getAttribute('height')) || 0;
  const justify = box.getPropertyValue('justify-content');
  const anchor = justify === 'flex-start' || justify === 'start' ? 'start' : justify === 'flex-end' || justify === 'end' ? 'end' : 'middle';
  text.setAttribute('x', String(anchor === 'start' ? x : anchor === 'end' ? x + width : x + width / 2));
  text.setAttribute('y', String(y + height / 2));
  text.setAttribute('text-anchor', anchor);
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('fill', box.getPropertyValue('color'));
  text.setAttribute('font-size', box.getPropertyValue('font-size'));
  text.setAttribute('font-family', box.getPropertyValue('font-family'));
  const opacity = getComputedStyle(source).getPropertyValue('opacity');
  if (opacity && opacity !== '1') text.setAttribute('opacity', opacity);
  text.textContent = source.getAttribute('data-text') ?? '';
  return text;
}

/**
 * A copy of a stage that stands alone: the computed colours, lines and fonts
 * written onto its elements, only where they change, and the classes, styles
 * and hidden elements that mean nothing outside the figure left out. An
 * equation keeps its MathML with a line of text in its place for programs
 * that cannot draw it, or with `flat`, becomes that text alone.
 */
interface Painted {
  readonly clone: SVGSVGElement;
  readonly width: number;
  readonly height: number;
  /** Styles for elements marked data-inc-style, written into the markup as it is serialized. */
  readonly styles: string[];
}

/**
 * The copy as markup. Styles are written into the text, never set on an
 * element: the frame's policy refuses style attributes, and a copy does not
 * need the browser to apply them, only to carry them.
 */
function serialize({ clone, styles }: Painted): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return new XMLSerializer().serializeToString(clone).replace(/data-inc-style="(\d+)"/g, (_, i: string) => `style="${escape(styles[Number(i)] ?? '')}"`);
}

function painted(svg: SVGSVGElement, flat = false): Painted {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const written: string[] = [];
  const source = [svg, ...svg.querySelectorAll('*')];
  const target = [clone, ...clone.querySelectorAll('*')];
  const styles = new Map<Element, CSSStyleDeclaration>();
  const styleOf = (element: Element) => {
    let style = styles.get(element);
    if (!style) {
      style = getComputedStyle(element);
      styles.set(element, style);
    }
    return style;
  };
  const hidden: Element[] = [];
  const equations: Array<readonly [Element, Element]> = [];
  source.forEach((element, i) => {
    const copy = target[i];
    if (!copy) return;
    const style = styleOf(element);
    if (style.display === 'none') {
      hidden.push(copy);
      return;
    }
    const math = element.closest('foreignObject');
    if (math && math !== element) {
      // HTML and MathML take their look from styles: the box gets its own, written in.
      if (element.classList.contains('inc-math')) {
        written.push(
          `display:flex;align-items:center;justify-content:${style.justifyContent};width:100%;height:100%;line-height:1;white-space:nowrap;color:${style.color};font-family:${style.fontFamily};font-size:${style.fontSize}`,
        );
        copy.setAttribute('data-inc-style', String(written.length - 1));
        copy.removeAttribute('style');
        copy.removeAttribute('class');
      }
      return;
    }
    if (element.hasAttribute('data-math')) equations.push([element, copy]);
    const parent = element === svg ? null : element.parentElement ? styleOf(element.parentElement) : null;
    for (const name of INHERITED) {
      const value = style.getPropertyValue(name);
      if (value && (!parent || parent.getPropertyValue(name) !== value)) copy.setAttribute(name, value);
    }
    for (const [name, initial] of OWN) {
      const value = style.getPropertyValue(name);
      if (value && value !== initial) copy.setAttribute(name, value);
    }
    if (element.tagName.toLowerCase() === 'stop') {
      copy.setAttribute('stop-color', style.getPropertyValue('stop-color'));
      copy.setAttribute('stop-opacity', style.getPropertyValue('stop-opacity'));
    }
    copy.removeAttribute('class');
    copy.removeAttribute('style');
    copy.removeAttribute('tabindex');
  });
  for (const element of hidden) element.remove();
  for (const [element, copy] of equations) {
    if (!clone.contains(copy)) continue;
    const box = element.querySelector('.inc-math');
    const text = equationText(element, box ? styleOf(box) : styleOf(element));
    copy.removeAttribute('data-text');
    if (flat) {
      copy.replaceWith(text);
      continue;
    }
    const choice = element.ownerDocument.createElementNS(SVG_NS, 'switch');
    copy.setAttribute('requiredExtensions', MATH_EXTENSIONS);
    copy.replaceWith(choice);
    choice.append(copy, text);
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return { clone, width, height, styles: written };
}

/**
 * The stage as a standalone SVG image with its theme written in (SV-14), as
 * a data URL: safe to show in an <img> or to download, as an image cannot run
 * anything. Dots on a canvas layer are not part of it.
 */
export function exportStage(svg: SVGSVGElement | null): string | null {
  if (!svg) return null;
  try {
    const picture = painted(svg);
    const background = getComputedStyle(svg.closest('.inc-figure') ?? svg).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
      picture.styles.push(`background: ${background}`);
      picture.clone.setAttribute('data-inc-style', String(picture.styles.length - 1));
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialize(picture))}`;
  } catch {
    return null;
  }
}

/**
 * The stage as a PNG data URL. Drawing an equation's MathML marks the canvas
 * unreadable in some browsers, so a stage with equations falls back to them
 * as text.
 */
export async function snapshotStage(svg: SVGSVGElement | null): Promise<string | null> {
  if (!svg) return null;
  const picture = await drawn(svg, false);
  if (picture !== null || !svg.querySelector('foreignObject[data-math]')) return picture;
  return drawn(svg, true);
}

async function drawn(svg: SVGSVGElement, flat: boolean): Promise<string | null> {
  try {
    const picture = painted(svg, flat);
    const { width, height } = picture;
    const markup = serialize(picture);
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('snapshot image failed'));
        img.src = url;
      });
      const scale = Math.min(window.devicePixelRatio || 1, MAX_WIDTH / width, 2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d');
      if (!context) return null;
      const background = getComputedStyle(svg.closest('.inc-figure') ?? svg).backgroundColor;
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

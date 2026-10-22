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

/**
 * A copy of a stage that stands alone: the computed colours, lines and fonts
 * written onto its elements, only where they change, and the classes, styles
 * and hidden elements that mean nothing outside the figure left out.
 */
function painted(svg: SVGSVGElement): { readonly clone: SVGSVGElement; readonly width: number; readonly height: number } {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true) as SVGSVGElement;
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
  source.forEach((element, i) => {
    const copy = target[i];
    if (!copy) return;
    const style = styleOf(element);
    if (style.display === 'none') {
      hidden.push(copy);
      return;
    }
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
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return { clone, width, height };
}

/**
 * The stage as a standalone SVG image with its theme written in (SV-14), as
 * a data URL: safe to show in an <img> or to download, as an image cannot run
 * anything. Dots on a canvas layer are not part of it.
 */
export function exportStage(svg: SVGSVGElement | null): string | null {
  if (!svg) return null;
  try {
    const { clone } = painted(svg);
    const background = getComputedStyle(svg.closest('.inc-figure') ?? svg).backgroundColor;
    if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') clone.setAttribute('style', `background: ${background}`);
    const markup = new XMLSerializer().serializeToString(clone);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  } catch {
    return null;
  }
}

export async function snapshotStage(svg: SVGSVGElement | null): Promise<string | null> {
  if (!svg) return null;
  try {
    const { clone, width, height } = painted(svg);
    const markup = new XMLSerializer().serializeToString(clone);
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

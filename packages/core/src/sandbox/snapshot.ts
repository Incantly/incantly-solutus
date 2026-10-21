/**
 * A PNG snapshot of a stage, for placeholders and sharing (PRD 23.11). Theme
 * colours live in CSS variables, so the clone gets the computed colours
 * written onto each element before it is drawn to a canvas. The image is a
 * blob: URL, which the frame's policy allows (img-src blob: data:).
 */

const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'font-weight'] as const;
const MAX_WIDTH = 1600;

export async function snapshotStage(svg: SVGSVGElement | null): Promise<string | null> {
  if (!svg) return null;
  try {
    const rect = svg.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const source = [svg, ...svg.querySelectorAll('*')];
    const target = [clone, ...clone.querySelectorAll('*')];
    source.forEach((element, i) => {
      const copy = target[i];
      if (!copy) return;
      const style = getComputedStyle(element);
      if (style.display === 'none') {
        copy.setAttribute('display', 'none');
        return;
      }
      for (const name of PAINT) {
        const value = style.getPropertyValue(name);
        if (value) copy.setAttribute(name, value);
      }
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
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

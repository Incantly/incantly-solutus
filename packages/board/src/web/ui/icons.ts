/**
 * The built-in icons (design 10, "Icons"): one 24 by 24 outline each, drawn with the text colour. A host replaces any of
 * them with SVG text (checked by `checkIcon`) or a factory; these are the defaults it falls back to.
 */

const wrap = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

const PATHS: Readonly<Record<string, string>> = {
  select: '<path d="M5 3l14 7-6 2-2 6z"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.5-1.5L8 14"/>',
  pen: '<path d="M4 20l4-1 11-11a2.1 2.1 0 00-3-3L5 16z"/><path d="M14 7l3 3"/>',
  highlighter: '<path d="M9 14l6-6 3 3-6 6H9z"/><path d="M9 17l-3 3h5M14 7l1.5-1.5a1.5 1.5 0 012 0L19 7"/>',
  eraser: '<path d="M4 16l9-9a2 2 0 013 0l3 3a2 2 0 010 3l-6 6H8z"/><path d="M8 20h12M10 10l6 6"/>',
  laser: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"/>',
  lasso: '<path d="M12 5c5 0 8 2 8 5s-3 5-8 5-8-2-8-5 3-5 8-5z"/><path d="M9 15c-1 2-1 4 1 5s3-1 2-3"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  triangle: '<path d="M12 5l8 14H4z"/>',
  diamond: '<path d="M12 4l8 8-8 8-8-8z"/>',
  star: '<path d="M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5L12 16.3 7 19l1.1-5.5L4 9.7 9.6 9z"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  text: '<path d="M6 7V5h12v2M12 5v14M9 19h6"/>',
  sticky: '<path d="M5 5h14v9l-5 5H5z"/><path d="M14 19v-5h5"/>',
  frame: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M5 17l5-4 3 3 3-2 3 3"/>',
  figure: '<path d="M4 20V4M4 20h16"/><path d="M6 16c3 0 3-9 6-9s3 9 6 9"/>',
  figures: '<path d="M4 18V5M4 18h14"/><path d="M7 14l3.2-4 2.4 2.4L16 8"/>',
  pencil: '<path d="M5 19l1.4-4.6L15 6l3 3-8.6 8.4z"/><path d="M13.2 7.8l3 3"/>',
  marker: '<path d="M6 18l2.2-6.5 8-8 2.3 2.3-8 8z"/><path d="M6 18h5"/>',
  graph: '<path d="M4 20V4M4 20h16"/><path d="M7 15l4-5 3 3 5-7"/>',
  geometry: '<path d="M12 4l8 14H4z"/>',
  scientific: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h2.5M13.5 12H16M8 16h2.5M13.5 16H16"/>',
  probability: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="9" cy="15" r="1.2"/><circle cx="15" cy="15" r="1.2"/>',
  space: '<path d="M12 4l7 4v6l-7 4-7-4V8z"/><path d="M12 14V8M5 8l7 4 7-4"/>',
  ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 014.9.6c0 1.7-2.4 2-2.4 3.7M12 17.2h.01"/>',
  fix: '<path d="M5 15c0-5 4-9 9-9M14 6l3-1M14 6l1 3"/><rect x="11" y="13" width="8" height="6" rx="1"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h9a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12h-9a5 5 0 000 10h3"/>',
  moreShapes: '<path d="M7 10l5 5 5-5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  page: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/>',
};

/** The id of every built-in icon. */
export const ICON_IDS: readonly string[] = Object.keys(PATHS);

/** The built-in icon for a tool or action as SVG text, or undefined when there is none (a host's own tool). */
export function defaultIcon(id: string): string | undefined {
  const inner = PATHS[id];
  return inner === undefined ? undefined : wrap(inner);
}

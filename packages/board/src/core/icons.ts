/**
 * Custom icons (design 10, "Icons"; errors.md `icon_invalid`): a host gives an icon as SVG text, and the text is checked
 * before it is ever put on a page: no script, no event attributes, no link to anything outside the icon. A bad icon is
 * reported and the default one is used. The check reads text only, so it runs wherever the core does.
 */
import { boardError, ok } from './errors';
import type { BoardResult } from './errors';

/** An icon over this many characters is refused: an icon is a few paths. */
export const ICON_MAX = 20_000;

/** Why the SVG text cannot be an icon, or undefined when it can. */
export function iconProblem(svg: unknown): string | undefined {
  if (typeof svg !== 'string') return 'the icon is not text';
  const text = svg.trim();
  if (text.length > ICON_MAX) return `the icon is over ${ICON_MAX} characters`;
  if (!/^<svg[\s>]/i.test(text) || !/<\/svg\s*>$/i.test(text)) return 'the icon is not one <svg> element';
  if (/<script|<foreignObject|<iframe|<object|<embed|<style|<!ENTITY|<!DOCTYPE|<\?/i.test(text)) return 'the icon holds script or content the board does not take';
  if (/[\s"'/]on\w+\s*=/i.test(text)) return 'the icon has an event attribute';
  if (/javascript:|vbscript:/i.test(text)) return 'the icon has a script link';
  if (/[\s:"'](?:href|src)\s*=\s*(?!["']?\s*#)/i.test(text)) return 'the icon links to something outside itself';
  if (/url\(\s*(?!["']?\s*#)/i.test(text)) return 'the icon links to something outside itself';
  return undefined;
}

/** The icon text, or `icon_invalid` that names the tool (or action) it was for. */
export function checkIcon(owner: string, svg: unknown): BoardResult<string> {
  const problem = iconProblem(svg);
  if (problem !== undefined) {
    return boardError('icon_invalid', `The icon for "${owner}" cannot be used: ${problem}.`, {
      hint: 'Give one <svg> element with shapes only, or a function that makes the element. The default icon is used.',
      detail: { tool: owner, why: problem },
    });
  }
  return ok((svg as string).trim());
}

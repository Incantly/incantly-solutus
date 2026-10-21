import { THEME_CSS } from '../renderer/theme';
import { FRAME_SCRIPT, FRAME_SCRIPT_HASH } from './generated/bundles';
import { cspHash } from './sha256';

/**
 * The frame document (ADR 002, ADR 005): the bundled theme, the validated
 * scene CSS and canonical HTML, and the frame script, under a policy that
 * allows exactly those by hash and blocks every network request.
 */

export const FRAME_SCOPE = 'incfig';

export interface ShellOptions {
  /** Canonical HTML from the validator. */
  readonly html: string;
  /** CSS that passed the validator. */
  readonly css: string;
  /** The figure's unguessable channel id. */
  readonly channel: string;
  readonly lang?: string;
}

let themeHash: string | null = null;

/** The frame's content security policy for a scene's CSS. */
export function contentSecurityPolicy(css: string): string {
  themeHash ??= cspHash(THEME_CSS);
  const styles = css ? `${themeHash} ${cspHash(css)}` : themeHash;
  return [
    "default-src 'none'",
    `script-src ${FRAME_SCRIPT_HASH}`,
    `style-src ${styles}`,
    'img-src blob: data:',
    'worker-src blob:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export function buildShell(options: ShellOptions): string {
  if (!/^[a-f0-9]{32}$/.test(options.channel)) throw new Error('A frame needs a 128-bit hex channel id');
  if (/<\//.test(options.css) || options.css.includes('<')) throw new Error('Scene CSS must be validated before it reaches a frame');
  const lang = options.lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(options.lang) ? options.lang : 'en';
  return (
    '<!doctype html>' +
    `<html lang="${lang}" class="inc-frame" data-channel="${options.channel}">` +
    '<head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.css)}">` +
    '<meta name="referrer" content="no-referrer">' +
    `<style data-incantly-theme>${THEME_CSS}</style>` +
    (options.css ? `<style>${options.css}</style>` : '') +
    '</head><body>' +
    `<div class="inc-root" data-figure-id="${FRAME_SCOPE}"><div class="inc-scene">${options.html}</div></div>` +
    `<script>${FRAME_SCRIPT}</script>` +
    '</body></html>'
  );
}

/** A 128-bit random channel id. */
export function newChannelId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

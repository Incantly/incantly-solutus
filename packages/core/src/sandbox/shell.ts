import { frameLang } from '../protocol/bridge';
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
  /** Trusted CSS from the integrator, already checked by `hostCss`. */
  readonly hostCss?: string;
  /**
   * For a frame booted before its scene exists (PRD 25.4): the nonce the
   * styles that arrive later by message carry, as the frame's policy allows
   * no other style it was not made with.
   */
  readonly nonce?: string;
}

/** A nonce for styles a warm frame is handed later: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

const NONCE = /^[A-Za-z0-9+/]{22}==$/;

let themeHash: string | null = null;

/**
 * The frame's content security policy for a scene's CSS and the host's own.
 * Fonts may come only from data URLs inside the host CSS; nothing loads over
 * the network.
 */
export function contentSecurityPolicy(css: string, hostCss = '', nonce?: string): string {
  themeHash ??= cspHash(THEME_CSS);
  const styles = [themeHash, ...(hostCss ? [cspHash(hostCss)] : []), ...(css ? [cspHash(css)] : []), ...(nonce ? [`'nonce-${nonce}'`] : [])].join(' ');
  return [
    "default-src 'none'",
    `script-src ${FRAME_SCRIPT_HASH}`,
    `style-src ${styles}`,
    'img-src blob: data:',
    'font-src data:',
    'worker-src blob:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export function buildShell(options: ShellOptions): string {
  if (!/^[a-f0-9]{32}$/.test(options.channel)) throw new Error('A frame needs a 128-bit hex channel id');
  if (/<\//.test(options.css) || options.css.includes('<')) throw new Error('Scene CSS must be validated before it reaches a frame');
  if (options.hostCss && options.hostCss.includes('<')) throw new Error('Host CSS must go through hostCss() before it reaches a frame');
  if (options.nonce !== undefined && !NONCE.test(options.nonce)) throw new Error('A frame nonce is 128 random bits in base64');
  const lang = frameLang(options.lang) ?? 'en';
  return (
    '<!doctype html>' +
    `<html lang="${lang}" class="inc-frame" data-channel="${options.channel}">` +
    '<head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.css, options.hostCss ?? '', options.nonce)}">` +
    '<meta name="referrer" content="no-referrer">' +
    `<style data-incantly-theme>${THEME_CSS}</style>` +
    (options.hostCss ? `<style data-incantly-host>${options.hostCss}</style>` : '') +
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

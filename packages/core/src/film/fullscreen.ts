/**
 * The film player's fullscreen: generic DOM over the Fullscreen API, the same
 * convention as figures (a show flag, a transport button, aria-pressed). The
 * player root goes fullscreen; its stage scales like figures via the theme's
 * chrome-aware rules; captions, transport, Ask/markers, chapters, transcript
 * and deck stay reachable; exiting restores layout and playback untouched
 * (no remount, no seek). Sandboxed films mirror through the bridge.
 */

/** Whether the document allows fullscreen at all. */
export function isFullscreenEnabled(doc: Document): boolean {
  return doc.fullscreenEnabled ?? false;
}

/** Whether this player root is the fullscreen element now. */
export function isPlayerFullscreen(player: HTMLElement): boolean {
  return player.ownerDocument.fullscreenElement === player;
}

/** Fullscreens the player root, or exits when anything is fullscreen. Never throws. */
export function togglePlayerFullscreen(player: HTMLElement): void {
  const doc = player.ownerDocument;
  if (doc.fullscreenElement) void doc.exitFullscreen?.().catch(() => undefined);
  else void player.requestFullscreen?.().catch(() => undefined);
}

/** Says on the button whether the player fills the screen. */
export function syncPlayerFullscreenButton(button: HTMLButtonElement, player: HTMLElement): void {
  const on = isPlayerFullscreen(player);
  button.setAttribute('aria-pressed', String(on));
  const label = on ? 'Exit full screen' : 'Full screen';
  button.setAttribute('aria-label', label);
  button.title = label;
}

/** Shows the button only when its show flag is on and fullscreen is available. */
export function refreshPlayerFullscreenVisibility(button: HTMLButtonElement, show: boolean): void {
  button.hidden = !show || !isFullscreenEnabled(button.ownerDocument);
}

/**
 * Wires a transport button to its player root: click toggles, fullscreenchange
 * re-syncs however it was entered or left, and onChange mirrors the state into
 * figures (trusted directly, sandboxed through the bridge). Returns an unbind.
 */
export function bindPlayerFullscreen(
  player: HTMLElement,
  button: HTMLButtonElement,
  onChange?: (on: boolean) => void,
): () => void {
  const doc = player.ownerDocument;
  const onClick = (): void => togglePlayerFullscreen(player);
  const onFullscreenChange = (): void => {
    syncPlayerFullscreenButton(button, player);
    onChange?.(isPlayerFullscreen(player));
  };
  button.addEventListener('click', onClick);
  doc.addEventListener('fullscreenchange', onFullscreenChange);
  syncPlayerFullscreenButton(button, player);
  return () => {
    button.removeEventListener('click', onClick);
    doc.removeEventListener('fullscreenchange', onFullscreenChange);
  };
}

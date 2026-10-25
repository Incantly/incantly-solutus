/**
 * The scene's panes: the elements of the scene HTML its stages are drawn in.
 * The scene says how they sit together (inc.layout); the host may say
 * otherwise (style.layout.panes), for every figure in its product. With more
 * than one pane, each gets a button that enlarges it to the whole scene and
 * back, and in the focus layout one pane is drawn large with the others
 * small beside it, where their button brings them forward instead.
 */

export type PaneLayout = 'row' | 'column' | 'grid' | 'focus';

export class PanesView {
  private panes: HTMLElement[] = [];
  private scenePanels: PaneLayout | null = null;
  private hostPanes: PaneLayout | 'auto' = 'auto';
  /** The pane drawn large in the focus layout. */
  private focused: HTMLElement | null = null;
  /** The pane enlarged to the whole scene, or null for all of them. */
  private expanded: HTMLElement | null = null;
  /** Called when the panes change, so the integrator's classes reach new ones. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly doc: Document,
    private readonly sceneRoot: HTMLElement,
    signal: AbortSignal,
  ) {
    // Escape puts an enlarged pane back first; in capture, so the frame does not take Escape to leave the figure.
    doc.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !this.expanded) return;
        event.preventDefault();
        this.expand(null);
      },
      { signal, capture: true },
    );
  }

  /** How the scene laid its panels out (inc.layout), or null for not at all. */
  setScene(panels: PaneLayout | null): void {
    this.scenePanels = panels;
    this.arrange();
  }

  /** How the host lays panes out, over the scene's choice; 'auto' keeps the scene's. */
  setHost(panes: PaneLayout | 'auto'): void {
    this.hostPanes = panes;
    this.arrange();
  }

  /** Finds the panes again after a stage was made or moved: the scene's top-level elements that hold a stage. */
  refresh(): void {
    const panes = [...this.sceneRoot.children].filter((child) => child.matches('.inc-stage-host') || child.querySelector('.inc-stage-host') !== null) as HTMLElement[];
    for (const pane of this.panes) if (!panes.includes(pane)) this.forget(pane);
    this.panes = panes;
    if (this.focused && !panes.includes(this.focused)) this.focused = null;
    if (this.expanded && !panes.includes(this.expanded)) this.expanded = null;
    for (const pane of panes) pane.classList.add('inc-pane');
    this.arrange();
    this.onChange?.();
  }

  private arrange(): void {
    const layout = this.hostPanes !== 'auto' ? this.hostPanes : this.scenePanels;
    if (layout) this.sceneRoot.dataset.panels = layout;
    else delete this.sceneRoot.dataset.panels;
    const focus = layout === 'focus';
    if (focus && !this.focused) this.focused = this.panes[0] ?? null;
    for (const pane of this.panes) {
      if (focus && pane === this.focused) pane.dataset.focus = '';
      else delete pane.dataset.focus;
      this.button(pane, focus);
    }
    if (this.expanded) this.sceneRoot.dataset.expanded = '';
    else delete this.sceneRoot.dataset.expanded;
    for (const pane of this.panes) {
      if (pane === this.expanded) pane.dataset.expanded = '';
      else delete pane.dataset.expanded;
    }
  }

  /** A pane's button: enlarge or show all; a small pane in the focus layout comes forward instead. */
  private button(pane: HTMLElement, focus: boolean): void {
    let button = pane.querySelector<HTMLButtonElement>(':scope > .inc-pane-button');
    if (this.panes.length < 2) {
      button?.remove();
      return;
    }
    if (!button) {
      button = this.doc.createElement('button');
      button.type = 'button';
      button.className = 'inc-pane-button inc-icon-button';
      button.addEventListener('click', () => {
        if (pane.dataset.focus === undefined && this.sceneRoot.dataset.panels === 'focus' && !this.expanded) this.bringForward(pane);
        else this.expand(this.expanded === pane ? null : pane);
      });
      pane.prepend(button);
    }
    const small = focus && pane !== this.focused && !this.expanded;
    const enlarged = this.expanded === pane;
    button.textContent = enlarged ? '↙' : small ? '⇱' : '⤢';
    button.setAttribute('aria-label', enlarged ? 'Show all drawings' : small ? 'Show this drawing large' : 'Enlarge this drawing');
    if (small) button.removeAttribute('aria-pressed');
    else button.setAttribute('aria-pressed', String(enlarged));
  }

  private bringForward(pane: HTMLElement): void {
    this.focused = pane;
    this.arrange();
  }

  private expand(pane: HTMLElement | null): void {
    this.expanded = pane;
    this.arrange();
    pane?.querySelector<HTMLButtonElement>(':scope > .inc-pane-button')?.focus();
  }

  private forget(pane: HTMLElement): void {
    pane.classList.remove('inc-pane');
    delete pane.dataset.focus;
    delete pane.dataset.expanded;
    pane.querySelector(':scope > .inc-pane-button')?.remove();
  }
}

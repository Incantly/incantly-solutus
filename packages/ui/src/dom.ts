/** Tiny DOM helpers shared by the components. */

type Attrs = Readonly<Record<string, string | number | boolean | undefined>>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export function emit<T>(target: EventTarget, name: string, detail: T): boolean {
  return target.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true, cancelable: true }));
}

export function styleEl(css: string): HTMLStyleElement {
  const s = document.createElement('style');
  s.textContent = css;
  return s;
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

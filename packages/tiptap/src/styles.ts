/** The extension's stylesheet, added once to the page that holds the editor. */

const STYLE_ID = 'incantly-tiptap-style';

const CSS = `
.inc-tt-figure{position:relative;margin:16px 0;font:14px/1.4 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;color:#1f2430}
.inc-tt-figure *{box-sizing:border-box}
.inc-tt-figure.inc-tt-selected>.inc-tt-box{outline:2px solid #2f6fdb;outline-offset:2px}
.inc-tt-box{position:relative;max-width:100%;overflow:hidden;border:1px solid #d5d7dd;border-radius:8px;background:#fff}
.inc-tt-box:focus-visible{outline:2px solid #2f6fdb;outline-offset:2px}
.inc-tt-ph{display:block;width:100%;height:100%;object-fit:contain}
.inc-tt-ph-text{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:16px;color:#5b6472;text-align:center}
.inc-tt-live{position:absolute;inset:0}
.inc-tt-box[data-state=live] .inc-tt-ph,.inc-tt-box[data-state=live] .inc-tt-ph-text{display:none}
.inc-tt-box[data-state=bad]{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#fafbfc;color:#5b6472}
.inc-tt-box[data-state=bad] button{font:inherit}
.inc-tt-badge{position:absolute;top:8px;right:8px;z-index:3;min-height:28px;padding:0 10px;border:1px solid #e0b4b4;border-radius:14px;background:#fff4f4;color:#a12727;font:inherit;font-size:13px;cursor:pointer}
.inc-tt-badge[hidden],.inc-tt-notice[hidden]{display:none}
.inc-tt-notice{position:absolute;left:8px;bottom:36px;z-index:3;max-width:70%;margin:0;padding:4px 10px;border-radius:6px;background:rgba(31,36,48,.88);color:#fff;font-size:13px}
.inc-tt-caption{margin-top:6px;color:#5b6472;font-size:14px}
.inc-tt-caption:empty{display:none}
.inc-tt-resize{position:absolute;left:25%;right:25%;bottom:-6px;height:10px;cursor:ns-resize;touch-action:none}
.inc-tt-resize::after{content:"";position:absolute;left:50%;top:3px;width:48px;height:4px;margin-left:-24px;border-radius:2px;background:#b9c0cc}
.inc-tt-resize:hover::after,.inc-tt-resize:focus-visible::after{background:#2f6fdb}
.inc-tt-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

export function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.append(s);
}

/** Adds more rules to the same sheet (used by the files that draw the toolbar, the panel and the formula). */
export function addStyles(doc: Document, id: string, css: string): void {
  if (doc.getElementById(id)) return;
  const s = doc.createElement('style');
  s.id = id;
  s.textContent = css;
  doc.head.append(s);
}

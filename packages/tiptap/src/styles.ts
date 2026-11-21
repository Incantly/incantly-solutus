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
.inc-tt-resize[hidden]{display:none}
.inc-tt-toolbar{position:absolute;left:0;bottom:100%;z-index:20;display:flex;flex-direction:column;gap:4px;margin-bottom:6px;padding:6px;background:#fff;border:1px solid #d5d7dd;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.12)}
.inc-tt-toolbar[hidden],.inc-tt-ai[hidden],.inc-tt-panel[hidden]{display:none}
.inc-tt-row,.inc-tt-ai{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.inc-tt-btn{min-height:30px;padding:0 10px;border:1px solid #d5d7dd;border-radius:6px;background:#fff;font:inherit;font-size:13px;cursor:pointer;color:#1f2430}
.inc-tt-btn:hover,.inc-tt-btn:focus-visible{background:#eef1f5}
.inc-tt-btn[aria-pressed=true]{background:#e4edfb;border-color:#9cb8e6}
.inc-tt-btn[hidden]{display:none}
.inc-tt-btn:disabled{opacity:.5;cursor:default}
.inc-tt-select,.inc-tt-input{min-height:30px;padding:0 8px;border:1px solid #d5d7dd;border-radius:6px;background:#fff;font:inherit;font-size:13px;color:#1f2430}
.inc-tt-num{width:78px}
.inc-tt-caption-in{width:170px}
.inc-tt-ai-in{width:320px;max-width:100%}
.inc-tt-ai-msg{font-size:13px;color:#a12727}
.inc-tt-panel{margin-top:6px;border:1px solid #d5d7dd;border-radius:8px;background:#fafbfc;overflow:hidden}
.inc-tt-panel-head{display:flex;align-items:center;justify-content:space-between;padding:4px 8px;border-bottom:1px solid #e3e6eb;font-size:13px;color:#5b6472}
.inc-tt-panel-body{display:flex;align-items:flex-start;overflow-x:auto;font:13px/20px ui-monospace,SFMono-Regular,Menlo,monospace}
.inc-tt-gutter,.inc-tt-results{margin:0;padding:6px 0;list-style:none}
.inc-tt-gutter{min-width:34px;padding-right:8px;text-align:right;color:#9aa3b2;user-select:none}
.inc-tt-gutter li,.inc-tt-results li{height:20px;white-space:nowrap}
.inc-tt-lines{flex:1 1 55%;min-width:220px;margin:0;padding:6px 8px;border:0;border-left:1px solid #e3e6eb;border-right:1px solid #e3e6eb;background:#fff;font:inherit;line-height:20px;resize:none;overflow:hidden;white-space:pre;tab-size:2}
.inc-tt-results{flex:1 1 45%;min-width:200px;padding-left:10px}
.inc-tt-results .inc-tt-ok{color:#2a7a3b}
.inc-tt-results .inc-tt-bad-line{color:#a12727}
.inc-tt-panel-foot{padding:6px 8px;font-size:13px;color:#5b6472}
.inc-tt-panel-foot:empty{display:none}
.inc-tt-kept{margin:6px 0;padding:6px 8px;border:1px solid #d5d7dd;border-radius:6px;background:#fff;font:12px/18px ui-monospace,monospace;white-space:pre-wrap}
.inc-tt-panel-foot .inc-tt-btn{margin-right:6px}
.inc-tt-slash{position:fixed;z-index:50;min-width:210px;padding:4px;background:#fff;border:1px solid #d5d7dd;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.12);font:14px/1.4 Inter,"Segoe UI",system-ui,sans-serif;color:#1f2430}
.inc-tt-slash[hidden]{display:none}
.inc-tt-slash-item{padding:6px 10px;border-radius:6px;cursor:pointer}
.inc-tt-slash-item[aria-selected=true],.inc-tt-slash-item:hover{background:#e4edfb}
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

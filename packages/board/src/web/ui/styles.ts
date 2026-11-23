/**
 * The board's own style sheet. Every colour, the radius, the font and the size of a tool button read a CSS custom
 * property (`--ib-*`, set on the board element from the theme), so a host's styles win and a theme is one set of values.
 */
export const STYLE_ID = 'incantly-board-view-style';

export const CSS = `
.ib-view{position:relative;width:100%;height:100%;min-height:200px;overflow:hidden;background:var(--ib-bg,#fbfbfa);color:var(--ib-fg,#1f2430);font:13px/1.3 var(--ib-font,system-ui,sans-serif);user-select:none;-webkit-user-select:none}
.ib-surface{position:absolute;inset:0;outline:none;cursor:crosshair}
.ib-bar{position:absolute;display:flex;align-items:center;gap:4px;padding:4px;background:var(--ib-panel,#fff);border:1px solid var(--ib-border,#d5d7dd);border-radius:var(--ib-radius,10px);box-shadow:0 2px 8px var(--ib-shadow,rgba(15,23,42,.12));color:var(--ib-fg,#1f2430)}
.ib-bar button,.ib-bar select{font:inherit;border:1px solid transparent;border-radius:7px;background:transparent;padding:5px 9px;cursor:pointer;color:inherit}
.ib-bar select{background:var(--ib-panel,#fff);border-color:var(--ib-border,#d5d7dd)}
.ib-bar button:hover{background:var(--ib-hover,#eef0f4)}.ib-bar button[aria-pressed=true]{background:var(--ib-accent-soft,#e0e7ff);border-color:var(--ib-accent-line,#a5b4fc)}
.ib-bar button:disabled{opacity:.4;cursor:default}
.ib-bar button:focus-visible,.ib-menu button:focus-visible{outline:2px solid var(--ib-accent,#4f46e5);outline-offset:1px}
.ib-tools{left:0;right:0;margin:0 auto;bottom:14px;width:max-content;max-width:calc(100% - 340px);gap:2px;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
.ib-tools button{flex:none;white-space:nowrap;padding:5px 5px;font-size:12px;min-width:var(--ib-tool-size,34px);height:var(--ib-tool-size,34px);display:inline-flex;align-items:center;justify-content:center;gap:4px}
.ib-tools .ib-sep{flex:none}
.ib-tools[data-position=top]{bottom:auto;top:14px;max-width:calc(100% - 520px)}
.ib-tools[data-position=left],.ib-tools[data-position=right]{top:0;bottom:0;margin:auto 0;height:max-content;max-height:calc(100% - 140px);width:auto;max-width:none;flex-direction:column;overflow-x:visible;overflow-y:auto}
.ib-tools[data-position=left]{left:12px;right:auto}
.ib-tools[data-position=right]{right:12px;left:auto}
.ib-tools[data-position=left] .ib-sep,.ib-tools[data-position=right] .ib-sep{width:auto;height:1px;align-self:stretch;margin:2px 0}
.ib-tools[data-position=none]{display:none}
.ib-ico{display:inline-flex;align-items:center;justify-content:center;pointer-events:none}
.ib-ico svg{display:block}
.ib-list.ib-more{left:0;top:auto;bottom:62px;min-width:120px}
.ib-view[data-toolbar=top] .ib-list.ib-more{top:62px;bottom:auto}
.ib-view[data-toolbar=left] .ib-list.ib-more,.ib-view[data-toolbar=right] .ib-list.ib-more{top:auto;bottom:auto}
.ib-style{right:12px;top:70px;flex-wrap:wrap;max-width:300px;justify-content:flex-start}
.ib-style[hidden],.ib-list[hidden]{display:none}
.ib-sep{width:1px;align-self:stretch;background:var(--ib-border,#d5d7dd);margin:2px 2px}
.ib-swatch{width:22px;height:22px;padding:0!important;border-radius:50%!important;border:2px solid var(--ib-panel,#fff)!important;box-shadow:0 0 0 1px var(--ib-border,#c5c8d0)}
.ib-swatch[aria-pressed=true]{box-shadow:0 0 0 2px var(--ib-accent,#4f46e5)!important;background-clip:padding-box}
.ib-pages{left:12px;top:12px}
.ib-list{position:absolute;left:0;top:100%;margin-top:6px;min-width:170px;background:var(--ib-panel,#fff);border:1px solid var(--ib-border,#d5d7dd);border-radius:var(--ib-radius,10px);box-shadow:0 6px 18px var(--ib-shadow,rgba(15,23,42,.16));padding:4px;display:flex;flex-direction:column;z-index:6}
.ib-list button{text-align:start}
.ib-zoom{right:12px;bottom:14px}
.ib-zoom output{min-width:46px;text-align:center}
.ib-size{width:90px}
.ib-actions{left:0;right:0;margin:0 auto;top:12px;width:max-content;max-width:calc(100% - 340px);gap:2px;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
.ib-actions[hidden]{display:none}
.ib-actions button,.ib-actions select{flex:none;white-space:nowrap;padding:4px 7px;font-size:12px}
.ib-swatch-none{background:linear-gradient(135deg,#fff 45%,#dc2626 45%,#dc2626 55%,#fff 55%)}
.ib-edit{position:absolute;margin:0;padding:4px;border:2px solid var(--ib-accent,#2563eb);border-radius:4px;outline:none;resize:none;overflow:hidden;box-sizing:border-box;background:#fff;color:#1f2430;white-space:pre-wrap;line-height:1.3;z-index:5;transform-origin:center center}
.ib-edit[hidden]{display:none}
.ib-fixed{position:absolute;left:50%;top:60px;transform:translateX(-50%);background:var(--ib-fg,#1f2430);color:var(--ib-bg,#fff);border-radius:8px;padding:6px 12px;font-size:12px;opacity:.92}
.ib-fixed[hidden]{display:none}
.ib-menu{position:absolute;z-index:8;min-width:190px;display:flex;flex-direction:column;padding:4px;background:var(--ib-panel,#fff);color:var(--ib-fg,#1f2430);border:1px solid var(--ib-border,#d5d7dd);border-radius:var(--ib-radius,10px);box-shadow:0 6px 18px var(--ib-shadow,rgba(15,23,42,.16))}
.ib-menu button{display:flex;align-items:center;gap:8px;text-align:start;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;padding:6px 9px;cursor:pointer}
.ib-menu button:hover:not(:disabled){background:var(--ib-hover,#eef0f4)}
.ib-menu button:disabled{opacity:.4;cursor:default}
.ib-menu .ib-menu-label{flex:1}
.ib-menu kbd{font:11px ui-monospace,monospace;color:var(--ib-muted,#5b6472)}
.ib-menu-icon{display:inline-flex;width:20px;height:20px}
.ib-figures{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.ib-card{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px #cbd5e1}
.ib-card-pic,.ib-card-host{position:absolute;inset:0;width:100%;height:100%}
.ib-card-pic{object-fit:fill;user-select:none}
.ib-card-host[hidden],.ib-card-pic[hidden],.ib-card-badge[hidden]{display:none}
.ib-card-host .inc-app{width:100%;height:100%}
.ib-card-badge{position:absolute;left:8px;bottom:8px;background:#7f1d1d;color:#fff;border-radius:6px;padding:2px 8px;font-size:12px}
.ib-card-input{box-shadow:0 0 0 2px var(--ib-accent,#4f46e5)}
.ib-cardbar{z-index:7;gap:4px}
.ib-cardbar[hidden],.ib-cardlines[hidden]{display:none}
.ib-cardlines{z-index:7;flex-direction:column;align-items:stretch;width:340px}
.ib-cardlines textarea{font:12px ui-monospace,monospace;width:100%;box-sizing:border-box;background:var(--ib-panel,#fff);color:var(--ib-fg,#1f2430);border:1px solid var(--ib-border,#d5d7dd);border-radius:6px;padding:6px}
.ib-cardrow{display:flex;gap:4px;justify-content:flex-end}
.ib-cardstatus{font-size:12px;color:var(--ib-muted,#5b6472)}
.ib-agent{right:12px;top:12px;bottom:64px;width:300px;flex-direction:column;align-items:stretch;gap:6px;padding:8px;z-index:6;user-select:text;-webkit-user-select:text}
.ib-agent[hidden]{display:none}
.ib-agent-head{display:flex;align-items:center;justify-content:space-between}
.ib-agent-close{font-size:18px;line-height:1;padding:2px 8px!important}
.ib-agent-demo{font-size:12px;font-weight:600;color:#7c2d12;background:#ffedd5;border:1px solid #fdba74;border-radius:6px;padding:3px 8px}
.ib-agent-log{flex:1;min-height:60px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;font-size:13px}
.ib-agent-line{padding:4px 8px;border-radius:8px;background:var(--ib-hover,#eef0f4);overflow-wrap:anywhere}
.ib-agent-you{align-self:flex-end;background:var(--ib-accent-soft,#e0e7ff);max-width:90%}
.ib-agent-notice{background:#fef3c7;color:#78350f}
.ib-agent-empty{color:var(--ib-muted,#5b6472);font-size:12px}
.ib-agent-note{font-size:12px;color:#b91c1c}
.ib-agent-note:empty{display:none}
.ib-agent-form{display:flex;gap:4px}
.ib-agent-input{flex:1;min-width:0;font:inherit;padding:5px 7px;border:1px solid var(--ib-border,#d5d7dd);border-radius:7px;background:var(--ib-panel,#fff);color:inherit}
.ib-agent-form button[hidden]{display:none}
.ib-agent-stop{background:#dc2626!important;color:#fff!important;font-weight:600}
.ib-agent-allow{font-size:12px;color:var(--ib-muted,#5b6472);display:flex;align-items:center;gap:4px}
.ib-agent-toggle{right:12px;top:12px;padding:5px 10px;cursor:pointer;font:inherit}
.ib-view[data-agent=open] .ib-agent-toggle{display:none}
.ib-view[data-agent=open] .ib-style{right:324px}
.ib-hand{position:absolute;left:0;top:0;width:30px;height:30px;margin:-4px 0 0 -4px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--ib-accent,#4f46e5);color:#fff;box-shadow:0 2px 6px rgba(15,23,42,.3);pointer-events:none;z-index:9;transition:transform .12s linear}
.ib-hand[hidden]{display:none}
.ib-hand svg{stroke:#fff}
@media (prefers-reduced-motion: reduce){.ib-hand{transition:none}}
.ib-suggest{z-index:9;min-width:210px}
.ib-suggest[hidden]{display:none}
.ib-suggest-form{display:flex;gap:4px;padding:2px}
.ib-suggest-input{flex:1;min-width:0;font:inherit;padding:5px 7px;border:1px solid var(--ib-border,#d5d7dd);border-radius:7px;background:var(--ib-panel,#fff);color:inherit}
`;

/**
 * The bundled theme. It is static so the frame's CSP can allow it by hash.
 * Scenes use tone names; colours live only here, in light and dark.
 */
export const THEME_CSS = `
.inc-figure {
  --inc-bg: #ffffff;
  --inc-fg: #1f1f24;
  --inc-muted: #64646c;
  --inc-line: #c9c9d1;
  --inc-card: #f4f4f7;
  --inc-faint: #e3e3e8;
  --inc-lo: #d5d5dc;
  --inc-mid: #8a8a94;
  --inc-hi: #2b2b33;
  --inc-lit: #d9480f;
  --inc-a: #c2255c;
  --inc-b: #1971c2;
  --inc-c: #2b8a3e;
  --inc-focus: #1971c2;
  --inc-danger: #c92a2a;
  color: var(--inc-fg);
  background: var(--inc-bg);
  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  border-radius: 10px;
  padding: 12px;
  box-sizing: border-box;
}
.inc-figure[data-theme='dark'] {
  --inc-bg: #17171b;
  --inc-fg: #ececf1;
  --inc-muted: #a2a2ad;
  --inc-line: #45454f;
  --inc-card: #222228;
  --inc-faint: #303038;
  --inc-lo: #3a3a44;
  --inc-mid: #7c7c88;
  --inc-hi: #e4e4ea;
  --inc-lit: #ff8a3d;
  --inc-a: #f06595;
  --inc-b: #4dabf7;
  --inc-c: #69db7c;
  --inc-focus: #74c0fc;
  --inc-danger: #ff8787;
}
@media (prefers-color-scheme: dark) {
  .inc-figure:not([data-theme='light']) {
    --inc-bg: #17171b;
    --inc-fg: #ececf1;
    --inc-muted: #a2a2ad;
    --inc-line: #45454f;
    --inc-card: #222228;
    --inc-faint: #303038;
    --inc-lo: #3a3a44;
    --inc-mid: #7c7c88;
    --inc-hi: #e4e4ea;
    --inc-lit: #ff8a3d;
    --inc-a: #f06595;
    --inc-b: #4dabf7;
    --inc-c: #69db7c;
    --inc-focus: #74c0fc;
    --inc-danger: #ff8787;
  }
}
.inc-figure *, .inc-figure *::before, .inc-figure *::after { box-sizing: border-box; }
.inc-figure [hidden] { display: none !important; }
.inc-idea { margin: 0 0 8px; font-weight: 600; }
.inc-scene { position: relative; }
.inc-stage { display: block; width: 100%; height: auto; overflow: visible; }
.inc-stage path, .inc-stage line, .inc-stage polyline {
  fill: none;
  stroke: var(--inc-tone, var(--inc-fg));
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.inc-stage circle, .inc-stage rect { fill: var(--inc-tone, var(--inc-mid)); stroke: none; }
.inc-stage text { fill: var(--inc-tone, var(--inc-fg)); font-size: 14px; }
.inc-stage .inc-tone-lo { --inc-tone: var(--inc-lo); }
.inc-stage .inc-tone-mid { --inc-tone: var(--inc-mid); }
.inc-stage .inc-tone-hi { --inc-tone: var(--inc-hi); }
.inc-stage .inc-tone-lit { --inc-tone: var(--inc-lit); }
.inc-stage .inc-tone-faint { --inc-tone: var(--inc-faint); stroke-width: 1; }
.inc-stage .inc-tone-a { --inc-tone: var(--inc-a); }
.inc-stage .inc-tone-b { --inc-tone: var(--inc-b); }
.inc-stage .inc-tone-c { --inc-tone: var(--inc-c); }
.inc-stage .inc-dashed { stroke-dasharray: 6 5; }
.inc-stage .inc-hidden { display: none; }
.inc-stage .inc-part { cursor: pointer; }
.inc-stage .inc-part:focus { outline: none; }
.inc-stage .inc-part.is-focus, .inc-stage .inc-part:focus-visible { --inc-tone: var(--inc-lit); }
.inc-stage .inc-part:is(.is-focus, :focus-visible):is(path, line, polyline) { stroke-width: 3.5; }
.inc-stage .inc-part:is(.is-focus, :focus-visible):is(circle, rect) { stroke: var(--inc-fg); stroke-width: 2; }
.inc-stage [data-layer='mid'] > *, .inc-stage [data-layer='front'] > * { transition: opacity 0.18s; }
.inc-figure.has-focus .inc-stage :is([data-layer='mid'], [data-layer='front']) > :not(.is-focus):not(:has(.is-focus)) {
  opacity: 0.3;
}
.inc-part-info { margin: 6px 0 0; min-height: 1.45em; }
.inc-part-info.is-hint { color: var(--inc-muted); font-size: 12px; }
.inc-readouts { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.inc-readouts:empty { display: none; }
.inc-readout { background: var(--inc-card); border-radius: 8px; padding: 6px 10px; min-width: 96px; }
.inc-readout__label { display: block; font-size: 12px; color: var(--inc-muted); }
.inc-readout__value { font-variant-numeric: tabular-nums; font-weight: 600; }
.inc-controls { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.inc-transport { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.inc-figure button, .inc-figure select, .inc-figure input {
  font: inherit;
  color: inherit;
  min-height: 36px;
}
.inc-figure button {
  background: var(--inc-card);
  border: 1px solid var(--inc-line);
  border-radius: 8px;
  padding: 4px 12px;
  cursor: pointer;
}
.inc-figure button[aria-pressed='true'] { border-color: var(--inc-fg); }
.inc-figure button:disabled, .inc-figure button[aria-disabled='true'] { opacity: 0.5; cursor: default; }
.inc-figure select { background: var(--inc-card); border: 1px solid var(--inc-line); border-radius: 8px; padding: 4px 8px; }
.inc-figure :focus-visible { outline: 2px solid var(--inc-focus); outline-offset: 2px; }
@media (pointer: coarse) {
  .inc-figure button, .inc-figure select, .inc-figure input { min-height: 44px; }
}
.inc-params { display: grid; gap: 10px; }
.inc-param { display: grid; grid-template-columns: minmax(120px, 1fr) 2fr 88px; align-items: center; gap: 10px; }
.inc-param__label { font-weight: 500; }
.inc-param__unit { color: var(--inc-muted); font-weight: 400; }
.inc-param input[type='range'] { width: 100%; accent-color: var(--inc-lit); }
.inc-param input[type='number'] {
  width: 100%;
  background: var(--inc-card);
  border: 1px solid var(--inc-line);
  border-radius: 8px;
  padding: 4px 6px;
}
.inc-param__note { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--inc-muted); }
.inc-error { margin: 8px 0; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--inc-danger); color: var(--inc-danger); }
.inc-error[hidden] { display: none; }
.inc-teaching { margin-top: 10px; display: grid; gap: 8px; }
.inc-teaching:empty { display: none; }
.inc-explain { margin: 0; }
.inc-steps { background: var(--inc-card); border-radius: 8px; padding: 8px 12px; }
.inc-steps__start { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.inc-steps__count { color: var(--inc-muted); font-size: 12px; }
.inc-steps__active { display: grid; gap: 8px; }
.inc-steps__say { margin: 0; font-weight: 500; }
.inc-steps__nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.inc-steps__progress { color: var(--inc-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.inc-steps button { background: var(--inc-bg); }
.inc-description { margin-top: 10px; }
.inc-describe summary { cursor: pointer; color: var(--inc-muted); }
.inc-describe p { margin: 6px 0 0; }
.inc-print-only { display: none; }
.inc-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .inc-figure * { transition: none !important; }
}
@media print {
  .inc-figure { break-inside: avoid; }
  .inc-controls, .inc-steps, .inc-describe, .inc-part-info { display: none !important; }
  .inc-print-only { display: block; margin: 6px 0 0; }
}
`.trim();

/**
 * The bundled theme. It is static so the frame's CSP can allow it by hash.
 * Scenes use tone names; colours live only here, in light and dark. Every
 * size, radius and surface is a token (`--inc-*`) an integrator can set, and
 * the presets (`data-preset`), layouts (`data-layout`), densities and sizes
 * are selectors here, so styling a figure never needs new CSS in the frame.
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
  --inc-shadow-color: rgba(20, 20, 30, 0.12);
  --inc-font: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --inc-font-size: 14px;
  --inc-radius: 10px;
  --inc-radius-sm: 8px;
  --inc-gap: 10px;
  --inc-pad: 12px;
  --inc-control-height: 36px;
  --inc-border-width: 1px;
  --inc-surface: var(--inc-card);
  --inc-button-bg: var(--inc-card);
  --inc-scene-bg: transparent;
  --inc-shadow: none;
  --inc-blur: 0px;
  color: var(--inc-fg);
  background: var(--inc-bg);
  font: var(--inc-font-size)/1.45 var(--inc-font);
  border-radius: var(--inc-radius);
  padding: var(--inc-pad);
  box-sizing: border-box;
  box-shadow: var(--inc-shadow);
  container-type: inline-size;
  max-width: var(--inc-max-width, none);
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
  --inc-shadow-color: rgba(0, 0, 0, 0.45);
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
    --inc-shadow-color: rgba(0, 0, 0, 0.45);
  }
}
html.inc-frame, html.inc-frame body { margin: 0; padding: 0; background: transparent; }
.inc-figure *, .inc-figure *::before, .inc-figure *::after { box-sizing: border-box; }
.inc-figure [hidden] { display: none !important; }
.inc-figure[data-align='center'] { margin-inline: auto; }
.inc-figure[data-align='end'] { margin-inline-start: auto; }
.inc-figure[data-density='compact'] { --inc-gap: 6px; --inc-pad: 8px; --inc-control-height: 32px; }
.inc-figure[data-density='spacious'] { --inc-gap: 14px; --inc-pad: 18px; }
.inc-figure[data-size='sm'] { --inc-font-size: 13px; --inc-control-height: 32px; }
.inc-figure[data-size='lg'] { --inc-font-size: 16px; --inc-control-height: 44px; }
.inc-header { display: flex; flex-direction: column; gap: 2px; margin: 0 0 6px; }
.inc-title { margin: 0; font-weight: 600; }
.inc-hint { margin: 0; font-size: 0.86em; color: var(--inc-muted); }
.inc-idea { margin: 0 0 8px; font-weight: 600; }
.inc-header + .inc-idea { font-weight: 400; }
.inc-body { display: flex; flex-direction: column; gap: var(--inc-gap); }
.inc-panel { display: flex; flex-direction: column; gap: var(--inc-gap); min-width: 0; }
.inc-panel > :empty:not(button):not(input) { display: none; }
.inc-figure[data-layout='above'] .inc-body { flex-direction: column-reverse; }
.inc-figure:is([data-layout='right'], [data-layout='left']) .inc-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--inc-panel-width, minmax(220px, 36%));
  align-items: start;
}
.inc-figure[data-layout='left'] .inc-body { grid-template-columns: var(--inc-panel-width, minmax(220px, 36%)) minmax(0, 1fr); }
.inc-figure[data-layout='left'] .inc-panel { order: -1; }
.inc-figure[data-layout='overlay'] .inc-body { position: relative; display: block; }
.inc-figure[data-layout='overlay'] .inc-panel {
  position: absolute;
  inset: auto var(--inc-pad) var(--inc-pad) var(--inc-pad);
  max-height: 55%;
  overflow: auto;
  padding: var(--inc-pad);
  border-radius: var(--inc-radius);
  background: color-mix(in srgb, var(--inc-bg) 72%, transparent);
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  box-shadow: 0 8px 28px var(--inc-shadow-color);
}
@container (max-width: 560px) {
  .inc-figure:is([data-layout='right'], [data-layout='left']) .inc-body { display: flex; flex-direction: column; }
  .inc-figure[data-layout='left'] .inc-panel { order: 0; }
  .inc-figure[data-layout='overlay'] .inc-panel { position: static; max-height: none; backdrop-filter: none; }
}
.inc-scene { position: relative; background: var(--inc-scene-bg); border-radius: var(--inc-radius-sm); }
.inc-stage-host { position: relative; }
.inc-stage { display: block; width: 100%; height: var(--inc-scene-height, auto); overflow: visible; }
.inc-stage[data-zoomed] { overflow: hidden; }
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
.inc-stage .inc-fill:is(path, polyline) { fill: var(--inc-tone, var(--inc-mid)); stroke: none; }
.inc-stage .inc-fill:is(.inc-shade-sphere, .inc-shade-cylinder, .inc-shade-soft) { fill: var(--inc-grad, var(--inc-tone, var(--inc-mid))); }
.inc-stage .inc-stop-light { stop-color: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 55%, #ffffff); }
.inc-stage .inc-stop-dark { stop-color: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 82%, #000000); }
.inc-stage .inc-tone-lo { --inc-tone: var(--inc-lo); }
.inc-stage .inc-tone-mid { --inc-tone: var(--inc-mid); }
.inc-stage .inc-tone-hi { --inc-tone: var(--inc-hi); }
.inc-stage .inc-tone-lit { --inc-tone: var(--inc-lit); }
.inc-stage .inc-tone-faint { --inc-tone: var(--inc-faint); stroke-width: 1; }
.inc-stage .inc-tone-a { --inc-tone: var(--inc-a); }
.inc-stage .inc-tone-b { --inc-tone: var(--inc-b); }
.inc-stage .inc-tone-c { --inc-tone: var(--inc-c); }
.inc-stage .inc-lum-0 { fill: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 55%, #000000); }
.inc-stage .inc-lum-1 { fill: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 68%, #000000); }
.inc-stage .inc-lum-2 { fill: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 80%, #000000); }
.inc-stage .inc-lum-3 { fill: var(--inc-tone, var(--inc-mid)); }
.inc-stage .inc-lum-4 { fill: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 82%, #ffffff); }
.inc-stage .inc-lum-5 { fill: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 66%, #ffffff); }
.inc-stage .inc-lum-6 { fill: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 50%, #ffffff); }
.inc-stage .inc-face { stroke: color-mix(in srgb, var(--inc-tone, var(--inc-mid)) 60%, #000000); stroke-width: 0.6; stroke-opacity: 0.5; }
.inc-stage .inc-face.inc-wire { fill: none; stroke: var(--inc-tone, var(--inc-mid)); stroke-width: 1; stroke-opacity: 1; }
.inc-stage .inc-dashed { stroke-dasharray: 6 5; }
.inc-stage .inc-flow { stroke-dasharray: 8 6; }
.inc-stage .inc-ghost { stroke: var(--inc-mid); stroke-opacity: 0.55; stroke-dasharray: 3 4; fill-opacity: 0.18; }
.inc-stage .inc-ghost.inc-fill { fill: var(--inc-mid); stroke: none; }
.inc-stage .inc-hidden { display: none; }
.inc-stage .inc-part { cursor: pointer; }
.inc-stage .inc-part:focus { outline: none; }
.inc-stage .inc-part.is-focus, .inc-stage .inc-part:focus-visible { --inc-tone: var(--inc-lit); }
.inc-stage .inc-part:is(.is-focus, :focus-visible):is(path, line, polyline) { stroke-width: 3.5; }
.inc-stage .inc-part:is(.is-focus, :focus-visible):is(circle, rect) { stroke: var(--inc-fg); stroke-width: 2; }
.inc-stage .inc-draggable { cursor: grab; touch-action: none; }
.inc-stage .inc-draggable:focus { outline: none; }
.inc-stage .inc-draggable.is-dragging { cursor: grabbing; }
.inc-stage :is(circle, rect, use).inc-draggable { stroke: var(--inc-tone, var(--inc-lit)); stroke-width: 9px; stroke-opacity: 0.22; paint-order: stroke; }
.inc-stage :is(circle, rect, use).inc-draggable:is(:hover, :focus-visible, .is-dragging) { stroke-opacity: 0.4; }
.inc-stage .inc-draggable:focus-visible { stroke: var(--inc-focus); stroke-opacity: 0.6; }
.inc-stage [data-layer='mid'] > *, .inc-stage [data-layer='front'] > * { transition: opacity 0.18s; }
.inc-figure.has-focus .inc-stage :is([data-layer='mid'], [data-layer='front']) > :not(.is-focus):not(:has(.is-focus)) {
  opacity: 0.3;
}
.inc-figure.has-focus .inc-stage [data-owner].is-focus { opacity: 1; }
.inc-stage.inc-zoomable { touch-action: pan-x pan-y; }
.inc-stage-host.is-active > .inc-stage.inc-zoomable { touch-action: none; }
.inc-stage-host.is-active { outline: 2px dashed color-mix(in srgb, var(--inc-focus) 55%, transparent); outline-offset: 3px; border-radius: var(--inc-radius-sm); }
.inc-stage[data-orbit] { cursor: grab; }
.inc-stage[data-zoomed]:not([data-orbit]) { cursor: move; }
.inc-dots { position: absolute; pointer-events: none; }
.inc-zoombar {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  opacity: 0.55;
  transition: opacity 0.15s;
}
.inc-stage-host:is(:hover, :focus-within, .is-active) > .inc-zoombar, .inc-zoombar:focus-within { opacity: 1; }
.inc-figure .inc-zoombar button, .inc-figure .inc-zoombar select {
  min-height: 28px;
  min-width: 28px;
  padding: 0 6px;
  font-size: 13px;
  line-height: 1;
  border-radius: var(--inc-radius-sm);
  background: color-mix(in srgb, var(--inc-bg) 85%, transparent);
  border: var(--inc-border-width) solid var(--inc-line);
}
@media (pointer: coarse) { .inc-figure .inc-zoombar button, .inc-figure .inc-zoombar select { min-height: 36px; min-width: 36px; } .inc-zoombar { opacity: 0.9; } }
.inc-part-info { margin: 0; min-height: 1.45em; }
.inc-part-info.is-hint { color: var(--inc-muted); font-size: 0.86em; }
.inc-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; margin: 0; padding: 0; list-style: none; font-size: 0.9em; }
.inc-legend__item { display: inline-flex; align-items: center; gap: 6px; }
.inc-legend__swatch { width: 14px; height: 4px; border-radius: 2px; background: var(--inc-swatch, var(--inc-mid)); flex: none; }
.inc-legend__swatch.is-dashed { background: repeating-linear-gradient(90deg, var(--inc-swatch, var(--inc-mid)) 0 4px, transparent 4px 7px); }
.inc-figure .inc-legend__toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 2px 8px; }
.inc-figure .inc-legend__toggle[aria-pressed='false'] { opacity: 0.5; text-decoration: line-through; }
.inc-swatch--lo { --inc-swatch: var(--inc-lo); }
.inc-swatch--mid { --inc-swatch: var(--inc-mid); }
.inc-swatch--hi { --inc-swatch: var(--inc-hi); }
.inc-swatch--lit { --inc-swatch: var(--inc-lit); }
.inc-swatch--faint { --inc-swatch: var(--inc-faint); }
.inc-swatch--a { --inc-swatch: var(--inc-a); }
.inc-swatch--b { --inc-swatch: var(--inc-b); }
.inc-swatch--c { --inc-swatch: var(--inc-c); }
.inc-readouts { display: flex; flex-wrap: wrap; gap: 8px; }
.inc-readouts:empty { display: none; }
.inc-readout { background: var(--inc-surface); border-radius: var(--inc-radius-sm); padding: 6px 10px; min-width: 96px; }
.inc-readout__label { display: block; font-size: 0.86em; color: var(--inc-muted); }
.inc-readout__value { font-variant-numeric: tabular-nums; font-weight: 600; }
.inc-tables { overflow-x: auto; }
.inc-table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 0.92em; min-width: 50%; }
.inc-table caption { text-align: start; font-weight: 600; padding-bottom: 4px; }
.inc-table :is(th, td) { padding: 3px 10px; border-bottom: var(--inc-border-width) solid var(--inc-faint); text-align: end; }
.inc-table th { color: var(--inc-muted); font-weight: 500; }
.inc-formulas { display: grid; gap: 8px; }
.inc-formula { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 10px; }
.inc-formula__label { color: var(--inc-muted); font-size: 0.9em; }
.inc-formula__math { font-size: 1.15em; }
.inc-formula__math math { font-size: inherit; }
.inc-figure .inc-formula__input { grid-column: 1 / -1; width: 100%; font-family: ui-monospace, 'SF Mono', Menlo, monospace; background: var(--inc-surface); border: var(--inc-border-width) solid var(--inc-line); border-radius: var(--inc-radius-sm); padding: 4px 8px; }
.inc-figure .inc-formula__input[aria-invalid='true'] { border-color: var(--inc-danger); }
.inc-formula__error { grid-column: 1 / -1; margin: 0; color: var(--inc-danger); font-size: 0.86em; }
.inc-predict { display: grid; gap: 8px; background: var(--inc-surface); border-radius: var(--inc-radius-sm); padding: 10px 12px; }
.inc-predict__question { margin: 0; font-weight: 600; }
.inc-predict__options { display: flex; flex-wrap: wrap; gap: 6px; }
.inc-figure .inc-predict__options button[aria-pressed='true'] { border-color: var(--inc-fg); font-weight: 600; }
.inc-figure .inc-predict__options button.is-answer { border-color: var(--inc-c); box-shadow: inset 0 0 0 1px var(--inc-c); }
.inc-predict__result { margin: 0; }
.inc-predict__result:empty { display: none; }
.inc-controls { display: flex; flex-direction: column; gap: var(--inc-gap); }
.inc-transport { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.inc-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.inc-figure button, .inc-figure select, .inc-figure input {
  font: inherit;
  color: inherit;
  min-height: var(--inc-control-height);
}
.inc-figure button {
  background: var(--inc-button-bg);
  border: var(--inc-border-width) solid var(--inc-line);
  border-radius: var(--inc-radius-sm);
  padding: 4px 12px;
  cursor: pointer;
}
.inc-figure button.inc-primary { border-color: var(--inc-fg); font-weight: 600; }
.inc-figure button.inc-icon-button { min-width: var(--inc-control-height); padding: 4px 8px; }
.inc-figure button.inc-chip { border-radius: 999px; padding: 2px 12px; min-height: calc(var(--inc-control-height) - 4px); }
.inc-figure button[aria-pressed='true'] { border-color: var(--inc-fg); }
.inc-figure button.inc-chip[aria-pressed='true'] { background: var(--inc-fg); color: var(--inc-bg); }
.inc-figure button:disabled, .inc-figure button[aria-disabled='true'] { opacity: 0.5; cursor: default; }
.inc-figure select { background: var(--inc-button-bg); border: var(--inc-border-width) solid var(--inc-line); border-radius: var(--inc-radius-sm); padding: 4px 8px; }
.inc-figure :focus-visible { outline: 2px solid var(--inc-focus); outline-offset: 2px; }
@media (pointer: coarse) {
  .inc-figure { --inc-control-height: 44px; }
}
.inc-params { display: grid; gap: var(--inc-gap); }
.inc-param { display: grid; grid-template-columns: minmax(120px, 1fr) 2fr 88px; align-items: center; gap: var(--inc-gap); }
.inc-param--toggle { grid-template-columns: auto 1fr; }
.inc-param:is(.inc-param--choice, .inc-param--color) { grid-template-columns: minmax(120px, 1fr) 2fr; }
@container (max-width: 420px) {
  .inc-param { grid-template-columns: 1fr 88px; }
  .inc-param .inc-param__label { grid-column: 1 / -1; }
  .inc-param:is(.inc-param--choice, .inc-param--color) { grid-template-columns: 1fr; }
}
.inc-param__label { font-weight: 500; }
.inc-param__unit { color: var(--inc-muted); font-weight: 400; }
.inc-param input[type='range'] { width: 100%; accent-color: var(--inc-lit); }
.inc-param input[type='number'] {
  width: 100%;
  background: var(--inc-surface);
  border: var(--inc-border-width) solid var(--inc-line);
  border-radius: var(--inc-radius-sm);
  padding: 4px 6px;
}
.inc-param[data-linked] .inc-param__label::after { content: ' ⇄'; color: var(--inc-muted); }
.inc-param__note { grid-column: 1 / -1; margin: 0; font-size: 0.86em; color: var(--inc-muted); }
.inc-figure input.inc-switch {
  appearance: none;
  -webkit-appearance: none;
  width: 42px;
  min-height: 0;
  height: 24px;
  border-radius: 999px;
  background: var(--inc-lo);
  position: relative;
  cursor: pointer;
  margin: 0;
  transition: background 0.15s;
}
.inc-figure input.inc-switch::before {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--inc-bg);
  box-shadow: 0 1px 2px var(--inc-shadow-color);
  transition: transform 0.15s;
}
.inc-figure input.inc-switch:checked { background: var(--inc-lit); }
.inc-figure input.inc-switch:checked::before { transform: translateX(18px); }
.inc-segmented { display: inline-flex; flex-wrap: wrap; border: var(--inc-border-width) solid var(--inc-line); border-radius: var(--inc-radius-sm); overflow: hidden; }
.inc-figure .inc-segmented button { border: 0; border-radius: 0; background: transparent; }
.inc-figure .inc-segmented button + button { border-inline-start: var(--inc-border-width) solid var(--inc-line); }
.inc-figure .inc-segmented button[aria-pressed='true'] { background: var(--inc-fg); color: var(--inc-bg); }
.inc-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.inc-figure button.inc-swatch { width: 30px; min-height: 30px; height: 30px; padding: 0; border-radius: 50%; background: var(--inc-swatch); border: 2px solid transparent; }
.inc-figure button.inc-swatch[aria-pressed='true'] { border-color: var(--inc-fg); box-shadow: inset 0 0 0 2px var(--inc-bg); }
.inc-settings { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; background: var(--inc-surface); border-radius: var(--inc-radius-sm); padding: 10px; }
.inc-settings__timing { display: contents; }
.inc-settings__field { display: grid; gap: 2px; font-size: 0.9em; color: var(--inc-muted); }
.inc-settings__field :is(input, select) { color: var(--inc-fg); }
.inc-figure .inc-settings input[type='number'] { background: var(--inc-bg); border: var(--inc-border-width) solid var(--inc-line); border-radius: var(--inc-radius-sm); padding: 4px 6px; }
.inc-error { padding: 8px 12px; border-radius: var(--inc-radius-sm); border: var(--inc-border-width) solid var(--inc-danger); color: var(--inc-danger); }
.inc-error[hidden] { display: none; }
.inc-teaching { display: grid; gap: 8px; }
.inc-teaching:empty { display: none; }
.inc-explain { margin: 0; }
.inc-steps { background: var(--inc-surface); border-radius: var(--inc-radius-sm); padding: 8px 12px; }
.inc-steps__start { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.inc-steps__count { color: var(--inc-muted); font-size: 0.86em; }
.inc-steps__active { display: grid; gap: 8px; }
.inc-steps__say { margin: 0; font-weight: 500; }
.inc-steps__nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.inc-steps__progress { color: var(--inc-muted); font-size: 0.86em; font-variant-numeric: tabular-nums; }
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
.inc-figure:fullscreen { overflow: auto; padding: max(var(--inc-pad), env(safe-area-inset-top)) max(var(--inc-pad), env(safe-area-inset-right)) max(var(--inc-pad), env(safe-area-inset-bottom)) max(var(--inc-pad), env(safe-area-inset-left)); }
.inc-figure:fullscreen .inc-stage { max-height: 72vh; }
.inc-figure[data-hide-header] .inc-header, .inc-figure[data-hide-idea] .inc-idea, .inc-figure[data-hide-readouts] .inc-readouts,
.inc-figure[data-hide-legend] .inc-legend, .inc-figure[data-hide-controls] .inc-controls, .inc-figure[data-hide-steps] .inc-steps,
.inc-figure[data-hide-description] .inc-description, .inc-figure[data-hide-zoom] .inc-zoombar, .inc-figure[data-hide-part-info] .inc-part-info { display: none !important; }
.inc-figure[data-preset='glass'] {
  --inc-bg: rgba(255, 255, 255, 0.55);
  --inc-surface: rgba(255, 255, 255, 0.45);
  --inc-button-bg: rgba(255, 255, 255, 0.5);
  --inc-line: rgba(255, 255, 255, 0.7);
  --inc-radius: 18px;
  --inc-radius-sm: 12px;
  --inc-shadow: 0 10px 40px rgba(31, 38, 135, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(var(--inc-glass-blur, 18px)) saturate(160%);
  -webkit-backdrop-filter: blur(var(--inc-glass-blur, 18px)) saturate(160%);
}
.inc-figure[data-preset='glass'][data-theme='dark'] {
  --inc-bg: rgba(24, 24, 32, 0.55);
  --inc-surface: rgba(255, 255, 255, 0.08);
  --inc-button-bg: rgba(255, 255, 255, 0.1);
  --inc-line: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.14);
}
@media (prefers-color-scheme: dark) {
  .inc-figure[data-preset='glass']:not([data-theme='light']) {
    --inc-bg: rgba(24, 24, 32, 0.55);
    --inc-surface: rgba(255, 255, 255, 0.08);
    --inc-button-bg: rgba(255, 255, 255, 0.1);
    --inc-line: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.14);
  }
}
.inc-figure[data-preset='glass'] :is(button, select, .inc-readout, .inc-steps, .inc-settings, .inc-predict, .inc-formula__input) {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.inc-figure[data-preset='glass'] button { border-radius: 999px; }
.inc-figure[data-preset='glass'] .inc-segmented { border-radius: 999px; }
.inc-figure[data-preset='minimal'] { --inc-bg: transparent; --inc-surface: transparent; --inc-button-bg: transparent; --inc-pad: 0px; --inc-border-width: 0px; }
.inc-figure[data-preset='minimal'] button { text-decoration: underline; text-underline-offset: 3px; padding-inline: 6px; }
.inc-figure[data-preset='minimal'] .inc-readout { padding-inline: 0; }
.inc-figure[data-preset='outline'] { --inc-bg: transparent; --inc-surface: transparent; --inc-button-bg: transparent; border: 1px solid var(--inc-line); }
.inc-figure[data-preset='outline'] :is(.inc-readout, .inc-steps, .inc-settings, .inc-predict) { border: 1px solid var(--inc-line); }
.inc-figure[data-preset='contrast'] { --inc-fg: #000000; --inc-bg: #ffffff; --inc-muted: #333333; --inc-line: #000000; --inc-card: #ffffff; --inc-focus: #0000ee; --inc-border-width: 2px; }
.inc-figure[data-preset='contrast'] :focus-visible { outline-width: 3px; }
.inc-figure[data-preset='soft'] {
  --inc-radius: 22px;
  --inc-radius-sm: 14px;
  --inc-card: color-mix(in srgb, var(--inc-lit) 7%, var(--inc-bg));
  --inc-shadow: 0 12px 32px var(--inc-shadow-color);
  --inc-border-width: 0px;
}
.inc-figure[data-preset='soft'] button { box-shadow: 0 1px 3px var(--inc-shadow-color); }
@media (prefers-reduced-motion: reduce) {
  .inc-figure * { transition: none !important; }
}
@media print {
  .inc-figure { break-inside: avoid; box-shadow: none; backdrop-filter: none; }
  .inc-controls, .inc-steps, .inc-describe, .inc-part-info, .inc-zoombar, .inc-predict, .inc-formula__input { display: none !important; }
  .inc-print-only { display: block; margin: 6px 0 0; }
}
`.trim();

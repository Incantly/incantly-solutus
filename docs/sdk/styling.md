# Styling figures

An integrator decides how every figure looks in their product: the card, the controls, the drawing, where the controls sit, how big the drawing is and which parts show. Generated scenes never style the figure; they only draw with tone names (`a`, `b`, `c`, `lit`, `muted`). Everything below is configuration the SDK applies, so one setting restyles every figure, generated or reviewed, without touching scene code.

A style is plain data, `FigureStyle`, exported from `@incantly/core`:

```ts
import type { FigureStyle } from '@incantly/core';

const style: FigureStyle = {
  preset: 'glass',
  tokens: { a: '#7c3aed', radius: '18px', font: 'Inter, system-ui, sans-serif' },
  classNames: { button: 'rounded-full shadow-md', slider: 'accent-violet-600' },
  css: compiledTailwind,
  layout: { controls: 'right', sceneHeight: '420px', density: 'compact', align: 'center', maxWidth: '960px' },
  show: { settings: false, fullscreen: false },
};
```

Every field is optional. Each is checked before it is used, on the host and again inside the sandboxed frame, and anything that does not pass is dropped rather than trusted.

## Where a style goes

| Integration | How |
| --- | --- |
| Sandboxed figure | `mountSandboxed(container, fragments, { style, theme })` |
| Any execution adapter | `adapter.mount(container, fragments, { style, theme })` |
| Trusted reference scene, in the page | `mountTrusted(container, { html, css, js }, { style, theme })` |
| TipTap | `FigureNode.configure({ style, theme, numbering })` styles every figure in the editor |
| One figure in a note | `editor.commands.setFigureLook(look)` on the selected figure |

A live figure restyles in place, keeping the learner's values, step and formulas:

```ts
const figure = mountSandboxed(container, fragments, { style });
figure.setStyle({ ...style, preset: 'paper', layout: { controls: 'left' } });
figure.setTheme('dark');      // 'light', 'dark' or 'auto' (follows the system)
figure.setNumber(3);          // shows "Fig 3" in the card; null for none
```

`setStyle` changes the preset, tokens, slot classes, layout and shown parts. The trusted `css` is part of the frame document and of its content security policy, so changing it needs a new mount.

## Presets

A preset is a whole look, chosen with one word.

| Preset | Look |
| --- | --- |
| `default` | A quiet card on the page background |
| `glass` | Translucent card with backdrop blur, soft shadow and pill buttons; tune it with `blur` (default `18px`) and `surface` |
| `soft` | Raised card with rounded, filled controls |
| `outline` | No fill: hairline borders around the card and controls |
| `minimal` | No card at all: the drawing and controls sit on the page |
| `contrast` | High contrast: heavier lines and borders, stronger focus rings |
| `paper` | Warm off-white palette with ink tones |
| `blueprint` | Deep blue palette with a faint grid behind the drawing |
| `sepia` | Brown-toned palette for reading modes |

Presets compose with everything else: tokens, classes and layout go over them.

## Tokens

Tokens are the theme's CSS variables, given without the `--inc-` prefix. Values are plain CSS values: colours, lengths, shadows, font lists. They may not end a declaration, open a block, load a resource (`url(`, `image(`) or read another page's variables.

| Token | What it sets |
| --- | --- |
| `bg`, `fg`, `muted`, `line`, `card` | Card background, text, secondary text, lines and borders, raised surfaces |
| `a`, `b`, `c`, `lit` | The scene tones: the colours generated scenes draw with (`lit` is the highlight) |
| `focus`, `danger` | Focus ring, error text |
| `font`, `font-size` | Font family list and base size |
| `radius`, `radius-sm` | Card corners, control corners |
| `gap`, `pad` | Space between rows, padding inside the card |
| `control-height`, `border-width` | Height of buttons and inputs, width of borders |
| `surface`, `button-bg` | Panel and button fills |
| `shadow`, `blur` | Card shadow; the glass preset's backdrop blur |
| `scene-bg` | Background behind the drawing |

Tokens given in a style apply in both light and dark themes. For a colour that differs by theme, either set it again with `setStyle` when the theme changes, or write it in the trusted CSS under `.inc-figure[data-theme='dark']`.

## Classes per part, for Tailwind and other utility CSS

`classNames` adds classes to named parts of the figure. The slots are listed in `STYLE_SLOTS`:

| Slot | Element |
| --- | --- |
| `figure` | The card itself |
| `header`, `title`, `hint`, `idea` | The heading block, the title, its hint line and the teaching idea |
| `body`, `scene`, `stage` | The drawing and controls together, the drawing area, each SVG stage |
| `panel`, `controls`, `params`, `param`, `label` | The controls column, the control group, the parameter list, one parameter row and its label |
| `slider`, `number`, `switch`, `select`, `segmented` | Each kind of input |
| `button`, `primary`, `chip`, `transport`, `settings` | Every button, the main action, preset chips, play and pause, the settings menu |
| `readouts`, `readout`, `legend`, `formula`, `table` | The values the figure reports, its legend, formulas and tables |
| `steps`, `predict`, `zoombar`, `description` | Teaching steps, prediction prompts, the zoom buttons, the text description |

A figure lives in a sandboxed frame, so the host page's stylesheet does not reach it. To use Tailwind, give the compiled stylesheet as `css`: it is added to the frame and allowed by its hash, and nothing in it can reach the network.

```ts
import tailwind from './tailwind.css?raw';   // your compiled build, with these class names in its content paths

const style: FigureStyle = {
  preset: 'glass',
  css: tailwind,
  classNames: {
    figure: 'rounded-3xl ring-1 ring-white/20 bg-white/10 backdrop-blur-xl',
    button: 'rounded-full shadow-md hover:shadow-lg transition',
    slider: 'accent-violet-600',
    label: 'uppercase tracking-wide text-xs',
    readout: 'bg-violet-500/10 border-violet-500/30',
  },
};
```

Classes are names only (letters, digits and the punctuation utility frameworks use, such as `hover:`, `/`, `[` `]`); at most 40 per slot. The SDK's own `inc-` classes are never removed.

## Layout: where the controls go and how big the drawing is

| Field | Values | Default |
| --- | --- | --- |
| `controls` | `below`, `above`, `right`, `left`, `overlay` (floating over the drawing) | `below` |
| `sceneHeight` | A length such as `420px`, `50vh` or `auto` | The drawing's own aspect ratio |
| `maxWidth` | A length; the card grows no wider | None |
| `align` | `start`, `center`, `end`, `stretch` | `stretch` |
| `density` | `compact`, `comfortable`, `spacious` | `comfortable` |
| `size` | `sm`, `md`, `lg`: text and control size | `md` |
| `panelWidth` | Width of the side panel when controls sit left or right | About a third, at least 220 px |

Side panels fall back below the drawing when the figure is narrow, and their rows stack the label over the slider when the panel itself is narrow. Lengths accept `px`, `rem`, `em`, `vh`, `vw`, `svh`, `dvh`, `%` and `ch`.

## Which parts show

`show` turns parts off: `header`, `idea`, `readouts`, `legend`, `controls`, `transport` (play and pause), `speed`, `settings`, `undo`, `fullscreen`, `steps`, `description`, `zoom` (the zoom buttons; pinch and wheel zoom still work), and `partInfo` (the panel that names a part when the learner points at it). All are on by default. Turning a part off hides it; the figure keeps working, and its text description stays available to screen readers.

## Styles in TipTap

```ts
import { FigureNode } from '@incantly/tiptap';
import { sandboxAdapter } from '@incantly/core';

const editor = new Editor({
  extensions: [
    StarterKit,
    FigureNode.configure({ adapter: sandboxAdapter, theme: 'auto', numbering: true, style: { preset: 'soft', tokens: { a: '#0ea5e9' } } }),
  ],
});

// Over the editor's style, for the selected figure only; null goes back to the editor's.
editor.commands.setFigureLook({ preset: 'paper', layout: { controls: 'left', sceneHeight: '480px' } });
```

A figure's own look is stored in the note as its `look` attribute. Notes travel between people, so the look keeps only what `checkStyle` accepts: preset, tokens, classes, layout and shown parts, never CSS. It goes over the editor's style with `mergeStyles`: fields of the look win, classes add up, and the editor keeps its CSS. Changing the look restyles the live figure without remounting it, and it is one undoable step.

`numbering: true` numbers figures in document order (Fig 1, Fig 2) and renumbers them as figures are added, moved or deleted.

## Helpers

- `resolveStyle(style)` checks a style and fills in the defaults, as the renderer sees it.
- `checkStyle(value)` keeps only the valid fields that were given, without defaults or CSS: what a document may store.
- `mergeStyles(base, over)` puts one style over another.
- `STYLE_SLOTS` lists the slot names, for building a settings screen.

## Try it

The playground's look page (`npm run dev --workspace @incantly/playground`, then open `?page=style`) mounts any reviewed scene with every option above: preset, accent colour, corner radius, font, utility classes with their own CSS, controls placement, density, size, drawing height, the parts that show, and the theme, in the sandbox or in the page. It restyles the live figure on every change, so a drag or a slider value survives a restyle.

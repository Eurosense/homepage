# Design system

Every value here was **measured from the live Squarespace site** with
`getComputedStyle`, not chosen. That matters more than it sounds: the migration
lost four headings and every outlined button because plausible-looking values
were inferred instead of read. If you need a value that is not written down,
measure it — see [Measuring](#measuring-a-value-you-do-not-have) below.

Everything lives in `src/app/globals.css`. Tailwind v4 generates utilities from the
`@theme` block, so `--color-purple` gives you `bg-purple`, `text-purple` and
`border-purple` automatically.

## Palette

| Token         | Hex       | What it is                                           |
| ------------- | --------- | ---------------------------------------------------- |
| `cream`       | `#f8f7f1` | Page background. Warm off-white, not grey            |
| `purple`      | `#483458` | Body text, primary actions                           |
| `purple-deep` | `#321d46` | Dark section bands, headings on light themes         |
| `gold`        | `#fdc220` | Headings on cream, primary button fill, list markers |
| `ink`         | `#1b1024` | Form input text                                      |
| `muted`       | `#6b5f73` | Secondary and meta text                              |
| `line`        | `#e2ded2` | Borders and rules                                    |

> **Squarespace's own colour names are inverted and cannot be reasoned about.**
> Its `--black` is white and its `--white` is the cream page background. The
> `.sqsrte-text-color--*` classes in migrated content are mapped in `globals.css`
> against measured values. Do not "correct" them to match their names.

## Type

Satoshi for everything — display _and_ body. Roboto is loaded and available as
`--font-sans` but the live site sets body copy in Satoshi too.

Sizes are linear fits through two measurements (390px and 1440px viewports),
which is how Squarespace expresses them, so they track the original at every
width rather than only at breakpoints.

| Element          | Size                         | Line height | Notes          |
| ---------------- | ---------------------------- | ----------- | -------------- |
| `h1`             | `calc(38.949px + 1.9063vw)`  | 1.056       |                |
| `h2`             | `calc(35.125px + 1.5886vw)`  | 1.08        |                |
| `h3`             | `calc(19.825px + 0.31771vw)` | 1.176       |                |
| `h4`             | `calc(15.5px + 0.24vw)`      | 1.2         |                |
| `p`              | `1rem` — **fixed**           | 1.45        | Does not scale |
| `p.sqsrte-large` | `calc(17.912px + 0.15886vw)` | 1.45        | Hero subtitles |

All headings are `700`, `letter-spacing: -0.02em`, and **`text-transform: capitalize`**.
That last one is why "Access the stories" renders as "Access The Stories" — the
source text is sentence case and the CSS title-cases it. Do not edit content to
match what you see on screen.

Body copy is deliberately not fluid. Only paragraphs carrying `.sqsrte-large`
scale with the viewport.

## Section themes

Each section carries `data-theme`. The theme sets background, heading, text and
button colours through CSS custom properties, so the same component inverts
correctly on a dark band without any conditional logic.

| Theme            | Background  | Heading | Text        | Outlined button               |
| ---------------- | ----------- | ------- | ----------- | ----------------------------- |
| `white`, `light` | cream       | gold    | **gold**    | gold                          |
| `white-bold`     | cream       | purple  | purple      | gold (primary fill is purple) |
| `bright-inverse` | `#ffffff`   | purple  | purple      | gold                          |
| `bright`         | purple      | white   | white       | white                         |
| `none`           | purple-deep | gold    | gold        | white                         |
| `dark`           | **gold**    | cream   | purple-deep | purple-deep                   |

On `white` and `light`, body copy is **gold too**, not purple — measured on
`/resources`, where the three section descriptions carry no colour of their own.
It reads at about 1.7:1 against cream. That is the original's choice, reproduced;
see [Accessibility](#accessibility).

List sections are the exception: they set their own colours and ignore the
section theme. Measured on the homepage — section title purple-deep at the `h2`
size and centred, item titles purple-deep `19.36px/700`, item descriptions purple
`14.272px`, and the item button a solid purple fill with white text rather than
the theme's outlined gold.

`dark` is a **gold** band, not a dark one. Grouping it with `none` because the
names sounded alike rendered the "Our Partners" heading purple-on-purple.
`scripts/check-contrast.mjs` now fails the build when any theme paints text in
its own background colour — that mistake shipped three times.

`white` and `none` cover most of the site. Sections with their own background
image get `data-has-background`, which drops the flat fill so the image shows.

### Section dividers

Fifteen sections cut a shape — a slant, a chevron, a rounded tab — out of the
bottom of their background, so the page colour shows through. **The page behind
every section is `purple-deep`, not cream**; that is the colour the cut reveals.

Squarespace ships `d="M0,0"` in the HTML and computes the real path in the
browser, so the shapes are not in `archive/raw/`. They were measured from the
live site into **`archive/dividers.json`**, which is committed because there will
be nowhere to measure them from later. `npm run capture:dividers` re-reads them
while the site is up.

### Block surfaces

A block can carry its own background, corner radius and padding — the white
pills behind the numbered steps are text blocks styled this way, and there are 39
across the site. The extractor reads them out of each block's
`<style id="container-styles">` and resolves Squarespace's palette variables
against the measured values above.

**Use the properties, never a hard-coded colour**, or the component will be wrong
on half the site:

```jsx
className = 'bg-[color:var(--sec-btn-bg)] text-[color:var(--sec-btn-text)]'
```

## Buttons

Three variants, all `border-radius: 15px`, `font-size: 16px`, weight 500.

- **primary** — solid `--sec-btn-bg` fill with `--sec-btn-text` label
- **secondary** and **tertiary** — transparent, `1px` border in `--sec-btn-outline`,
  label the same colour
- `stretched` fills the grid cell; otherwise the button hugs its label

Heights: `h-14` normally, `h-12` for `size: small`.

## Layout

Migrated pages reproduce Squarespace's fluid-engine grid rather than
reinterpreting it:

- **Mobile (<768px):** 8 columns, `24px` minimum row height, 8px row gap, 12px column gap
- **Desktop (≥768px):** 24 columns, row height `container-width × 0.0215`
- Page: `--site-max-width: 1400px`, gutters `4vw` desktop / `6vw` mobile

Each block carries its own `grid-area` for both breakpoints, captured from the
original. `FluidSection` replays them. Section heights come from Squarespace's
presets — `small` is `33vh`, `medium` is `66vh`, and anything else is as tall as
its content. **Those heights matter:** a section that collapses around its grid
crops a `cover` background image into a thin band, and the graphic stops reading
as a shape.

Sections containing a `list` block get `max-w-6xl` instead of the `max-w-3xl`
reading column, or a row of partner logos stacks one per row.

## Forms

Always on a **solid white card**. Section themes run from cream to deep purple and
forms appear over background images; HubSpot's own labels live in an iframe we
cannot restyle. A fixed light surface is the only way to guarantee the fields are
readable — this is not decoration.

## Accessibility

- Contrast: white-on-gold buttons on dark bands are ~1.6:1, and gold body copy
  on cream (`white`/`light` themes) is ~1.7:1. Both are **reproduced from the
  original**, not chosen. If you are willing to diverge, these are the first two
  things worth fixing.
- `scripts/check-contrast.mjs` only catches text painted in its own background
  colour. It will not flag merely poor contrast, which is deliberate — the ratios
  above would fail it on every page.
- Accordions are native `<details>`: keyboard accessible, no JavaScript, and
  find-in-page reaches collapsed content.
- Every section theme is applied with `data-theme`, so a new section inherits
  correct colours without thought.
- `prefers-reduced-motion` is honoured globally.

## Measuring a value you do not have

Load the live page and read it, rather than guessing:

```js
// in the browser console on www.eurosense.eu
const el = document.querySelector('.sqs-html-content h2')
getComputedStyle(el).fontSize // "58px"
```

For a value that scales, measure at two widths (390 and 1440 are the ones used
here) and fit a line: `size = intercept + slope × vw`.

While the Squarespace site is still up, this is free. **After it is cancelled the
only reference left is `archive/raw/`** — the HTML snapshots, which have the
markup but not the computed styles. Measure anything you are unsure about now.

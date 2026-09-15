# Working in this repository

Notes for whoever edits this site next, human or agent.

## What this is

The eurosense.eu website: a static React (Next.js) site, built from `content/` and
deployed to [deploybase](https://deploybase.eu) on every push to `main`.

It was migrated off Squarespace. Nothing here depends on Squarespace any more, and
nothing should be made to depend on it again — those URLs stop resolving when the
subscription ends.

## Editing content

All content is files. There is no CMS and no database.

### Add a blog post

Create `content/blognews/<slug>.md`:

```markdown
---
title: A clear, specific headline
slug: a-clear-specific-headline
date: 2026-09-14T09:00:00.000Z
excerpt: One or two sentences, shown on the Blog & News index.
image: /media/your-image.jpg
tags:
  - democracy
collection: blognews
---

Body text in Markdown.
```

- `slug` must match the filename, because the URL is built from it.
- `date` is ISO 8601. Posts are listed newest first.
- `image` must be a file that exists in `public/media/`. CI fails if it does not.

### Edit a page

Pages live in `content/pages/<slug>.json` as ordered sections of blocks:

```json
{
  "urlPath": "/about-us",
  "title": "About us",
  "description": "Shown in search results and link previews.",
  "sections": [
    {
      "theme": "white",
      "grid": { "mobile": { "columns": 8 }, "desktop": { "columns": 24 } },
      "blocks": [
        {
          "type": "richText",
          "html": "<h2 style=\"text-align:center;\">A heading</h2><p>Some text.</p>",
          "layout": { "mobile": { "area": "3/2/10/10" }, "desktop": { "area": "2/8/9/20" } }
        }
      ]
    }
  ]
}
```

Block types: `richText`, `image`, `button`, `video`, `embed`, `form`, `quote`,
`divider`, `accordion`, `gallery`, `list`, `summary-v2`, `instagram`. They are defined
as a union in `src/lib/content.ts` — that type is the source of truth, and adding a
block type means handling it in `src/components/BlockRenderer.tsx` too.

**`richText` is HTML, not Markdown.** That is deliberate: the original pages centre
headings with `text-align` and colour parts of a heading with
`<span style="color:#123BC8">`, and Markdown can express neither. Keep the
`sqsrte-*` classes you find — `sqsrte-large` marks paragraphs that scale with the
viewport, and `sqsrte-text-color--*` are styled by the theme layer.

**`theme` and `layout` reproduce the original design.** `theme` picks the section's
background/heading/text/button colours; `layout.mobile` / `layout.desktop` are the
CSS grid areas Squarespace generated for its 8-column and 24-column grids. Editing
text inside a block is safe. Changing `area` values moves the block on the grid —
useful, but check the result at several widths.

`urlPath` determines the URL. A file whose `urlPath` is `/about-us` is served at
`/about-us/`, regardless of the filename.

### Add an image

Put the file in `public/media/` and reference it as `/media/<filename>`. Then run
`npm run optimise:media`, which re-encodes anything oversized in place.

### Videos

Squarespace served video as HLS, not files. `npm run videos` pulls each stream
down with ffmpeg, remuxes it to MP4, re-encodes it for the web and saves a poster,
writing `archive/videos.json`. The extractor reads that manifest, so a video block
whose id is not in it is reported rather than silently dropped.

### Checking pages without deploying

`node scripts/audit-pages.mjs` reads the built `out/` and reports every page's
forms, links, images and text volume. deploybase bills build minutes, so answer
questions from a local build rather than by pushing a commit to go and look.

### Add a download (PDF, spreadsheet)

Put it in `public/files/` and link it as `/files/<filename>`. Do not link to a
`/s/...` path — that is Squarespace's upload storage and it stops resolving when the
subscription ends. `check-media.mjs` fails the build if one reappears.

### Documents (PDFs, Drive files)

A short rich-text block that is just a title plus a link to a PDF or Google Drive
file is converted by the extractor into a `document` block, which renders an inline
viewer plus a download link. Drive files use Google's `/preview` endpoint, because
the `/view` URL refuses to be framed. Viewers are lazy-loaded and take the full
content width regardless of the grid cell the original link sat in.

Spreadsheets get a download link and no viewer: browsers cannot render one, and a
broken frame is worse than an honest link.

### The dashboard

`public/dashboard-app/` is a vendored copy of the EuroSense charts app. Edit it there;
it is served from this origin at `/dashboard-app/` and framed by the `/dashboard`
page.

Its data is refreshed nightly by `.github/workflows/dashboard-data.yml` and published
to GitHub Pages, _not_ committed — that keeps daily data updates from triggering a
deploybase build. The dashboard fetches the Pages copy and falls back to the
`captures.csv` committed beside it.

So `public/dashboard-app/captures.csv` is a fallback snapshot, not the live data.
Refreshing it is optional; the nightly job does not touch it.

### The newsletter

The footer carries a HubSpot form (portal `48641237`, form
`f977b591-781e-4cb9-8836-2f4c44a65d96`) as an `embed` block in `content/site.json`.
It is third-party and keeps working on its own.

`content/forms.json` decides how every migrated form behaves. Set `provider` to:

- `"hubspot"` — render HubSpot's embed (needs `hubspot.formId`)
- `"mailto"` — no backend; Send opens the visitor's mail app with the fields already
  written into the message (needs `mailto.to`)
- `"deploybase"` — POST to a deploybase form (needs `deploybaseFormId`)
- `null` — show a visible "not connected" notice

Both newsletter forms use HubSpot; the four contact forms use `mailto`. A page that
carries its own HubSpot form suppresses the footer copy via a `:has()` rule in
`globals.css`, because two instances of one form on a page is redundant and HubSpot
only populates the first.

Forms render on a solid white card on purpose. Section themes range from cream to
deep purple, and HubSpot's own labels live inside an iframe we cannot restyle, so a
fixed light surface is the only way to guarantee the fields are readable. If you touch
`SiteFooter.tsx`, render every block type present: filtering to images and text is
exactly how this form went missing once already.

## Changing the app itself

**Read [DESIGN.md](DESIGN.md) first for anything visual.** It records the palette,
type scale, section themes, button variants and grid — all measured from the live
Squarespace site rather than chosen. Inferring a value that looks right is how the
migration lost four headings and every outlined button.

### Where things live

| To change                             | Edit                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- |
| Colours, fonts, spacing, prose styles | `src/app/globals.css` (`@theme` block) — see [DESIGN.md](DESIGN.md)       |
| How a block renders                   | `src/components/BlockRenderer.tsx`                                        |
| Header / navigation                   | `src/components/SiteHeader.tsx` (nav items come from `content/site.json`) |
| Footer                                | `src/components/SiteFooter.tsx`                                           |
| Blog index cards                      | `src/components/PostList.tsx`                                             |
| Post page layout                      | `src/app/[...slug]/page.tsx`                                              |
| Homepage                              | `src/app/page.tsx` (content from `content/pages/index.json`)              |
| Loading content                       | `src/lib/content.ts`                                                      |
| Page titles, Open Graph               | `src/app/layout.tsx` and `generateMetadata` in `[...slug]/page.tsx`       |

### Add a new block type

Three files, all of them:

1. `src/lib/content.ts` — add it to the `Block` union.
2. `src/components/BlockRenderer.tsx` — add a `case` to `BlockView`.
3. `scripts/validate-content.mjs` — add it to the `block` discriminated union.

Miss step 3 and `npm run validate` rejects content that is actually fine. Miss step 2
and the block renders as a red warning box in development and nothing in production.

### Add a new page

Add a file to `content/pages/`. No routing change is needed — the catch-all route in
`src/app/[...slug]/page.tsx` enumerates `content/` at build time. Add it to
`content/site.json`'s `nav` if it should appear in the header.

### Colours and fonts

The palette is defined once in the `@theme` block of `src/app/globals.css`, which is
where Tailwind generates utilities from. Adding `--color-sand: #e8e0d0` there gives
you `bg-sand`, `text-sand` and `border-sand` everywhere.

## Before you open a pull request

```bash
npm run check    # validate + typecheck + build + verify
```

That runs exactly what CI runs, in the same order. Every check below exists
because the failure it catches actually shipped — this project's failure modes
are quiet rather than loud, and a green build means very little on its own.

**Before the build** (`npm run validate`, no browser needed):

- `validate-content.mjs` — schema, missing images, duplicate `urlPath`, slug/filename
  mismatch, unparsable dates.
- `check-media.mjs` — every `/media/...` reference resolves, nothing is zero bytes,
  nothing has drifted back to a Squarespace URL.
- `check-contrast.mjs` — no section theme paints its text in its own background
  colour. That bug shipped three times: the content was in the DOM, the build was
  green, and the words were invisible.

**After the build** (`npm run verify`, reads `out/`):

- `check-third-party.mjs` — no page contacts a third party before the reader asks.
  This is what makes "no cookie banner" true, and it is one `<iframe>` in a
  Markdown post away from being false. Origins that genuinely must load on view go
  in `ALLOWED` in that script, with the reason.
- `check-links.mjs` — every internal link resolves, and every page is reachable
  from `/`. Next prerenders a link to a page that does not exist, and has no
  opinion at all about a page nothing links to; eleven of those accumulated before
  anybody looked.
- `check-a11y.mjs` — axe-core, WCAG 2.1 AA, every page at 390px and 1280px.
  Needs Chromium: `npx playwright install chromium`.

**Not in CI, run by hand:**

- `scripts/compare-content.mjs` — needs the Squarespace snapshots in `archive/raw/`,
  which are not committed, and it answers a migration question ("does this still
  match the 2026 original?"). Once content is edited on purpose, diverging is
  correct.
- `scripts/audit-pages.mjs` — a report, not a gate.
- A visual pass. None of the above sees that a section collapsed around its grid,
  or that a wedge is the wrong colour. Build, serve `out/`, and look at more than
  one width.

A green `next build` on its own does **not** mean the change is correct. It will
happily prerender a page with a broken image and an unrecognised block.

## Things that will bite you

- **The site is a static export.** No server. No API routes, no `getServerSideProps`,
  no runtime environment variables, no `next/image` optimisation. If a change needs a
  server, it does not belong here.
- **Content is trusted input.** `renderMarkdown` and the `embed` block do not sanitise
  HTML, deliberately — the site depends on third-party `<iframe>` embeds. Treat
  `content/` as code and review it like code. Never point those renderers at anything
  submitted by a visitor.
- **Forms need an endpoint.** A form whose Squarespace id has no `deploybaseFormId` in
  `content/forms.json` renders a visible "not connected" notice instead of a submit
  button. That is intentional: a form that silently discards messages is worse than one
  that admits it is not wired up.
- **Tailwind v4 generates utilities from `@theme`.** Use `bg-purple`, not
  `bg-[--color-purple]` — the latter is valid CSS-looking nonsense that silently does
  nothing.
- **Squarespace assets are gone-on-cancel.** If you ever see an
  `images.squarespace-cdn.com` URL creep back into `content/`, run
  `npm run extract:assets` while the subscription is still live.

## Regenerating from Squarespace

`scripts/extract.mjs` still works while the Squarespace site is up:

```bash
npm run extract:fetch    # snapshot every URL in the sitemap
npm run content          # parse -> assets -> documents -> measure:posts
```

**Run `npm run content`, not `extract:parse` on its own.** Parsing rewrites
`content/pages/*.json` from the snapshots, which discards three things later
stages put there, and each stage depends on the one before it:

| Stage            | Adds                                 | Why the order matters               |
| ---------------- | ------------------------------------ | ----------------------------------- |
| `extract:parse`  | pages and collections                | Overwrites everything below         |
| `extract:assets` | local `/media/` paths                | Later stages look for files on disk |
| `documents`      | local `/files/*.pdf` for Drive links | Needs the parsed document blocks    |
| `measure:posts`  | post thumbnail dimensions            | Only sees images already localised  |

Skip a stage and the failure is quiet: PDFs silently revert to Google Drive
iframes, or the blog index goes back to cropping every thumbnail.

It writes `archive/report.json` listing anything it could not map. Read that rather
than assuming a clean run: an empty result there means "nothing was recorded", which
is not the same as "nothing was missed".

### What cannot be scraped

Two things are rendered by Squarespace's own JavaScript, so the HTML snapshots in
`archive/raw/` do not contain them. Both are **measured from the live site and
committed**, because after the subscription lapses there is nowhere left to read
them from:

- **`archive/dividers.json`** — the clip-path for each section divider. The
  markup ships `d="M0,0"` and the real shape is computed in the browser.
  Re-read with `npm run capture:dividers` (needs Playwright).
- **Form fields** are the opposite case: the served `<div class="form-wrapper">`
  is empty, but the definitions survive in a `script.sqs-form-block-context`
  JSON island, so the extractor reads them offline. Note that one config field
  can render as several inputs — `name` becomes First and Last, and an `email`
  field with `mailingList: true` also renders the "Sign up for news and updates"
  tick.

### Third-party embeds

Nothing third-party loads until the reader asks for it. That is why the site
ships no cookie banner, and it only stays true if every route into the page is
covered. There are three:

| Where the embed lives | Gated by | Example |
| --- | --- | --- |
| An `embed` block with a cross-origin `<iframe>` | `BlockView` → `ConsentEmbed` | SenseMaker collector on `/dashboard` |
| An `embed` block with a cross-origin `<script src>` | `BlockView` → `ConsentEmbed` | Elfsight feed on `/home-2`, Dialogflow on `/eurosensers` |
| An `<iframe>` written inline in a post's markdown | `GatedHtml` → `ConsentEmbed` | Drive recordings, Google Slides and Kumu maps under `/resources/multimedia/` |

The third one is easy to forget: post bodies render through `renderMarkdown`,
not `BlockView`, so they bypassed the block-level gate entirely and five pages
kept setting Google cookies after the rest of the site had stopped.

`ConsentEmbed` names what is behind the placeholder using `describeEmbed` in
`src/lib/embedKind.ts`. Add a case there when a new provider appears — the
fallback says only "Embedded content", which is not enough for a reader to
decide. The choice is not remembered, deliberately: persisting it would
reintroduce the browser storage the gate exists to avoid.

Two related rules:

- **Do not add `<link rel="preconnect">` for a third party.** It sends no request
  and sets no cookie, but it completes DNS and a TLS handshake, which hands the
  visitor's address to that origin on page load and makes the gate a formality.
  `src/app/layout.tsx` carried six of these and says so.
- **Prefer vendoring over gating** where the asset is small and static. The
  charting libraries and the Highmaps Europe topology are copied into
  `public/dashboard-app/vendor/` by `npm run vendor:dashboard`, so they need no
  gate at all. Videos are the opposite case — ~36 MB each, so they stay remote
  and gated.

After changing any embed, rebuild and check that no page has an active
third-party tag:

```bash
npm run build && npm run third-party
```

`scripts/check-third-party.mjs` fails on any page that would contact a third
party on load, and CI runs it. The one allowed origin is `eurosense.github.io` —
our own data host, inside our own iframe — and it is listed in that script with
the reason. Adding to that list weakens the promise, so prefer vendoring the
asset or gating it.

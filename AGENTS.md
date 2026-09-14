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

## Changing the app itself

### Where things live

| To change | Edit |
| --- | --- |
| Colours, fonts, spacing, prose styles | `src/app/globals.css` (`@theme` block) |
| How a block renders | `src/components/BlockRenderer.tsx` |
| Header / navigation | `src/components/SiteHeader.tsx` (nav items come from `content/site.json`) |
| Footer | `src/components/SiteFooter.tsx` |
| Blog index cards | `src/components/PostList.tsx` |
| Post page layout | `src/app/[...slug]/page.tsx` |
| Homepage | `src/app/page.tsx` (content from `content/pages/index.json`) |
| Loading content | `src/lib/content.ts` |
| Page titles, Open Graph | `src/app/layout.tsx` and `generateMetadata` in `[...slug]/page.tsx` |

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
npm run check    # validate + typecheck + build
```

That runs the same three things CI does. Run it. The two validators exist because
this project's failure modes are quiet rather than loud:

- `validate-content.mjs` — schema, missing images, duplicate `urlPath`, slug/filename
  mismatch, unparsable dates.
- `check-media.mjs` — every `/media/...` reference resolves, nothing is zero bytes,
  nothing has drifted back to a Squarespace URL.

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
npm run extract:parse    # snapshots -> content/
npm run extract:assets   # CDN -> public/media/, rewrites references
```

It writes `archive/report.json` listing anything it could not map. Read that rather
than assuming a clean run: an empty result there means "nothing was recorded", which
is not the same as "nothing was missed".

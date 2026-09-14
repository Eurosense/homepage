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
    { "blocks": [{ "type": "richText", "markdown": "## A heading\n\nSome text." }] }
  ]
}
```

Block types: `richText`, `image`, `button`, `video`, `embed`, `form`, `quote`,
`divider`, `accordion`, `gallery`, `summary-v2`, `instagram`. They are defined as a
union in `src/lib/content.ts` — that type is the source of truth, and adding a block
type means handling it in `src/components/BlockRenderer.tsx` too.

`urlPath` determines the URL. A file whose `urlPath` is `/about-us` is served at
`/about-us/`, regardless of the filename.

### Add an image

Put the file in `public/media/` and reference it as `/media/<filename>`. Then run
`npm run optimise:media`, which re-encodes anything oversized in place.

## Before you open a pull request

```bash
npm run typecheck
npm run build
node scripts/check-media.mjs
```

`check-media.mjs` is the one that matters most: `next build` will happily prerender
an `<img>` whose file is missing, so only this catches a broken asset reference.

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

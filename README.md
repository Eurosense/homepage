# eurosense.eu

The EuroSense website, migrated off Squarespace to a static React (Next.js) site.

Hosted on [deploybase](https://deploybase.eu) — EU infrastructure, built from this
repository on every push.

## Why this repo exists

The Squarespace subscription is ending. Everything the site needs to survive that —
page content, blog posts, and **every image** — now lives in this repository rather
than on Squarespace's servers.

## Layout

```
content/            Site content. Safe to edit by hand or by an AI agent.
  site.json         Logo, favicon, primary navigation, footer blocks.
  pages/*.json      One file per page, as an ordered list of sections + blocks.
  blognews/*.md     Blog & News posts (Markdown + YAML front matter).
  blog/*.md         Legacy blog collection.
  resources--multimedia/*.md
public/media/       Every image, downloaded from Squarespace. Referenced as /media/...
scripts/extract.mjs One-time migration tool (see below).
archive/            Migration provenance: report.json, assets.json, raw snapshots.
```

## Editing content

Content is plain files, so an agent or a human can change it through a normal pull
request. No CMS, no login.

- **A blog post** is a Markdown file in `content/blognews/`. The YAML front matter
  carries `title`, `date`, `excerpt`, `image`, `tags`. The body is Markdown.
- **A page** is a JSON file in `content/pages/`, shaped as `sections[] -> blocks[]`.
  Block types: `richText`, `image`, `button`, `video`, `embed`, `form`, `quote`,
  `divider`, `accordion`, `gallery`, `summary-v2`.
- **Images** go in `public/media/` and are referenced as `/media/<file>`.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static export -> out/
npm run typecheck
```

## The migration tool

`scripts/extract.mjs` pulled the original site down. It is kept for provenance and
so the extraction can be re-run while Squarespace is still live.

```bash
npm run extract:fetch    # sitemap -> archive/raw/  (HTML + JSON snapshots)
npm run extract:parse    # raw snapshots -> content/
npm run extract:assets   # Squarespace CDN -> public/media/, rewrites references
```

It writes `archive/report.json` listing anything it could not map, so gaps are
visible rather than silent. Two behaviours worth knowing if you re-run it:

- Assets are requested with `Accept: image/*`. With `*/*` the Squarespace CDN
  returns WebP bytes for every URL, including `.png` and `.ico` ones.
- `archive/assets.json` maps source URL to local filename, so re-runs do not
  re-download.

## Migration status

- [x] Content and assets extracted from Squarespace (26 pages, 18 posts, 88 images)
- [ ] React site rendering that content
- [ ] Forms moved off Squarespace
- [ ] Redirects for changed URLs
- [ ] Deployed to deploybase, domain cut over

## Before the Squarespace subscription lapses

1. **Transfer the domain.** `eurosense.eu` is registered through Tucows, the
   registrar behind Squarespace domains. Unlock it and transfer it to a registrar
   you control *before* cancelling, or the domain can be lost with the account.
2. **Export form submissions.** Anything collected by Squarespace form blocks is
   deleted with the account and is not part of this repository.
3. **Keep the account alive** until the new site is live and the DNS has cut over.

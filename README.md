# eurosense.eu

The EuroSense website: a static React (Next.js) site, migrated off Squarespace and
deployed to [deploybase](https://deploybase.eu) on European infrastructure.

Content lives in this repository as plain files, so it can be edited through a pull
request by a person or an agent. See [AGENTS.md](AGENTS.md) for the editing guide.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm run check      # typecheck + static export
```

## Layout

```
content/              All site content.
  site.json           Logo, favicon, navigation, footer.
  forms.json          Squarespace form id -> deploybase endpoint.
  pages/*.json        One file per page: sections of blocks.
  blognews/*.md       Blog & News posts (9).
  blog/*.md           Legacy blog collection (4).
  resources--multimedia/*.md   Multimedia items (5).
public/media/         Every image, downloaded from Squarespace (88 files).
src/app/              Routes. A catch-all prerenders every page and post.
src/components/       Block renderer, header, footer, forms, accordion.
src/lib/              Content loading, markdown, fonts, form endpoints.
scripts/              Migration and maintenance tooling.
archive/              Migration provenance: report.json, assets.json.
```

## Why it is built this way

**Static export.** deploybase serves static files and does not run server code, so
`next.config.ts` sets `output: 'export'` and `images.unoptimized`. There is no server
at runtime: every page is prerendered at build time from `content/`.

**Content as files.** Posts are Markdown with YAML front matter; pages are JSON
sections of typed blocks. Both are diffable and reviewable, which is what makes an
agent-authored change safe to merge.

**Self-hosted fonts.** Satoshi and Roboto were served by Squarespace. Satoshi is now
fetched from Fontshare by `npm run fonts` and committed; Roboto is self-hosted by
`next/font`. No third-party font requests at runtime.

## Deploying

The site builds to a static `out/` directory.

| deploybase setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Output directory | `out` |
| Node version | 22 |
| Install command | `npm ci` |

Connect this repository under **Projects → Connect a repo**. Pushes to `main` go to
production; every other branch gets a preview URL.

### One caveat worth knowing

Next emits `out/404.html`, and deploybase serves that as the fallback for unmatched
paths with **status 200** — a soft 404. That keeps the branded 404 page but means a
search engine can index a nonexistent URL as a real page. It is a deliberate trade:
drop `404.html` from the output if you would rather have a hard 404 from the CDN.

## Maintenance scripts

```bash
npm run fonts            # re-fetch Satoshi from Fontshare
npm run optimise:media   # re-encode oversized images in place (idempotent)
node scripts/check-media.mjs   # fail if content references a missing asset
```

`scripts/extract.mjs` pulled the original site down and still runs while Squarespace
is live — see [AGENTS.md](AGENTS.md#regenerating-from-squarespace). Two behaviours
worth knowing if you re-run it:

- Assets are requested with `Accept: image/*`. With `*/*` the Squarespace CDN
  content-negotiates every asset to WebP, so URLs ending `.png` and `.ico` return
  WebP bytes under the wrong extension.
- `archive/assets.json` maps source URL to local filename so re-runs skip downloads.

## Migration status

- [x] Content and assets extracted (26 pages, 18 posts, 88 images, 0 Squarespace refs)
- [x] React site rendering all of it, 46 prerendered routes
- [x] Images optimised (54 MB → 14 MB)
- [x] Sitemap, robots, metadata, skip link, accessible accordions
- [ ] **Forms connected** — `content/forms.json` still has six `null` endpoints
- [ ] deploybase project created and domain pointed at it
- [ ] Squarespace cancelled

## Before cancelling Squarespace

These are not code tasks and they are not reversible.

1. **Transfer the domain first.** `eurosense.eu` is registered through **Tucows**, the
   registrar behind Squarespace domains. If it came with the subscription it can be
   lost when the account closes. Unlock it and move it to a registrar you control
   *before* cancelling.
2. **Export form submissions.** Anything collected by the six Squarespace form blocks
   is deleted with the account and is not in this repository.
3. **Connect the new forms.** Create each form in the deploybase dashboard and paste
   its id into `content/forms.json`. Until then those forms show a "not connected"
   notice rather than accepting messages.
4. **Keep Squarespace alive** until DNS has cut over and the new site is verified.

## Known gaps

Recorded rather than hidden, so nobody mistakes them for finished work.

- **Six forms are not connected.** See above.
- **Three footer links are plain text** on the live Squarespace site — Dashboard,
  Volt Europa 2026 and Privacy Policy have no `href`. Reproduced as-is rather than
  guessed at; say where they should point and they can be linked.
- **No social links.** The extractor found none in the header or footer. That is an
  absence of evidence in the source, not a verified "there are none".
- **Empty listing pages.** `/events`, `/store` and `/resources/multimedia` had no
  items or products on Squarespace and render empty here too.
- **Placeholder content is carried over.** `/blog` still contains "Blog Post Title
  Two/Three/Four", and the sitemap's duplicate pages (`/home`, `/about`, `/vision-1`,
  `/new-page`) were migrated because the brief was to keep everything. They can be
  deleted by removing their files from `content/pages/`.
- **No automated tests.** `check-media.mjs` guards asset integrity in CI; there is no
  component or end-to-end suite.

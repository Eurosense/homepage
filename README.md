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
public/media/         Every image, downloaded from Squarespace (90 files).
public/files/         Uploaded downloads: the analysis report PDF, the open dataset.
public/dashboard-app/ The EuroSense charts dashboard, vendored (see below).
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

**Layout is reproduced, not reinterpreted.** Squarespace positions blocks on a
fluid-engine CSS grid — 8 columns under 768px, 24 above — and emits a `grid-area`
per block for each. The extractor captures both and `FluidSection` replays them, so
the rebuilt pages match the original at every width rather than only where a
hand-written breakpoint happens to land. Section colours come from the six
Squarespace section themes, measured from the live site.

**Self-hosted fonts.** Satoshi and Roboto were served by Squarespace. Satoshi is now
fetched from Fontshare by `npm run fonts` and committed; Roboto is self-hosted by
`next/font`. No third-party font requests at runtime.

## The dashboard

`/dashboard` embeds the EuroSense charts app. It used to be an iframe to
`medibunny.github.io/Eurosense`, which cost a DNS lookup, a TLS handshake and a
cross-origin fetch of a 1.6 MB CSV before anything rendered. The app is now vendored
into `public/dashboard-app/` and served from this origin, along with the Highcharts
Europe map data it used to fetch from a CDN.

The chart libraries (Highcharts, ECharts, Plotly, PapaParse) still come from their
CDNs; `src/app/layout.tsx` preconnects to them so DNS and TLS overlap the rest of the
page load instead of running serially once the iframe starts parsing.

### Keeping its data fresh

`.github/workflows/dashboard-data.yml` refreshes `captures.csv` from the SenseMaker
API every night at 03:00 UTC and **publishes it to GitHub Pages** at
`https://eurosense.github.io/homepage/captures.csv`.

Publishing rather than committing keeps data off the site's deploy path: new
captures reach the dashboard without a commit to `main`, so a daily refresh costs
GitHub Actions minutes instead of deploybase build minutes. The dashboard fetches
that copy first and falls back to the one committed at
`public/dashboard-app/captures.csv`, which keeps it working offline, on a preview
build, and if Pages is unreachable.

The request carries a `?d=YYYY-MM-DD` key so the file caches normally within a day
and the URL changes when the data does. That is a cache key rather than a cache
buster: fetching with `no-cache` would revalidate against GitHub on every view of
the dashboard just to be told the file is unchanged.

Run it by hand from the Actions tab, or locally:

```bash
SENSEMAKER_PAT_ID=... SENSEMAKER_FRAMEWORK=... npm run dashboard:data
```

It needs two repository secrets (Settings -> Secrets and variables -> Actions):

| Secret | What it is |
| --- | --- |
| `SENSEMAKER_PAT_ID` | Personal access token id, exchanged for a short-lived bearer token |
| `SENSEMAKER_FRAMEWORK` | The framework (project) whose captures are exported |

**Until those secrets exist the workflow fails, visibly, in the Actions tab.** That is
deliberate: the job this replaces lived in `Medibunny/Eurosense` and stopped running in
April 2025 without anyone noticing — GitHub disables scheduled workflows after 60 days
of repository inactivity. Between then and the migration, 764 citizen stories were
collected that the dashboard never showed.

The script refuses to write a response that is not a captures export, or one that has
lost more than half its rows, so an auth failure or a gateway error cannot silently
blank the dashboard.

> **Rotate the SenseMaker token.** The previous job hardcoded the personal access
> token id in `Medibunny/Eurosense`, which is a public repository. Anyone who reads it
> can exchange it for a bearer token and pull the framework's captures. Issue a new
> token, put it in the secret above, and revoke the old one.

## Deploying

Production is [deploybase](https://deploybase.eu), currently serving at
`homepage.sites.deploybase.eu`. The site builds to a static `out/` directory.

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

- [x] Content and assets extracted (26 pages, 18 posts, 90 images, 0 Squarespace refs)
- [x] React site rendering all of it, 46 prerendered routes
- [x] Images optimised (54 MB → 14 MB)
- [x] Sitemap, robots, metadata, skip link, accessible accordions
- [x] Layout parity: fluid-engine grid, section themes, measured type scale
- [x] Responsive sweep clean: 14 pages x 13 widths (320-1920px), no overflow
- [x] HubSpot newsletter (footer, every page) carried over and rendering
- [x] Uploaded files rescued: report PDF, open dataset, project PDF
- [x] All internal links resolve; external links checked
- [x] Dashboard vendored in-repo and served same-origin
- [x] Publications and storyboards embed their PDFs inline
- [x] Newsletter forms now use the existing HubSpot form
- [x] Dashboard data refresh migrated in-repo, published to Pages (1,986 -> 2,750 rows)
- [x] All six forms handled: two newsletters via HubSpot, four contact forms via
      `mailto:` to voltsense@volteuropa.org — no backend to run
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
3. **Forms need nothing.** The two newsletter forms use the existing HubSpot form;
   the four contact forms open the visitor's mail client addressed to
   voltsense@volteuropa.org. Neither depends on Squarespace. If you would rather
   store contact submissions than receive them as email, switch a form's `provider`
   to `deploybase` in `content/forms.json` and add the endpoint.
4. **Keep Squarespace alive** until DNS has cut over and the new site is verified.

## Known gaps

Recorded rather than hidden, so nobody mistakes them for finished work.

- **Six forms are not connected.** See above.
- **`/home-2` is an abandoned earlier homepage.** Heading "Welcome to EuroSense.",
  8 sections against the live homepage's 12, and nothing links to it — it survives
  only because it is in the sitemap. Delete `content/pages/home-2.json` when you are
  sure, along with its entry in `content/forms.json`.
- **Two links are broken on the current Squarespace site**, and are reproduced
  as-is rather than silently repaired:
  `edpb.europa.eu/about-edpb/board/members_en` (redirects to a 404, on
  `/privacy-policy`) and `http://charge.volt.org` (domain does not resolve, on
  `/our-partners`, `/storyboards` and `/new-page`). The working address for the
  latter appears elsewhere on the site as `https://www.charge-volt.org/`.
- **Layout parity is close but not total.** On the homepage, 7 of 12 sections match
  the original's rendered height exactly. Two of the remaining five are the list
  sections (partner logos, article teasers), which are rebuilt as our own components
  rather than reproduced; the hero is 114px shorter and one mid-page section 173px
  shorter, both because content inside a grid cell measures slightly differently.
  Nothing is missing — the deltas are vertical whitespace.
- **Empty listing pages.** `/events`, `/store` and `/resources/multimedia` had no
  items or products on Squarespace and render empty here too.
- **Placeholder content is carried over.** `/blog` still contains "Blog Post Title
  Two/Three/Four", and the sitemap's duplicate pages (`/home`, `/about`, `/vision-1`,
  `/new-page`) were migrated because the brief was to keep everything. They can be
  deleted by removing their files from `content/pages/`.
- **No automated tests.** `check-media.mjs` guards asset integrity in CI; there is no
  component or end-to-end suite.

#!/usr/bin/env node
/**
 * Squarespace -> local content extractor for eurosense.eu
 *
 * Runs in three stages so each can be re-run independently:
 *
 *   fetch   sitemap.xml -> archive/raw/pages/*.html + archive/raw/json/*.json
 *   parse   raw snapshots -> content/pages/*.json + content/<collection>/*.md
 *   assets  every Squarespace CDN URL referenced by content -> public/media/*
 *
 * The `assets` stage is the reason this script exists. Squarespace serves every
 * image from images.squarespace-cdn.com, and those URLs stop resolving when the
 * subscription lapses. Content without assets is not a migration.
 *
 * Design rule: never silently drop content. Anything this script cannot map is
 * recorded in archive/report.json under `unknownBlocks` / `failures` so the gap
 * is visible rather than looking like a clean run.
 */

import { mkdir, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as cheerio from 'cheerio'
import TurndownService from 'turndown'

const ORIGIN = 'https://www.eurosense.eu'
const ROOT = path.resolve(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'archive', 'raw')
const RAW_PAGES = path.join(RAW, 'pages')
const RAW_JSON = path.join(RAW, 'json')
const CONTENT = path.join(ROOT, 'content')
const MEDIA = path.join(ROOT, 'public', 'media')
const FILES = path.join(ROOT, 'public', 'files')

/** Collections whose items are fetched via the JSON API instead of scraped. */
const COLLECTIONS = ['blognews', 'blog', 'events', 'resources/multimedia']

/*
 * Section-divider shapes, measured from the live site by scripts/capture-dividers.mjs.
 *
 * These cannot be scraped: Squarespace ships `d="M0,0"` in the HTML and computes
 * the real clip path in the browser, so the snapshots in archive/raw/ do not
 * contain the shape. The file is committed because once the subscription lapses
 * there is nowhere left to measure it from.
 */
const dividerShapes = existsSync(path.join(ROOT, 'archive', 'dividers.json'))
  ? JSON.parse(readFileSync(path.join(ROOT, 'archive', 'dividers.json'), 'utf8'))
  : {}

/** Written by scripts/fetch-videos.mjs; maps a Squarespace video id to a local file. */
const videoManifest = existsSync(path.join(ROOT, 'archive', 'videos.json'))
  ? JSON.parse(readFileSync(path.join(ROOT, 'archive', 'videos.json'), 'utf8'))
  : {}

const report = {
  generatedAt: new Date().toISOString(),
  origin: ORIGIN,
  pages: [],
  collections: [],
  assets: { downloaded: 0, reused: 0, failed: [] },
  unknownBlocks: [],
  failures: [],
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Fetch with retry. Squarespace rate-limits aggressively on burst crawls. */
async function get(url, { binary = false, retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'eurosense-migration/1.0 (+site owner, one-time archive)',
          // `image/*` matters: with `*/*` the Squarespace CDN content-negotiates
          // every asset to WebP, so a URL ending .png (or .ico) returns WebP
          // bytes under the wrong extension. Asking for image/* returns the
          // original upload.
          Accept: binary ? 'image/*,*/*;q=0.8' : 'text/html,application/json',
        },
        redirect: 'follow',
      })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) return { ok: false, status: res.status }
      return binary
        ? {
            ok: true,
            status: res.status,
            contentType: (res.headers.get('content-type') || '').split(';')[0].trim(),
            buffer: Buffer.from(await res.arrayBuffer()),
          }
        : { ok: true, status: res.status, text: await res.text() }
    } catch (err) {
      if (attempt === retries) return { ok: false, error: String(err) }
      await sleep(600 * attempt)
    }
  }
}

/** Bounded-concurrency map. Keeps the crawl under Squarespace's rate limit. */
async function pool(items, limit, fn) {
  const out = []
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * "/" must not collapse onto "/home" — the site has both, with different
 * content, and a shared slug silently overwrites one snapshot with the other.
 */
const slugify = (urlPath) => urlPath.replace(/^\/+|\/+$/g, '').replace(/\//g, '--') || 'index'

/** Minimal YAML front matter emitter — scalars, arrays and flat objects only. */
function toFrontMatter(obj) {
  const esc = (v) => {
    const s = String(v)
    return /^[\w\s.,:@/\-+()']*$/.test(s) && !/^[\s]|[\s]$|: |^-/.test(s)
      ? s
      : JSON.stringify(s)
  }
  const lines = ['---']
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      if (!v.length) continue
      lines.push(`${k}:`)
      v.forEach((item) => lines.push(`  - ${esc(item)}`))
    } else if (typeof v === 'object') {
      lines.push(`${k}:`)
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 === undefined || v2 === null || v2 === '') continue
        lines.push(`  ${k2}: ${esc(v2)}`)
      }
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      lines.push(`${k}: ${v}`)
    } else {
      lines.push(`${k}: ${esc(v)}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
})
// Preserve iframes/embeds verbatim — they are third-party apps, not prose.
turndown.addRule('keepEmbeds', {
  filter: ['iframe', 'script', 'form'],
  replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
})

/**
 * Convert Squarespace rich text to Markdown.
 *
 * `<style>` is stripped first: Squarespace inlines per-block tweak CSS next to
 * the prose, and Turndown would otherwise emit it as body text. Iframes survive
 * (see keepEmbeds) because third-party embeds are real content here.
 */
function htmlToMarkdown(html) {
  if (!html) return ''
  const $ = cheerio.load(`<div id="__root">${html}</div>`)
  $('style, noscript').remove()
  return turndown.turndown($('#__root').html() || '').trim()
}

/*
 * Embeds we now serve ourselves. The Eurosense dashboard used to be an iframe to
 * medibunny.github.io, which costs a DNS lookup, TLS handshake and cross-origin
 * fetch of a 1.6 MB CSV before anything renders. The same app is vendored into
 * public/dashboard-app/, so pointing at it locally keeps the page identical and
 * removes the round trip. See README for how its data is refreshed.
 */
const EMBED_REWRITES = [
  [/https?:\/\/medibunny\.github\.io\/Eurosense\/?/g, '/dashboard-app/'],
  /*
   * The /eurosensers map pulls Highmaps from Highcharts' CDN. That is a
   * third-party connection on page load, and the identical file is already
   * vendored for the dashboard by scripts/vendor-dashboard-libs.mjs, so point
   * the embed at that copy. Rewriting it here rather than in content/pages/
   * matters: extract:parse regenerates those files and would drop a hand edit.
   */
  [
    /https?:\/\/code\.highcharts\.com\/maps\/highmaps\.js/g,
    '/dashboard-app/vendor/highmaps.js',
  ],
  [
    /https?:\/\/code\.highcharts\.com\/mapdata\/custom\/europe\.topo\.json/g,
    '/dashboard-app/vendor/europe.topo.json',
  ],
]

function rewriteEmbedUrls(html) {
  return EMBED_REWRITES.reduce((acc, [from, to]) => acc.replace(from, to), html)
}

/*
 * Google Drive is linked in several shapes on this site. Sharing a file gives
 * `/file/d/{id}/view`, but the "Download" affordance next to it produces
 * `drive.usercontent.google.com/download?id={id}`, and older links use
 * `uc?id=`. Matching only the first shape left one publication as prose while
 * its neighbours became embedded viewers.
 */
function driveIdFrom(href) {
  return (
    href.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] ??
    href.match(
      /drive(?:\.usercontent)?\.google\.com\/(?:uc|open|download)\?[^#]*\bid=([A-Za-z0-9_-]+)/,
    )?.[1]
  )
}

const DOC_LINK_RE = /\.pdf($|[?#])|\.xlsx($|[?#])/i

function isDocumentLink(href) {
  return Boolean(driveIdFrom(href)) || DOC_LINK_RE.test(href)
}

/**
 * Turns a short "Title + Download" rich-text block into a `document` block so
 * the file can be previewed in place rather than only linked out to.
 *
 * Deliberately conservative: it only fires when the block is short and every
 * document link in it points at the same file. A long paragraph that happens to
 * cite a PDF stays prose, because replacing it with a viewer would lose the
 * surrounding text.
 */
function asDocumentBlock(html) {
  const $ = cheerio.load(`<div id="__root">${html}</div>`)
  const text = $('#__root').text().replace(/\s+/g, ' ').trim()
  if (!text || text.length > 200) return null

  const links = $('#__root a[href]')
    .map((_i, a) => $(a).attr('href'))
    .get()
    .filter(isDocumentLink)
  if (!links.length) return null

  // Compare by document identity, not raw URL: the same Drive file is often
  // linked twice on one line, once bare and once with ?usp=drive_link, and the
  // download URL for a file is a different URL for the same document.
  const identity = (href) => driveIdFrom(href) ?? href.split('?')[0]
  const unique = [...new Set(links.map(identity))]
  if (unique.length !== 1) return null

  // Prefer the shareable URL over a direct-download one so the viewer can frame it.
  const href = links.find((l) => /\/file\/d\//.test(l)) ?? links[0]
  const driveId = driveIdFrom(href)

  // The visible title is the text minus the trailing "Download" affordance.
  const title = text
    .replace(/\s*Download\s*$/i, '')
    .replace(/\.$/, '')
    .trim()

  return {
    type: 'document',
    title: title || 'Document',
    href,
    driveId: driveId || undefined,
    kind: driveId ? 'drive' : /\.xlsx($|[?#])/i.test(href) ? 'spreadsheet' : 'pdf',
  }
}

/*
 * Typos in the original that the owner has asked to correct. Applied to rich
 * text as it is extracted, so a re-run does not quietly restore them.
 *
 * Keep this list short and obviously-correct. Anything that changes meaning
 * rather than spelling belongs in content/, as an edit someone can see.
 */
const TEXT_CORRECTIONS = [[/\bdialouge\b/gi, (m) => (m[0] === 'D' ? 'Dialogue' : 'dialogue')]]

function applyCorrections(html) {
  return TEXT_CORRECTIONS.reduce((acc, [from, to]) => acc.replace(from, to), html)
}

/** Inline style properties that carry meaning we must not lose. */
const KEEP_STYLE = new Set(['text-align', 'color', 'white-space', 'font-style'])

/**
 * Cleans a Squarespace rich-text block, keeping it as HTML.
 *
 * Markdown was the obvious choice and the wrong one: this content carries
 * `text-align:center` on headings and `<span style="color:#123BC8">` runs, and
 * Markdown can express neither. Converting lost the centring and the two-tone
 * headings on every page. Keeping HTML preserves them; the classes below are
 * kept too because the theme layer styles them.
 */
function cleanRichText($el) {
  const html = $el.html()
  if (!html) return ''

  const $ = cheerio.load(`<div id="__root">${html}</div>`)
  $('style, script, noscript').remove()

  $('#__root *').each((_i, el) => {
    const $node = $(el)

    // Keep every `sqsrte-` class, not just the colour ones. `sqsrte-large`
    // marks the paragraphs that scale with the viewport; dropping it rendered
    // every hero subtitle at the fixed 16px body size.
    const classes = ($node.attr('class') || '')
      .split(/\s+/)
      .filter((c) => c.startsWith('sqsrte-'))
    if (classes.length) $node.attr('class', classes.join(' '))
    else $node.removeAttr('class')

    const style = $node.attr('style')
    if (style) {
      const kept = style
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d && KEEP_STYLE.has(d.split(':')[0].trim().toLowerCase()))
      if (kept.length) $node.attr('style', `${kept.join('; ')};`)
      else $node.removeAttr('style')
    }

    for (const attr of ['data-sqsp-text-block-content', 'data-rte-preserve-empty']) {
      $node.removeAttr(attr)
    }
  })

  // The wrapper divs carry nothing once their classes are gone.
  const inner = $('#__root').html() || ''
  const $unwrapped = cheerio.load(`<div id="__root">${inner}</div>`)
  $unwrapped('#__root div').each((_i, el) => {
    const $d = $unwrapped(el)
    if (!$d.attr('class') && !$d.attr('style')) $d.replaceWith($d.html() || '')
  })

  return applyCorrections(($unwrapped('#__root').html() || '').replace(/\s+/g, ' ').trim())
}

/** Strip presentational cruft from HTML we keep verbatim (accordions, galleries). */
function cleanHtml(html) {
  if (!html) return ''
  const $ = cheerio.load(`<div id="__root">${html}</div>`)
  $('style, noscript').remove()
  /*
   * `.sqs-blockStatus` is editor chrome — the "This block has no content yet"
   * box Squarespace shows the author. It is hidden on the live site but there is
   * nothing in the markup that says so, so kept verbatim it rendered that notice
   * to visitors under "Upcoming and past events".
   */
  $('.sqs-blockStatus').remove()
  return ($('#__root').html() || '').trim()
}

// ---------------------------------------------------------------------------
// stage: fetch
// ---------------------------------------------------------------------------

async function readSitemap() {
  const res = await get(`${ORIGIN}/sitemap.xml`)
  if (!res.ok) throw new Error(`sitemap unavailable: ${JSON.stringify(res)}`)
  const urls = [...res.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  // The homepage is not listed in Squarespace sitemaps; add it explicitly.
  const paths = new Set(['/'])
  for (const u of urls) paths.add(new URL(u).pathname)
  await mkdir(RAW, { recursive: true })
  await writeFile(path.join(RAW, 'sitemap.xml'), res.text)
  return [...paths].sort()
}

async function stageFetch() {
  const paths = await readSitemap()
  console.log(`[fetch] ${paths.length} URLs from sitemap`)
  await mkdir(RAW_PAGES, { recursive: true })
  await mkdir(RAW_JSON, { recursive: true })

  await pool(paths, 4, async (p) => {
    const slug = slugify(p)
    const html = await get(`${ORIGIN}${p}`)
    if (html.ok) {
      await writeFile(path.join(RAW_PAGES, `${slug}.html`), html.text)
    } else {
      report.failures.push({ stage: 'fetch', path: p, ...html })
      console.warn(`[fetch] FAILED ${p}`)
      return
    }
    // Always grab the JSON twin: it carries clean metadata even for section pages.
    const json = await get(`${ORIGIN}${p}?format=json`)
    if (json.ok) {
      try {
        JSON.parse(json.text)
        await writeFile(path.join(RAW_JSON, `${slug}.json`), json.text)
      } catch {
        /* some routes return HTML for ?format=json; not fatal */
      }
    }
    await sleep(120)
  })

  await writeFile(path.join(RAW, 'paths.json'), JSON.stringify(paths, null, 2))
  console.log(`[fetch] done -> archive/raw/`)
  return paths
}

// ---------------------------------------------------------------------------
// stage: parse
// ---------------------------------------------------------------------------

/**
 * Block classes we know how to map. Order matters only in that we match against
 * this set rather than "first class ending in -block": Squarespace prefixes
 * blocks with wrappers like `website-component-block`, which would otherwise
 * shadow the real type and silently drop every block on the page.
 */
const BLOCK_KINDS = new Set([
  'html-block',
  'markdown-block',
  'image-block',
  'button-block',
  'video-block',
  'code-block',
  'embed-block',
  'form-block',
  'horizontalrule-block',
  'spacer-block',
  'quote-block',
  'accordion-block',
  'summary-v2-block',
  'gallery-block',
  'instagram-block',
  'social-account-links-block',
  // Not suffixed `-block` like the rest; Squarespace names this one differently.
  'sqs-block-search',
])

/*
 * Squarespace's palette, measured from the live site. Its colour names are
 * inverted and cannot be reasoned about — `--black` is white and `--white` is
 * the cream page background — so these are read values, not guesses.
 */
const SQSP_HSL = {
  black: '0 0% 100%',
  white: '51.43 33.33% 95.88%',
  accent: '273.33 25.71% 27.45%',
  lightAccent: '270.73 41.41% 19.41%',
  darkAccent: '43.98 98.22% 55.88%',
  safeLightAccent: '0 0% 100%',
  safeDarkAccent: '273.33 25.71% 27.45%',
}

/** `hsla(var(--black-hsl), 0.72)` -> a colour a browser can use unaided. */
function resolveSqspColor(value) {
  const themed = value.match(/hsla\(\s*var\(--([a-zA-Z]+)-hsl\)\s*,\s*([\d.]+)\s*\)/)
  if (themed) {
    const hsl = SQSP_HSL[themed[1]]
    return hsl ? `hsl(${hsl} / ${themed[2]})` : null
  }
  // Literal hsla() is already valid CSS.
  return /^hsla?\(/.test(value.trim()) ? value.trim() : null
}

/**
 * The background, corner radius and padding Squarespace paints on a block.
 *
 * Used 39 times across the site — most visibly the white pills behind the
 * numbered steps on the homepage, which without this render as bare digits.
 * The values live in a per-block `<style id="container-styles">`, as custom
 * properties rather than plain declarations.
 */
function blockSurface($, $block) {
  if (!($block.attr('class') || '').split(/\s+/).includes('sqs-background-enabled'))
    return undefined

  const css = $block.find('style#container-styles').html() || ''
  if (!css) return undefined

  const raw = css.match(/--tweak-[a-z-]*background-color:\s*([^;]+);/)?.[1]
  const background = raw ? resolveSqspColor(raw) : null

  const radius = css.match(/--tweak-[a-z-]*-radius:\s*([^;]+);/)?.[1]?.trim()
  const padding = css.match(/--tweak-[a-z-]*-padding:\s*([^;]+);/)?.[1]?.trim()

  const meaningfulRadius = radius && !/^(0px\s*)+$/.test(radius) ? radius : undefined
  if (!background && !meaningfulRadius) return undefined

  return {
    background: background || undefined,
    radius: meaningfulRadius,
    padding: background ? padding : undefined,
  }
}

/** Map a Squarespace block element to our own content model. */
function parseBlock($, el) {
  const $el = $(el)
  const classes = ($el.attr('class') || '').split(/\s+/)

  /*
   * Shape blocks carry no `*-block` class at all, so the class-based lookup
   * below never matched them and they were dropped as "website-component-block"
   * in the unhandled report. They are not decoration: on /resources the three
   * purple panels behind the Publications, Storyboards and Multimedia cards are
   * shape blocks, and without them that page rendered gold text on bare cream.
   */
  if ($el.attr('data-sqsp-block') === 'shape') {
    const $shape = $el.find('[data-shape-name]').first()
    const css = $el.find('style').text()
    const raw = css.match(/--shape-block-background-color:\s*([^;]+);/)?.[1]
    const fill = raw ? resolveSqspColor(raw) : null
    if (!fill) return null

    return { type: 'shape', shape: $shape.attr('data-shape-name') || 'rectangle', fill }
  }

  const kind = classes.find((c) => BLOCK_KINDS.has(c))
  const $content = $el.find('.sqs-block-content').first()
  const inner = $content.length ? $content : $el

  switch (kind) {
    case 'html-block':
    case 'markdown-block': {
      const html = cleanRichText(inner)
      if (!html) return null
      return asDocumentBlock(html) || { type: 'richText', html }
    }
    case 'image-block': {
      const $img = inner.find('img').first()
      const src = $img.attr('data-src') || $img.attr('src')
      if (!src) return null
      const $link = inner.find('a').first()

      // Squarespace records the real pixel size. Using it keeps the rendered
      // aspect ratio identical to the original (a guessed ratio changes the
      // height of the grid row the image sits in) and avoids layout shift.
      const [w, h] = ($img.attr('data-image-dimensions') || '').split('x').map(Number)

      return {
        type: 'image',
        src,
        alt: $img.attr('alt') || '',
        width: Number.isFinite(w) && w > 0 ? w : undefined,
        height: Number.isFinite(h) && h > 0 ? h : undefined,
        caption: htmlToMarkdown(inner.find('.image-caption').html() || ''),
        href: $link.attr('href') || undefined,
      }
    }
    case 'button-block': {
      const $a = inner.find('a').first()
      if (!$a.length) return null
      const $container = inner.find('[data-button-type]').first()
      const alignment = ($container.attr('class') || '').match(
        /sqs-block-button-container--(\w+)/,
      )?.[1]
      return {
        type: 'button',
        label: $a.text().replace(/\s+/g, ' ').trim(),
        href: $a.attr('href') || '#',
        // primary / secondary / tertiary drive completely different colours in
        // the theme, so the variant has to survive the migration.
        variant: $container.attr('data-button-type') || 'primary',
        size: $container.attr('data-button-size') || 'medium',
        alignment: alignment || 'left',
        // `sqs-stretched` makes the button fill its grid cell rather than hug
        // its label, which changes the look substantially on narrow screens.
        stretched: $container.hasClass('sqs-stretched') || undefined,
      }
    }
    case 'video-block': {
      /*
       * Two kinds of video block. A third-party embed has an iframe. A
       * Squarespace-hosted video has neither iframe nor <video>: it is an HLS
       * stream described by a JSON island, played by Squarespace's own script.
       * Looking only for an iframe found nothing and dropped the block, which is
       * how the homepage lost its videos. `npm run videos` downloads them and
       * writes archive/videos.json, which maps the id to a local file.
       */
      const nativeConfig = inner.find('.sqs-native-video').attr('data-config-video')
      if (nativeConfig) {
        let config
        try {
          config = JSON.parse(nativeConfig)
        } catch {
          config = null
        }
        const local = config?.systemDataId ? videoManifest[config.systemDataId] : undefined
        if (!local) {
          report.unknownBlocks.push('video-block (not downloaded — run `npm run videos`)')
          return null
        }
        let settings = {}
        try {
          settings = JSON.parse(
            inner.find('.sqs-native-video').attr('data-config-settings') || '{}',
          )
        } catch {
          settings = {}
        }
        return {
          type: 'video',
          src: local.src,
          poster: local.poster,
          aspectRatio: local.aspectRatio,
          // Squarespace puts the caption in a sibling of the player, so removing
          // the player is not enough — it has to be read out explicitly.
          caption: cleanRichText(inner.find('.video-caption').first()) || undefined,
          autoPlay: Boolean(settings.autoPlay),
          loop: settings.loop !== false,
          muted: Boolean(settings.muted) || Boolean(settings.autoPlay),
        }
      }

      const $iframe = inner.find('iframe').first()
      const src = $iframe.attr('src') || $iframe.attr('data-src') || ''
      if (!src) return null
      return {
        type: 'video',
        src,
        title: $iframe.attr('title') || '',
        caption: cleanRichText(inner.find('.video-caption').first()) || undefined,
      }
    }
    case 'code-block':
    case 'embed-block': {
      const html = (inner.html() || '').trim()
      // Drop blocks Squarespace left behind with nothing in them.
      if (!/<(iframe|script|img|a|video)\b/i.test(html)) return null
      return { type: 'embed', html: rewriteEmbedUrls(html) }
    }
    case 'form-block': {
      // Squarespace renders forms client-side, so the served HTML contains an
      // empty shell. The field definitions are in an embedded JSON island,
      // which is the only place they survive a static snapshot.
      const context = inner.find('script.sqs-form-block-context').first().html()
      if (!context) return null

      let config
      try {
        config = JSON.parse(context)
      } catch {
        report.failures.push({ stage: 'parse', reason: 'unreadable form context' })
        return null
      }

      const TYPES = { name: 'text', email: 'email', textarea: 'textarea', text: 'text' }
      const slug = (label) =>
        String(label)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')

      /*
       * Two config field types render as more than one input, which is why the
       * migrated forms were short of the originals:
       *
       *   `name`  -> First Name and Last Name, not one "Name" box.
       *   `email` with `mailingList: true` -> the email box plus a "Sign up for
       *           news and updates" tick. Losing it on /our-partners meant a
       *           partner enquiry no longer offered to subscribe.
       *
       * The opt-in label is Squarespace's own wording, confirmed against the
       * live page.
       */
      const fields = (config.formFields || []).flatMap((f) => {
        const required = Boolean(f.required)
        const title = String(f.title ?? '')

        if (f.type === 'name') {
          return [
            { label: 'First Name', name: 'first_name', type: 'text', required },
            { label: 'Last Name', name: 'last_name', type: 'text', required },
          ]
        }

        const field = {
          label: title,
          name: slug(title),
          type: TYPES[f.type] || 'text',
          required,
        }

        if (f.type === 'email' && f.mailingList) {
          return [
            field,
            {
              label: 'Sign up for news and updates',
              name: 'mailing_list',
              type: 'checkbox',
              required: false,
            },
          ]
        }

        return [field]
      })

      return {
        type: 'form',
        title: config.formName || '',
        submitLabel: config.formSubmitButtonText || 'Submit',
        formId: config.formId || '',
        fields,
      }
    }
    case 'horizontalrule-block':
      return { type: 'divider' }
    case 'spacer-block':
      return null // pure layout, reproduced by our own spacing scale
    case 'quote-block':
      return {
        type: 'quote',
        text: inner.find('blockquote').text().trim() || inner.text().trim(),
        source: inner.find('figcaption').text().trim(),
      }
    case 'accordion-block': {
      // Squarespace drives the collapse with its own JS. Capturing title/body
      // pairs lets the site render native <details>, which needs no script.
      const items = inner
        .find('li.accordion-item')
        .map((_i, li) => {
          const $li = $(li)
          const $description = $li.find('.accordion-item__description').first()
          return {
            title: $li.find('.accordion-item__title').first().text().trim(),
            markdown: htmlToMarkdown($li.find('.accordion-item__dropdown').first().html()),
            // Squarespace's per-item text-size setting. On /faq every answer is
            // set large, and rendering them at body size left the grid rows the
            // author sized around the larger text half empty.
            large: ($description.attr('class') || '').includes('sqsrte-large') || undefined,
          }
        })
        .get()
        .filter((item) => item.title || item.markdown)

      /*
       * Squarespace can start an accordion with its first answer already open,
       * and the author sized the grid row around that. Rendering every item
       * collapsed left the reserved rows empty — on /faq that was 1595px of
       * blank page between two groups of questions.
       */
      const expandFirst =
        inner.find('[data-is-expanded-first-item="true"]').length > 0 ||
        $el.attr('data-is-expanded-first-item') === 'true'

      return items.length
        ? { type: 'accordion', items, expandFirst: expandFirst || undefined }
        : null
    }
    case 'instagram-block': {
      /*
       * Extract the posts rather than keeping Squarespace's gallery markup.
       * That markup relies on a slideshow script we do not ship, so the images
       * collapsed to a few pixels tall — present, but invisible.
       */
      /*
       * Driven off the images, not the links: the first tile in the feed has no
       * anchor around it, so walking anchors silently dropped one post.
       */
      const posts = inner
        .find('img')
        .map((_i, img) => {
          const $img = $(img)
          const $a = $img.closest('a')
          return {
            href: $a.attr('href') || undefined,
            image: $img.attr('data-src') || $img.attr('src'),
            alt: $img.attr('alt') || '',
          }
        })
        .get()
        .filter((post) => post.image)

      return posts.length ? { type: 'instagram', posts } : null
    }
    case 'sqs-block-search': {
      /*
       * Squarespace's search block queried its own hosted index, which goes away
       * with the subscription. Only the placeholder is worth keeping; the
       * searching itself is reimplemented client-side over the posts we hold.
       */
      const placeholder = inner.find('input[type="search"]').attr('placeholder') || 'Search'
      return { type: 'search', placeholder }
    }
    case 'social-account-links-block': {
      /*
       * The icons are SVG <use> references into a Squarespace sprite sheet, so
       * only the links survive extraction. The label is on the anchor, which is
       * enough to pick an icon on our side.
       */
      const links = inner
        .find('a[href]')
        .map((_i, a) => ({
          // Squarespace stored these as http://; every one of these platforms is
          // HTTPS-only, so the plain-text hop is a redirect and a referrer leak.
          href: ($(a).attr('href') || '').replace(/^http:\/\//i, 'https://'),
          label: $(a).attr('aria-label') || '',
        }))
        .get()
        .filter((link) => link.href && link.label)

      return links.length ? { type: 'socialLinks', links } : null
    }
    case 'summary-v2-block':
    case 'gallery-block': {
      // Structured collections we render ourselves; keep raw so nothing is lost.
      const html = cleanHtml(inner.html())

      /*
       * A summary block bound to an empty collection still ships its own
       * "Featured" header. Squarespace hides the block entirely in that case,
       * and the events collection here has no items — so without this the
       * migrated page showed a stray heading under "Upcoming and past events".
       */
      const hasItems = cheerio.load(html)('.summary-item').length > 0
      if (kind === 'summary-v2-block' && !hasItems) return null

      return { type: kind.replace('-block', ''), html }
    }
    default: {
      // Record the unmapped class so the gap shows up in the report rather than
      // looking like the page simply had no content.
      const unmapped = classes.filter((c) => c.endsWith('-block') && c !== 'sqs-block')
      if (unmapped.length) report.unknownBlocks.push(unmapped.join('+'))
      return null
    }
  }
}

/**
 * Flattens a Squarespace fluid-engine <style> block into rules tagged with the
 * media query they sit under.
 *
 * Brace matching rather than a regex: the same `.fe-block-x` selector appears
 * once at the top level (the mobile layout) and again inside
 * `@media (min-width: 768px)` (the desktop one). A regex sweep cannot tell the
 * two apart, and picking the wrong one silently swaps the layouts.
 */
function flattenCssRules(css, media = null, out = []) {
  let i = 0

  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open === -1) break

    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }

    const prelude = css.slice(i, open).trim()
    const body = css.slice(open + 1, j - 1)

    if (prelude.startsWith('@media')) {
      flattenCssRules(body, prelude.replace(/^@media\s*/, '').trim(), out)
    } else if (prelude) {
      out.push({ selector: prelude, body, media })
    }

    i = j
  }

  return out
}

/**
 * Reads one declaration out of a rule body, ignoring any nested at-rule. Blocks
 * carry an inline `@media (max-width: 767px) { … }` whose declarations would
 * otherwise be mistaken for the rule's own.
 */
function declaration(body, prop) {
  const own = body.replace(/@media[^{]*\{[\s\S]*?\}\s*\}?/g, '')
  return own.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`))?.[1].trim()
}

/** True for the breakpoint Squarespace uses to switch 8 columns to 24. */
const isDesktop = (media) => Boolean(media && /min-width:\s*768px/.test(media))

/**
 * Reads the responsive grid Squarespace generated for one fluid-engine section.
 *
 * Squarespace already solved the responsive problem here: it emits an 8-column
 * mobile grid and a 24-column desktop grid, with a `grid-area` per block for
 * each. Capturing both means the rebuilt site is responsive for the same reason
 * the original was, rather than by re-inventing the breakpoints by eye.
 */
function parseFluidLayout($, $section) {
  const css = $section.find('[data-fluid-engine] style').first().html()
  if (!css) return null

  const rules = flattenCssRules(css)
  const gridId = css.match(/\.(fe-[0-9a-f]{12,})\s*\{/)?.[1]
  if (!gridId) return null

  const container = { mobile: {}, desktop: {} }
  const blocks = new Map()

  for (const rule of rules) {
    const target = isDesktop(rule.media) ? 'desktop' : 'mobile'

    if (rule.selector === `.${gridId}`) {
      const rows = declaration(rule.body, 'grid-template-rows')
      const columns = declaration(rule.body, 'grid-template-columns')
      if (rows) {
        container[target].rows = Number(rows.match(/repeat\((\d+)/)?.[1]) || undefined
        container[target].rowMin = rows.match(/minmax\(([^,]+),/)?.[1].trim()
      }
      if (columns) {
        container[target].columns = Number(columns.match(/repeat\((\d+)/)?.[1]) || undefined
      }
      const rowGap = declaration(rule.body, 'row-gap')
      const columnGap = declaration(rule.body, 'column-gap')
      const scale = declaration(rule.body, '--row-height-scaling-factor')
      if (rowGap) container[target].rowGap = rowGap
      if (columnGap) container[target].columnGap = columnGap
      if (scale) container[target].rowScale = Number(scale)
      continue
    }

    const blockMatch = rule.selector.match(/^\.(fe-block-[\w-]+)\s*(.*)$/)
    if (!blockMatch) continue
    const [, id, suffix] = blockMatch

    if (!blocks.has(id)) blocks.set(id, { mobile: {}, desktop: {} })
    const entry = blocks.get(id)[target]

    if (!suffix) {
      const area = declaration(rule.body, 'grid-area')
      const z = declaration(rule.body, 'z-index')
      if (area) entry.area = area
      if (z) entry.zIndex = Number(z)
    } else if (suffix.includes('.sqs-block-alignment-wrapper')) {
      const align = declaration(rule.body, 'align-items')
      if (align) entry.align = align
    } else if (suffix.includes('.sqs-block')) {
      const justify = declaration(rule.body, 'justify-content')
      if (justify) entry.justify = justify
    }
  }

  return { gridId, container, blocks }
}

/**
 * Site-wide chrome: logo, favicon, primary nav, footer and social links.
 *
 * Extracted once from the homepage. These live outside `section.page-section`,
 * so the per-page block parser never sees them — without this the new site
 * would ship with no logo and no navigation.
 */
function parseSiteChrome(html, knownPaths = []) {
  const $ = cheerio.load(html)

  /*
   * Three footer entries (Dashboard, Volt Europa 2026, Privacy Policy) are plain
   * text on the live site — Squarespace has no <a> around them, so they are dead
   * ends for a visitor. Where the label matches a page that actually exists they
   * are linked here; where it does not, the text is left alone rather than
   * guessed at. Deriving the target from the site's own pages is the difference
   * between fixing a broken link and inventing one.
   */
  const pathBySlug = new Map(
    knownPaths.map((p) => [p.replace(/^\/+|\/+$/g, '').toLowerCase(), p]),
  )

  /*
   * Footer entries the site owner has since given a target and a wording for.
   * Squarespace left these as dead text; they are not derivable from the site,
   * so they live here as explicit, reviewable decisions rather than guesses.
   */
  const FOOTER_OVERRIDES = {
    'volt europa 2026': { label: 'Volt Europa', href: 'https://volteuropa.org' },
  }
  const resolveLabel = (text) => {
    const slug = text
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    return pathBySlug.get(slug)
  }

  const $logo = $('.header-title-logo img, .site-logo img, img.site-logo').first()
  const logo = $logo.attr('data-src') || $logo.attr('src') || ''

  const nav = []
  const seen = new Set()
  $('.header-nav-item a, .header-nav-list a').each((_i, a) => {
    const $a = $(a)
    const href = $a.attr('href') || ''
    const label = $a.text().replace(/\s+/g, ' ').trim()
    if (!href || !label || seen.has(href)) return
    seen.add(href)
    nav.push({ label, href })
  })

  /*
   * Social links live in `.header-actions`, not in a social-account-links
   * block. Searching only for the latter reported "no social links", which read
   * as "this site has none" rather than "the selector was wrong".
   */
  const social = []
  $('.header-actions a[href], [class*=social-account-links] a[href]').each((_i, a) => {
    const href = $(a).attr('href') || ''
    const platform = href.match(
      /(instagram|linkedin|twitter|x|facebook|youtube|mastodon|bluesky|tiktok)\./i,
    )?.[1]
    if (!platform) return
    /*
     * Squarespace stored these as http:// without the www. Both redirect, but
     * that is an extra hop per click and an insecure first request, so they are
     * normalised here rather than shipped as-is.
     */
    const canonical = href
      .replace(/^http:\/\//, 'https://')
      .replace(/^https:\/\/(?!www\.)/, 'https://www.')
    if (social.some((s) => s.href === canonical)) return
    social.push({ platform: platform.toLowerCase(), href: canonical })
  })

  // The header's call-to-action button, which sits beside the social icons.
  const $cta = $('.header-actions a.btn, .header-actions a[class*=sqs-button]').first()
  const headerCta = $cta.length
    ? { label: $cta.text().replace(/\s+/g, ' ').trim(), href: $cta.attr('href') || '#' }
    : undefined

  // The footer is a normal Squarespace layout, so run it through the same block
  // parser as page sections rather than flattening it to a single string.
  /*
   * The footer is a fluid-engine section like any page section: its logo mark is
   * a small grid cell and the wordmark spans nearly the full width. Rendering it
   * as a plain stack sized both the same, which is why the two read as the same
   * logo printed twice.
   */
  const $footerSection = $('footer').first()
  const footerLayout = parseFluidLayout($, $footerSection)
  const footerGrid = footerLayout ? footerLayout.container : undefined

  const footerBlocks = []
  const unlinkedFooterLabels = []
  $('footer .sqs-block').each((_i, b) => {
    if ($(b).parents('.sqs-block').length) return
    const parsed = parseBlock($, b)
    if (!parsed) return

    // Footer blocks sit in themed sections just like page blocks do. The
    // newsletter embed is in a `bright-inverse` (white) band; without the theme
    // it renders on the dark footer and HubSpot's dark labels vanish.
    const sectionTheme = $(b).closest('section, .page-section').attr('data-section-theme')
    if (sectionTheme) parsed.theme = sectionTheme

    if (parsed.type === 'richText' && !/<a\s/i.test(parsed.html)) {
      const label = cheerio.load(parsed.html).text().replace(/\s+/g, ' ').trim()
      const override = FOOTER_OVERRIDES[label.toLowerCase()]
      const href = override?.href || (label && resolveLabel(label))
      if (href) {
        parsed.html = `<p><a href="${href}">${override?.label || label}</a></p>`
      } else if (label) {
        unlinkedFooterLabels.push(label)
      }
    }

    if (footerLayout) {
      const wrapperClass = ($(b).closest('.fe-block').attr('class') || '')
        .split(/\s+/)
        .find((c) => c.startsWith('fe-block-'))
      const placement = wrapperClass ? footerLayout.blocks.get(wrapperClass) : undefined
      if (placement) parsed.layout = placement
    }

    footerBlocks.push(parsed)
  })

  if (unlinkedFooterLabels.length) {
    report.unlinkedFooterLabels = unlinkedFooterLabels
  }

  return {
    siteTitle: $('meta[property="og:site_name"]').attr('content') || 'EuroSense',
    logo,
    logoAlt: $logo.attr('alt') || 'EuroSense',
    favicon: ($('link[rel*=icon]').first().attr('href') || '').split('?')[0],
    nav,
    social,
    headerCta,
    footerGrid,
    footerBlocks,
  }
}

function parsePageHtml(html, urlPath) {
  const $ = cheerio.load(html)

  const meta = {
    title: $('meta[property="og:title"]').attr('content') || $('title').text().trim(),
    description:
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
  }

  const sections = []

  /*
   * Event pages carry their date, time and location in Squarespace's own
   * `.eventitem-meta` list, outside any section, so the section loop below never
   * sees it — the page kept its description and lost when it actually happens.
   */
  const $eventMeta = $('.eventitem-column-meta').first()
  if ($eventMeta.length) {
    // Several .eventitem-meta lists: date/time, venue address, calendar links.
    const rows = $eventMeta
      .find('.eventitem-meta li')
      .map((_i, li) => $(li).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean)
    if (rows.length) {
      sections.push({
        theme: 'white',
        blocks: [
          {
            type: 'richText',
            html: `<ul>${rows.map((r) => `<li>${r}</li>`).join('')}</ul>`,
          },
        ],
      })
    }
  }

  $('#page section.page-section, main section.page-section').each((_i, sec) => {
    const $sec = $(sec)

    /*
     * List sections are a separate Squarespace section type with no .sqs-block
     * children at all, so the block loop below finds nothing and the section is
     * dropped. That silently lost the partner-logo strip on the homepage.
     */
    if ($sec.hasClass('user-items-list-section')) {
      const items = $sec
        .find('.list-item')
        .map((_j, li) => {
          const $li = $(li)
          const $img = $li.find('img').first()
          const $link = $li.find('a[href]').first()
          // Each teaser carries its own call to action ("Make It"), which is a
          // separate element from the card link and was being dropped.
          const $button = $li
            .find('.list-item-content__button-container a, .list-item-content__button')
            .first()
          // The real pixel size, so a logo strip can lay each mark out at its own
          // aspect ratio instead of squeezing them all into one box.
          const [iw, ih] = ($img.attr('data-image-dimensions') || '').split('x').map(Number)

          return {
            image: $img.attr('data-src') || $img.attr('src') || undefined,
            imageWidth: Number.isFinite(iw) && iw > 0 ? iw : undefined,
            imageHeight: Number.isFinite(ih) && ih > 0 ? ih : undefined,
            alt: $img.attr('alt') || '',
            title: $li
              .find('.list-item-content__title')
              .first()
              .text()
              .replace(/\s+/g, ' ')
              .trim(),
            description: htmlToMarkdown(
              $li.find('.list-item-content__description').first().html(),
            ),
            href: $link.attr('href') || undefined,
            buttonLabel: $button.text().replace(/\s+/g, ' ').trim() || undefined,
            buttonHref: $button.attr('href') || undefined,
          }
        })
        .get()
        .filter((item) => item.image || item.title)

      if (items.length) {
        /*
         * The section's own heading ("Our Partners") sits outside the items, in
         * a `div.list-section-title` that Squarespace styles as a centred h2 —
         * 58px and bold at 1440. Carried through as a paragraph it rendered at
         * body size, which is why it read as a stray label above the logos.
         */
        const title = cleanRichText($sec.find('.list-section-title').first())?.replace(
          /^\s*<p[^>]*>([\s\S]*)<\/p>\s*$/,
          // lightAccent is purple-deep — Squarespace's colour names are inverted.
          '<h2 style="text-align:center"><span class="sqsrte-text-color--lightAccent">$1</span></h2>',
        )
        sections.push({
          id: $sec.attr('data-section-id') || undefined,
          theme: $sec.attr('data-section-theme') || undefined,
          blocks: [
            ...(title ? [{ type: 'richText', html: title }] : []),
            { type: 'list', items },
          ],
        })
      }
      return
    }

    /*
     * The collection list (blog posts, multimedia items) occupies a section of
     * its own, with no .sqs-block children — so the block loop below finds
     * nothing and the section is dropped, which pushed the article list to the
     * bottom of the page instead of directly under the hero where it belongs.
     */
    const listContainer = $sec.find(
      '.blog-masonry, .blog-basic-grid, .blog-side-by-side, .blog-single-column',
    )
    if (listContainer.length && !$sec.find('.sqs-block').length) {
      sections.push({
        id: $sec.attr('data-section-id') || undefined,
        theme: $sec.attr('data-section-theme') || undefined,
        blocks: [{ type: 'postList' }],
      })
      return
    }

    const layout = parseFluidLayout($, $sec)
    const blocks = []

    $sec.find('[class*="-block"].sqs-block, .fe-block .sqs-block').each((_j, b) => {
      // Skip blocks nested inside an already-captured block.
      if ($(b).parents('.sqs-block').length) return
      const parsed = parseBlock($, b)
      if (!parsed) return

      const surface = blockSurface($, $(b))
      if (surface) parsed.surface = surface

      // Carry the block's grid placement across, keyed by the fe-block class on
      // its wrapper. Without this the section collapses to a single column.
      if (layout) {
        const wrapperClass = ($(b).closest('.fe-block').attr('class') || '')
          .split(/\s+/)
          .find((c) => c.startsWith('fe-block-'))
        const placement = wrapperClass ? layout.blocks.get(wrapperClass) : undefined
        if (placement) parsed.layout = placement
      }

      blocks.push(parsed)
    })

    // A fluid section with no blocks is still meaningful: its grid rows define
    // real vertical space on the page. Dropping it silently shortens the page.
    if (!blocks.length && !layout) return

    const $bg = $sec.find('.section-background img').first()
    /*
     * Squarespace section-height presets, measured on the live site: small is
     * 33vh and medium 66vh; "custom" and unset mean the section is as tall as
     * its content. Without this a short section collapses around its grid, and a
     * background image set to cover gets cropped to a thin band — the graphic
     * reads as a flat rectangle instead of the shape it is.
     */
    /*
     * Sections are taller than their content and centre it vertically — 93 of
     * the 100 migrated sections do. Rendering the grid at the top of the section
     * instead is what made every hero look jammed against the header.
     */
    let verticalAlign
    try {
      const styles = JSON.parse(
        (
          $sec.attr('data-section-post-processed-styles') ||
          $sec.attr('data-current-styles') ||
          '{}'
        ).replace(/&quot;/g, '"'),
      )
      verticalAlign = {
        'vertical-alignment--top': 'start',
        'vertical-alignment--middle': 'center',
        'vertical-alignment--bottom': 'end',
      }[styles.verticalAlignment]
    } catch {
      verticalAlign = undefined
    }

    const heightClass = ($sec.attr('class') || '')
      .split(/\s+/)
      .find((c) => c.startsWith('section-height--'))
    const minHeight = { small: '33vh', medium: '66vh', large: '100vh' }[
      heightClass?.replace('section-height--', '') ?? ''
    ]

    const sectionId = $sec.attr('data-section-id') || undefined
    const hasDivider = ($sec.attr('class') || '').split(/\s+/).includes('has-section-divider')
    const divider = hasDivider && sectionId ? dividerShapes[sectionId] : undefined
    if (hasDivider && !divider) {
      report.failures.push(`section ${sectionId}: has a divider with no measured shape`)
    }

    sections.push({
      id: sectionId,
      minHeight,
      verticalAlign,
      divider: divider ? { path: divider.path, height: divider.height } : undefined,
      // The section theme decides background, heading, text and button colours.
      // Without it every section renders on the same background.
      theme: $sec.attr('data-section-theme') || undefined,
      background: $bg.attr('data-src') || $bg.attr('src') || undefined,
      grid: layout ? layout.container : undefined,
      blocks,
    })
  })

  return { urlPath, ...meta, sections }
}

async function parseCollection(name) {
  const slug = slugify(name)
  const file = path.join(RAW_JSON, `${slug}.json`)
  if (!existsSync(file)) return null
  const data = JSON.parse(await readFile(file, 'utf8'))
  const items = data.items || []
  const outDir = path.join(CONTENT, slug)
  await mkdir(outDir, { recursive: true })

  for (const item of items) {
    const front = {
      title: item.title || '',
      slug: item.urlId,
      date: item.publishOn ? new Date(item.publishOn).toISOString() : undefined,
      excerpt: htmlToMarkdown(item.excerpt || '')
        .replace(/\n+/g, ' ')
        .trim(),
      image: item.assetUrl || undefined,
      imageAlt: (item.mediaFocalPoint && item.title) || undefined,
      author: item.author?.displayName,
      tags: item.tags || [],
      categories: item.categories || [],
      sourceUrl: item.fullUrl ? `${ORIGIN}${item.fullUrl}` : undefined,
      collection: slug,
    }
    const body = htmlToMarkdown(item.body || '')
    await writeFile(
      path.join(outDir, `${item.urlId}.md`),
      `${toFrontMatter(front)}\n\n${body}\n`,
    )
  }

  report.collections.push({
    name,
    slug,
    type: data.collection?.typeName,
    items: items.length,
  })
  console.log(`[parse] collection ${name}: ${items.length} items`)
  return items.length
}

async function stageParse() {
  await mkdir(path.join(CONTENT, 'pages'), { recursive: true })

  const knownPaths = JSON.parse(await readFile(path.join(RAW, 'paths.json'), 'utf8'))
  const chrome = parseSiteChrome(
    await readFile(path.join(RAW_PAGES, 'index.html'), 'utf8'),
    knownPaths,
  )
  await writeFile(path.join(CONTENT, 'site.json'), `${JSON.stringify(chrome, null, 2)}\n`)
  console.log(
    `[parse] site chrome: ${chrome.nav.length} nav items, ${chrome.social.length} social links`,
  )

  for (const c of COLLECTIONS) await parseCollection(c)

  // Slugs already emitted as collection items — don't also emit them as pages.
  const collectionItemPaths = new Set()
  for (const c of COLLECTIONS) {
    const f = path.join(RAW_JSON, `${slugify(c)}.json`)
    if (!existsSync(f)) continue
    const data = JSON.parse(await readFile(f, 'utf8'))
    for (const it of data.items || []) if (it.fullUrl) collectionItemPaths.add(it.fullUrl)
  }

  const paths = JSON.parse(await readFile(path.join(RAW, 'paths.json'), 'utf8'))
  for (const p of paths) {
    if (collectionItemPaths.has(p)) continue
    const slug = slugify(p)
    const file = path.join(RAW_PAGES, `${slug}.html`)
    if (!existsSync(file)) continue
    const html = await readFile(file, 'utf8')
    const page = parsePageHtml(html, p)
    const blockCount = page.sections.reduce((n, s) => n + s.blocks.length, 0)
    await writeFile(
      path.join(CONTENT, 'pages', `${slug}.json`),
      `${JSON.stringify(page, null, 2)}\n`,
    )
    report.pages.push({ path: p, slug, sections: page.sections.length, blocks: blockCount })
    if (!blockCount) console.warn(`[parse] EMPTY ${p} — no blocks recognised`)
  }
  console.log(`[parse] ${report.pages.length} pages -> content/pages/`)
}

// ---------------------------------------------------------------------------
// stage: assets
// ---------------------------------------------------------------------------

// The `https:` is optional: Squarespace emits the site logo (and some CSS
// backgrounds) as protocol-relative `//images.squarespace-cdn.com/...` URLs.
// Requiring the scheme silently skipped the logo and favicon.
const CDN_RE =
  /(?:https:)?\/\/(?:images\.squarespace-cdn\.com|static1\.squarespace\.com)\/[^\s"'()<>\\]+/g

/*
 * Uploaded files (PDFs, spreadsheets) are served from a site-relative `/s/`
 * path, not the image CDN, so the CDN pattern above never saw them. They die
 * with the subscription exactly like the images do — the site links to a
 * research report and an open dataset this way.
 */
const FILE_RE = /(?:href|src)="((?:https:\/\/[^"]*\.squarespace\.com)?\/s\/[^"]+)"/g

/** Squarespace chrome we deliberately do not migrate. */
const SKIP_ASSET_RE = /\.(css|js)$|\/scripts\/|\/versioned-assets\//

/** Squarespace URLs carry ?format= sizing; strip it and request the largest. */
function normaliseAssetUrl(raw) {
  let clean = raw
    // URLs scraped out of entity-encoded attributes carry `&quot;`/`&amp;`.
    .replace(/&quot;.*$/, '')
    .replace(/&amp;/g, '&')
    .split('?')[0]
    .replace(/[.,)\]]+$/, '')
  if (clean.startsWith('//')) clean = `https:${clean}`
  return { clean, fetchUrl: `${clean}?format=2500w` }
}

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'application/pdf': '.pdf',
}

/**
 * Local filename for an asset. The extension comes from the response
 * content-type rather than the URL, because the two disagree on this CDN.
 */
function localNameFor(cleanUrl, contentType) {
  const base = decodeURIComponent(cleanUrl.split('/').pop() || 'asset')
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80)
  const hash = createHash('sha1').update(cleanUrl).digest('hex').slice(0, 8)
  const urlExt = path.extname(safe)
  const stem = urlExt ? safe.slice(0, -urlExt.length) : safe
  const ext = MIME_EXT[contentType] || urlExt || '.bin'
  return `${stem}-${hash}${ext}`
}

async function collectContentFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collectContentFiles(full)))
    else if (/\.(md|json)$/.test(entry.name)) out.push(full)
  }
  return out
}

async function stageAssets() {
  await mkdir(MEDIA, { recursive: true })
  const files = await collectContentFiles(CONTENT)

  // A manifest keeps re-runs cheap: the local filename depends on the response
  // content-type, so without it we would have to re-download just to learn the name.
  const manifestPath = path.join(ROOT, 'archive', 'assets.json')
  const manifestFile = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : {}
  /*
   * `_aliases` records files removed by de-duplication and what replaced them.
   * It must persist: content is rewritten in place, so a later run has to be
   * able to repair a reference to a name that no longer exists on disk.
   */
  const aliases = manifestFile._aliases ?? {}
  const manifest = Object.fromEntries(
    Object.entries(manifestFile).filter(([k]) => k !== '_aliases'),
  )

  // Pass 1: discover every CDN URL referenced by parsed content.
  const discovered = new Set()
  for (const f of files) {
    const text = await readFile(f, 'utf8')
    for (const m of text.matchAll(CDN_RE)) {
      const { clean } = normaliseAssetUrl(m[0])
      if (SKIP_ASSET_RE.test(clean)) continue
      discovered.add(clean)
    }
  }
  console.log(`[assets] ${discovered.size} unique Squarespace assets referenced`)

  // Uploaded files live at a site-relative /s/ path and need their own pass.
  const fileDownloads = new Set()
  for (const f of files) {
    const text = await readFile(f, 'utf8')
    for (const m of text.matchAll(/\/s\/[A-Za-z0-9._%+-]+\.[A-Za-z0-9]{2,5}/g)) {
      fileDownloads.add(m[0])
    }
  }
  if (fileDownloads.size) {
    console.log(`[assets] ${fileDownloads.size} uploaded file(s) referenced`)
    await mkdir(FILES, { recursive: true })
    for (const rel of fileDownloads) {
      const name = decodeURIComponent(rel.slice(3))
      const dest = path.join(FILES, name)
      if (existsSync(dest) && (await stat(dest)).size > 0) {
        report.assets.reused++
        continue
      }
      const res = await get(`${ORIGIN}${rel}`, { binary: true })
      if (!res.ok || !res.buffer?.length) {
        report.assets.failed.push({ url: rel, status: res.status, error: res.error })
        console.warn(`[assets] FAILED ${rel}`)
        continue
      }
      await writeFile(dest, res.buffer)
      report.assets.downloaded++
    }
  }

  // Pass 2: download anything not already on disk.
  await pool([...discovered], 5, async (clean) => {
    const known = manifest[clean]
    if (
      known &&
      existsSync(path.join(MEDIA, known)) &&
      (await stat(path.join(MEDIA, known))).size > 0
    ) {
      report.assets.reused++
      return
    }
    const { fetchUrl } = normaliseAssetUrl(clean)
    let res = await get(fetchUrl, { binary: true })
    if (!res.ok) res = await get(clean, { binary: true }) // some assets reject ?format
    if (!res.ok || !res.buffer?.length) {
      report.assets.failed.push({ url: clean, status: res.status, error: res.error })
      console.warn(`[assets] FAILED ${clean}`)
      return
    }
    const name = localNameFor(clean, res.contentType)
    await writeFile(path.join(MEDIA, name), res.buffer)
    manifest[clean] = name
    report.assets.downloaded++
    await sleep(60)
  })

  /*
   * Collapse byte-identical downloads onto one file. Squarespace serves the same
   * asset under several URLs (different query strings, or the same logo
   * referenced from the header and the footer), which produced a different hash
   * and therefore a duplicate copy of the bytes each time.
   */
  const byContent = new Map()
  const canonical = new Map()
  for (const name of Object.values(manifest)) {
    if (canonical.has(name)) continue
    const file = path.join(MEDIA, name)
    if (!existsSync(file)) continue
    const digest = createHash('sha1')
      .update(await readFile(file))
      .digest('hex')
    if (byContent.has(digest)) canonical.set(name, byContent.get(digest))
    else {
      byContent.set(digest, name)
      canonical.set(name, name)
    }
  }

  let deduped = 0
  for (const [url, name] of Object.entries(manifest)) {
    const keep = canonical.get(name)
    if (!keep || keep === name) continue
    manifest[url] = keep
    aliases[name] = keep
    if (existsSync(path.join(MEDIA, name))) {
      await rm(path.join(MEDIA, name))
      deduped++
    }
  }
  if (deduped) console.log(`[assets] removed ${deduped} duplicate file(s)`)

  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...manifest, _aliases: aliases }, null, 2)}\n`,
  )
  const urls = new Map(Object.entries(manifest))

  // Pass 3: rewrite content references to the local copies.
  let rewritten = 0
  for (const f of files) {
    const text = await readFile(f, 'utf8')
    // Match the absolute form too. Some links are written as
    // https://www.eurosense.eu/s/file.pdf, and rewriting only the path leaves an
    // absolute URL to the old host pointing at a path that never existed there.
    // Remap references that already point at a de-duplicated file. Content is
    // rewritten in place on earlier runs, so by now most links are /media/...
    // rather than CDN URLs, and the dedup above would otherwise orphan them.
    let next = text.replace(/\/media\/([A-Za-z0-9._%+-]+)/g, (m, name) => {
      const decoded = decodeURIComponent(name)
      const keep = canonical.get(decoded) ?? aliases[decoded]
      return keep ? `/media/${keep}` : m
    })

    next = next.replace(
      /(?:https?:\\?\/\\?\/[^"'\s]*?eurosense\.eu)?\\?\/s\\?\/([A-Za-z0-9._%+-]+\.[A-Za-z0-9]{2,5})/g,
      (m, name) =>
        existsSync(path.join(FILES, decodeURIComponent(name))) ? `/files/${name}` : m,
    )
    next = next.replace(CDN_RE, (m) => {
      const { clean } = normaliseAssetUrl(m)
      const name = urls.get(clean)
      return name && existsSync(path.join(MEDIA, name)) ? `/media/${name}` : m
    })
    if (next !== text) {
      await writeFile(f, next)
      rewritten++
    }
  }
  console.log(
    `[assets] downloaded ${report.assets.downloaded}, reused ${report.assets.reused}, ` +
      `failed ${report.assets.failed.length}, rewrote ${rewritten} content files`,
  )
}

// ---------------------------------------------------------------------------

async function main() {
  const stageArg = process.argv.find((a) => a.startsWith('--stage='))
  const stage = stageArg ? stageArg.split('=')[1] : 'all'

  if (stage === 'all' || stage === 'fetch') await stageFetch()
  if (stage === 'all' || stage === 'parse') await stageParse()
  if (stage === 'all' || stage === 'assets') await stageAssets()

  report.unknownBlocks = [...new Set(report.unknownBlocks)]
  await mkdir(path.join(ROOT, 'archive'), { recursive: true })
  await writeFile(
    path.join(ROOT, 'archive', 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )

  console.log('\n=== extraction report ===')
  console.log(`pages           ${report.pages.length}`)
  console.log(
    `collections     ${report.collections.map((c) => `${c.slug}:${c.items}`).join(', ')}`,
  )
  console.log(
    `assets          ${report.assets.downloaded} new / ${report.assets.reused} cached`,
  )
  if (report.unknownBlocks.length)
    console.log(`UNHANDLED blocks: ${report.unknownBlocks.join(', ')}`)
  if (report.assets.failed.length)
    console.log(`ASSET FAILURES:   ${report.assets.failed.length} (see archive/report.json)`)
  if (report.failures.length)
    console.log(`FETCH FAILURES:   ${report.failures.length} (see archive/report.json)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

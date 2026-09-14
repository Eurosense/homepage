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

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
const slugify = (urlPath) =>
  urlPath.replace(/^\/+|\/+$/g, '').replace(/\//g, '--') || 'index'

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

  return ($unwrapped('#__root').html() || '').replace(/\s+/g, ' ').trim()
}

/** Strip presentational cruft from HTML we keep verbatim (accordions, galleries). */
function cleanHtml(html) {
  if (!html) return ''
  const $ = cheerio.load(`<div id="__root">${html}</div>`)
  $('style, noscript').remove()
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
])

/** Map a Squarespace block element to our own content model. */
function parseBlock($, el) {
  const $el = $(el)
  const classes = ($el.attr('class') || '').split(/\s+/)
  const kind = classes.find((c) => BLOCK_KINDS.has(c))
  const $content = $el.find('.sqs-block-content').first()
  const inner = $content.length ? $content : $el

  switch (kind) {
    case 'html-block':
    case 'markdown-block': {
      const html = cleanRichText(inner)
      return html ? { type: 'richText', html } : null
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
      const $iframe = inner.find('iframe').first()
      return {
        type: 'video',
        src: $iframe.attr('src') || $iframe.attr('data-src') || '',
        title: $iframe.attr('title') || '',
      }
    }
    case 'code-block':
    case 'embed-block': {
      return { type: 'embed', html: (inner.html() || '').trim() }
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
      const fields = (config.formFields || []).map((f) => ({
        label: String(f.title ?? ''),
        name: String(f.title ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, ''),
        type: TYPES[f.type] || 'text',
        required: Boolean(f.required),
      }))

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
          return {
            title: $li.find('.accordion-item__title').first().text().trim(),
            markdown: htmlToMarkdown($li.find('.accordion-item__dropdown').first().html()),
          }
        })
        .get()
        .filter((item) => item.title || item.markdown)

      return items.length ? { type: 'accordion', items } : null
    }
    case 'summary-v2-block':
    case 'gallery-block':
    case 'instagram-block': {
      // Structured collections we render ourselves; keep raw so nothing is lost.
      return { type: kind.replace('-block', ''), html: cleanHtml(inner.html()) }
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
    if (!platform || social.some((s) => s.href === href)) return
    social.push({ platform: platform.toLowerCase(), href })
  })

  // The header's call-to-action button, which sits beside the social icons.
  const $cta = $('.header-actions a.btn, .header-actions a[class*=sqs-button]').first()
  const headerCta = $cta.length
    ? { label: $cta.text().replace(/\s+/g, ' ').trim(), href: $cta.attr('href') || '#' }
    : undefined

  // The footer is a normal Squarespace layout, so run it through the same block
  // parser as page sections rather than flattening it to a single string.
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
      const href = label && resolveLabel(label)
      if (href) parsed.html = `<p><a href="${href}">${label}</a></p>`
      else if (label) unlinkedFooterLabels.push(label)
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
          return {
            image: $img.attr('data-src') || $img.attr('src') || undefined,
            alt: $img.attr('alt') || '',
            title: $li.find('.list-item-content__title').first().text().replace(/\s+/g, ' ').trim(),
            description: htmlToMarkdown(
              $li.find('.list-item-content__description').first().html(),
            ),
            href: $link.attr('href') || undefined,
          }
        })
        .get()
        .filter((item) => item.image || item.title)

      if (items.length) {
        sections.push({
          id: $sec.attr('data-section-id') || undefined,
          theme: $sec.attr('data-section-theme') || undefined,
          blocks: [{ type: 'list', items }],
        })
      }
      return
    }

    const layout = parseFluidLayout($, $sec)
    const blocks = []

    $sec.find('[class*="-block"].sqs-block, .fe-block .sqs-block').each((_j, b) => {
      // Skip blocks nested inside an already-captured block.
      if ($(b).parents('.sqs-block').length) return
      const parsed = parseBlock($, b)
      if (!parsed) return

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
    sections.push({
      id: $sec.attr('data-section-id') || undefined,
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
      excerpt: htmlToMarkdown(item.excerpt || '').replace(/\n+/g, ' ').trim(),
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
  console.log(`[parse] site chrome: ${chrome.nav.length} nav items, ${chrome.social.length} social links`)

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
  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, 'utf8'))
    : {}

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
    if (known && existsSync(path.join(MEDIA, known)) && (await stat(path.join(MEDIA, known))).size > 0) {
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

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const urls = new Map(Object.entries(manifest))

  // Pass 3: rewrite content references to the local copies.
  let rewritten = 0
  for (const f of files) {
    const text = await readFile(f, 'utf8')
    // Match the absolute form too. Some links are written as
    // https://www.eurosense.eu/s/file.pdf, and rewriting only the path leaves an
    // absolute URL to the old host pointing at a path that never existed there.
    let next = text.replace(
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
  console.log(`collections     ${report.collections.map((c) => `${c.slug}:${c.items}`).join(', ')}`)
  console.log(`assets          ${report.assets.downloaded} new / ${report.assets.reused} cached`)
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

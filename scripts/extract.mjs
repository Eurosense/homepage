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

/** Run async tasks with bounded concurrency, politely. */
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
      // Squarespace inlines per-block <style> rules (tweak variables, blend
      // modes) inside the block itself. Turndown treats their text as prose, so
      // they must go before conversion or every heading drags a CSS dump along.
      const $clone = inner.clone()
      $clone.find('style, script, noscript').remove()
      const md = htmlToMarkdown($clone.html() || '')
      return md ? { type: 'richText', markdown: md } : null
    }
    case 'image-block': {
      const $img = inner.find('img').first()
      const src = $img.attr('data-src') || $img.attr('src')
      if (!src) return null
      const $link = inner.find('a').first()
      return {
        type: 'image',
        src,
        alt: $img.attr('alt') || '',
        caption: htmlToMarkdown(inner.find('.image-caption').html() || ''),
        href: $link.attr('href') || undefined,
      }
    }
    case 'button-block': {
      const $a = inner.find('a').first()
      if (!$a.length) return null
      return {
        type: 'button',
        label: $a.text().trim(),
        href: $a.attr('href') || '#',
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
      const $form = inner.find('form').first()
      const fields = inner
        .find('.form-item')
        .map((_i, f) => {
          const $f = $(f)
          const $input = $f.find('input,textarea,select').first()
          return {
            label: $f.find('.title').first().text().replace(/\s+/g, ' ').trim(),
            name: $input.attr('name') || '',
            type: $input.is('textarea') ? 'textarea' : $input.attr('type') || 'text',
            required: $f.hasClass('required'),
          }
        })
        .get()
      return {
        type: 'form',
        title: inner.find('.form-block .field-list legend').first().text().trim(),
        submitLabel: inner.find('[type=submit]').first().attr('value') || 'Submit',
        formId: $form.attr('id') || '',
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
    case 'accordion-block':
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
 * Site-wide chrome: logo, favicon, primary nav, footer and social links.
 *
 * Extracted once from the homepage. These live outside `section.page-section`,
 * so the per-page block parser never sees them — without this the new site
 * would ship with no logo and no navigation.
 */
function parseSiteChrome(html) {
  const $ = cheerio.load(html)

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

  const social = []
  $('[class*=social-account-links] a, .sqs-svg-icon--list a').each((_i, a) => {
    const href = $(a).attr('href') || ''
    if (!href || href.startsWith('#') || social.some((s) => s.href === href)) return
    const platform = (href.match(/([a-z]+)\.(?:com|org|be|eu|net|io)/i) || [, 'link'])[1]
    social.push({ platform: platform.toLowerCase(), href })
  })

  // The footer is a normal Squarespace layout, so run it through the same block
  // parser as page sections rather than flattening it to a single string.
  const footerBlocks = []
  $('footer .sqs-block').each((_i, b) => {
    if ($(b).parents('.sqs-block').length) return
    const parsed = parseBlock($, b)
    if (parsed) footerBlocks.push(parsed)
  })

  return {
    siteTitle: $('meta[property="og:site_name"]').attr('content') || 'EuroSense',
    logo,
    logoAlt: $logo.attr('alt') || 'EuroSense',
    favicon: ($('link[rel*=icon]').first().attr('href') || '').split('?')[0],
    nav,
    social,
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
    const blocks = []
    $sec.find('[class*="-block"].sqs-block, .fe-block .sqs-block').each((_j, b) => {
      // Skip blocks nested inside an already-captured block.
      if ($(b).parents('.sqs-block').length) return
      const parsed = parseBlock($, b)
      if (parsed) blocks.push(parsed)
    })
    if (!blocks.length) return

    const $bg = $sec.find('.section-background img').first()
    sections.push({
      id: $sec.attr('data-section-id') || undefined,
      background: $bg.attr('data-src') || $bg.attr('src') || undefined,
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

  const chrome = parseSiteChrome(await readFile(path.join(RAW_PAGES, 'index.html'), 'utf8'))
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
    const next = text.replace(CDN_RE, (m) => {
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

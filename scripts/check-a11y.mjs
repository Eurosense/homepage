#!/usr/bin/env node
/**
 * Runs axe-core over every page of the built site.
 *
 * Reads `out/`, so `npm run build` has to have happened first. The pages are
 * discovered from the build rather than listed here, because a hand-kept list
 * stops covering the site the first time somebody adds a page.
 *
 * Two of this project's known failure modes are accessibility failures that look
 * fine in a screenshot: text set in its own background colour, and markup that
 * depends on a script we do not ship. axe catches the first directly and the
 * second as an empty landmark.
 *
 * Usage: npm run a11y [-- --width=390] [-- --page=/faq]
 */

import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const { default: AxeBuilder } = require('@axe-core/playwright')

const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'out')

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=')
    return [k, v]
  }),
)

/*
 * Two widths, because the site swaps layouts at 768px and several blocks are
 * positioned per-breakpoint. A violation can exist at one and not the other.
 */
const WIDTHS = args.has('width') ? [Number(args.get('width'))] : [390, 1280]

/*
 * WCAG 2.1 AA, which is what the EU Web Accessibility Directive points at.
 * `best-practice` is excluded: it flags things like "all page content should be
 * contained by landmarks", which are worth knowing but are not the standard,
 * and failing the build on them would train people to ignore this.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv',
  '.mp4': 'video/mp4',
}

/** Serves `out/` the way a static host would, so what axe sees is what ships. */
function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    const candidates = [path.join(OUT, url), path.join(OUT, url, 'index.html')]
    for (const candidate of candidates) {
      if (!candidate.startsWith(OUT)) break
      try {
        if ((await stat(candidate)).isDirectory()) continue
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(candidate)] ?? 'application/octet-stream',
        })
        res.end(await readFile(candidate))
        return
      } catch {
        // Try the next candidate.
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

/** Every route in the build, as URL paths. */
async function routes(dir = OUT, prefix = '') {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name === 'dashboard-app') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await routes(full, `${prefix}/${entry.name}`)))
    else if (entry.name === 'index.html') found.push(prefix || '/')
  }
  return found.sort()
}

const { server, port } = await serve()
const pages = args.has('page') ? [args.get('page')] : await routes()
const browser = await chromium.launch()

let failures = 0
const seen = new Map()

for (const route of pages) {
  for (const width of WIDTHS) {
    // axe needs a page from an explicit context, not browser.newPage().
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle' })

    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
    await context.close()

    if (!violations.length) continue

    for (const violation of violations) {
      failures += violation.nodes.length
      const key = `${violation.id} @${width}`
      seen.set(key, (seen.get(key) ?? 0) + violation.nodes.length)
      console.log(`\n${route} @${width}  ${violation.id} (${violation.impact})`)
      console.log(`  ${violation.help}`)
      console.log(`  ${violation.helpUrl}`)
      for (const node of violation.nodes.slice(0, 3)) {
        console.log(`  → ${node.target.join(' ')}`)
        const detail = node.failureSummary?.split('\n').filter(Boolean).slice(1, 3) ?? []
        for (const d of detail) console.log(`      ${d.trim()}`)
      }
      if (violation.nodes.length > 3) console.log(`  → …and ${violation.nodes.length - 3} more`)
    }
  }
}

await browser.close()
server.close()

console.log(
  `\n${pages.length} page(s) × ${WIDTHS.join(', ')}px checked against ${TAGS.join(', ')}.`,
)

if (!failures) {
  console.log('No accessibility violations.')
  process.exit(0)
}

console.log('\nBy rule:')
for (const [rule, count] of [...seen].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(4)}  ${rule}`)
}
console.log(`\n${failures} violation(s).`)
process.exit(1)

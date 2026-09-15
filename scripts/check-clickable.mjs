#!/usr/bin/env node
/**
 * Fails if anything a reader is meant to click is covered by something else.
 *
 * Squarespace's fluid engine overlaps grid cells freely and orders them with
 * z-index. That is fine for painting and wrong for pointing: a cell taller than
 * the text inside it still captures clicks across its whole box, so an empty
 * region of one block can sit invisibly on top of another. On /blognews a label
 * 62px tall holding 23px of text covered the upper half of the search input, and
 * the box simply did not respond — no error, nothing in the DOM out of place,
 * and every other check green.
 *
 * Nothing else here can see this. It is not an overflow, not a contrast problem,
 * and axe does not hit-test. It is only visible by asking the browser what is
 * actually at a given point.
 *
 * Reads `out/`, so `npm run build` has to have happened first.
 *
 * Usage: npm run clickable [-- --page=/blognews/]
 */

import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'out')

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=')
    return [k, v]
  }),
)

/* Both breakpoints: cells are placed per-breakpoint, so an overlap can exist at
 * one width and not the other. */
const WIDTHS = args.has('width') ? [Number(args.get('width'))] : [390, 1280]

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

function serve() {
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    for (const candidate of [path.join(OUT, url), path.join(OUT, url, 'index.html')]) {
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

/** Runs in the page: returns controls whose own area is covered by something else. */
function findBlocked() {
  const blocked = []
  const selector = 'a[href], button, input, select, textarea, summary'

  for (const el of document.querySelectorAll(selector)) {
    if (el.offsetParent === null) continue

    /*
     * Per-line boxes, not the bounding box. An inline link wrapping onto a
     * second line has a bounding rectangle spanning both, most of which is not
     * the link at all — sampling inside it reports the neighbouring text as a
     * blocker, which is how this check first accused two perfectly good links.
     */
    const lines = [...el.getClientRects()].filter((r) => r.width >= 4 && r.height >= 4)
    if (!lines.length) continue

    let reported = false
    for (const box of lines) {
      if (reported) break

      /* Three points rather than one: a cell overlapping the top half only is
       * exactly the case that shipped, and a centre-point check misses it. */
      for (const [fx, fy] of [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.75, 0.75],
      ]) {
        const x = Math.round(box.left + box.width * fx)
        const y = Math.round(box.top + box.height * fy)
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue

        const hit = document.elementFromPoint(x, y)
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue

        blocked.push({
          tag: el.tagName.toLowerCase(),
          label: (el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 40),
          at: `${Math.round(fx * 100)}%,${Math.round(fy * 100)}% of its box`,
          blockedBy: `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`,
          blockerText: (hit.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
        })
        reported = true
        break
      }
    }
  }
  return blocked
}

const { server, port } = await serve()
const pages = args.has('page') ? [args.get('page')] : await routes()
const browser = await chromium.launch()

let failures = 0

for (const route of pages) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'networkidle' })
    const blocked = await page.evaluate(findBlocked)
    await context.close()

    if (!blocked.length) continue
    failures += blocked.length
    console.log(`\n${route} @${width}`)
    for (const b of blocked) {
      console.log(`  <${b.tag}> "${b.label}" is covered at ${b.at}`)
      console.log(
        `      by ${b.blockedBy}${b.blockerText ? ` — "${b.blockerText}"` : ' (an empty box)'}`,
      )
    }
  }
}

await browser.close()
server.close()

console.log(`\n${pages.length} page(s) × ${WIDTHS.join(', ')}px checked for covered controls.`)

if (!failures) {
  console.log('Every interactive control is clickable across its own area.')
  process.exit(0)
}

console.log(
  `\n${failures} covered control(s). Usually a neighbouring grid cell is taller than its\n` +
    'content and sits above this one. FluidSection gives cells pointer-events:none and\n' +
    'their children pointer-events:auto for exactly this; check the blocker is a child\n' +
    'of its cell rather than the cell itself.',
)
process.exit(1)

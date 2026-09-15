#!/usr/bin/env node
/**
 * Checks that internal links resolve, and that every page can be reached.
 *
 * Both halves catch things a build cannot. Next will happily prerender a link to
 * a page that does not exist, and it has no opinion at all about a page nothing
 * links to — eleven of those had accumulated by the time anybody looked, mostly
 * Squarespace drafts, one of them a prototype with invented names that was
 * sitting in the sitemap.
 *
 * Reads `out/`, so `npm run build` has to have happened first.
 *
 * Reachability is computed from `/` rather than from "is it in the sitemap",
 * because being in the sitemap is exactly the problem an unlinked page has.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'out')

/**
 * Pages that are reachable without being linked, with the reason.
 *
 * A page belongs here only if something outside the site's own navigation points
 * at it. If it is simply unlinked, either link it or move it to
 * archive/unpublished/ — see the README there.
 */
const REACHABLE_WITHOUT_LINK = new Map([
  // Next emits the 404 at both paths, plus out/404.html for the host to serve.
  ['/_not-found', 'the 404 page, served by the host for unknown paths and never linked'],
  ['/404', 'the 404 page, served by the host for unknown paths and never linked'],
])

/*
 * `src` counts as well as `href`: /dashboard-app is a whole page reached only by
 * the <iframe> on /dashboard, and looking at links alone reported it as an
 * orphan.
 */
const HREF = /(?:href|src)="(\/[^"]*)"/g

async function htmlFiles(dir = OUT) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)))
    else if (entry.name === 'index.html') found.push(full)
  }
  return found
}

/** `/about-us/` and `/about-us` are the same page; index.html is the page itself. */
function routeOf(file) {
  const rel = path.relative(OUT, file).replace(/(^|\/)index\.html$/, '')
  return '/' + rel.replace(/\/$/, '')
}

function normalise(href) {
  const clean = href.split(/[?#]/)[0]
  if (clean === '/') return '/'
  return '/' + clean.replace(/^\/+|\/+$/g, '')
}

const files = await htmlFiles()
const routes = new Set(files.map(routeOf))
const linksFrom = new Map()
const broken = []

/* Anything the build emits that is not a page — a PDF, an image, the dashboard
 * app — is a valid link target even though it is not a route. */
async function assets(dir = OUT, acc = new Set()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await assets(full, acc)
    else acc.add('/' + path.relative(OUT, full))
  }
  return acc
}
const onDisk = await assets()

for (const file of files) {
  const html = await readFile(file, 'utf8')
  const from = routeOf(file)
  const targets = new Set()

  for (const [, href] of html.matchAll(HREF)) {
    if (href.startsWith('//')) continue
    const route = normalise(href)
    targets.add(route)

    const isPage = routes.has(route)
    const isAsset = onDisk.has(href.split(/[?#]/)[0]) || onDisk.has(route)
    const isDirectory = onDisk.has(route + '/index.html')
    if (!isPage && !isAsset && !isDirectory) broken.push({ from, href })
  }

  linksFrom.set(from, targets)
}

/* Walk out from the homepage. A page linked only by an unreachable page is
 * itself unreachable, which is why this is a traversal and not a set union. */
const reachable = new Set(['/'])
const queue = ['/']
while (queue.length) {
  for (const target of linksFrom.get(queue.shift()) ?? []) {
    if (routes.has(target) && !reachable.has(target)) {
      reachable.add(target)
      queue.push(target)
    }
  }
}

const orphans = [...routes]
  .filter((route) => !reachable.has(route) && !REACHABLE_WITHOUT_LINK.has(route))
  .sort()

console.log(`${routes.size} page(s) built; ${reachable.size} reachable from /.`)

let failed = false

if (broken.length) {
  failed = true
  const unique = [...new Map(broken.map((b) => [`${b.from}→${b.href}`, b])).values()]
  console.error(`\n${unique.length} internal link(s) point at nothing:\n`)
  for (const { from, href } of unique.slice(0, 40)) console.error(`  ${from}  →  ${href}`)
  if (unique.length > 40) console.error(`  …and ${unique.length - 40} more`)
}

if (orphans.length) {
  failed = true
  console.error(`\n${orphans.length} page(s) that nothing links to:\n`)
  for (const route of orphans) console.error(`  ${route}`)
  console.error(
    '\nLink it from content/site.json (nav or footerBlocks) or from another page, or\n' +
      'move it to archive/unpublished/ — see the README there. A page in the sitemap\n' +
      'with no route into it is indexable and unfindable at the same time.',
  )
}

if (failed) process.exit(1)
console.log('Every internal link resolves, and every page is reachable.')

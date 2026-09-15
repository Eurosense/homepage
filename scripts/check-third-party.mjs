#!/usr/bin/env node
/**
 * Fails if any built page would contact a third party before the reader asks.
 *
 * The site sets no cookies and no browser storage, which is why it ships no
 * consent banner. That claim is only worth making if it is enforced: every
 * embed has to stay behind ConsentEmbed, and it is one careless `<iframe>` in a
 * Markdown post away from being false. Five pages were quietly setting Google
 * cookies before this check existed.
 *
 * Reads `out/`, so `npm run build` has to have happened first.
 *
 * It looks for *active* references only — a `src`/`href` the browser acts on.
 * A third-party URL sitting in text, in a data attribute, or in the props of a
 * gated embed is fine, because nothing fetches it until someone clicks.
 *
 * `rel="preconnect"` counts as active. It sends no request and sets no cookie,
 * but it completes DNS and a TLS handshake, which tells that origin a visitor
 * is here — which is the thing the gate exists to prevent.
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'out')

/**
 * Origins allowed to be contacted on page load, with the reason.
 *
 * Keep this list short and argued. Anything added here is a promise weakened,
 * so prefer vendoring the asset (scripts/vendor-dashboard-libs.mjs) or gating it
 * behind ConsentEmbed.
 */
const ALLOWED = new Map([
  [
    'eurosense.github.io',
    'our own dashboard data, fetched by our own iframe; GitHub Pages sets no cookies on static assets',
  ],
])

const ACTIVE_TAG = /<(script|iframe|link|img|source|video|audio|embed|object)\b[^>]*>/gi
const URL_ATTR = /\b(?:src|href|data)="(https?:\/\/[^"]+)"/i

async function htmlFiles(dir = OUT) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)))
    else if (entry.name.endsWith('.html')) found.push(full)
  }
  return found
}

const files = await htmlFiles()
const offences = []
const allowedSeen = new Set()

for (const file of files) {
  const html = await readFile(file, 'utf8')
  const page = '/' + path.relative(OUT, file).replace(/(^|\/)index\.html$/, '')

  for (const [tag] of html.matchAll(ACTIVE_TAG)) {
    const url = tag.match(URL_ATTR)?.[1]
    if (!url) continue

    let hostname
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      continue
    }

    if (ALLOWED.has(hostname)) {
      allowedSeen.add(hostname)
      continue
    }
    offences.push({ page, hostname, tag: tag.slice(0, 110) })
  }
}

console.log(`${files.length} built page(s) scanned for third-party requests.`)

for (const [hostname, reason] of ALLOWED) {
  if (allowedSeen.has(hostname)) console.log(`  allowed: ${hostname} — ${reason}`)
}

if (!offences.length) {
  console.log('No page contacts a third party before the reader asks.')
  process.exit(0)
}

console.error(`\n${offences.length} third-party reference(s) that load without consent:\n`)
for (const { page, hostname, tag } of offences) {
  console.error(`  ${page}`)
  console.error(`    ${hostname}`)
  console.error(`    ${tag}`)
}
console.error(
  '\nGate it behind ConsentEmbed (see AGENTS.md, "Third-party embeds"), vendor it into\n' +
    'public/dashboard-app/vendor/, or — if it genuinely must load on view — add the origin\n' +
    'to ALLOWED in this script with the reason.',
)
process.exit(1)

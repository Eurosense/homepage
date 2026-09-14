#!/usr/bin/env node
/**
 * Audits the built site in out/ without deploying anything.
 *
 * Exists so page-level checks cost nothing: deploybase bills build minutes, and
 * pushing a commit to look at a page is the expensive way to answer a question
 * that the local build already answers.
 *
 * Reports per page: forms and how each is wired, unresolved links, missing
 * images, and sections that render empty.
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'out')

if (!existsSync(OUT)) {
  console.error('out/ not found — run `npm run build` first.')
  process.exit(1)
}

async function htmlFiles(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)))
    else if (entry.name === 'index.html') found.push(full)
  }
  return found
}

/** Strip Next's RSC payload so counts reflect the DOM, not the serialised props. */
function domOnly(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '')
}

const files = await htmlFiles(OUT)
const rows = []
const problems = []

for (const file of files) {
  const raw = await readFile(file, 'utf8')
  const html = domOnly(raw)
  const route = `/${path.relative(OUT, path.dirname(file))}`.replace(/^\/\.$/, '/')

  const count = (re) => (html.match(re) || []).length
  const title = raw.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''

  // Forms: our own markup, the not-connected notice, and HubSpot frames.
  const hubspot = count(/class="hs-form-frame"/g)
  const notConnected = count(/not connected yet/g)
  const ownForm = count(/<form\b/g)

  // Links that point at a page or asset that was not built.
  const broken = []
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
    const url = decodeURIComponent(m[1])
    if (url.startsWith('//')) continue
    const asFile = path.join(OUT, url)
    const asPage = path.join(OUT, url, 'index.html')
    const asHtml = path.join(OUT, `${url.replace(/\/$/, '')}.html`)
    if (!existsSync(asFile) && !existsSync(asPage) && !existsSync(asHtml)) broken.push(url)
  }

  const images = count(/<img\b/g)
  const iframes = count(/<iframe\b/g)
  const bodyText = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  rows.push({
    route,
    title: title.replace(/ — EuroSense$/, ''),
    chars: bodyText.length,
    images,
    iframes,
    forms: ownForm,
    hubspot,
    notConnected,
    broken: broken.length,
  })

  for (const url of new Set(broken)) problems.push({ route, kind: 'broken link', detail: url })
  if (bodyText.length < 120) problems.push({ route, kind: 'almost no text', detail: `${bodyText.length} chars` })
}

rows.sort((a, b) => a.route.localeCompare(b.route))

const pad = (v, n) => String(v).padEnd(n)
console.log(
  `${pad('route', 46)}${pad('text', 7)}${pad('img', 5)}${pad('ifr', 5)}${pad('form', 6)}${pad('hubspot', 9)}${pad('unwired', 9)}broken`,
)
console.log('-'.repeat(96))
for (const r of rows) {
  console.log(
    pad(r.route, 46) +
      pad(r.chars, 7) +
      pad(r.images, 5) +
      pad(r.iframes, 5) +
      pad(r.forms, 6) +
      pad(r.hubspot, 9) +
      pad(r.notConnected, 9) +
      (r.broken || ''),
  )
}

console.log(`\n${rows.length} pages built.`)

/*
 * Read the provider from content/forms.json rather than inferring it from the
 * markup: a mailto form and a deploybase form render identical HTML, so
 * guessing from the page reports the wrong one.
 */
const formsConfig = JSON.parse(await readFile(path.join(ROOT, 'content', 'forms.json'), 'utf8'))
const providerByPage = new Map()
for (const entry of Object.values(formsConfig.forms)) {
  const route = entry.name.match(/\(([^)]+)\)/)?.[1]
  if (route) providerByPage.set(route.replace(/\/$/, ''), entry.provider ?? 'not connected')
}

const formPages = rows.filter((r) => r.forms || r.hubspot > 1 || r.notConnected)
console.log('\nPages with a form of their own (the footer newsletter is on every page):')
for (const r of formPages) {
  const provider = providerByPage.get(r.route.replace(/\/$/, '')) ?? 'unknown'
  console.log(`  ${pad(r.route, 24)} ${provider}`)
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  for (const p of problems) console.log(`  ${pad(p.route, 40)} ${p.kind}: ${p.detail}`)
  process.exit(1)
}

console.log('\nNo broken links or empty pages.')

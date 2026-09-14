#!/usr/bin/env node
/**
 * Compares each built page against the Squarespace snapshot it came from and
 * reports what the original says that the rebuild does not.
 *
 * Catches the failure the layout and link checks cannot: a block that was never
 * extracted. Nothing errors when content is simply absent — the page builds, the
 * links resolve, the responsive sweep is clean, and a paragraph is just gone.
 *
 * The headline number is the share of the original's visible text that survives.
 * Word-level diffing was tried first and was useless: Squarespace concatenates
 * text across element boundaries ("storiesTraditional survey") and splits
 * sentences differently, so it reported hundreds of differences on pages that
 * were in fact complete. Comparing word multisets ignores both.
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import * as cheerio from 'cheerio'

const ROOT = path.join(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'archive', 'raw', 'pages')
const OUT = path.join(ROOT, 'out')

/** Pages whose content legitimately differs from the snapshot. */
const EXPECTED_DIFFERENCES = new Set([
  // Squarespace rendered a cookie banner and store chrome we do not carry over.
  '/store',
  // Collection landing pages: the original server-rendered its own item list,
  // the rebuild renders ours, so the wording around the items differs.
  '/events',
  '/resources/multimedia',
  // The original blog index ships a Squarespace search box ("Enter a keyword
  // here", "No results found") that the rebuild has no equivalent for.
  '/blognews',
])

function visibleText(html) {
  /*
   * Separate element boundaries before extracting text. The built output is
   * minified, so `.text()` runs adjacent elements together ("communityWhat")
   * and those glued tokens then read as missing words. The Squarespace snapshot
   * is pretty-printed and does not have the problem, so without this the
   * comparison penalises the rebuild for being minified.
   */
  const $ = cheerio.load(html.replace(/></g, '> <'))
  $('script, style, noscript, svg, template').remove()

  /*
   * Strip the site's own header and footer only. Removing every <header>,
   * <footer> and <nav> also removes an article's byline header and the
   * previous/next pagination, which are page content — that made complete pages
   * report their own bylines as missing.
   */
  $('footer, #footer, #header, .sqs-announcement-bar').remove()
  $('body > header, body > nav').remove()

  return $('body').text()
}

/**
 * Significant words, lowercased. Short words carry no signal and add noise.
 *
 * Immediately repeated words are collapsed. Squarespace prints several labels
 * twice for assistive technology — "Previous Previous <title>" at the foot of
 * every post, and the author in both the byline and the meta row — so without
 * this every article reads as missing words it actually renders once.
 */
function words(text) {
  const all = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'%&/ ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)

  return all.filter((w, i) => w !== all[i - 1])
}

/**
 * Runs of consecutive words from the original that appear nowhere in the
 * rebuild. This is the signal that matters: a dropped paragraph shows up as a
 * long absent run, whereas a word-count shortfall is usually just Squarespace
 * printing the same meta line twice.
 */
function absentRuns(originalText, builtText) {
  const normalise = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
  const haystack = normalise(builtText)
  const tokens = originalText.replace(/\s+/g, ' ').trim().split(' ')

  const runs = []
  let current = []
  for (let i = 0; i < tokens.length; i++) {
    const window = tokens.slice(i, i + 6).join(' ')
    if (window.length > 20 && !haystack.includes(normalise(window))) current.push(tokens[i])
    else {
      if (current.length > 5) runs.push(current.join(' '))
      current = []
    }
  }
  if (current.length > 5) runs.push(current.join(' '))

  /*
   * Drop runs whose every word is on the page somewhere. Those are reordering,
   * not loss: a button label sitting next to a heading in the original ends up
   * in a different grid cell here, so the two are no longer adjacent even though
   * both are present. Only a run containing a word that appears nowhere is
   * evidence that something was dropped.
   */
  /*
   * A run only counts as loss if it contains a word that appears nowhere on the
   * page. `previous`/`next` are excluded: Squarespace prints the pagination
   * label on the first and last post of a collection even though there is no
   * neighbouring post to link to, and the rebuild omits the dead label.
   */
  const PAGINATION_LABELS = new Set(['previous', 'next'])
  /* Dates are rendered as "17 March 2026" rather than Squarespace's US-style
   * 3/17/26, so the raw tokens differ even though the date is shown. */
  const isDate = (word) => /^\d{1,4}[\d/.-]{2,}$/.test(word)

  return runs.filter((run) =>
    run
      .split(' ')
      .map((w) => w.toLowerCase().replace(/[^a-z0-9/.-]/g, ''))
      .some(
        (word) =>
          word.length >= 4 &&
          !PAGINATION_LABELS.has(word) &&
          !isDate(word) &&
          !haystack.includes(normalise(word)),
      ),
  )
}

/** Words in the original that the rebuild does not have enough of. */
function missingWords(originalWords, builtWords) {
  const have = new Map()
  for (const w of builtWords) have.set(w, (have.get(w) ?? 0) + 1)

  const missing = new Map()
  for (const w of originalWords) {
    const remaining = have.get(w) ?? 0
    if (remaining > 0) have.set(w, remaining - 1)
    else missing.set(w, (missing.get(w) ?? 0) + 1)
  }
  return missing
}

const slugToRoute = (slug) => (slug === 'index' ? '/' : `/${slug.replace(/--/g, '/')}`)

const snapshots = (await readdir(RAW)).filter((f) => f.endsWith('.html'))
const rows = []

for (const file of snapshots) {
  const route = slugToRoute(file.replace(/\.html$/, ''))
  const builtPath = path.join(OUT, route === '/' ? '' : route, 'index.html')
  if (!existsSync(builtPath)) continue

  const originalText = visibleText(await readFile(path.join(RAW, file), 'utf8'))
  const builtText = visibleText(await readFile(builtPath, 'utf8'))
  const originalWords = words(originalText)
  const builtWords = words(builtText)
  if (!originalWords.length) continue

  const runs = absentRuns(originalText, builtText)

  const missing = missingWords(originalWords, builtWords)
  const missingCount = [...missing.values()].reduce((a, b) => a + b, 0)

  rows.push({
    route,
    coverage: 1 - missingCount / originalWords.length,
    originalWords: originalWords.length,
    missingCount,
    sample: [...missing.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w, n]) => (n > 1 ? `${w}×${n}` : w)),
    runs,
    expected: EXPECTED_DIFFERENCES.has(route),
  })
}

rows.sort((a, b) => a.coverage - b.coverage)

const pct = (n) => `${(n * 100).toFixed(1)}%`
console.log(`${'route'.padEnd(46)}${'coverage'.padStart(9)}${'words'.padStart(8)}  missing words`)
console.log('-'.repeat(100))

for (const r of rows) {
  const flag = r.expected ? ' (expected)' : ''
  console.log(
    r.route.slice(0, 44).padEnd(46) +
      pct(r.coverage).padStart(9) +
      String(r.originalWords).padStart(8) +
      '  ' +
      (r.missingCount ? r.sample.join(', ').slice(0, 70) + flag : ''),
  )
}

console.log(`\n${rows.length} pages compared.`)

/*
 * Coverage below 100% is normal and not a failure on its own: Squarespace
 * prints post meta and pagination labels twice, so a complete page still reads
 * as missing a few words. An absent RUN of words is the real signal.
 */
const withMissingRuns = rows.filter((r) => r.runs.length && !r.expected)

if (withMissingRuns.length) {
  console.log(`\nText present in the original and absent from the rebuild:`)
  for (const r of withMissingRuns) {
    console.log(`\n  ${r.route}`)
    for (const run of r.runs.slice(0, 4)) console.log(`    · ${run.slice(0, 110)}`)
    if (r.runs.length > 4) console.log(`    … and ${r.runs.length - 4} more`)
  }
  process.exit(1)
}

console.log('No page is missing a run of text from its original.')

#!/usr/bin/env node
/**
 * Records each section divider's shape into archive/dividers.json.
 *
 * Squarespace ships `d="M0,0"` in the HTML and computes the real clip path in
 * the browser, so the shapes do not exist in archive/raw/. Without them the
 * sections that should end in a slant or a chevron render as plain rectangles.
 *
 * The output is committed: once the subscription lapses there is nowhere left to
 * measure it from. Re-run with `npm run capture:dividers` only while the
 * Squarespace site is still up.
 *
 * Needs Playwright, which the rest of the migration does not — install it
 * (`npx playwright install chromium`) before running.
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const ORIGIN = 'https://www.eurosense.eu'
const OUT = path.join(import.meta.dirname, '..', 'archive', 'dividers.json')

/** Every page that has at least one `.has-section-divider`. */
const ROUTES = [
  '/',
  '/home',
  '/home-2',
  '/blognews',
  '/dashboard',
  '/forpartners',
  '/new-page',
  '/newsletter',
  '/our-partners',
]

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setViewportSize({ width: 1440, height: 900 })

const bySectionId = {}

for (const route of ROUTES) {
  let captured = false

  for (let attempt = 1; attempt <= 3 && !captured; attempt++) {
    try {
      await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForSelector('.has-section-divider', { timeout: 20000 })
      // The path is written by Squarespace's own controller after first paint.
      await page.waitForTimeout(1500)

      const found = await page.evaluate(() =>
        [...document.querySelectorAll('.has-section-divider')].map((section) => ({
          id: section.getAttribute('data-section-id'),
          d: section.querySelector('.section-divider-clip')?.getAttribute('d'),
          height: getComputedStyle(section.querySelector('.section-divider-display'))
            .getPropertyValue('--divider-height')
            .trim(),
        })),
      )

      for (const item of found) {
        // `M0,0` is the placeholder, i.e. the controller has not run yet.
        if (!item.id || !item.d || item.d === 'M0,0') continue
        bySectionId[item.id] = {
          path: item.d.replace(/\s+/g, ' ').trim(),
          height: item.height,
          page: route,
        }
      }

      console.log(`${route}: ${found.length} divider(s)`)
      captured = true
    } catch (error) {
      console.warn(`${route}: attempt ${attempt} failed — ${String(error).slice(0, 80)}`)
    }
  }

  if (!captured) console.error(`${route}: NOT captured; its sections will render square`)
}

await writeFile(OUT, `${JSON.stringify(bySectionId, null, 2)}\n`)
console.log(`\nWrote ${Object.keys(bySectionId).length} dividers to archive/dividers.json`)
await browser.close()

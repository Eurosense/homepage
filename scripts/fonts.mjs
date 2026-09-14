#!/usr/bin/env node
/**
 * Downloads Satoshi from Fontshare into src/fonts/ so the site self-hosts it.
 *
 * The original Squarespace site served Satoshi (as 'satoshi-sfp7c1') from
 * Squarespace's own font CDN, which goes away with the subscription. Satoshi is
 * free under the ITF Free Font Licence, which permits self-hosting.
 *
 * Roboto is not handled here: next/font/google downloads and self-hosts it at
 * build time.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.join(import.meta.dirname, '..', 'src', 'fonts')
const WEIGHTS = [400, 500, 700]
const CSS_URL = `https://api.fontshare.com/v2/css?f%5B%5D=satoshi@${WEIGHTS.join(',')}&display=swap`

// Fontshare serves the stylesheet only to browser-like clients.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const css = await fetch(CSS_URL, { headers: { 'User-Agent': UA } }).then((r) => {
  if (!r.ok) throw new Error(`Fontshare CSS failed: HTTP ${r.status}`)
  return r.text()
})

/*
 * Each @font-face lists woff2 first, then woff. Pairing the weight with the
 * first URL in its own block keeps them aligned; a global URL scan would mix
 * weights up. The family check is not redundant: Fontshare appends @font-face
 * blocks for an unrelated promoted family (currently Clash Display) to every
 * response, and those would otherwise be saved as Satoshi weights.
 */
const faces = css.split('@font-face').slice(1)
await mkdir(OUT, { recursive: true })

const downloaded = []
for (const face of faces) {
  const family = face.match(/font-family:\s*'([^']+)'/)?.[1]
  const weight = face.match(/font-weight:\s*(\d+)/)?.[1]
  const url = face.match(/url\('(\/\/[^']+\.woff2)'\)/)?.[1]
  const upright = !/font-style:\s*italic/.test(face)
  if (family !== 'Satoshi' || !upright) continue
  if (!weight || !url || !WEIGHTS.includes(Number(weight))) continue

  const res = await fetch(`https:${url}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Satoshi ${weight} failed: HTTP ${res.status}`)

  const file = `Satoshi-${weight}.woff2`
  await writeFile(path.join(OUT, file), Buffer.from(await res.arrayBuffer()))
  downloaded.push(file)
}

if (downloaded.length !== WEIGHTS.length) {
  throw new Error(`Expected ${WEIGHTS.length} weights, got ${downloaded.length}`)
}

console.log(`Satoshi -> src/fonts/: ${downloaded.join(', ')}`)

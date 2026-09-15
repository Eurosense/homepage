#!/usr/bin/env node
/**
 * Records each post's thumbnail dimensions in its front matter.
 *
 * The original blog index is a masonry grid: every card is as tall as its image
 * needs, so nothing is cropped. Without the intrinsic size there is nothing to
 * lay out against, so the migrated list used one fixed height for every card and
 * a 4:3 photo came through as a thin horizontal slice.
 *
 * Kept in front matter rather than measured during the build so the content
 * stays self-describing: an agent adding a post can fill these in, or re-run
 * `npm run measure:posts`.
 *
 * Run this AFTER `npm run extract:assets`. Straight out of `extract:parse` the
 * `image:` field still points at the Squarespace CDN, and this script only
 * measures files it can find in public/, so it would silently do nothing.
 */

import { readdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.join(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const PUBLIC = path.join(ROOT, 'public')

/** Collection directories hold .md posts; content/pages holds .json. */
const collections = (await readdir(CONTENT, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== 'pages')
  .map((entry) => entry.name)

let updated = 0
let skipped = 0

for (const collection of collections) {
  const dir = path.join(CONTENT, collection)
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
    const full = path.join(dir, file)
    const raw = await readFile(full, 'utf8')

    const match = raw.match(/^---\n([\s\S]*?)\n---\n/)
    if (!match) continue
    const frontMatter = match[1]

    const image = frontMatter.match(/^image:\s*(\S+)\s*$/m)?.[1]
    if (!image || !image.startsWith('/')) continue
    if (/^imageWidth:/m.test(frontMatter)) {
      skipped++
      continue
    }

    const onDisk = path.join(PUBLIC, image)
    try {
      await stat(onDisk)
    } catch {
      console.warn(`  ! ${file}: ${image} is not on disk`)
      continue
    }

    const { width, height } = await sharp(onDisk).metadata()
    if (!width || !height) {
      console.warn(`  ! ${file}: could not read dimensions of ${image}`)
      continue
    }

    const withDims = frontMatter.replace(
      /^(image:\s*\S+\s*)$/m,
      `$1\nimageWidth: ${width}\nimageHeight: ${height}`,
    )
    await writeFile(full, raw.replace(match[1], withDims))
    updated++
  }
}

console.log(`${updated} post(s) measured, ${skipped} already had dimensions.`)

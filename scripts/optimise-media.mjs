#!/usr/bin/env node
/**
 * Shrinks public/media in place.
 *
 * The site is a static export, so next/image has no optimiser behind it and
 * ships whatever is on disk. The originals came off Squarespace at up to 5 MB
 * and 2500px, which no layout here needs.
 *
 * Re-encodes above MAX_WIDTH or QUALITY and keeps the original format, so
 * content references stay valid. Idempotent: a second run finds nothing to do.
 * Originals remain in archive/assets.json and can be re-fetched with
 * `npm run extract:assets` after deleting public/media.
 */

import { readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const MEDIA = path.join(import.meta.dirname, '..', 'public', 'media')
const MAX_WIDTH = 1800
const QUALITY = 80
const MIN_SAVING = 0.05

const files = (await readdir(MEDIA)).filter((f) => /\.(png|jpe?g)$/i.test(f))

let before = 0
let after = 0
let changed = 0

for (const file of files) {
  const full = path.join(MEDIA, file)
  const original = (await stat(full)).size
  before += original

  const image = sharp(full, { failOn: 'none' })
  const meta = await image.metadata()

  const pipeline =
    meta.width && meta.width > MAX_WIDTH
      ? image.resize({ width: MAX_WIDTH, withoutEnlargement: true })
      : image

  const encoded = /\.png$/i.test(file)
    ? await pipeline.png({ quality: QUALITY, compressionLevel: 9, palette: true }).toBuffer()
    : await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer()

  // Writing a larger file would make the run actively harmful, and writing a
  // marginally smaller one just churns git history for nothing.
  if (encoded.length < original * (1 - MIN_SAVING)) {
    await writeFile(full, encoded)
    after += encoded.length
    changed++
  } else {
    after += original
  }
}

const mb = (n) => (n / 1048576).toFixed(1)
console.log(
  `${changed}/${files.length} re-encoded: ${mb(before)} MB -> ${mb(after)} MB ` +
    `(${(((before - after) / before) * 100).toFixed(0)}% smaller)`,
)

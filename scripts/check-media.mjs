#!/usr/bin/env node
/**
 * Fails the build when content references media that is not committed.
 *
 * This is the failure this repo is most exposed to: `next build` is perfectly
 * happy to prerender an <img> whose file is missing, so a dropped or renamed
 * asset ships as a broken image instead of a red build. Everything here used
 * to live on Squarespace's CDN, so a missing file cannot be recovered once the
 * subscription ends.
 *
 * Also reports assets nobody references. Those are not fatal — an editor may
 * be about to use one — but they are worth seeing.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const MEDIA = path.join(ROOT, 'public', 'media')

const MEDIA_REF = /\/media\/[A-Za-z0-9._%-]+/g
const SQUARESPACE_REF = /(?:images\.squarespace-cdn\.com|static1\.squarespace\.com)/

async function contentFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await contentFiles(full)))
    else if (/\.(md|json)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = await contentFiles(CONTENT)
const onDisk = new Set(
  (await readdir(MEDIA, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name),
)

const referenced = new Map()
const stillOnSquarespace = []

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const relative = path.relative(ROOT, file)

  if (SQUARESPACE_REF.test(text)) stillOnSquarespace.push(relative)

  for (const match of text.matchAll(MEDIA_REF)) {
    const name = decodeURIComponent(match[0].replace('/media/', ''))
    if (!referenced.has(name)) referenced.set(name, relative)
  }
}

const missing = [...referenced].filter(([name]) => !onDisk.has(name))
const unreferenced = [...onDisk].filter((name) => !referenced.has(name))

const empty = []
for (const name of onDisk) {
  if ((await stat(path.join(MEDIA, name))).size === 0) empty.push(name)
}

console.log(`content files   ${files.length}`)
console.log(`media referenced ${referenced.size}`)
console.log(`media on disk    ${onDisk.size}`)

let failed = false

if (missing.length) {
  failed = true
  console.error(`\n${missing.length} referenced asset(s) missing from public/media:`)
  for (const [name, source] of missing) console.error(`  ${name}  (referenced by ${source})`)
}

if (empty.length) {
  failed = true
  console.error(`\n${empty.length} zero-byte asset(s):`)
  for (const name of empty) console.error(`  ${name}`)
}

if (stillOnSquarespace.length) {
  failed = true
  console.error(`\n${stillOnSquarespace.length} file(s) still point at Squarespace's CDN:`)
  for (const file of stillOnSquarespace) console.error(`  ${file}`)
  console.error('  Run `npm run extract:assets` to download and rewrite them.')
}

if (unreferenced.length) {
  console.log(`\n${unreferenced.length} asset(s) on disk but unreferenced (not an error):`)
  for (const name of unreferenced.slice(0, 10)) console.log(`  ${name}`)
  if (unreferenced.length > 10) console.log(`  … and ${unreferenced.length - 10} more`)
}

if (failed) process.exit(1)
console.log('\nAll media references resolve.')

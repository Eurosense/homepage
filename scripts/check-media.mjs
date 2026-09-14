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
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const MEDIA = path.join(ROOT, 'public', 'media')
const FILES = path.join(ROOT, 'public', 'files')

// Includes the video/ subdirectory, so /media/video/x.mp4 resolves too.
const MEDIA_REF = /\/media\/(?:video\/)?[A-Za-z0-9._%-]+/g
const FILE_REF = /\/files\/[A-Za-z0-9._%+-]+/g
/* A surviving /s/ path is a Squarespace-hosted upload that will 404 on cancellation. */
const SQSP_FILE_REF = /["(]\/s\/[A-Za-z0-9._%+-]+\.[A-Za-z0-9]{2,5}/
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
async function mediaNames(dir, prefix = '') {
  const names = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) names.push(...(await mediaNames(path.join(dir, entry.name), `${prefix}${entry.name}/`)))
    else names.push(`${prefix}${entry.name}`)
  }
  return names
}

const onDisk = new Set(await mediaNames(MEDIA))

const referenced = new Map()
const referencedFiles = new Map()
const stillOnSquarespace = []

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const relative = path.relative(ROOT, file)

  if (SQUARESPACE_REF.test(text) || SQSP_FILE_REF.test(text)) stillOnSquarespace.push(relative)

  for (const match of text.matchAll(FILE_REF)) {
    const name = decodeURIComponent(match[0].replace('/files/', ''))
    if (!referencedFiles.has(name)) referencedFiles.set(name, relative)
  }

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
const filesOnDisk = new Set(existsSync(FILES) ? await readdir(FILES) : [])
const missingFiles = [...referencedFiles].filter(([name]) => !filesOnDisk.has(name))

console.log(`media on disk    ${onDisk.size}`)
console.log(`downloads        ${referencedFiles.size} referenced / ${filesOnDisk.size} on disk`)

let failed = false

if (missingFiles.length) {
  failed = true
  console.error(`\n${missingFiles.length} referenced download(s) missing from public/files:`)
  for (const [name, source] of missingFiles) console.error(`  ${name}  (referenced by ${source})`)
}

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

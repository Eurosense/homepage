#!/usr/bin/env node
/**
 * Downloads Google Drive documents into public/files/ and repoints content at
 * the local copies.
 *
 * The publications page linked six papers, five of them on someone's Drive. That
 * is the same dependency this migration exists to remove: a Drive file survives
 * only as long as its sharing setting and the account that owns it, and until
 * then every visitor's IP goes to Google before the page can render. Framing
 * `/preview` also fails quietly — signed-out browsers get a blank panel rather
 * than an error, so the page looks broken with nothing in the console to explain
 * it.
 *
 * Self-hosted, the PDFs render in the browser's own viewer, load from the same
 * origin, and keep working when the Drive links do not.
 *
 * Run with `npm run documents`. Idempotent: files already on disk are skipped.
 */

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const PAGES = path.join(ROOT, 'content', 'pages')
const FILES = path.join(ROOT, 'public', 'files')

/** A filename that stays readable in a URL and cannot collide across titles. */
function slugify(title, driveId) {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
    .replace(/-$/, '')
  // The Drive id keeps two papers with similar titles from overwriting each other.
  return `${base}-${driveId.slice(0, 8)}.pdf`
}

await mkdir(FILES, { recursive: true })

const pages = (await readdir(PAGES)).filter((f) => f.endsWith('.json'))
let downloaded = 0
let reused = 0
let rewritten = 0

for (const file of pages) {
  const full = path.join(PAGES, file)
  const page = JSON.parse(await readFile(full, 'utf8'))
  let changed = false

  for (const section of page.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block.type !== 'document' || !block.driveId) continue

      const name = slugify(block.title, block.driveId)
      const dest = path.join(FILES, name)

      if (existsSync(dest) && (await stat(dest)).size > 0) {
        reused++
      } else {
        const url = `https://drive.usercontent.google.com/download?id=${block.driveId}&export=download`
        const res = await fetch(url)
        if (!res.ok) {
          console.warn(`  ! ${block.title}: HTTP ${res.status} — left pointing at Drive`)
          continue
        }
        const buffer = Buffer.from(await res.arrayBuffer())

        /*
         * Drive answers a virus-scan interstitial with 200 and an HTML body for
         * files above ~25 MB. Writing that as a .pdf would produce a viewer
         * showing garbage, so check the magic number rather than the status.
         */
        if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
          console.warn(`  ! ${block.title}: not a PDF — left pointing at Drive`)
          continue
        }

        await writeFile(dest, buffer)
        console.log(`  + ${name} (${(buffer.length / 1048576).toFixed(1)} MB)`)
        downloaded++
      }

      // Keep the Drive URL: it is where the file came from, and the only way to
      // re-fetch a newer revision later.
      block.sourceHref = block.href
      block.href = `/files/${name}`
      block.kind = 'pdf'
      delete block.driveId
      changed = true
      rewritten++
    }
  }

  if (changed) await writeFile(full, `${JSON.stringify(page, null, 2)}\n`)
}

console.log(
  `\n${rewritten} document(s) now local: ${downloaded} downloaded, ${reused} already on disk.`,
)

#!/usr/bin/env node
/**
 * Downloads Squarespace-hosted videos into public/media/video/.
 *
 * These are the last assets that still lived on Squarespace. They are not plain
 * files: each is an HLS stream (playlist.m3u8) whose segment URLs are signed and
 * expire, so they cannot be fetched with the asset stage's plain GET. ffmpeg
 * follows the playlist and remuxes the segments into one MP4 without
 * re-encoding, so this is a copy rather than a re-compression.
 *
 * Separate from `extract.mjs` because it needs ffmpeg, which the rest of the
 * migration does not. Run it with `npm run videos`.
 */

import { mkdir, writeFile, readFile, readdir, stat, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import * as cheerio from 'cheerio'

const run = promisify(execFile)

const ROOT = path.join(import.meta.dirname, '..')
const RAW = path.join(ROOT, 'archive', 'raw', 'pages')
const OUT = path.join(ROOT, 'public', 'media', 'video')
const MANIFEST = path.join(ROOT, 'archive', 'videos.json')

try {
  await run('ffmpeg', ['-version'])
} catch {
  console.error('ffmpeg is required: brew install ffmpeg')
  process.exit(1)
}

/** Every distinct native video referenced anywhere in the snapshots. */
async function findVideos() {
  const found = new Map()
  for (const file of (await readdir(RAW)).filter((f) => f.endsWith('.html'))) {
    const $ = cheerio.load(await readFile(path.join(RAW, file), 'utf8'))
    $('.sqs-native-video').each((_i, el) => {
      const raw = $(el).attr('data-config-video')
      if (!raw) return
      let config
      try {
        config = JSON.parse(raw)
      } catch {
        return
      }
      const id = config.systemDataId
      const base = config.alexandriaUrl?.replace('/{variant}', '')
      if (!id || !base || found.has(id)) return
      found.set(id, {
        id,
        base,
        aspectRatio: config.aspectRatio,
        duration: config.durationSeconds,
      })
    })
  }
  return [...found.values()]
}

const videos = await findVideos()
if (!videos.length) {
  console.log('No Squarespace-hosted videos found.')
  process.exit(0)
}

await mkdir(OUT, { recursive: true })
await mkdir(path.join(ROOT, 'archive', 'video-optimised'), { recursive: true })
const manifest = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')) : {}

for (const video of videos) {
  const name = `${video.id}.mp4`
  const dest = path.join(OUT, name)

  if (existsSync(dest) && (await stat(dest)).size > 0) {
    console.log(`${video.id}: already downloaded`)
  } else {
    console.log(`${video.id}: downloading…`)
    /*
     * `-allowed_extensions ALL` is required: the segment URLs have no file
     * extension, and ffmpeg's HLS demuxer refuses unknown ones by default.
     * `-c copy` remuxes without re-encoding; the aac bitstream filter is needed
     * to move ADTS audio into MP4.
     */
    await run('ffmpeg', [
      '-loglevel', 'error',
      '-y',
      '-allowed_extensions', 'ALL',
      '-extension_picky', '0',
      '-i', `${video.base}/playlist.m3u8`,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      dest,
    ])
  }

  /*
   * Re-encode for the web. Squarespace served these adaptively; we serve one
   * file, and the copied stream is ~3 Mbps, which is a lot to push for a looping
   * clip. CRF 24 keeps it visually clean at roughly half the size, and faststart
   * moves the index to the front so playback can begin before the file arrives.
   */
  // Kept out of public/: it is build state, not something to serve.
  const optimisedMarker = path.join(ROOT, 'archive', 'video-optimised', `${video.id}`)
  if (!existsSync(optimisedMarker)) {
    const tmp = path.join(OUT, `${video.id}.tmp.mp4`)
    await run('ffmpeg', [
      '-loglevel', 'error', '-y', '-i', dest,
      '-c:v', 'libx264', '-crf', '24', '-preset', 'slow',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart', tmp,
    ])
    const before = (await stat(dest)).size
    const after = (await stat(tmp)).size
    if (after < before) {
      await rename(tmp, dest)
      console.log(`  optimised ${(before / 1048576).toFixed(1)} -> ${(after / 1048576).toFixed(1)} MB`)
    } else {
      await rm(tmp)
    }
    await writeFile(optimisedMarker, '')
  }

  // A poster keeps the space reserved and gives something to look at before play.
  const posterName = `${video.id}.jpg`
  const posterPath = path.join(OUT, posterName)
  if (!existsSync(posterPath)) {
    const res = await fetch(`${video.base}/thumbnail`, { headers: { Accept: 'image/*' } })
    if (res.ok) await writeFile(posterPath, Buffer.from(await res.arrayBuffer()))
  }

  manifest[video.id] = {
    src: `/media/video/${name}`,
    poster: existsSync(posterPath) ? `/media/video/${posterName}` : undefined,
    aspectRatio: video.aspectRatio,
    duration: video.duration,
  }

  const size = (await stat(dest)).size
  console.log(`  -> ${name} (${(size / 1048576).toFixed(1)} MB)`)
}

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\n${videos.length} video(s) in public/media/video/`)

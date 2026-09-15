#!/usr/bin/env node
/**
 * Validates everything in content/ against the shape the site expects.
 *
 * This exists because the failure modes here are quiet. A block with a
 * misspelled `type` renders as nothing, a post with a malformed `date` sorts to
 * the bottom, and a page with a duplicate `urlPath` silently shadows another.
 * None of that fails `next build`, so an edit can look successful and still be
 * wrong — which is the hardest kind of mistake for an agent to notice.
 *
 * Run it with `npm run validate`. CI runs it on every pull request.
 *
 * The schemas below mirror the types in src/lib/content.ts. If you add a block
 * type, add it in three places: the union there, the renderer in
 * src/components/BlockRenderer.tsx, and here.
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const ROOT = path.join(import.meta.dirname, '..')
const CONTENT = path.join(ROOT, 'content')
const MEDIA = path.join(ROOT, 'public', 'media')

/* Must match COLLECTION_ROUTES in src/lib/content.ts. `blog` was Squarespace's
 * demo blog and now lives in archive/unpublished/. */
const COLLECTIONS = ['blognews', 'resources--multimedia']

const problems = []
const note = (file, message) => problems.push({ file, message })

const mediaPath = z
  .string()
  .refine(
    (v) => !/squarespace/.test(v),
    'points at Squarespace; run `npm run extract:assets` while the subscription is live',
  )
  .refine(
    (v) =>
      !v.startsWith('/media/') || existsSync(path.join(MEDIA, decodeURIComponent(v.slice(7)))),
    'references a file that is not in public/media/',
  )

const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('richText'), html: z.string().min(1) }),
  z.object({
    type: z.literal('image'),
    src: mediaPath,
    alt: z.string().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    caption: z.string().optional(),
    href: z.string().optional(),
  }),
  z.object({
    type: z.literal('button'),
    label: z.string().min(1),
    href: z.string().min(1),
    variant: z.enum(['primary', 'secondary', 'tertiary']).optional(),
    size: z.enum(['small', 'medium', 'large']).optional(),
    alignment: z.string().optional(),
    stretched: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('video'),
    src: z.string(),
    title: z.string().optional(),
    poster: z.string().optional(),
    aspectRatio: z.number().optional(),
    autoPlay: z.boolean().optional(),
    loop: z.boolean().optional(),
    muted: z.boolean().optional(),
    caption: z.string().optional(),
  }),
  z.object({ type: z.literal('embed'), html: z.string() }),
  z.object({ type: z.literal('quote'), text: z.string(), source: z.string().optional() }),
  z.object({ type: z.literal('divider') }),
  z.object({ type: z.literal('postList') }),
  z.object({
    type: z.literal('form'),
    title: z.string().optional(),
    submitLabel: z.string().optional(),
    formId: z.string(),
    fields: z.array(
      z.object({
        label: z.string(),
        name: z.string().min(1),
        type: z.string(),
        required: z.boolean(),
      }),
    ),
  }),
  z.object({
    type: z.literal('accordion'),
    items: z
      .array(
        z.object({ title: z.string(), markdown: z.string(), large: z.boolean().optional() }),
      )
      .min(1),
    expandFirst: z.boolean().optional(),
  }),
  z.object({ type: z.literal('gallery'), html: z.string() }),
  z.object({ type: z.literal('summary-v2'), html: z.string() }),
  z.object({
    type: z.literal('list'),
    items: z
      .array(
        z.object({
          image: mediaPath.optional(),
          imageWidth: z.number().optional(),
          imageHeight: z.number().optional(),
          alt: z.string().optional(),
          title: z.string().optional(),
          description: z.string().optional(),
          href: z.string().optional(),
          buttonLabel: z.string().optional(),
          buttonHref: z.string().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    type: z.literal('document'),
    title: z.string().min(1),
    href: z.string().min(1),
    driveId: z.string().optional(),
    sourceHref: z.string().optional(),
    kind: z.enum(['pdf', 'drive', 'spreadsheet']),
    description: z.string().optional(),
  }),
  z.object({
    type: z.literal('shape'),
    shape: z.string(),
    fill: z.string(),
  }),
  z.object({
    type: z.literal('search'),
    placeholder: z.string(),
  }),
  z.object({
    type: z.literal('socialLinks'),
    links: z.array(z.object({ href: z.string(), label: z.string() })).min(1),
  }),
  z.object({
    type: z.literal('instagram'),
    posts: z
      .array(
        z.object({ href: z.string().optional(), image: mediaPath, alt: z.string().optional() }),
      )
      .min(1),
  }),
])

const placement = z
  .object({
    area: z.string().optional(),
    zIndex: z.number().optional(),
    justify: z.string().optional(),
    align: z.string().optional(),
  })
  .optional()

const positioned = z.intersection(
  block,
  z.object({
    layout: z.object({ mobile: placement, desktop: placement }).optional(),
    surface: z
      .object({
        background: z.string().optional(),
        radius: z.string().optional(),
        padding: z.string().optional(),
      })
      .optional(),
  }),
)

const page = z.object({
  urlPath: z.string().startsWith('/'),
  title: z.string(),
  description: z.string(),
  ogImage: z.string().optional(),
  sections: z.array(
    z.object({
      id: z.string().optional(),
      /** The author's anchor name, target of an in-page link like `#request-access`. */
      anchor: z.string().optional(),
      minHeight: z.string().optional(),
      verticalAlign: z.enum(['start', 'center', 'end']).optional(),
      theme: z.string().optional(),
      background: mediaPath.optional(),
      divider: z.object({ path: z.string().min(1), height: z.string().min(1) }).optional(),
      grid: z.record(z.string(), z.unknown()).optional(),
      blocks: z.array(positioned),
    }),
  ),
})

const siteChrome = z.object({
  siteTitle: z.string().min(1),
  logo: mediaPath,
  logoAlt: z.string(),
  favicon: mediaPath,
  nav: z.array(z.object({ label: z.string().min(1), href: z.string().min(1) })).min(1),
  social: z.array(z.object({ platform: z.string(), href: z.string() })),
  footerGrid: z.record(z.string(), z.unknown()).optional(),
  footerBlocks: z.array(
    z.intersection(
      block,
      z.object({
        theme: z.string().optional(),
        layout: z.object({ mobile: placement, desktop: placement }).optional(),
      }),
    ),
  ),
})

const formsFile = z.object({
  hubspotNewsletter: z
    .object({
      intro: z.string().optional(),
      submitLabel: z.string().optional(),
      successMessage: z.string().optional(),
      fields: z
        .array(
          z.object({
            name: z.string().min(1),
            label: z.string().min(1),
            type: z.string(),
            required: z.boolean(),
          }),
        )
        .min(1),
      checkboxGroup: z
        .object({
          name: z.string().min(1),
          intro: z.string().optional(),
          label: z.string().optional(),
          options: z.array(z.object({ value: z.string(), label: z.string() })).min(1),
        })
        .optional(),
    })
    .optional(),
  hubspotDefaults: z.object({ portalId: z.string(), region: z.string() }).optional(),
  forms: z.record(
    z.string(),
    z
      .object({
        name: z.string(),
        provider: z.enum(['hubspot', 'deploybase', 'mailto']).nullable().optional(),
        deploybaseFormId: z.string().nullable().optional(),
        hubspot: z
          .object({
            portalId: z.string().optional(),
            formId: z.string().optional(),
            region: z.string().optional(),
          })
          .optional(),
        mailto: z.object({ to: z.string().email(), subject: z.string().optional() }).optional(),
      })
      .refine(
        (f) => f.provider !== 'hubspot' || Boolean(f.hubspot?.formId),
        'provider is "hubspot" but hubspot.formId is missing',
      )
      .refine(
        (f) => f.provider !== 'deploybase' || Boolean(f.deploybaseFormId),
        'provider is "deploybase" but deploybaseFormId is missing',
      )
      .refine(
        (f) => f.provider !== 'mailto' || Boolean(f.mailto?.to),
        'provider is "mailto" but mailto.to is missing',
      ),
  ),
})

function report(file, result) {
  if (result.success) return result.data
  for (const issue of result.error.issues) {
    note(file, `${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
  return null
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (err) {
    note(path.relative(ROOT, file), `is not valid JSON — ${err.message}`)
    return null
  }
}

const siteRaw = await readJson(path.join(CONTENT, 'site.json'))
if (siteRaw) report('content/site.json', siteChrome.safeParse(siteRaw))

const formsRaw = await readJson(path.join(CONTENT, 'forms.json'))
if (formsRaw) report('content/forms.json', formsFile.safeParse(formsRaw))

const pageFiles = (await readdir(path.join(CONTENT, 'pages'))).filter((f) =>
  f.endsWith('.json'),
)
const seenPaths = new Map()

for (const file of pageFiles) {
  const relative = `content/pages/${file}`
  const raw = await readJson(path.join(CONTENT, 'pages', file))
  if (!raw) continue

  const parsed = report(relative, page.safeParse(raw))
  if (!parsed) continue

  const normalised = parsed.urlPath.replace(/\/+$/, '') || '/'
  if (seenPaths.has(normalised)) {
    note(
      relative,
      `urlPath "${parsed.urlPath}" is already used by ${seenPaths.get(normalised)}`,
    )
  } else {
    seenPaths.set(normalised, relative)
  }
}

let postCount = 0

for (const collection of COLLECTIONS) {
  const dir = path.join(CONTENT, collection)
  if (!existsSync(dir)) continue

  const slugs = new Set()
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
    postCount++
    const relative = `content/${collection}/${file}`
    const text = await readFile(path.join(dir, file), 'utf8')

    if (!text.startsWith('---')) {
      note(relative, 'has no YAML front matter')
      continue
    }

    const head = text.slice(4, text.indexOf('\n---', 3))
    const field = (name) => head.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim()

    const title = field('title')
    const slug = field('slug')
    const date = field('date')
    const image = field('image')

    if (!title) note(relative, 'front matter is missing `title`')

    const expected = file.replace(/\.md$/, '')
    if (!slug) note(relative, 'front matter is missing `slug`')
    else if (slug.replace(/^"|"$/g, '') !== expected) {
      note(relative, `slug "${slug}" does not match the filename "${expected}"`)
    } else if (slugs.has(slug)) {
      note(relative, `slug "${slug}" is used twice in ${collection}`)
    } else {
      slugs.add(slug)
    }

    if (date && Number.isNaN(Date.parse(date.replace(/^"|"$/g, '')))) {
      note(relative, `date "${date}" is not a parsable date`)
    }

    if (image) {
      const value = image.replace(/^"|"$/g, '')
      const result = mediaPath.safeParse(value)
      if (!result.success) note(relative, `image ${result.error.issues[0].message}`)
    }

    for (const match of text.matchAll(/\/media\/[A-Za-z0-9._%-]+/g)) {
      const name = decodeURIComponent(match[0].slice(7))
      if (!existsSync(path.join(MEDIA, name))) {
        note(relative, `body references /media/${name}, which is not in public/media/`)
      }
    }
  }
}

console.log(
  `pages ${pageFiles.length} · posts ${postCount} · media ${(await readdir(MEDIA)).length}`,
)

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n`)
  for (const { file, message } of problems) console.error(`  ${file}\n    ${message}`)
  console.error('\nSee AGENTS.md for the expected shape of each file.')
  process.exit(1)
}

console.log('content/ is valid.')

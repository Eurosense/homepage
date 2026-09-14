/**
 * Reads `content/` at build time. There is no runtime data source: the site is
 * a static export, so every reader here runs during `next build` only.
 */

import fs from 'node:fs'
import path from 'node:path'

const CONTENT_DIR = path.join(process.cwd(), 'content')

export type Block =
  | { type: 'richText'; html: string }
  | {
      type: 'image'
      src: string
      alt?: string
      /** Real pixel size from Squarespace, so the aspect ratio matches the original. */
      width?: number
      height?: number
      caption?: string
      href?: string
    }
  | {
      type: 'button'
      label: string
      href: string
      variant?: 'primary' | 'secondary' | 'tertiary'
      size?: 'small' | 'medium' | 'large'
      alignment?: 'left' | 'center' | 'right'
      /** Squarespace's `sqs-stretched`: fill the grid cell instead of hugging the label. */
      stretched?: boolean
    }
  | { type: 'video'; src: string; title?: string }
  | { type: 'embed'; html: string }
  | { type: 'quote'; text: string; source?: string }
  | { type: 'divider' }
  | { type: 'form'; title?: string; submitLabel?: string; formId?: string; fields: FormField[] }
  | { type: 'accordion'; items: { title: string; markdown: string }[] }
  | { type: 'gallery'; html: string }
  | { type: 'summary-v2'; html: string }
  | {
      type: 'list'
      items: { image?: string; alt?: string; title?: string; description?: string; href?: string }[]
    }
  | {
      type: 'document'
      title: string
      href: string
      /** Present for Google Drive files; used to build the /preview URL. */
      driveId?: string
      kind: 'pdf' | 'drive' | 'spreadsheet'
    }
  | { type: 'instagram'; html: string }

export type FormField = {
  label: string
  name: string
  type: string
  required: boolean
}

/** One breakpoint's placement for a block, as Squarespace's fluid engine wrote it. */
export type Placement = {
  area?: string
  zIndex?: number
  /** Horizontal alignment inside the grid cell. */
  justify?: string
  /** Vertical alignment inside the grid cell. */
  align?: string
}

export type BlockLayout = {
  mobile?: Placement
  desktop?: Placement
}

/** The section's grid: 8 columns under 768px, 24 at and above it. */
export type SectionGrid = {
  mobile?: {
    rows?: number
    rowMin?: string
    columns?: number
    rowGap?: string
    columnGap?: string
  }
  desktop?: {
    rows?: number
    columns?: number
    rowScale?: number
    rowGap?: string
    columnGap?: string
  }
}

export type PositionedBlock = Block & { layout?: BlockLayout }

export type Section = {
  id?: string
  /** Squarespace section theme: decides background, heading, text and button colours. */
  theme?: string
  background?: string
  grid?: SectionGrid
  blocks: PositionedBlock[]
}

export type Page = {
  urlPath: string
  title: string
  description: string
  ogImage?: string
  sections: Section[]
}

export type Post = {
  slug: string
  collection: string
  title: string
  date?: string
  excerpt?: string
  image?: string
  author?: string
  tags: string[]
  categories: string[]
  body: string
  urlPath: string
}

export type SiteChrome = {
  siteTitle: string
  logo: string
  logoAlt: string
  favicon: string
  nav: { label: string; href: string }[]
  social: { platform: string; href: string }[]
  headerCta?: { label: string; href: string }
  /** Footer blocks carry the theme of the Squarespace section they came from. */
  footerBlocks: (Block & { theme?: string })[]
}

/**
 * Directory name in `content/` to public URL prefix. The multimedia collection
 * is nested on the live site but flat on disk, so the two cannot be derived
 * from each other.
 */
export const COLLECTION_ROUTES: Record<string, string> = {
  blognews: '/blognews',
  blog: '/blog',
  'resources--multimedia': '/resources/multimedia',
}

/**
 * Parses the YAML subset that `scripts/extract.mjs` emits: scalars, `- ` lists
 * and one level of nesting. A real YAML parser would work, but the shape is
 * ours and narrow enough that the dependency is not worth it.
 */
function parseFrontMatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) return { data: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: raw }

  const head = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\n+/, '')
  const data: Record<string, unknown> = {}

  let currentKey: string | null = null
  for (const line of head.split('\n')) {
    if (!line.trim()) continue

    const listItem = line.match(/^\s+-\s+(.*)$/)
    if (listItem && currentKey) {
      const arr = (data[currentKey] as unknown[]) ?? []
      arr.push(unquote(listItem[1]))
      data[currentKey] = arr
      continue
    }

    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, value] = kv
    currentKey = key
    data[key] = value === '' ? [] : unquote(value)
  }
  return { data, body }
}

function unquote(v: string): string {
  const t = v.trim()
  if (!t.startsWith('"')) return t
  try {
    return JSON.parse(t) as string
  } catch {
    return t.replace(/^"|"$/g, '')
  }
}

export function normalisePath(p: string): string {
  const trimmed = p.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '/' : `/${trimmed}`
}

export function pathToSegments(p: string): string[] {
  return normalisePath(p).split('/').filter(Boolean)
}

export function getSiteChrome(): SiteChrome {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'site.json'), 'utf8')) as SiteChrome
}

export function getAllPages(): Page[] {
  const dir = path.join(CONTENT_DIR, 'pages')
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Page)
}

export function getPage(urlPath: string): Page | undefined {
  const want = normalisePath(urlPath)
  return getAllPages().find((p) => normalisePath(p.urlPath) === want)
}

export function getPostsIn(collection: string): Post[] {
  const dir = path.join(CONTENT_DIR, collection)
  if (!fs.existsSync(dir)) return []
  const prefix = COLLECTION_ROUTES[collection] ?? `/${collection}`

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const { data, body } = parseFrontMatter(fs.readFileSync(path.join(dir, file), 'utf8'))
      const slug = (data.slug as string) || file.replace(/\.md$/, '')
      return {
        slug,
        collection,
        title: (data.title as string) ?? slug,
        date: data.date as string | undefined,
        excerpt: data.excerpt as string | undefined,
        image: data.image as string | undefined,
        author: data.author as string | undefined,
        tags: (data.tags as string[]) ?? [],
        categories: (data.categories as string[]) ?? [],
        body,
        urlPath: `${prefix}/${slug}`,
      } satisfies Post
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function getAllPosts(): Post[] {
  return Object.keys(COLLECTION_ROUTES).flatMap(getPostsIn)
}

export function getPost(collection: string, slug: string): Post | undefined {
  return getPostsIn(collection).find((p) => p.slug === slug)
}

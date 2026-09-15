import { COLLECTION_ROUTES, getAllPages, getAllPosts, normalisePath } from '@/lib/content'

export const dynamic = 'force-static'

const SITE = 'https://www.eurosense.eu'

/**
 * `/llms.txt`, in the format described at llmstxt.org: a plain-text index of the
 * site for language models, which otherwise have to infer the shape of a site
 * from whichever page they happened to fetch.
 *
 * It is generated from `content/` rather than written by hand for the same
 * reason the sitemap is: a hand-kept list of pages is wrong the first time
 * somebody adds one. Pages under `archive/unpublished/` are not read at build
 * time, so they cannot appear here.
 */

/** Squarespace left " — EuroSense" on every title; the site name is in the heading. */
function cleanTitle(title: string) {
  return title.replace(/\s*[—-]\s*EuroSense\s*$/, '').trim()
}

function line(title: string, urlPath: string, description?: string) {
  const url = SITE + normalisePath(urlPath)
  const suffix = description?.trim() ? `: ${description.trim().replace(/\s+/g, ' ')}` : ''
  return `- [${cleanTitle(title)}](${url})${suffix}`
}

export function GET() {
  const collectionPaths = new Set(Object.values(COLLECTION_ROUTES).map(normalisePath))

  /*
   * `/home` is byte-identical to `/` — a Squarespace convention, and the footer
   * links it — but listing one page twice invites a model to treat them as two
   * things. Identical pages collapse to their shortest path.
   */
  const bySections = new Map<string, string>()
  const pages = getAllPages()
    .filter((page) => !collectionPaths.has(normalisePath(page.urlPath)))
    .sort((a, b) => a.urlPath.length - b.urlPath.length || a.urlPath.localeCompare(b.urlPath))
    .filter((page) => {
      const fingerprint = JSON.stringify(page.sections)
      if (bySections.has(fingerprint)) return false
      bySections.set(fingerprint, page.urlPath)
      return true
    })
    .sort((a, b) => a.urlPath.localeCompare(b.urlPath))

  const posts = getAllPosts().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  const sections = [
    `# EuroSense`,
    ``,
    `> EuroSense collects citizens' stories about life in Europe and turns them into`,
    `> evidence that policy-makers can act on. It is a project of Volt Europa, run`,
    `> with the SenseMaker method: people share a short experience and then interpret`,
    `> it themselves, so the meaning comes from the storyteller rather than a coder.`,
    ``,
    `This is a static site. Content lives as Markdown and JSON in the`,
    `\`content/\` directory of github.com/Eurosense/homepage and can be edited there`,
    `by pull request; see AGENTS.md in that repository for the file formats.`,
    ``,
    `## Pages`,
    ``,
    ...pages.map((page) => line(page.title, page.urlPath, page.description)),
    ``,
  ]

  for (const [collection, route] of Object.entries(COLLECTION_ROUTES)) {
    const inCollection = posts.filter((post) => post.collection === collection)
    if (!inCollection.length) continue
    const heading = collection === 'blognews' ? 'Blog & news' : 'Multimedia'
    sections.push(
      `## ${heading}`,
      ``,
      `Index: ${SITE}${normalisePath(route)}`,
      ``,
      ...inCollection.map((post) => line(post.title, post.urlPath, post.excerpt)),
      ``,
    )
  }

  sections.push(
    `## Notes`,
    ``,
    `- The dashboard at ${SITE}/dashboard charts the collected stories. Its data is`,
    `  published separately at eurosense.github.io and refreshed nightly.`,
    `- Third-party embeds (recordings, slides, maps, the story collector) load only`,
    `  after a reader clicks, so their content is not in the served HTML.`,
    ``,
  )

  return new Response(sections.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

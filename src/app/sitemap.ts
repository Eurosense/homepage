import type { MetadataRoute } from 'next'

import { getAllPages, getAllPosts, normalisePath } from '@/lib/content'

export const dynamic = 'force-static'

const SITE = 'https://www.eurosense.eu'

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = getAllPages().map((page) => ({
    url: `${SITE}${normalisePath(page.urlPath)}`,
    changeFrequency: 'monthly' as const,
    priority: normalisePath(page.urlPath) === '/' ? 1 : 0.6,
  }))

  const posts = getAllPosts().map((post) => ({
    url: `${SITE}${normalisePath(post.urlPath)}`,
    lastModified: post.date ? new Date(post.date) : undefined,
    changeFrequency: 'yearly' as const,
    priority: 0.5,
  }))

  return [...pages, ...posts]
}

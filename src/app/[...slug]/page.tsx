import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageSections } from '@/components/PageSections'
import { PostList } from '@/components/PostList'
import { renderMarkdown } from '@/lib/markdown'
import {
  COLLECTION_ROUTES,
  getAllPages,
  getAllPosts,
  getPage,
  getPostsIn,
  getAdjacentPosts,
  normalisePath,
  pathToSegments,
  type Post,
} from '@/lib/content'

type Params = { slug: string[] }

/**
 * Every page and post is emitted here. The homepage is excluded because
 * app/page.tsx already owns "/", and a catch-all cannot match an empty path.
 */
export function generateStaticParams(): Params[] {
  const pages = getAllPages()
    .map((p) => normalisePath(p.urlPath))
    .filter((p) => p !== '/')
    .map((p) => ({ slug: pathToSegments(p) }))

  const posts = getAllPosts().map((p) => ({ slug: pathToSegments(p.urlPath) }))

  return [...pages, ...posts]
}

/** The collection whose listing lives at this path, if any. */
function collectionAt(urlPath: string): string | null {
  const match = Object.entries(COLLECTION_ROUTES).find(
    ([, route]) => normalisePath(route) === normalisePath(urlPath),
  )
  return match ? match[0] : null
}

function findPost(urlPath: string): Post | undefined {
  return getAllPosts().find((p) => normalisePath(p.urlPath) === normalisePath(urlPath))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const urlPath = normalisePath(slug.join('/'))

  const post = findPost(urlPath)
  if (post) {
    return {
      title: post.title,
      description: post.excerpt,
      openGraph: {
        title: post.title,
        description: post.excerpt,
        type: 'article',
        publishedTime: post.date,
        images: post.image ? [post.image] : undefined,
      },
    }
  }

  const page = getPage(urlPath)
  if (!page) return {}

  // Squarespace appended " — EuroSense" to every <title>; the layout template
  // adds it back, so strip it here to avoid doubling it.
  const title = page.title.replace(/\s*[—-]\s*EuroSense\s*$/, '')
  return {
    title,
    description: page.description,
    openGraph: {
      title,
      description: page.description,
      images: page.ogImage ? [page.ogImage] : undefined,
    },
  }
}

function formatDate(iso?: string) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Links to the neighbouring posts, as the original site does at the foot of
 * every article and multimedia item.
 */
function PostPagination({ collection, slug }: { collection: string; slug: string }) {
  const { previous, next } = getAdjacentPosts(collection, slug)
  if (!previous && !next) return null

  return (
    <nav
      aria-label="More in this collection"
      className="mt-12 grid gap-4 border-t border-line pt-6 sm:grid-cols-2"
    >
      {previous ? (
        <Link href={previous.urlPath} className="group no-underline">
          <span className="text-xs uppercase tracking-wide text-muted">Previous</span>
          <span className="mt-1 block font-display font-medium group-hover:underline">
            {previous.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.urlPath} className="group text-right no-underline sm:justify-self-end">
          <span className="text-xs uppercase tracking-wide text-muted">Next</span>
          <span className="mt-1 block font-display font-medium group-hover:underline">
            {next.title}
          </span>
        </Link>
      ) : null}
    </nav>
  )
}

function PostView({ post }: { post: Post }) {
  const backHref = COLLECTION_ROUTES[post.collection] ?? '/'

  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-12">
      <Link
        href={backHref}
        className="text-sm text-purple underline-offset-4 hover:underline"
      >
        ← Back
      </Link>

      <header className="mt-6 flex flex-col gap-3">
        <h1 className="text-4xl leading-tight">{post.title}</h1>
        <div className="flex flex-wrap gap-x-3 text-sm text-muted">
          {post.date ? <time dateTime={post.date}>{formatDate(post.date)}</time> : null}
          {post.author ? <span>Written by {post.author}</span> : null}
        </div>
      </header>

      {post.image ? (
        <Image
          src={post.image}
          alt=""
          width={1600}
          height={900}
          priority
          className="mt-8 h-auto w-full rounded-xl object-cover"
          sizes="(max-width: 768px) 100vw, 768px"
        />
      ) : null}

      <div
        className="prose-eurosense mt-10"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body) }}
      />

      {/* The original signs off with the author name after the body. */}
      {post.author ? (
        <p className="mt-8 font-display font-medium text-purple-deep">{post.author}</p>
      ) : null}

      <PostPagination collection={post.collection} slug={post.slug} />

      {post.tags.length > 0 ? (
        <ul className="mt-10 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <li
              key={tag}
              className="rounded-full bg-purple/10 px-3 py-1 text-xs text-purple-deep"
            >
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

export default async function CatchAllPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const urlPath = normalisePath(slug.join('/'))

  const post = findPost(urlPath)
  if (post) return <PostView post={post} />

  const page = getPage(urlPath)
  if (!page) notFound()

  // A listing path is both a normal page (its own sections) and the index of a
  // collection, so render the sections first and append the posts.
  const collection = collectionAt(urlPath)

  return (
    <>
      <PageSections sections={page.sections} />
      {collection ? <PostList posts={getPostsIn(collection)} /> : null}
    </>
  )
}

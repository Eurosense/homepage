'use client'

import Image from 'next/image'
import Link from 'next/link'

import { matchesQuery, usePostQuery } from '@/lib/postQuery'
import type { Post } from '@/lib/content'

function formatDate(iso?: string) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function PostList({ posts }: { posts: Post[] }) {
  const query = usePostQuery()
  const visible = posts.filter((post) => matchesQuery(post, query))

  if (posts.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-20">
      {visible.length === 0 ? (
        <p className="py-10 text-center text-muted">No posts match “{query.trim()}”.</p>
      ) : (
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((post) => (
            <li key={post.urlPath}>
              <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white/70 transition hover:border-purple/40 hover:shadow-lg">
                {post.image ? (
                  <Link href={post.urlPath} tabIndex={-1} aria-hidden>
                    <Image
                      src={post.image}
                      alt=""
                      width={post.imageWidth ?? 800}
                      height={post.imageHeight ?? 500}
                      /*
                       * The original index is a masonry grid, so each thumbnail
                       * keeps its own proportions. Forcing a single height here
                       * turned square images into a thin band across the middle.
                       */
                      className="w-full transition group-hover:scale-[1.02]"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
                    />
                  </Link>
                ) : null}

                <div className="flex flex-1 flex-col gap-2 p-5">
                  {/* Author and date, as the original index lists them. */}
                  <p className="text-xs uppercase tracking-wide text-muted">
                    {post.author ? <span>{post.author}</span> : null}
                    {post.author && post.date ? <span> · </span> : null}
                    {post.date ? (
                      <time dateTime={post.date}>{formatDate(post.date)}</time>
                    ) : null}
                  </p>

                  <h3 className="text-lg leading-snug">
                    <Link href={post.urlPath} className="hover:text-purple">
                      {post.title}
                    </Link>
                  </h3>

                  {post.excerpt ? (
                    <p className="line-clamp-3 text-sm text-muted">{post.excerpt}</p>
                  ) : null}

                  <Link
                    href={post.urlPath}
                    className="mt-auto pt-3 text-sm font-medium underline-offset-4 hover:underline"
                  >
                    Read more
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

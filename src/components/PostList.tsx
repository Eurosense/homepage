import Image from 'next/image'
import Link from 'next/link'

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
  if (posts.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-20">
      <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <li key={post.urlPath}>
            <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white/70 transition hover:border-purple/40 hover:shadow-lg">
              {post.image ? (
                <Link href={post.urlPath} tabIndex={-1} aria-hidden>
                  <Image
                    src={post.image}
                    alt=""
                    width={800}
                    height={500}
                    className="h-48 w-full object-cover transition group-hover:scale-[1.02]"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
                  />
                </Link>
              ) : null}

              <div className="flex flex-1 flex-col gap-2 p-5">
                {post.date ? (
                  <time dateTime={post.date} className="text-xs uppercase tracking-wide text-muted">
                    {formatDate(post.date)}
                  </time>
                ) : null}

                <h3 className="text-lg leading-snug">
                  <Link href={post.urlPath} className="hover:text-purple">
                    {post.title}
                  </Link>
                </h3>

                {post.excerpt ? (
                  <p className="line-clamp-3 text-sm text-muted">{post.excerpt}</p>
                ) : null}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  )
}

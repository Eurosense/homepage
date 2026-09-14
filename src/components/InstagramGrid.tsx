import Image from 'next/image'

type Post = { href: string; image: string; alt?: string }

/**
 * The Instagram feed, as a grid of square thumbnails linking to each post.
 *
 * Squarespace rendered this through a gallery script we do not ship, so keeping
 * its markup left the images a few pixels tall — on the page, but invisible.
 * The posts are a snapshot taken at migration time: this is static output, so
 * new posts will not appear here on their own.
 */
export function InstagramGrid({ posts }: { posts: Post[] }) {
  if (!posts.length) return null

  return (
    <ul className="grid w-full grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-5">
      {posts.map((post) => (
        <li key={post.href}>
          <a
            href={post.href}
            target="_blank"
            rel="noreferrer noopener"
            className="group block overflow-hidden rounded-lg"
          >
            <Image
              src={post.image}
              alt={post.alt || 'Instagram post'}
              width={600}
              height={600}
              className="aspect-square w-full object-cover transition group-hover:scale-105"
              sizes="(max-width: 640px) 33vw, 200px"
            />
          </a>
        </li>
      ))}
    </ul>
  )
}

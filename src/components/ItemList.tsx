import Image from 'next/image'
import Link from 'next/link'

import { renderMarkdown } from '@/lib/markdown'

type Item = {
  image?: string
  alt?: string
  title?: string
  description?: string
  href?: string
}

/**
 * Squarespace "list section" content.
 *
 * The same section type is used for two visibly different things: a strip of
 * partner logos (images only) and a row of article teasers (image + title +
 * text). They are told apart by whether any item has a title, which is how the
 * original renders them differently too.
 */
export function ItemList({ items }: { items: Item[] }) {
  const isLogoStrip = items.every((item) => !item.title)

  if (isLogoStrip) {
    return (
      <ul className="flex flex-wrap items-center justify-center gap-x-12 gap-y-8">
        {items.map((item, i) =>
          item.image ? (
            <li key={i} className="flex w-32 items-center justify-center sm:w-40">
              <Image
                src={item.image}
                alt={item.alt || ''}
                width={340}
                height={135}
                className="h-auto w-full object-contain"
                sizes="160px"
              />
            </li>
          ) : null,
        )}
      </ul>
    )
  }

  return (
    <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => {
        const body = (
          <>
            {item.image ? (
              <Image
                src={item.image}
                alt={item.alt || ''}
                width={800}
                height={500}
                className="mb-4 h-44 w-full rounded-xl object-cover"
                sizes="(max-width: 640px) 100vw, 300px"
              />
            ) : null}
            {item.title ? (
              <h3 className="text-lg leading-snug">{item.title}</h3>
            ) : null}
            {item.description ? (
              <div
                className="prose-eurosense mt-2 line-clamp-4 text-sm"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description) }}
              />
            ) : null}
          </>
        )

        return (
          <li key={i}>
            {item.href ? (
              <Link href={item.href} className="group block no-underline">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        )
      })}
    </ul>
  )
}

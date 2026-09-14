import Image from 'next/image'
import Link from 'next/link'

import { renderMarkdown } from '@/lib/markdown'

type Item = {
  image?: string
  alt?: string
  title?: string
  description?: string
  href?: string
  buttonLabel?: string
  buttonHref?: string
}

/**
 * Squarespace "list section" content.
 *
 * One section type is used for two visibly different things: a strip of partner
 * logos (images only) and a row of article teasers (image, title, text and a
 * call to action). They are told apart by whether any item has a title, which is
 * how the original distinguishes them too.
 */
export function ItemList({ items }: { items: Item[] }) {
  const isLogoStrip = items.every((item) => !item.title)

  if (isLogoStrip) {
    /*
     * One row on anything above phone width. `flex-1 basis-0` lets the logos
     * share the row and shrink together instead of wrapping, which is what
     * happened when each had a fixed width.
     */
    return (
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-8 sm:flex-nowrap">
        {items.map((item, i) =>
          item.image ? (
            <li
              key={i}
              className="flex min-w-0 basis-1/3 items-center justify-center sm:flex-1 sm:basis-0"
            >
              <Image
                src={item.image}
                alt={item.alt || ''}
                width={340}
                height={135}
                className="h-12 w-auto max-w-full object-contain sm:h-14"
                sizes="(max-width: 640px) 33vw, 180px"
              />
            </li>
          ) : null,
        )}
      </ul>
    )
  }

  return (
    <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item, i) => (
        <li key={i} className="flex flex-col">
          {item.image ? (
            <Link href={item.href ?? '#'} tabIndex={-1} aria-hidden className="block">
              <Image
                src={item.image}
                alt={item.alt || ''}
                width={800}
                height={500}
                className="mb-4 h-44 w-full rounded-xl object-cover"
                sizes="(max-width: 640px) 100vw, 300px"
              />
            </Link>
          ) : null}

          {item.title ? (
            <h3 className="text-lg leading-snug">
              {item.href ? (
                <Link href={item.href} className="no-underline hover:underline">
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </h3>
          ) : null}

          {item.description ? (
            <div
              className="prose-eurosense mt-2 line-clamp-4 text-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description) }}
            />
          ) : null}

          {item.buttonLabel ? (
            <Link
              href={item.buttonHref ?? item.href ?? '#'}
              className="mt-4 inline-flex h-11 items-center justify-center self-start rounded-[15px] border border-[color:var(--sec-btn-outline)] px-5 text-sm font-medium text-[color:var(--sec-btn-outline)] no-underline transition hover:bg-[color:var(--sec-btn-outline)]/10"
            >
              {item.buttonLabel}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

import Image from 'next/image'

import { renderMarkdown } from '@/lib/markdown'
import { SmartLink } from './SmartLink'

type Item = {
  image?: string
  imageWidth?: number
  imageHeight?: number
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
     * Sized by width, not height: the marks have very different aspect ratios,
     * and a shared height made the square one less than half its proper size.
     * The column steps live in `.partner-logos` in globals.css.
     */
    return (
      <ul className="partner-logos">
        {items.map((item, i) =>
          item.image ? (
            <li key={i} className="flex min-w-0 items-center justify-center">
              <Image
                src={item.image}
                alt={item.alt || ''}
                width={item.imageWidth ?? 340}
                height={item.imageHeight ?? 135}
                className="h-auto w-3/4 object-contain"
                sizes="(max-width: 640px) 75vw, (max-width: 1200px) 25vw, 15vw"
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
            <SmartLink href={item.href ?? '#'} tabIndex={-1} aria-hidden className="block">
              <Image
                src={item.image}
                alt={item.alt || ''}
                width={800}
                height={500}
                className="mb-4 h-44 w-full rounded-xl object-cover"
                sizes="(max-width: 640px) 100vw, 300px"
              />
            </SmartLink>
          ) : null}

          {/*
            Measured: 19.36px bold in purple-deep for the title, 14.27px purple
            for the body. A list section does not take its colours from the
            section theme, so these are set rather than inherited.
          */}
          {item.title ? (
            <h3 className="text-[19.36px] leading-snug font-bold text-purple-deep">
              {item.href ? (
                <SmartLink href={item.href} className="no-underline hover:underline">
                  {item.title}
                </SmartLink>
              ) : (
                item.title
              )}
            </h3>
          ) : null}

          {item.description ? (
            <div
              className="prose-eurosense mt-2 line-clamp-4 text-[14.272px] text-purple"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(item.description) }}
            />
          ) : null}

          {item.buttonLabel ? (
            /*
             * Measured on the live site, where this is a solid purple button
             * with white text rather than the section's outlined gold one: a
             * list section styles its own button independently of the section
             * theme. It is also noticeably smaller than a content button —
             * 8px/16px padding against 0/20px, and the label shrinks slightly as
             * the viewport grows (13.84px at 390, 12.54px at 1440).
             */
            <SmartLink
              href={item.buttonHref ?? item.href ?? '#'}
              className="mt-4 inline-flex items-center justify-center self-start rounded-[15px] bg-purple px-4 py-2 font-medium text-white no-underline transition hover:opacity-90"
              style={{ fontSize: 'calc(14.321px - 0.1234vw)' }}
            >
              {item.buttonLabel}
            </SmartLink>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

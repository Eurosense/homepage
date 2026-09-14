import Image from 'next/image'
import Link from 'next/link'

import { Accordion } from '@/components/Accordion'
import { Embed } from '@/components/Embed'
import { ContactForm } from '@/components/ContactForm'
import { renderMarkdown } from '@/lib/markdown'
import { getFormEndpoint } from '@/lib/forms'
import type { Block } from '@/lib/content'

/**
 * Squarespace's own markup is kept for accordions, galleries and summary lists.
 * It arrives with its classes stripped of styling, so it renders as plain
 * semantic HTML inside the prose styles rather than as a broken layout.
 */
function RawHtml({ html }: { html: string }) {
  return <div className="prose-eurosense" dangerouslySetInnerHTML={{ __html: html }} />
}

function isInternal(href: string) {
  return href.startsWith('/') && !href.startsWith('//')
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'richText':
      return (
        <div
          className="prose-eurosense"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(block.markdown) }}
        />
      )

    case 'image': {
      const img = (
        <Image
          src={block.src}
          alt={block.alt ?? ''}
          width={1600}
          height={1000}
          className="h-auto w-full rounded-xl object-cover"
          sizes="(max-width: 768px) 100vw, 800px"
        />
      )
      return (
        <figure className="my-2">
          {block.href ? (
            isInternal(block.href) ? (
              <Link href={block.href}>{img}</Link>
            ) : (
              <a href={block.href} target="_blank" rel="noreferrer noopener">
                {img}
              </a>
            )
          ) : (
            img
          )}
          {block.caption ? (
            <figcaption
              className="mt-2 text-center text-sm text-muted"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(block.caption) }}
            />
          ) : null}
        </figure>
      )
    }

    case 'button': {
      // self-start stops the button stretching to the column width: it is a
      // flex child of the section, where the default align-items is stretch.
      const classes =
        'inline-flex self-start items-center justify-center rounded-full bg-purple px-7 py-3 ' +
        'font-medium text-cream transition hover:bg-purple-deep ' +
        'focus-visible:outline-2 focus-visible:outline-offset-3'
      return isInternal(block.href) ? (
        <Link href={block.href} className={classes}>
          {block.label}
        </Link>
      ) : (
        <a href={block.href} target="_blank" rel="noreferrer noopener" className={classes}>
          {block.label}
        </a>
      )
    }

    case 'video':
      if (!block.src) return null
      return (
        <div className="aspect-video w-full overflow-hidden rounded-xl">
          <iframe
            src={block.src}
            title={block.title || 'Video'}
            loading="lazy"
            allowFullScreen
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            className="h-full w-full border-0"
          />
        </div>
      )

    case 'embed':
      return <Embed html={block.html} className="prose-eurosense w-full" />

    case 'quote':
      return (
        <blockquote className="border-l-[3px] border-gold pl-5 text-lg italic text-muted">
          <p>{block.text}</p>
          {block.source ? (
            <footer className="mt-2 text-sm not-italic">— {block.source}</footer>
          ) : null}
        </blockquote>
      )

    case 'divider':
      return <hr className="my-4 border-line" />

    case 'form':
      return <ContactForm block={block} endpoint={getFormEndpoint(block.formId ?? '')} />

    case 'accordion':
      return <Accordion items={block.items} />

    case 'gallery':
    case 'summary-v2':
    case 'instagram':
      return <RawHtml html={block.html} />

    default:
      return null
  }
}

export function SectionView({
  blocks,
  background,
}: {
  blocks: Block[]
  background?: string
}) {
  const hasBackground = Boolean(background)

  return (
    <section className="relative isolate">
      {background ? (
        <>
          <Image
            src={background}
            alt=""
            aria-hidden
            fill
            priority={false}
            className="-z-10 object-cover"
            sizes="100vw"
          />
          <div className="absolute inset-0 -z-10 bg-cream/70" aria-hidden />
        </>
      ) : null}

      <div
        className={`mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 ${
          hasBackground ? 'py-20' : 'py-14'
        }`}
      >
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
    </section>
  )
}

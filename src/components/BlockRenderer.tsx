import Image from 'next/image'
import Link from 'next/link'

import { Accordion } from '@/components/Accordion'
import { InstagramGrid } from '@/components/InstagramGrid'
import { ItemList } from '@/components/ItemList'
import { DocumentEmbed } from '@/components/DocumentEmbed'
import { Embed } from '@/components/Embed'
import { NewsletterForm } from '@/components/NewsletterForm'
import { ContactForm } from '@/components/ContactForm'
import { renderMarkdown } from '@/lib/markdown'
import { getFormTarget } from '@/lib/forms'
import type { Block } from '@/lib/content'

/**
 * Squarespace's own markup is kept for accordions, galleries and summary lists.
 * It arrives with its classes stripped of styling, so it renders as plain
 * semantic HTML inside the prose styles rather than as a broken layout.
 */
function RawHtml({ html }: { html: string }) {
  return <div className="prose-eurosense" dangerouslySetInnerHTML={{ __html: html }} />
}

/** The newsletter form whose field spec lives in content/forms.json. */
const NEWSLETTER_SQUARESPACE_ID = '671f9020897e7e5dea51318a'

function isInternal(href: string) {
  return href.startsWith('/') && !href.startsWith('//')
}

export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'richText':
      return (
        <div className="prose-eurosense" dangerouslySetInnerHTML={{ __html: block.html }} />
      )

    case 'image': {
      const img = (
        <Image
          src={block.src}
          alt={block.alt ?? ''}
          width={block.width ?? 1600}
          height={block.height ?? 1000}
          className="h-auto w-full rounded-xl object-contain"
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
              className="mt-2 text-center text-sm opacity-80"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(block.caption),
              }}
            />
          ) : null}
        </figure>
      )
    }

    case 'button': {
      /*
       * Three variants, measured from the live site: primary is a solid fill,
       * secondary and tertiary are outlined, and every one is 15px radius. The
       * colours come from the section theme, so the same button inverts on a
       * dark band exactly as it did on Squarespace.
       */
      const outlined = block.variant === 'secondary' || block.variant === 'tertiary'
      const classes = [
        'inline-flex items-center justify-center rounded-[15px] px-5 text-base font-medium leading-none transition',
        block.size === 'small' ? 'h-12' : 'h-14',
        block.stretched ? 'w-full' : 'self-start',
        outlined
          ? 'border border-[color:var(--sec-btn-outline)] text-[color:var(--sec-btn-outline)] hover:bg-[color:var(--sec-btn-outline)]/10'
          : 'bg-[color:var(--sec-btn-bg)] text-[color:var(--sec-btn-text)] hover:opacity-90',
      ].join(' ')

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

    case 'video': {
      if (!block.src) return null

      const caption = block.caption ? (
        <figcaption
          className="prose-eurosense mt-3 text-sm"
          dangerouslySetInnerHTML={{ __html: block.caption }}
        />
      ) : null

      // A local file plays in a real <video>; a third-party embed stays an iframe.
      if (block.src.startsWith('/')) {
        return (
          <figure className="w-full">
            <video
              src={block.src}
              poster={block.poster}
              controls
              playsInline
              preload="metadata"
              loop={block.loop}
              muted={block.muted}
              autoPlay={block.autoPlay}
              className="w-full rounded-xl bg-black"
              style={block.aspectRatio ? { aspectRatio: String(block.aspectRatio) } : undefined}
            >
              Your browser cannot play this video.{' '}
              <a href={block.src} download>
                Download it instead
              </a>
              .
            </video>
            {caption}
          </figure>
        )
      }

      return (
        <figure className="w-full">
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
          {caption}
        </figure>
      )
    }

    case 'embed': {
      /*
       * A HubSpot embed renders as our own form rather than HubSpot's iframe:
       * same submissions, styled with the site, no ~700px frame. It lives here
       * rather than in the footer so any HubSpot embed, on any page, matches.
       */
      const hubspot = block.html.match(/data-form-id="([^"]+)"[^>]*data-portal-id="([^"]+)"/)
      if (hubspot) {
        const target = getFormTarget(NEWSLETTER_SQUARESPACE_ID)
        if (target?.provider === 'hubspot' && target.newsletter) {
          return (
            <NewsletterForm
              portalId={hubspot[2]}
              formId={hubspot[1]}
              spec={target.newsletter}
            />
          )
        }
      }
      return <Embed html={block.html} className="prose-eurosense w-full" />
    }

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
      return <ContactForm block={block} target={getFormTarget(block.formId ?? '')} />

    case 'accordion':
      return <Accordion items={block.items} />

    case 'list':
      return <ItemList items={block.items} />

    case 'document':
      return <DocumentEmbed block={block} />

    case 'instagram':
      return <InstagramGrid posts={block.posts} />

    case 'gallery':
    case 'summary-v2':
      return <RawHtml html={block.html} />

    default: {
      // Reaching here means content/ holds a block this renderer does not know.
      // `npm run validate` catches it in CI, but a silent null during local
      // editing looks like the content itself is missing, so say so on screen.
      const unknown = block as { type: string }
      if (process.env.NODE_ENV !== 'production') {
        return (
          <div className="rounded-lg border border-dashed border-red-400 bg-red-50 p-4 text-sm text-red-800">
            Unknown block type <code className="font-mono">{unknown.type}</code>. Add it to the
            union in <code className="font-mono">src/lib/content.ts</code>, this renderer, and{' '}
            <code className="font-mono">scripts/validate-content.mjs</code>.
          </div>
        )
      }
      return null
    }
  }
}

/**
 * Fallback for the sections Squarespace rendered with its older layout engine
 * rather than the fluid-engine grid: a single readable column. Sections that
 * carry grid data go through FluidSection instead.
 */
export function SectionView({
  blocks,
  background,
  theme,
  minHeight,
  verticalAlign,
}: {
  blocks: Block[]
  background?: string
  theme?: string
  minHeight?: string
  verticalAlign?: 'start' | 'center' | 'end'
}) {
  const hasBackground = Boolean(background)

  return (
    <section
      className="relative isolate"
      data-theme={theme ?? 'none'}
      data-has-background={hasBackground ? 'true' : undefined}
      style={{
        ...(minHeight ? { minHeight } : {}),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: verticalAlign ?? 'start',
      }}
    >
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

      {/*
        A reading column suits prose, but a row of partner logos or article
        teasers needs the page width — constrained to max-w-3xl the six logos
        stacked one per row.
      */}
      <div
        className={`mx-auto flex w-full flex-col gap-6 px-5 ${
          blocks.some((b) => b.type === 'list') ? 'max-w-6xl' : 'max-w-3xl'
        } ${hasBackground ? 'py-20' : 'py-14'}`}
      >
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} />
        ))}
      </div>
    </section>
  )
}

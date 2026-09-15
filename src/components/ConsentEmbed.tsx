'use client'

import { useState } from 'react'

import { Embed } from '@/components/Embed'
import { describeEmbed } from '@/lib/embedKind'

/**
 * Holds a third-party embed back until the visitor asks for it.
 *
 * The embeds on this site — a SenseMaker form, Drive recordings, Google Slides,
 * Kumu maps — all set cookies or browser storage the moment they load, and
 * between them they are the only reason this site would need a consent banner.
 * Everything else is first-party and stores nothing. Gating the embeds is less
 * intrusive than a banner on every page, and it keeps the promise that nothing
 * third-party runs until someone opts in.
 *
 * The choice is deliberately not remembered: storing it would reintroduce the
 * client-side storage this is meant to avoid.
 */
export function ConsentEmbed({
  html,
  src,
  className,
  title,
  openHref,
}: {
  html: string
  /** The embed's URL, used to name the provider and say what loading it does. */
  src: string
  className?: string
  /** Overrides the derived heading, for embeds the page already labels. */
  title?: string
  /**
   * Where "open it at the provider" should go. An iframe's own URL works; a
   * script's does not, so a script-driven embed passes nothing and the link is
   * left off rather than pointing at a .js file.
   */
  openHref?: string
}) {
  const [loaded, setLoaded] = useState(false)

  if (loaded) return <Embed html={html} className={className} />

  const { label, noun, provider, note } = describeEmbed(src)

  return (
    <div
      className={`flex w-full flex-col items-start justify-center gap-3 rounded-xl border border-line bg-white p-6 ${className ?? ''}`}
    >
      <p className="font-display text-lg font-medium text-purple-deep">{title ?? label}</p>
      <p className="text-sm text-muted">
        Hosted by {provider}. {note}
      </p>
      <button
        type="button"
        onClick={() => setLoaded(true)}
        className="inline-flex h-12 items-center justify-center rounded-[15px] bg-purple px-5 text-base font-medium text-white transition hover:opacity-90"
      >
        Load the {noun}
      </button>
      {openHref ? (
        <a
          href={openHref}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm text-purple underline underline-offset-4"
        >
          Or open it at {provider} →
        </a>
      ) : null}
    </div>
  )
}

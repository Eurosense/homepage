import { Fragment } from 'react'

import { ConsentEmbed } from '@/components/ConsentEmbed'

/**
 * Renders a block of trusted HTML, holding any cross-origin iframe inside it
 * behind a click-to-load placeholder.
 *
 * The `embed` block type is gated in BlockRenderer, but post bodies are
 * markdown, and several of them write an `<iframe>` inline — Drive recordings,
 * Google Slides, Kumu maps. Those bypassed the gate entirely and loaded on view,
 * which is how five pages kept setting Google cookies after the rest of the site
 * had stopped.
 *
 * Splitting the HTML on iframes is only safe because each one is a top-level
 * element in the markdown, so every surrounding chunk is balanced on its own. An
 * iframe nested inside a wrapper would cut that wrapper in half; if one ever
 * appears, gate it at the block level instead.
 */
const IFRAME = /<iframe\b[^>]*><\/iframe>/gi

export function GatedHtml({ html, className }: { html: string; className?: string }) {
  const parts = html.split(IFRAME)
  const iframes = html.match(IFRAME) ?? []

  if (!iframes.length) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  }

  return (
    <div className={className}>
      {parts.map((chunk, index) => (
        <Fragment key={index}>
          {chunk ? <div dangerouslySetInnerHTML={{ __html: chunk }} /> : null}
          {iframes[index] ? <GatedIframe html={iframes[index]} /> : null}
        </Fragment>
      ))}
    </div>
  )
}

function GatedIframe({ html }: { html: string }) {
  const src = html.match(/\bsrc="([^"]+)"/i)?.[1]

  // Same-origin frames are ours (the vendored dashboard), so they load normally.
  if (!src || !/^https?:\/\//i.test(src)) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />
  }

  return <ConsentEmbed html={html} src={src} openHref={src} className="my-6" />
}

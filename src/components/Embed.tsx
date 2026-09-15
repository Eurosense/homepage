'use client'

import { useEffect, useRef } from 'react'

/**
 * Renders a third-party embed captured from Squarespace.
 *
 * Scripts inserted via innerHTML never execute — the HTML parser flags them as
 * already-handled. The site's dashboard and chart embeds are script-driven, so
 * each <script> is recreated as a fresh element and re-inserted, which is the
 * only way to get the browser to run it.
 *
 * Like the Markdown renderer, this trusts `content/` as reviewed first-party
 * code. Do not point it at user-submitted HTML.
 */
/*
 * Scripts are cut from the server-rendered markup and added back by the effect.
 * Leaving them in ran each one twice — once when the browser parsed the page,
 * once when the effect re-inserted it — which on /eurosensers threw "Identifier
 * 'userData' has already been declared" and Highcharts error #16. Everything
 * else in the embed still prerenders.
 */
const SCRIPT = /<script\b[^>]*>[\s\S]*?<\/script>/gi

/*
 * An <iframe> with no title is announced as "frame" and nothing else, so a
 * screen-reader user cannot tell what is in it or whether to enter it. Most
 * embeds here were authored with one; the vendored dashboard was not. Naming it
 * from its own URL keeps this working for content added later, rather than
 * fixing the single case in the JSON and meeting it again next time.
 */
function titleIframes(html: string) {
  return html.replace(/<iframe\b(?![^>]*\btitle=)([^>]*)>/gi, (tag, attrs: string) => {
    const src = attrs.match(/\bsrc="([^"]+)"/i)?.[1] ?? ''
    const name = src.startsWith('/')
      ? src.replace(/^\/|\/$/g, '').replace(/-/g, ' ')
      : (() => {
          try {
            return new URL(src).hostname.replace(/^www\./, '')
          } catch {
            return 'embedded content'
          }
        })()
    return `<iframe${attrs} title="${name}">`
  })
}

export function Embed({ html: rawHtml, className }: { html: string; className?: string }) {
  const html = titleIframes(rawHtml)
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return

    el.innerHTML = html

    const originals = Array.from(el.querySelectorAll('script'))
    const replacements: HTMLScriptElement[] = []

    for (const original of originals) {
      const script = document.createElement('script')
      for (const { name, value } of Array.from(original.attributes)) {
        script.setAttribute(name, value)
      }
      script.textContent = original.textContent
      original.replaceWith(script)
      replacements.push(script)
    }

    return () => {
      for (const script of replacements) script.remove()
      el.innerHTML = ''
    }
  }, [html])

  // Server render keeps the markup present for crawlers and no-JS readers; the
  // effect replaces it on mount so scripts actually run.
  return (
    <div
      ref={host}
      className={className}
      dangerouslySetInnerHTML={{ __html: html.replace(SCRIPT, '') }}
    />
  )
}

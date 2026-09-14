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
export function Embed({ html, className }: { html: string; className?: string }) {
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
  return <div ref={host} className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

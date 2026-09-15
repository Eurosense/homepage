'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { isInternalRoute } from '@/components/SmartLink'

/**
 * Routes links written as raw HTML through the client-side router.
 *
 * Most links go through SmartLink and use next/link already. The ones that
 * cannot are inside `richText` and post bodies, which are rendered with
 * `dangerouslySetInnerHTML` — the footer's navigation among them. Those stayed
 * plain anchors, so every footer link reloaded the whole document while the same
 * link in the header navigated instantly.
 *
 * Delegating from the document is what makes this work for content that did not
 * exist when the page mounted, and it keeps the markup plain `<a href>`: with
 * JavaScript off, or before hydration, the links still work as ordinary links.
 */
export function InternalLinkRouter() {
  const router = useRouter()

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Anything but an unmodified left click is the reader asking for something
      // else — a new tab, a download, a context menu.
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || !isInternalRoute(href)) return
      if (anchor.hasAttribute('download') || anchor.hasAttribute('target')) return

      // A link to a spot on this page is the browser's job, not the router's.
      const url = new URL(href, window.location.origin)
      if (url.pathname === window.location.pathname && url.hash) return

      event.preventDefault()
      router.push(href)
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [router])

  return null
}

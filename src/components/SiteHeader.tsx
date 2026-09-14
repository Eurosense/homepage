'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { SiteChrome } from '@/lib/content'

export function SiteHeader({ chrome }: { chrome: SiteChrome }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Route changes keep the component mounted, so the panel has to be closed
  // explicitly or it stays open over the new page.
  useEffect(() => setOpen(false), [pathname])

  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-cream/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link href="/" className="flex shrink-0 items-center" aria-label="EuroSense — home">
          <Image
            src={chrome.logo}
            alt={chrome.logoAlt}
            width={180}
            height={44}
            priority
            className="h-9 w-auto object-contain"
          />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {chrome.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                isCurrent(item.href)
                  ? 'bg-purple text-cream'
                  : 'text-purple-deep hover:bg-purple/10'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg p-2 md:hidden"
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden fill="none">
            <path
              d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'}
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t border-line px-5 pb-4 md:hidden"
        >
          {chrome.nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
              className="block border-b border-line/60 py-3 text-purple-deep last:border-0"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  )
}

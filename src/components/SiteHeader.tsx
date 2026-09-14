'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { SiteChrome } from '@/lib/content'

const SOCIAL_PATHS: Record<string, string> = {
  instagram:
    'M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.22 1 .48 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c0 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2 0-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c0-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4Zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3Zm6.9-11.1a1.55 1.55 0 1 1-1.55-1.55A1.55 1.55 0 0 1 18.9 5.2Z',
  linkedin:
    'M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM3.2 8.4h3.5V21H3.2V8.4Zm5.7 0h3.35v1.72h.05a3.67 3.67 0 0 1 3.3-1.81c3.53 0 4.18 2.32 4.18 5.34V21h-3.5v-6.05c0-1.44-.03-3.3-2.01-3.3-2.02 0-2.33 1.57-2.33 3.19V21H8.9V8.4Z',
}

function SocialLinks({ social }: { social: SiteChrome['social'] }) {
  if (!social.length) return null
  return (
    <ul className="flex items-center gap-2">
      {social.map((s) => (
        <li key={s.href}>
          <a
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-9 w-9 items-center justify-center rounded-full text-purple-deep transition hover:bg-purple/10"
          >
            <span className="sr-only">{s.platform}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d={SOCIAL_PATHS[s.platform] ?? SOCIAL_PATHS.linkedin} />
            </svg>
          </a>
        </li>
      ))}
    </ul>
  )
}

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

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
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

        <div className="hidden items-center gap-3 lg:flex">
          <SocialLinks social={chrome.social} />
          {chrome.headerCta ? (
            <a
              href={chrome.headerCta.href}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-[15px] border border-purple-deep px-4 py-2 text-sm font-medium text-purple-deep transition hover:bg-purple-deep hover:text-cream"
            >
              {chrome.headerCta.label}
            </a>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-lg p-2 lg:hidden"
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
          className="border-t border-line px-5 pb-4 lg:hidden"
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
          <div className="flex items-center gap-3 pt-4">
            <SocialLinks social={chrome.social} />
            {chrome.headerCta ? (
              <a
                href={chrome.headerCta.href}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-[15px] border border-purple-deep px-4 py-2 text-sm font-medium text-purple-deep"
              >
                {chrome.headerCta.label}
              </a>
            ) : null}
          </div>
        </nav>
      ) : null}
    </header>
  )
}

import type { Metadata } from 'next'

import { InternalLinkRouter } from '@/components/InternalLinkRouter'
import { SiteHeader } from '@/components/SiteHeader'
import { SiteFooter } from '@/components/SiteFooter'
import { getSiteChrome } from '@/lib/content'
import { roboto, satoshi } from '@/lib/fonts'

import './globals.css'

const chrome = getSiteChrome()

export const metadata: Metadata = {
  metadataBase: new URL('https://www.eurosense.eu'),
  title: {
    default: `${chrome.siteTitle} — Making sense of Europe together`,
    template: `%s — ${chrome.siteTitle}`,
  },
  description:
    'EuroSense gathers real-life stories from across Europe and turns them into ' +
    'evidence that policy-makers can act on.',
  icons: { icon: chrome.favicon },
  openGraph: {
    siteName: chrome.siteTitle,
    type: 'website',
    locale: 'en_GB',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${roboto.variable} ${satoshi.variable}`}>
      {/*
        No preconnects here on purpose. They once warmed four chart CDNs, HubSpot
        and SenseMaker, all of which have since gone: the charting libraries are
        served from public/dashboard-app/vendor, the newsletter posts straight to
        HubSpot's API, and the SenseMaker embed waits to be asked. A preconnect
        sends no request and sets no cookie, but it does complete DNS and a TLS
        handshake, which would hand the visitor's address to those origins on
        every page and make the click-to-load gate a formality. The one origin
        still worth warming, eurosense.github.io, is preconnected by the
        dashboard iframe that actually reads from it.
      */}
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-purple focus:px-4 focus:py-2 focus:text-cream"
        >
          Skip to content
        </a>
        <InternalLinkRouter />
        <SiteHeader chrome={chrome} />
        <main id="main" className="relative flex-1">
          {children}
        </main>
        <SiteFooter chrome={chrome} />
      </body>
    </html>
  )
}

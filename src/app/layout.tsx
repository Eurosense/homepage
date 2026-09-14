import type { Metadata } from 'next'

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
      <head>
        {/*
          The dashboard app pulls Highcharts, ECharts, Plotly and PapaParse from
          four different CDNs. Warming the connections here overlaps DNS and TLS
          with the rest of the page load instead of paying for them serially once
          the iframe starts parsing.
        */}
        {[
          'https://code.highcharts.com',
          'https://cdn.jsdelivr.net',
          'https://cdn.plot.ly',
          'https://cdnjs.cloudflare.com',
          'https://platform.sensemaker-suite.com',
          'https://js.hsforms.net',
          // The dashboard pulls its captures data from Pages at runtime.
          'https://eurosense.github.io',
        ].map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="anonymous" />
        ))}
      </head>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-purple focus:px-4 focus:py-2 focus:text-cream"
        >
          Skip to content
        </a>
        <SiteHeader chrome={chrome} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter chrome={chrome} />
      </body>
    </html>
  )
}

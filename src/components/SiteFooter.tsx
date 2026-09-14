import Image from 'next/image'

import { BlockView } from '@/components/BlockRenderer'
import type { SiteChrome } from '@/lib/content'

/**
 * Renders the footer from the blocks captured off Squarespace, splitting them
 * into the two logo images and the run of link/text blocks between them.
 *
 * Some of those text blocks are plain text on the live site rather than links
 * (Dashboard, Volt Europa 2026, Privacy Policy). That is reproduced rather than
 * guessed at — see the migration notes in README.md.
 */
export function SiteFooter({ chrome }: { chrome: SiteChrome }) {
  const images = chrome.footerBlocks.filter((b) => b.type === 'image')
  const links = chrome.footerBlocks.filter((b) => b.type === 'richText')

  return (
    <footer className="mt-20 border-t border-line bg-purple-deep text-cream">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-5 py-12">
        {images.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-10">
            {images.map((block, i) =>
              block.type === 'image' ? (
                <Image
                  key={i}
                  src={block.src}
                  alt={block.alt ?? ''}
                  width={220}
                  height={70}
                  className="h-12 w-auto object-contain"
                />
              ) : null,
            )}
          </div>
        ) : null}

        {links.length > 0 ? (
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm [&_a]:text-cream [&_a:hover]:text-gold [&_p]:m-0"
          >
            {links.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </nav>
        ) : null}

        {chrome.social.length > 0 ? (
          <ul className="flex gap-4">
            {chrome.social.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm capitalize underline-offset-4 hover:text-gold hover:underline"
                >
                  {s.platform}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs text-cream/60">
          © {new Date().getFullYear()} {chrome.siteTitle}
        </p>
      </div>
    </footer>
  )
}

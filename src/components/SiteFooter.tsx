import Image from 'next/image'

import { BlockView } from '@/components/BlockRenderer'
import { Embed } from '@/components/Embed'
import { NewsletterForm } from '@/components/NewsletterForm'
import { getFormTarget } from '@/lib/forms'
import type { SiteChrome } from '@/lib/content'

/**
 * Renders the footer from the blocks captured off Squarespace: the newsletter
 * embed, the two logo images, and the run of link/text blocks between them.
 *
 * Every block type present has to be handled explicitly here. Filtering to just
 * images and text silently dropped the HubSpot newsletter form, which is an
 * `embed` block and appears on every page of the original site.
 */
/** The Squarespace id of the newsletter form the footer carries on every page. */
const NEWSLETTER_FORM_ID = '671f9020897e7e5dea51318a'

export function SiteFooter({ chrome }: { chrome: SiteChrome }) {
  const images = chrome.footerBlocks.filter((b) => b.type === 'image')
  const links = chrome.footerBlocks.filter((b) => b.type === 'richText')
  const embeds = chrome.footerBlocks.filter((b) => b.type === 'embed')

  /*
   * The footer embed is the HubSpot newsletter. Render it as our own form
   * instead of HubSpot's iframe: same submissions, but styled with the site and
   * without a ~700px frame plus tracking cookies on every page of the site.
   */
  const newsletterTarget = getFormTarget(NEWSLETTER_FORM_ID)
  const newsletter =
    newsletterTarget?.provider === 'hubspot' && newsletterTarget.newsletter
      ? newsletterTarget
      : null

  return (
    <footer
      className="mt-20 border-t border-line"
      data-theme={chrome.footerBlocks[0]?.theme ?? 'none'}
    >
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

        {newsletter ? (
          <div data-footer-newsletter className="w-full max-w-xl">
            <NewsletterForm
              portalId={newsletter.portalId}
              formId={newsletter.formId}
              spec={newsletter.newsletter!}
            />
          </div>
        ) : null}

        {(newsletter ? [] : embeds).map((block, i) =>
          block.type === 'embed' ? (
            <div
              key={i}
              data-footer-newsletter
              className="w-full max-w-xl rounded-xl bg-white p-5 sm:p-7"
            >
              <Embed html={block.html} />
            </div>
          ) : null,
        )}

        {links.length > 0 ? (
          <nav
            aria-label="Footer"
            className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm [&_p]:m-0"
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
                  className="text-sm capitalize underline-offset-4 hover:underline"
                >
                  {s.platform}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs opacity-60">
          © {new Date().getFullYear()} {chrome.siteTitle}
        </p>
      </div>
    </footer>
  )
}

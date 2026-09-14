import { FluidSection } from '@/components/FluidSection'
import type { SiteChrome } from '@/lib/content'

/**
 * The footer, rendered through the same fluid grid as page sections.
 *
 * It is a fluid-engine section in the original: the logo mark is a small cell
 * and the wordmark spans nearly the full width. Rendering it as a plain stack
 * sized both the same, which made the two read as one logo printed twice.
 *
 * The newsletter embed inside it becomes our own form — see BlockView.
 */
export function SiteFooter({ chrome }: { chrome: SiteChrome }) {
  if (!chrome.footerBlocks.length) return null

  const theme = chrome.footerBlocks[0]?.theme ?? 'none'

  return (
    <footer className="mt-16 border-t border-line" data-theme={theme}>
      {chrome.footerGrid ? (
        <FluidSection
          id="site-footer"
          grid={chrome.footerGrid}
          blocks={chrome.footerBlocks}
          theme={theme}
        />
      ) : null}

      {chrome.social.length > 0 ? (
        <ul className="mx-auto flex max-w-6xl justify-center gap-4 px-5 pb-6">
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

      <p className="pb-8 text-center text-xs opacity-60">
        © {new Date().getFullYear()} {chrome.siteTitle}
      </p>
    </footer>
  )
}

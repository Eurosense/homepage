type SocialLink = { href: string; label: string }

/**
 * The social account icons from the original header of the blog page.
 *
 * Squarespace drew these from a sprite sheet on its own CDN, referenced through
 * SVG `<use>`, so only the links survived extraction. The paths below are the
 * official marks, inlined rather than fetched: two icons are not worth a
 * request, and nothing external should be needed to render the page.
 */
const ICONS: Record<string, string> = {
  instagram:
    'M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.8 3.8 0 0 1-1.38-.9 3.8 3.8 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16Zm0 6.03a3.81 3.81 0 1 0 0 7.62 3.81 3.81 0 0 0 0-7.62Zm0 6.28a2.47 2.47 0 1 1 0-4.94 2.47 2.47 0 0 1 0 4.94Zm4.85-6.43a.89.89 0 1 1-1.78 0 .89.89 0 0 1 1.78 0Z',
  linkedin:
    'M6.94 5.5a1.94 1.94 0 1 1-3.88 0 1.94 1.94 0 0 1 3.88 0ZM3.32 8.98h3.24V21H3.32V8.98Zm5.5 0h3.1v1.64h.05c.43-.82 1.49-1.68 3.06-1.68 3.27 0 3.87 2.15 3.87 4.95V21h-3.23v-5.43c0-1.3-.02-2.96-1.8-2.96-1.8 0-2.08 1.41-2.08 2.87V21H8.82V8.98Z',
}

function iconFor(label: string) {
  return ICONS[label.toLowerCase()]
}

export function SocialLinks({ links }: { links: SocialLink[] }) {
  return (
    <ul className="flex items-center gap-4">
      {links.map((link) => {
        const path = iconFor(link.label)
        return (
          <li key={link.href}>
            <a
              href={link.href}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={link.label}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--sec-btn-bg)] text-[color:var(--sec-btn-text)] transition hover:opacity-80"
            >
              {path ? (
                <svg viewBox="0 0 24 24" aria-hidden className="h-6 w-6" fill="currentColor">
                  <path d={path} />
                </svg>
              ) : (
                // An account we have no mark for still needs to be reachable.
                <span className="text-sm font-medium">{link.label.slice(0, 2)}</span>
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

/**
 * Whether next/link should handle an href, i.e. it addresses a page of this site
 * rather than a file or another origin.
 *
 * Every route here is extensionless, so a dot in the final path segment means a
 * static asset in public/. That distinction matters: routing `/files/report.pdf`
 * through next/link turns a download into a client-side navigation to a route
 * that does not exist, and the file 404s.
 */
export function isInternalRoute(href: string) {
  if (!href.startsWith('/') || href.startsWith('//')) return false
  const pathname = href.split(/[?#]/)[0]
  return !pathname.split('/').pop()?.includes('.')
}

type Props = Omit<ComponentProps<'a'>, 'href'> & { href: string; children: ReactNode }

/**
 * A link that uses next/link for real routes and a plain anchor for everything
 * else, opening other origins in a new tab the way the original site did.
 */
export function SmartLink({ href, children, ...rest }: Props) {
  /*
   * A link carrying a hash stays a plain anchor. next/link handles the first
   * click and then, because the URL no longer changes, silently does nothing on
   * the second — which is what "Request access to Sensemaker" looked like to
   * anyone who used it twice. As an ordinary anchor it falls to
   * InternalLinkRouter, which scrolls to the target every time.
   */
  if (isInternalRoute(href) && !href.includes('#')) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    )
  }

  const isExternal = /^https?:\/\//i.test(href)

  return (
    <a
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
      {...rest}
    >
      {children}
    </a>
  )
}

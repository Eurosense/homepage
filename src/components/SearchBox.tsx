'use client'

import { setPostQuery, usePostQuery } from '@/lib/postQuery'

/**
 * Searches the posts listed further down the page.
 *
 * Squarespace's search block queried its hosted index across the whole site.
 * That index goes away with the subscription, and a static export has nothing to
 * query, so this filters the posts already on the page instead — no request, and
 * it works with JavaScript disabled to the extent of showing every post.
 */
export function SearchBox({ placeholder }: { placeholder: string }) {
  const query = usePostQuery()

  return (
    <div className="w-full">
      <label className="sr-only" htmlFor="post-search">
        {placeholder}
      </label>
      <input
        id="post-search"
        type="search"
        value={query}
        placeholder={placeholder}
        onChange={(event) => setPostQuery(event.target.value)}
        className="h-12 w-full rounded-[15px] border border-[color:var(--sec-btn-outline)] bg-white px-4 text-base text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[color:var(--sec-btn-outline)]"
      />
    </div>
  )
}
